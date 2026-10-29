/**
 * @file trandsGoogleIapFacade.js
 * @description Thin JS facade over trands-google-iap JSON-string + top-level callback API.
 * Native ByJs returns plain JSON strings (not nested options.success UniCallback).
 */
import {
  connect as nativeConnect,
  isReady as nativeIsReady,
  getBillingConfig as nativeGetBillingConfig,
  queryProductDetails as nativeQueryProductDetails,
  launchBillingFlow as nativeLaunchBillingFlow,
  onPurchasesUpdated as nativeOnPurchasesUpdated,
} from "@/uni_modules/trands-google-iap";

function parseJson(x) {
  if (x == null) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch (_) {
    return null;
  }
}

/**
 * @returns {{
 *   connect: Function,
 *   isReady: Function,
 *   getBillingConfig: Function,
 *   queryProductDetails: Function,
 *   launchBillingFlow: Function,
 *   onPurchasesUpdated: Function,
 * }}
 */
export function createTrandsGoogleIap() {
  return {
    connect(options) {
      nativeConnect(
        JSON.stringify({
          enableAutoServiceReconnection: options?.enableAutoServiceReconnection !== false,
          enablePrepaidPlans: options?.enablePrepaidPlans !== false,
        }),
        (res) => options?.success?.(parseJson(res) || { connectionState: "connected" }),
        (err) => options?.fail?.(parseJson(err) || err),
      );
    },
    isReady() {
      try {
        return !!nativeIsReady();
      } catch (_) {
        return false;
      }
    },
    getBillingConfig(options) {
      nativeGetBillingConfig(
        (res) => options?.success?.(parseJson(res) || {}),
        (err) => options?.fail?.(parseJson(err) || err),
      );
    },
    queryProductDetails(options) {
      nativeQueryProductDetails(
        JSON.stringify(options?.products || []),
        (res) => {
          console.log("[TrandsIAP facade] query success raw type", typeof res);
          options?.success?.(parseJson(res) || { products: [] });
        },
        (err) => options?.fail?.(parseJson(err) || err),
      );
    },
    launchBillingFlow(options) {
      const payload = {
        productType: options?.productType,
        items: options?.items || [],
      };
      const accountId = String(options?.obfuscatedAccountId || "").trim();
      if (accountId) payload.obfuscatedAccountId = accountId;
      nativeLaunchBillingFlow(
        JSON.stringify(payload),
        (res) => options?.success?.(parseJson(res) || res),
        (err) => options?.fail?.(parseJson(err) || err),
      );
    },
    onPurchasesUpdated(callback) {
      nativeOnPurchasesUpdated((res) => callback?.(parseJson(res) || res));
    },
  };
}
