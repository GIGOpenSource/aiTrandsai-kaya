/**
 * @file chatHelpers.js
 * @description 聊天 store 纯函数：WS origin、payload、去重键、存储键、退避。
 */
import { i18n } from "@/i18n";
import { getItem } from "@/utils/storage";
import { formatMessageTime } from "@/utils/chatTime";

/** 无登录态时的持久化分区 */
export const ANON_USER_KEY = "__anon__";

/** 从 user_info 解析当前用户 ID；无则 __anon__ */
export function resolveChatUserId() {
  try {
    const raw = getItem("user_info");
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.id != null && String(u.id) !== "") return String(u.id);
    }
  } catch {
    /* ignore */
  }
  return ANON_USER_KEY;
}

export function unreadStorageKey(uid = resolveChatUserId()) {
  return `chat_unread_${uid}`;
}

export function lastMessagesStorageKey(uid = resolveChatUserId()) {
  return `chat_last_messages_${uid}`;
}

export function outboxStorageKey(uid = resolveChatUserId()) {
  return `chat_outbox_${uid}`;
}

/** 评论上限进私聊：把动态快照收成会话卡片用的字段 */
export function normalizeMomentCardData(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const nested =
    data.moment && typeof data.moment === "object" ? data.moment : data;
  const moment_id = String(
    nested.moment_id ?? nested.id ?? data.moment_id ?? data.id ?? ""
  ).trim();
  const caption = String(nested.caption ?? data.caption ?? "").trim();
  const image_url = pickMomentCardImage(nested) || pickMomentCardImage(data);
  const liked = !!(nested.liked ?? nested.is_liked ?? data.liked);
  if (!moment_id && !caption && !image_url) return null;
  return { moment_id, caption, image_url, liked };
}

/** 聊天里的朋友圈卡片只取一张图，不展示张数 */
export function pickMomentCardImage(data) {
  if (!data || typeof data !== "object") return "";
  const direct = String(data.image_url || data.preview_url || "").trim();
  if (direct) return direct;
  const imgs = data.images;
  if (!Array.isArray(imgs) || !imgs.length) return "";
  const first = imgs[0];
  if (typeof first === "string") return first.trim();
  if (first && typeof first === "object") {
    return String(first.url || first.image_url || first.preview_url || "").trim();
  }
  return "";
}

/** moment 气泡文案：禁止把整段 JSON 塞进气泡 */
export function formatMomentBubbleText(parsed, fallback = "") {
  if (parsed && typeof parsed === "object") {
    const caption = parsed.caption;
    if (typeof caption === "string" && caption.trim()) return caption.trim();
    try {
      return i18n.global.t("chat.momentShared");
    } catch {
      return "";
    }
  }
  if (typeof fallback === "string" && fallback.trim().startsWith("{")) {
    try {
      return i18n.global.t("chat.momentShared");
    } catch {
      return "";
    }
  }
  return typeof fallback === "string" ? fallback : "";
}

/**
 * 解析 WebSocket 根地址：优先 VITE_WS_URL；H5 用当前 host；
 * 否则由 VITE_API_BASE_URL 推导；再否则生产 wss。
 */
export function getWsOrigin() {
  const explicit = (import.meta.env.VITE_WS_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // #ifdef H5
  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  } catch {
    /* fallthrough */
  }
  // #endif
  const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (apiBase.startsWith("https://")) return apiBase.replace(/^https:/, "wss:");
  if (apiBase.startsWith("http://")) return apiBase.replace(/^http:/, "ws:");
  return "wss://www.trandsai.com";
}

/** 组装发往服务端的聊天 payload（含时区） */
export function buildChatWsPayload(text, lang, userGender) {
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* ignore */
  }
  let tz_offset;
  try {
    tz_offset = new Date().getTimezoneOffset();
  } catch {
    /* ignore */
  }
  return { text, lang, user_gender: userGender, tz, tz_offset };
}

/** 策略配图消息：content_type=image + image_url（会员才下发） */
export function normalizeMessageImageUrl(raw) {
  return String(raw?.image_url ?? raw?.imageUrl ?? "").trim();
}

export function normalizeMessageContentType(raw) {
  return String(raw?.content_type ?? raw?.contentType ?? "")
    .trim()
    .toLowerCase();
}

export function isChatImageMessage(m) {
  if (!m) return false;
  if (normalizeMessageContentType(m) === "image") return true;
  return Boolean(normalizeMessageImageUrl(m));
}

/** 会话列表 / lastMessages 预览文案 */
export function formatChatImagePreviewText(t) {
  try {
    if (typeof t === "function") {
      const s = String(t("chat.imageMessage") || "").trim();
      if (s) return s;
    }
  } catch {
    /* ignore */
  }
  try {
    const s = String(i18n.global.t("chat.imageMessage") || "").trim();
    if (s) return s;
  } catch {
    /* ignore */
  }
  return "[Image]";
}

/** 去重键：sender + 类型标识 + 文本/图片 URL */
export function messageContentKey(m) {
  if (m?.momentData) {
    return `${m.sender}\0moment\0${(m.text || "").trim()}`;
  }
  if (isChatImageMessage(m)) {
    return `${m.sender}\0image\0${normalizeMessageImageUrl(m)}`;
  }
  return `${m.sender}\0normal\0${(m.text || "").trim()}`;
}

/** 排序键：优先用 ts，回退 timestamp */
export function timeKey(m) {
  const raw = m.ts || m.timestamp || "";
  const ms = raw ? Date.parse(raw) : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

/** 指数退避 + ±30% 抖动，避免大量客户端同步重连 */
export function reconnectDelayMs(attempts) {
  const base = Math.min(1000 * Math.pow(2, attempts), 30000);
  const jitter = 0.7 + Math.random() * 0.6;
  return Math.floor(base * jitter);
}

/**
 * 轮询 REST 聊天 job。
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export async function pollChatTurnJob(apiFetch, jobId, { attempts = 48, intervalMs = 2500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const st = await apiFetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
    const status = st?.status || st?.data?.status;
    if (status === "done") return { ok: true };
    if (status === "failed") {
      return { ok: false, error: st?.error || st?.data?.error || "job failed" };
    }
  }
  return { ok: false, error: "job timeout" };
}

/** REST 历史行 → 前端气泡结构 */
export function formatHistoryIncoming(companionId, rawMessages, locale) {
  return (rawMessages || []).map((m, idx) => {
    let sender = "ai";
    let text = m.content || m.text || "";
    let momentData = null;
    const imageUrl = normalizeMessageImageUrl(m);
    const rawType = normalizeMessageContentType(m);
    const isImage = rawType === "image" || Boolean(imageUrl);
    if (m.role === "user") {
      sender = "user";
    } else if (m.role === "moment") {
      sender = "user";
      try {
        const parsed =
          typeof m.content === "string" ? JSON.parse(m.content) : m.content;
        momentData = normalizeMomentCardData(parsed) || parsed;
        text = formatMomentBubbleText(momentData || parsed, "") || text;
      } catch {
        text = formatMomentBubbleText(null, m.content || "") || text;
      }
    } else if (m.role === "system") {
      sender = "system";
    }
    if (isImage && !momentData) {
      text = "";
    }
    const ts =
      typeof m.timestamp === "string" ? m.timestamp : new Date().toISOString();
    const sendStatus =
      String(m.send_status ?? m.sendStatus ?? "").trim() === "unpaid"
        ? "unpaid"
        : "";
    const rawId = m.id;
    const id =
      rawId != null && String(rawId) !== ""
        ? rawId
        : `s-${companionId}-${idx}-${ts}`;
    return {
      id,
      companionId: String(companionId),
      sender,
      text,
      momentData,
      contentType: isImage && !momentData ? "image" : rawType || "text",
      imageUrl: isImage && !momentData ? imageUrl : "",
      sendStatus,
      time: m.timestamp ? formatMessageTime(m.timestamp, locale) : "",
      ts,
    };
  });
}

/**
 * 合并某会话的 REST 历史与内存气泡。
 * @returns {{ messages: object[], consumedTrustServer: boolean }}
 */
export function mergeCompanionHistory(base, companionId, incoming, mode, trustServer) {
  const id = String(companionId || "");
  const list = base || [];
  const forCompanion = list.filter((m) => String(m.companionId) === id);
  const others = list.filter((m) => String(m.companionId) !== id);
  const normalized = (incoming || []).map((m) =>
    String(m.companionId) === id ? m : { ...m, companionId: id }
  );

  if (mode === "initial") {
    if (trustServer) {
      const seen = new Set();
      const merged = [];
      for (const m of normalized) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          merged.push(m);
        }
      }
      merged.sort((a, b) => timeKey(a) - timeKey(b));
      return { messages: [...others, ...merged], consumedTrustServer: true };
    }
    const liveByContent = new Map();
    for (const m of forCompanion) {
      const ck = messageContentKey(m);
      if (!liveByContent.has(ck)) liveByContent.set(ck, m);
    }
    const seen = new Set();
    const merged = [];
    // 先放服务端行，但若本地已有同内容气泡，保留本地 id，避免乐观发送后 key 被换导致闪一下
    for (const m of normalized) {
      const ck = messageContentKey(m);
      const live = liveByContent.get(ck);
      const keep = live
        ? { ...m, id: live.id, ts: live.ts || m.ts, time: live.time || m.time }
        : m;
      if (seen.has(keep.id)) continue;
      seen.add(keep.id);
      merged.push(keep);
      if (live) liveByContent.delete(ck);
    }
    for (const m of liveByContent.values()) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    merged.sort((a, b) => timeKey(a) - timeKey(b));
    return { messages: [...others, ...merged], consumedTrustServer: false };
  }

  const existingKeys = new Set(forCompanion.map(messageContentKey));
  const older = normalized.filter((m) => !existingKeys.has(messageContentKey(m)));
  const merged = [...older, ...forCompanion];
  merged.sort((a, b) => timeKey(a) - timeKey(b));
  return { messages: [...others, ...merged], consumedTrustServer: false };
}
