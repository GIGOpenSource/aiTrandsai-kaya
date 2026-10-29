/**
 * @file useStatusBar.js
 * @description 状态栏 / 安全区尺寸，供 AppPageShell 与全屏页布局使用。
 * App 端依赖 manifest 沉浸式 statusbar；H5 多为 0，CSS 侧再用 env() 兜底。
 */

import { ref, onMounted } from "vue";

/** 稿面标题行高度（px），与 AppPageShell / theme --header-content-h 对齐 */
export const HEADER_CONTENT_PX = 58;

/** 模块级缓存，避免每页重复 getSystemInfoSync */
const cached = ref(null);

/**
 * 组合式：返回响应式安全区信息；挂载后再读一次以防首屏不准
 * @returns {import('vue').Ref}
 */
export function useStatusBar() {
  if (!cached.value) {
    cached.value = readSafeArea();
  }

  onMounted(() => {
    // 首屏/沉浸式页可能在 mount 前读到 0，强制再刷一次
    refreshSafeArea();
    setTimeout(() => {
      refreshSafeArea();
    }, 50);
  });

  return cached;
}

/** 强制刷新模块级安全区缓存（App 前台恢复 / 旋转后可调） */
export function refreshSafeArea() {
  cached.value = readSafeArea();
  return cached.value;
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function num(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 同步读取系统安全区与窗口高度
 * @returns {{
 *   statusBarHeight: number,
 *   safeAreaTop: number,
 *   safeAreaBottom: number,
 *   windowHeight: number,
 *   navBarHeight: number
 * }}
 */
export function readSafeArea() {
  try {
    let statusBarHeight = 0;
    let safeTop = 0;
    let safeBottom = 0;
    let windowHeight = 0;

    // 新 API 优先（App / 部分端更准）
    try {
      if (typeof uni.getWindowInfo === "function") {
        const w = uni.getWindowInfo();
        statusBarHeight = Math.max(statusBarHeight, num(w?.statusBarHeight));
        safeTop = Math.max(safeTop, num(w?.safeAreaInsets?.top));
        safeBottom = Math.max(safeBottom, num(w?.safeAreaInsets?.bottom));
        windowHeight = Math.max(windowHeight, num(w?.windowHeight));
      }
    } catch {
      /* ignore */
    }

    const sys = uni.getSystemInfoSync();
    statusBarHeight = Math.max(statusBarHeight, num(sys.statusBarHeight));
    const insets = sys.safeAreaInsets || {};
    safeTop = Math.max(safeTop, num(insets.top));
    safeBottom = Math.max(safeBottom, num(insets.bottom));
    // 部分端只有 safeArea.top，没有 safeAreaInsets
    if (sys.safeArea && typeof sys.safeArea.top === "number" && sys.screenHeight) {
      safeTop = Math.max(safeTop, num(sys.safeArea.top));
    }
    windowHeight = Math.max(windowHeight, num(sys.windowHeight));

    // 顶边取 statusBar 与 safe.top 较大值，覆盖刘海屏
    const safeAreaTop = Math.max(statusBarHeight, safeTop);
    // 手势条一般 < 48px。部分 WebView 弹键盘后把 IME 高度写进 inset-bottom，
    // 页面已经随 WebView 升高，再按这个值垫底就会顶出「两个键盘」高。
    const MAX_HOME_INDICATOR_PX = 48;
    if (safeBottom > MAX_HOME_INDICATOR_PX) {
      const prev = cached.value?.safeAreaBottom;
      safeBottom =
        Number.isFinite(prev) && prev > 0 && prev <= MAX_HOME_INDICATOR_PX
          ? prev
          : 0;
    }
    let navBarHeight = 44;
    // #ifdef MP
    navBarHeight = sys.titleBarHeight || 44;
    // #endif
    return {
      statusBarHeight,
      safeAreaTop,
      safeAreaBottom: safeBottom,
      windowHeight,
      navBarHeight,
    };
  } catch {
    return {
      statusBarHeight: 0,
      safeAreaTop: 0,
      safeAreaBottom: 0,
      windowHeight: 0,
      navBarHeight: 44,
    };
  }
}

/**
 * CSS 可消费的顶安全距：JS 实测 + env() 取大（uni-app 内联 style 可用）
 * @param {number} [topPx]
 * @returns {string}
 */
export function safeTopCss(topPx) {
  const top = Math.max(0, Number(topPx) || 0);
  return `max(${top}px, env(safe-area-inset-top, 0px))`;
}

/**
 * 生成页面内容区 padding / minHeight 样式对象
 * @param {boolean} [showTabBar=false] 是否预留自定义 TabBar 高度（56px）
 * @returns {Record<string, string>}
 */
export function pageContentStyle(showTabBar = false) {
  const info = readSafeArea();
  const tabH = showTabBar ? 56 : 0;
  return {
    paddingTop: `calc(${safeTopCss(info.safeAreaTop)} + ${HEADER_CONTENT_PX}px)`,
    paddingBottom: `${info.safeAreaBottom + tabH}px`,
    minHeight: `${info.windowHeight}px`,
  };
}
