/** 马甲应用（app_key）选项：福利商品 / 模板 / 数据统计日活共用 */
export type AppOption = { value: string; label: string };

export const DEFAULT_APP_KEY = 'trandsai';

export const FALLBACK_APP_OPTIONS: AppOption[] = [
  { value: 'trandsai', label: 'Trandsai' },
  { value: 'kaya', label: 'KAYA' },
];

export function normalizeAppKey(value?: string | null): string {
  const key = String(value || '').trim();
  return key || DEFAULT_APP_KEY;
}

function mapLabeledOptions(raw: unknown): AppOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string' && item.trim()) {
        const value = item.trim().toUpperCase();
        return { value, label: value };
      }
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const value = String(row.value || row.code || row.country || '').trim();
      if (!value) return null;
      return { value, label: String(row.label || value) };
    })
    .filter(Boolean) as AppOption[];
}

export function parseApps(raw: unknown): AppOption[] {
  const list = mapLabeledOptions(raw);
  return list.length ? list : FALLBACK_APP_OPTIONS;
}

/** 国家/地区筛选项；空数组表示接口未返回，不要回落到应用马甲 */
export function parseCountryOptions(raw: unknown): AppOption[] {
  return mapLabeledOptions(raw);
}

export function appLabel(apps: AppOption[], appKey?: string | null): string {
  const key = normalizeAppKey(appKey);
  return apps.find((item) => item.value === key)?.label || key;
}
