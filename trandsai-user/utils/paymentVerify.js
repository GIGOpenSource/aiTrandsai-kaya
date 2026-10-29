/**
 * @file paymentVerify.js
 * @description 验单结果判定：商店 SDK purchased / HTTP 200 都不算入账。
 * 必须以 results.processed===true && results.status==="completed" 为准。
 */
import { unwrapApiResults } from "@/utils/api";

/**
 * 取出验单内层 results（兼容已 unwrap 或整包 body）。
 * @param {object|null} body
 */
export function getVerifyResults(body) {
  if (!body || typeof body !== "object") return {};
  if (body.results && typeof body.results === "object") return body.results;
  // 已 unwrap 时本身就是 results
  if (
    Object.prototype.hasOwnProperty.call(body, "processed") ||
    Object.prototype.hasOwnProperty.call(body, "status")
  ) {
    return body;
  }
  const inner = unwrapApiResults(body);
  return inner && typeof inner === "object" ? inner : {};
}

/** 真正入账成功 */
export function isVerifyPaidOk(body) {
  const r = getVerifyResults(body);
  return r.processed === true && r.status === "completed";
}

/** 服务端仍在处理，应继续转圈并重试验单 */
export function isVerifyPending(body) {
  const r = getVerifyResults(body);
  return String(r.status || "") === "pending";
}

/**
 * 带 pending 重试的验单 POST。
 * @param {() => Promise<object>} requestFn 每次调用发起一次验单
 * @param {{ maxAttempts?: number, delayMs?: number, onAttempt?: Function }} [opts]
 * @returns {Promise<{ body: object|null, paidOk: boolean, pending: boolean, results: object }>}
 */
export async function verifyReceiptUntilSettled(requestFn, opts = {}) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 4);
  const delayMs = Math.max(200, Number(opts.delayMs) || 2000);
  let body = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      opts.onAttempt?.(i + 1, maxAttempts);
      body = await requestFn();
    } catch (err) {
      // 网络/HTTP 失败：最后一次抛出；中间次继续重试
      if (i >= maxAttempts - 1) throw err;
      console.warn("[paymentVerify] attempt failed, retry", i + 1, err);
      continue;
    }
    if (isVerifyPaidOk(body)) {
      return {
        body,
        paidOk: true,
        pending: false,
        results: getVerifyResults(body),
      };
    }
    if (isVerifyPending(body)) {
      console.log("[paymentVerify] pending, retry", i + 1);
      continue;
    }
    // processed false / failed / 其它：不再重试
    break;
  }
  return {
    body,
    paidOk: false,
    pending: isVerifyPending(body),
    results: getVerifyResults(body),
  };
}

/**
 * 本次增加额（Toast「+X 金币」用）。
 * 用 credits_added；现已与 results.credits 同值。不要用 balance。
 */
export function pickCreditsAddedFromVerifyResults(results) {
  if (!results || typeof results !== "object") return 0;
  const n = Number(results.credits_added ?? results.credits ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 充值钱包总余额（写本地 user_info.credits）。
 * effective_balance / balance，不含日赠；不是本次增加额。
 */
export function pickBalanceFromVerifyResults(results) {
  if (!results || typeof results !== "object") return null;
  const n = Number(
    results.effective_balance ?? results.balance ?? results.user_credits
  );
  return Number.isFinite(n) ? n : null;
}

/** @deprecated 易与「本次增加」混淆；请改用 pickBalanceFromVerifyResults */
export function pickCreditsFromVerifyResults(results) {
  return pickBalanceFromVerifyResults(results);
}
