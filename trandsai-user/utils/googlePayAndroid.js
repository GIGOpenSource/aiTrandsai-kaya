/**
 * @file googlePayAndroid.js
 * @description Android 专用 Google Play IAP。
 * 默认 tt-google-iap；`VITE_USE_TRANDS_IAP=1|true|yes` 时走自研 trands-google-iap（离线 AS 必须开）。
 * 仅由 googlePay.js 在 APP-ANDROID 条件编译下引入，避免 iOS 云打包编译该 UTS 插件。
 */
import * as googleIapModule from "@/uni_modules/tt-google-iap";
import googleIapDefault from "@/uni_modules/tt-google-iap";
import { getCurrentUserId } from "@/composables/useAuth";
import { createTrandsGoogleIap } from "@/utils/trandsGoogleIapFacade";
import { devLog, devWarn } from "@/utils/devLog";
import {
  verifyReceiptUntilSettled,
  pickBalanceFromVerifyResults,
  pickCreditsAddedFromVerifyResults,
} from "@/utils/paymentVerify";

/** Play Billing setObfuscatedAccountId：仅十进制 user_id 字符串（勿 UUID/JSON） */
function resolveObfuscatedAccountId() {
  const raw = getCurrentUserId();
  if (raw == null || raw === "") {
    console.warn("[GooglePay] obfuscatedAccountId 跳过：本地无 user id");
    return "";
  }
  const id = String(raw).trim();
  if (!/^\d+$/.test(id)) {
    console.warn(
      "[GooglePay] obfuscatedAccountId 非十进制 user_id，已跳过:",
      id.slice(0, 8)
    );
    return "";
  }
  return id;
}

function pickProductIdFromPurchase(purchase) {
  const products = purchase?.products;
  if (Array.isArray(products) && products.length > 0) {
    const first = products[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    if (first && typeof first === "object" && first.productId) {
      return String(first.productId).trim();
    }
  }
  const single = purchase?.productId || purchase?.product_id;
  return single != null ? String(single).trim() : "";
}

let googleIapInstance = null;
let googlePurchaseListenerRegistered = false;
/** 进行中的 Billing connect，避免充值页与支付并发重复连接 */
let billingConnectPromise = null;
/** 最近一次拉起购买的 productId，验单缺 products 时兜底 product_id */
let pendingGoogleProductId = "";

function useTrandsIap() {
  const raw = String(import.meta.env?.VITE_USE_TRANDS_IAP ?? "0")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** @returns {"trands-google-iap"|"tt-google-iap"} */
export function getGoogleIapBackendName() {
  return useTrandsIap() ? "trands-google-iap" : "tt-google-iap";
}

function isIapLike(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.connect === "function" &&
    typeof value.queryProductDetails === "function"
  );
}

function resolveGoogleIapInstance() {
  const attempts = [];

  const tryUse = (label, value) => {
    attempts.push(`${label}:${value == null ? "null" : typeof value}`);
    if (isIapLike(value)) return value;
    if (typeof value === "function") {
      try {
        const inst = value();
        attempts.push(`${label}():${inst == null ? "null" : typeof inst}`);
        if (isIapLike(inst)) return inst;
      } catch (e) {
        attempts.push(`${label}():throw`);
        devWarn(`[GooglePay] ${label} 调用失败:`, e);
      }
    }
    return null;
  };

  const mod = googleIapModule;
  const defs = [mod, mod?.default, googleIapDefault, googleIapDefault?.default];

  for (const item of defs) {
    const direct = tryUse("direct", item);
    if (direct) return { instance: direct, attempts };

    const fromGetter = tryUse("getTTGoogleIAP", item?.getTTGoogleIAP);
    if (fromGetter) return { instance: fromGetter, attempts };
  }

  return { instance: null, attempts };
}

function getGoogleIap() {
  if (googleIapInstance) return googleIapInstance;

  const backend = getGoogleIapBackendName();
  console.log(`[GooglePay] IAP backend: ${backend}`);

  if (useTrandsIap()) {
    try {
      googleIapInstance = createTrandsGoogleIap();
      if (!isIapLike(googleIapInstance)) {
        console.error("[GooglePay] trands-google-iap facade invalid");
        googleIapInstance = null;
        return null;
      }
      devLog("[GooglePay] trands iap 实例创建成功");
      return googleIapInstance;
    } catch (e) {
      googleIapInstance = null;
      console.error("[GooglePay] trands-google-iap 初始化失败:", e);
      return null;
    }
  }

  try {
    let modKeys = [];
    let defaultKeys = [];
    try {
      modKeys = Object.keys(googleIapModule || {});
      defaultKeys = Object.keys(googleIapModule?.default || googleIapDefault || {});
    } catch (_) {
      modKeys = ["<unreadable>"];
    }
    devLog("[GooglePay] module keys:", modKeys);
    devLog("[GooglePay] default keys:", defaultKeys);

    const { instance, attempts } = resolveGoogleIapInstance();
    devLog("[GooglePay] resolve attempts:", attempts.join(" | "));

    if (!instance) {
      console.error(
        "[GooglePay] 无法创建 iap 实例。请确认：1) 使用自定义调试基座运行  2) 换账号后已重新制作基座  3) 插件已绑定 appid __UNI__859C11F"
      );
      return null;
    }

    googleIapInstance = instance;
    devLog("[GooglePay] iap 实例创建成功:", !!googleIapInstance);
  } catch (e) {
    googleIapInstance = null;
    console.error("[GooglePay] getGoogleIap 失败:", e);
    console.error(
      "[GooglePay] 自定义基座 APK 中可能未包含 tt-google-iap 原生实现，请重新制作自定义基座"
    );
  }

  return googleIapInstance;
}

function isBillingReady(iap) {
  try {
    return typeof iap?.isReady === "function" ? !!iap.isReady() : false;
  } catch (e) {
    console.error("[GooglePay] isReady 异常:", e);
    return false;
  }
}

/**
 * 连接 Play Billing。失败返回 false，不 toast（商店国家取不到时走后端兜底）。
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function ensureGoogleBillingConnected(timeoutMs = 8000) {
  const iap = getGoogleIap();
  if (!iap) return Promise.resolve(false);
  if (isBillingReady(iap)) return Promise.resolve(true);
  if (billingConnectPromise) return billingConnectPromise;

  billingConnectPromise = new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      billingConnectPromise = null;
      resolve(ok);
    };
    const timer = setTimeout(() => {
      console.error("[GooglePay] 连接超时");
      done(false);
    }, timeoutMs);

    try {
      iap.connect({
        enableAutoServiceReconnection: true,
        enablePrepaidPlans: true,
        success: () => {
          devLog("[GooglePay] 连接成功");
          done(true);
        },
        fail: (error) => {
          console.error("[GooglePay] 连接失败:", error);
          done(false);
        },
      });
    } catch (e) {
      console.error("[GooglePay] connect 异常:", e);
      done(false);
    }
  });

  return billingConnectPromise;
}

/**
 * Play 商店国家（ISO 3166-1 alpha-2）。必须先 connect。
 * 失败返回 ""，调用方不要用语言/IP 在客户端顶上。
 */
export async function getPlayStorefrontCountry() {
  const connected = await ensureGoogleBillingConnected();
  if (!connected) return "";
  const iap = getGoogleIap();
  if (!iap || typeof iap.getBillingConfig !== "function") return "";

  return await new Promise((resolve) => {
    let settled = false;
    const done = (country) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(String(country || "").trim().toUpperCase());
    };
    const timer = setTimeout(() => {
      devWarn("[GooglePay] getBillingConfig 超时");
      done("");
    }, 6000);

    try {
      iap.getBillingConfig({
        success: (result) => {
          const country = String(result?.countryCode || "").trim();
          console.log(
            "[GooglePay] getBillingConfig 原始返回:",
            JSON.stringify({
              countryCode: country,
              resultKeys: result ? Object.keys(result) : [],
            })
          );
          done(country);
        },
        fail: (error) => {
          formatBillingError(error, "getBillingConfig");
          done("");
        },
      });
    } catch (e) {
      console.error("[GooglePay] getBillingConfig 异常:", e);
      done("");
    }
  });
}

async function verifyGooglePurchase(ctx, purchase) {
  const {
    paying,
    t,
    showToast,
    api,
    refreshUserInfoAfterPurchase,
    notifyPurchased,
    close,
  } = ctx;
  paying.value = true;
  try {
    const payload = {
      order_id: purchase.orderId,
      purchase_token: purchase.purchaseToken || purchase.purchase_token || "",
    };
    const productId =
      pickProductIdFromPurchase(purchase) ||
      String(pendingGoogleProductId || "").trim();
    if (productId) payload.product_id = productId;
    // 绑人走 Play obfuscatedAccountId / RTDN；验单 body 不传 user_id
    devLog(
      "[GooglePay] 请求后端验单 order_id:",
      payload.order_id,
      "product_id:",
      productId || "(none)",
      "token_len:",
      String(payload.purchase_token || "").length
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const settled = await verifyReceiptUntilSettled(
      () => api.post("/api/payment/verify-google-receipt", payload),
      { maxAttempts: 4, delayMs: 2000 }
    );
    if (!settled.paidOk) {
      const msg =
        String(settled.results?.message || "").trim() ||
        t("recharge.verifyFailed");
      console.warn("[GooglePay] verify not completed", settled.results);
      showToast(msg);
      try {
        ctx?.onPayFailed?.();
      } catch {
        /* ignore */
      }
      return;
    }
    // 总余额用 effective_balance/balance；credits/credits_added 是本次增加额，勿当余额
    let userData = null;
    const balance = pickBalanceFromVerifyResults(settled.results);
    if (balance != null) {
      userData = { credits: balance, ...(settled.results || {}) };
    } else if (typeof refreshUserInfoAfterPurchase === "function") {
      userData = await refreshUserInfoAfterPurchase();
    }
    // SDK purchased 不算成功：此处才 Toast；增加额用 credits_added，不用 balance
    if (ctx.skipSuccessToast !== true) {
      const added = pickCreditsAddedFromVerifyResults(settled.results);
      if (added > 0) {
        const tpl = String(
          t("limitedOffer.purchaseSuccess", { n: added }) || ""
        );
        showToast(tpl.replace(/\{n\}/g, String(added)));
      } else {
        showToast(t("recharge.paymentSuccess"));
      }
    }
    notifyPurchased?.({ userData, verifyResults: settled.results });
    close?.();
  } catch (err) {
    console.error("[GooglePay] verify purchase failed:", err);
    showToast(t("recharge.verifyFailed"));
    try {
      ctx?.onPayFailed?.();
    } catch {
      /* ignore */
    }
  } finally {
    paying.value = false;
  }
}

async function registerGooglePurchaseListener(ctx) {
  const { paying, t, showToast } = ctx;
  const iap = getGoogleIap();
  if (!iap || googlePurchaseListenerRegistered) return;
  iap.onPurchasesUpdated((result) => {
    devLog("[GooglePay] 购买回调:", result?.responseCode, result?.debugMessage);
    if (result?.responseCode !== 0) {
      devLog("[GooglePay] 支付失败或取消");
      paying.value = false;
      showToast(t("recharge.paymentFailed"));
      try {
        ctx?.onPayFailed?.();
      } catch {
        /* ignore */
      }
      return;
    }
    const purchases = result.purchases || [];
    if (purchases.length === 0) return;
    for (const purchase of purchases) {
      if (purchase.purchaseState !== "purchased" || purchase.isSuspended) continue;
      devLog("[GooglePay] 支付成功，purchaseToken_len:", String(purchase.purchaseToken || "").length);
      void verifyGooglePurchase(ctx, purchase);
    }
  });
  googlePurchaseListenerRegistered = true;
}

const BILLING_RESPONSE_HINTS = {
  2: "Billing 服务暂时不可用，请稍后重试",
  3: "设备/账号/Play 商店不支持 Billing，请确认已登录 Google 账号且从 Play 测试轨道安装",
  4: "商品不可用，请检查 Play Console 商品 ID 是否已启用",
  5: "开发者配置错误，请检查包名和签名是否与 Play Console 一致",
  6: "Google Play 内部错误",
  7: "该商品已购买且未消耗",
  8: "商品不属于当前账号",
};

function formatBillingError(error, action) {
  const code = error?.billingResponseCode;
  const hint = BILLING_RESPONSE_HINTS[code] || "";
  const debug = error?.debugMessage || error?.errMsg || "";
  console.error(
    `[GooglePay] ${action}失败:`,
    JSON.stringify({
      errCode: error?.errCode,
      billingResponseCode: code,
      hint,
      debugMessage: debug,
    })
  );
  return hint || debug || "";
}

function launchBillingWithTimeout(ctx, iap, productType, item, onTerminal) {
  const { paying, t, showToast } = ctx;
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error("[GooglePay] 拉起支付界面超时（15s）");
    paying.value = false;
    showToast(t("recharge.paymentFailed"));
    onTerminal?.();
  }, 15000);

  const obfuscatedAccountId = resolveObfuscatedAccountId();
  const flowOpts = {
    productType,
    items: [item],
    success: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      devLog("[GooglePay] 支付界面已打开");
      paying.value = false;
      onTerminal?.();
    },
    fail: (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.error("[GooglePay] 启动购买失败:", error);
      formatBillingError(error, "启动购买");
      paying.value = false;
      showToast(t("recharge.paymentFailed"));
      onTerminal?.();
    },
  };
  if (obfuscatedAccountId) {
    flowOpts.obfuscatedAccountId = obfuscatedAccountId;
  }
  // 用 console 方便真机 logcat 确认是否真正 set（缺则 Play raw 无 obfuscatedExternalAccountId）
  console.log(
    "[GooglePay] launchBillingFlow",
    JSON.stringify(item),
    "obfuscatedAccountId=",
    obfuscatedAccountId || "(skip)"
  );
  iap.launchBillingFlow(flowOpts);
}

function queryAndBuyGoogleProduct(ctx, iap, productId, productType, onTerminal) {
  const { paying, t, showToast } = ctx;
  let settled = false;
  const done = () => onTerminal?.();
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error("[GooglePay] 查询商品超时（15s）");
    paying.value = false;
    showToast(t("recharge.productInfoFailed"));
    done();
  }, 15000);

  devLog("[GooglePay] 调用 queryProductDetails:", productId, productType);
  iap.queryProductDetails({
    products: [{ productId, productType }],
    success: (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      devLog("[GooglePay] queryProductDetails:", JSON.stringify(result));
      const products = result?.products || [];
      if (products.length === 0) {
        paying.value = false;
        showToast(t("recharge.productNotFound"));
        done();
        return;
      }
      const product = products[0];
      const item = { productId: product.productId };
      const offerToken =
        product.oneTimePurchaseOffers?.[0]?.offerToken ??
        product.subscriptionOffers?.[0]?.offerToken ??
        "";
      if (offerToken) item.offerToken = offerToken;
      launchBillingWithTimeout(ctx, iap, productType, item, done);
    },
    fail: (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      formatBillingError(error, "查询商品");
      paying.value = false;
      showToast(t("recharge.productInfoFailed"));
      done();
    },
  });
}

/** Android：拉起 Google Play 内购 / 订阅 */
export async function startGooglePay(ctx, productId, productType = "inapp") {
  const { paying, t, showToast } = ctx;
  let flowDone = false;
  const endFlow = (reason) => {
    if (flowDone) return;
    flowDone = true;
    clearTimeout(safetyTimer);
    if (reason) devWarn("[GooglePay] 流程结束:", reason);
    paying.value = false;
  };

  const safetyTimer = setTimeout(() => {
    console.error("[GooglePay] 全流程超时（25s），强制恢复按钮");
    endFlow("safety timeout");
    showToast(t("recharge.googlePayUnavailable"));
  }, 25000);

  try {
    pendingGoogleProductId = String(productId || "").trim();
    devLog("[GooglePay] 开始支付，productId:", productId, "productType:", productType);
    devLog("[GooglePay] 步骤1: 获取 iap 实例");
    const iap = getGoogleIap();
    devLog("[GooglePay] iap 已获取:", !!iap);
    if (!iap) {
      endFlow("no iap");
      showToast(t("recharge.googlePayUnavailable"));
      return;
    }

    devLog("[GooglePay] 步骤2: 注册购买监听");
    await registerGooglePurchaseListener(ctx);

    const onTerminal = () => endFlow("done");
    const buy = () => {
      queryAndBuyGoogleProduct(ctx, iap, productId, productType, onTerminal);
    };

    const ready = isBillingReady(iap);
    devLog("[GooglePay] 步骤3: isReady =", ready);
    if (ready) {
      buy();
      return;
    }

    devLog("[GooglePay] 步骤4: 正在连接 Google Play Billing...");
    const connected = await ensureGoogleBillingConnected(15000);
    if (flowDone) return;
    if (!connected) {
      endFlow("connect fail");
      showToast(t("recharge.googlePayUnavailable"));
      return;
    }
    buy();
  } catch (e) {
    console.error("[GooglePay] startGooglePay 异常:", e);
    endFlow("exception");
    showToast(t("recharge.googlePayUnavailable"));
  }
}
