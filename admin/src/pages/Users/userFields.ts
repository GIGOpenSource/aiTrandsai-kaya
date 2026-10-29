import type { UserItem, UserAccountStatus } from '../../types';

const BANNED_STATUS = new Set(['banned', 'ban', 'blocked', '封禁']);
const CANCELLED_STATUS = new Set([
  'cancelled',
  'canceled',
  'deactivated',
  'deleted',
  '注销',
]);

export function unwrapUser(res: unknown): UserItem | null {
  if (!res || typeof res !== 'object') return null;
  const o = res as Record<string, unknown>;
  if (o.results && typeof o.results === 'object' && !Array.isArray(o.results)) {
    return o.results as UserItem;
  }
  if (typeof o.id === 'number' || typeof o.username === 'string') {
    return o as unknown as UserItem;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isVipUser(user: UserItem): boolean {
  if (typeof user.is_vip === 'boolean') return user.is_vip;
  if (user.vip === true || user.vip === 1 || user.vip === 'yes' || user.vip === '是') return true;
  return false;
}

export function getRemainingPoints(user: UserItem): number | null {
  return toNumber(user.credits);
}

export function getRemainingFreeMessages(user: UserItem): number | null {
  return toNumber(user.free_messages_remaining);
}

export function getUserStatus(user: UserItem): UserAccountStatus {
  const raw = String(user.status ?? '').trim().toLowerCase();
  if (CANCELLED_STATUS.has(raw) || user.is_deleted) return 'cancelled';
  if (BANNED_STATUS.has(raw) || user.is_banned === true || user.status === 0) return 'banned';
  // active / normal / 空值 → 正常
  return 'normal';
}

export function getVipExpireDisplay(
  user: UserItem,
  formatDate: (iso: string | null | undefined) => string,
  lifetimeLabel: string,
): string {
  if (!isVipUser(user)) return '——';
  if (user.vip_type === 'lifetime' || !user.vip_expire_at) return lifetimeLabel;
  return formatDate(user.vip_expire_at);
}

export function formatGender(gender: string | null | undefined, t: (key: string) => unknown): string {
  const g = gender || '';
  const keyMap: Record<string, string> = {
    male: 'gender.male',
    female: 'gender.female',
    'non-binary': 'gender.nonBinary',
    confidential: 'gender.confidential',
    secret: 'gender.confidential',
    男: 'gender.male',
    女: 'gender.female',
    保密: 'gender.confidential',
  };
  const key = keyMap[g];
  return key ? String(t(key)) : g || '-';
}

export function formatOrientation(value: string | null | undefined, t: (key: string) => unknown): string {
  const v = value || '';
  const keyMap: Record<string, string> = {
    heterosexual: 'orientation.heterosexual',
    homosexual: 'orientation.homosexual',
    bisexual: 'orientation.bisexual',
    pansexual: 'orientation.pansexual',
    asexual: 'orientation.asexual',
    secret: 'orientation.secret',
    confidential: 'orientation.secret',
  };
  const key = keyMap[v];
  return key ? String(t(key)) : v || '-';
}

export const UA_SOURCE_ADS = 'ua:source:ads';
export const UA_SPECIFIC_PREFIXES = ['ua:campaign:', 'ua:gclid:', 'ua:adgroup:'];

export function isSpecificUaTag(tag: string) {
  return UA_SPECIFIC_PREFIXES.some((prefix) => tag.startsWith(prefix));
}

export function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  tags.forEach((tag) => {
    const key = String(tag || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

export function sameTagList(a: string[] | undefined, b: string[] | undefined) {
  const left = uniqueTags(a || []).sort();
  const right = uniqueTags(b || []).sort();
  return left.length === right.length && left.every((item, i) => item === right[i]);
}

export function applyUaShortcut(kind: 'none' | 'ads' | 'attributed', current: string[]) {
  if (kind === 'none') return [];
  const specific = current.filter(isSpecificUaTag);
  const extra = current.filter((tag) => tag !== UA_SOURCE_ADS && !isSpecificUaTag(tag));
  if (kind === 'ads') {
    return uniqueTags([UA_SOURCE_ADS, ...specific, ...extra]);
  }
  return uniqueTags([UA_SOURCE_ADS, ...specific, ...extra]);
}

export function inferUaShortcut(tags: string[]): 'none' | 'ads' | 'attributed' {
  if (!tags.length) return 'none';
  if (tags.some(isSpecificUaTag)) return 'attributed';
  if (tags.includes(UA_SOURCE_ADS)) return 'ads';
  return 'ads';
}
