/**
 * @file useChatTranslate.js
 * @description IM 气泡翻译：POST /api/im/translate，目标语言走请求头 Accept-Language。
 * 成功译文按用户+会话本地缓存，离开再进仍展开显示。
 */
import { reactive } from "vue";
import { api, unwrapApiResults } from "@/utils/api";
import { getJson, setJson, removeItem } from "@/utils/storage";
import { getCurrentUserId } from "@/composables/useAuth";
import { normalizeUiLang } from "@/utils/uiLanguage";
import { showToast } from "@/stores/toast";
import i18n from "@/i18n";
import langMeta from "@/i18n/locales/_meta.json";

const MAX_CACHED = 200;

const DEFAULT_STATE = Object.freeze({
  status: "idle",
  hidden: false,
  translated: "",
  original: "",
  sourceLang: "",
});

export function languageDisplayName(code) {
  const c = String(code || "")
    .split(/[-_]/)[0]
    .toLowerCase();
  if (!c) return "";
  return langMeta[c]?.name || langMeta[c]?.nativeName || c;
}

function currentLang() {
  return normalizeUiLang(i18n.global.locale.value);
}

function cacheKey(companionId) {
  const uid = getCurrentUserId() || "anon";
  return `chat_translate:${uid}:${String(companionId || "").trim()}`;
}

function isSameLanguageResult(text, translated, results) {
  if (results?.skipped) return true;
  const out = String(translated || "").trim();
  if (!out) return false;
  return out === text;
}

export function useChatTranslate() {
  const byId = reactive({});
  let activeCompanionId = "";

  function stateOf(id) {
    return byId[id] || DEFAULT_STATE;
  }

  function persist() {
    if (!activeCompanionId) return;
    const messages = {};
    for (const id of Object.keys(byId)) {
      const st = byId[id];
      if (st.status === "done" && st.translated) {
        messages[id] = {
          status: "done",
          translated: st.translated,
          original: st.original,
          sourceLang: st.sourceLang || "",
          updatedAt: st.updatedAt || Date.now(),
        };
      } else if (st.status === "same") {
        messages[id] = {
          status: "same",
          original: st.original,
          updatedAt: st.updatedAt || Date.now(),
        };
      }
    }
    const ids = Object.keys(messages);
    if (ids.length > MAX_CACHED) {
      ids
        .sort((a, b) => (messages[a].updatedAt || 0) - (messages[b].updatedAt || 0))
        .slice(0, ids.length - MAX_CACHED)
        .forEach((id) => {
          delete messages[id];
        });
    }
    setJson(cacheKey(activeCompanionId), {
      lang: currentLang(),
      messages,
    });
  }

  function patch(id, next) {
    byId[id] = { ...stateOf(id), ...next };
    const status = byId[id].status;
    if (status === "done" || status === "same") persist();
  }

  function hydrate(companionId) {
    activeCompanionId = String(companionId || "").trim();
    Object.keys(byId).forEach((k) => {
      delete byId[k];
    });
    if (!activeCompanionId) return;
    const raw = getJson(cacheKey(activeCompanionId));
    if (!raw || typeof raw !== "object") return;
    if (raw.lang && raw.lang !== currentLang()) return;
    const messages = raw.messages && typeof raw.messages === "object" ? raw.messages : {};
    for (const id of Object.keys(messages)) {
      const st = messages[id];
      if (st?.status === "done" && st.translated) {
        byId[id] = {
          status: "done",
          hidden: false,
          translated: String(st.translated),
          original: String(st.original || ""),
          sourceLang: String(st.sourceLang || ""),
          updatedAt: Number(st.updatedAt) || Date.now(),
        };
      } else if (st?.status === "same") {
        byId[id] = {
          status: "same",
          hidden: false,
          translated: "",
          original: String(st.original || ""),
          sourceLang: "",
          updatedAt: Number(st.updatedAt) || Date.now(),
        };
      }
    }
  }

  function clearCache(companionId) {
    const id = String(companionId || activeCompanionId || "").trim();
    Object.keys(byId).forEach((k) => {
      delete byId[k];
    });
    if (id) removeItem(cacheKey(id));
  }

  function hide(id) {
    if (stateOf(id).status !== "done") return;
    patch(id, { hidden: true });
  }

  function show(id) {
    if (stateOf(id).status !== "done") return;
    patch(id, { hidden: false });
  }

  function notifyAlreadyCurrentLanguage() {
    showToast(i18n.global.t("chat.alreadyInYourLanguage"));
  }

  /**
   * @param {{ id: string, text?: string }} message
   */
  async function translate(message) {
    const id = String(message?.id || "");
    const text = String(message?.text || "").trim();
    if (!id || !text) return;

    const prev = stateOf(id);
    if (prev.status === "loading") return;
    if (prev.status === "same" && prev.original === text) {
      notifyAlreadyCurrentLanguage();
      return;
    }
    if (prev.status === "done" && prev.original === text && prev.translated) {
      patch(id, { hidden: false });
      return;
    }

    patch(id, { status: "loading", hidden: false, original: text });
    try {
      const raw = await api.post(
        "/api/im/translate",
        { text },
        { timeout: 30000 }
      );
      const results = unwrapApiResults(raw) || {};
      const translated = String(results.translated || "").trim();
      const sourceLang = String(
        results.source_lang ||
          results.sourceLang ||
          results.from_lang ||
          results.detected_lang ||
          ""
      ).trim();

      if (isSameLanguageResult(text, translated, results)) {
        patch(id, {
          status: "same",
          translated: "",
          original: text,
          sourceLang: "",
          hidden: false,
          updatedAt: Date.now(),
        });
        notifyAlreadyCurrentLanguage();
        return;
      }

      if (!translated) {
        patch(id, { status: "error" });
        return;
      }

      patch(id, {
        status: "done",
        hidden: false,
        translated,
        original: text,
        sourceLang,
        updatedAt: Date.now(),
      });
    } catch {
      patch(id, { status: "error" });
    }
  }

  return { byId, stateOf, translate, hide, show, hydrate, clearCache };
}
