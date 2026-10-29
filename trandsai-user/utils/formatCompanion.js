/**
 * @file formatCompanion.js
 * @description 伴侣资料展示格式化（年龄单位空格、性别本地化等）。
 */
import { i18n } from "@/i18n";

/** 后端 / 表单应持久化的性向 key */
export const SEXUAL_ORIENTATION_KEYS = [
  "heterosexual",
  "homosexual",
  "bisexual",
  "pansexual",
  "asexual",
  "secret",
];

function readI18nMessages() {
  const g = i18n.global;
  const m = g.messages;
  if (m && typeof m === "object" && "value" in m) return m.value || {};
  if (typeof g.getLocaleMessage === "function") {
    const out = {};
    for (const loc of g.availableLocales || []) {
      out[loc] = g.getLocaleMessage(loc);
    }
    return out;
  }
  return m || {};
}

function orientationAliasMap() {
  const map = Object.create(null);
  for (const k of SEXUAL_ORIENTATION_KEYS) {
    map[k] = k;
    map[k.toLowerCase()] = k;
  }
  const messages = readI18nMessages();
  for (const loc of Object.keys(messages)) {
    const register = messages[loc]?.register || {};
    const nested = messages[loc]?.companionProfile?.sexualOrientation || {};
    for (const k of SEXUAL_ORIENTATION_KEYS) {
      for (const label of [register[k], nested[k]]) {
        const s = String(label || "").trim();
        if (s) map[s] = k;
      }
    }
  }
  return map;
}

/**
 * 把后端可能存的文案 / `register.xxx` 规范化成 homosexual 这类 key。
 * @param {unknown} raw
 * @param {string} [fallback]
 */
export function normalizeSexualOrientation(raw, fallback = "heterosexual") {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  const stripped = s.replace(/^register\./, "").trim();
  const map = orientationAliasMap();
  return map[stripped] || map[stripped.toLowerCase()] || map[s] || fallback;
}

/**
 * 性向展示文案。必须用静态 t('register.xxx')，App 模板里 t(`register.${var}`)
 * 会被编译成「register.」+ 已翻译文案。
 * @param {unknown} value
 * @param {(k: string) => string} t
 */
export function formatSexualOrientation(value, t) {
  const key = normalizeSexualOrientation(value);
  if (key === "homosexual") return t("register.homosexual");
  if (key === "bisexual") return t("register.bisexual");
  if (key === "pansexual") return t("register.pansexual");
  if (key === "asexual") return t("register.asexual");
  if (key === "secret") return t("register.secret");
  return t("register.heterosexual");
}

/**
 * @param {unknown} locale
 * @returns {string}
 */
export function uiLangCode(locale) {
  return String(locale || "zh").split("-")[0] || "zh";
}

/**
 * 性别文案本地化（后端存 男/女/保密）
 * @param {unknown} gender
 * @param {(k: string) => string} t
 */
export function formatCompanionGender(gender, t) {
  const g = String(gender || "").trim();
  if (!g) return "";
  if (g === "男" || g === "male") return t("register.male");
  if (g === "女" || g === "female") return t("register.female");
  if (g === "保密" || g === "secret") return t("register.secret");
  return g;
}

/**
 * 年龄 + 单位（英文等拉丁单位前补空格，避免 "24years old"）
 * @param {unknown} age
 * @param {(k: string) => string} t
 */
export function formatCompanionAge(age, t) {
  if (age == null || age === "") return "";
  const unit = String(t("companionProfile.ageUnit") || "").trim();
  if (!unit) return String(age);
  const needsSpace = /^[A-Za-z]/.test(unit);
  return `${age}${needsSpace ? " " : ""}${unit}`;
}

/**
 * 名称旁元信息：年龄 · 性别 · 城市
 * @param {{ age?: unknown, gender?: unknown, city?: unknown }} profile
 * @param {(k: string) => string} t
 * @param {{ includeCity?: boolean }} [opts]
 */
export function formatCompanionMeta(profile, t, opts = {}) {
  const includeCity = opts.includeCity !== false;
  const parts = [
    formatCompanionAge(profile?.age, t),
    formatCompanionGender(profile?.gender, t),
  ];
  if (includeCity && profile?.city) parts.push(String(profile.city));
  return parts.filter(Boolean).join(" · ");
}

/**
 * 确保展示用名字是干净字符串
 * @param {unknown} name
 * @param {string} [fallback]
 */
export function formatCompanionName(name, fallback = "") {
  if (name == null) return fallback;
  if (typeof name === "string") {
    const s = name.trim();
    return s || fallback;
  }
  if (typeof name === "object" && name.name != null) {
    return formatCompanionName(name.name, fallback);
  }
  const s = String(name).trim();
  if (!s || s === "[object Object]") return fallback;
  return s;
}
