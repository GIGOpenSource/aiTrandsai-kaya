/**
 * @file chatDraft.js
 * @description 聊天输入框草稿：按用户 + 伴侣维度本地缓存未发送文案与时间。
 */

import { getItem, setItem, removeItem } from "@/utils/storage";
import { getCurrentUserId } from "@/composables/useAuth";

const DRAFT_PREFIX = "chat_draft:";

function draftKey(companionId) {
  const uid = getCurrentUserId() || "anon";
  return `${DRAFT_PREFIX}${uid}:${String(companionId || "").trim()}`;
}

/**
 * @param {string|number} companionId
 * @returns {{ text: string, updatedAt: number }}
 */
export function readChatDraftEntry(companionId) {
  if (!companionId) return { text: "", updatedAt: 0 };
  try {
    const raw = getItem(draftKey(companionId));
    if (!raw) return { text: "", updatedAt: 0 };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const text = String(parsed.text || "");
        const updatedAt = Number(parsed.updatedAt) || 0;
        if (!text.trim()) return { text: "", updatedAt: 0 };
        return { text, updatedAt };
      }
    } catch {
      /* 旧版纯文本 */
    }
    const text = String(raw);
    if (!text.trim()) return { text: "", updatedAt: 0 };
    return { text, updatedAt: 0 };
  } catch {
    return { text: "", updatedAt: 0 };
  }
}

/** @param {string|number} companionId */
export function readChatDraft(companionId) {
  return readChatDraftEntry(companionId).text;
}

/** @param {string|number} companionId @param {string} text */
export function writeChatDraft(companionId, text) {
  if (!companionId) return;
  const key = draftKey(companionId);
  const value = String(text || "");
  if (!value.trim()) {
    removeItem(key);
    return;
  }
  setItem(
    key,
    JSON.stringify({
      text: value,
      updatedAt: Date.now(),
    })
  );
}

/** @param {string|number} companionId */
export function clearChatDraft(companionId) {
  if (!companionId) return;
  removeItem(draftKey(companionId));
}

/** @param {number} updatedAt */
export function draftTimeIso(updatedAt) {
  const n = Number(updatedAt);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n).toISOString();
}

const COMMENT_IM_FOCUS_PREFIX = "comment_im_focus:";

/** 评论上限进私聊：标记进页后自动唤起键盘（勿从 nvue 引用带 pinia 的模块） */
export function markCommentImFocus(companionId) {
  const id = String(companionId || "").trim();
  if (!id) return;
  setItem(COMMENT_IM_FOCUS_PREFIX + id, "1");
}

export function consumeCommentImFocus(companionId) {
  const id = String(companionId || "").trim();
  if (!id) return false;
  const key = COMMENT_IM_FOCUS_PREFIX + id;
  const hit = getItem(key) === "1";
  if (hit) removeItem(key);
  return hit;
}

export function stashCommentImDraft(companionId, draft) {
  const id = String(companionId || "").trim();
  const text = String(draft || "").trim();
  if (!id || !text) return;
  writeChatDraft(id, text);
  markCommentImFocus(id);
}

const COMMENT_IM_SNAP_PREFIX = "comment_im_snap:";

/** confirm-im 返回的动态快照，进聊天页后插入为最新一条 */
export function stashCommentImSnap(companionId, snap) {
  const id = String(companionId || "").trim();
  if (!id || !snap || typeof snap !== "object") return;
  try {
    setItem(COMMENT_IM_SNAP_PREFIX + id, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

export function consumeCommentImSnap(companionId) {
  const id = String(companionId || "").trim();
  if (!id) return null;
  const key = COMMENT_IM_SNAP_PREFIX + id;
  try {
    const raw = getItem(key);
    removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    try {
      removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}
