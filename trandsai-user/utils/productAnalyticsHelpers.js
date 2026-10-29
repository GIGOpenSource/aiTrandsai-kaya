/**
 * @file productAnalyticsHelpers.js
 * @description 产品埋点辅助：一次性去重、idle 计时、free message / 首页停留。
 */

import { getItem, setItem, removeItem } from "@/utils/storage";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import { readCurrentUserId } from "@/utils/analyticsEventParams";

const FREE_USED_KEY = "pa_free_message_used_count";
const FREE_USED_FLAG_KEY = "pa_free_message_ever_used";
const DREE5_SENT_KEY = "pa_dree_message_5_sent";
const DREE0_SENT_KEY = "pa_dree_message_0_sent";
const REG_FINISH_SENT_KEY = "pa_registration_finish_sent";
const REG_SKIP_SENT_KEY = "pa_registration_skip_sent";
const IM_EMPTY_DAY_KEY = "pa_no_data_of_im_day";

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** once key 按 uid 隔离，避免换号/旧测试把全局标记永久挡死 */
function onceKey(base) {
  const uid = readCurrentUserId() || "anon";
  return `${base}:${uid}`;
}

export function trackProductEventOnce(storageKey, eventName, params = {}) {
  if (getItem(storageKey) === "1") {
    console.log(
      `[productAnalytics] skip once already sent: ${eventName} key=${storageKey}`
    );
    return false;
  }
  setItem(storageKey, "1");
  console.log(`[productAnalytics] once fire: ${eventName}`);
  trackProductEvent(eventName, params);
  return true;
}

/** 注册引导：资料是否齐（性别/想聊性别/目的/生日） */
export function isRegisterGuideComplete({
  gender,
  preferredGender,
  purpose,
  birthday,
} = {}) {
  return Boolean(
    String(gender || "").trim() &&
      String(preferredGender || "").trim() &&
      String(purpose || "").trim() &&
      String(birthday || "").trim()
  );
}

/**
 * 注册成功后：齐 → Registration_finish；缺 → registration_skip（各最多一次）
 */
export function trackRegistrationGuideOutcome(fields = {}) {
  const complete = isRegisterGuideComplete(fields);
  if (complete) {
    trackProductEventOnce(
      REG_FINISH_SENT_KEY,
      PRODUCT_EVENTS.REGISTRATION_FINISH,
      { page: "register_step", complete: "1" }
    );
  } else {
    trackProductEventOnce(
      REG_SKIP_SENT_KEY,
      PRODUCT_EVENTS.REGISTRATION_SKIP,
      { page: "register_step", complete: "0" }
    );
  }
  return complete;
}

/**
 * 按「起点 + N 秒」精确对齐打印，避免 setInterval 漂移导致 3、4 挤在一起。
 * getElapsedMs: () => number
 * onSec: (sec: number) => void  —— sec 为 1,2,3...（满整秒才打）
 */
function createAlignedSecLogger(getElapsedMs, onSec) {
  let timerId = null;
  let lastPrintedSec = 0;
  let running = false;

  function clear() {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function scheduleNext() {
    clear();
    if (!running) return;
    const elapsed = Math.max(0, Number(getElapsedMs()) || 0);
    const nextSec = lastPrintedSec + 1;
    const delay = Math.max(0, nextSec * 1000 - elapsed);
    timerId = setTimeout(() => {
      timerId = null;
      if (!running) return;
      const nowElapsed = Math.max(0, Number(getElapsedMs()) || 0);
      const currentSec = Math.floor(nowElapsed / 1000);
      // 只打「下一个该打的秒」；若卡顿落后，跳到当前秒只打一条，避免 3、4 连发
      if (currentSec >= nextSec) {
        lastPrintedSec = currentSec;
        onSec(currentSec);
      }
      scheduleNext();
    }, delay);
  }

  return {
    start() {
      running = true;
      lastPrintedSec = 0;
      clear();
      scheduleNext();
    },
    /** 续计：保留 lastPrintedSec，从下一个整秒继续 */
    resume() {
      running = true;
      const currentSec = Math.floor(Math.max(0, Number(getElapsedMs()) || 0) / 1000);
      if (lastPrintedSec > currentSec) lastPrintedSec = currentSec;
      clear();
      scheduleNext();
    },
    stop() {
      running = false;
      clear();
    },
    resetPrint() {
      lastPrintedSec = 0;
    },
  };
}

/**
 * idle 计时器：连续无操作满 thresholdMs 后回调；操作调用 bump() 重置。
 * pause/resume：短暂 onHide 不丢进度。
 * 日志：严格按 1s、2s、3s… 对齐打印。
 */
export function createIdleTimer({
  label,
  thresholdMs = 15000,
  onFire,
  logPrefix = "[productAnalytics]",
} = {}) {
  let startedAt = 0;
  let pausedElapsedMs = 0;
  let fireTimerId = null;
  let fired = false;
  let active = false;

  function elapsedMs() {
    if (active && startedAt) return Date.now() - startedAt;
    return pausedElapsedMs;
  }

  const secLogger = createAlignedSecLogger(elapsedMs, (sec) => {
    console.log(`${logPrefix} ${label} idle=${sec}s`);
  });

  function clearFireTimer() {
    if (fireTimerId != null) {
      clearTimeout(fireTimerId);
      fireTimerId = null;
    }
  }

  function scheduleFire() {
    clearFireTimer();
    if (!active || fired) return;
    const left = Math.max(0, thresholdMs - elapsedMs());
    fireTimerId = setTimeout(() => {
      fireTimerId = null;
      if (!active || fired) return;
      fired = true;
      secLogger.stop();
      const sec = Math.floor(elapsedMs() / 1000);
      console.log(`${logPrefix} ${label} idle=${sec}s (fire)`);
      try {
        onFire?.({ elapsedMs: elapsedMs(), elapsedSec: elapsedMs() / 1000 });
      } catch (e) {
        console.warn(`${logPrefix} ${label} onFire failed`, e);
      }
    }, left);
  }

  function start() {
    clearFireTimer();
    pausedElapsedMs = 0;
    fired = false;
    active = true;
    startedAt = Date.now();
    secLogger.resetPrint();
    secLogger.start();
    scheduleFire();
  }

  function pause() {
    if (!active || fired) return;
    pausedElapsedMs = Date.now() - startedAt;
    active = false;
    clearFireTimer();
    secLogger.stop();
  }

  function resume() {
    if (fired) return;
    if (active) return;
    if (!startedAt && pausedElapsedMs <= 0) {
      start();
      return;
    }
    active = true;
    startedAt = Date.now() - pausedElapsedMs;
    secLogger.resume();
    scheduleFire();
  }

  function bump(reason = "") {
    if (fired) return;
    pausedElapsedMs = 0;
    startedAt = Date.now();
    secLogger.resetPrint();
    if (!active) return;
    secLogger.start();
    scheduleFire();
  }

  function stop(reason = "") {
    active = false;
    fired = false;
    pausedElapsedMs = 0;
    startedAt = 0;
    clearFireTimer();
    secLogger.stop();
    secLogger.resetPrint();
  }

  return { start, pause, resume, bump, stop, getElapsedSec: () => elapsedMs() / 1000 };
}

/** 当日首次进入 IM 且未读为 0 */
export function trackNoDataOfImIfNeeded(totalUnread) {
  const day = todayKey();
  if (getItem(IM_EMPTY_DAY_KEY) === day) return false;
  if (Number(totalUnread) > 0) return false;
  setItem(IM_EMPTY_DAY_KEY, day);
  trackProductEvent(PRODUCT_EVENTS.NO_DATA_OF_IM, {
    page: "messages",
    unread: "0",
  });
  return true;
}

/**
 * 记录一次 free message 使用 / 进房快照。
 * 触发规则：ws `free_turn_used`
 * - remaining === 5 → dree_message_5（每用户本地一次）
 * - report_free_quota_reached === true → dree_message_3（每次刚打满都报；快照为 false 不报）
 * @param {{ free_turns_limit?: number|string|null, free_turns_used?: number|string|null, remaining?: number|string|null, report_free_quota_reached?: boolean }} payload
 * @param {string|number|null} [companionId]
 */
export function recordFreeMessageUsed(payload = {}, companionId = null) {
  setItem(FREE_USED_FLAG_KEY, "1");
  cancelDreeMessage0("free_message_used");

  const limit = Number(payload?.free_turns_limit);
  const used = Number(payload?.free_turns_used);
  let remaining = null;
  if (Number.isFinite(limit) && Number.isFinite(used)) {
    remaining = Math.max(0, limit - used);
  } else {
    const legacy = Number(payload?.remaining);
    if (Number.isFinite(legacy)) remaining = Math.max(0, legacy);
  }

  if (remaining == null) {
    console.log("[productAnalytics] free_message limit/used invalid:", payload);
    return NaN;
  }

  console.log(
    `[productAnalytics] free_message limit=${limit} used=${used} remaining=${remaining}`
  );

  const extra =
    companionId != null && String(companionId).trim()
      ? { companion_id: String(companionId).trim() }
      : {};
  const counts = {
    remaining: String(remaining),
    ...(Number.isFinite(used) ? { free_turns_used: String(used), used: String(used) } : {}),
    ...(Number.isFinite(limit) ? { free_turns_limit: String(limit) } : {}),
  };

  const quotaReached =
    payload?.report_free_quota_reached === true ||
    payload?.report_free_quota_reached === 1 ||
    payload?.report_free_quota_reached === "true" ||
    payload?.report_free_quota_reached === "1";

  if (remaining === 5) {
    trackProductEventOnce(onceKey(DREE5_SENT_KEY), PRODUCT_EVENTS.DREE_MESSAGE_5, {
      ...counts,
      ...extra,
    });
  }
  if (quotaReached) {
    console.log("[productAnalytics] dree_message_3 report_free_quota_reached");
    trackProductEvent(PRODUCT_EVENTS.DREE_MESSAGE_3, {
      ...counts,
      remaining: "0",
      ...extra,
    });
  }

  return remaining;
}

export function hasEverUsedFreeMessage() {
  return (
    getItem(FREE_USED_FLAG_KEY) === "1" || Number(getItem(FREE_USED_KEY) || 0) > 0
  );
}

/** —— dree_message_0：App 在线累计 180s，且未点过聊天页发送 —— */
let fgAccumMs = 0;
let fgSegmentStart = 0;
let fgFireTimerId = null;
let fgActive = false;
/** 已上报/已取消后，避免 App/首页反复 onShow 刷屏 */
let dree0SkipLogged = false;

function currentFgMs() {
  let ms = fgAccumMs;
  if (fgSegmentStart) ms += Date.now() - fgSegmentStart;
  return ms;
}

const dree0SecLogger = createAlignedSecLogger(currentFgMs, (sec) => {
  console.log(`[productAnalytics] dree_message_0 online=${sec}s`);
});

function clearFgFireTimer() {
  if (fgFireTimerId != null) {
    clearTimeout(fgFireTimerId);
    fgFireTimerId = null;
  }
}

function flushFgSegment() {
  if (!fgSegmentStart) return;
  fgAccumMs += Date.now() - fgSegmentStart;
  fgSegmentStart = 0;
}

function scheduleFgCheck() {
  clearFgFireTimer();
  if (!fgActive) return;
  if (hasEverUsedFreeMessage()) return;
  if (getItem(onceKey(DREE0_SENT_KEY)) === "1") return;

  const need = 180000 - currentFgMs();
  if (need <= 0) {
    flushFgSegment();
    fireDreeMessage0();
    return;
  }
  fgFireTimerId = setTimeout(() => {
    fgFireTimerId = null;
    flushFgSegment();
    fgSegmentStart = Date.now();
    if (fgAccumMs >= 180000) fireDreeMessage0();
    else scheduleFgCheck();
  }, need);
}

function fireDreeMessage0() {
  const key = onceKey(DREE0_SENT_KEY);
  if (getItem(key) === "1") return;
  if (hasEverUsedFreeMessage()) return;
  dree0SecLogger.stop();
  const sec = Math.floor(fgAccumMs / 1000);
  console.log(`[productAnalytics] dree_message_0 online=${sec}s (fire)`);
  trackProductEventOnce(key, PRODUCT_EVENTS.DREE_MESSAGE_0, {
    home_sec: String(sec),
  });
  clearFgFireTimer();
  fgActive = false;
  fgSegmentStart = 0;
  dree0SkipLogged = false; // 下次若再被 onShow 调用，最多再提示一次
}

function cancelDreeMessage0(reason = "") {
  clearFgFireTimer();
  dree0SecLogger.stop();
  fgActive = false;
  fgSegmentStart = 0;
  if (reason) {
    console.log(`[productAnalytics] dree_message_0 cancelled: ${reason}`);
  }
}

/**
 * 聊天页点了发送按钮：永久取消 dree_message_0（本账号 once 周期内不再计时）。
 */
export function cancelDreeMessage0OnChatSend() {
  setItem(FREE_USED_FLAG_KEY, "1");
  cancelDreeMessage0("chat_send");
}

/**
 * App 前台且已登录时累计；切后台 pause；
 * 未点过聊天发送 / 未用过 free 则一直计，满 180s 上报。
 */
export function startForegroundDree0Timer() {
  // 已上报：静默返回（首页/App 会反复 onShow，不要刷 skip）
  if (getItem(onceKey(DREE0_SENT_KEY)) === "1") {
    if (!dree0SkipLogged) {
      dree0SkipLogged = true;
      console.log(
        "[productAnalytics] dree_message_0 already sent（之后 onShow 不再重复打印）"
      );
    }
    return;
  }
  if (hasEverUsedFreeMessage()) {
    if (!dree0SkipLogged) {
      dree0SkipLogged = true;
      console.log(
        "[productAnalytics] dree_message_0 cancelled already（已发消息/用过 free，之后不再打印）"
      );
    }
    return;
  }
  // 已在计时：只续跑，不重复打 timer start
  if (fgActive) {
    if (!fgSegmentStart) fgSegmentStart = Date.now();
    dree0SecLogger.resume();
    scheduleFgCheck();
    return;
  }
  fgActive = true;
  fgSegmentStart = Date.now();
  dree0SkipLogged = false;
  console.log(
    `[productAnalytics] dree_message_0 timer start accum=${Math.floor(fgAccumMs / 1000)}s`
  );
  if (fgAccumMs <= 0) {
    dree0SecLogger.resetPrint();
    dree0SecLogger.start();
  } else {
    dree0SecLogger.resume();
  }
  scheduleFgCheck();
}

export function pauseForegroundDree0Timer() {
  if (!fgActive) return;
  flushFgSegment();
  clearFgFireTimer();
  dree0SecLogger.stop();
  fgActive = false;
}

/** 退出登录：停表并清零累计；清掉 once / used 标记，方便下次登录重测 */
export function resetHomeDree0Timer() {
  clearFgFireTimer();
  dree0SecLogger.stop();
  dree0SecLogger.resetPrint();
  fgActive = false;
  fgSegmentStart = 0;
  fgAccumMs = 0;
  dree0SkipLogged = false;
  try {
    removeItem(FREE_USED_FLAG_KEY);
    removeItem(FREE_USED_KEY);
    // 旧全局 key + 当前 uid 维度 key
    removeItem(DREE0_SENT_KEY);
    removeItem(DREE3_SENT_KEY);
    removeItem(DREE5_SENT_KEY);
    removeItem(onceKey(DREE0_SENT_KEY));
    removeItem(onceKey(DREE3_SENT_KEY));
    removeItem(onceKey(DREE5_SENT_KEY));
  } catch {
    /* ignore */
  }
  console.log("[productAnalytics] dree_message_0 reset (logout)");
}

/** @deprecated 兼容旧名：已改为 App 前台计时 */
export const startHomeDree0Timer = startForegroundDree0Timer;
/** @deprecated 兼容旧名 */
export const pauseHomeDree0Timer = pauseForegroundDree0Timer;
