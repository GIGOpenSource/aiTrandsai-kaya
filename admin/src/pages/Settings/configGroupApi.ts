import { adminFetchJson } from '../../api/request';
import type { ConfigGroup } from '../../types';
import { unwrapResults } from '../Companions/contentApi';

export type ConfigFormField = {
  path?: string;
  key?: string;
  name?: string;
  label?: string;
  label_zh?: string;
  label_en?: string;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  placeholder?: string;
  options?: { value: string; label?: string }[];
  readonly?: boolean;
  password?: boolean;
  required?: boolean;
};

export type ConfigFormSchema = {
  layout?: string;
  config_type?: string;
  fields?: ConfigFormField[];
  ignore_legacy_paths?: string[];
  title?: string;
  description?: string;
  /** VIP 等嵌套结构的计划 key 列表 */
  plan_keys?: string[];
  package_keys?: string[];
};

export type ConfigGroupOptions = {
  form_by_key?: Record<string, ConfigFormSchema>;
  config_types?: { value: string; label?: string; label_zh?: string; label_en?: string }[] | string[];
  create_meta_fields?: ConfigFormField[];
};

export const VIP_PLAN_KEYS = ['weekly', 'monthly', 'yearly', 'lifetime'] as const;
export const VIP_PACK_KEYS = ['pack_250', 'pack_550', 'pack_800', 'pack_1900'] as const;

export const AGENT_PROMPT_LANGS = [
  'zh', 'en', 'ja', 'ko', 'pt', 'es', 'id', 'ar', 'fa', 'ru', 'bg', 'tr',
] as const;

const KEY_SPECIFIC = new Set([
  'free_turns_limit',
  'say_hi_daily_free_limit',
  'moment_comment_limit',
  'default_affection_floor',
  'system_costs',
  'vip_plans',
  'agent',
  'model_service',
  'image_generation',
  'image_gemini',
  'image_xai',
]);

export function unwrapOptions(res: unknown): ConfigGroupOptions {
  if (!res || typeof res !== 'object') return {};
  const obj = res as Record<string, unknown>;
  if (obj.form_by_key || obj.config_types || obj.create_meta_fields) {
    return obj as ConfigGroupOptions;
  }
  const nested = unwrapResults<ConfigGroupOptions>(res);
  return nested && typeof nested === 'object' ? nested : {};
}

export async function fetchConfigGroupOptions(): Promise<ConfigGroupOptions> {
  const res = await adminFetchJson('/api/admin/config-groups/options');
  return unwrapOptions(res);
}

export async function fetchConfigGroups(): Promise<ConfigGroup[]> {
  const res = await adminFetchJson('/api/admin/config-groups');
  const list = unwrapResults<ConfigGroup[]>(res) ?? res;
  return Array.isArray(list) ? list : [];
}

/**
 * 按 key 优先解析表单布局：
 * form_by_key[key] → 本地 key 兜底 → 同 config_type（system 除外）→ JSON
 */
export function resolveFormSchema(
  item: Pick<ConfigGroup, 'key' | 'config_type'>,
  options?: ConfigGroupOptions | null,
): ConfigFormSchema {
  const key = (item.key || '').trim();
  const configType = (item.config_type || '').trim();
  const map = options?.form_by_key || {};

  if (key && map[key]) return normalizeSchema(map[key], key, configType);

  const local = fallbackSchema(key, configType);
  if (key && KEY_SPECIFIC.has(key)) return local;
  if (local.layout && local.layout !== 'json') return local;

  // system 下多个 key 字段不同，禁止用「同类型第一个」误套布局
  if (configType && configType !== 'system') {
    const byType = Object.values(map).find((s) => s?.config_type === configType);
    if (byType) return normalizeSchema(byType, key, configType);
  }

  return local.layout ? local : { layout: 'json', fields: [] };
}

function normalizeSchema(schema: ConfigFormSchema, key: string, configType: string): ConfigFormSchema {
  const layout = schema.layout || fallbackSchema(key, configType).layout || 'json';
  return {
    ...schema,
    layout,
    config_type: schema.config_type || configType,
    fields: schema.fields || fallbackSchema(key, configType).fields,
    ignore_legacy_paths:
      schema.ignore_legacy_paths ||
      (layout === 'vip_plans' ? ['chat_cost', 'free_turns_limit', 'create_agent_cost', 'daily_agent_cost'] : undefined),
  };
}

export function fallbackSchema(key: string, configType: string): ConfigFormSchema {
  if (key === 'free_turns_limit') {
    return {
      layout: 'single_number',
      config_type: 'system',
      fields: [{ path: 'free_turns_limit', label: '免费对话总次数', min: 0, max: 9999, default: 3 }],
    };
  }
  if (key === 'say_hi_daily_free_limit') {
    return {
      layout: 'single_number',
      config_type: 'system',
      fields: [{ path: 'say_hi_daily_free_limit', label: '每日免费 Say Hi', min: 0, max: 9999, default: 10 }],
    };
  }
  if (key === 'moment_comment_limit') {
    return {
      layout: 'single_number',
      config_type: 'system',
      fields: [{
        path: 'moment_comment_limit',
        label: '每用户每动态评论上限',
        label_zh: '每用户每动态评论上限',
        label_en: 'Max comments per user per moment',
        min: 0,
        max: 9999,
        default: 1,
      }],
    };
  }
  if (key === 'default_affection_floor') {
    return {
      layout: 'single_number',
      config_type: 'system',
      fields: [{ path: 'default_affection_floor', label: '默认档位', min: 20, max: 100, default: 80 }],
    };
  }
  if (key === 'system_costs') {
    return {
      layout: 'cost_grid',
      config_type: 'system',
      fields: [
        { path: 'chat_cost', label: '聊天扣积分', min: 0, max: 99999, default: 3 },
        { path: 'create_agent_cost', label: '创建智能体扣积分', min: 0, max: 99999, default: 50 },
        { path: 'daily_agent_cost', label: '智能体日扣积分', min: 0, max: 99999, default: 10 },
        { path: 'free_turns_limit', label: '免费聊天次数(可选)', min: 0, max: 9999, default: 3 },
      ],
    };
  }
  if (key === 'vip_plans' || configType === 'payment') {
    return {
      layout: 'vip_plans',
      config_type: 'payment',
      ignore_legacy_paths: ['chat_cost', 'free_turns_limit', 'create_agent_cost', 'daily_agent_cost'],
      plan_keys: [...VIP_PLAN_KEYS],
      package_keys: [...VIP_PACK_KEYS],
    };
  }
  if (key === 'agent' || configType === 'agent') {
    return { layout: 'agent', config_type: 'agent' };
  }
  if (key === 'model_service' || configType === 'model_service') {
    return { layout: 'model_service', config_type: 'model_service' };
  }
  if (
    key === 'image_generation' ||
    key === 'image_gemini' ||
    key === 'image_xai' ||
    configType === 'image_generation'
  ) {
    return { layout: 'image_generation', config_type: 'image_generation' };
  }
  return { layout: 'json', config_type: configType || undefined, fields: [] };
}

export function defaultConfigJson(
  key: string,
  configType: string,
  options?: ConfigGroupOptions | null,
): Record<string, unknown> {
  const schema = resolveFormSchema({ key, config_type: configType }, options);
  return defaultConfigJsonFromSchema(schema, key);
}

export function defaultConfigJsonFromSchema(
  schema: ConfigFormSchema,
  key?: string,
): Record<string, unknown> {
  if (schema.layout === 'single_number') {
    const fields = schema.fields?.length
      ? schema.fields
      : [{ path: key || 'value', default: 0 }];
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const path = f.path || f.key || f.name;
      if (path) out[path] = f.default ?? 0;
    }
    return out;
  }
  if (schema.layout === 'cost_grid') {
    const out: Record<string, unknown> = {};
    for (const f of schema.fields || []) {
      const path = f.path || f.key || f.name;
      if (path) out[path] = f.default ?? 0;
    }
    if (!Object.keys(out).length) {
      return { chat_cost: 3, create_agent_cost: 50, daily_agent_cost: 10, free_turns_limit: 3 };
    }
    return out;
  }
  if (schema.layout === 'vip_plans') {
    const planKeys = schema.plan_keys?.length ? schema.plan_keys : [...VIP_PLAN_KEYS];
    const packKeys = schema.package_keys?.length ? schema.package_keys : [...VIP_PACK_KEYS];
    return {
      plans: Object.fromEntries(
        planKeys.map((k) => [
          k,
          {
            daily_credits: k === 'weekly' ? 24 : k === 'monthly' ? 50 : k === 'yearly' ? 80 : 100,
            max_agents: k === 'weekly' ? 1 : k === 'monthly' ? 3 : 5,
            duration_days: k === 'weekly' ? 7 : k === 'monthly' ? 30 : k === 'yearly' ? 365 : 0,
          },
        ]),
      ),
      recharge_packages: Object.fromEntries(
        packKeys.map((k) => [k, { credits: Number(String(k).replace('pack_', '')) || 0 }]),
      ),
    };
  }
  if (schema.layout === 'agent') {
    return { model_provider: 'google', temperature: 0.93, max_tokens: 2048 };
  }
  if (schema.layout === 'model_service') {
    return { model_provider: 'google' };
  }
  if (schema.layout === 'image_generation') {
    return {
      provider: 'google',
      model: 'gemini-2.5-flash-image',
      timeout_seconds: 120,
      default_width: 1024,
      default_height: 1024,
    };
  }
  return {};
}

export function normalizeConfigTypes(
  raw: ConfigGroupOptions['config_types'],
): { value: string; label: string }[] {
  const fallback = [
    { value: 'model_service', label: 'model_service' },
    { value: 'agent', label: 'agent' },
    { value: 'image_generation', label: 'image_generation' },
    { value: 'system', label: 'system' },
    { value: 'payment', label: 'payment' },
  ];
  if (!raw?.length) return fallback;
  return raw
    .map((item) => {
      if (typeof item === 'string') return { value: item, label: item };
      const value = String(item.value || '');
      const label = String(item.label_zh || item.label || item.label_en || value);
      return { value, label };
    })
    .filter((item) => item.value);
}

export function fieldLabel(field: ConfigFormField, locale: string) {
  if (locale.startsWith('zh')) {
    return field.label_zh || field.label || field.path || field.key || field.name || '';
  }
  return field.label_en || field.label || field.path || field.key || field.name || '';
}

export function fieldPath(field: ConfigFormField) {
  return field.path || field.key || field.name || '';
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stripIgnoredPaths(
  config: Record<string, unknown>,
  ignore?: string[],
): Record<string, unknown> {
  if (!ignore?.length) return { ...config };
  const next = { ...config };
  for (const path of ignore) delete next[path];
  return next;
}

const SECRET_KEYS = [
  'api_key',
  'google_key',
  'deepseek_key',
  'openai_key',
  'anthropic_key',
  'xai_key',
  'access_key_id',
  'secret_access_key',
  'session_token',
  'admin_password',
];

export function omitEmptySecrets(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  for (const key of SECRET_KEYS) {
    const v = next[key];
    if (typeof v === 'string' && !v.trim()) delete next[key];
  }
  return next;
}

/** 已知 key 选中时自动带上推荐 config_type */
export function suggestedConfigType(key: string, options?: ConfigGroupOptions | null): string | undefined {
  const hit = options?.form_by_key?.[key];
  if (hit?.config_type) return hit.config_type;
  const local = fallbackSchema(key, '');
  return local.config_type;
}
