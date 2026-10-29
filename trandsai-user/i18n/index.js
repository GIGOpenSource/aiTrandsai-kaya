/**
 * @file i18n/index.js
 * @description vue-i18n 实例：多语言文案 + 语言检测/切换持久化。
 * 文案键结构：locales/*.json，页面内 t('namespace.key')。
 * 存储键兼容 React：i18nextLng、ui_language。
 */
import { createI18n } from "vue-i18n";
import { getItem, setItem } from "@/utils/storage";
import { devLog } from "@/utils/devLog";
import { invalidateHomeMomentsForLanguageChange } from "@/utils/homeCache";
// 中文文案保留在 ./locales/zh.json，恢复时取消下面两处注释，并加回 supportedLngs 的 "zh"
// import zh from "./locales/zh.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import pt from "./locales/pt.json";
import es from "./locales/es.json";
import id from "./locales/id.json";
import ar from "./locales/ar.json";
import fa from "./locales/fa.json";
import ru from "./locales/ru.json";
import bg from "./locales/bg.json";
import tr from "./locales/tr.json";

/** 当前对用户开放的 UI 语言（不含暂隐的 zh） */
const supportedLngs = ["en", "ja", "ko", "pt", "es", "id", "ar", "fa", "ru", "bg", "tr"];
// 恢复中文时改为：["zh", "en", "ja", "ko", "pt", "es", "id", "ar", "fa", "ru", "bg", "tr"]

/**
 * 检测初始语言：本地偏好 → 系统语言 → 默认 en
 * @returns {string}
 */
function detectLanguage() {
  const saved = getItem("i18nextLng") || getItem("ui_language");
  if (saved && supportedLngs.includes(saved)) {
    devLog("[i18n] 使用已保存语言:", saved);
    return saved;
  }
  try {
    const navLang =
      (typeof navigator !== "undefined" &&
        (navigator.language || navigator.userLanguage)) ||
      "";
    const uniApi = typeof uni !== "undefined" ? uni : globalThis.uni;
    const sysLang =
      (uniApi?.getSystemInfoSync?.() || {}).language || navLang;
    devLog("[i18n] 获取到系统语言:", sysLang);
    const lang = String(sysLang).slice(0, 2).toLowerCase();
    if (supportedLngs.includes(lang)) return lang;
  } catch (e) {
    devLog("[i18n] 获取系统语言失败:", e);
    try {
      const navLang =
        (typeof navigator !== "undefined" &&
          (navigator.language || navigator.userLanguage)) ||
        "";
      const lang = navLang.slice(0, 2).toLowerCase();
      if (supportedLngs.includes(lang)) return lang;
    } catch {
      /* ignore */
    }
  }
  devLog("[i18n] 无匹配语言，回退到默认 en");
  return "en";
}

/**
 * 全局 i18n 实例（Composition API：legacy: false）
 * vue-i18n 的 messages 直接挂 locale → 文案树；页面用 t('login.title')。
 * （React i18next 用 translation 命名空间；此处不要再包一层 translation，否则键全失效。）
 */
export const i18n = createI18n({
  legacy: false,
  locale: detectLanguage(),
  fallbackLocale: "en",
  messages: {
    // zh, // 恢复中文时取消注释
    en,
    ja,
    ko,
    pt,
    es,
    id,
    ar,
    fa,
    ru,
    bg,
    tr,
  },
});

/**
 * 切换界面语言并持久化（同时写 i18nextLng / ui_language）
 * @param {string} lng
 */
export function setAppLanguage(lng) {
  const key = supportedLngs.includes(lng) ? lng : "en";
  const prev = String(i18n.global.locale.value || "");
  i18n.global.locale.value = key;
  setItem("i18nextLng", key);
  setItem("ui_language", key);
  // 仅语言真变时清朋友圈缓存；回首页会重新拉取，其它进首页仍走 runtime/缓存逻辑
  if (prev !== key) {
    invalidateHomeMomentsForLanguageChange();
  }
}

export default i18n;
