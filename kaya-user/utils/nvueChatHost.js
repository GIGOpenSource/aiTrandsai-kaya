/**
 * nvue 聊天页不能 import pinia（Weex 里 defineStore 不是函数）。
 * 由 App.vue（Vue 上下文）挂上本 host，用 uni.$emit / $on 和 nvue 传纯数据。
 */
import { watch } from "vue";
import { i18n } from "@/i18n";
import { useChatStore } from "@/stores/chat";
import { useThemeStore } from "@/stores/theme";
import { formatHistoryIncoming } from "@/stores/chatHelpers";
import apiFetch from "@/utils/api";
import { isWsConnectWelcomeNotice } from "@/utils/chatConnectNotice";
import { formatCompanionName } from "@/utils/formatCompanion";
import { showToast } from "@/stores/toast";
import {
  OUR_MOMENTS_TIP_MS,
  OUR_MOMENTS_UNLOCKED_TIP_MS,
  formatOurMomentsChatBar,
  readRecentOurMomentsTip,
} from "@/utils/ourMoments";
import { clearChatDraft, consumeCommentImSnap } from "@/utils/chatDraft";
import { getItem } from "@/utils/storage";
import {
  buildChatListRows,
} from "@/utils/chatListRows";
import {
  formatChatDateSeparator,
  calendarDayKeyFromIso,
} from "@/utils/chatTime";
import {
  useChatTranslate,
  languageDisplayName,
} from "@/composables/useChatTranslate";
import { cancelDreeMessage0OnChatSend } from "@/utils/productAnalyticsHelpers";
import { openCharacterReportPage } from "@/utils/characterReport";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { useLimitedOfferStore } from "@/stores/limitedOffer";

export const NVUE_CHAT_CMD = "nvue-chat-cmd";
export const NVUE_CHAT_STATE = "nvue-chat-state";

const translateApi = useChatTranslate();

let bound = false;
let stopWatch = null;
let activeId = "";
let offset = 0;
let hasMore = true;
let historyLoading = false;
/** 本次进入：资料与历史都加载成功，nvue 揭开遮罩后再报 chat_page_view */
let pageReady = false;
let pageViewTracked = false;
let loadingMore = false;
let accessDenied = false;
let companionName = "";
let companionAvatar = "";
let companionDeleted = false;
let isSending = false;
let appliedEpoch = 0;
/** 已处理过的 paywall.ts，避免 watch 反复 navigate 叠页 */
let lastPaywallTs = 0;
/** 聊天 nvue 在前台才推状态，避免离页后 typing 还去刷已销毁实例 */
let nvuePageVisible = false;

function t(key, params) {
  try {
    return i18n.global.t(key, params);
  } catch {
    return key;
  }
}

function locale() {
  try {
    return i18n.global.locale.value;
  } catch {
    return "zh";
  }
}

function isVipUser() {
  try {
    const raw = getItem("user_info");
    if (!raw) return false;
    return Boolean(JSON.parse(raw)?.is_vip);
  } catch {
    return false;
  }
}

function themePack(isDark) {
  if (isDark) {
    return {
      isDark: true,
      bg: "#0A0A0A",
      fg: "#fafafa",
      muted: "#b5b5b5",
      border: "#444444",
      inputBg: "rgba(255,255,255,0.05)",
      surfaceInset: "rgba(255,255,255,0.05)",
      borderSoft: "rgba(255,255,255,0.05)",
      bubbleAi: "#1c1c1e",
      modalBg: "#0a0a0a",
      translateIcon: "/static/message/ico-translate-light.png",
      backIcon: "/static/common/ico-arrow-left-dark.png",
    };
  }
  return {
    isDark: false,
    bg: "#f5f5f5",
    fg: "#0a0a0a",
    muted: "rgba(10,10,10,0.6)",
    border: "rgba(10,10,10,0.12)",
    inputBg: "#ffffff",
    surfaceInset: "#ffffff",
    borderSoft: "rgba(10,10,10,0.12)",
    bubbleAi: "#ffffff",
    modalBg: "#ffffff",
    translateIcon: "/static/message/ico-translate-dark.png",
    backIcon: "/static/common/ico-arrow-left.png",
  };
}

function translateChip(message) {
  const st = translateApi.stateOf(message.id);
  if (st.status === "loading") {
    return { label: t("chat.translating"), action: "" };
  }
  if (st.status === "error") {
    return { label: t("chat.translationUnavailable"), action: t("common.retry") };
  }
  if (st.status === "done" && !st.hidden) {
    const name = languageDisplayName(st.sourceLang);
    const label = name
      ? t("chat.translatedFrom", { lang: name }).replace(/\{lang\}/g, name)
      : t("chat.translated");
    return { label, action: t("chat.hide") };
  }
  if (st.status === "done") {
    return { label: t("chat.showTranslation"), action: "" };
  }
  return { label: t("chat.translate"), action: "" };
}

function isTranslateExpanded(message) {
  const st = translateApi.stateOf(message.id);
  const text = String(message.text || "").trim();
  if (st.original && text && st.original !== text) return false;
  return st.status === "done" && !st.hidden && Boolean(st.translated);
}

function buildRows() {
  const chat = useChatStore();
  const list = chat
    .getDisplayMessages(activeId)
    .filter((m) => !(m.sender === "system" && isWsConnectWelcomeNotice(m.text)));
  const built = buildChatListRows(
    list,
    locale(),
    formatChatDateSeparator,
    calendarDayKeyFromIso
  );
  const rows = [];
  for (const row of built) {
    if (row.kind === "date") {
      rows.push({ kind: "date", key: row.key, label: row.label });
      continue;
    }
    const m = row.message;
    const st = translateApi.stateOf(m.id);
    const imageUrl = String(m.imageUrl || "").trim();
    const isImage =
      String(m.contentType || "").toLowerCase() === "image" || Boolean(imageUrl);
    const chip =
      m.sender === "ai" && !isImage && String(m.text || "").trim()
        ? translateChip(m)
        : null;
    const mtClass =
      row.marginTopClass === "mt-tight"
        ? "mt-tight"
        : row.marginTopClass === "mt-date"
          ? "mt-date"
          : row.marginTopClass === "mt-none"
            ? "mt-none"
            : "mt-normal";
    rows.push({
      kind: "bubble",
      key: String(m.id),
      id: String(m.id),
      sender: m.sender,
      text: String(m.text || ""),
      contentType: isImage ? "image" : "text",
      imageUrl: isImage ? imageUrl : "",
      mtClass,
      footTime: row.layout.showFootTime ? row.layout.footTime || "" : "",
      showAvatar: !!row.layout.showAvatar,
      avatarSpacer: !!row.layout.avatarSpacer,
      sending: chat.sendingMsgIds.has(m.id),
      pending: chat.pendingMsgIds.has(m.id),
      unpaid: String(m.sendStatus || "") === "unpaid",
      momentCaption: (m.momentData && m.momentData.caption) || "",
      momentImage: (m.momentData && m.momentData.image_url) || "",
      momentLiked: !!(m.momentData && m.momentData.liked),
      trExpanded: isTranslateExpanded(m),
      trText: st.translated || "",
      trChip: chip ? chip.label : "",
      trAction: chip ? chip.action : "",
      trLoading: st.status === "loading",
    });
  }
  const typing =
    !!chat.typingCompanions[activeId] &&
    !(chat.paywall && (chat.paywall.type === "need_recharge" || chat.paywall.type === "need_vip"));
  if (typing) {
    const last = list[list.length - 1];
    rows.push({
      kind: "typing",
      key: "typing",
      showAvatar: !last || last.sender !== "ai",
    });
  }
  return rows;
}

function headerSubText() {
  const chat = useChatStore();
  if (chat.reconnectFailed[activeId]) return t("chat.tapToReconnect");
  if (!isVipUser()) {
    const n = Number(chat.freeTurnsRemaining);
    if (Number.isFinite(n) && n > 0) {
      return t("chat.freeTurnsLeft", { n }).replace(/{n}/g, String(n));
    }
  }
  return chat.isConnected[activeId] ? t("chat.online") : t("chat.connecting");
}

/** Our Moments tip（新鲜才下发；nvue 自绘，不走原生 toast） */
function ourMomentsTipPayload() {
  try {
    const tip = useChatStore().ourMomentsTip;
    if (!tip?.text) return null;
    const ttl =
      Number(tip.ttl) ||
      (tip.toast === "unlocked"
        ? OUR_MOMENTS_UNLOCKED_TIP_MS
        : OUR_MOMENTS_TIP_MS);
    if (Date.now() - Number(tip.ts || 0) > ttl) return null;
    return {
      text: String(tip.text),
      toast: tip.toast || "countdown",
      title: String(tip.title || "").trim(),
      bodyParts: tip.bodyParts || null,
      companionId: String(tip.companionId || activeId || "").trim(),
    };
  } catch {
    return null;
  }
}

/** 输入框上方常驻条 */
function ourMomentsBarPayload() {
  try {
    if (!activeId) return { mode: "", text: "", n: null };
    const progress = useChatStore().ourMomentsProgress?.[activeId];
    return formatOurMomentsChatBar(progress, (key, params) => t(key, params));
  } catch {
    return { mode: "", text: "", n: null };
  }
}

let pushQueued = false;

function pushStateNow() {
  if (!activeId || !nvuePageVisible) return;
  const chat = useChatStore();
  const isDark = useThemeStore().isDark;
  uni.$emit(NVUE_CHAT_STATE, {
    companionId: activeId,
    rows: buildRows(),
    companionName: companionName || t("common.loading"),
    companionAvatar,
    companionDeleted,
    headerSub: headerSubText(),
    ourMomentsTip: ourMomentsTipPayload(),
    ourMomentsBar: ourMomentsBarPayload(),
    online: !!chat.isConnected[activeId],
    canReconnect: !!chat.reconnectFailed[activeId],
    historyLoading,
    loadingMore,
    pageReady,
    accessDenied,
    isSending,
    hasMore,
    theme: themePack(isDark),
    labels: {
      viewProfile: t("chat.viewProfile"),
      report: t("characterReport.menuItem"),
      clearMessages: t("chat.clearMessages"),
      confirmClear: t("chat.confirmClearMessages"),
      cancel: t("common.cancel"),
      confirm: t("common.confirm"),
      accessDenied: t("chat.accessDenied"),
      back: t("chat.back"),
      loading: t("common.loading"),
      loadingEarlier: t("chat.loadingEarlier"),
      noMessages: t("chat.noMessages"),
      companionDeleted: t("chat.companionDeleted"),
      placeholder: t("chat.placeholder"),
      copy: t("chat.copy"),
      liked: t("chat.liked"),
      ourMomentsUnlockedPaywallBody: t("chat.ourMomentsUnlockedPaywallBody"),
    },
  });
}

/**
 * 合并同一事件循环内的多次推送（发送时 messages/sending/typing 会连跳 3 次）。
 * 否则 nvue 整表替换多次，气泡会「出现→消失→再出现」。
 */
function pushState() {
  if (!activeId || !nvuePageVisible) return;
  if (pushQueued) return;
  pushQueued = true;
  const run = () => {
    pushQueued = false;
    pushStateNow();
  };
  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else Promise.resolve().then(run);
}

function startWatch() {
  if (stopWatch) stopWatch();
  const chat = useChatStore();
  const stopState = watch(
    () => [
      chat.messages.length,
      chat.messages
        .map((m) => `${m.id}:${m.text}:${m.sendStatus || ""}`)
        .join("|"),
      activeId && chat.typingCompanions[activeId],
      activeId && chat.isConnected[activeId],
      activeId && chat.historyEpoch[activeId],
      chat.sendingMsgIds.size,
      chat.pendingMsgIds.size,
      Object.keys(translateApi.byId)
        .map((id) => {
          const s = translateApi.byId[id];
          return `${id}:${s.status}:${s.hidden ? 1 : 0}`;
        })
        .join(","),
      useThemeStore().isDark,
      chat.freeTurnsRemaining,
      chat.ourMomentsTip && chat.ourMomentsTip.ts,
      chat.ourMomentsTip && chat.ourMomentsTip.text,
      activeId && chat.ourMomentsProgress?.[activeId]?.ts,
      activeId && chat.ourMomentsProgress?.[activeId]?.remaining_messages,
      activeId && chat.ourMomentsProgress?.[activeId]?.all_unlocked,
    ],
    () => {
      pushState();
    }
  );
  // paywall 单独听：只在 ts 变化时处理一次，避免反复跳转
  const stopPaywall = watch(
    () => chat.paywall && chat.paywall.ts,
    (ts) => {
      if (ts && chat.paywall) onPaywall(chat.paywall);
    }
  );
  stopWatch = () => {
    stopState();
    stopPaywall();
  };
}

function stopSession() {
  if (stopWatch) {
    stopWatch();
    stopWatch = null;
  }
  const chat = useChatStore();
  if (activeId) {
    chat.noteChatPageLeave(activeId, "nvue-leave");
  }
  translateApi.clearCache(activeId);
  activeId = "";
  companionName = "";
  companionAvatar = "";
  companionDeleted = false;
}

/** 正在打开充值页：短暂内不要因 onHide 断 WS，好让后到的 our_moments 仍能写入 tip */
let openingPaywallUntil = 0;

function onPaywall(payload) {
  if (!payload || !activeId) return;
  if (payload.companionId && String(payload.companionId) !== String(activeId)) {
    return;
  }
  if (payload.type !== "need_vip" && payload.type !== "need_recharge") return;
  const ts = Number(payload.ts) || 0;
  // unpaid 感叹号重开：允许同一 ts 以外的重复打开
  const forceReopen = payload.reason === "unpaid_badge";
  if (!forceReopen && ts && ts === lastPaywallTs) return;
  lastPaywallTs = ts || Date.now();

  isSending = false;
  try {
    useChatStore().clearTypingOnPaywall(activeId);
  } catch {
    /* ignore */
  }
  // REST 402：accepted 时对齐 unpaid（WS 已在 handler 处理）
  if (payload.accepted === true) {
    try {
      useChatStore().applyAcceptedUnpaidMessages(activeId, payload.messages, {
        sendStatus: payload.send_status || "unpaid",
      });
    } catch {
      /* ignore */
    }
  }
  // 清掉 store，防止后续任意状态更新再次触发
  try {
    useChatStore().paywall = null;
  } catch {
    /* ignore */
  }

  const needVip = payload.type === "need_vip";
  // 不要在 navigate 前 showToast：跳转会清掉原生 toast，看起来像「什么都没提示」
  // tip 文案带到充值页，由充值页顶层自定义 tip 展示
  let tipText = "";
  try {
    const chat = useChatStore();
    chat.captureMomentsTipForPaywall();
    tipText = String(
      chat.paywallMomentsTip || chat.ourMomentsTip?.text || ""
    ).trim();
  } catch {
    tipText = "";
  }
  if (!tipText) {
    tipText = readRecentOurMomentsTip();
  }
  pushState();

  openingPaywallUntil = Date.now() + 4000;
  try {
    useChatStore().cancelLeaveChat(activeId);
  } catch {
    /* ignore */
  }

  // nvue 挂不了 Vue 弹窗：打开独立充值页，tip 在充值页打开后再画
  const q = [
    `tab=${needVip ? "vip" : "points"}`,
    `insufficient=${needVip ? "0" : "1"}`,
    `companionId=${encodeURIComponent(String(activeId || ""))}`,
  ];
  if (tipText) {
    q.push(`momentsTip=${encodeURIComponent(tipText)}`);
  }
  const url = `/pages-sub/recharge/index?${q.join("&")}`;
  uni.navigateTo({
    url,
    fail: () => {
      uni.redirectTo({
        url,
        fail: () => {},
      });
    },
  });
}

async function loadMessages(isInitial) {
  if (!activeId) return;
  const chat = useChatStore();
  const forId = activeId;
  try {
    if (isInitial) historyLoading = true;
    else loadingMore = true;
    pushState();
    const data = await apiFetch(
      `/companions/${forId}/messages?limit=20&offset=${isInitial ? 0 : offset}`
    );
    if (activeId !== forId) return;
    const raw = (data && data.messages) || [];
    const total = (data && data.total) || 0;
    const formatted = formatHistoryIncoming(forId, raw, locale()).map((row) =>
      row.momentData && !String(row.text || "").trim()
        ? { ...row, text: t("chat.momentShared") }
        : row
    );
    chat.mergeHistoryMessages(
      forId,
      formatted,
      isInitial ? "initial" : "prepend"
    );
    if (isInitial) {
      const snap = consumeCommentImSnap(forId);
      if (snap) chat.placeMomentCardAtEnd(forId, snap);
      offset = raw.length;
      hasMore = raw.length < total;
    } else {
      offset += raw.length;
      hasMore = offset < total;
    }
  } catch (err) {
    if (activeId !== forId) return;
    if (err && err.status === 403) accessDenied = true;
    else if (isInitial) showToast((err && (err.detail || err.message)) || t("chat.loadFailed"));
  } finally {
    if (activeId !== forId) return;
    historyLoading = false;
    loadingMore = false;
    pushState();
  }
}

async function loadCompanion() {
  const chat = useChatStore();
  const forId = activeId;
  if (!forId) return;
  const data = await apiFetch(`/companions/${forId}`);
  // 切会话后旧请求回来时绝不能覆盖当前头像
  if (activeId !== forId) return;
  const profile = (data && data.profile) || {};
  companionDeleted =
    profile.is_deleted === true ||
    data.is_deleted === true ||
    profile.is_deleted === 1 ||
    data.is_deleted === 1;
  companionName = formatCompanionName(profile.name, t("chat.defaultName"));
  companionAvatar = String((data && data.avatar) || "");
  chat.setConversationMeta(forId, {
    name: companionName,
    avatar: companionAvatar,
  });
  if (companionDeleted) clearChatDraft(forId);
  pushState();
}

async function handleCmd(cmd) {
  if (!cmd || !cmd.type) return;
  const chat = useChatStore();
  if (cmd.type === "boot") {
    activeId = String(cmd.companionId || "");
    if (!activeId) return;
    nvuePageVisible = true;
    offset = 0;
    hasMore = true;
    historyLoading = true;
    pageReady = false;
    pageViewTracked = false;
    loadingMore = false;
    accessDenied = false;
    companionDeleted = false;
    isSending = false;
    companionName = t("common.loading");
    // 立刻丢掉上一位的头像；仅允许用「当前 id」缓存预填，绝不沿用上一位
    companionAvatar = "";
    try {
      const cached = chat.lastMessages && chat.lastMessages[activeId];
      const cachedAvatar = cached && cached.avatar ? String(cached.avatar) : "";
      if (cachedAvatar) companionAvatar = cachedAvatar;
      const cachedName = cached && cached.name ? String(cached.name) : "";
      if (cachedName) companionName = formatCompanionName(cachedName, t("chat.defaultName"));
    } catch (e) {
      /* ignore */
    }
    translateApi.hydrate(activeId);
    chat.reloadForCurrentUser && chat.reloadForCurrentUser();
    chat.noteChatPageShow(activeId);
    chat.setActiveCompanionId(activeId);
    // 勿 manualReconnect(force)：与 onShow/AppShow 并发会踩 seq，导致永远 onOpen 过期
    chat.ensureConnected(activeId, { fromUser: true });
    chat.clearUnread(activeId);
    void chat.loadOurMomentsProgress?.(activeId);
    startWatch();
    pushState();
    try {
      await Promise.all([loadCompanion(), loadMessages(true)]);
      if (activeId !== String(cmd.companionId || "")) return;
      appliedEpoch = chat.historyEpoch[activeId] || 0;
      pageReady = !accessDenied;
      pushState();
    } catch (e) {
      if (activeId !== String(cmd.companionId || "")) return;
      pageReady = false;
      historyLoading = false;
      if (!accessDenied) {
        showToast((e && (e.detail || e.message)) || t("chat.loadFailed"));
      }
      pushState();
    }
    return;
  }
  if (cmd.type === "show") {
    // 限时优惠：触发付费墙时由 recharge 页 Host 出弹窗；悬浮入口只在首页/消息 Tab
    nvuePageVisible = true;
    if (!activeId) return;
    chat.noteChatPageShow(activeId);
    chat.setActiveCompanionId(activeId);
    chat.ensureConnected(activeId, { fromUser: true });
    chat.clearUnread(activeId);
    void chat.loadOurMomentsProgress?.(activeId);
    const epoch = chat.historyEpoch[activeId] || 0;
    if (epoch !== appliedEpoch) {
      appliedEpoch = epoch;
      offset = 0;
      hasMore = true;
      await loadMessages(true);
    } else {
      pushState();
    }
    return;
  }
  if (cmd.type === "hide") {
    nvuePageVisible = false;
    if (activeId) {
      // 跳转充值页时暂不断 WS，避免后到的 our_moments tip 丢失
      if (Date.now() < openingPaywallUntil) {
        try {
          chat.cancelLeaveChat(activeId);
        } catch {
          /* ignore */
        }
        return;
      }
      // 勿 clearUnread/markRead：离页时 AI 可能还在生成，read 会干扰未读
      chat.noteChatPageHide(activeId, "nvue-hide");
    }
    return;
  }
  if (cmd.type === "pageView") {
    const id = String(cmd.companionId || activeId || "");
    if (!id || pageViewTracked || !pageReady || accessDenied) return;
    pageViewTracked = true;
    trackProductEvent(
      PRODUCT_EVENTS.CHAT_PAGE_VIEW,
      withCompanionId({ page: "chat" }, id)
    );
    return;
  }
  if (cmd.type === "leave") {
    nvuePageVisible = false;
    stopSession();
    return;
  }
  if (cmd.type === "ensure") {
    if (activeId) chat.ensureConnected(activeId, { fromUser: true });
    return;
  }
  if (cmd.type === "reconnect") {
    if (activeId) chat.manualReconnect(activeId);
    return;
  }
  if (cmd.type === "loadMore") {
    if (loadingMore || !hasMore || !activeId) return;
    await loadMessages(false);
    return;
  }
  if (cmd.type === "reopenPaywall") {
    if (!activeId) return;
    const prev = chat.paywall;
    const type =
      prev && prev.type === "need_vip" ? "need_vip" : "need_recharge";
    onPaywall({
      type,
      reason: "unpaid_badge",
      companionId: activeId,
      ts: Date.now(),
    });
    return;
  }
  if (cmd.type === "openLimitedOffer") {
    try {
      const offer = useLimitedOfferStore();
      offer.openFromEntry();
      // nvue 不能挂 Vue 弹窗：跳到轻量宿主页
      uni.navigateTo({
        url: "/pages-sub/limited-offer/index",
        fail: () => {
          /* ignore */
        },
      });
    } catch (err) {
      console.warn("[nvueChatHost] openLimitedOffer", err);
    }
    return;
  }
  if (cmd.type === "send") {
    const text = String(cmd.text || "").trim();
    if (!text || !activeId || companionDeleted || isSending) return;
    trackProductEvent(
      PRODUCT_EVENTS.SEND_MESSAGE_CLICK_IM,
      withCompanionId({ page: "chat", target_id: String(activeId) }, activeId)
    );
    cancelDreeMessage0OnChatSend();
    clearChatDraft(activeId);
    isSending = true;
    // 必须先写入 store 再 pushState：先推一次空列表会导致「发出的消息闪没再出现」
    const ok = chat.sendMessage(activeId, text, {
      name: companionName,
      avatar: companionAvatar,
    });
    isSending = ok === false;
    pushState();
    return;
  }
  if (cmd.type === "clear") {
    try {
      await apiFetch(`/companions/${activeId}/clear-messages`, { method: "POST" });
      offset = 0;
      hasMore = true;
      chat.clearMessages(activeId);
      translateApi.clearCache(activeId);
      appliedEpoch = chat.historyEpoch[activeId] || 0;
      showToast(t("chat.clearSuccess"));
      pushState();
    } catch {
      showToast(t("chat.clearFailed"));
    }
    return;
  }
  if (cmd.type === "translate") {
    const list = chat.getDisplayMessages(activeId);
    const message = list.find((m) => String(m.id) === String(cmd.messageId));
    if (!message) return;
    const st = translateApi.stateOf(message.id);
    if (st.status === "loading") return;
    if (st.status === "done") {
      if (st.hidden) translateApi.show(message.id);
      else translateApi.hide(message.id);
      pushState();
      return;
    }
    void translateApi.translate(message).then(() => pushState());
    return;
  }
  if (cmd.type === "translateAction") {
    const list = chat.getDisplayMessages(activeId);
    const message = list.find((m) => String(m.id) === String(cmd.messageId));
    if (!message) return;
    const st = translateApi.stateOf(message.id);
    if (st.status === "error") {
      void translateApi.translate(message).then(() => pushState());
      return;
    }
    if (st.status === "done") {
      if (st.hidden) translateApi.show(message.id);
      else translateApi.hide(message.id);
      pushState();
    }
    return;
  }
  if (cmd.type === "dismiss") {
    chat.dismissMessage(cmd.messageId);
    pushState();
    return;
  }
  if (cmd.type === "reportCharacter") {
    openCharacterReportPage({
      characterId: activeId,
      source: "chat",
    });
    return;
  }
  if (cmd.type === "reportMessage") {
    openCharacterReportPage({
      characterId: activeId,
      source: "chat",
      messageId: cmd.messageId,
      messageText: cmd.text,
      messageSender: cmd.sender,
    });
  }
}

export function bindNvueChatHost() {
  if (bound) return;
  bound = true;
  uni.$on(NVUE_CHAT_CMD, (cmd) => {
    void handleCmd(cmd);
  });
}
