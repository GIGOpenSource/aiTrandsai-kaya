/**
 * 朋友圈评论次数上限（业务码 460）：同一用户 + 同一条动态。
 * 智能体回复无 user_id，不计入。
 * 点「去私聊」：POST confirm-im 写入该动态卡片，草稿进输入框，聊天页自动唤起键盘。
 */

import apiFetch from "@/utils/api";
import {
  markCommentImFocus,
  stashCommentImDraft,
  stashCommentImSnap,
} from "@/utils/chatDraft";
export {
  markCommentImFocus,
  consumeCommentImFocus,
  stashCommentImDraft,
  stashCommentImSnap,
} from "@/utils/chatDraft";

export function parseMomentCommentLimit(data, err) {
  const body =
    data && typeof data === "object"
      ? data
      : err?.body && typeof err.body === "object"
        ? err.body
        : null;
  const results =
    body?.results && typeof body.results === "object" ? body.results : body;
  const code = Number(body?.code ?? err?.status);
  const hit =
    code === 460 ||
    results?.error_code === "comment_limit_reached" ||
    body?.error_code === "comment_limit_reached";
  if (!hit) return null;

  const raw = Number(
    results?.commented_count ?? results?.used ?? results?.limit ?? 0
  );
  const count = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return {
    count,
    companionId: String(results?.companion_id || body?.companion_id || ""),
    momentId: results?.moment_id ?? body?.moment_id ?? "",
  };
}

export async function confirmMomentIm(momentId) {
  const id = momentId != null ? String(momentId).trim() : "";
  if (!id) return null;
  return apiFetch(`/api/moments/${encodeURIComponent(id)}/confirm-im`, {
    method: "POST",
  });
}

export function goMomentCompanionChat(companionId) {
  const id = String(companionId || "").trim();
  if (!id) return;
  uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}` });
}

/**
 * 点「去私聊」：先 confirm-im，再跳转。
 * already=false：本次新写入，把卡片快照交给聊天页展示。
 * already=true：不本地插卡，只打开会话，卡片以聊天记录为准；草稿进输入框正常发送。
 */
export async function prepareCommentLimitChat({ companionId, momentId, draft } = {}) {
  let cid = String(companionId || "").trim();
  const mid = momentId != null ? String(momentId).trim() : "";
  try {
    if (mid) {
      const data = await confirmMomentIm(mid);
      const r = (data && data.results && typeof data.results === "object")
        ? data.results
        : data || {};
      cid = String(r.companion_id || cid).trim();
      const already =
        r.already === true || r.already === 1 || r.already === "true";
      if (cid && r.moment && !already) stashCommentImSnap(cid, r.moment);
    }
  } catch {
    /* 仍进私聊，历史里可能已有卡片 */
  }
  if (!cid) return;
  const text = String(draft || "").trim();
  if (text) stashCommentImDraft(cid, text);
  else markCommentImFocus(cid);
  goMomentCompanionChat(cid);
}
