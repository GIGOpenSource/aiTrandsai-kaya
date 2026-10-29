/**
 * @file useAuth.js
 * @description 登录态工具：判断是否登录、强制跳转、读取当前用户 ID。
 * 不持有响应式状态；页面在 onMounted / 提交前调用即可。
 * @depends storage.js、device.js（re-export getDeviceId）
 */

import { getItem, setItem, removeItem } from "@/utils/storage";

/** 设备 ID 从 device 再导出，方便页面一次性从 useAuth 引入 */
export { getDeviceId } from "@/utils/device";

/** 性别弹窗曝光用：new=刚注册，existing=存量无性别 */
const GENDER_SELECT_USER_TYPE_KEY = "gender_select_user_type";

/** 标记下次性别选择页的 user_type（注册成功写 new） */
export function markGenderSelectUserType(type) {
  if (type !== "new" && type !== "existing") return;
  try {
    setItem(GENDER_SELECT_USER_TYPE_KEY, type);
  } catch {
    /* ignore */
  }
}

/** 读取性别选择页 user_type，默认 existing */
export function peekGenderSelectUserType() {
  try {
    return getItem(GENDER_SELECT_USER_TYPE_KEY) === "new" ? "new" : "existing";
  } catch {
    return "existing";
  }
}

/** 性别提交成功后清掉标记 */
export function clearGenderSelectUserType() {
  try {
    removeItem(GENDER_SELECT_USER_TYPE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 是否已登录（以本地 user_token 为准）
 * @returns {boolean}
 */
export function isLoggedIn() {
  return Boolean(getItem("user_token"));
}

/**
 * 要求已登录；否则 reLaunch 到登录页。
 * 缺性别不在这里跳转（setup 时路由常未就绪，reLaunch 会打断首页加载）；
 * 由首页弹窗补选，见 AppGenderSelectModal。
 * @returns {boolean} true=已登录可继续；false=已跳转
 */
export function requireAuth() {
  if (!isLoggedIn()) {
    uni.reLaunch({ url: "/pages/login/index" });
    return false;
  }
  return true;
}

/**
 * 已登录则离开登录/注册页，进入首页（防重复登录）
 */
export function redirectIfLoggedIn() {
  if (isLoggedIn()) {
    goAfterAuth();
  }
}

function readUserInfo() {
  try {
    const raw = getItem("user_info");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 本地资料是否已有性别（新用户登录/注册后要补选） */
export function hasUserGender(user) {
  const src = user && typeof user === "object" ? user : readUserInfo();
  return Boolean(String(src?.gender ?? "").trim());
}

/** 旧引导页入口保留（pages/register/step?mode=gender），现默认改走首页弹窗 */
export const GENDER_ONBOARDING_URL = "/pages/register/step?mode=gender";

/** 登录/注册成功：统一进首页；缺性别由首页强制弹窗补选 */
export function goAfterAuth(_user) {
  uni.reLaunch({ url: "/pages/home/index" });
}

/**
 * 从 user_info JSON 读取用户数字 ID
 * @returns {number|string|null}
 */
export function isGuestUser(user) {
  const src = user && typeof user === "object" ? user : readUserInfo();
  if (!src) return false;
  if (src.is_guest === true) return true;
  return String(src.platform || "").toLowerCase() === "guest";
}

export function canUserPay(user) {
  const src = user && typeof user === "object" ? user : readUserInfo();
  if (!src) return true;
  if (src.can_pay === false) return false;
  if (isGuestUser(src)) return false;
  return true;
}

export function getCurrentUserId() {
  const infoStr = getItem("user_info");
  if (!infoStr) return null;
  try {
    const info = JSON.parse(infoStr);
    return info.id ?? info.user_id ?? null;
  } catch {
    return null;
  }
}
