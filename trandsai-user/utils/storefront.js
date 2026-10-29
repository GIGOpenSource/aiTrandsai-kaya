/**
 * @file storefront.js
 * @description 充值页拉取商品前，读取商店支付国家（ISO 3166-1 alpha-2）。
 *
 * - iOS：StoreKit SKStorefront（UTS 插件，失败则 plus.ios）
 * - Android：Play Billing getBillingConfig（tt-google-iap）
 * - 取不到时：福利接口用 UI 语言映射国家兜底（避免只靠 IP）；其它场景可不带头
 * - 不要写入用户资料长期缓存；每次进充值页重新取
 */
import {
  getPayPlatform,
  localeStorefrontCountry,
} from "@/utils/rechargeCatalog";
import { setCachedStorefrontCountry } from "@/utils/device";
import i18n from "@/i18n";

// #ifdef APP-PLUS
// #ifdef APP-IOS
import { fetchStorefrontCountryAlpha2 as nativeIosStorefront } from "@/uni_modules/trands-storefront";
// #endif
// #ifndef APP-IOS
import { getPlayStorefrontCountry } from "@/utils/googlePay";
// #endif
// #endif

let iosNativeFetch = null;
// #ifdef APP-PLUS
// #ifdef APP-IOS
iosNativeFetch = nativeIosStorefront;
// #endif
// #endif

/** Apple SKStorefront 返回 ISO 3166-1 alpha-3，请求头必须是 alpha-2 */
const ALPHA3_TO_ALPHA2 = {
  AFG: "AF",
  ALA: "AX",
  ALB: "AL",
  DZA: "DZ",
  ASM: "AS",
  AND: "AD",
  AGO: "AO",
  AIA: "AI",
  ATA: "AQ",
  ATG: "AG",
  ARG: "AR",
  ARM: "AM",
  ABW: "AW",
  AUS: "AU",
  AUT: "AT",
  AZE: "AZ",
  BHS: "BS",
  BHR: "BH",
  BGD: "BD",
  BRB: "BB",
  BLR: "BY",
  BEL: "BE",
  BLZ: "BZ",
  BEN: "BJ",
  BMU: "BM",
  BTN: "BT",
  BOL: "BO",
  BES: "BQ",
  BIH: "BA",
  BWA: "BW",
  BVT: "BV",
  BRA: "BR",
  IOT: "IO",
  BRN: "BN",
  BGR: "BG",
  BFA: "BF",
  BDI: "BI",
  CPV: "CV",
  KHM: "KH",
  CMR: "CM",
  CAN: "CA",
  CYM: "KY",
  CAF: "CF",
  TCD: "TD",
  CHL: "CL",
  CHN: "CN",
  CXR: "CX",
  CCK: "CC",
  COL: "CO",
  COM: "KM",
  COG: "CG",
  COD: "CD",
  COK: "CK",
  CRI: "CR",
  CIV: "CI",
  HRV: "HR",
  CUB: "CU",
  CUW: "CW",
  CYP: "CY",
  CZE: "CZ",
  DNK: "DK",
  DJI: "DJ",
  DMA: "DM",
  DOM: "DO",
  ECU: "EC",
  EGY: "EG",
  SLV: "SV",
  GNQ: "GQ",
  ERI: "ER",
  EST: "EE",
  SWZ: "SZ",
  ETH: "ET",
  FLK: "FK",
  FRO: "FO",
  FJI: "FJ",
  FIN: "FI",
  FRA: "FR",
  GUF: "GF",
  PYF: "PF",
  ATF: "TF",
  GAB: "GA",
  GMB: "GM",
  GEO: "GE",
  DEU: "DE",
  GHA: "GH",
  GIB: "GI",
  GRC: "GR",
  GRL: "GL",
  GRD: "GD",
  GLP: "GP",
  GUM: "GU",
  GTM: "GT",
  GGY: "GG",
  GIN: "GN",
  GNB: "GW",
  GUY: "GY",
  HTI: "HT",
  HMD: "HM",
  VAT: "VA",
  HND: "HN",
  HKG: "HK",
  HUN: "HU",
  ISL: "IS",
  IND: "IN",
  IDN: "ID",
  IRN: "IR",
  IRQ: "IQ",
  IRL: "IE",
  IMN: "IM",
  ISR: "IL",
  ITA: "IT",
  JAM: "JM",
  JPN: "JP",
  JEY: "JE",
  JOR: "JO",
  KAZ: "KZ",
  KEN: "KE",
  KIR: "KI",
  PRK: "KP",
  KOR: "KR",
  KWT: "KW",
  KGZ: "KG",
  LAO: "LA",
  LVA: "LV",
  LBN: "LB",
  LSO: "LS",
  LBR: "LR",
  LBY: "LY",
  LIE: "LI",
  LTU: "LT",
  LUX: "LU",
  MAC: "MO",
  MDG: "MG",
  MWI: "MW",
  MYS: "MY",
  MDV: "MV",
  MLI: "ML",
  MLT: "MT",
  MHL: "MH",
  MTQ: "MQ",
  MRT: "MR",
  MUS: "MU",
  MYT: "YT",
  MEX: "MX",
  FSM: "FM",
  MDA: "MD",
  MCO: "MC",
  MNG: "MN",
  MNE: "ME",
  MSR: "MS",
  MAR: "MA",
  MOZ: "MZ",
  MMR: "MM",
  NAM: "NA",
  NRU: "NR",
  NPL: "NP",
  NLD: "NL",
  NCL: "NC",
  NZL: "NZ",
  NIC: "NI",
  NER: "NE",
  NGA: "NG",
  NIU: "NU",
  NFK: "NF",
  MKD: "MK",
  MNP: "MP",
  NOR: "NO",
  OMN: "OM",
  PAK: "PK",
  PLW: "PW",
  PSE: "PS",
  PAN: "PA",
  PNG: "PG",
  PRY: "PY",
  PER: "PE",
  PHL: "PH",
  PCN: "PN",
  POL: "PL",
  PRT: "PT",
  PRI: "PR",
  QAT: "QA",
  REU: "RE",
  ROU: "RO",
  RUS: "RU",
  RWA: "RW",
  BLM: "BL",
  SHN: "SH",
  KNA: "KN",
  LCA: "LC",
  MAF: "MF",
  SPM: "PM",
  VCT: "VC",
  WSM: "WS",
  SMR: "SM",
  STP: "ST",
  SAU: "SA",
  SEN: "SN",
  SRB: "RS",
  SYC: "SC",
  SLE: "SL",
  SGP: "SG",
  SXM: "SX",
  SVK: "SK",
  SVN: "SI",
  SLB: "SB",
  SOM: "SO",
  ZAF: "ZA",
  SGS: "GS",
  SSD: "SS",
  ESP: "ES",
  LKA: "LK",
  SDN: "SD",
  SUR: "SR",
  SJM: "SJ",
  SWE: "SE",
  CHE: "CH",
  SYR: "SY",
  TWN: "TW",
  TJK: "TJ",
  TZA: "TZ",
  THA: "TH",
  TLS: "TL",
  TGO: "TG",
  TKL: "TK",
  TON: "TO",
  TTO: "TT",
  TUN: "TN",
  TUR: "TR",
  TKM: "TM",
  TCA: "TC",
  TUV: "TV",
  UGA: "UG",
  UKR: "UA",
  ARE: "AE",
  GBR: "GB",
  USA: "US",
  UMI: "UM",
  URY: "UY",
  UZB: "UZ",
  VUT: "VU",
  VEN: "VE",
  VNM: "VN",
  VGB: "VG",
  VIR: "VI",
  WLF: "WF",
  ESH: "EH",
  YEM: "YE",
  ZMB: "ZM",
  ZWE: "ZW",
};

const ALPHA2_RE = /^[A-Z]{2}$/;
const ALPHA3_RE = /^[A-Z]{3}$/;

/**
 * @param {unknown} raw
 * @returns {string} ISO 3166-1 alpha-2 或空串
 */
export function normalizeStorefrontCountry(raw) {
  const code = String(raw || "")
    .trim()
    .toUpperCase();
  if (!code) return "";
  if (ALPHA2_RE.test(code)) return code;
  if (ALPHA3_RE.test(code)) return ALPHA3_TO_ALPHA2[code] || "";
  return "";
}

function emptyStorefront() {
  return { country: "", source: "", raw: "", via: "" };
}

function plusIosImport(name) {
  if (typeof plus.ios.importClass === "function") {
    try {
      const cls = plus.ios.importClass(name);
      if (cls) return { cls, how: "importClass" };
    } catch {
      /* fall through */
    }
  }
  try {
    const cls = plus.ios.import(name);
    if (cls) return { cls, how: "import" };
  } catch {
    /* ignore */
  }
  return { cls: null, how: "none" };
}

function plusIosString(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (text && text !== "[object Object]") return text;
  }
  try {
    const utf8 = plus.ios.invoke(value, "UTF8String");
    if (typeof utf8 === "string" && utf8.trim()) return utf8.trim();
  } catch {
    /* NSString 有时直接 String() 即可 */
  }
  const text = String(value).trim();
  if (!text || text === "[object Object]" || text === "null" || text === "undefined") {
    return "";
  }
  return text;
}

function plusIosReadProp(obj, key) {
  if (!obj) return null;
  try {
    if (typeof obj[key] === "function") {
      const fromFn = obj[key]();
      if (fromFn != null) return fromFn;
    }
  } catch {
    /* ignore */
  }
  try {
    const invoked = plus.ios.invoke(obj, key);
    if (invoked != null) return invoked;
  } catch {
    /* property getter 有时不能当方法 invoke */
  }
  try {
    if (typeof obj.plusGetAttribute === "function") {
      const attr = obj.plusGetAttribute(key);
      if (attr != null) return attr;
    }
  } catch {
    /* ignore */
  }
  try {
    return plus.ios.invoke(obj, "valueForKey:", key);
  } catch {
    return null;
  }
}

function resolvePaymentQueue(SKPaymentQueue, debug) {
  const tries = [];
  const take = (label, getter) => {
    try {
      const q = getter();
      tries.push(`${label}:${q == null ? "null" : typeof q}`);
      return q || null;
    } catch (e) {
      tries.push(`${label}:throw:${e?.message || e}`);
      return null;
    }
  };

  const queue =
    take("defaultQueue()", () =>
      typeof SKPaymentQueue.defaultQueue === "function"
        ? SKPaymentQueue.defaultQueue()
        : null
    ) ||
    take("invoke(class)", () => plus.ios.invoke(SKPaymentQueue, "defaultQueue")) ||
    take("invoke(name)", () => plus.ios.invoke("SKPaymentQueue", "defaultQueue")) ||
    take("default()", () =>
      typeof SKPaymentQueue.default === "function" ? SKPaymentQueue.default() : null
    );

  debug.queueTries = tries;
  return queue;
}

function warmupAppleIap() {
  return new Promise((resolve) => {
    if (typeof plus === "undefined" || typeof plus.payment?.getChannels !== "function") {
      resolve({ ok: false, reason: "no-payment" });
      return;
    }
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 4000);
    plus.payment.getChannels(
      (channels) => {
        clearTimeout(timer);
        const list = Array.isArray(channels) ? channels : [];
        const ok = list.some((c) => c && c.id === "appleiap");
        resolve({
          ok,
          reason: ok ? "appleiap" : "no-appleiap",
          ids: list.map((c) => c && c.id).filter(Boolean),
        });
      },
      (err) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          reason: "getChannels-fail",
          err: err?.message || String(err),
        });
      }
    );
  });
}

/** StoreKit 1：SKPaymentQueue.defaultQueue().storefront.countryCode（Alpha-3） */
function readIosStorefrontOnce() {
  const debug = {
    hasPlus: typeof plus !== "undefined",
    hasPlusIos: false,
    hasUts: typeof iosNativeFetch === "function",
    step: "",
    raw: "",
    err: "",
  };
  try {
    if (typeof plus === "undefined" || !plus.ios) {
      debug.step = "no-plus.ios";
      return { raw: "", via: "plus.ios", debug };
    }
    debug.hasPlusIos = true;
    const imported = plusIosImport("SKPaymentQueue");
    debug.importHow = imported.how;
    debug.step = imported.cls ? "imported" : "import-failed";
    if (!imported.cls) return { raw: "", via: "plus.ios", debug };

    const queue = resolvePaymentQueue(imported.cls, debug);
    debug.step = queue ? "queue" : "no-queue";
    if (!queue) return { raw: "", via: "plus.ios", debug };

    const storefront = plusIosReadProp(queue, "storefront");
    if (!storefront) {
      debug.step = "storefront-nil";
      return { raw: "", via: "plus.ios", debug };
    }
    debug.step = "storefront";

    const countryCode = plusIosReadProp(storefront, "countryCode");
    debug.raw = plusIosString(countryCode);
    debug.step = debug.raw ? "countryCode" : "countryCode-empty";
    try {
      plus.ios.deleteObject(storefront);
    } catch {
      /* ignore */
    }
    return { raw: debug.raw, via: "plus.ios", debug };
  } catch (e) {
    debug.err = e?.message || String(e);
    debug.step = debug.step || "throw";
    console.warn("[storefront] plus.ios failed", e);
    return { raw: "", via: "plus.ios", debug };
  }
}

async function fetchIosStorefrontViaPlus() {
  const warmed = await warmupAppleIap();
  console.log("[storefront] 预热 appleiap", JSON.stringify(warmed));

  const waits = [0, 400, 1000];
  let last = { raw: "", via: "plus.ios", debug: {} };
  for (let i = 0; i < waits.length; i++) {
    const waitMs = waits[i];
    if (waitMs) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    last = readIosStorefrontOnce();
    console.log(
      "[storefront] plus.ios 尝试",
      JSON.stringify({ try: i + 1, waitMs, ...last.debug })
    );
    if (last.raw) return last;
  }
  return last;
}

async function fetchIosStorefrontCountry() {
  try {
    if (typeof iosNativeFetch === "function") {
      const raw = String(iosNativeFetch() || "");
      const country = normalizeStorefrontCountry(raw);
      console.log(
        "[storefront] UTS 返回",
        JSON.stringify({ raw, countryAlpha2: country })
      );
      if (country) return { raw, country, via: "uts" };
    } else {
      console.log("[storefront] 未编进 UTS 插件（本地运行常见），改走 plus.ios");
    }
  } catch (e) {
    console.warn("[storefront] UTS 调用失败，改走 plus.ios", e);
  }
  const plusResult = await fetchIosStorefrontViaPlus();
  return {
    raw: plusResult.raw,
    country: normalizeStorefrontCountry(plusResult.raw),
    via: plusResult.via,
    debug: plusResult.debug,
  };
}

/**
 * @returns {Promise<{ country: string, source: string, raw: string, via?: string }>}
 */
export async function getStorefront() {
  const platform = getPayPlatform();

  if (platform === "google") {
    // #ifdef APP-PLUS
    // #ifndef APP-IOS
    try {
      const raw = String((await getPlayStorefrontCountry()) || "");
      const country = normalizeStorefrontCountry(raw);
      return {
        raw,
        country,
        source: country ? "android_play" : "",
        via: "play_billing_config",
      };
    } catch (e) {
      console.warn("[storefront] Play billing config failed", e);
      return emptyStorefront();
    }
    // #endif
    // #endif
    return emptyStorefront();
  }

  if (platform === "apple") {
    // #ifdef APP-PLUS
    const ios = await fetchIosStorefrontCountry();
    return {
      raw: ios.raw || "",
      country: ios.country || "",
      source: ios.country ? "ios_storekit" : "",
      via: ios.via || "",
      debug: ios.debug || null,
    };
    // #endif
    return emptyStorefront();
  }

  return emptyStorefront();
}

/**
 * GET /api/benefits 请求头。取不到国家时不带头，让后端走 IP 兜底。
 * @param {{ country?: string, source?: string }|null} storefront
 * @returns {Record<string, string>}
 */
export function getStorefrontHeaders(storefront) {
  const country = normalizeStorefrontCountry(storefront?.country);
  if (!country) return {};
  const header = { "X-Storefront-Country": country };
  const source = String(storefront?.source || "").trim();
  if (source) header["X-Storefront-Source"] = source;
  return header;
}

export async function resolveStorefrontHeaders() {
  const storefront = await getStorefront();
  const header = getStorefrontHeaders(storefront);
  console.log(
    "[storefront] 商店国家",
    JSON.stringify({
      payPlatform: getPayPlatform() || "(empty, H5/非商店)",
      rawFromStore: storefront.raw || "",
      countryAlpha2: storefront.country || "",
      source: storefront.source || "",
      via: storefront.via || "",
      debug: storefront.debug || null,
      header,
      sentCountryHeader: Boolean(header["X-Storefront-Country"]),
      note: storefront.country
        ? "将用商店国家请求商品列表"
        : "取不到商店国家，不传 X-Storefront-Country，后端走 IP→语言兜底",
    })
  );
  return { storefront, header };
}

/**
 * 福利 / 限时优惠请求上下文（平台 + 地区）。
 * - platform 必为 apple|google（H5 无商店时返回 null，调用方应跳过）
 * - country：优先 Play/App Store 店面；否则 UI 语言映射（避免只靠 IP）
 * @returns {Promise<null|{
 *   platform: "apple"|"google",
 *   country: string,
 *   source: string,
 *   header: Record<string, string>,
 * }>}
 */
export async function resolveBenefitsRequestContext() {
  const platform = getPayPlatform();
  if (platform !== "apple" && platform !== "google" && platform !== "web") {
    console.warn(
      "[benefits] platform 必须是 apple / google / web，当前为空，跳过请求"
    );
    return null;
  }

  let country = "";
  let source = "";
  try {
    const storefront = await getStorefront();
    country = normalizeStorefrontCountry(storefront?.country);
    source = String(storefront?.source || "").trim();
    if (country) setCachedStorefrontCountry(country);
  } catch (err) {
    console.warn("[benefits] storefront resolve failed", err);
  }

  if (!country) {
    country = localeStorefrontCountry(i18n.global.locale.value);
    source = source || "locale_fallback";
  }

  country = String(country || "US")
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const header = {
    "X-Storefront-Country": country,
  };
  if (source) header["X-Storefront-Source"] = source;

  console.log(
    "[benefits] request context",
    JSON.stringify({ platform, country, source })
  );

  return { platform, country, source, header };
}
