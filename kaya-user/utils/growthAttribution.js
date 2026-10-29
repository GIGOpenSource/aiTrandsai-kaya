/**
 * @file growthAttribution.js
 * @description 增长归因上报：POST /api/growth/attribution
 *
 * 与 Firebase 埋点并行，互不替代。
 * 调用处：
 * - App.vue → runGrowthAttributionOnLaunch()
 * - pages/register/step.vue → trackAttributionRegister()
 * - pages/login/* → trackAttributionLogin()
 * - components/AppRechargeModal.vue → trackAttributionPurchase()
 * - utils/firebaseProductAnalytics.js → reportProductAnalytics()（25 个产品行为埋点）
 */

import { rawFetch, unwrapApiResults } from "@/utils/api";
import { getAuthHeaders } from "@/utils/authHeaders";
import {
  getDeviceId,
  getAppMeta,
  getClientHeaders,
  setCachedStorefrontCountry,
} from "@/utils/device";
import { getItem, setItem, removeItem } from "@/utils/storage";
import { resolveStorefrontHeaders } from "@/utils/storefront";
import { collectNativeAttributionSignals } from "@/utils/attributionNative";
import {
  buildAuthEventParams,
  buildPurchaseEventParams,
  buildInstallFirebaseStyleParams,
  normalizeAnalyticsEventParams,
} from "@/utils/analyticsEventParams";
import {
  getAppEnv,
  resolveFirebaseEventName,
  canonicalProductEventName,
} from "@/utils/env";
import { APP_KEY } from "@/utils/appKey";

const INSTALL_SENT_KEY = "growth_install_sent";
const INSTALL_FAILED_KEY = "growth_install_failed";
const PENDING_ATTRIBUTION_KEY = "growth_pending_attribution";

/** 投放归因字段：Install Referrer / 深链解析后持久化，供 Firebase 与后端共用 */
export const CAMPAIGN_ATTRIBUTION_KEYS = [
  "gclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

let networkRetryBound = false;
let installReportInFlight = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNetworkTypeSync() {
  try {
    const type = String(uni.getSystemInfoSync()?.networkType || "").toLowerCase();
    return type || "none";
  } catch {
    return "none";
  }
}

function isNetworkAvailable() {
  const type = getNetworkTypeSync();
  return type !== "none" && type !== "unknown" && type !== "";
}

function getNetworkTypeAsync() {
  return new Promise((resolve) => {
    try {
      uni.getNetworkType({
        success: (res) => resolve(String(res?.networkType || "none").toLowerCase()),
        fail: () => resolve(getNetworkTypeSync()),
      });
    } catch {
      resolve(getNetworkTypeSync());
    }
  });
}

/** 冷启动网络栈可能未就绪（iOS -1009），轮询直到有网或超时 */
async function waitForNetworkReady(timeoutMs = 20000, intervalMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const type = await getNetworkTypeAsync();
    if (type !== "none" && type !== "unknown" && type !== "") {
      return true;
    }
    await sleep(intervalMs);
  }
  return isNetworkAvailable();
}

function isNetworkError(err) {
  const msg = String(err?.errMsg || err?.message || err || "").toLowerCase();
  return (
    msg.includes("-1009") ||
    msg.includes("not connected") ||
    msg.includes("network") ||
    msg.includes("断开") ||
    msg.includes("internet") ||
    msg.includes("timeout") ||
    msg.includes("abort")
  );
}

function bindInstallNetworkRetry() {
  if (networkRetryBound) return;
  networkRetryBound = true;
  try {
    uni.onNetworkStatusChange((res) => {
      if (res?.isConnected && getItem(INSTALL_SENT_KEY) !== "1") {
        void retryPendingInstallReport();
      }
    });
  } catch {
    /* ignore */
  }
}

function readNetworkType() {
  try {
    const info = uni.getSystemInfoSync();
    const type = String(info.networkType || "").toLowerCase();
    if (type.includes("wifi")) return "wifi";
    if (type.includes("5g") || type.includes("4g") || type.includes("3g") || type === "cellular") {
      return "cellular";
    }
  } catch {
    /* ignore */
  }
  return "unknown";
}

function parseQueryString(input = "") {
  const out = {};
  if (!input) return out;
  const text = String(input).trim();
  if (!text) return out;
  const qs = text.includes("?") ? text.split("?").pop() : text;
  qs.split("&").forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf("=");
    const key = idx >= 0 ? decodeURIComponent(pair.slice(0, idx)) : decodeURIComponent(pair);
    const val = idx >= 0 ? decodeURIComponent(pair.slice(idx + 1)) : "";
    if (key) out[key] = val;
  });
  return out;
}

function parseReferrerParams(referrer = "") {
  if (!referrer) return {};
  try {
    return parseQueryString(referrer);
  } catch {
    return {};
  }
}

function mergeAttributionFields(base = {}, extra = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value == null || value === "") continue;
    if (out[key] == null || out[key] === "") out[key] = value;
  }
  return out;
}

function readPendingAttribution() {
  try {
    const raw = getItem(PENDING_ATTRIBUTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePendingAttribution(patch = {}) {
  const merged = mergeAttributionFields(readPendingAttribution(), patch);
  if (Object.keys(merged).length) {
    setItem(PENDING_ATTRIBUTION_KEY, JSON.stringify(merged));
  }
}

/** 从对象中抽取投放归因字段（gclid + utm_*） */
export function pickCampaignAttributionFields(source = {}) {
  const out = {};
  for (const key of CAMPAIGN_ATTRIBUTION_KEYS) {
    const val = source[key];
    if (val != null && val !== "") out[key] = String(val);
  }
  return out;
}

/** 读取本地缓存的投放归因字段（Firebase / 后端转化事件共用） */
export function getPendingCampaignAttribution() {
  return pickCampaignAttributionFields(readPendingAttribution());
}

/** Install Referrer 原始串 + 已有 pending → 合并投放字段 */
function buildCampaignAttributionFromReferrer(referrer = "", pending = {}) {
  const refParams = parseReferrerParams(referrer);
  return mergeAttributionFields(
    pickCampaignAttributionFields(refParams),
    pickCampaignAttributionFields(pending)
  );
}

/** 转化事件 payload 补齐 gclid + utm_*（顶层 + raw_payload 双写，便于后端 schema 未收录 gclid 时兜底） */
function withCampaignAttributionPayload(payload = {}, pending = readPendingAttribution()) {
  const campaign = pickCampaignAttributionFields(pending);
  const rawPayload = {
    ...(payload.raw_payload && typeof payload.raw_payload === "object" ? payload.raw_payload : {}),
    ...campaign,
  };
  return {
    ...payload,
    ...campaign,
    raw_payload: Object.keys(rawPayload).length ? rawPayload : payload.raw_payload,
  };
}

/**
 * 附带与 Firebase 一致的事件名/参数副本。
 * asProduct：注册/登录/支付/产品行为统一 event_type=product，
 * product_event = firebase_event_name 去掉 test_（install 不要传 asProduct）。
 */
function withFirebaseEventParams(
  payload = {},
  eventName = "",
  params = null,
  { asProduct = false } = {}
) {
  const firebaseParams = normalizeAnalyticsEventParams(params);
  const firebaseName = eventName ? resolveFirebaseEventName(eventName) : "";
  if (!firebaseParams && !firebaseName) return payload;
  const next = {
    ...payload,
    firebase_event_name: firebaseName || undefined,
    firebase_event_params: firebaseParams || undefined,
  };
  if (asProduct && firebaseName) {
    next.event_type = "product";
    next.product_event = canonicalProductEventName(firebaseName);
  }
  return next;
}

/** 解析启动参数 / 深链中的 utm、invite */
export function captureLaunchAttribution() {
  const patch = {};
  try {
    const launch =
      (typeof uni.getLaunchOptionsSync === "function" && uni.getLaunchOptionsSync()) ||
      (typeof uni.getEnterOptionsSync === "function" && uni.getEnterOptionsSync()) ||
      null;
    const query = launch?.query || {};
    const keys = [
      "gclid",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "invite_code",
      "invite",
      "referrer_user_id",
    ];
    keys.forEach((key) => {
      const val = query[key];
      if (val == null || val === "") return;
      if (key === "invite") {
        patch.invite_code = String(val);
      } else if (key === "referrer_user_id") {
        patch.referrer_user_id = Number(val) || undefined;
      } else {
        patch[key] = String(val);
      }
    });
  } catch {
    /* ignore */
  }

  // #ifdef APP-PLUS
  try {
    const args = plus.runtime.arguments;
    if (args && typeof args === "string" && args.length > 0) {
      const fromArgs = parseQueryString(args);
      Object.assign(
        patch,
        mergeAttributionFields({}, {
          gclid: fromArgs.gclid,
          utm_source: fromArgs.utm_source,
          utm_medium: fromArgs.utm_medium,
          utm_campaign: fromArgs.utm_campaign,
          utm_content: fromArgs.utm_content,
          utm_term: fromArgs.utm_term,
          invite_code: fromArgs.invite_code || fromArgs.invite,
          referrer_user_id: fromArgs.referrer_user_id
            ? Number(fromArgs.referrer_user_id)
            : undefined,
        })
      );
    }
  } catch {
    /* ignore */
  }
  // #endif

  if (Object.keys(patch).length) savePendingAttribution(patch);
  return patch;
}

function inferInstallSource(fields = {}) {
  if (fields.invite_code) return "invite";
  if (fields.gclid || fields.utm_source || fields.utm_campaign) return "ads";
  if (fields.play_referrer) {
    const ref = parseReferrerParams(fields.play_referrer);
    if (ref.utm_source || ref.utm_campaign || ref.gclid) return "ads";
  }
  return "organic";
}

function inferAttributionProvider(fields = {}) {
  if (fields.invite_code) return "invite";
  if (fields.play_referrer) return "play_referrer";
  if (fields.utm_source || fields.utm_campaign) return "manual";
  return fields.install_source === "ads" ? "manual" : "organic";
}

function buildEnvironmentPayload(storefrontCountry = "") {
  const meta = getAppMeta();
  return {
    device_id: getDeviceId(),
    app_version: meta.appVersion || undefined,
    os: meta.os || undefined,
    os_version: meta.osVersion || undefined,
    device_model: meta.deviceModel || undefined,
    locale: meta.locale || undefined,
    timezone: meta.timezone || undefined,
    storefront_country: storefrontCountry || meta.storefrontCountry || undefined,
    network: readNetworkType(),
    /** prod | test，便于后端过滤测试流量 */
    app_env: getAppEnv(),
    /** 马甲；Header 也会带 X-App-Key，body 优先 */
    app_key: APP_KEY,
  };
}

function isAttributionResponseOk(body) {
  if (!body || typeof body !== "object") return false;
  if (body.code != null && Number(body.code) !== 200) return false;
  if (body.ok === false) return false;
  return true;
}

/**
 * POST /api/growth/attribution
 * @param {object} payload
 * @returns {Promise<{ recorded?: boolean, linked?: number, event_type?: string }|null>}
 */
export async function reportAttribution(payload = {}) {
  if (!payload?.event_type) return null;
  const body = {
    device_id: getDeviceId(),
    ...buildEnvironmentPayload(),
    ...payload,
  };
  if (!body.device_id) return null;

  try {
    const res = await rawFetch("/api/growth/attribution", {
      method: "POST",
      data: body,
      header: {
        ...getClientHeaders(),
        ...getAuthHeaders(),
      },
    });
    if (!res.ok || !isAttributionResponseOk(res.data)) {
      console.warn("[growthAttribution] report failed", payload.event_type, res.status, res.data);
      return null;
    }
    const results = unwrapApiResults(res.data);
    console.log("[growthAttribution] report ok", payload.event_type, results);
    return results && typeof results === "object" ? results : null;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("[growthAttribution] report network error", payload.event_type, e?.errMsg || e);
    } else {
      console.warn("[growthAttribution] report error", payload.event_type, e);
    }
    return null;
  }
}

/** install 专用：网络未就绪时自动重试 */
async function reportAttributionWithRetry(payload, attempts = 4) {
  const delays = [0, 2000, 5000, 10000];
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await sleep(delays[i] ?? 5000);
      await waitForNetworkReady(8000);
    } else {
      await waitForNetworkReady(15000);
    }
    const result = await reportAttribution(payload);
    if (result) return result;
  }
  return null;
}

function shouldReportInstall() {
  if (getItem(INSTALL_SENT_KEY) === "1") return false;
  if (getItem(INSTALL_FAILED_KEY) !== "1") return true;
  return true;
}

function markInstallReported() {
  setItem(INSTALL_SENT_KEY, "1");
  removeItem(INSTALL_FAILED_KEY);
}

function markInstallFailed() {
  setItem(INSTALL_FAILED_KEY, "1");
}

/**
 * App 冷启动：采集信号并上报 install（幂等）
 */
export async function runGrowthAttributionOnLaunch() {
  captureLaunchAttribution();
  bindInstallNetworkRetry();
  if (!shouldReportInstall()) return;
  if (installReportInFlight) return;
  installReportInFlight = true;

  try {
    // 给系统一点时间完成网络栈初始化（避免 iOS 冷启动 -1009）
    await sleep(800);

    // 并行：商店国家（可能较慢）+ 原生归因信号，避免互相阻塞
    const storefrontTask = resolveStorefrontHeaders()
      .then(({ storefront, header }) => {
        const country = header["X-Storefront-Country"] || storefront?.country || "";
        if (country) setCachedStorefrontCountry(country);
        return country;
      })
      .catch((e) => {
        console.warn("[growthAttribution] storefront prefetch failed", e);
        return "";
      });

    const nativeTask = collectNativeAttributionSignals().catch((e) => {
      console.warn("[growthAttribution] native signals failed", e);
      return {};
    });

    const [storefrontCountry, nativeSignals] = await Promise.all([
      storefrontTask,
      nativeTask,
    ]);

    const pending = readPendingAttribution();
    const campaign = buildCampaignAttributionFromReferrer(
      nativeSignals.play_referrer,
      pending
    );
    // 持久化：供 register/login/purchase 与 Firebase 事件读取
    savePendingAttribution(campaign);

    const merged = mergeAttributionFields(campaign, pending);

    const installSource = inferInstallSource({
      ...merged,
      play_referrer: nativeSignals.play_referrer,
    });

    const payload = {
      event_type: "install",
      install_source: installSource,
      ad_id: nativeSignals.ad_id,
      ad_id_type: nativeSignals.ad_id ? nativeSignals.ad_id_type : "none",
      idfv: nativeSignals.idfv,
      android_id: nativeSignals.android_id,
      ...pickCampaignAttributionFields(merged),
      invite_code: merged.invite_code,
      referrer_user_id: merged.referrer_user_id,
      attribution_provider: inferAttributionProvider({
        ...merged,
        install_source: installSource,
        play_referrer: nativeSignals.play_referrer,
      }),
      raw_payload: {
        play_referrer: nativeSignals.play_referrer || undefined,
        ...pickCampaignAttributionFields(merged),
      },
      ...withFirebaseEventParams(
        {},
        "install_attribution",
        buildInstallFirebaseStyleParams()
      ),
      storefront_country: storefrontCountry || undefined,
    };

    const result = await reportAttributionWithRetry(payload);
    if (result) {
      markInstallReported();
    } else {
      markInstallFailed();
    }
  } finally {
    installReportInFlight = false;
  }
}

/** install 上报失败时，onShow / 网络恢复后补发（无需重打原生包） */
export async function retryPendingInstallReport() {
  if (getItem(INSTALL_SENT_KEY) === "1") return;
  if (getItem(INSTALL_FAILED_KEY) !== "1") return;
  await runGrowthAttributionOnLaunch();
}

/**
 * 注册成功
 * @param {{ method?: string, user?: object|null, invite_code?: string }} [opts]
 */
export async function trackAttributionRegister(opts = {}) {
  const pending = readPendingAttribution();
  const payload = withFirebaseEventParams(
    withCampaignAttributionPayload({
      login_method: opts.method ? String(opts.method) : "email",
      invite_code: opts.invite_code || pending.invite_code,
      referrer_user_id: pending.referrer_user_id,
      install_source: pending.invite_code ? "invite" : inferInstallSource(pending),
      attribution_provider: pending.invite_code ? "invite" : inferAttributionProvider(pending),
    }, pending),
    "register_success",
    buildAuthEventParams({ method: opts.method || "email", user: opts.user || null }),
    { asProduct: true }
  );
  await reportAttribution(payload);
}

/**
 * 登录成功（可选；后端也会静默补）
 * @param {{ method?: string }} [opts]
 */
export async function trackAttributionLogin(opts = {}) {
  const pending = readPendingAttribution();
  await reportAttribution(
    withFirebaseEventParams(
      withCampaignAttributionPayload({
        login_method: opts.method ? String(opts.method) : undefined,
        install_source: inferInstallSource(pending),
        attribution_provider: inferAttributionProvider(pending),
      }, pending),
      "login",
      buildAuthEventParams({ method: opts.method, user: opts.user || null }),
      { asProduct: true }
    )
  );
}

/**
 * 付费成功（可选）
 * @param {{ type?: 'vip'|'points', product?: string|number, revenueUsd?: number, store?: string }} [opts]
 */
/**
 * 产品行为埋点（与 Firebase 并行）
 * @param {string} eventName
 * @param {Record<string, string|number|boolean>} [params]
 */
export function reportProductAnalytics(eventName, params = {}) {
  if (!eventName) return Promise.resolve(null);
  const pending = readPendingAttribution();
  const normalized = normalizeAnalyticsEventParams(params);
  return reportAttribution(
    withFirebaseEventParams(
      withCampaignAttributionPayload({}, pending),
      eventName,
      normalized,
      { asProduct: true }
    )
  );
}

export async function trackAttributionPurchase(opts = {}) {
  const pending = readPendingAttribution();
  const type = String(opts.type || "").toLowerCase();
  const product = String(opts.product ?? "");
  const store =
    opts.store ||
    (() => {
      try {
        const p = String(uni.getSystemInfoSync()?.platform || "").toLowerCase();
        if (p === "ios") return "apple";
        if (p === "android") return "google";
      } catch {
        /* ignore */
      }
      return undefined;
    })();

  await reportAttribution(
    withFirebaseEventParams(
      withCampaignAttributionPayload({
        raw_payload: {
          product_id: product || undefined,
          purchase_type: type || undefined,
          revenue_usd: opts.revenueUsd != null ? Number(opts.revenueUsd) : undefined,
          store,
        },
      }, pending),
      "purchase_success",
      buildPurchaseEventParams({ type, product }),
      { asProduct: true }
    )
  );
}
