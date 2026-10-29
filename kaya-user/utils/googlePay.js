/**
 * @file googlePay.js
 * @description Android IAP 统一入口。
 *
 * - 不用动态 import()：App 打包 format=iife，不支持 code-splitting。
 * - Android：APP-PLUS 且非 iOS 时静态引入实现文件。
 * - iOS 打包：#ifndef APP-IOS 裁掉引入，避免编进 Android 支付插件与商店名文案。
 */
import { devWarn } from "@/utils/devLog";

// #ifdef APP-PLUS
// #ifndef APP-IOS
import {
  startGooglePay as startGooglePayAndroid,
  getPlayStorefrontCountry as getPlayStorefrontCountryAndroid,
} from "./googlePayAndroid.js";
// #endif
// #endif

function notSupported(ctx) {
  devWarn("[Pay] in-app purchase not supported on this platform");
  if (ctx?.paying) ctx.paying.value = false;
  try {
    ctx?.showToast?.(
      ctx?.t?.("recharge.googlePayNotSupported") ||
        "In-app purchase is not available here"
    );
  } catch {
    /* ignore */
  }
}

/** Play Billing 商店国家（ISO alpha-2）；失败返回空串 */
export async function getPlayStorefrontCountry() {
  // #ifdef APP-PLUS
  // #ifndef APP-IOS
  try {
    return await getPlayStorefrontCountryAndroid();
  } catch (e) {
    console.error("[Pay] getPlayStorefrontCountry failed:", e);
    return "";
  }
  // #endif
  // #endif
  return "";
}

/**
 * @param {object} ctx AppRechargeModal 支付上下文
 * @param {string} productId
 * @param {string} [productType]
 */
export async function startGooglePay(ctx, productId, productType = "inapp") {
  // #ifdef APP-PLUS
  // #ifndef APP-IOS
  try {
    const platform = String(
      uni.getSystemInfoSync()?.platform || ""
    ).toLowerCase();
    console.log("[Pay] entry platform=", platform, "productId=", productId);
    if (platform === "android") {
      return await startGooglePayAndroid(ctx, productId, productType);
    }
  } catch (e) {
    console.error("[Pay] Android payment failed:", e);
    if (ctx?.paying) ctx.paying.value = false;
    try {
      ctx?.showToast?.(
        ctx?.t?.("recharge.googlePayUnavailable") ||
          "Payment is temporarily unavailable"
      );
    } catch {
      /* ignore */
    }
    return;
  }
  // #endif
  // #endif

  notSupported(ctx);
}
