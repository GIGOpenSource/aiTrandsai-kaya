/**
 * @file tabScroll.js
 * @description Tab 页滚动状态 — 供 TabBar「当前 Tab 再点一次回顶」使用（对齐 React TabBar）。
 * scrollTops 记录各 Tab 滚动位置；requestScrollToTop 递增 tick 通知页面回顶。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export const useTabScrollStore = defineStore("tabScroll", () => {
  /** path → 当前 scrollTop */
  const scrollTops = ref({});
  /** path → 递增计数；页面 watch 后执行回顶 */
  const scrollToTopTick = ref({});

  /** 记录某 Tab 当前滚动位置 */
  function setScroll(path, top) {
    scrollTops.value[path] = top;
  }

  /** 离开 Tab 时清零，避免误判「已滚动」 */
  function resetScroll(path) {
    scrollTops.value[path] = 0;
  }

  /** 通知该 Tab 页面滚到顶部（tick++） */
  function requestScrollToTop(path) {
    scrollToTopTick.value[path] = (scrollToTopTick.value[path] || 0) + 1;
  }

  /**
   * 是否已滚过阈值（默认 200px），用于 Tab 图标切「回顶」
   * @param {string} path
   * @param {number} [threshold=200]
   */
  function isScrolled(path, threshold = 200) {
    return (scrollTops.value[path] || 0) > threshold;
  }

  return {
    scrollTops,
    scrollToTopTick,
    setScroll,
    resetScroll,
    requestScrollToTop,
    isScrolled,
  };
});
