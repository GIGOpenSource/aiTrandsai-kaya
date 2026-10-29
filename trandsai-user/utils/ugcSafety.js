/**
 * @file ugcSafety.js
 * @description UGC 安全：本地屏蔽用户 + 通过反馈通道举报内容（App Store 1.2）
 */
import { getItem, setItem } from "@/utils/storage";
import apiFetch from "@/utils/api";

const BLOCKED_KEY = "ugc_blocked_user_ids";

function readBlockedIds() {
  try {
    const raw = getItem(BLOCKED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function writeBlockedIds(ids) {
  setItem(BLOCKED_KEY, JSON.stringify([...new Set(ids.map(String))]));
}

export function getBlockedUserIds() {
  return readBlockedIds();
}

export function isUserBlocked(userId) {
  if (userId == null || userId === "") return false;
  return readBlockedIds().includes(String(userId));
}

export function blockUser(userId) {
  const id = String(userId || "");
  if (!id) return false;
  const next = readBlockedIds();
  if (!next.includes(id)) next.push(id);
  writeBlockedIds(next);
  return true;
}

export function unblockUser(userId) {
  const id = String(userId || "");
  writeBlockedIds(readBlockedIds().filter((x) => x !== id));
}

/** 列表过滤：去掉已屏蔽作者的帖子 */
export function filterBlockedPosts(posts) {
  const blocked = new Set(readBlockedIds());
  if (!blocked.size) return posts || [];
  return (posts || []).filter((p) => {
    const uid = p?.user_id ?? p?.author_id ?? p?.user?.id;
    return uid == null || !blocked.has(String(uid));
  });
}

/**
 * 历史：把 UGC 写进客服 Feedback。帖子请用 POST /api/posts/{id}/report，
 * 不要再走 /api/feedback/messages。
 * @param {{ type: string, targetId: string|number, reason?: string, extra?: string }} payload
 */
export async function reportUgcContent(payload) {
  const type = payload?.type || "content";
  const targetId = payload?.targetId ?? "";
  const reason = (payload?.reason || "objectionable").trim();
  const extra = (payload?.extra || "").trim();
  const lines = [
    "[UGC Report]",
    `type=${type}`,
    `target_id=${targetId}`,
    `reason=${reason}`,
  ];
  if (extra) lines.push(`note=${extra}`);
  lines.push("Please review and remove within 24 hours if it violates the Terms.");
  const content = lines.join("\n");
  await apiFetch("/api/feedback/messages", {
    method: "POST",
    data: { content },
  });
  return true;
}
