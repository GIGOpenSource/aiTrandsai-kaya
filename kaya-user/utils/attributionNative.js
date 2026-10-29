/**
 * @file attributionNative.js
 * @description 原生归因信号读取（GAID / IDFA / Install Referrer），H5 为 no-op。
 */

// #ifdef APP-PLUS
import {
  getAdvertisingInfo as nativeGetAdvertisingInfo,
  getIdfv as nativeGetIdfv,
  getAndroidId as nativeGetAndroidId,
  prefetchInstallReferrer as nativePrefetchInstallReferrer,
  getInstallReferrer as nativeGetInstallReferrer,
  isInstallReferrerReady as nativeIsInstallReferrerReady,
  requestTrackingAuthorization as nativeRequestTrackingAuthorization,
  getTrackingAuthorizationStatus as nativeGetTrackingAuthorizationStatus,
  consumeTrackingAuthorizationResult as nativeConsumeTrackingAuthorizationResult,
} from "@/uni_modules/trands-attribution";
// #endif

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

function isAndroidApp() {
  // #ifdef APP-PLUS
  try {
    return String(uni.getSystemInfoSync()?.platform || "").toLowerCase() === "android";
  } catch {
    return false;
  }
  // #endif
  return false;
}

function isIosApp() {
  // #ifdef APP-PLUS
  try {
    return String(uni.getSystemInfoSync()?.platform || "").toLowerCase() === "ios";
  } catch {
    return false;
  }
  // #endif
  return false;
}

function readNativeJsonField(obj, key) {
  if (!obj) return "";
  try {
    if (typeof obj === "object" && obj[key] != null) return String(obj[key]);
    if (typeof obj.getString === "function") {
      const v = obj.getString(key);
      if (v != null && String(v)) return String(v);
    }
  } catch {
    /* ignore */
  }
  return "";
}

function readNativeBoolField(obj, key) {
  const raw = readNativeJsonField(obj, key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  try {
    if (typeof obj?.getBoolean === "function") return !!obj.getBoolean(key);
  } catch {
    /* ignore */
  }
  return false;
}

/** @returns {{ ad_id: string, ad_id_type: 'idfa'|'gaid'|'none', limited: boolean }} */
export function readAdvertisingInfo() {
  const empty = { ad_id: "", ad_id_type: "none", limited: true };
  // #ifdef APP-PLUS
  if (!isAppNative()) return empty;
  try {
    if (typeof nativeGetAdvertisingInfo !== "function") return empty;
    const raw = nativeGetAdvertisingInfo();
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return empty;
      }
    }
    const ad_id = readNativeJsonField(parsed, "ad_id");
    const ad_id_type = readNativeJsonField(parsed, "ad_id_type") || "none";
    const limited = readNativeBoolField(parsed, "limited");
    if (!ad_id) return { ad_id: "", ad_id_type: "none", limited: true };
    return { ad_id, ad_id_type, limited };
  } catch (e) {
    console.warn("[attributionNative] readAdvertisingInfo failed", e);
    return empty;
  }
  // #endif
  return empty;
}

export function readIdfv() {
  // #ifdef APP-PLUS
  if (!isIosApp()) return "";
  try {
    return typeof nativeGetIdfv === "function" ? String(nativeGetIdfv() || "") : "";
  } catch {
    return "";
  }
  // #endif
  return "";
}

export function readAndroidId() {
  // #ifdef APP-PLUS
  if (!isAndroidApp()) return "";
  try {
    return typeof nativeGetAndroidId === "function" ? String(nativeGetAndroidId() || "") : "";
  } catch {
    return "";
  }
  // #endif
  return "";
}

export function startInstallReferrerPrefetch() {
  // #ifdef APP-PLUS
  if (!isAndroidApp()) return;
  try {
    if (typeof nativePrefetchInstallReferrer === "function") {
      nativePrefetchInstallReferrer();
    }
  } catch (e) {
    console.warn("[attributionNative] prefetchInstallReferrer failed", e);
  }
  // #endif
}

export function readInstallReferrer() {
  // #ifdef APP-PLUS
  if (!isAndroidApp()) return "";
  try {
    return typeof nativeGetInstallReferrer === "function"
      ? String(nativeGetInstallReferrer() || "")
      : "";
  } catch {
    return "";
  }
  // #endif
  return "";
}

export function isInstallReferrerReady() {
  // #ifdef APP-PLUS
  if (!isAndroidApp()) return true;
  try {
    return typeof nativeIsInstallReferrerReady === "function"
      ? !!nativeIsInstallReferrerReady()
      : true;
  } catch {
    return true;
  }
  // #endif
  return true;
}

export function getTrackingAuthorizationStatus() {
  // #ifdef APP-PLUS
  if (!isIosApp()) return "unknown";
  try {
    return typeof nativeGetTrackingAuthorizationStatus === "function"
      ? String(nativeGetTrackingAuthorizationStatus() || "unknown")
      : "unknown";
  } catch {
    return "unknown";
  }
  // #endif
  return "unknown";
}

export function requestTrackingAuthorization() {
  // #ifdef APP-PLUS
  if (!isIosApp()) return;
  try {
    if (typeof nativeRequestTrackingAuthorization === "function") {
      nativeRequestTrackingAuthorization();
    }
  } catch (e) {
    console.warn("[attributionNative] requestTrackingAuthorization failed", e);
  }
  // #endif
}

/** 等待 iOS ATT 弹窗结果（最多 timeoutMs） */
export function waitForTrackingAuthorization(timeoutMs = 12000) {
  // #ifdef APP-PLUS
  if (!isIosApp()) return Promise.resolve(getTrackingAuthorizationStatus());
  const intervalMs = 250;
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      let result = "";
      try {
        if (typeof nativeConsumeTrackingAuthorizationResult === "function") {
          result = String(nativeConsumeTrackingAuthorizationResult() || "");
        }
      } catch {
        /* ignore */
      }
      if (result) {
        clearInterval(timer);
        resolve(result);
        return;
      }
      const status = getTrackingAuthorizationStatus();
      if (status !== "notDetermined") {
        clearInterval(timer);
        resolve(status);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(getTrackingAuthorizationStatus());
      }
    }, intervalMs);
  });
  // #endif
  return Promise.resolve("unknown");
}

/** 等待 Android Install Referrer（最多 timeoutMs） */
export function waitForInstallReferrer(timeoutMs = 3000) {
  if (isInstallReferrerReady()) {
    return Promise.resolve(readInstallReferrer());
  }
  const intervalMs = 200;
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (isInstallReferrerReady() || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(readInstallReferrer());
      }
    }, intervalMs);
  });
}

/**
 * 采集原生归因信号（ATT / Referrer 需先 prefetch / request）
 * @returns {Promise<object>}
 */
export async function collectNativeAttributionSignals() {
  startInstallReferrerPrefetch();

  if (isIosApp()) {
    const status = getTrackingAuthorizationStatus();
    if (status === "notDetermined") {
      requestTrackingAuthorization();
      await waitForTrackingAuthorization();
    }
  }

  const playReferrer = await waitForInstallReferrer();
  const ad = readAdvertisingInfo();

  return {
    ad_id: ad.ad_id || undefined,
    ad_id_type: ad.ad_id ? ad.ad_id_type : "none",
    idfv: readIdfv() || undefined,
    android_id: readAndroidId() || undefined,
    play_referrer: playReferrer || undefined,
  };
}
