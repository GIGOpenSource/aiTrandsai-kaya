import type { CompanionItem, ContentCompanion, ProductEvent } from '../../types';

/** 产品语种短码（与 companions.language / 消息策略 language 同一套）；label 仅作接口失败时的兜底 */
export const CONTENT_LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pt', label: 'Português' },
  { value: 'es', label: 'Español' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ar', label: 'العربية（ar）' },
  { value: 'fa', label: 'فارسی（fa）' },
  { value: 'ru', label: 'Русский（ru）' },
  { value: 'bg', label: 'Български（bg）' },
  { value: 'tr', label: 'Türkçe' },
];

export function unwrapResults<T>(res: unknown): T | undefined {
  if (res == null) return undefined;
  if (typeof res === 'object') {
    const row = res as { results?: T; data?: T };
    if (row.results != null) return row.results;
    if (row.data != null) return row.data;
  }
  return res as T;
}

export function parsePaged<T>(res: unknown): { list: T[]; total: number } {
  const root = res && typeof res === 'object' ? (res as Record<string, unknown>) : undefined;
  const pagination = root?.pagination as { total?: number } | undefined;
  const totalFromRoot = typeof root?.total === 'number' ? root.total : undefined;
  const raw = unwrapResults<unknown>(res);
  if (Array.isArray(raw)) {
    return { list: raw as T[], total: pagination?.total ?? totalFromRoot ?? raw.length };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const items = Array.isArray(obj.items) ? obj.items : Array.isArray(obj.list) ? obj.list : [];
    const total = pagination?.total ?? totalFromRoot ?? (typeof obj.total === 'number' ? obj.total : items.length);
    return { list: items as T[], total };
  }
  return { list: [], total: 0 };
}

function unwrapList(res: unknown): unknown[] {
  const raw = unwrapResults<unknown>(res);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.types)) return obj.types;
    if (Array.isArray(obj.list)) return obj.list;
  }
  return [];
}

export function eventLabel(ev: ProductEvent) {
  return ev.name_zh || ev.name || ev.label || ev.name_en || ev.event_key;
}

export function normalizeProductEvents(res: unknown): ProductEvent[] {
  return unwrapList(res)
    .map((item) => {
      if (typeof item === 'string') return { event_key: item };
      const row = item as Record<string, unknown>;
      const event_key = String(row.event_key || row.key || row.event || row.strategy_type || row.id || '');
      if (!event_key) return null;
      const senderRaw = row.sender_mode != null ? String(row.sender_mode) : '';
      return {
        event_key,
        name_zh: row.name_zh != null ? String(row.name_zh) : row.label_zh != null ? String(row.label_zh) : undefined,
        name_en: row.name_en != null ? String(row.name_en) : row.label_en != null ? String(row.label_en) : undefined,
        name: row.name != null ? String(row.name) : undefined,
        label: row.label != null ? String(row.label) : undefined,
        sender_mode: senderRaw || undefined,
      } as ProductEvent;
    })
    .filter((item): item is ProductEvent => Boolean(item));
}

export function normalizeLangOptions(res: unknown): { value: string; label: string }[] {
  const raw = unwrapResults<unknown>(res) ?? res;
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = [obj.options, obj.items, obj.language_options, obj.languages, obj.list].find(Array.isArray);
    list = (candidate as unknown[]) || [];
  }
  if (!list.length) return CONTENT_LANGS;
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
      const label = String(row.label || row.name || row.name_zh || value);
      return { value, label };
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));
  return options.length ? options : CONTENT_LANGS;
}

export function normalizeCompanion(row: ContentCompanion | CompanionItem | Record<string, unknown>): ContentCompanion {
  const r = row as ContentCompanion & CompanionItem;
  if (r.profile?.id) {
    return {
      ...r,
      id: r.profile.id,
      name: r.profile.name,
      gender: r.profile.gender,
      age: r.profile.age,
      city: r.profile.city,
      language: r.profile.language,
      tier: r.profile.tier,
      is_deleted: r.is_deleted ?? r.profile.is_deleted,
      created_at: r.created_at || r.profile.created_at,
      avatar_url: r.avatar_url || r.avatar,
      description: r.description || r.profile.description,
      appearance: r.appearance || r.profile.appearance,
      mbti: r.mbti || r.profile.mbti,
      life_story: r.life_story || r.profile.life_story,
      cultural_values: r.cultural_values || r.profile.cultural_values,
      gender_perspective: r.gender_perspective || r.profile.gender_perspective,
      country: r.country || r.profile.country,
      region_key: r.region_key || r.profile.region_key,
      region_label: r.region_label || r.profile.region_label,
      moderation_status: r.moderation_status || r.profile.moderation_status,
      profile_backgrounds:
        r.profile_backgrounds ||
        r.profile.profile_backgrounds ||
        [],
      personality: r.personality || r.profile.personality,
      sexual_orientation: r.sexual_orientation || r.profile.sexual_orientation,
      background: r.background || r.profile.background,
      speech_style: r.speech_style || r.profile.speech_style,
      hobbies: r.hobbies || r.profile.hobbies,
      values: r.values || r.profile.values,
      fears: r.fears || r.profile.fears,
      love_view: r.love_view || r.profile.love_view,
      daily_routine: r.daily_routine || r.profile.daily_routine,
      favorite_things: r.favorite_things || r.profile.favorite_things,
    };
  }
  return {
    ...(r as ContentCompanion),
    id: String(r.id || ''),
    avatar_url: r.avatar_url || r.avatar,
  };
}
