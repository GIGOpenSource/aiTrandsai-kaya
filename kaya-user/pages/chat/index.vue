<script setup>
/**
 * @file pages/chat — 与伴侣一对一聊天
 * @description 历史消息分页、WebSocket 实时收发、虚拟列表、表情选择、清空会话。
 * @depends stores/chat、useChatVirtualWindow、apiFetch、chatTime
 */
import {
  ref,
  computed,
  watch,
  nextTick,
  getCurrentInstance,
  onMounted,
  onUnmounted,
} from "vue";
import { onLoad, onShow, onHide } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppChatEmojiPicker from "@/components/AppChatEmojiPicker.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import AppOurMomentsTip from "@/components/AppOurMomentsTip.vue";
import AppMarqueeText from "@/components/AppMarqueeText.vue";
import AppReportCharacterPopup from "@/components/AppReportCharacterPopup.vue";
import AppMessageActionPopup from "@/components/AppMessageActionPopup.vue";
import { requireAuth, getCurrentUserId } from "@/composables/useAuth";
import { readSafeArea, HEADER_CONTENT_PX } from "@/composables/useStatusBar";
import { previewMedia } from "@/utils/media";
import { useChatStore } from "@/stores/chat";
import { useThemeStore } from "@/stores/theme";
import apiFetch from "@/utils/api";
import { getItem, getJson, removeItem } from "@/utils/storage";
import {
  formatChatDateSeparator,
  calendarDayKeyFromIso,
} from "@/utils/chatTime";
import { isWsConnectWelcomeNotice } from "@/utils/chatConnectNotice";
import { showToast } from "@/stores/toast";
import { useChatVirtualWindow } from "@/composables/useChatVirtualWindow";
import { bindAnalyticsTap } from "@/utils/analytics";
import { formatCompanionName } from "@/utils/formatCompanion";
import { formatOurMomentsChatBar } from "@/utils/ourMoments";
import { devLog } from "@/utils/devLog";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { cancelDreeMessage0OnChatSend } from "@/utils/productAnalyticsHelpers";
import {
  readChatDraft,
  writeChatDraft,
  clearChatDraft,
} from "@/utils/chatDraft";
import { formatHistoryIncoming } from "@/stores/chatHelpers";
import {
  buildChatListRows,
  userBubbleShape,
  aiBubbleShape,
} from "@/utils/chatListRows";
import { translateIconSrc, chatEmojiIconSrc, chatSendIconSrc } from "@/utils/themeIcons";
import {
  useChatTranslate,
  languageDisplayName,
} from "@/composables/useChatTranslate";

function readUserCredits() {
  try {
    const raw = getItem("user_info");
    if (!raw) return 0;
    const u = JSON.parse(raw);
    const n = Number(u?.credits ?? u?.balance ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

const { t, locale } = useI18n();
const chat = useChatStore();
const themeStore = useThemeStore();
const {
  byId: translateById,
  stateOf: translateStateOf,
  translate: requestTranslate,
  hide: hideTranslation,
  show: showTranslation,
  hydrate: hydrateTranslations,
  clearCache: clearTranslationCache,
} = useChatTranslate();
const translateIcon = computed(() => translateIconSrc(themeStore.isDark));
const chatEmojiIcon = computed(() => chatEmojiIconSrc());
const chatSendIcon = computed(() => chatSendIconSrc());
requireAuth();

let companionId = "";

// ——— 页面状态 ———

const input = ref("");
const companion = ref({
  name: t("common.loading"),
  avatar: "",
  online: true,
});

/** 当前用户头像 */
const currentUser = ref({
  avatar: "",
});

function loadCurrentUser() {
  try {
    const raw = getItem("user_info");
    if (raw) {
      const info = JSON.parse(raw);
      currentUser.value = {
        avatar: info.avatar_url || info.avatar || "",
      };
    }
  } catch {
    /* ignore */
  }
}
const historyLoading = ref(true);
const accessDenied = ref(false);
const loadError = ref(false);
/** 智能体已软删：可看历史，不可再输入发送 */
const companionDeleted = ref(false);
const showRechargeModal = ref(false);
const rechargeTab = ref("points");
const rechargeInsufficient = ref(false);

function onRechargeOpenChange(v) {
  showRechargeModal.value = v;
  if (!v) rechargeInsufficient.value = false;
}

/** 充值成功后重置余额不足标识 */
function onRechargePurchased({ userData } = {}) {
  rechargeInsufficient.value = false;
    if (userData) {
      devLog("[Chat] 支付成功，已刷新用户数据");
    }
}
const loadingMore = ref(false);
const hasMore = ref(true);
const offset = ref(0);
/** 与 store.historyEpoch 对齐：详情页清空后返回本页时强制重拉 */
const appliedHistoryEpoch = ref(0);
const isSending = ref(false);
/** App 端 class 宽高经常不生效，必须写在 image 的 style 上 */
const composerIconStyle = { width: "56rpx", height: "56rpx" };
const showEmojiPicker = ref(false);
const showMenu = ref(false);
const showClearConfirm = ref(false);
const reportOpen = ref(false);
const reportMessageId = ref("");
const reportMessageText = ref("");
const reportMessageSender = ref("");
const messageActionOpen = ref(false);
const actionInteractive = ref(true);
const actionMessage = ref(null);
const actionPreview = computed(() => String(actionMessage.value?.text || ""));
const scrollInto = ref("");
const bottomAnchorId = ref("chat-bottom-a");
const scrollTop = ref(0);
const viewScrollTop = ref(0);
const lastScrollHeight = ref(0);
const nearBottom = ref(true);
const scrollViewHeight = ref(0);

const initialScrollDone = ref(false);
const prevMessageCount = ref(0);
const lastLoadMoreAt = ref(0);
const keyboardHeight = ref(0);
const keyboardVisible = ref(false);
const isIOS = ref(uni.getSystemInfoSync().platform === 'ios');

// 头部下拉菜单定位：用 JS 取安全区，避免 App 端 CSS env() 不生效导致菜单跑进标题栏
const safe = readSafeArea();
const headerMenuStyle = {
  top: `${safe.safeAreaTop + HEADER_CONTENT_PX + 12}px`,
};
let _keyboardCb = null;
let _paywallOff = null;
let _scrollIntoTimer = null;
const _keyboardFollowTimers = [];
const _followBottomTimers = [];

// 仅表情插入时主动设光标；输入过程中勿回写 :cursor，否则光标会相对输入框跳动
const cursorPos = ref(-1);
let _ensureConnAt = 0;
let chatPageReady = false;
/** 是否已经 onHide 离开过；用于 onShow 区分首进 / 返回 */
let chatPageWasHidden = false;
let _discReconnectTimer = null;
/** 发送后一段时间内强制跟到底（iOS 键盘下 nearBottom 易误判） */
let followBottomUntil = 0;

function ensureChatSocket() {
  if (!companionId) return;
  const now = Date.now();
  if (now - _ensureConnAt < 1500) return;
  _ensureConnAt = now;
  chat.ensureConnected(companionId, { fromUser: true });
}

function onInputChange() {
  /* v-model 已同步；故意不改 cursorPos */
  ensureChatSocket();
  persistChatDraft();
}

function persistChatDraft() {
  if (!companionId || companionDeleted.value) return;
  writeChatDraft(companionId, input.value);
}

function restoreChatDraft() {
  if (!companionId || companionDeleted.value) return;
  if (String(input.value || "").trim()) return;
  const draft = readChatDraft(companionId);
  if (draft) input.value = draft;
}
const connected = computed(() => chat.isConnected[companionId] || false);
const isVip = computed(() => {
  try {
    const raw = getItem("user_info");
    if (!raw) return false;
    const u = JSON.parse(raw);
    return Boolean(u?.is_vip);
  } catch {
    return false;
  }
});
const freeTurnsText = computed(() => {
  const n = Number(chat.freeTurnsRemaining);
  if (!Number.isFinite(n) || n <= 0) return "";
  return t("chat.freeTurnsLeft", { n }).replace(/{n}/g, String(n));
});
const isTyping = computed(() => chat.typingCompanions[companionId] || false);

// ——— 消息列表与气泡布局 ———

const visibleMessages = computed(() => {
  void chat.messages;
  return chat
    .getDisplayMessages(companionId)
    .filter(
      (m) => !(m.sender === "system" && isWsConnectWelcomeNotice(m.text))
    );
});

const chatListRows = computed(() =>
  buildChatListRows(
    visibleMessages.value,
    locale.value,
    formatChatDateSeparator,
    calendarDayKeyFromIso
  )
);

const typingShowsCompanionAvatar = computed(() => {
  const list = visibleMessages.value;
  if (list.length === 0) return true;
  return list[list.length - 1].sender !== "ai";
});

const instance = getCurrentInstance();

// ——— 滚动与虚拟列表 ———

function queryScrollMetrics() {
  return new Promise((resolve) => {
    const q = uni.createSelectorQuery().in(instance?.proxy);
    q.select("#chat-scroll")
      .fields({ scrollOffset: true, size: true }, (res) => {
        const height = res?.height ?? 0;
        if (height) scrollViewHeight.value = height;
        resolve({
          scrollTop: res?.scrollTop ?? 0,
          scrollHeight: res?.scrollHeight ?? 0,
          height,
        });
      })
      .exec();
  });
}

function measureScrollViewHeight() {
  return new Promise((resolve) => {
    const q = uni.createSelectorQuery().in(instance?.proxy);
    q.select("#chat-scroll")
      .boundingClientRect((rect) => {
        if (rect?.height) scrollViewHeight.value = rect.height;
        resolve(rect?.height || 0);
      })
      .exec();
  });
}

const translateLayoutToken = computed(() =>
  Object.keys(translateById)
    .map((id) => {
      const s = translateById[id];
      return `${id}:${s.status}:${s.hidden ? 1 : 0}`;
    })
    .join(",")
);

const tailLayoutToken = computed(
  () =>
    `${visibleMessages.value.length}|${isTyping.value ? 1 : 0}|${translateLayoutToken.value}`
);

/** 贴底跟随时禁用虚拟列表尾部 padding，确保最新消息真实渲染 */
const stickToLiveTail = computed(() => shouldFollowLatest());

function clearKeyboardFollowTimers() {
  while (_keyboardFollowTimers.length) {
    clearTimeout(_keyboardFollowTimers.pop());
  }
}

function clearFollowBottomTimers() {
  while (_followBottomTimers.length) {
    clearTimeout(_followBottomTimers.pop());
  }
}

function clearKeyboardScrollTimers() {
  if (_scrollIntoTimer) {
    clearTimeout(_scrollIntoTimer);
    _scrollIntoTimer = null;
  }
  clearKeyboardFollowTimers();
  clearFollowBottomTimers();
}

function scheduleKeyboardFollow(delays) {
  // 安卓 adjustResize 自带布局，多次强制滚底会上下抖；仅 iOS 需要补滚
  if (!isIOS.value) return;
  clearKeyboardFollowTimers();
  // 键盘弹起时可视区变矮，nearBottom 易被误判；输入场景强制跟最新
  followLatestMessages(8000);
  delays.forEach((ms) => {
    _keyboardFollowTimers.push(
      setTimeout(() => {
        void measureScrollViewHeight().then(() => {
          if (!shouldFollowLatest()) return;
          scrollToBottom(true);
        });
      }, ms)
    );
  });
}

/** 安卓键盘弹起后只滚一次（等 resize 稳定），避免多次补滚抖动 */
function scheduleAndroidKeyboardPinOnce(delayMs = 180) {
  clearKeyboardFollowTimers();
  followLatestMessages(8000);
  _keyboardFollowTimers.push(
    setTimeout(() => {
      void measureScrollViewHeight().then(() => {
        scrollToBottom(true);
      });
    }, delayMs)
  );
}

/** 布局未稳定时多补几次滚底（仅 iOS：发送 / 键盘收起） */
function scheduleFollowBottom(delays = [32, 120, 280]) {
  if (!isIOS.value) return;
  clearFollowBottomTimers();
  delays.forEach((ms) => {
    _followBottomTimers.push(
      setTimeout(() => {
        if (!shouldFollowLatest()) return;
        scrollToBottom(true);
      }, ms)
    );
  });
}

/**
 * 滚到最新消息。
 * iOS：键盘伸缩后用实测 height + scrollHeight 写 scroll-top。
 * 安卓：只用 scroll-into-view，避免与系统 resize / scroll-top 互顶导致抖动。
 * @param {boolean} [force] 键盘伸缩时跳过 nearBottom 误判（iOS）
 */
function scrollToBottom(force = false) {
  if (_scrollIntoTimer) {
    clearTimeout(_scrollIntoTimer);
    _scrollIntoTimer = null;
  }

  if (isIOS.value) {
    scrollInto.value = "";
    void queryScrollMetrics().then(({ scrollHeight, height }) => {
      if (!force && !shouldFollowLatest()) return;
      const vh = height || scrollViewHeight.value || 0;
      const nextTop = Math.max(0, scrollHeight - vh + 4);
      scrollTop.value = nextTop > 0 ? nextTop - 0.01 : 0.01;
      nextTick(() => {
        scrollTop.value = nextTop;
        nearBottom.value = true;
        lastScrollHeight.value = scrollHeight;
        viewScrollTop.value = nextTop;
      });
    });
    return;
  }

  // 安卓：只换锚点滚一次
  bottomAnchorId.value =
    bottomAnchorId.value === "chat-bottom-a" ? "chat-bottom-b" : "chat-bottom-a";
  scrollInto.value = "";
  _scrollIntoTimer = setTimeout(() => {
    _scrollIntoTimer = null;
    if (!force && !shouldFollowLatest()) return;
    scrollInto.value = bottomAnchorId.value;
    nearBottom.value = true;
  }, 32);
}

function shouldFollowLatest() {
  return (
    nearBottom.value ||
    isSending.value ||
    Date.now() < followBottomUntil
  );
}

function followLatestMessages(stickMs = 15000) {
  followBottomUntil = Date.now() + stickMs;
  nearBottom.value = true;
}

/** 贴底时跟到最新（消息 / typing 变化） */
function pinBottomAfterLayout() {
  if (historyLoading.value || loadingMore.value) return;
  if (!shouldFollowLatest()) return;
  nextTick(() => {
    if (!shouldFollowLatest()) return;
    scrollToBottom();
  });
}

function onScroll(e) {
  const { scrollTop: top, scrollHeight } = e.detail;
  viewScrollTop.value = top;
  lastScrollHeight.value = scrollHeight;
  const viewH = scrollViewHeight.value || 0;
  nearBottom.value =
    viewH <= 0 || top + viewH >= scrollHeight - 100;
  if (pressTimer || pressArmed) cancelMessagePress();
}

const {
  enabled: virtualEnabled,
  slice: virtualChatRows,
  topPad: virtualTopPad,
  bottomPad: virtualBottomPad,
} = useChatVirtualWindow(
  chatListRows,
  viewScrollTop,
  scrollViewHeight,
  stickToLiveTail
);

/** typing 与消息同一列表渲染，避免锚点下方单独换块导致贴底错位 */
const displayChatRows = computed(() => {
  const base = virtualChatRows.value;
  if (!isTyping.value) return base;
  return [
    ...base,
    {
      kind: "typing",
      key: "chat-typing-indicator",
      marginTopClass: base.length ? "mt-normal" : "mt-none",
      showAvatar: typingShowsCompanionAvatar.value,
    },
  ];
});

// ——— 历史加载与伴侣资料 ———

/** 从服务端分页拉取历史消息并合并到 store */
async function loadMessages(loadOffset, isInitial) {
  if (!companionId) return;
  try {
    if (isInitial) historyLoading.value = true;
    else loadingMore.value = true;

    const data = await apiFetch(`/companions/${companionId}/messages?limit=20&offset=${loadOffset}`);

    const rawMessages = data.messages || [];
    const total = data.total || 0;

    const formatted = formatHistoryIncoming(
      companionId,
      rawMessages,
      locale.value
    ).map((row) =>
      row.momentData && !String(row.text || "").trim()
        ? { ...row, text: t("chat.momentShared") }
        : row
    );

    if (isInitial) {
      chat.mergeHistoryMessages(companionId, formatted, "initial");
      offset.value = rawMessages.length;
      hasMore.value = rawMessages.length < total;
    } else {
      const before = await queryScrollMetrics();
      chat.mergeHistoryMessages(companionId, formatted, "prepend");
      offset.value += rawMessages.length;
      hasMore.value = loadOffset + rawMessages.length < total;
      await nextTick();
      const after = await queryScrollMetrics();
      const delta = after.scrollHeight - before.scrollHeight;
      scrollTop.value = before.scrollTop + delta + 0.01;
    }
  } catch (err) {
    const status = (err)?.status;
    if (status === 403) {
      accessDenied.value = true;
      return;
    }
    console.error("加载聊天记录失败:", err);
  } finally {
    if (isInitial) historyLoading.value = false;
    else loadingMore.value = false;
  }
}

function onScrollToUpper() {
  if (loadingMore.value || !hasMore.value || !companionId) return;
  const now = Date.now();
  if (now - lastLoadMoreAt.value < 450) return;
  lastLoadMoreAt.value = now;
  loadMessages(offset.value, false);
}

/** 拉取伴侣资料并更新页头展示 */
async function loadCompanion() {
  try {
    const data = await apiFetch(
      `/companions/${companionId}`
    );
    const profile = (data.profile || {});
    const avatar = String(data.avatar || "");
    companionDeleted.value =
      profile.is_deleted === true ||
      data.is_deleted === true ||
      profile.is_deleted === 1 ||
      data.is_deleted === 1;
    companion.value = {
      name: formatCompanionName(profile.name, t("chat.defaultName")),
      avatar:
        avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${companionId}`,
      online: connected.value,
    };
    chat.setConversationMeta(companionId, {
      name: companion.value.name,
      avatar: companion.value.avatar,
    });
    loadError.value = false;
    if (companionDeleted.value) {
      showEmojiPicker.value = false;
      input.value = "";
      clearChatDraft(companionId);
    }
  } catch (err) {
    const status = (err)?.status;
    if (status === 403) {
      accessDenied.value = true;
      throw err;
    }
    loadError.value = true;
    showToast(err?.detail || err?.message || t("chat.loadFailed"));
    throw err;
  }
}

// ——— 发送 / 表情 / 菜单 / 清空 ———

/** 发送用户输入并滚动到底部 */
function handleSend() {
  if (!input.value.trim() || !companionId || isSending.value) return;
  if (companionDeleted.value) {
    showToast(t("chat.companionDeleted"));
    return;
  }
  if (loadError.value || accessDenied.value) {
    showToast(t("chat.loadFailed"));
    return;
  }
  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_CLICK_IM,
    withCompanionId({ page: "chat", target_id: String(companionId || "") }, companionId)
  );
  // 与 send_message_icon_click 同点再报一遍（投放要求双事件名）
  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
    withCompanionId(
      { page: "chat", source: "im_send", target_id: String(companionId || "") },
      companionId
    )
  );
  // 点了聊天发送：取消 dree_message_0 在线计时
  cancelDreeMessage0OnChatSend();
  const text = input.value.trim();
  input.value = "";
  clearChatDraft(companionId);
  isSending.value = true;
  const ok = chat.sendMessage(companionId, text, {
    name: companion.value?.name || "",
    avatar: companion.value?.avatar || "",
  });
  if (ok === false) {
    isSending.value = false;
    return;
  }
  closeEmojiPanel();
  followLatestMessages(15000);
  // iOS：发送后键盘常同步收起，需多次补滚；安卓交给 pinBottomAfterLayout 单次锚点即可
  if (isIOS.value) {
    scheduleFollowBottom([32, 120, 280, 520]);
  } else {
    nextTick(() => scrollToBottom());
  }
}

function copyMessage(text) {
  uni.setClipboardData({
    data: text || "",
    success() {
      showToast(t("chat.copySuccess"));
    },
  });
}

/** 安卓 enhanced scroll-view 经常吃掉 @longpress；弹出后挡一层，避免松手点到复制/举报 */
const PRESS_HOLD_MS = 400;
const PRESS_MOVE_PX = 14;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 28;
let pressTimer = null;
let pressStart = null;
let pressArmed = false;
let lastTap = null;
let suppressTapUntil = 0;
let unlockActionTimer = null;

function clearPressTimer() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function cancelMessagePress() {
  clearPressTimer();
  pressStart = null;
  pressArmed = false;
}

function unlockActionSheetSoon(delay = 120) {
  suppressTapUntil = Date.now() + 400;
  if (unlockActionTimer) clearTimeout(unlockActionTimer);
  unlockActionTimer = setTimeout(() => {
    unlockActionTimer = null;
    actionInteractive.value = true;
  }, delay);
}

function openMessageActions(message, { vibrate = true } = {}) {
  if (!message) return;
  closeEmojiPanel();
  if (vibrate) {
    try {
      uni.vibrateShort({ type: "light" });
    } catch {
      /* ignore */
    }
  }
  actionInteractive.value = false;
  actionMessage.value = message;
  messageActionOpen.value = true;
  unlockActionSheetSoon(480);
}

function canTranslateMessage(message) {
  return Boolean(String(message?.text || "").trim());
}

function isTranslateExpanded(message) {
  const st = translateStateOf(message?.id);
  const text = String(message?.text || "").trim();
  if (st.original && text && st.original !== text) return false;
  return st.status === "done" && !st.hidden && Boolean(st.translated);
}

function translateSourceLabel(message) {
  const code = translateStateOf(message?.id).sourceLang;
  const name = languageDisplayName(code);
  if (name) {
    return t("chat.translatedFrom", { lang: name }).replace(/\{lang\}/g, name);
  }
  return t("chat.translated");
}

function onTranslateChipTap(message) {
  const st = translateStateOf(message?.id);
  if (st.status === "loading") return;
  if (st.status === "done") {
    if (st.hidden) showTranslation(message.id);
    else hideTranslation(message.id);
    return;
  }
  void requestTranslate(message);
}

function onTranslateActionTap(message) {
  const st = translateStateOf(message?.id);
  if (st.status === "error") {
    void requestTranslate(message);
    return;
  }
  if (st.status === "done") {
    if (st.hidden) showTranslation(message.id);
    else hideTranslation(message.id);
  }
}

function onMessagePressStart(message, e) {
  if (!message) return;
  const t = e?.touches?.[0] || e?.changedTouches?.[0];
  cancelMessagePress();
  pressStart = {
    x: t?.clientX ?? t?.pageX ?? 0,
    y: t?.clientY ?? t?.pageY ?? 0,
    message,
  };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (!pressStart) return;
    pressArmed = true;
    openMessageActions(pressStart.message);
  }, PRESS_HOLD_MS);
}

function onMessagePressMove(e) {
  if (!pressStart || pressArmed) return;
  const t = e?.touches?.[0];
  if (!t) return;
  const dx = (t.clientX ?? t.pageX ?? 0) - pressStart.x;
  const dy = (t.clientY ?? t.pageY ?? 0) - pressStart.y;
  if (dx * dx + dy * dy > PRESS_MOVE_PX * PRESS_MOVE_PX) {
    cancelMessagePress();
  }
}

function onMessagePressEnd() {
  clearPressTimer();
  const start = pressStart;
  pressStart = null;
  pressArmed = false;
  if (messageActionOpen.value) {
    unlockActionSheetSoon(80);
    lastTap = null;
    return;
  }
  if (!start?.message) {
    lastTap = null;
    return;
  }

  const now = Date.now();
  const prev = lastTap;
  const sameTarget =
    prev &&
    prev.id === start.message.id &&
    now - prev.t <= DOUBLE_TAP_MS &&
    Math.abs(start.x - prev.x) <= DOUBLE_TAP_PX &&
    Math.abs(start.y - prev.y) <= DOUBLE_TAP_PX;
  if (sameTarget) {
    lastTap = null;
    openMessageActions(start.message);
    unlockActionSheetSoon(80);
    return;
  }
  lastTap = {
    t: now,
    x: start.x,
    y: start.y,
    id: start.message.id,
  };
}

function onMessagePressCancel() {
  const opened = pressArmed || messageActionOpen.value;
  cancelMessagePress();
  if (opened) unlockActionSheetSoon();
}

function onMessageActionCopy() {
  const msg = actionMessage.value;
  copyMessage(msg?.text || "");
}

function onMessageActionReport() {
  const msg = actionMessage.value;
  if (!msg || !companionId) return;
  reportMessageId.value = msg.id ?? "";
  reportMessageText.value = String(msg.text || "");
  reportMessageSender.value = String(msg.sender || "");
  nextTick(() => {
    reportOpen.value = true;
  });
}

function openReportCharacter() {
  showMenu.value = false;
  reportMessageId.value = "";
  reportMessageText.value = "";
  reportMessageSender.value = "";
  if (!companionId) return;
  reportOpen.value = true;
}

function previewChatImage(url) {
  if (!url || Date.now() < suppressTapUntil) return;
  previewMedia(url);
}

async function handleClearMessages() {
  if (!companionId) return;
  try {
    await apiFetch(`/companions/${companionId}/clear-messages`, {
      method: "POST",
    });
    offset.value = 0;
    hasMore.value = true;
    chat.clearMessages(companionId);
    appliedHistoryEpoch.value = chat.historyEpoch?.[companionId] || 0;
    clearTranslationCache(companionId);
    showToast(t("chat.clearSuccess"));
  } catch (err) {
    console.error("清空聊天记录失败:", err);
    showToast(t("chat.clearFailed"));
  }
}

/** 外部（如智能体详情）清空后，栈内聊天页需重拉历史，避免仍显示内存缓存 */
async function syncHistoryIfClearedExternally() {
  if (!companionId || accessDenied.value) return;
  const epoch = chat.historyEpoch?.[companionId] || 0;
  if (epoch === appliedHistoryEpoch.value) return;
  appliedHistoryEpoch.value = epoch;
  offset.value = 0;
  hasMore.value = true;
  initialScrollDone.value = false;
  clearTranslationCache(companionId);
  try {
    await loadMessages(0, true);
  } catch {
    /* loadMessages 内部已处理 */
  }
  nextTick(() => {
    measureScrollViewHeight();
    if (visibleMessages.value.length > 0) {
      scrollToBottom();
    }
    initialScrollDone.value = true;
  });
}

function handleEmojiPick(emoji) {
  if (companionDeleted.value) return;
  input.value += emoji;
  persistChatDraft();
  // 选中后保持面板打开，可连续选；点消息区空白或发送成功后再关
  nextTick(() => {
    cursorPos.value = input.value.length;
    // 设完即释放，避免后续渲染反复把光标钉死
    nextTick(() => {
      cursorPos.value = -1;
    });
  });
}

function goProfile() {
  showMenu.value = false;
  uni.navigateTo({
    url: `/pages-sub/companion/index?id=${companionId}`,
  });
}

function openClearConfirm() {
  showMenu.value = false;
  showClearConfirm.value = true;
}

function onProfileTap() {
  bindAnalyticsTap("chat-view-profile", goProfile, "查看资料");
}

function toggleMenu() {
  showMenu.value = !showMenu.value;
}

function closeMenu() {
  showMenu.value = false;
}

function toggleEmojiPicker() {
  if (companionDeleted.value) {
    showEmojiPicker.value = false;
    showToast(t("chat.companionDeleted"));
    return;
  }
  showEmojiPicker.value = !showEmojiPicker.value;
}

function closeEmojiPanel() {
  if (showEmojiPicker.value) {
    showEmojiPicker.value = false;
  }
}

function goBackFromDenied() {
  uni.navigateBack();
}

/** 输入框上方 Our Moments 常驻条（countdown / all_unlocked） */
const ourMomentsBar = computed(() => {
  const id = companionId || chat.activeCompanionId || "";
  const progress = id ? chat.ourMomentsProgress?.[id] : null;
  return formatOurMomentsChatBar(progress, (key, params) => t(key, params));
});

function refreshOurMomentsProgress() {
  if (!companionId) return;
  void chat.loadOurMomentsProgress?.(companionId);
}

onLoad((query) => {
  companionId = String(query?.id || "");
  hydrateTranslations(companionId);
  const usedIcebreaker = applyIcebreaker();
  if (!usedIcebreaker) restoreChatDraft();
});

onShow(() => {
  themeStore.syncNativePageBackground();
  restoreChatDraft();
  // 从详情页清空返回时刷新；首进由 onMounted 拉历史，此处仅跟 epoch
  void syncHistoryIfClearedExternally();
  // 仅「离开过再回来」时补连；首进交给 onMounted，避免与 manualReconnect 抢 seq
  if (companionId && chatPageWasHidden) {
    chatPageWasHidden = false;
    chatPageReady = true;
    chat.noteChatPageShow(companionId);
    chat.setActiveCompanionId(companionId);
    chat.ensureConnected(companionId, { fromUser: true });
    chat.clearUnread(companionId);
    refreshOurMomentsProgress();
  }
});

/**
 * 消费首页破冰接口传来的返回值（一次性，读完即删）：
 * is_first=true 时把破冰文案放进输入框，其余情况只清掉不使用。
 * @returns {boolean} 是否已写入破冰文案
 */
function applyIcebreaker() {
  if (!companionId) return false;
  const key = `icebreaker:${companionId}`;
  const data = getJson(key);
  if (!data) return false;
  removeItem(key);
  if (data.is_first === true && data.icebreaker) {
    input.value = String(data.icebreaker).replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
    writeChatDraft(companionId, input.value);
    return true;
  }
  return false;
}

onHide(() => {
  persistChatDraft();
  // 先清 ready，避免 leave 延迟窗口里 watch(connected) 又去补连
  chatPageReady = false;
  chatPageWasHidden = true;
  if (_discReconnectTimer) {
    clearTimeout(_discReconnectTimer);
    _discReconnectTimer = null;
  }
  // 勿立即 disconnect：进页/键盘常闪 onHide；noteChatPageHide 延迟确认
  // 勿 clearUnread：离页 markRead 会干扰「离开后 AI 回复」的未读
  if (companionId) {
    chat.noteChatPageHide(companionId, "vue-onHide");
  }
});

onMounted(async () => {
  if (!companionId) return;

  themeStore.syncNativePageBackground();

  _keyboardCb = (res) => {
    const h = Math.max(0, Number(res?.height) || 0);
    keyboardVisible.value = h > 0;
    // 两端都交给 adjustResize 压窗口，不要再加 spacer。
    // iOS 叠一层键盘高度会把输入栏顶到标题下面，收起后还会卡在半空。
    keyboardHeight.value = 0;
    if (h <= 0) {
      clearKeyboardScrollTimers();
      themeStore.syncNativePageBackground();
      measureScrollViewHeight();
      // 仅 iOS 补滚；安卓系统 resize 已够，再滚会抖
      if (isIOS.value && shouldFollowLatest()) {
        scheduleFollowBottom([80, 240, 480]);
      }
      return;
    }
    themeStore.syncNativePageBackground();
    if (isIOS.value) {
      scheduleKeyboardFollow([60, 180, 360, 560]);
    } else {
      // 安卓：resize 后再锚点滚一次，看到最新；不要多次补滚
      scheduleAndroidKeyboardPinOnce(200);
    }
  };
  if (typeof uni.onKeyboardHeightChange === 'function') {
    uni.onKeyboardHeightChange(_keyboardCb);
  }

  initialScrollDone.value = false;
  prevMessageCount.value = 0;
  accessDenied.value = false;
  loadError.value = false;
  companionDeleted.value = false;

  chat.reloadForCurrentUser?.();
  chat.noteChatPageShow(companionId);
  chat.setActiveCompanionId(companionId);
  // 首进只 ensureConnected，勿 force 拆掉可能已在握手的连接
  console.log("[chat页] 准备 connect WS", {
    companionId,
    hasToken: !!(uni.getStorageSync("user_token") || ""),
  });
  chat.ensureConnected(companionId, { fromUser: true });
  chat.clearUnread(companionId);
  chatPageReady = true;
  refreshOurMomentsProgress();

  // 加载当前用户头像
  loadCurrentUser();

  try {
    await Promise.all([loadCompanion(), loadMessages(0, true)]);
    appliedHistoryEpoch.value = chat.historyEpoch?.[companionId] || 0;
  } catch (err) {
    console.error("加载失败:", err);
    historyLoading.value = false;
    if (!accessDenied.value) {
      loadError.value = true;
      const msg = err?.detail || err?.message || t("chat.loadFailed");
      showToast(msg);
      setTimeout(() => {
        uni.navigateBack({
          fail: () => uni.reLaunch({ url: "/pages/messages/index" }),
        });
      }, 800);
    }
  }

  const onPaywall = (payload) => {
    // need_recharge：免费消息/积分用尽；need_vip：需开通会员。两者都要弹付费窗。
    if (!payload || (payload.type !== "need_vip" && payload.type !== "need_recharge")) {
      return;
    }
    if (payload.companionId && String(payload.companionId) !== String(companionId)) {
      return;
    }
    if (payload.type === "need_vip") {
      rechargeTab.value = "vip";
      rechargeInsufficient.value = false;
    } else {
      rechargeTab.value = "points";
      rechargeInsufficient.value = true;
    }
    showRechargeModal.value = true;
    isSending.value = false;
  };
  if (typeof uni.$on === "function") {
    uni.$on("chat-paywall", onPaywall);
  }
  _paywallOff = () => {
    if (typeof uni.$off === "function") uni.$off("chat-paywall", onPaywall);
  };
  watch(
    () => chat.paywall?.ts,
    () => {
      if (chat.paywall) onPaywall(chat.paywall);
    }
  );

  nextTick(() => {
    measureScrollViewHeight();
    if (!historyLoading.value && visibleMessages.value.length > 0) {
      scrollToBottom();
      initialScrollDone.value = true;
    }
  });
});

function onComposerFocus() {
  closeEmojiPanel();
  ensureChatSocket();
  if (isIOS.value) {
    followLatestMessages(8000);
    scheduleKeyboardFollow([80, 200, 400]);
    return;
  }
  // 安卓：聚焦时标记贴底，真正滚底等键盘高度回调里单次执行
  followLatestMessages(8000);
}

onUnmounted(() => {
  persistChatDraft();
  cancelMessagePress();
  if (unlockActionTimer) {
    clearTimeout(unlockActionTimer);
    unlockActionTimer = null;
  }
  clearKeyboardScrollTimers();
  if (_keyboardCb && typeof uni.offKeyboardHeightChange === "function") {
    uni.offKeyboardHeightChange(_keyboardCb);
    _keyboardCb = null;
  }
  if (typeof _paywallOff === "function") {
    _paywallOff();
    _paywallOff = null;
  }
  // 离开前不断 markRead：未读交给 inbox / catch-up
  if (companionId) {
    chat.noteChatPageLeave(companionId, "vue-onUnload");
  }
  chatPageReady = false;
  if (_discReconnectTimer) {
    clearTimeout(_discReconnectTimer);
    _discReconnectTimer = null;
  }
});

watch(messageActionOpen, (open) => {
  if (!open) actionInteractive.value = true;
});

watch(connected, (conn) => {
  companion.value = { ...companion.value, online: conn };
  if (!conn) isSending.value = false;
  // 已离开页面 / 非当前会话：禁止自动补连（否则与 onHide disconnect 打架）
  if (conn || !chatPageReady || !companionId) return;
  if (String(chat.activeCompanionId || "") !== String(companionId)) return;
  // 握手中勿补连，否则会和 connect 抢 seq
  if (chat.isHandshaking?.(companionId)) return;
  if (_discReconnectTimer) clearTimeout(_discReconnectTimer);
  _discReconnectTimer = setTimeout(() => {
    _discReconnectTimer = null;
    if (!chatPageReady) return;
    if (String(chat.activeCompanionId || "") !== String(companionId)) return;
    if (chat.isHandshaking?.(companionId)) return;
    if (!chat.isConnected[companionId]) {
      chat.ensureConnected(companionId, { fromUser: true });
    }
  }, 400);
});

watch(tailLayoutToken, () => {
  pinBottomAfterLayout();
});

watch(
  () => visibleMessages.value.length,
  (count) => {
    if (count > prevMessageCount.value) {
      prevMessageCount.value = count;
      isSending.value = false;
    } else {
      prevMessageCount.value = count;
    }
  }
);

watch(historyLoading, (loading) => {
  if (
    !loading &&
    visibleMessages.value.length > 0 &&
    !initialScrollDone.value
  ) {
    nextTick(() => {
      scrollToBottom();
      initialScrollDone.value = true;
    });
  }
});
</script>

<template>
  <view v-if="accessDenied" class="access-denied">
    <text class="access-text">{{ t("chat.accessDenied") }}</text>
    <button class="access-back" @tap="bindAnalyticsTap('chat-access-denied-back', goBackFromDenied, '返回')">
      {{ t("chat.back") }}
    </button>
  </view>

  <view v-else-if="loadError" class="access-denied">
    <text class="access-text">{{ t("chat.loadFailed") }}</text>
    <button class="access-back" @tap="bindAnalyticsTap('chat-load-error-back', goBackFromDenied, '返回')">
      {{ t("chat.back") }}
    </button>
  </view>

  <AppPageShell
    v-else
    title-align="start"
    :show-back="true"
    fill-webview
    :pad-safe-bottom="false"
    transparent-header
    vest-backdrop
    :overlay-open="showRechargeModal"
    back-analytics-id="chat-back"
    back-analytics-name="聊天页返回"
  >
    <template #header-title>
      <view class="header-identity chat-header-info" @tap="onProfileTap">
        <view class="chat-header-avatar">
          <AppAvatarImage :src="companion.avatar" :seed="companionId" size="sm" />
        </view>
        <view class="header-identity-meta">
          <view class="flex-row items-center gap-sm">
            <text class="chat-header-name">{{ companion.name || t("common.loading") }}</text>
            <view v-if="companion.online" class="online-dot" />
          </view>
          <text
            v-if="chat.reconnectFailed[companionId]"
            class="header-identity-status"
            @tap="chat.manualReconnect(companionId)"
          >
            {{ t("chat.tapToReconnect") }}
          </text>
          <text
            v-else-if="!isVip && Number(chat.freeTurnsRemaining) > 0"
            class="header-identity-status"
          >
            {{ freeTurnsText }}
          </text>
          <text v-else class="header-identity-status">
            {{ connected ? t("chat.online") : t("chat.connecting") }}
          </text>
        </view>
      </view>
    </template>

    <template #header-right>
      <view class="menu-btn" @tap.stop="bindAnalyticsTap('chat-menu', toggleMenu, '聊天菜单')">
        <text class="menu-btn-text">···</text>
      </view>
    </template>

    <view v-if="showMenu" class="menu-mask" @tap="closeMenu" />
    <view v-if="showMenu" class="header-menu" :style="headerMenuStyle">
      <text class="menu-item" @tap="bindAnalyticsTap('chat-menu-view-profile', goProfile, '查看资料')">{{
        t("chat.viewProfile")
        }}</text>
      <text class="menu-item" @tap="bindAnalyticsTap('chat-menu-report', openReportCharacter, '举报此角色')">{{
        t("characterReport.menuItem")
        }}</text>
      <text class="menu-item destructive" @tap="bindAnalyticsTap('chat-clear-messages', openClearConfirm, '清空消息')">
        {{ t("chat.clearMessages") }}
      </text>
    </view>

    <view class="chat-wrap" :class="themeStore.isDark ? 'is-dark' : 'is-light'">
      <scroll-view id="chat-scroll" scroll-y class="chat-scroll" :scroll-into-view="scrollInto" :scroll-top="scrollTop"
        :upper-threshold="50" :enable-flex="true" :show-scrollbar="false" :enhanced="true" :bounces="false"
        :scroll-with-animation="false" @scroll="onScroll"
        @scrolltoupper="onScrollToUpper" @tap="closeEmojiPanel" @touchmove.stop>
        <view v-if="loadingMore" class="load-more">
          <view class="spinner spinner-sm" />
          <text class="text-muted">{{ t("chat.loadingEarlier") }}</text>
        </view>

        <AppListSkeleton v-if="historyLoading && visibleMessages.length === 0" :rows="6" />

        <view v-if="!historyLoading && visibleMessages.length === 0" class="empty-hint text-muted">
          {{ t("chat.noMessages") }}
        </view>

        <view v-if="virtualEnabled" class="virtual-pad" :style="{ height: virtualTopPad + 'px' }" />

        <template v-for="row in displayChatRows" :key="row.key">
          <view v-if="row.kind === 'date'" class="date-sep">
            <text class="date-sep-label">{{ row.label }}</text>
          </view>

          <view
            v-else-if="row.kind === 'typing'"
            class="typing-row"
            :class="[row.marginTopClass, { 'typing-after-msgs': visibleMessages.length > 0 }]"
          >
            <AppAvatarImage v-if="row.showAvatar" :src="companion.avatar" :seed="companionId" size="sm" />
            <view v-else class="avatar-spacer" />
            <view class="typing-bubble">
              <view class="typing-dots">
                <view class="typing-dot" />
                <view class="typing-dot delay-1" />
                <view class="typing-dot delay-2" />
              </view>
            </view>
          </view>

          <view v-else :id="'msg-' + row.message.id" :class="row.marginTopClass">
            <!-- thinking -->
            <view v-if="row.message.sender === 'thinking'" class="center-row">
              <text class="bubble-thinking" @tap="chat.dismissMessage(row.message.id)">
                {{ row.message.text }}
              </text>
            </view>

            <!-- filler -->
            <view v-else-if="row.message.sender === 'filler'" class="center-row">
              <text class="bubble-filler">{{ row.message.text }}</text>
            </view>

            <!-- system -->
            <view v-else-if="row.message.sender === 'system'" class="center-row">
              <view class="bubble-system">
                <text>{{ row.message.text }}</text>
                <text v-if="row.layout.footTime" class="system-time">
                  {{ row.layout.footTime }}
                </text>
              </view>
            </view>

            <!-- user -->
            <view v-else-if="row.message.sender === 'user'" class="flex-row bubble-row-user">
              <view
                class="bubble-col"
                @touchstart="onMessagePressStart(row.message, $event)"
                @touchmove="onMessagePressMove($event)"
                @touchend="onMessagePressEnd"
                @touchcancel="onMessagePressCancel"
              >
                <text v-if="row.layout.showFootTime && row.layout.footTime" class="foot-time foot-time-user">
                  {{ row.layout.footTime }}
                </text>
                <view class="bubble-with-status">
                  <view v-if="chat.sendingMsgIds.has(row.message.id)" class="pending-indicator">
                    <view class="status-spinner" />
                  </view>
                  <view v-else-if="chat.pendingMsgIds.has(row.message.id)" class="pending-indicator">
                    <up-icon name="info-circle-fill" color="#ef4444" size="20" />
                  </view>

                  <!-- moment 消息卡片 -->
                  <view v-if="row.message.momentData" class="moment-card">
                    <text class="moment-caption" :selectable="false">{{ row.message.momentData.caption }}</text>
                    <image
                      v-if="row.message.momentData.image_url"
                      :src="row.message.momentData.image_url"
                      class="moment-image"
                      mode="widthFix"
                      @tap.stop="previewChatImage(row.message.momentData.image_url)"
                    />
                    <!-- 点赞状态 -->
                    <view v-if="row.message.momentData.liked" class="moment-like-status">
                      <image src="/static/discover/ico-like-sel.svg" style="width: 30rpx;height: 30rpx;"></image>
                      <text class="like-text">{{ t("chat.liked") }}</text>
                    </view>
                  </view>

                  <!-- 普通用户消息 -->
                  <view v-else class="chat-bubble-user" :class="userBubbleShape(row.layout)">
                    <text class="bubble-text" :selectable="false">{{ row.message.text }}</text>
                  </view>
                </view>
              </view>
              <!-- <AppAvatarImage
                :src="currentUser.avatar"
                :seed="String(getCurrentUserId() || 'user')"
                size="sm"
              /> -->
            </view>

            <!-- ai -->
            <view v-else class="flex-row bubble-row-ai">
              <AppAvatarImage v-if="row.layout.showAvatar" :src="companion.avatar" :seed="companionId" size="sm" />
              <view v-else-if="row.layout.avatarSpacer" class="avatar-spacer" />
              <view
                class="bubble-col"
                @touchstart="onMessagePressStart(row.message, $event)"
                @touchmove="onMessagePressMove($event)"
                @touchend="onMessagePressEnd"
                @touchcancel="onMessagePressCancel"
              >
                <text v-if="row.layout.showFootTime && row.layout.footTime" class="foot-time">
                  {{ row.layout.footTime }}
                </text>
                <view class="chat-bubble-ai" :class="aiBubbleShape(row.layout)">
                  <text class="bubble-text" :selectable="false">{{ row.message.text }}</text>
                  <view v-if="isTranslateExpanded(row.message)" class="translate-divider" />
                  <text
                    v-if="isTranslateExpanded(row.message)"
                    class="bubble-text bubble-text-translated"
                    :selectable="false"
                  >{{ translateStateOf(row.message.id).translated }}</text>
                </view>
                <view
                  v-if="canTranslateMessage(row.message)"
                  class="translate-chip"
                  @tap.stop="bindAnalyticsTap('chat-translate', () => onTranslateChipTap(row.message), '翻译')"
                  @touchstart.stop
                >
                  <image
                    class="translate-chip-ico"
                    :class="{ spinning: translateStateOf(row.message.id).status === 'loading' }"
                    :src="translateIcon"
                    mode="aspectFit"
                  />
                  <text
                    v-if="translateStateOf(row.message.id).status === 'loading'"
                    class="translate-chip-label"
                  >{{ t("chat.translating") }}</text>
                  <template v-else-if="translateStateOf(row.message.id).status === 'error'">
                    <text class="translate-chip-label translate-chip-label--error">{{
                      t("chat.translationUnavailable")
                    }}</text>
                    <text class="translate-chip-sep">|</text>
                    <text
                      class="translate-chip-action"
                      @tap.stop="onTranslateActionTap(row.message)"
                    >{{ t("common.retry") }}</text>
                  </template>
                  <template
                    v-else-if="translateStateOf(row.message.id).status === 'done' && !translateStateOf(row.message.id).hidden"
                  >
                    <text class="translate-chip-label">{{ translateSourceLabel(row.message) }}</text>
                    <text class="translate-chip-sep">|</text>
                    <text
                      class="translate-chip-action"
                      @tap.stop="onTranslateActionTap(row.message)"
                    >{{ t("chat.hide") }}</text>
                  </template>
                  <text
                    v-else-if="translateStateOf(row.message.id).status === 'done'"
                    class="translate-chip-label"
                  >{{ t("chat.showTranslation") }}</text>
                  <text v-else class="translate-chip-label">{{ t("chat.translate") }}</text>
                </view>
              </view>
            </view>
          </view>
        </template>

        <view v-if="virtualEnabled" class="virtual-pad" :style="{ height: virtualBottomPad + 'px' }" />

        <view :id="bottomAnchorId" class="scroll-anchor" />
      </scroll-view>

      <view
        v-if="ourMomentsBar.text"
        class="our-moments-chat-bar"
        :class="themeStore.isDark ? 'is-dark' : 'is-light'"
      >
        <text
          v-if="ourMomentsBar.mode === 'countdown' && ourMomentsBar.n != null"
          class="our-moments-chat-bar-line"
        >
          <text
            v-if="ourMomentsBar.before"
            class="our-moments-chat-bar-text"
          >{{ ourMomentsBar.before }}</text>
          <text class="our-moments-chat-bar-n">{{ ourMomentsBar.n }}</text>
          <text
            v-if="ourMomentsBar.after"
            class="our-moments-chat-bar-text"
          >{{ ourMomentsBar.after }}</text>
        </text>
        <text v-else class="our-moments-chat-bar-text">{{ ourMomentsBar.text }}</text>
      </view>

      <view
        class="composer-bar"
        :class="{
          'composer-bar--disabled': companionDeleted,
          'composer-bar--inset-bottom': keyboardHeight <= 0,
        }"
      >
        <view
          v-if="showEmojiPicker && !companionDeleted"
          class="composer-panel"
          @tap.stop
        >
          <AppChatEmojiPicker @pick="handleEmojiPick" />
        </view>

        <view class="composer-field-wrap" :class="{ 'composer-field-wrap--deleted': companionDeleted }">
          <!-- 已删除：用跑马灯展示完整提示，避免 placeholder 被截断 -->
          <AppMarqueeText
            v-if="companionDeleted"
            class="composer-deleted-marquee"
            :text="t('chat.companionDeleted')"
            :threshold="4"
            :duration="10"
          />
          <textarea
            v-else
            v-model="input"
            class="composer-textarea"
            :placeholder="t('chat.placeholder')"
            confirm-type="send"
            :auto-height="true"
            :show-confirm-bar="false"
            :adjust-position="false"
            :cursor="cursorPos"
            @focus="onComposerFocus"
            @confirm="handleSend"
            @input="onInputChange"
          />
        </view>

        <view
          class="composer-action composer-action--ghost"
          :class="{ 'is-disabled': companionDeleted }"
          hover-class="none"
          @tap.stop="bindAnalyticsTap('chat-emoji', toggleEmojiPicker, '表情')"
        >
          <image
            class="composer-action-ico"
            :src="chatEmojiIcon"
            mode="aspectFit"
            :style="composerIconStyle"
          />
        </view>

        <view
          class="composer-action composer-action--send"
          :class="{
            active: input.trim() && !isSending && !companionDeleted,
            'is-idle': companionDeleted || !input.trim() || isSending,
          }"
          hover-class="none"
          @tap="bindAnalyticsTap('chat-send', handleSend, '发送消息')"
        >
          <image
            class="composer-action-ico"
            :src="chatSendIcon"
            mode="aspectFit"
            :style="composerIconStyle"
          />
        </view>
      </view>

      <!-- iOS：WebView 没被键盘压矮时用这块把输入栏顶上去；已压缩则为 0 -->
      <view v-if="keyboardHeight > 0" class="keyboard-spacer" :style="{ height: keyboardHeight + 'px' }" />
    </view>

    <AppConfirmDialog v-model:open="showClearConfirm" :title="t('chat.clearMessages')"
      :description="t('chat.confirmClearMessages')" destructive @confirm="handleClearMessages" />
    <AppMessageActionPopup
      v-model:open="messageActionOpen"
      :preview="actionPreview"
      :interactive="actionInteractive"
      @copy="onMessageActionCopy"
      @report="onMessageActionReport"
      @gesture-end="unlockActionSheetSoon(80)"
    />
    <AppReportCharacterPopup
      v-model:open="reportOpen"
      :character-id="companionId"
      source="chat"
      :message-id="reportMessageId"
      :message-text="reportMessageText"
      :message-sender="reportMessageSender"
    />
    <AppRechargeModal
      :open="showRechargeModal"
      analytics-scene="free_message"
      :companion-id="companionId"
      :default-tab="rechargeTab"
      :points="readUserCredits()"
      :insufficient="rechargeInsufficient"
      @update:open="onRechargeOpenChange"
      @purchased="onRechargePurchased"
    />
    <!-- 无付费时自定义 tip；有付费时改由 AppRechargeModal 内 tip 展示 -->
    <AppOurMomentsTip v-if="!showRechargeModal" />
    <!-- 聊天页不挂悬浮入口；触发付费墙时限时弹窗由本 Host 展示 -->
    <AppLimitedOfferHost />
  </AppPageShell>
</template>

<style scoped lang="scss">
/* 对齐 React Chat：整屏列布局 + 底部输入栏固定可点 */

.access-denied {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background: var(--bg);
}

.access-text {
  text-align: center;
  margin-bottom: 48rpx;
  font-size: 30rpx;
  color: var(--fg-muted);
}

.access-back {
  border-radius: 999px;
  font-size: 28rpx;
  padding: 16rpx 48rpx;
  background: var(--bg-input);
  color: var(--fg);
  border: 1px solid var(--border);
}

.menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
}

.menu-btn-text {
  font-size: 40rpx;
  line-height: 1;
  letter-spacing: 4rpx;
  margin-top: -18rpx;
  color: var(--fg);
}

.menu-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 45;
  background: transparent;
}

.header-menu {
  position: fixed;
  right: 24rpx;
  z-index: 1000;
  background: var(--modal-bg);
  border-radius: 24rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.18);
  min-width: 280rpx;
  padding: 8rpx 0;
  overflow: hidden;
}

.menu-item {
  display: block;
  font-size: 28rpx;
  padding: 10rpx 32rpx;
  color: var(--fg);

  &.destructive {
    color: var(--destructive);
  }
}

.chat-header-info {
  /* 布局走全局 .header-identity；此处仅保留聊天名字号 */
  padding: 0;
}

.chat-header-avatar {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
}

.chat-header-avatar :deep(.avatar-root) {
  width: 100%;
  height: 100%;
}

.chat-header-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360rpx;
}

.online-dot {
  width: 14rpx;
  height: 14rpx;
  background: #22c55e;
  border-radius: 50%;
  flex-shrink: 0;
}

.chat-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.chat-wrap.is-light {
  background: #f5f5f5;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  height: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 24rpx 32rpx;
}

.load-more,
.load-center {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  padding: 20rpx 0;
  font-size: 24rpx;
}

.empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320rpx;
  font-size: 28rpx;
}

.spinner {
  width: 32rpx;
  height: 32rpx;
  border: 4rpx solid rgba(236, 72, 153, 0.25);
  border-top-color: rgba(236, 72, 153, 0.8);
  border-radius: 50%;
  animation: spin 0.85s linear infinite;

  &.spinner-sm {
    width: 24rpx;
    height: 24rpx;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.mt-none {
  margin-top: 0;
}

.mt-tight {
  margin-top: 8rpx;
}

.mt-normal {
  margin-top: 24rpx;
}

.mt-date {
  margin-top: 16rpx;
}

.date-sep {
  display: flex;
  justify-content: center;
  padding: 12rpx 0;
}

.date-sep-label {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.55);
  background: #3a3a42;
  border: none;
  border-radius: 999px;
  padding: 8rpx 20rpx;
}

.chat-wrap.is-light .date-sep-label {
  color: rgba(10, 10, 10, 0.4);
  background: #e8e8e8;
}

.center-row {
  display: flex;
  justify-content: center;
}

.bubble-thinking {
  max-width: 90%;
  border-radius: 24rpx;
  font-size: 24rpx;
  text-align: center;
  padding: 16rpx 24rpx;
  background: var(--bg-input);
  color: var(--fg-muted);
  border: 1px solid var(--border);
}

.bubble-filler {
  max-width: 90%;
  border-radius: 16rpx;
  font-size: 24rpx;
  text-align: center;
  font-style: italic;
  padding: 12rpx 20rpx;
  color: var(--brand);
  background: rgba(236, 72, 153, 0.08);
  border: 1px solid rgba(236, 72, 153, 0.12);
}

.bubble-system {
  max-width: 90%;
  border-radius: 24rpx;
  font-size: 24rpx;
  text-align: center;
  padding: 16rpx 24rpx;
  background: var(--bg-input);
  color: var(--fg-muted);
  border: 1px solid var(--border);
}

.system-time {
  display: block;
  font-size: 20rpx;
  margin-top: 8rpx;
}

.bubble-row-user {
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 16rpx;
}

.bubble-row-ai {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}

.bubble-col {
  max-width: 75%;
  min-width: 0;
}

.bubble-with-status {
  display: flex;
  // align-items: flex-start;
  align-items: center;
  gap: 8rpx;
  justify-content: flex-end;
}

.pending-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
  margin-bottom: 8rpx;
}

.status-spinner {
  width: 24rpx;
  height: 24rpx;
  border: 3rpx solid rgba(236, 72, 153, 0.25);
  border-top-color: rgba(236, 72, 153, 0.8);
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

.bubble-text {
  font-size: 32rpx;
  line-height: 1.4;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  user-select: none;
  -webkit-user-select: none;
}

.foot-time {
  display: block;
  font-size: 22rpx;
  margin-top: 0;
  color: var(--fg-muted);
  opacity: 0.6;
  margin-bottom: 12rpx;
}

.foot-time-user {
  text-align: right;
}

.avatar-spacer {
  width: 64rpx;
  height: 64rpx;
  flex-shrink: 0;
}

.translate-divider {
  height: 1px;
  margin: 20rpx 0;
  background: var(--border);
}

.bubble-text-translated {
  color: var(--fg);
  opacity: 0.78;
}

.translate-chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  align-self: flex-start;
  gap: 8rpx;
  margin-top: 12rpx;
  padding: 8rpx 16rpx;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  max-width: 100%;
}

.translate-chip-ico {
  width: 24rpx;
  height: 24rpx;
  flex-shrink: 0;

  &.spinning {
    animation: spin 0.85s linear infinite;
  }
}

.translate-chip-label,
.translate-chip-action,
.translate-chip-sep {
  font-size: 22rpx;
  line-height: 1.2;
  color: var(--fg-muted);
}

.translate-chip-label--error {
  color: #ef4444;
}

.translate-chip-sep {
  opacity: 0.45;
  padding: 0 4rpx;
}

.translate-chip-action {
  color: var(--fg-muted);
}

.chat-bubble-user,
.chat-bubble-user.shape-single-user,
.chat-bubble-user.shape-top-user,
.chat-bubble-user.shape-bottom-user,
.chat-bubble-user.shape-mid-user {
  border-radius: 32rpx;
  padding: 24rpx 28rpx;
  background: var(--gradient-brand-btn, linear-gradient(139.53deg, #ff659b 21.98%, #b933e6 113.24%));
  color: #fff;
}

.chat-bubble-ai,
.chat-bubble-ai.shape-single-ai,
.chat-bubble-ai.shape-top-ai,
.chat-bubble-ai.shape-bottom-ai,
.chat-bubble-ai.shape-mid-ai {
  border-radius: 32rpx;
  padding: 24rpx 28rpx;
  background: #2c2c34;
  color: #fff;
  border: none;
}

.chat-wrap.is-light .chat-bubble-ai,
.chat-wrap.is-light .chat-bubble-ai.shape-single-ai,
.chat-wrap.is-light .chat-bubble-ai.shape-top-ai,
.chat-wrap.is-light .chat-bubble-ai.shape-bottom-ai,
.chat-wrap.is-light .chat-bubble-ai.shape-mid-ai {
  background: #ffffff;
  color: #0a0a0a;
}

.typing-row {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 16rpx;
  margin-top: 0;

  &.typing-after-msgs {
    margin-top: 8rpx;
  }
}

.typing-bubble {
  display: flex;
  border-radius: 32rpx;
  min-height: 80rpx;
  align-items: center;
  padding: 20rpx 28rpx;
  background: #2c2c34;
  border: none;
}

.chat-wrap.is-light .typing-bubble {
  background: #ffffff;
}

.typing-dots {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
}

.typing-dot {
  width: 12rpx;
  height: 12rpx;
  background: var(--fg-muted);
  border-radius: 50%;
  opacity: 0.7;
  animation: typing-soft 1s ease-in-out infinite;

  &.delay-1 {
    animation-delay: 0.2s;
  }

  &.delay-2 {
    animation-delay: 0.4s;
  }
}

@keyframes typing-soft {

  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-4rpx);
  }
}

.scroll-anchor {
  height: 48rpx;
  width: 100%;
}

.keyboard-spacer {
  flex-shrink: 0;
  width: 100%;
}

/* Composer / 发送钮 / 表情面板：对齐稿面浅色白底栏 + 灰胶囊输入 */
.composer-bar {
  background: var(--modal-bg, #0c0813);
  gap: 16rpx;
  border-radius: 32rpx 32rpx 0 0;
}

.chat-wrap.is-light .composer-bar {
  background: #ffffff;
}

.composer-field-wrap {
  border-radius: 999px;
  background: #2a2a32;
  border: none;
}

.chat-wrap.is-light .composer-field-wrap {
  background: #ececec;
}

.composer-action,
.composer-action--ghost,
.composer-action--send,
.composer-action--send.active,
.composer-action.active,
.composer-action.is-idle {
  width: 80rpx;
  height: 80rpx;
  min-width: 80rpx;
  min-height: 80rpx;
  border-radius: 50%;
  background: transparent !important;
  box-shadow: none !important;
  opacity: 1;
}

.composer-action--send.active image,
.composer-action.active image {
  filter: none !important;
}

.composer-field-wrap--deleted {
  display: flex;
  align-items: center;
  overflow: hidden;
}

.composer-deleted-marquee {
  width: 100%;
  font-size: var(--fs-body, 28rpx);
  line-height: var(--composer-line-h, 42rpx);
  color: var(--fg-muted, rgba(255, 255, 255, 0.55));
}

/* moment 消息卡片样式 */
.moment-card {
  background: var(--gradient-brand-btn, linear-gradient(139.53deg, #ff659b 21.98%, #b933e6 113.24%));
  border-radius: var(--radius-panel, 24rpx);
  padding: 20rpx;
  max-width: 100%;
  box-sizing: border-box;
}

.moment-caption {
  display: block;
  font-size: 28rpx;
  line-height: 1.5;
  color: #fff;
  margin-bottom: 12rpx;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.moment-image {
  width: 100%;
  border-radius: 16rpx;
  display: block;
}

.moment-like-status {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 16rpx;
  padding-top: 12rpx;
  border-top: 1px solid rgba(255, 255, 255, 0.25);
}

.like-heart {
  font-size: 32rpx;
  opacity: 0.6;
  transition: opacity 0.3s;

  &.liked {
    opacity: 1;
  }
}

.like-text {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.85);
}
</style>
