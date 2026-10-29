import { adminFetch, adminFetchJson } from '../../api/request';
import { CONTENT_LANGS, unwrapResults } from '../Companions/contentApi';
import type {
  MsgStrategyLibraryType,
  MsgStrategyMeta,
  MsgStrategyScopeOption,
  MsgStrategyScopeOptions,
  MsgStrategyTrigger,
} from '../../types';

export const EMPTY_SCOPE_OPTIONS: MsgStrategyScopeOptions = { ads: [], attr: [] };

/** 类型下拉以接口为准，不再写死旧 key；失败时为空列表 */
export const FALLBACK_TRIGGERS: MsgStrategyTrigger[] = [];
export const FALLBACK_LIBRARY_TYPES: MsgStrategyLibraryType[] = [];

export function parseSenderMode(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  return String(value);
}

export function isCompanionSenderMode(mode?: string | null) {
  return mode === 'companion';
}

export function unwrapList(res: unknown): unknown[] {
  const raw = unwrapResults<unknown>(res);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.list)) return obj.list;
  }
  return [];
}

export function parsePaged<T>(res: unknown): { list: T[]; total: number } {
  const pagination =
    res && typeof res === 'object'
      ? (res as { pagination?: { total?: number } }).pagination
      : undefined;
  const raw = unwrapResults<unknown>(res);
  if (Array.isArray(raw)) {
    return { list: raw as T[], total: pagination?.total ?? raw.length };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const items = Array.isArray(obj.items) ? obj.items : Array.isArray(obj.list) ? obj.list : [];
    const total = pagination?.total ?? (typeof obj.total === 'number' ? obj.total : items.length);
    return { list: items as T[], total };
  }
  return { list: [], total: 0 };
}

function asTrigger(item: unknown): MsgStrategyTrigger | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const trigger_key = String(row.trigger_key || row.key || row.type_key || row.event_key || '');
  if (!trigger_key) return null;
  return {
    trigger_key,
    name_zh: row.name_zh != null ? String(row.name_zh) : row.name != null ? String(row.name) : undefined,
    name_en: row.name_en != null ? String(row.name_en) : undefined,
    event_keys: Array.isArray(row.event_keys) ? row.event_keys.map(String) : undefined,
    sender_mode: parseSenderMode(row.sender_mode),
    seq: typeof row.seq === 'number' ? row.seq : undefined,
  };
}

function asLibraryType(item: unknown): MsgStrategyLibraryType | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const type_key = String(row.type_key || row.key || row.event_key || row.trigger_key || '');
  if (!type_key) return null;
  return {
    type_key,
    name_zh: row.name_zh != null ? String(row.name_zh) : row.name != null ? String(row.name) : undefined,
    name_en: row.name_en != null ? String(row.name_en) : undefined,
    trigger_key: row.trigger_key != null ? String(row.trigger_key) : undefined,
    seq: typeof row.seq === 'number' ? row.seq : undefined,
    sender_mode: parseSenderMode(row.sender_mode),
  };
}

function asLangOptions(list: unknown[]): { value: string; label: string }[] {
  const options = list
    .map((item) => {
      if (typeof item === 'string') {
        const hit = CONTENT_LANGS.find((l) => l.value === item);
        return hit || { value: item, label: item };
      }
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const value = String(row.code || row.value || row.language || row.key || '');
      if (!value) return null;
      const label = String(row.name || row.label || row.name_zh || value);
      return { value, label };
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));
  return options.length ? options : CONTENT_LANGS;
}

function asScopeOptions(list: unknown[]): { value: string; label: string }[] {
  const fallback = [
    { value: 'all', label: 'all' },
    { value: 'ads', label: 'ads' },
    { value: 'attr', label: 'attr' },
  ];
  const options = list
    .map((item) => {
      if (typeof item === 'string') return { value: item, label: item };
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const value = String(row.value || row.type_key || row.key || '');
      if (!value) return null;
      return { value, label: String(row.name_zh || row.label || row.name || value) };
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));
  return options.length ? options : fallback;
}

export function parseMeta(res: unknown): MsgStrategyMeta {
  const raw = unwrapResults<Record<string, unknown>>(res) ?? (res as Record<string, unknown> | undefined);
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const triggers = unwrapList(obj.triggers ?? [])
    .map(asTrigger)
    .filter((item): item is MsgStrategyTrigger => Boolean(item));
  const libraryTypes = unwrapList(obj.library_types ?? obj.types ?? obj.libraryTypes ?? [])
    .map(asLibraryType)
    .filter((item): item is MsgStrategyLibraryType => Boolean(item));
  const companionBound = unwrapList(obj.companion_bound_events ?? [])
    .map((item) => (typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).event_key || (item as Record<string, unknown>).type_key || '') : ''))
    .filter(Boolean);
  const sortBySeq = <T extends { seq?: number; type_key?: string; trigger_key?: string }>(list: T[]) =>
    [...list].sort((a, b) => {
      const sa = a.seq ?? Number.MAX_SAFE_INTEGER;
      const sb = b.seq ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      return String(a.type_key || a.trigger_key || '').localeCompare(String(b.type_key || b.trigger_key || ''));
    });
  return {
    triggers: triggers.length ? sortBySeq(triggers) : FALLBACK_TRIGGERS,
    library_types: libraryTypes.length ? sortBySeq(libraryTypes) : FALLBACK_LIBRARY_TYPES,
    companion_bound_events: companionBound,
    user_scope_types: asScopeOptions(unwrapList(obj.user_scope_types ?? [])),
    languages: asLangOptions(
      unwrapList(obj.language_options ?? obj.languages ?? obj.languageOptions ?? []),
    ),
  };
}

export async function loadMsgStrategyMeta(): Promise<MsgStrategyMeta> {
  try {
    const res = await adminFetchJson('/api/admin/msg-strategy/meta');
    return parseMeta(res);
  } catch {
    // 类型以下拉接口为准；meta 失败时再试 strategy-types
    try {
      const res = await adminFetchJson('/api/admin/content/strategy-types');
      const library_types = unwrapList(res)
        .map(asLibraryType)
        .filter((item): item is MsgStrategyLibraryType => Boolean(item));
      return {
        triggers: FALLBACK_TRIGGERS,
        library_types,
        companion_bound_events: library_types
          .filter((item) => isCompanionSenderMode(item.sender_mode))
          .map((item) => item.type_key),
        user_scope_types: [
          { value: 'all', label: 'all' },
          { value: 'ads', label: 'ads' },
          { value: 'attr', label: 'attr' },
        ],
        languages: CONTENT_LANGS,
      };
    } catch {
      return {
        triggers: FALLBACK_TRIGGERS,
        library_types: FALLBACK_LIBRARY_TYPES,
        companion_bound_events: [],
        user_scope_types: [
          { value: 'all', label: 'all' },
          { value: 'ads', label: 'ads' },
          { value: 'attr', label: 'attr' },
        ],
        languages: CONTENT_LANGS,
      };
    }
  }
}

export function triggerLabel(item: MsgStrategyTrigger) {
  return item.name_zh || item.name_en || item.trigger_key;
}

export function libraryTypeLabel(item: MsgStrategyLibraryType) {
  return item.name_zh || item.name_en || item.type_key;
}

/** 下拉展示：名称（type_key） */
export function libraryTypeOptionLabel(item: MsgStrategyLibraryType) {
  const name = libraryTypeLabel(item);
  return name === item.type_key ? name : `${name}（${item.type_key}）`;
}

export type LibraryTypeSelectOption = {
  value: string;
  label: string;
  sender_mode?: string;
};

export function toLibraryTypeSelectOptions(types: MsgStrategyLibraryType[]): LibraryTypeSelectOption[] {
  return types.map((item) => ({
    value: item.type_key,
    label: libraryTypeOptionLabel(item),
    sender_mode: item.sender_mode,
  }));
}

export async function patchActive(url: string, isActive: boolean) {
  return adminFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function splitIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function asScopeTagOption(item: unknown): MsgStrategyScopeOption | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const value = String(row.value ?? row.key ?? '');
  if (!value) return null;
  return {
    value,
    label: String(row.label ?? row.name_zh ?? row.name ?? value),
    kind: row.kind != null ? String(row.kind) : undefined,
    count: typeof row.count === 'number' ? row.count : undefined,
    group: row.group != null ? String(row.group) : undefined,
    source: row.source != null ? String(row.source) : undefined,
  };
}

export function parseScopeOptions(res: unknown): MsgStrategyScopeOptions {
  const root = asRecord(res) ?? {};
  const payload = asRecord(root.results) ?? asRecord(root.data) ?? root;
  const ads = Array.isArray(payload.ads)
    ? payload.ads.map(asScopeTagOption).filter((item): item is MsgStrategyScopeOption => Boolean(item))
    : [];
  const attr = Array.isArray(payload.attr)
    ? payload.attr.map(asScopeTagOption).filter((item): item is MsgStrategyScopeOption => Boolean(item))
    : [];
  const hintRaw = asRecord(payload.hint);
  return {
    ads,
    attr,
    hint: hintRaw
      ? {
          ads: hintRaw.ads != null ? String(hintRaw.ads) : undefined,
          attr: hintRaw.attr != null ? String(hintRaw.attr) : undefined,
        }
      : undefined,
  };
}

export async function loadScopeOptions(): Promise<MsgStrategyScopeOptions> {
  try {
    const res = await adminFetchJson('/api/admin/msg-strategy/scope-options');
    return parseScopeOptions(res);
  } catch {
    return EMPTY_SCOPE_OPTIONS;
  }
}

/** Split stored `user_scope_value` (comma string or array) into option values. */
export function parseScopeValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function joinScopeValue(value: unknown): string {
  return parseScopeValue(value).join(',');
}
