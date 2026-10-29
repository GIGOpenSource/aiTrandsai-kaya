/**
 * @file push.js
 * @description App 端系统推送：申请权限、获取 token/cid、上报服务端。
 * H5 不支持 OS 推送，调用会安全 no-op。
 *
 * 注意：manifest 未启用 Push / UniPush 模块时，本文件全部 no-op，
 * 避免无产品能力时申请 POST_NOTIFICATIONS（影响 Play 权限声明）。
 *
 * provider 约定：
 * - unipush：uni.getPushClientId（需 manifest 开启 Push / UniPush）
 * - fcm / apns：原生插件拿到的设备 token（若后续接入 Firebase 插件）
 */
import { getItem } from "./storage";
import { deviceHeaders, getDeviceId, getAppVersion } from "./device";
import apiFetch from "./api";

function isAppPlus() {
  // #ifdef APP-PLUS
  return true;
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}

/** Push 模块是否可用（manifest 未开 Push 时为 false） */
function isPushModuleAvailable() {
  if (!isAppPlus()) return false;
  try {
    return typeof uni.getPushClientId === "function";
  } catch {
    return false;
  }
}

function detectPlatform() {
  try {
    const info = uni.getSystemInfoSync?.() || {};
    const p = String(info.platform || "").toLowerCase();
    if (p === "ios") return "ios";
    if (p === "android") return "android";
  } catch {
    /* ignore */
  }
  return "android";
}

/**
 * 请求通知权限（Android 13+ / iOS）
 * @returns {Promise<boolean>}
 */
export function requestNotificationPermission() {
  if (!isPushModuleAvailable()) return Promise.resolve(false);

  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    try {
      const sys = uni.getSystemInfoSync?.() || {};
      const platform = String(sys.platform || "").toLowerCase();

      if (platform === "android") {
        // Android 13+ POST_NOTIFICATIONS
        const main = plus.android.runtimeMainActivity();
        const Build = plus.android.importClass("android.os.Build");
        if (Build.VERSION.SDK_INT >= 33) {
          plus.android.requestPermissions(
            ["android.permission.POST_NOTIFICATIONS"],
            (e) => {
              const granted =
                (e.granted && e.granted.length > 0) ||
                (e.deniedAlways || []).length === 0;
              resolve(!!granted);
            },
            () => resolve(false)
          );
          return;
        }
        resolve(true);
        return;
      }

      // iOS：通过 push 客户端触发系统授权弹窗
      uni.getPushClientId({
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    } catch (e) {
      console.warn("[push] permission error", e);
      resolve(false);
    }
    // #endif
    // #ifndef APP-PLUS
    resolve(false);
    // #endif
  });
}

/**
 * 获取推送标识：优先 UniPush clientId
 * @returns {Promise<{ token: string, provider: string }|null>}
 */
export function getPushIdentity() {
  if (!isPushModuleAvailable()) return Promise.resolve(null);

  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    try {
      uni.getPushClientId({
        success: (res) => {
          const cid = res?.cid || res?.clientid || "";
          if (cid) resolve({ token: String(cid), provider: "unipush" });
          else resolve(null);
        },
        fail: () => resolve(null),
      });
    } catch (e) {
      console.warn("[push] getPushIdentity error", e);
      resolve(null);
    }
    // #endif
    // #ifndef APP-PLUS
    resolve(null);
    // #endif
  });
}

/**
 * 上报 token 到服务端（需已登录）
 */
export async function registerPushTokenWithServer() {
  const token = getItem("user_token");
  if (!token || !isPushModuleAvailable()) return { ok: false, reason: "skip" };

  await requestNotificationPermission();
  const identity = await getPushIdentity();
  if (!identity?.token) return { ok: false, reason: "no_token" };

  try {
    const res = await apiFetch("/api/devices/push-token", {
      method: "POST",
      header: {
        ...deviceHeaders(),
        "Content-Type": "application/json",
        "x-token": token,
      },
      body: JSON.stringify({
        token: identity.token,
        platform: detectPlatform(),
        provider: identity.provider,
        device_id: getDeviceId(),
        app_version: getAppVersion(),
      }),
    });
    return { ok: true, ...(res || {}) };
  } catch (e) {
    console.warn("[push] register failed", e);
    return { ok: false, reason: "api_error" };
  }
}

/**
 * 登录后 / App 回到前台时调用
 */
export function setupPushIfLoggedIn() {
  try {
    if (!isPushModuleAvailable()) return;
    if (!getItem("user_token")) return;
    // 不阻塞启动
    setTimeout(() => {
      void registerPushTokenWithServer();
    }, 1500);
  } catch {
    /* ignore */
  }
}
