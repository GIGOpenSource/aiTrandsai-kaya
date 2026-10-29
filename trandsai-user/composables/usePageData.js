/**
 * @file usePageData.js
 * @description 页面加载分层辅助：壳立即渲染，数据区按「缓存直出 → 后台刷新」。
 *
 * 用法：
 *   const { items, loading, refresh } = useCachedList({
 *     readCache: () => getCachedCompanions(params),
 *     fetchFresh: () => fetchCompanions(params, { force: true }),
 *     map: (raw) => ...,
 *   });
 */

import { ref, shallowRef } from "vue";

/**
 * 列表型页面的缓存优先加载。
 * @param {object} options
 * @param {() => any[]|null|undefined} [options.readCache] 同步读缓存
 * @param {() => Promise<any>} options.fetchFresh 网络拉取（应返回原始数据）
 * @param {(raw: any) => any[]} [options.map] 原始数据 → 列表项
 * @param {boolean} [options.immediate=true] 创建时是否立即 refresh
 * @returns {{ items: import('vue').Ref, loading: import('vue').Ref<boolean>, refresh: (opts?: { silent?: boolean }) => Promise<void>, hasCache: boolean }}
 */
export function useCachedList(options) {
  const { readCache, fetchFresh, map = (x) => (Array.isArray(x) ? x : []), immediate = true } =
    options;

  const cached = typeof readCache === "function" ? readCache() : null;
  const initial = cached != null ? map(cached) : [];
  const hasCache = Array.isArray(initial) && initial.length > 0;

  const items = shallowRef(initial);
  /** 仅在「无缓存可展示」时为 true，有缓存时后台刷新不挡 UI */
  const loading = ref(!hasCache);

  /**
   * @param {{ silent?: boolean }} [opts] silent=true 时不把 loading 置 true（用于 onShow 静默刷新）
   */
  async function refresh(opts = {}) {
    const silent = opts.silent ?? items.value.length > 0;
    if (!silent) loading.value = true;
    try {
      const raw = await fetchFresh();
      items.value = map(raw);
    } finally {
      loading.value = false;
    }
  }

  if (immediate) {
    // 不 await：让页面先画出壳与缓存
    refresh({ silent: hasCache });
  }

  return { items, loading, refresh, hasCache };
}

/**
 * 详情页：有缓存/占位则先展示，网络返回后替换。
 * @param {object} options
 * @param {() => any|null|undefined} [options.readCache]
 * @param {() => Promise<any>} options.fetchFresh
 * @returns {{ data: import('vue').Ref, loading: import('vue').Ref<boolean>, refresh: Function }}
 */
export function useCachedDetail(options) {
  const { readCache, fetchFresh } = options;
  const cached = typeof readCache === "function" ? readCache() : null;
  const data = ref(cached ?? null);
  const loading = ref(data.value == null);

  async function refresh(opts = {}) {
    const silent = opts.silent ?? data.value != null;
    if (!silent) loading.value = true;
    try {
      data.value = await fetchFresh();
    } finally {
      loading.value = false;
    }
  }

  refresh({ silent: data.value != null });

  return { data, loading, refresh };
}
