/**
 * H5 scroll-view 的 @scrolltolower 经常只触发一次。
 * 滚动过程中用这个判断是否贴近底部，用来补触发分页。
 *
 * App 端 scroll 事件常缺 clientHeight；若用整窗高度兜底，短列表
 * （内容撑不满一屏）会在 scrollTop=0 时也被判成贴底，连环 load-more。
 * 因此：内容未明显超出可视区时一律不算贴底。
 */
export function isScrollNearBottom(detail, viewHeight = 0, pad = 180) {
  if (!detail) return false;
  const top = Number(detail.scrollTop) || 0;
  const scrollHeight = Number(detail.scrollHeight) || 0;
  if (scrollHeight <= 0) return false;
  let viewH = Number(detail.clientHeight) || Number(viewHeight) || 0;
  if (!viewH) {
    try {
      viewH = Math.max(400, (uni.getSystemInfoSync()?.windowHeight || 600) - 140);
    } catch {
      viewH = 600;
    }
  }
  // 内容没超出可视区：没有「下一页」可滑，禁止伪贴底
  if (scrollHeight <= viewH + 24) return false;
  return top + viewH >= scrollHeight - pad;
}

/** 横向 scroll-view 是否贴近右缘（继续往左滑看更多） */
export function isScrollNearRight(detail, viewWidth = 0, pad = 80) {
  if (!detail) return false;
  const left = Number(detail.scrollLeft) || 0;
  const scrollWidth = Number(detail.scrollWidth) || 0;
  if (scrollWidth <= 0) return false;
  let viewW = Number(detail.clientWidth) || Number(viewWidth) || 0;
  if (!viewW) {
    try {
      viewW = uni.getSystemInfoSync()?.windowWidth || 375;
    } catch {
      viewW = 375;
    }
  }
  if (scrollWidth <= viewW + 24) return false;
  return left + viewW >= scrollWidth - pad;
}
