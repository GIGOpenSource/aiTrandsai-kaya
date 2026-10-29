type MessageApi = {
  success: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warning: (...args: any[]) => void;
  loading: (...args: any[]) => void;
};

let messageApi: MessageApi | null = null;

/** 由 Antd App 注入，避免静态 message 无法消费主题 context。 */
export function setMessageApi(api: MessageApi) {
  messageApi = api;
}

const API_BASE = '';

let adminToken = localStorage.getItem('admin_token') || '';

export function getToken() {
  return adminToken;
}

export function setToken(token: string) {
  adminToken = token;
  localStorage.setItem('admin_token', token);
}

const ADMIN_SESSION_KEY = 'admin_session';

export type AdminSessionInfo = {
  username: string;
  nickname?: string;
  role_key?: string;
  user_id?: number;
};

export function setAdminSession(info: AdminSessionInfo) {
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(info));
}

export function getAdminSession(): AdminSessionInfo | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AdminSessionInfo) : null;
  } catch {
    return null;
  }
}

export function clearToken() {
  adminToken = '';
  localStorage.removeItem('admin_token');
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function getLanguageHeader(): string {
  const saved = localStorage.getItem('admin_lang') || 'zh';
  const map: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en-US',
  };
  return map[saved] || saved;
}

export type AdminFetchInit = RequestInit & { acceptLanguage?: string };

export async function adminFetch(url: string, opts: AdminFetchInit = {}) {
  const { acceptLanguage, ...fetchOpts } = opts;
  fetchOpts.headers = fetchOpts.headers || {};
  const headers = fetchOpts.headers as Record<string, string>;
  headers['Authorization'] = `Bearer ${adminToken}`;
  headers['Accept-Language'] = acceptLanguage || getLanguageHeader();
  if (!url.includes('/api/admin/login')) {
    headers['x-token'] = adminToken;
  }
  const res = await fetch(`${API_BASE}${url}`, fetchOpts);
  if (res.status === 401) {
    clearToken();
    window.location.hash = '#/login';
    return null;
  }
  return res;
}

export async function adminFetchJson<T = unknown>(url: string, opts: AdminFetchInit = {}): Promise<T | null> {
  const res = await adminFetch(url, opts);
  if (!res) return null;
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      // 支持后端 {error: "..."} 或 {detail: "..."} 格式，解决不一致问题
      const errorData = await res.json();
      errorMsg = errorData.message || errorData.error || errorData.detail || JSON.stringify(errorData) || errorMsg;
    } catch {
      try {
        const text = await res.text();
        errorMsg = text || errorMsg;
      } catch {
        // keep default fallback error message
      }
    }
    throw new Error(errorMsg);
  }
  return res.json() as Promise<T>;
}

function pickUploadUrl(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  for (const key of ['url', 'path', 'image_url', 'file_url', 'location']) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (row.results != null) return pickUploadUrl(row.results);
  return '';
}

function toUploadFile(file: unknown): File {
  if (file instanceof File) return file;
  if (file instanceof Blob) {
    const type = file.type || 'image/jpeg';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return new File([file], `upload.${ext}`, { type });
  }
  if (file && typeof file === 'object' && 'originFileObj' in file) {
    const origin = (file as { originFileObj?: File }).originFileObj;
    if (origin instanceof File) return origin;
  }
  throw new Error('Invalid file');
}

/** POST /api/upload/image，返回后端给出的图片 URL。 */
export async function uploadAdminImage(
  file: unknown,
  opts?: { quality?: number; folder?: string; max_edge?: number; filename?: string },
): Promise<string> {
  const formData = new FormData();
  const raw = toUploadFile(file);
  const uploadFile = opts?.filename
    ? new File([raw], opts.filename, { type: raw.type || 'image/jpeg' })
    : raw;
  formData.append('file', uploadFile);
  if (opts?.quality != null) formData.append('quality', String(opts.quality));
  if (opts?.folder) formData.append('folder', opts.folder);
  if (opts?.max_edge != null) formData.append('max_edge', String(opts.max_edge));
  const data = await adminFetchJson('/api/upload/image', { method: 'POST', body: formData });
  const url = pickUploadUrl(data);
  if (!url) throw new Error('Upload failed');
  return url;
}

function parseErrorMessage(text: string, fallback: string) {
  if (!text) return fallback;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const msg = json.message || json.error || json.detail;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch {
    // 非 JSON 错误体，直接用原文
  }
  return text;
}

/** POST /api/admin/moments/generate-image，返回图片二进制。 */
export async function generateMomentImage(companionId: string, caption: string): Promise<Blob> {
  const res = await adminFetch('/api/admin/moments/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companion_id: companionId, caption }),
  });
  if (!res) throw new Error('Unauthorized');
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      errorMsg = parseErrorMessage(await res.text(), errorMsg);
    } catch {
      // keep default
    }
    throw new Error(errorMsg);
  }
  const contentType = res.headers.get('content-type') || '';
  const blob = await res.blob();
  if (contentType.includes('application/json') || blob.type.includes('application/json')) {
    throw new Error(parseErrorMessage(await blob.text(), 'Generate failed'));
  }
  if (!blob.size) throw new Error('Empty image');
  if (blob.type.startsWith('image/')) return blob;
  return new Blob([blob], { type: 'image/png' });
}

export function showSuccess(text: unknown) {
  messageApi?.success(text);
}

export function showError(text: unknown) {
  messageApi?.error(text);
}

export function showWarning(text: unknown) {
  messageApi?.warning(text);
}

export function showLoading(text: unknown) {
  messageApi?.loading(text);
}

export function formatDate(iso: string | null | undefined, _locale: string = 'zh-CN') {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}-${m}-${day} ${h}:${min}:${s} (UTC)`;
}
