/**
 * @file useListVirtualWindow.js
 * @description 通用长列表虚拟窗口（估算行高 + overscan）。
 * 默认阈值较高，短列表不启用，避免滚动/回顶手感变化。
 */
import { computed } from "vue";

/**
 * @param {object} opts
 * @param {import('vue').Ref|import('vue').ComputedRef} opts.rows
 * @param {import('vue').Ref<number>} opts.scrollTop
 * @param {import('vue').Ref<number>} opts.viewHeight
 * @param {number} [opts.rowHeight=160] 估算行高 px
 * @param {number} [opts.overscan=8]
 * @param {number} [opts.threshold=80] 超过该条数才启用
 */
export function useListVirtualWindow({
  rows,
  scrollTop,
  viewHeight,
  rowHeight = 160,
  overscan = 8,
  threshold = 80,
}) {
  const enabled = computed(() => (rows.value?.length || 0) > threshold);

  const range = computed(() => {
    const list = rows.value || [];
    if (!enabled.value) return { start: 0, end: list.length };
    const top = Math.max(0, scrollTop.value || 0);
    const h = viewHeight.value || 600;
    const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
    const end = Math.min(
      list.length,
      Math.ceil((top + h) / rowHeight) + overscan
    );
    return { start, end };
  });

  const slice = computed(() => {
    const list = rows.value || [];
    return enabled.value ? list.slice(range.value.start, range.value.end) : list;
  });

  const topPad = computed(() =>
    enabled.value ? range.value.start * rowHeight : 0
  );
  const bottomPad = computed(() =>
    enabled.value
      ? Math.max(0, (rows.value?.length || 0) - range.value.end) * rowHeight
      : 0
  );

  return { enabled, slice, topPad, bottomPad };
}
