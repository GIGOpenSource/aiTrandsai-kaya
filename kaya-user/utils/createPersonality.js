/**
 * 创建页性格标签：本地目录、折叠展示、互斥对（与 Vue 无关）。
 */
import {
  getPersonalityKey,
  personalityMeta,
  personalityTagTranslations,
} from "@/utils/personalityTags";

export function toPersonalityKey(tagOrKey) {
  return getPersonalityKey(tagOrKey) || String(tagOrKey || "").trim();
}

export function buildLocalPersonalityCatalog(lang) {
  const map = personalityTagTranslations[lang] || personalityTagTranslations.zh || {};
  const keys = Object.keys(personalityMeta || {}).length
    ? Object.keys(personalityMeta)
    : Object.keys(map);
  return keys
    .filter((key) => map[key])
    .map((key) => ({
      key,
      label: map[key],
      bucket: personalityMeta[key]?.bucket || "neutral",
      group: personalityMeta[key]?.group || "style",
    }));
}

/** 目录里没有的 key（一键生成/回填）补成可展示项 */
export function makePersonalityCatalogItem(key) {
  const k = toPersonalityKey(key);
  if (!k) return null;
  return {
    key: k,
    label: k,
    bucket: personalityMeta[k]?.bucket || "neutral",
    group: personalityMeta[k]?.group || "style",
  };
}

export function filterVisiblePersonalityItems(
  items,
  featuredKeys,
  selectedKeys,
  showAll,
  extraKeys = []
) {
  const list = items || [];
  const byKey = new Map(list.map((i) => [i.key, i]));
  const keepKeys = [
    ...new Set([...(selectedKeys || []), ...(extraKeys || [])]),
  ].filter(Boolean);

  for (const k of keepKeys) {
    if (!byKey.has(k)) {
      const item = makePersonalityCatalogItem(k);
      if (item) byKey.set(k, item);
    }
  }

  const ordered = [...list];
  const seenList = new Set(list.map((i) => i.key));
  for (const k of keepKeys) {
    const item = byKey.get(k);
    if (item && !seenList.has(item.key)) {
      ordered.push(item);
      seenList.add(item.key);
    }
  }

  if (showAll || !featuredKeys?.length) return ordered;

  const featuredItems = featuredKeys
    .map((k) => byKey.get(k))
    .filter(Boolean);
  const seen = new Set(featuredItems.map((i) => i.key));
  for (const k of keepKeys) {
    const item = byKey.get(k);
    if (item && !seen.has(item.key)) {
      featuredItems.push(item);
      seen.add(item.key);
    }
  }
  return featuredItems.length ? featuredItems : ordered.slice(0, 24);
}

export function findPersonalityMutexPair(keys, mutexPairs) {
  const set = new Set(keys);
  for (const pair of mutexPairs || []) {
    const [a, b] = pair;
    if (set.has(a) && set.has(b)) return [a, b];
  }
  return null;
}
