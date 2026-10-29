/**
 * @file navigation.js
 * @description 主导航辅助。项目使用自定义 TabBar（pages.json 无原生 tabBar），
 * 禁止对主 Tab 使用 uni.switchTab（会失败）。
 */

/** 主 Tab 路径 */
export const MAIN_TAB_PATHS = [
  "/pages/home/index",
  "/pages/messages/index",
  "/pages/discover/index",
  "/pages/profile/index",
];

/**
 * 回到主 Tab（与 AppTabBar 一致：redirectTo，失败再 reLaunch）
 * @param {string} url 如 /pages/home/index
 */
export function goMainTab(url) {
  const path = url?.startsWith("/") ? url : `/${url}`;
  uni.redirectTo({
    url: path,
    fail: () => uni.reLaunch({ url: path }),
  });
}

/**
 * navigateBack；失败则回指定主 Tab（或首页）
 * @param {string} [fallbackTab=/pages/home/index]
 */
export function navigateBackOrMainTab(fallbackTab = "/pages/home/index") {
  uni.navigateBack({
    fail: () => goMainTab(fallbackTab),
  });
}
