/**
 * @file appleStorePrice.js
 * @description 充值列表展示价。走 appleiap.requestProduct，用返回的 price + pricelocal 格式化。
 * 这是 uni-app 的支付通道接口，沙盒、TestFlight、上架后都由 StoreKit 按当前店面给币种。
 * 每个商品单独查，避免一个无效 id 让整批失败并写进支付缓存。付款仍在点击时另查这一个 id。
 */

export function subscriptionPeriodDays(period) {
  const p = String(period || "").trim().toLowerCase();
  if (!p || /lifetime|forever|permanent/.test(p)) return 0;
  if (/week/.test(p)) return 7;
  if (/year|annual/.test(p)) return 365;
  if (/quarter/.test(p)) return 90;
  if (/month/.test(p)) return 30;
  if (/^day$|daily/.test(p)) return 1;
  return 0;
}

function normalizePriceLocal(raw) {
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object") {
    const id = raw.localeIdentifier || raw.locale || raw.identifier || "";
    return String(id).trim();
  }
  return "";
}

function parsePriceLocal(raw) {
  const localeId = normalizePriceLocal(raw);
  const currency = (localeId.match(/currency=([A-Za-z]{3})/i) || [])[1]?.toUpperCase() || "";
  const locale = (localeId.split("@")[0] || "").replace(/_/g, "-");
  return { localeId, currency, locale };
}

function plusIosToString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  try {
    const utf8 = plus.ios.invoke(value, "UTF8String");
    if (typeof utf8 === "string" && utf8.trim()) return utf8.trim();
  } catch {
    /* ignore */
  }
  const text = String(value).trim();
  if (!text || text === "[object Object]" || text === "null" || text === "undefined") return "";
  return text;
}

function importIosClass(className) {
  if (typeof plus === "undefined" || !plus.ios) return null;
  if (typeof plus.ios.importClass === "function") {
    try {
      const cls = plus.ios.importClass(className);
      if (cls) return cls;
    } catch {
      /* fall through */
    }
  }
  try {
    return plus.ios.import(className);
  } catch {
    return null;
  }
}

function newIosObject(className) {
  if (typeof plus.ios.newObject === "function") {
    try {
      const created = plus.ios.newObject(className);
      if (created) return created;
    } catch {
      /* fall through */
    }
  }
  const Cls = importIosClass(className);
  if (!Cls) return null;
  try {
    if (typeof Cls === "function") return new Cls();
  } catch {
    /* invoke new */
  }
  try {
    return plus.ios.invoke(Cls, "new");
  } catch {
    return null;
  }
}

/** NSNumberFormatterCurrencyStyle */
const CURRENCY_STYLE = 2;

function formatWithNumberFormatter(amount, localeId) {
  if (typeof plus === "undefined" || !plus.ios || !localeId) return "";
  let formatter = null;
  let locale = null;
  let number = null;
  try {
    const NSLocale = importIosClass("NSLocale");
    const NSNumber = importIosClass("NSNumber");
    if (!NSLocale || !NSNumber) return "";
    locale = plus.ios.invoke(NSLocale, "localeWithLocaleIdentifier:", localeId);
    formatter = newIosObject("NSNumberFormatter");
    if (!locale || !formatter) return "";
    plus.ios.invoke(formatter, "setNumberStyle:", CURRENCY_STYLE);
    plus.ios.invoke(formatter, "setLocale:", locale);
    number = plus.ios.invoke(NSNumber, "numberWithDouble:", amount);
    return plusIosToString(plus.ios.invoke(formatter, "stringFromNumber:", number ?? amount));
  } catch (e) {
    console.warn("[appleStorePrice] NSNumberFormatter failed", e);
    return "";
  } finally {
    try {
      if (formatter) plus.ios.deleteObject(formatter);
    } catch {
      /* ignore */
    }
    try {
      if (number) plus.ios.deleteObject(number);
    } catch {
      /* ignore */
    }
  }
}

function formatWithIntl(amount, priceLocal) {
  const { currency, locale } = parsePriceLocal(priceLocal);
  if (!currency) return "";
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch (e) {
    console.warn("[appleStorePrice] Intl fallback failed", e);
    return "";
  }
}

/**
 * @param {unknown} amount
 * @param {unknown} priceLocal appleiap 返回的 pricelocal，例如 zh_CN@currency=CNY
 * @returns {string}
 */
export function formatAppleStorePrice(amount, priceLocal) {
  const n = Number(amount);
  const { localeId } = parsePriceLocal(priceLocal);
  if (!Number.isFinite(n) || n < 0 || !localeId) return "";
  return formatWithNumberFormatter(n, localeId) || formatWithIntl(n, localeId);
}

function requestOneAppleProduct(iap, productId) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (product, via) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        product: product || null,
        via,
        ms: Date.now() - started,
      });
    };
    const timer = setTimeout(() => finish(null, "timeout"), 8000);
    try {
      iap.requestProduct(
        [productId],
        (products) => {
          const list = Array.isArray(products) ? products : products ? [products] : [];
          const match =
            list.find((item) => String(item?.productid || item?.productId || "") === productId) ||
            (list.length === 1 ? list[0] : null);
          if (match && !match.productid && !match.productId) match.productid = productId;
          finish(match, match ? "ok" : "empty");
        },
        (err) => {
          console.warn("[appleStorePrice] requestProduct failed", productId, err);
          finish(null, "fail");
        }
      );
    } catch (err) {
      console.warn("[appleStorePrice] requestProduct throw", productId, err);
      finish(null, "throw");
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryAppleProductsOnce(iap, ids) {
  const found = [];
  let immediate = true;
  let via = "empty";
  for (const id of ids) {
    const row = await requestOneAppleProduct(iap, id);
    via = row.via;
    if (row.ms > 200 || row.via === "timeout") immediate = false;
    if (row.product) found.push(row.product);
  }
  return { found, immediate, via };
}

/**
 * 读取店面价格。TestFlight 上支付通道经常立刻回调空数组，那不是查完了。
 * 遇到这种立即为空就隔 2 秒、4 秒再查，直到拿到 price + pricelocal。
 * @param {string[]} productIds
 * @returns {Promise<{products:object[],reason:string}>}
 */
export function requestAppleProducts(productIds) {
  const ids = [...new Set((productIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return Promise.resolve({ products: [], reason: "no-ids" });
  if (typeof plus === "undefined" || typeof plus.payment?.getChannels !== "function") {
    return Promise.resolve({ products: [], reason: "no-plus" });
  }

  return new Promise((resolve) => {
    plus.payment.getChannels(
      (channels) => {
        const list = Array.isArray(channels) ? channels : [];
        const iap = list.find((channel) => channel && channel.id === "appleiap");
        if (!iap || typeof iap.requestProduct !== "function") {
          resolve({ products: [], reason: "no-channel" });
          return;
        }
        void (async () => {
          const pauses = [0, 2000, 4000];
          let found = [];
          let reason = "empty";
          for (let attempt = 0; attempt < pauses.length; attempt += 1) {
            if (pauses[attempt]) await sleep(pauses[attempt]);
            const queried = await queryAppleProductsOnce(iap, ids);
            found = queried.found;
            if (found.length) {
              reason = "ok";
              break;
            }
            reason = queried.immediate ? `immediate-empty#${attempt + 1}` : `${queried.via}#${attempt + 1}`;
            if (!queried.immediate) break;
          }
          resolve({ products: found, reason });
        })();
      },
      (err) => {
        console.warn("[appleStorePrice] getChannels failed", err);
        resolve({ products: [], reason: "getChannels-fail" });
      }
    );
  });
}
