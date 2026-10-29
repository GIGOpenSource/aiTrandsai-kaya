import { adminFetch, adminFetchJson, getAdminSession, getToken } from '../../api/request';
import { unwrapResults } from '../Companions/contentApi';
import type { AdminAccount, ChatSessionItem, ChatSessionMessagesResponse, ImCompanionProfile, ImConsumeStats, ImReadAllResult, ImReadCompanionResult, ImReplyModeSettings, ImSessionsTimeMode, ImUnreadSummary, PaginatedResponse, TranslateTextResponse } from '../../types';

export function parseImSessions(res: unknown): {
  list: ChatSessionItem[];
  total: number;
  time_mode?: ImSessionsTimeMode | string;
  start_at?: string | null;
  end_at?: string | null;
} {
  const raw = unwrapResults<unknown>(res) ?? res;
  if (Array.isArray(raw)) return { list: raw as ChatSessionItem[], total: raw.length };
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const items = Array.isArray(obj.items)
      ? obj.items
      : Array.isArray(obj.results)
        ? obj.results
        : [];
    const pagination = (res as { pagination?: { total?: number } } | null)?.pagination;
    const total =
      (typeof obj.total === 'number' ? obj.total : undefined) ??
      pagination?.total ??
      items.length;
    return {
      list: items as ChatSessionItem[],
      total,
      time_mode: obj.time_mode != null ? String(obj.time_mode) : undefined,
      start_at: obj.start_at == null || obj.start_at === '' ? null : String(obj.start_at),
      end_at: obj.end_at == null || obj.end_at === '' ? null : String(obj.end_at),
    };
  }
  return { list: [], total: 0 };
}

/** 把筛选里的日期当成 UTC 墙钟，输出到秒的 ISO（…Z） */
export function formatUtcIsoSeconds(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]}T${m[2]}Z`;
  }
  const d = value as { format?: (tpl: string) => string };
  if (typeof d.format === 'function') {
    return `${d.format('YYYY-MM-DDTHH:mm:ss')}Z`;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function utcIsoToPickerValue(iso?: string | null) {
  if (!iso) return null;
  const m = String(iso).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

export function utcIsoToFileStamp(iso: string) {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso.replace(/[^\dTZ]/g, '');
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
}

export function parseDownloadFilename(header: string | null, fallback: string) {
  if (!header) return fallback;
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/['"]/g, '').trim());
    } catch {
      /* ignore */
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  if (plain?.[1]) return plain[1].replace(/['"]/g, '').trim();
  return fallback;
}

export async function readBlobApiError(res: Response, blob: Blob, fallback: string) {
  try {
    const text = await blob.text();
    const data = JSON.parse(text) as { detail?: unknown; message?: string; error?: string };
    if (typeof data.detail === 'string' && data.detail) return data.detail;
    if (Array.isArray(data.detail) && data.detail[0]) {
      const first = data.detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    return data.message || data.error || fallback;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}

export async function readApiError(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { detail?: string; message?: string; error?: string };
    const detail = data.detail;
    if (typeof detail === 'string' && detail) return detail;
    return data.message || data.error || fallback;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}

export function opsAdminLabel(admin?: { id?: number; username?: string; nickname?: string | null; name?: string } | null) {
  if (!admin) return '';
  return admin.nickname || admin.username || admin.name || (admin.id != null ? `#${admin.id}` : '');
}

export function isHasOpsAdminValue(raw: unknown) {
  return raw === true || raw === false || raw === 'true' || raw === 'false';
}

export function parseOpsAdminIds(raw: unknown): number[] {
  if (raw == null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,，]/);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    const id = Number(item);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function loadAdminOptions(): Promise<{ value: number; label: string }[]> {
  try {
    const res = await adminFetchJson<PaginatedResponse<AdminAccount>>('/api/admin/admin-users?page=1&page_size=200');
    const list = unwrapResults<AdminAccount[]>(res) ?? res?.results ?? [];
    const rows = Array.isArray(list) ? list : [];
    return rows
      .filter((item) => item.is_active !== false)
      .map((item) => ({
        value: item.id,
        label: `${item.nickname || item.username} (#${item.id})`,
      }));
  } catch {
    return [];
  }
}

export function imMessageImageUrl(msg: {
  content_type?: string | null;
  image_url?: string | null;
  content?: string | null;
}) {
  const fromField = String(msg.image_url || '').trim();
  if (fromField) return fromField;
  const typed = String(msg.content_type || '').toLowerCase();
  if (typed === 'image') {
    const content = String(msg.content || '').trim();
    if (/^https?:\/\//i.test(content) || content.startsWith('/') || content.startsWith('data:')) return content;
  }
  return '';
}

export function isImImageMessage(msg: {
  content_type?: string | null;
  image_url?: string | null;
  content?: string | null;
}) {
  return String(msg.content_type || '').toLowerCase() === 'image' || !!imMessageImageUrl(msg);
}

export function isImUnpaidMessage(msg?: { send_status?: string | null } | null) {
  return String(msg?.send_status || '').trim().toLowerCase() === 'unpaid';
}

export function visibleImMessages<T extends { send_status?: string | null }>(
  list: T[] | null | undefined,
  showUnpaid: boolean,
) {
  const rows = list ?? [];
  if (showUnpaid) return rows;
  return rows.filter((m) => !isImUnpaidMessage(m));
}

export const IM_MESSAGE_PAGE_SIZE = 20;
const IM_MESSAGE_PAGE_SIZE_MAX = 50;

export async function fetchImMessages(
  userId: number,
  companionId: string,
  opts?: { page?: number; page_size?: number; translate?: boolean },
) {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts?.page_size ?? IM_MESSAGE_PAGE_SIZE), IM_MESSAGE_PAGE_SIZE_MAX);
  const q = new URLSearchParams({
    user_id: String(userId),
    companion_id: companionId,
    page: String(page),
    page_size: String(pageSize),
  });
  if (opts?.translate) q.set('translate', 'true');
  const res = await adminFetchJson<ChatSessionMessagesResponse>(`/api/admin/im/sessions/messages?${q.toString()}`);
  const raw = unwrapResults<ChatSessionMessagesResponse>(res) ?? res;
  return raw;
}

export async function translateImText(text: string, acceptLanguage?: string) {
  const res = await adminFetchJson<TranslateTextResponse>('/api/admin/im/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    acceptLanguage,
  });
  return unwrapResults<TranslateTextResponse>(res) ?? res;
}

export function normalizeImCompanion(res: unknown): ImCompanionProfile | null {
  const raw = unwrapResults<unknown>(res) ?? res;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const nested = row.profile && typeof row.profile === 'object' ? (row.profile as Record<string, unknown>) : {};
  const pick = (key: string) => row[key] ?? nested[key];
  const str = (key: string) => {
    const v = pick(key);
    if (v == null || v === '') return undefined;
    return String(v);
  };
  const ageRaw = pick('age');
  const ageNum = ageRaw == null || ageRaw === '' ? undefined : Number(ageRaw);
  return {
    id: str('id'),
    name: str('name'),
    nickname: str('nickname'),
    avatar_url: str('avatar_url') || str('avatar') || null,
    gender: str('gender'),
    language: str('language'),
    personality: str('personality'),
    background: str('background'),
    city: str('city'),
    country: str('country'),
    age: ageNum != null && Number.isFinite(ageNum) ? ageNum : undefined,
    mbti: str('mbti'),
    sexual_orientation: str('sexual_orientation') ?? null,
    speech_style: str('speech_style'),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseUnreadSummary(res: unknown): ImUnreadSummary {
  const raw = asRecord(unwrapResults<unknown>(res) ?? res) ?? {};
  const nested = asRecord(raw.results) ?? asRecord(raw.data) ?? raw;
  const list = Array.isArray(nested.by_companion) ? nested.by_companion : [];
  return {
    total_unread: Number(nested.total_unread) || 0,
    session_count: Number(nested.session_count) || 0,
    by_companion: list
      .map((item) => {
        const row = asRecord(item) ?? {};
        return {
          companion_id: String(row.companion_id || ''),
          unread_count: Number(row.unread_count) || 0,
          companion_name: row.companion_name != null ? String(row.companion_name) : undefined,
        };
      })
      .filter((item) => item.companion_id && item.unread_count > 0),
  };
}

function parseReadCompanionResult(
  res: unknown,
  fallbackUserId: number,
  fallbackCompanionId: string,
): ImReadCompanionResult {
  const raw = asRecord(unwrapResults<unknown>(res) ?? res) ?? {};
  const nested = asRecord(raw.results) ?? asRecord(raw.data) ?? raw;
  const hasSummary = nested.total_unread != null || Array.isArray(nested.by_companion);
  return {
    ok: nested.ok !== false,
    user_id: Number(nested.user_id) || fallbackUserId,
    companion_id: String(nested.companion_id || fallbackCompanionId),
    ops_unread_count: Number(nested.ops_unread_count) || 0,
    cleared_unread: nested.cleared_unread != null ? Number(nested.cleared_unread) : undefined,
    ops_last_read_at: nested.ops_last_read_at != null ? String(nested.ops_last_read_at) : null,
    summary: hasSummary ? parseUnreadSummary(nested) : undefined,
  };
}

export async function fetchUnreadSummary(): Promise<ImUnreadSummary> {
  const res = await adminFetchJson('/api/admin/im/sessions/unread-summary');
  return parseUnreadSummary(res);
}

export async function markImAllRead(): Promise<ImReadAllResult | null> {
  const res = await adminFetch('/api/admin/im/sessions/read-all', { method: 'POST' });
  if (!res) return null;
  if (!res.ok) throw new Error(await readApiError(res, 'Failed to mark all read'));
  const data = await res.json();
  const summary = parseUnreadSummary(data);
  const nested = asRecord(unwrapResults<unknown>(data) ?? data) ?? {};
  return {
    ok: nested.ok !== false,
    cleared_unread: Number(nested.cleared_unread) || 0,
    cleared_sessions: Number(nested.cleared_sessions) || 0,
    total_unread: summary.total_unread,
    session_count: summary.session_count,
    by_companion: summary.by_companion,
  };
}

export function appendImSessionFilters(q: URLSearchParams, params: Record<string, unknown>) {
  if (params.user_id) q.set('user_id', String(params.user_id));
  if (params.companion_id) {
    const ids = Array.isArray(params.companion_id)
      ? params.companion_id.join(',')
      : String(params.companion_id);
    if (ids) q.set('companion_id', ids);
  }
  if (params.user_nickname) q.set('user_nickname', String(params.user_nickname));
  if (params.ops_admin_id) q.set('ops_admin_id', String(params.ops_admin_id));
  if (
    params.takeover_only === true ||
    params.takeover_only === false ||
    params.takeover_only === 'true' ||
    params.takeover_only === 'false'
  ) {
    q.set('takeover_only', String(params.takeover_only));
  }
}

/** 主动清未读：用户 × 智能体。优先 read-companion（带回最新汇总），404 时回退历史 read。 */
export async function markImCompanionRead(userId: number, companionId: string): Promise<ImReadCompanionResult | null> {
  const opts: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, companion_id: companionId }),
  };
  let res = await adminFetch('/api/admin/im/sessions/read-companion', opts);
  if (!res) return null;
  if (res.status === 404) {
    res = await adminFetch('/api/admin/im/sessions/read', opts);
    if (!res) return null;
  }
  if (!res.ok) throw new Error(await readApiError(res, 'Failed to mark read'));
  try {
    return parseReadCompanionResult(await res.json(), userId, companionId);
  } catch {
    return {
      ok: true,
      user_id: userId,
      companion_id: companionId,
      ops_unread_count: 0,
    };
  }
}

export async function fetchImCompanion(companionId: string) {
  const res = await adminFetchJson(`/api/admin/im/companions/${companionId}`);
  return normalizeImCompanion(res);
}

export async function fetchImConsumeStats(userId: number, companionId: string) {
  const q = new URLSearchParams({ companion_id: companionId });
  const res = await adminFetchJson<ImConsumeStats>(`/api/admin/im/users/${userId}/consume-stats?${q.toString()}`);
  return unwrapResults<ImConsumeStats>(res) ?? res;
}

export async function takeoverSession(userId: number, companionId: string) {
  return adminFetch('/api/admin/im/takeover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, companion_id: companionId }),
  });
}

export async function releaseTakeover(userId: number, companionId: string) {
  return adminFetch('/api/admin/im/takeover/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, companion_id: companionId }),
  });
}

export function formatIdleRemaining(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '';
  const n = Math.max(0, Math.floor(Number(seconds)));
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m <= 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function sendImMessage(userId: number, companionId: string, content: string) {
  return adminFetch('/api/admin/im/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, companion_id: companionId, content }),
  });
}

export async function assignOpsAdmin(userId: number, companionId: string, opsAdminId: number | null) {
  return adminFetch('/api/admin/im/sessions/ops', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, companion_id: companionId, ops_admin_id: opsAdminId }),
  });
}

export function imWebSocketUrl(userId: number, companionId: string) {
  const token = getToken();
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/admin/im/${userId}/${encodeURIComponent(companionId)}?token=${encodeURIComponent(token)}`;
}

export type PersistedTakeover = {
  user_id: number;
  username?: string;
  nickname?: string;
  companion_id: string;
  companion_name?: string;
  ops_unread_count?: number;
  minimized?: boolean;
  pos?: { x: number; y: number };
};

function takeoverStorageKey() {
  return `im_takeovers_${getAdminSession()?.user_id ?? 'anon'}`;
}

export function loadPersistedTakeovers(): PersistedTakeover[] {
  try {
    const raw = localStorage.getItem(takeoverStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PersistedTakeover =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as PersistedTakeover).user_id === 'number' &&
        typeof (item as PersistedTakeover).companion_id === 'string',
    );
  } catch {
    return [];
  }
}

export function savePersistedTakeovers(items: PersistedTakeover[]) {
  try {
    localStorage.setItem(takeoverStorageKey(), JSON.stringify(items));
  } catch {
    /* ignore quota */
  }
}

export function sessionToPersisted(
  row: ChatSessionItem,
  extra?: Pick<PersistedTakeover, 'minimized' | 'pos'>,
): PersistedTakeover {
  return {
    user_id: row.user_id,
    username: row.username,
    nickname: row.nickname,
    companion_id: row.companion_id,
    companion_name: row.companion_name,
    ops_unread_count: row.ops_unread_count,
    minimized: extra?.minimized,
    pos: extra?.pos,
  };
}

export function persistedToSession(row: PersistedTakeover): ChatSessionItem {
  return {
    user_id: row.user_id,
    username: row.username || '',
    nickname: row.nickname || '',
    companion_id: row.companion_id,
    companion_name: row.companion_name || '',
    turns: 0,
    affection: 0,
    session_updated_at: null,
    message_count: 0,
    last_message_at: null,
    is_taken_over: true,
    ops_unread_count: row.ops_unread_count,
  };
}

export async function fetchImReplyMode(): Promise<ImReplyModeSettings | null> {
  const res = await adminFetchJson<ImReplyModeSettings>('/api/admin/im/reply-mode');
  const data = unwrapResults<ImReplyModeSettings>(res) ?? (res as ImReplyModeSettings | undefined);
  if (!data || typeof data !== 'object') return null;
  return data;
}

export async function saveImReplyMode(payload: { reply_mode: string; wait_seconds?: number }) {
  return adminFetch('/api/admin/im/reply-mode', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
