/**
 * @file appListScroll.js
 * @description App 列表分页共用。
 *
 * App scroll-view 坑：
 * - 长期绑 :scroll-top="0" 或解绑 scroll-top → 列表一变长会闪回顶部
 * - 短列表无溢出也会误触 scrolltolower
 * - 接口 pagination.page 常钉死在 1
 *
 * load-more 正确做法：
 * - 不要绑 :scroll-top / 不要 scroll-into-view 强行钉位（会整段跳、不自然）
 * - 用 push 追加，让系统保持当前视口，新内容在下方，滑到再看
 */
import { reactive } from "vue";
import { isScrollNearBottom } from "@/utils/scrollNearBottom";
import { companionPageHasMore } from "@/utils/companionsCache";

/** 初始化可视高度兜底（减去顶栏/Tab 大约值） */
export function initListViewHeight(offset = 160) {
  try {
    const sys = uni.getSystemInfoSync();
    return Math.max(400, (sys.windowHeight || 600) - offset);
  } catch {
    return 600;
  }
}

export function measureListViewHeight(selector, onHeight) {
  try {
    uni
      .createSelectorQuery()
      .select(selector)
      .boundingClientRect((rect) => {
        const h = Number(rect?.height) || 0;
        if (h > 0) onHeight(h);
      })
      .exec();
  } catch {
    /* ignore */
  }
}

/**
 * 是否该翻页 / 是否可解锁贴底锁。
 * @returns {{ load: boolean, unlock: boolean, scrollTop: number, scrollHeight: number }}
 */
export function inspectListScroll(detail, viewHeight, { hasMore, busy, latched }) {
  const scrollTop = Number(detail?.scrollTop) || 0;
  const scrollHeight = Number(detail?.scrollHeight) || 0;
  const near = isScrollNearBottom(detail, viewHeight);
  if (near) {
    const overflows = !(scrollHeight > 0 && scrollHeight <= viewHeight + 24);
    const load = !latched && !busy && Boolean(hasMore) && overflows;
    return { load, unlock: false, scrollTop, scrollHeight };
  }
  return { load: false, unlock: !busy, scrollTop, scrollHeight };
}

/** 请求页码为准，不要信接口回写的 pagination.page（常钉死在 1） */
export function nextListPage(reset, currentPage) {
  return reset ? 1 : Number(currentPage || 0) + 1;
}

/**
 * 合并分页 hasMore：空追加 / 不足一页立即停。
 * @param {{ batch: any[], pagination?: object, pageSize: number, appendedCount: number, isReset: boolean, emptyAppendStops?: boolean }} p
 */
export function resolveListHasMore({
  batch,
  pagination,
  pageSize,
  appendedCount,
  isReset,
  emptyAppendStops = true,
}) {
  let more = companionPageHasMore(batch, pagination, pageSize);
  const len = Array.isArray(batch) ? batch.length : 0;
  if (!isReset) {
    if (emptyAppendStops && appendedCount <= 0) return false;
    if (len < pageSize) return false;
  } else if (len < pageSize) {
    return false;
  }
  return Boolean(more);
}

/**
 * 按 id 追加去重（返回新数组）。
 * @returns {{ list: any[], appendedCount: number, added: any[] }}
 */
export function appendUniqueById(prev, next, getId = (x) => String(x?.id ?? "")) {
  const seen = new Set((prev || []).map((x) => getId(x)).filter(Boolean));
  const added = [];
  for (const item of next || []) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    added.push(item);
  }
  return {
    list: added.length ? [...(prev || []), ...added] : prev || [],
    appendedCount: added.length,
    added,
  };
}

/**
 * 就地 push 去重追加（减少整表替换导致的回顶）。
 * @returns {{ appendedCount: number, added: any[] }}
 */
export function pushUniqueById(listRef, next, getId = (x) => String(x?.id ?? "")) {
  const seen = new Set((listRef.value || []).map((x) => getId(x)).filter(Boolean));
  const added = [];
  for (const item of next || []) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    added.push(item);
  }
  if (added.length) listRef.value.push(...added);
  return { appendedCount: added.length, added };
}

/**
 * 列表滚动状态：只做贴底判断，不主动改滚动位置。
 */
export function createListScrollGuard() {
  const pin = reactive({
    lastScrollTop: 0,
    lastScrollHeight: 0,
    noteScroll(detail) {
      const d = detail || {};
      if (d.scrollTop != null) pin.lastScrollTop = Number(d.scrollTop) || 0;
      const sh = Number(d.scrollHeight);
      if (sh > 0) pin.lastScrollHeight = sh;
    },
    contentOverflows(viewHeight) {
      return pin.lastScrollHeight <= 0 || pin.lastScrollHeight > viewHeight + 24;
    },
  });
  return pin;
}

/** @deprecated 兼容旧名，等同 createListScrollGuard */
export function createListAnchorPin() {
  return createListScrollGuard();
}
