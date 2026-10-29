/**
 * @file notifications.js
 * @description 通知列表聚合：新动态、AI 回复用户评论、聊天未读、系统公告。
 * @depends storage.js
 */

import { getItem, setItem } from "./storage";

export const REPLIES_VIEWED_KEY = "moment_replies_viewed";
export const LOCAL_REPLY_NOTIFS_KEY = "moment_reply_notifs_v1";

/** @param {string|null|undefined} raw */
export function parseStoredIdList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "number" || typeof item === "string" ? String(item) : null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function readViewedReplyIds() {
  return parseStoredIdList(getItem(REPLIES_VIEWED_KEY));
}

/** @param {(string|number)[]} ids */
export function writeViewedReplyIds(ids) {
  const uniq = Array.from(new Set((ids || []).map((id) => String(id))));
  setItem(REPLIES_VIEWED_KEY, JSON.stringify(uniq));
}

/** @returns {any[]} */
export function readLocalReplyNotifs() {
  try {
    const raw = getItem(LOCAL_REPLY_NOTIFS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @param {any[]} items */
export function writeLocalReplyNotifs(items) {
  try {
    setItem(LOCAL_REPLY_NOTIFS_KEY, JSON.stringify((items || []).slice(0, 50)));
  } catch {
    /* quota */
  }
}

/**
 * AI 回复到达时写入本地通知（解决 feed 只带最早评论导致漏通知）
 * @param {{
 *   replyId: string|number,
 *   momentId: string|number,
 *   title: string,
 *   content: string,
 *   avatar?: string,
 *   imageUrl?: string,
 *   time?: string,
 *   companionId?: string,
 * }} payload
 */
export function recordLocalReplyNotif(payload) {
  if (!payload?.replyId || !payload?.momentId) return;
  const replyId = String(payload.replyId);
  const prev = readLocalReplyNotifs().filter((n) => String(n.replyId) !== replyId);
  writeLocalReplyNotifs([
    {
      replyId,
      momentId: payload.momentId,
      title: payload.title || "",
      content: payload.content || "",
      avatar: payload.avatar || "",
      imageUrl: payload.imageUrl || "",
      time: payload.time || new Date().toISOString(),
      companionId: payload.companionId || "",
    },
    ...prev,
  ]);
}

/**
 * 从评论列表中找出「AI 回复了用户评论」的条目
 * @param {any[]} comments
 */
export function findAiRepliesToUser(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const myIds = new Set(
    list.filter((c) => c && c.is_user).map((c) => String(c.id))
  );
  if (!myIds.size) return [];
  return list.filter((c) => {
    if (!c || c.is_user) return false;
    if (c.parent_id == null || c.parent_id === "") return false;
    return myIds.has(String(c.parent_id));
  });
}

/**
 * 合并 API 朋友圈与首页缓存评论（缓存常含轮询到的 AI 回复）
 * @param {any[]} apiMoments
 * @param {any[]} cachedMoments
 */
export function mergeMomentsComments(apiMoments, cachedMoments) {
  const byId = new Map();
  for (const m of apiMoments || []) {
    if (m?.id == null) continue;
    byId.set(String(m.id), { ...m, comments: [...(m.comments || [])] });
  }
  for (const m of cachedMoments || []) {
    if (m?.id == null) continue;
    const key = String(m.id);
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { ...m });
      continue;
    }
    const map = new Map((existing.comments || []).map((c) => [String(c.id), c]));
    for (const c of m.comments || []) {
      map.set(String(c.id), c);
    }
    byId.set(key, {
      ...existing,
      comments: [...map.values()],
      comments_count: Math.max(
        existing.comments_count || 0,
        m.comments_count || 0,
        map.size
      ),
    });
  }
  return [...byId.values()];
}

/**
 * 新朋友圈动态通知
 * @param {any[]} moments
 * @param {string|null} lastViewed
 * @param {(k: string) => string} t
 */
export function buildMomentPostItems(moments, lastViewed, t) {
  return (moments || []).map((m) => {
    const isUnread = lastViewed
      ? new Date(String(m.created_at)).getTime() > new Date(lastViewed).getTime()
      : true;
    return {
      id: `moment-${m.id}`,
      type: "moment",
      title: m.companion_name || t("home.defaultCompanionName"),
      content: m.caption || "",
      avatar:
        m.companion_avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.companion_id}`,
      imageUrl: m.image_url,
      time: m.created_at,
      read: !isUnread,
      momentId: m.id,
      companionId: m.companion_id,
    };
  });
}

/**
 * AI 回复用户评论 → 通知（合并本地记录 + 评论扫描）
 * @param {any[]} moments
 * @param {string[]} viewedReplyIds
 * @param {(k: string, o?: object) => string} t
 */
export function buildMomentReplyItems(moments, viewedReplyIds, t) {
  const viewed = new Set((viewedReplyIds || []).map(String));
  const byReplyId = new Map();

  for (const local of readLocalReplyNotifs()) {
    if (!local?.replyId) continue;
    const replyId = String(local.replyId);
    byReplyId.set(replyId, {
      id: `reply-${replyId}`,
      type: "moment",
      subtype: "reply",
      title: local.title || t("home.defaultCompanionName"),
      content: t("notifications.replyToYou", { content: local.content || "" }),
      avatar: local.avatar || "",
      imageUrl: local.imageUrl || "",
      time: local.time || new Date().toISOString(),
      read: viewed.has(replyId),
      momentId: local.momentId,
      companionId: local.companionId || "",
      replyId,
    });
  }

  for (const m of moments || []) {
    const replies = findAiRepliesToUser(m.comments);
    for (const c of replies) {
      const replyId = String(c.id);
      byReplyId.set(replyId, {
        id: `reply-${replyId}`,
        type: "moment",
        subtype: "reply",
        title: c.companion_name || m.companion_name || t("home.defaultCompanionName"),
        content: t("notifications.replyToYou", { content: c.content || "" }),
        avatar:
          m.companion_avatar ||
          `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.companion_id || m.companion_id}`,
        imageUrl: m.image_url,
        time: c.created_at || m.created_at,
        read: viewed.has(replyId),
        momentId: m.id,
        companionId: c.companion_id || m.companion_id,
        replyId,
      });
    }
  }

  return [...byReplyId.values()];
}

/**
 * 首页铃铛：是否有未读（新动态 / AI 回复评论；聊天未读只在 IM 列表）
 * @param {any[]} moments
 */
export function computeHomeHasUnread(moments) {
  const lastViewed = getItem("moments_last_viewed");
  const hasNewMoment = (moments || []).some((m) => {
    if (!lastViewed) return true;
    return new Date(String(m.created_at)).getTime() > new Date(lastViewed).getTime();
  });
  if (hasNewMoment) return true;

  const viewed = new Set(readViewedReplyIds());
  for (const local of readLocalReplyNotifs()) {
    if (local?.replyId && !viewed.has(String(local.replyId))) return true;
  }
  for (const m of moments || []) {
    for (const c of findAiRepliesToUser(m.comments)) {
      if (!viewed.has(String(c.id))) return true;
    }
  }
  return false;
}
