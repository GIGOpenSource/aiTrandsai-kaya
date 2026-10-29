/**
 * @description 聊天消息时间格式化工具：将 ISO 时间转为界面语言对应的本地时间/日期展示。
 */

/**
 * 界面语言 → 该语言常用地区时区（用于把后端 UTC 转成对应日历日）。
 * 英文是全球默认语，用设备本地时区，避免人在东京却显示纽约日期。
 */
const LANG_TIME_ZONE = {
  zh: "Asia/Shanghai",
  ja: "Asia/Tokyo",
  ko: "Asia/Seoul",
  pt: "America/Sao_Paulo",
  es: "Europe/Madrid",
  id: "Asia/Jakarta",
  ar: "Asia/Riyadh",
};

const MONTH_SHORT = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};

/**
 * 界面语言对应的展示时区：有明确地区的用语区时区，否则用手机本地时区。
 * @param {string} lang
 * @returns {string|undefined} IANA 时区；undefined 表示设备本地
 */
export function resolveDisplayTimeZone(lang) {
  const base = (lang || "en").split("-")[0]?.toLowerCase() || "en";
  return LANG_TIME_ZONE[base];
}

/**
 * 把 UTC ISO 转成指定时区下的年月日（缺 ICU 时回退设备本地）。
 * @param {string|number|Date} isoOrDate
 * @param {string} [timeZone]
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function datePartsInZone(isoOrDate, timeZone) {
  const d =
    typeof isoOrDate === "object" && isoOrDate instanceof Date
      ? isoOrDate
      : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const opts = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    };
    if (timeZone) opts.timeZone = timeZone;
    const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(d);
    const num = (type) =>
      Number(parts.find((p) => p.type === type)?.value);
    const year = num("year");
    const month = num("month");
    const day = num("day");
    if (year && month && day) return { year, month, day };
  } catch {
    /* App 端部分 WebView 无 ICU */
  }
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

/**
 * 朋友圈等「超过一周」的绝对日期：按界面语言排版，按时区转日历日，始终带年份。
 * App 端不走 toLocaleDateString（缺 ICU 会变成 Thu Aug 19 或写死中文）。
 * @param {string|number|Date} isoOrDate
 * @param {string} lang
 * @returns {string}
 */
export function formatLocaleMonthDay(isoOrDate, lang) {
  const zone = resolveDisplayTimeZone(lang);
  const parts = datePartsInZone(isoOrDate, zone);
  if (!parts) return "";
  const { year, month, day } = parts;
  const base = (lang || "en").split("-")[0]?.toLowerCase() || "en";

  if (base === "zh" || base === "ja") {
    return `${year}年${month}月${day}日`;
  }
  if (base === "ko") {
    return `${year}년 ${month}월 ${day}일`;
  }
  const months = MONTH_SHORT[base] || MONTH_SHORT.en;
  const mon = months[Math.max(0, month - 1)] || MONTH_SHORT.en[month - 1];
  if (base === "en") {
    return `${mon} ${day}, ${year}`;
  }
  return `${day} ${mon} ${year}`;
}

/**
 * 将界面语言代码解析为 `toLocaleTimeString` / `toLocaleDateString` 可用的 locale 字符串。
 * @param {string} lang - 界面语言代码（如 zh、en-US）
 * @returns {string} BCP 47 locale（如 zh-CN、en-US）
 */
export function resolveMessageLocale(lang) {
  const base = (lang || "zh").split("-")[0]?.toLowerCase() || "zh";
  const map = {
    zh: "zh-CN",
    en: "en-US",
    ja: "ja-JP",
    ko: "ko-KR",
    pt: "pt-BR",
    es: "es-ES",
    id: "id-ID",
    ar: "ar-SA",
  };
  return map[base] || lang || "zh-CN";
}

/**
 * 格式化单条消息的发送时间（仅时分，不含日期）。
 * @param {string|number|Date} isoOrDate - ISO 字符串、时间戳或 Date 对象
 * @param {string} lang - 界面语言代码
 * @returns {string} 本地化时间字符串，无效输入返回空字符串
 */
export function formatMessageTime(isoOrDate, lang) {
  const d =
    typeof isoOrDate === "object"
      ? isoOrDate
      : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const base = (lang || "zh").split("-")[0]?.toLowerCase() || "zh";
  const h = d.getHours();
  const m = d.getMinutes();
  // 12 小时制语言：en、es、id 用 AM/PM；其余用 24 小时制
  if (base === "en" || base === "es" || base === "id" || base === "ar") {
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }
  // zh、ja、ko、pt 用 24 小时制
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 格式化当前时刻的消息时间（用于「正在输入」等实时场景）。
 * @param {string} lang - 界面语言代码
 * @returns {string} 本地化时间字符串
 */
export function formatNowMessageTime(lang) {
  return formatMessageTime(new Date(), lang);
}

/**
 * 获取本地时区下某天的零点时间戳。
 * @param {Date} d - 日期对象
 * @returns {number} 毫秒时间戳
 */
function _startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 相对今天的本地日历日差（正数=过去，0=今天，1=昨天）。
 * @param {string|number|Date} isoOrDate
 * @returns {number|null} 无效输入返回 null
 */
function _localDayDiffFromToday(isoOrDate) {
  const d =
    typeof isoOrDate === "object" && isoOrDate instanceof Date
      ? isoOrDate
      : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((_startOfLocalDay(new Date()) - _startOfLocalDay(d)) / 86400000);
}

/**
 * 日期分隔条是否展示具体年月日（非「今天 / 昨天」）。
 * 仅此时气泡旁时间才拼上同一条日期文案。
 * @param {string|number|Date} isoOrDate
 * @returns {boolean}
 */
export function chatSeparatorShowsCalendarDate(isoOrDate) {
  const diffDays = _localDayDiffFromToday(isoOrDate);
  if (diffDays == null) return false;
  return diffDays !== 0 && diffDays !== 1;
}

/**
 * 气泡旁时间：今天/昨天只显示时分；分隔条为具体年月日时，拼上同一条文案。
 * @param {string|number|Date} isoOrDate
 * @param {string} lang
 * @param {string} [timeOnly] 已格式化的时分；缺省则按语言现算
 * @returns {string}
 */
export function formatBubbleFootTime(isoOrDate, lang, timeOnly) {
  const time = timeOnly || formatMessageTime(isoOrDate, lang);
  if (!time) return "";
  if (!chatSeparatorShowsCalendarDate(isoOrDate)) return time;
  const dateLabel = formatChatDateSeparator(isoOrDate, lang);
  return dateLabel ? `${dateLabel} ${time}` : time;
}

/**
 * 聊天列表日期分隔文案：今天 / 昨天 / 其余显示本地化具体日期。
 * @param {string} iso - ISO 时间字符串
 * @param {string} lang - 界面语言代码
 * @returns {string} 分隔标签文案，无效输入返回空字符串
 */
export function formatChatDateSeparator(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffDays = _localDayDiffFromToday(d);
  const base = (lang || "zh").split("-")[0]?.toLowerCase() || "zh";
  const today = {
    zh: "今天",
    en: "Today",
    ja: "今日",
    ko: "오늘",
    pt: "Hoje",
    es: "Hoy",
    id: "Hari ini",
    ar: "اليوم",
  };
  const yesterday = {
    zh: "昨天",
    en: "Yesterday",
    ja: "昨日",
    ko: "어제",
    pt: "Ontem",
    es: "Ayer",
    id: "Kemarin",
    ar: "أمس",
  };
  if (diffDays === 0) return today[base] || today.en;
  if (diffDays === 1) return yesterday[base] || yesterday.en;
  // 中文手动拼接：App 端 toLocaleDateString 常缺 ICU，会退化成 "Thu Aug 13 2026"
  if (base === "zh") {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  const loc = resolveMessageLocale(lang);
  return d.toLocaleDateString(loc, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * 从 ISO 时间生成日历日唯一键（用于消息分组）。
 * @param {string} iso - ISO 时间字符串
 * @returns {string} 形如 YYYY-M-D 的键，无效输入返回空字符串
 */
export function calendarDayKeyFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
