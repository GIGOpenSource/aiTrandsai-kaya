/**
 * @file firebaseAnalytics.js
 * @description Firebase Analytics 业务封装（仅 App；H5 为 no-op）。
 *
 * 埋点规范（Android / iOS 一致，参数均为 string）：
 *
 * 1. login — 用户登录
 *    参数：device、uid、method、以及投放归因 gclid + utm_*
 *
 * 2. register_success — 用户注册成功
 *    参数：device、uid、method、以及投放归因 gclid + utm_*
 *
 * 3. purchase_success — 支付成功
 *    参数：device、uid、method、product、以及投放归因 gclid + utm_*
 *
 * 原生插件：uni_modules/trands-firebase-analytics（需已打进自定义基座/云打包）。
 * logEvent 参数在 JS 层 JSON.stringify，iOS/Android 原生解析 JSON 字符串（避免桥接丢参）。
 *
 * 调用处：
 * - App.vue → configureFirebaseAnalytics()
 * - pages/login/* → trackLoginSuccess()
 * - pages/register/step.vue → trackRegisterSuccess()
 * - components/AppRechargeModal.vue → trackPurchaseSuccess()
 */

// #ifdef APP-PLUS
import {
  configure as nativeConfigure,
  logEvent as nativeLogEvent,
  setUserId as nativeSetUserId,
  setUserProperty as nativeSetUserProperty,
  setAnalyticsCollectionEnabled as nativeSetCollectionEnabled,
} from "@/uni_modules/trands-firebase-analytics";
// #endif
import { getItem } from "@/utils/storage";
import {
  buildAuthEventParams,
  buildPurchaseEventParams,
  readCurrentUserId,
  normalizeAnalyticsEventParams,
} from "@/utils/analyticsEventParams";
import { resolveFirebaseEventName, getAppEnv, isTestEnv } from "@/utils/env";

let ready = false;

function applyUserId(user = null) {
  const uid = readCurrentUserId(user);
  if (uid) {
    setUserId(uid);
  }
  return uid;
}

function withCurrentUserId(params = null, user = null) {
  const payload =
    params && typeof params === "object" && !Array.isArray(params)
      ? { ...params }
      : {};
  if (!payload.uid) {
    const uid = readCurrentUserId(user);
    if (uid) {
      payload.uid = uid;
    }
  }
  return Object.keys(payload).length ? payload : null;
}

function isAppNative() {
  // #ifdef APP-PLUS
  try {
    const p = String(uni.getSystemInfoSync()?.platform || "").toLowerCase();
    return p === "android" || p === "ios";
  } catch {
    return false;
  }
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}

/** 初始化（可重复调用） */
export function configureFirebaseAnalytics() {
  // #ifdef APP-PLUS
  if (!isAppNative()) return false;
  try {
    if (typeof nativeConfigure !== "function") {
      ready = false;
      console.warn(
        "[FirebaseAnalytics] native configure missing — UTS module not linked (offline: check trands-firebase-analytics IndexKt in APK)"
      );
      return false;
    }
    ready = !!nativeConfigure();
    if (ready) {
      try {
        nativeSetCollectionEnabled(true);
      } catch {
        /* ignore */
      }
      try {
        // 便于 DebugView / BigQuery 按环境过滤（与事件名前缀互补）
        nativeSetUserProperty("app_env", getAppEnv());
      } catch {
        /* ignore */
      }
      if (isTestEnv()) {
        console.log("[FirebaseAnalytics] test env: event names prefixed with test_");
      }
    } else {
      console.warn(
        "[FirebaseAnalytics] configure returned false (ready=false) — events will be dropped; backend dual-write may still succeed"
      );
    }
    return ready;
  } catch (e) {
    console.error("[FirebaseAnalytics] configure failed", e);
    ready = false;
    return false;
  }
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}

function normalizeEventParams(params = null) {
  return normalizeAnalyticsEventParams(params);
}

/**
 * @param {string} name 业务事件名（勿手动加 test_；测试环境由 resolveFirebaseEventName 处理）
 * @param {Record<string, string|number|boolean>|null} [params]
 */
export function logEvent(name, params = null) {
  if (!name) return;
  // #ifdef APP-PLUS
  if (!isAppNative()) return;
  try {
    if (!ready) configureFirebaseAnalytics();
    if (!ready) {
      console.warn(
        "[FirebaseAnalytics] skip logEvent (ready=false):",
        name,
        "— look for native [trands-firebase-analytics] logs"
      );
      return;
    }
    const eventName = resolveFirebaseEventName(name);
    const payload = normalizeEventParams(withCurrentUserId(params));
    const paramsJson = payload ? JSON.stringify(payload) : null;
    nativeLogEvent(eventName, paramsJson);
  } catch (e) {
    console.error("[FirebaseAnalytics] logEvent failed", name, e);
  }
  // #endif
}

/** @param {string|null} userId */
export function setUserId(userId) {
  // #ifdef APP-PLUS
  if (!isAppNative()) return;
  try {
    if (!ready) configureFirebaseAnalytics();
    if (!ready) return;
    nativeSetUserId(userId == null || userId === "" ? null : String(userId));
  } catch (e) {
    console.error("[FirebaseAnalytics] setUserId failed", e);
  }
  // #endif
}

/** @param {string} name @param {string|null} value */
export function setUserProperty(name, value) {
  if (!name) return;
  // #ifdef APP-PLUS
  if (!isAppNative()) return;
  try {
    if (!ready) configureFirebaseAnalytics();
    if (!ready) return;
    nativeSetUserProperty(
      String(name),
      value == null || value === "" ? null : String(value)
    );
  } catch (e) {
    console.error("[FirebaseAnalytics] setUserProperty failed", e);
  }
  // #endif
}

/** @param {boolean} enabled */
export function setAnalyticsCollectionEnabled(enabled) {
  // #ifdef APP-PLUS
  if (!isAppNative()) return;
  try {
    if (!ready) configureFirebaseAnalytics();
    if (!ready) return;
    nativeSetCollectionEnabled(!!enabled);
  } catch (e) {
    console.error("[FirebaseAnalytics] setAnalyticsCollectionEnabled failed", e);
  }
  // #endif
}

/**
 * 登录成功：login(device, uid, method)
 * method: google | apple | email
 */
export function trackLoginSuccess(opts = {}) {
  applyUserId(opts.user || null);
  logEvent("login", buildAuthEventParams({ method: opts.method, user: opts.user }));
}

/**
 * 注册成功：register_success(device, uid, method=email)
 */
export function trackRegisterSuccess(opts = {}) {
  applyUserId(opts.user || null);
  logEvent(
    "register_success",
    buildAuthEventParams({ method: opts.method || "email", user: opts.user })
  );
}

/**
 * 支付成功：purchase_success(device, uid, method, product)
 * method: vip | points；product: VIP 套餐 key 或积分数
 * @param {{ type?: 'vip'|'points', product?: string|number }} [opts]
 */
export function trackPurchaseSuccess(opts = {}) {
  logEvent("purchase_success", buildPurchaseEventParams(opts));
}
