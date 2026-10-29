/**
 * @file rechargeCatalog.js
 * @description 充值弹窗：平台、套餐去重、文案格式（不含 IAP 调起）。
 */

/**
 * 界面语言 → 后台套餐国家。只决定向后台要哪一套商品 id。
 * 展示价格仍以苹果返回的 price + pricelocal 为准。
 */
export const LOCALE_TO_REGION = {
  zh: "cn",
  en: "us",
  ja: "jp",
  ko: "kr",
  es: "es",
  pt: "pt",
  id: "id",
  ar: "sa",
};

export const PACK_BY_POINTS = {
  250: "pack_250",
  550: "pack_550",
  800: "pack_800",
  1900: "pack_1900",
};

/**
 * 用户端福利接口必传：apple / google / web（不要传 all）。
 * H5 按后端约定传 platform=web。
 * @returns {"apple"|"google"|"web"|""}
 */
export function getPayPlatform() {
  // #ifdef APP-PLUS
  try {
    const sys = uni.getSystemInfoSync();
    if (sys.platform === "ios") return "apple";
    if (sys.platform === "android") return "google";
  } catch {
    /* ignore */
  }
  // #endif
  // #ifdef H5
  return "web";
  // #endif
  return "";
}

/** @returns {boolean} */
export function isValidPayPlatform(platform) {
  const p = String(platform || "").trim().toLowerCase();
  return p === "apple" || p === "google" || p === "web";
}

export function preferBenefitProduct(next, prev, platform) {
  const score = (item) => {
    const p = String(item.platform || "all").toLowerCase();
    if (platform && p === platform) return 3;
    if (p === "all" || !p) return 2;
    return 1;
  };
  return score(next) > score(prev);
}

export function dedupeBenefits(list, keyOf, platform) {
  const map = new Map();
  for (const item of list) {
    const rawKey = keyOf(item);
    const key = rawKey || `id:${item.id}`;
    const prev = map.get(key);
    if (!prev || preferBenefitProduct(item, prev, platform)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

export function interpolateN(template, n) {
  return String(template || "").replace(/\{n\}/g, String(n));
}

function rewriteDisplayAmount(display, amount) {
  const source = String(display || "").trim();
  if (!source || !/[^\d.,\s-]/.test(source)) return "";
  const match = source.match(/-?\d[\d.,]*/);
  if (!match) return "";
  const sample = match[0];
  const lastComma = sample.lastIndexOf(",");
  const lastDot = sample.lastIndexOf(".");
  const commaDecimal = lastComma > lastDot && sample.length - lastComma <= 3;
  const hasFraction = commaDecimal || (lastDot > lastComma && sample.length - lastDot <= 3);
  let digits;
  if (!hasFraction) {
    const rounded = Math.round(amount);
    digits = Math.abs(amount - rounded) < 0.001 ? String(rounded) : amount.toFixed(2);
  } else if (commaDecimal) {
    digits = amount.toFixed(2).replace(".", ",");
  } else {
    digits = amount.toFixed(2);
  }
  return source.replace(sample, digits);
}

export function formatDailyAvg(t, v, priceDisplay = "") {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  const local = rewriteDisplayAmount(priceDisplay, n);
  if (local) return formatStoreDailyAvg(t, local);
  return interpolateN(t("recharge.dailyAvg", { n }), n);
}

/** 日均已是商店货币字符串（如 ¥2.27），不再套美元符号。 */
export function formatStoreDailyAvg(t, priceText) {
  const price = String(priceText || "").trim();
  if (!price) return "";
  return String(t("recharge.dailyAvgLocal", { price })).replace(/\{price\}/g, price);
}

export function formatGiftPoints(t, v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return interpolateN(t("recharge.pointsPerDay", { n }), n);
}

export function formatAgents(t, v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return interpolateN(t("recharge.agentsUnit", { n }), n);
}

export function formatPoints(t, n) {
  return interpolateN(t("recharge.pointsUnit", { n }), n);
}

/**
 * 商店展示价：优先后端 price_display（已含货币符号/本地格式）。
 * 没有时才回退 price_usd，并由 UI 补 `$`。
 */
export function formatBenefitPrice(item) {
  const display = String(item?.price_display ?? "").trim();
  if (display) {
    return { price: display, showDollarPrefix: false };
  }
  const usd = String(item?.price_usd ?? "").trim();
  return { price: usd, showDollarPrefix: Boolean(usd) };
}

export function localeStorefrontCountry(locale = "") {
  const lang = String(locale || "").split("-")[0].toLowerCase();
  return (LOCALE_TO_REGION[lang] || "us").toUpperCase();
}

/**
 * 组装 /api/benefits 与 limited-offer 的 query。
 * 必带 platform=apple|google|web；地区用 country=US（大写），Header 同步带 X-Storefront-Country。
 * @param {string} [type] subscribe|point；限时接口可不传
 * @param {{ platform?: string, country?: string, locale?: string }} [opts]
 */
export function benefitsQuery(type, opts = {}) {
  // 兼容旧调用：benefitsQuery(type, localeString)
  if (typeof opts === "string") {
    opts = { locale: opts };
  }
  const locale = opts.locale || "";
  const platform = isValidPayPlatform(opts.platform)
    ? String(opts.platform).toLowerCase()
    : getPayPlatform();
  const country = String(
    opts.country || localeStorefrontCountry(locale)
  )
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const queryParts = [];
  if (type) queryParts.push(`type=${encodeURIComponent(type)}`);
  if (isValidPayPlatform(platform)) {
    queryParts.push(`platform=${encodeURIComponent(platform)}`);
  }
  if (country) {
    queryParts.push(`country=${encodeURIComponent(country)}`);
  }
  return queryParts.join("&");
}
