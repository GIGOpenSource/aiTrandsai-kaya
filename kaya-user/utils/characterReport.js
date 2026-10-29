/**
 * @file characterReport.js
 * @description C 端举报：理由列表共用；智能体 / 帖子 / 用户走不同提交接口。
 *
 *   GET  /api/report-reasons  （兼容 GET /api/companions/report-reasons）
 *   POST /api/companions/{id}/report
 *   POST /api/posts/{id}/report
 *   POST /api/users/{id}/report
 *
 * 客服 Feedback（/api/feedback/messages）不是帖子举报。
 */
import apiFetch, { unwrapApiResults } from "@/utils/api";

export const REPORT_REASON_EVENTS = {
  minor_safety: "Report_character_reason_minor_Click",
  sensitive: "Report_character_reason_sensitive_Click",
  disturbing: "Report_character_reason_disturbing_Click",
  copyright: "Report_character_reason_copyright_Click",
  other: "Report_character_reason_other_Click",
};

export const REPORT_SOURCES = ["profile", "chat", "moments"];
export const REPORT_SCENES = ["companion", "chat"];
export const POST_REPORT_SOURCES = ["feed", "detail", "profile", "moments"];
export const USER_REPORT_SOURCES = ["profile", "chat", "moments"];

const REMARK_MAX = 2000;
const CONTENT_MAX = 5000;

function pickList(data) {
  if (Array.isArray(data?.reasons)) return data.reasons;
  if (Array.isArray(data)) return data;
  return [];
}

function toReasonId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 展示文案：优先接口 zh/en，其它语言走 i18n。
 * @param {{ reason_code: string, label_zh?: string, label_en?: string }} reason
 * @param {string} locale
 * @param {(key: string) => string} t
 */
export function reportReasonLabel(reason, locale, t) {
  const lang = String(locale || "en").split("-")[0].toLowerCase();
  if (lang === "zh" && reason?.label_zh) return reason.label_zh;
  if (lang === "en" && reason?.label_en) return reason.label_en;
  const key = `characterReport.reasons.${reason?.reason_code}`;
  const translated = t(key);
  if (translated && translated !== key) return translated;
  return reason?.label_en || reason?.label_zh || String(reason?.reason_code || "");
}

export async function fetchReportReasons() {
  const body = await apiFetch("/api/report-reasons");
  const data = unwrapApiResults(body) || {};
  const list = pickList(data).filter(
    (item) => item?.reason_code || item?.id != null
  );
  if (list.length) return list;
  const fallback = await apiFetch("/api/companions/report-reasons");
  return pickList(unwrapApiResults(fallback) || {}).filter(
    (item) => item?.reason_code || item?.id != null
  );
}

/**
 * @param {{
 *   characterId: string|number,
 *   reasonId?: string|number|null,
 *   reasonCode?: string,
 *   remark?: string,
 *   content?: string,
 *   scene?: string,
 *   source?: string,
 * }} payload
 */
export async function submitCompanionReport(payload = {}) {
  const characterId = String(payload.characterId || "");
  const reasonId = toReasonId(payload.reasonId);
  const reasonCode = String(payload.reasonCode || "").trim();
  if (!characterId || (!reasonId && !reasonCode)) {
    throw new Error("invalid_report");
  }
  const scene = REPORT_SCENES.includes(payload.scene)
    ? payload.scene
    : "companion";
  const source = REPORT_SOURCES.includes(payload.source)
    ? payload.source
    : scene === "chat"
      ? "chat"
      : "profile";
  const remark = String(payload.remark || "").trim().slice(0, REMARK_MAX);
  const content = String(payload.content || "").trim().slice(0, CONTENT_MAX);
  const data = { scene, source };
  if (reasonId) data.reason_id = reasonId;
  if (reasonCode) data.reason_code = reasonCode;
  if (remark) data.remark = remark;
  if (content) data.content = content;

  const body = await apiFetch(
    `/api/companions/${encodeURIComponent(characterId)}/report`,
    { method: "POST", data }
  );
  return unwrapApiResults(body) || body;
}

/**
 * @param {{
 *   postId: string|number,
 *   reasonId?: string|number|null,
 *   reasonCode?: string,
 *   remark?: string,
 *   source?: string,
 * }} payload
 */
export async function submitPostReport(payload = {}) {
  const postId = String(payload.postId || "");
  const reasonId = toReasonId(payload.reasonId);
  const reasonCode = String(payload.reasonCode || "").trim();
  if (!postId || (!reasonId && !reasonCode)) {
    throw new Error("invalid_report");
  }
  const source = POST_REPORT_SOURCES.includes(payload.source)
    ? payload.source
    : "detail";
  const remark = String(payload.remark || "").trim().slice(0, REMARK_MAX);
  const data = { source };
  if (reasonId) data.reason_id = reasonId;
  if (reasonCode) data.reason_code = reasonCode;
  if (remark) data.remark = remark;

  const body = await apiFetch(
    `/api/posts/${encodeURIComponent(postId)}/report`,
    { method: "POST", data }
  );
  return unwrapApiResults(body) || body;
}

/**
 * @param {{
 *   userId: string|number,
 *   reasonId?: string|number|null,
 *   reasonCode?: string,
 *   remark?: string,
 *   source?: string,
 * }} payload
 */
export async function submitUserReport(payload = {}) {
  const userId = String(payload.userId || "");
  const reasonId = toReasonId(payload.reasonId);
  const reasonCode = String(payload.reasonCode || "").trim();
  if (!userId || (!reasonId && !reasonCode)) {
    throw new Error("invalid_report");
  }
  const source = USER_REPORT_SOURCES.includes(payload.source)
    ? payload.source
    : "profile";
  const remark = String(payload.remark || "").trim().slice(0, REMARK_MAX);
  const data = { source };
  if (reasonId) data.reason_id = reasonId;
  if (reasonCode) data.reason_code = reasonCode;
  if (remark) data.remark = remark;

  const body = await apiFetch(
    `/api/users/${encodeURIComponent(userId)}/report`,
    { method: "POST", data }
  );
  return unwrapApiResults(body) || body;
}

export { REMARK_MAX, CONTENT_MAX };

/** App 聊天 nvue 无法挂 Vue 弹窗，打开与智能体详情相同的举报页 */
export function openCharacterReportPage(opts = {}) {
  const params = [
    `id=${encodeURIComponent(String(opts.characterId || ""))}`,
    `source=${encodeURIComponent(String(opts.source || "chat"))}`,
  ];
  if (opts.messageId != null && String(opts.messageId) !== "") {
    params.push(`messageId=${encodeURIComponent(String(opts.messageId))}`);
  }
  const text = String(opts.messageText || "").slice(0, 800);
  if (text) params.push(`text=${encodeURIComponent(text)}`);
  if (opts.messageSender) {
    params.push(`sender=${encodeURIComponent(String(opts.messageSender))}`);
  }
  const url = `/pages-sub/report-character/index?${params.join("&")}`;
  uni.navigateTo({
    url,
    fail: () => {
      uni.navigateTo({ url, fail: () => {} });
    },
  });
}
