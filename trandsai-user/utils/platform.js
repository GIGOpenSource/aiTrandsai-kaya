/**
 * @file platform.js
 * @description 设备平台单独缓存，避免被 user_info 更新覆盖。
 */

const PLATFORM_KEY = "device_platform";

/**
 * 缓存设备平台
 * @param {string} platform
 */
export function setPlatform(platform) {
  if (platform) {
    try {
      uni.setStorageSync(PLATFORM_KEY, platform);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 获取缓存的设备平台
 * @returns {string}
 */
export function getPlatform() {
  try {
    return uni.getStorageSync(PLATFORM_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * 获取后端接口需要的 platform 参数值
 * @returns {string}
 */
export function getApiPlatform() {
  const platform = getPlatform().toLowerCase();
  if (platform === "ios" || platform === "mac") return "apple";
  if (platform === "android") return "google";
  return platform || "apple";
}
