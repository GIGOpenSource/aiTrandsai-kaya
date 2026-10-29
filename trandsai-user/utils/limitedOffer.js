/**
 * @file limitedOffer.js
 * @description 限时优惠：GET 状态（已无 event）、服务端倒计时校准、商店价与折扣反推划线价。
 * 登录未付费首次 GET 即可 show=true；倒计时以 remaining_sec / expires_at 为准。
 */
import { api, unwrapApiResults } from "@/utils/api";
import i18n from "@/i18n";
import { getAuthHeaders } from "@/utils/authHeaders";
import { getJson, setJson, removeItem } from "@/utils/storage";
import { readCurrentUserId } from "@/utils/analyticsEventParams";
import {
  benefitsQuery,
  formatBenefitPrice,
  getPayPlatform,
} from "@/utils/rechargeCatalog";
import {
  formatAppleStorePrice,
  requestAppleProducts,
} from "@/utils/appleStorePrice";
import { resolveBenefitsRequestContext } from "@/utils/storefront";

const EXPIRES_KEY_PREFIX = "limited_offer_expires_v1_";
/** 冷启动恢复：缓存仍在倒计时的优惠快照 */
const ACTIVE_CACHE_KEY_PREFIX = "limited_offer_active_v1_";
const POLL_INTERVAL_MS = 10000;

export { POLL_INTERVAL_MS };

export function formatCountdownMmSs(totalSec) {
  const n = Math.max(0, Math.floor(Number(totalSec) || 0));
  const mm = String(Math.floor(n / 60)).padStart(2, "0");
  const ss = String(n % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function countdownDigits(totalSec) {
  const text = formatCountdownMmSs(totalSec);
  return {
    m0: text[0],
    m1: text[1],
    s0: text[3],
    s1: text[4],
  };
}

/**
 * 前端 analyticsScene → 接口 scene
 * free_message / chat → chat_quota；agent_create → create_agent
 */
export function mapLimitedOfferScene(analyticsScene) {
  const s = String(analyticsScene || "").trim();
  if (s === "agent_create" || s === "create_agent") return "create_agent";
  if (s === "say_hi") return "say_hi";
  if (
    s === "free_message" ||
    s === "chat" ||
    s === "chat_quota" ||
    s === "close" ||
    !s
  ) {
    return "chat_quota";
  }
  return s;
}

/**
 * product.product_type：subscribe = 限时会员，point = 限时金币
 * @returns {"subscribe"|"point"|""}
 */
export function resolveLimitedOfferProductType(product) {
  const raw = String(
    product?.product_type || product?.productType || product?.type || ""
  )
    .trim()
    .toLowerCase();
  if (
    raw === "subscribe" ||
    raw === "subscription" ||
    raw === "subs" ||
    raw === "vip"
  ) {
    return "subscribe";
  }
  if (raw === "point" || raw === "points" || raw === "credits" || raw === "inapp") {
    return "point";
  }
  return "";
}

export function isSubscribeLimitedProduct(product) {
  return resolveLimitedOfferProductType(product) === "subscribe";
}

export function isPointLimitedProduct(product) {
  return resolveLimitedOfferProductType(product) === "point";
}

/**
 * 触发付费墙时：是否改出限时弹窗（否则走普通充值墙）。
 * - forceNormal（我的页会员/积分入口）：永远普通
 * - 限时会员(subscribe)：各付费场景都可出
 * - 限时金币(point)：创建智能体且需要会员(tab=vip) → 普通充值
 */
export function shouldOpenLimitedOfferForPaywall({
  forceNormal = false,
  scene = "",
  defaultTab = "",
  product = null,
} = {}) {
  if (forceNormal) return false;
  if (!product) return false;
  const type = resolveLimitedOfferProductType(product);
  if (!type) return false;
  if (type === "subscribe") return true;
  const apiScene = mapLimitedOfferScene(scene);
  const tab = String(defaultTab || "vip").trim().toLowerCase();
  // 创建智能体且当前是会员墙：金币限时无法满足「必须会员」
  if (apiScene === "create_agent" && tab === "vip") return false;
  return true;
}

/**
 * 划线原价：现价 / (1 - discount_pct/100)；无折扣或解析失败返回 ""
 */
export function computeComparePriceFromDiscount(priceDisplay, discountPct) {
  const pct = Number(discountPct);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return "";
  const source = String(priceDisplay || "").trim();
  if (!source) return "";
  const match = source.replace(/\s/g, "").match(/-?\d[\d.,]*/);
  if (!match) return "";
  const sample = match[0];
  const normalized = sample.replace(/,/g, "");
  const p = Number(normalized);
  if (!Number.isFinite(p) || p <= 0) return "";
  const original = p / (1 - pct / 100);
  if (!Number.isFinite(original) || original <= 0) return "";
  const lastComma = sample.lastIndexOf(",");
  const lastDot = sample.lastIndexOf(".");
  const commaDecimal = lastComma > lastDot && sample.length - lastComma <= 3;
  const hasFraction =
    commaDecimal || (lastDot > lastComma && sample.length - lastDot <= 3);
  let digits;
  if (!hasFraction) {
    const rounded = Math.round(original);
    digits =
      Math.abs(original - rounded) < 0.001
        ? String(rounded)
        : original.toFixed(2);
  } else if (commaDecimal) {
    digits = original.toFixed(2).replace(".", ",");
  } else {
    digits = original.toFixed(2);
  }
  return source.replace(sample, digits);
}

function expiresStorageKey(productId) {
  const uid = readCurrentUserId() || "anon";
  return `${EXPIRES_KEY_PREFIX}${uid}_${String(productId || "")}`;
}

export function readOfferExpiresAt(productId) {
  if (!productId) return null;
  const raw = getJson(expiresStorageKey(productId));
  const ts = Number(raw?.expiresAt);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

export function writeOfferExpiresAt(productId, expiresAt) {
  if (!productId || !expiresAt) return;
  setJson(expiresStorageKey(productId), {
    expiresAt: Number(expiresAt),
    productId: String(productId),
  });
}

export function clearOfferExpiresAt(productId) {
  if (!productId) return;
  removeItem(expiresStorageKey(productId));
}

function activeCacheKey() {
  const uid = readCurrentUserId() || "anon";
  return `${ACTIVE_CACHE_KEY_PREFIX}${uid}`;
}

/** 写入仍有效的限时优惠快照（杀进程后可恢复悬浮窗） */
export function writeActiveOfferCache(payload) {
  if (!payload?.product?.id || !payload.expiresAt) return;
  const exp = Number(payload.expiresAt);
  if (!Number.isFinite(exp) || exp <= Date.now()) return;
  setJson(activeCacheKey(), {
    product: payload.product,
    expiresAt: exp,
    storePrice: String(payload.storePrice || ""),
    comparePrice: String(payload.comparePrice || ""),
    durationSec: Number(payload.durationSec) || 0,
  });
}

export function clearActiveOfferCache() {
  removeItem(activeCacheKey());
}

/**
 * 读取未过期的本地优惠快照。
 * @returns {{ product: object, expiresAt: number, storePrice: string, comparePrice: string, durationSec: number }|null}
 */
export function readActiveOfferCache() {
  const raw = getJson(activeCacheKey());
  if (!raw || typeof raw !== "object") return null;
  const exp = Number(raw.expiresAt);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    clearActiveOfferCache();
    return null;
  }
  if (!raw.product || typeof raw.product !== "object") {
    clearActiveOfferCache();
    return null;
  }
  return {
    product: raw.product,
    expiresAt: exp,
    storePrice: String(raw.storePrice || ""),
    comparePrice: String(raw.comparePrice || ""),
    durationSec: Number(raw.durationSec) || 0,
  };
}

/**
 * 展示价是否可用。后端偶发 price_display=0.00 / $0.00，不能当最终价锁死。
 * @param {unknown} value
 */
export function isUsableOfferPrice(value) {
  const t = String(value ?? "").trim();
  if (!t) return false;
  const compact = t.replace(/\s/g, "");
  if (/^\$?0+(\.0+)?$/.test(compact)) return false;
  const num = Number(compact.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(num) && num <= 0) return false;
  return true;
}

/** 同步取展示价（不走商店 SDK，避免冷启动卡住） */
export function peekProductPriceDisplay(product) {
  if (!product) return "";
  const priced = formatBenefitPrice(product);
  if (priced.price) {
    const text = priced.showDollarPrefix ? `$${priced.price}` : priced.price;
    return isUsableOfferPrice(text) ? text : "";
  }
  const display = String(product.price_display || "").trim();
  if (isUsableOfferPrice(display)) return display;
  const usd = String(product.price_usd ?? "").trim();
  if (!usd) return "";
  const text = usd.startsWith("$") ? usd : `$${usd}`;
  return isUsableOfferPrice(text) ? text : "";
}

/** 解析服务端 expires_at（ISO）为毫秒时间戳 */
export function parseExpiresAtMs(expiresAt) {
  if (expiresAt == null || expiresAt === "") return null;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  }
  const t = Date.parse(String(expiresAt));
  return Number.isFinite(t) ? t : null;
}

/**
 * 从 GET/event 响应推算本地 expiresAt（ms）
 * 优先 expires_at；否则用 remaining_sec
 */
export function resolveExpiresAtFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const fromIso = parseExpiresAtMs(payload.expires_at);
  if (fromIso && fromIso > Date.now()) return fromIso;
  const left = Math.max(0, Math.floor(Number(payload.remaining_sec) || 0));
  if (left > 0) return Date.now() + left * 1000;
  return fromIso && fromIso > 0 ? fromIso : null;
}

export function remainingSecFromExpires(expiresAt) {
  const ts = Number(expiresAt);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}

function limitedOfferHeaders(extra = {}) {
  return {
    "Accept-Language": String(i18n.global.locale.value || ""),
    ...getAuthHeaders(),
    ...extra,
  };
}

/**
 * GET /api/benefits/limited-offer
 * 必带 platform（apple|google|web）+ X-Storefront-Country（+ 全局 X-App-Key）
 * 登录未付费首次 GET 即可 show=true（已无 event 接口）。
 * @returns {Promise<object|null>} 失败返回 null，不打断原流程
 */
export async function fetchLimitedOffer() {
  try {
    const ctx = await resolveBenefitsRequestContext();
    if (!ctx) return null;
    const query = benefitsQuery("", {
      platform: ctx.platform,
      country: ctx.country,
    });
    const res = await api.get(`/api/benefits/limited-offer?${query}`, {
      header: limitedOfferHeaders(ctx.header),
    });
    const data = unwrapApiResults(res) || res || {};
    return data && typeof data === "object" ? data : null;
  } catch (err) {
    console.warn("[limitedOffer] fetch failed", err);
    return null;
  }
}

/**
 * @deprecated 后端已移除 limited-offer/event；登录未付费首次 GET 即 show=true。
 * 保留空实现避免旧调用报错。
 */
export async function postLimitedOfferEvent() {
  console.warn(
    "[limitedOffer] event API removed; use GET /api/benefits/limited-offer"
  );
  return null;
}

/**
 * 商店本地化价；失败回退 price_display。
 * H5 / 非苹果：直接用后端 price_display。
 */
export async function resolveStorePriceDisplay(product) {
  if (!product) return "";
  const platform = getPayPlatform();
  const appleId = String(product.apple_product_id || "").trim();
  const googleId = String(product.store_product_id || "").trim();

  if (platform === "apple" && appleId) {
    try {
      const result = await requestAppleProducts([appleId]);
      const row = (result?.products || []).find(
        (p) =>
          String(p?.productid || p?.productId || "").trim() === appleId
      );
      const display = formatAppleStorePrice(
        row?.price,
        row?.pricelocal ?? row?.priceLocale
      );
      if (display) return display;
      console.warn(
        "[limitedOffer] apple store price empty, fallback price_display",
        result?.reason
      );
    } catch (err) {
      console.warn("[limitedOffer] apple price failed", err);
    }
  }

  const priced = formatBenefitPrice(product);
  if (priced.price) {
    return priced.showDollarPrefix ? `$${priced.price}` : priced.price;
  }
  const usd = String(product.price_usd ?? "").trim();
  if (usd) return usd.startsWith("$") ? usd : `$${usd}`;
  if (!googleId && !appleId) {
    console.warn("[limitedOffer] product missing store ids");
  }
  return "";
}

/** show 字段兼容 true / 1 / "true" */
export function isLimitedOfferShowFlag(value) {
  return value === true || value === 1 || value === "true" || value === "1";
}

/** 服务端要求展示悬浮/弹窗（show + 有商品 + 剩余时间） */
export function isOfferShowable(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (!isLimitedOfferShowFlag(payload.show)) return false;
  if (!payload.product) return false;
  const left = Math.max(0, Math.floor(Number(payload.remaining_sec) || 0));
  if (left > 0) return true;
  const exp = parseExpiresAtMs(payload.expires_at);
  return Boolean(exp && exp > Date.now());
}

/**
 * 即使 show=false，若本地倒计时未结束且响应里仍有商品，也可恢复展示。
 * （杀进程后再进：服务端有时会回 not_started，但本地 expires 仍有效）
 */
export function resolveLocalResumeExpires(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload.product;
  if (!p?.id) return null;
  if (payload.reason === "already_paid" || payload.reason === "expired") {
    return null;
  }
  const local = readOfferExpiresAt(p.id);
  if (local && local > Date.now()) return local;
  return null;
}
