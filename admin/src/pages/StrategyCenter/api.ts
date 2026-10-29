import { adminFetchJson } from '../../api/request';
import type { StrategyCenterRow, StrategyCenterTab } from '../../types';
import { parsePaged, unwrapResults } from '../Companions/contentApi';

export const STRATEGY_CENTER_TABS: StrategyCenterTab[] = ['independent', 'msg-library', 'quick-reply'];

export function tabBase(tab: StrategyCenterTab) {
  return `/api/admin/strategy-center/${tab}`;
}

export function rowKeyOf(row: Pick<StrategyCenterRow, 'application_key' | 'id' | 'companion_id'>) {
  return row.application_key || `${row.id}:${row.companion_id || ''}`;
}

export function rowPath(tab: StrategyCenterTab, row: Pick<StrategyCenterRow, 'id' | 'companion_id'>, suffix = '') {
  if (tab === 'independent') return `${tabBase(tab)}/${row.id}${suffix}`;
  return `${tabBase(tab)}/${row.id}/companions/${encodeURIComponent(row.companion_id)}${suffix}`;
}

export function parseWriteRows(res: unknown): StrategyCenterRow[] {
  const raw = unwrapResults<unknown>(res) ?? res;
  if (Array.isArray(raw)) return raw as StrategyCenterRow[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as StrategyCenterRow[];
    if (obj.id != null) return [obj as unknown as StrategyCenterRow];
    if (obj.results && typeof obj.results === 'object' && !Array.isArray(obj.results)) {
      const nested = obj.results as Record<string, unknown>;
      if (Array.isArray(nested.items)) return nested.items as StrategyCenterRow[];
      if (nested.id != null) return [nested as unknown as StrategyCenterRow];
    }
  }
  return [];
}

export async function fetchStrategyCenterList(tab: StrategyCenterTab, qs: URLSearchParams) {
  const res = await adminFetchJson(`${tabBase(tab)}?${qs.toString()}`);
  return parsePaged<StrategyCenterRow>(res);
}

export async function createStrategyCenter(tab: StrategyCenterTab, body: Record<string, unknown>) {
  return adminFetchJson(`${tabBase(tab)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateStrategyCenter(
  tab: StrategyCenterTab,
  row: Pick<StrategyCenterRow, 'id' | 'companion_id'>,
  body: Record<string, unknown>,
) {
  return adminFetchJson(rowPath(tab, row), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchStrategyCenterActive(
  tab: StrategyCenterTab,
  row: Pick<StrategyCenterRow, 'id' | 'companion_id'>,
  isActive: boolean,
) {
  return adminFetchJson(rowPath(tab, row, '/active'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  });
}

export async function deleteStrategyCenter(
  tab: StrategyCenterTab,
  row: Pick<StrategyCenterRow, 'id' | 'companion_id'>,
) {
  return adminFetchJson(rowPath(tab, row), { method: 'DELETE' });
}

export function typeTagColor(key: string) {
  const colors = ['blue', 'green', 'purple', 'orange', 'cyan', 'magenta', 'geekblue', 'volcano'] as const;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}
