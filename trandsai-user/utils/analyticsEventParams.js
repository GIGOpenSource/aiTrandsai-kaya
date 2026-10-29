/**
 * @file analyticsEventParams.js
 * @description Firebase 与后端归因共用的业务事件参数字段（device/uid/method/product + gclid/utm_*）
 */

import { getItem } from "@/utils/storage";

const PENDING_ATTRIBUTION_KEY = "growth_pending_attribution";

const CAMPAIGN_ATTRIBUTION_KEYS = [
  "gclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

function readPendingAttributionRaw() {
  try {
    const raw = getItem(PENDING_ATTRIBUTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readPendingCampaignAttribution() {
  const pending = readPendingAttributionRaw();
  const out = {};
  for (const key of CAMPAIGN_ATTRIBUTION_KEYS) {
    const val = pending[key];
    if (val != null && val !== "") out[key] = String(val);
  }
  return out;
}

export function readCurrentUserId(user = null) {
  const directId = user?.id ?? user?.user_id ?? user?.uid ?? user?.userId ?? null;
  if (directId != null && String(directId)) {
    return String(directId);
  }
  try {
    const raw = getItem("user_info");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const storedId =
      parsed?.id ?? parsed?.user_id ?? parsed?.uid ?? parsed?.userId ?? null;
    return storedId != null && String(storedId) ? String(storedId) : "";
  } catch {
    return "";
  }
}

/** 设备：platform/model，如 ios/iPhone15,2、android/Pixel 7 */
export function readDevice() {
  try {
    const info = uni.getSystemInfoSync();
    const platform = String(info.platform || info.osName || "unknown").toLowerCase();
    const model = String(info.model || info.deviceModel || "").trim();
    if (model) return `${platform}/${model}`;
    return platform;
  } catch {
    return "unknown";
  }
}

function withCampaignAttribution(params = {}) {
  return { ...params, ...readPendingCampaignAttribution() };
}

/**
 * 登录 / 注册 Firebase 参数
 * @param {{ method?: string, user?: object|null }} [opts]
 */
export function buildAuthEventParams(opts = {}) {
  const method = opts.method ? String(opts.method) : "unknown";
  const device = readDevice();
  const uid = readCurrentUserId(opts.user || null);
  const params = withCampaignAttribution({ device, method });
  if (uid) {
    params.uid = uid;
  }
  return params;
}

/**
 * 支付 Firebase 参数
 * @param {{ type?: string, product?: string|number }} [opts]
 */
export function buildPurchaseEventParams(opts = {}) {
  const type = String(opts.type || "").toLowerCase();
  const method = type === "vip" || type === "points" ? type : "unknown";
  const product = String(opts.product ?? "");
  const device = readDevice();
  const uid = readCurrentUserId(null);
  const params = withCampaignAttribution({ device, method, product });
  if (uid) {
    params.uid = uid;
  }
  return params;
}

/** install 无对应 Firebase 事件，仅同步 device + 投放字段 */
export function buildInstallFirebaseStyleParams() {
  return withCampaignAttribution({ device: readDevice() });
}

/**
 * 产品行为埋点公共参数（device/uid + gclid/utm_* + 业务字段）
 * @param {Record<string, string|number|boolean>} [extra]
 */
export function buildProductEventParams(extra = {}) {
  const params = withCampaignAttribution({
    device: readDevice(),
    ...(extra && typeof extra === "object" ? extra : {}),
  });
  const uid = readCurrentUserId(null);
  if (uid) {
    params.uid = uid;
  }
  return params;
}

/** 去掉空值，与 Firebase normalize 一致 */
export function normalizeAnalyticsEventParams(params = null) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const out = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value == null || value === "") continue;
    out[key] = String(value);
  }
  return Object.keys(out).length ? out : null;
}
