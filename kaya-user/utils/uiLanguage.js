/**
 * @description 界面语言规范化：与后端 normalize_ui_language 对齐，保证 IM 的 lang 与 i18n 一致。
 */

/** 当前对用户开放的 UI 语言（zh 暂隐藏，文案文件仍保留） */
const ENABLED = new Set(["en", "ja", "ko", "pt", "es", "id", "ar", "fa", "ru", "bg", "tr"]);
const SUPPORTED = new Set(["zh", "en", "ja", "ko", "pt", "es", "id", "ar", "fa", "ru", "bg", "tr"]);

/**
 * 将任意语言标识规范化为受支持的 UI 语言代码。
 * @param {string|null|undefined} lang - 原始语言标识（如 zh-CN、en_US）
 * @returns {string} 规范后的语言代码；获取不到 / 未知 / 已隐藏的 zh 时回退 "en"
 */
export function normalizeUiLang(lang) {
  if (!lang || typeof lang !== "string") return "en";
  const cleaned = lang.trim().replace(/_/g, "-");
  const lower = cleaned.toLowerCase();
  // 中文暂不对外开放：系统/历史偏好为 zh 时回退 en，避免 UI 无文案
  if (lower.startsWith("zh")) return "en";
  const base = cleaned.split("-")[0]?.toLowerCase() ?? "";
  if (base && ENABLED.has(base)) return base;
  if (base && SUPPORTED.has(base) && !ENABLED.has(base)) return "en";
  return "en";
}
