/**
 * @file ourMoments.js
 * @description Our Moments（私密相册）用户端：列表请求与埋点（解锁只报一次）。
 */
import apiFetch from "@/utils/api";
import { getItem, setItem } from "@/utils/storage";
import { readCurrentUserId } from "@/utils/analyticsEventParams";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";

/** 解锁提示展示时长（接近 uni.showToast 默认 1500~2000） */
export const OUR_MOMENTS_TIP_MS = 2000;
/** 最近 tip 落盘有效期：nvue 跳转充值页后仍能读到 */
export const OUR_MOMENTS_TIP_RECENT_MS = 60000;
const TIP_STORAGE_KEY = "our_moments_last_tip_v1";

/**
 * 文案不走接口：用 remaining_messages / toast 类型本地拼。
 * @param {"countdown"|"unlocked"|string} toastKind
 * @param {number|string} remainingMessages
 * @param {(key: string, params?: object) => string} t i18n.t
 */
export function formatOurMomentsTipText(toastKind, remainingMessages, t) {
  if (typeof t !== "function") return "";
  if (String(toastKind || "").trim() === "unlocked") {
    const title = String(t("chat.ourMomentsUnlocked") || "").trim();
    const body = String(t("chat.ourMomentsUnlockedPaywallBody") || "").trim();
    return [title, body].filter(Boolean).join(" ").trim();
  }
  const n = Number(remainingMessages);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(t("chat.ourMomentsBarCountdown", { n }) || "")
    .replace(/\{n\}/g, String(n))
    .trim();
}

/** 解锁 tip 展示时长（纯文案，不可点） */
export const OUR_MOMENTS_UNLOCKED_TIP_MS = 2500;

/**
 * 聊天输入框上方常驻条：
 * - all_unlocked → 图3
 * - 否则用 remaining_messages → 图1
 * - empty / 无进度 → 不展示
 */
export function formatOurMomentsChatBar(progress, t) {
  const empty = { mode: "", text: "", n: null, before: "", after: "" };
  if (typeof t !== "function" || !progress || typeof progress !== "object") {
    return empty;
  }
  if (progress.empty === true) return empty;
  if (progress.all_unlocked === true) {
    return {
      mode: "all_unlocked",
      text: String(t("chat.ourMomentsBarAllUnlocked") || "").trim(),
      n: null,
      before: "",
      after: "",
    };
  }
  const n = Number(progress.remaining_messages);
  if (!Number.isFinite(n) || n < 0) return empty;
  // 用占位拆段，便于数字加粗
  const marker = "\u0001";
  let raw = "";
  try {
    raw = String(t("chat.ourMomentsBarCountdown", { n: marker }) || "");
  } catch {
    raw = "";
  }
  if (!raw.includes(marker)) {
    raw = String(t("chat.ourMomentsBarCountdown", { n }) || "").replace(
      /\{n\}/g,
      marker
    );
  }
  const parts = raw.split(marker);
  const before = parts[0] || "";
  const after = parts.length > 1 ? parts.slice(1).join(String(n)) : "";
  const text = `${before}${n}${after}`.trim();
  return { mode: "countdown", text, n, before, after };
}

/** 解锁成功 tip 副文案拆段（仅拼纯文本展示） */
export function formatOurMomentsUnlockedBodyParts(t) {
  if (typeof t !== "function") {
    return { before: "", viewProfile: "", mid: "", ourMoments: "", after: "" };
  }
  return {
    before: String(t("chat.ourMomentsUnlockedBodyBefore") || ""),
    viewProfile: String(t("chat.ourMomentsUnlockedLinkProfile") || ""),
    mid: String(t("chat.ourMomentsUnlockedBodyMid") || ""),
    ourMoments: String(t("chat.ourMomentsUnlockedLinkAlbum") || ""),
    after: String(t("chat.ourMomentsUnlockedBodyAfter") || ""),
  };
}

/** 归一化 HTTP / WS 进度字段 */
export function normalizeOurMomentsProgress(raw, companionId = "") {
  const src = raw && typeof raw === "object" ? raw : {};
  const remaining = Number(src.remaining_messages);
  return {
    companionId: String(companionId || src.companion_id || "").trim(),
    empty: src.empty === true,
    all_unlocked: src.all_unlocked === true,
    remaining_messages: Number.isFinite(remaining) ? remaining : 0,
    photo_count: Number(src.photo_count) || 0,
    unlocked_count: Number(src.unlocked_count) || 0,
    unlock_x: Number(src.unlock_x) || 0,
    ts: Date.now(),
  };
}

/** 相册锁定封面短进度（同样只认 remaining_messages） */
export function formatOurMomentsRemainingLabel(remainingMessages, t) {
  if (typeof t !== "function") return "";
  const n = Number(remainingMessages);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(t("companionProfile.ourMomentsRemaining", { n }) || "")
    .replace(/\{n\}/g, String(n))
    .trim();
}

/** 每次 WS tip 写入本地，供充值页读取（navigate 会清掉内存 toast） */
export function rememberOurMomentsTip(text) {
  const t = String(text || "").trim();
  if (!t) return;
  try {
    setItem(TIP_STORAGE_KEY, JSON.stringify({ text: t, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** 读取最近 tip；过期返回空串 */
export function readRecentOurMomentsTip(maxAgeMs = OUR_MOMENTS_TIP_RECENT_MS) {
  try {
    const raw = getItem(TIP_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const text = String(parsed?.text || "").trim();
    const ts = Number(parsed?.ts || 0);
    if (!text || !Number.isFinite(ts)) return "";
    if (Date.now() - ts > maxAgeMs) return "";
    return text;
  } catch {
    return "";
  }
}

/**
 * 拉取私密相册列表（需登录；与 /moments 一样直接返回对象）
 * @param {string|number} companionId
 */
export async function fetchOurMoments(companionId) {
  const id = String(companionId || "").trim();
  if (!id) throw new Error("missing companion id");
  return apiFetch(`/api/companions/${encodeURIComponent(id)}/our-moments`);
}

function unlockReportedKey() {
  const uid = readCurrentUserId() || "anon";
  return `our_moments_unlock_reported_v1_${uid}`;
}

function readUnlockReported() {
  try {
    const raw = getItem(unlockReportedKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeUnlockReported(map) {
  try {
    setItem(unlockReportedKey(), JSON.stringify(map || {}));
  } catch {
    /* ignore */
  }
}

/**
 * 每张照片首次解锁成功上报一次（WS toast=unlocked 的 just_unlocked）
 * @param {string|number} companionId
 * @param {Array<{ photo_id?: string|number, id?: string|number }>} justUnlocked
 * @param {number} [photoCount]
 */
export function trackOurMomentsUnlockOnce(companionId, justUnlocked, photoCount) {
  const agentId = String(companionId || "").trim();
  if (!agentId || !Array.isArray(justUnlocked) || !justUnlocked.length) return;

  const map = readUnlockReported();
  const seen = new Set(
    Array.isArray(map[agentId]) ? map[agentId].map((x) => String(x)) : []
  );
  let changed = false;

  for (const row of justUnlocked) {
    const photoId = String(row?.photo_id ?? row?.id ?? "").trim();
    if (!photoId || seen.has(photoId)) continue;
    seen.add(photoId);
    changed = true;
    trackProductEvent(
      PRODUCT_EVENTS.OUR_MOMENTS_PHOTO_UNLOCK,
      withCompanionId(
        {
          page: "chat",
          agent_id: agentId,
          photo_id: photoId,
          photo_count: Number(photoCount) || 0,
        },
        agentId
      )
    );
  }

  if (changed) {
    map[agentId] = [...seen];
    writeUnlockReported(map);
  }
}

/**
 * 点击详情页 Our Moments 入口
 * @param {string|number} companionId
 */
export function trackOurMomentsEntryClick(companionId) {
  const agentId = String(companionId || "").trim();
  if (!agentId) return;
  trackProductEvent(
    PRODUCT_EVENTS.OUR_MOMENTS_ENTRY_CLICK,
    withCompanionId(
      {
        page: "companion",
        agent_id: agentId,
      },
      agentId
    )
  );
}

/**
 * Our Moments 页/Tab 成功展示
 * @param {string|number} companionId
 * @param {number} [photoCount]
 */
export function trackOurMomentsView(companionId, photoCount) {
  const agentId = String(companionId || "").trim();
  if (!agentId) return;
  trackProductEvent(
    PRODUCT_EVENTS.OUR_MOMENTS_VIEW,
    withCompanionId(
      {
        page: "companion",
        agent_id: agentId,
        photo_count: Number(photoCount) || 0,
      },
      agentId
    )
  );
}

/**
 * 大图预览成功打开
 * @param {string|number} companionId
 * @param {string|number} photoId
 * @param {number} [photoCount]
 */
export function trackOurMomentsPreview(companionId, photoId, photoCount) {
  const agentId = String(companionId || "").trim();
  const pid = String(photoId || "").trim();
  if (!agentId || !pid) return;
  trackProductEvent(
    PRODUCT_EVENTS.OUR_MOMENTS_PHOTO_PREVIEW,
    withCompanionId(
      {
        page: "companion",
        agent_id: agentId,
        photo_id: pid,
        photo_count: Number(photoCount) || 0,
      },
      agentId
    )
  );
}
