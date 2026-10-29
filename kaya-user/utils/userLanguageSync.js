/**
 * @file userLanguageSync.js
 * @description 用户语言与后端同步：
 * - 登录/注册成功、手动切语言 → PATCH /api/auth/me/language（写用户表）
 * - 已登录冷启动 / 从后台回前台 → GET /api/auth/me，用 language 覆盖本地 UI
 * 不在「退出再进」时重新读手机系统语言，避免盖掉用户偏好与服务端语言。
 */
import { apiFetch, unwrapApiResults } from "@/utils/api";
import { setAppLanguage, i18n } from "@/i18n";
import { normalizeUiLang } from "@/utils/uiLanguage";
import { isLoggedIn } from "@/composables/useAuth";
import { getItem, setItem } from "@/utils/storage";

/** @returns {string} 当前 UI 短码 */
export function getCurrentUiLang() {
  return normalizeUiLang(i18n.global.locale.value);
}

/**
 * 把当前（或指定）UI 语言写到用户表。未登录则跳过。
 * @param {string} [lang]
 */
export async function pushUiLanguageToServer(lang) {
  if (!isLoggedIn()) return null;
  const language = normalizeUiLang(lang ?? i18n.global.locale.value);
  try {
    const body = await apiFetch("/api/auth/me/language", {
      method: "PATCH",
      data: { language },
    });
    const data = unwrapApiResults(body) || body;
    mergeUserInfoLanguage(
      data && typeof data === "object" ? data.language ?? language : language
    );
    return data;
  } catch (e) {
    console.warn("[userLanguage] PATCH language 失败:", e);
    return null;
  }
}

/**
 * 用服务端 language 覆盖本地 UI（隐藏的 zh 会 normalize 成 en）。
 * @param {string|null|undefined} lang
 */
export function applyServerLanguage(lang) {
  const next = normalizeUiLang(lang);
  setAppLanguage(next);
  mergeUserInfoLanguage(next);
  return next;
}

function mergeUserInfoLanguage(language) {
  if (!language) return;
  try {
    const prev = JSON.parse(getItem("user_info") || "{}") || {};
    setItem(
      "user_info",
      JSON.stringify({
        ...prev,
        language,
      })
    );
  } catch {
    /* ignore */
  }
}

/**
 * 拉 /api/auth/me，用 language 改本地 UI，并合并 user_info。
 * @returns {Promise<object|null>}
 */
export async function fetchAndApplyUserLanguage() {
  if (!isLoggedIn()) return null;
  try {
    const body = await apiFetch("/api/auth/me");
    const data = unwrapApiResults(body) || body;
    if (!data || typeof data !== "object") return null;

    if (data.language != null && String(data.language).trim()) {
      applyServerLanguage(data.language);
    }

    try {
      const prev = JSON.parse(getItem("user_info") || "{}") || {};
      setItem(
        "user_info",
        JSON.stringify({
          ...prev,
          ...data,
          avatar_url: data.avatar_url ?? prev.avatar_url ?? "",
          language: data.language ?? prev.language,
        })
      );
    } catch {
      /* ignore */
    }
    return data;
  } catch (e) {
    console.warn("[userLanguage] GET /api/auth/me 失败:", e);
    return null;
  }
}
