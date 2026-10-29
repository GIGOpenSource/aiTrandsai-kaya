<script setup>
/**
 * @file pages/messages — 消息 Tab：会话列表
 * @description 基于 companions + chat.lastMessages/unread 组装会话；点击进入聊天页。
 * @depends stores/chat、companionsCache、AppPageShell(show-tab-bar)
 */
import { ref, computed, watch, nextTick } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import { requireAuth, isLoggedIn, hasUserGender } from "@/composables/useAuth";
import { useChatStore } from "@/stores/chat";
import { useCreateCompanionEntry } from "@/composables/useCreateCompanionEntry";
import { fetchBCompanions, getCachedCompanions, companionPageHasMore } from "@/utils/companionsCache";
import { isScrollNearBottom } from "@/utils/scrollNearBottom";
import { useRelativeTime } from "@/composables/useRelativeTime";
import { showToast } from "@/stores/toast";
import { bindAnalyticsTap, bindAnalyticsTapArg } from "@/utils/analytics";
import {
	trackProductEvent,
	PRODUCT_EVENTS,
	withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { trackNoDataOfImIfNeeded } from "@/utils/productAnalyticsHelpers";
import { useTabScrollStore } from "@/stores/tabScroll";
import { formatCompanionName } from "@/utils/formatCompanion";
import { fillI18n } from "@/utils/createCompanionForm";
import {
	readChatDraftEntry,
	draftTimeIso,
} from "@/utils/chatDraft";
import apiFetch from "@/utils/api";
import { useInboxWsStore } from "@/stores/inboxWs";

const TAB_PATH = "/pages/messages/index";
const FEEDBACK_LOGO = "/static/common/logo.svg";
const tabScroll = useTabScrollStore();
/** 仅程序化滚顶时写入；App 上若长期绑成 0，列表一变长会被打回顶部 */
const scrollTopControl = ref(0);
let lastScrollTop = 0;
/** App scroll 事件常缺 clientHeight，用测量值判断贴底 */
const listViewHeight = ref(600);
let lastScrollHeight = 0;
/** 是否允许 :scroll-top 生效（只在主动滚顶时打开，不用于 load-more） */
let scrollTopArmed = false;

const MESSAGES_PAGE_SIZE = 20;
const MESSAGES_FILTER = { special: "message", page: 1, page_size: MESSAGES_PAGE_SIZE };
const messagesPage = ref(0);
const messagesHasMore = ref(true);
const messagesLoadingMore = ref(false);
/** Feedback 官方客服置顶入口（GET /api/feedback/inbox） */
const feedbackInbox = ref(null);
/** 贴底触发过分页后锁住，离开底部再解锁，避免 loading 条显隐把高度抖回来反复请求 */
let loadMoreBottomLatched = false;
/** 连续「本页无新会话」次数；接口若总说有下一页但实际重复，用来强停 */
let emptyAppendStreak = 0;
let loadMoreInFlight = null;
/** 串行化：新的全量刷新让旧的 load-more 结果作废 */
let loadSeq = 0;
const { t } = useI18n();
const chat = useChatStore();
const { format: formatRelativeTime } = useRelativeTime("messages");
requireAuth();

// ——— 状态 ———

const initialCached = getCachedCompanions(MESSAGES_FILTER) ?? [];

// ——— 组装会话 ———

function formatPreviewText(text) {
  if (!text) return "";
  const raw = String(text).trim();
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.caption === "string" && parsed.caption.trim()) {
          return parsed.caption.trim();
        }
        return t("chat.momentShared");
      }
    } catch {
      return t("chat.momentShared");
    }
  }
  return raw;
}

function formatDraftPreview(text) {
  const snippet = formatPreviewText(text);
  if (!snippet) return "";
  // H5：须把 text 传给 t()，否则 {text} 会被插成空
  // App：部分环境 named 插值不生效会留下 {text}，再用 fillI18n 兜底
  return fillI18n(t("messages.draftPreview", { text: snippet }), { text: snippet });
}

function parseMessageTime(raw) {
  if (!raw) return 0;
  const n = new Date(raw).getTime();
  return Number.isFinite(n) ? n : 0;
}

function rowSortTime(row) {
  if (row.draftUpdatedAt > 0) return row.draftUpdatedAt;
  return parseMessageTime(row.rawTime);
}

function applyConversationDraft(row, id) {
  const draft = readChatDraftEntry(id);
  if (!draft.text.trim()) {
    row.isDraft = false;
    row.draftUpdatedAt = 0;
    return row;
  }
  row.isDraft = true;
  row.draftUpdatedAt = draft.updatedAt;
  row.lastMessage = formatDraftPreview(draft.text);
  const draftIso = draftTimeIso(draft.updatedAt);
  if (draftIso) {
    row.time = formatRelativeTime(draftIso);
  }
  return row;
}

/**
 * 接口拉取后：把服务端 last_message 写入 store（只同步预览）。
 * 未读一律走 /ws/inbox，这里 bump 会把「刚自己发的消息」误打成角标闪一下。
 * 只在 loadConversations 调用，勿放进 watch，否则会与 lastMessages 形成环。
 */
function syncCompanionsFromApi(companions) {
  (companions || []).forEach((c) => {
    const profile = c.profile || {};
    const id = String(profile.id || "");
    if (!id) return;
    if (c.last_message) {
      chat.syncRemotePreview(id, c.last_message, c.last_message_time || "", {
        bumpUnread: false,
      });
    }
    // 名称/头像以接口资料为准，回写 lastMessages，避免改名后仍显示本地旧缓存
    const name = profile.name ? String(profile.name) : "";
    const avatar = c.avatar ? String(c.avatar) : "";
    if (name || avatar) {
      chat.setConversationMeta(id, {
        ...(name ? { name } : {}),
        ...(avatar ? { avatar } : {}),
      });
    }
  });
}

/** 纯组装：伴侣列表 + chat store → 会话行（不写 store） */
function buildConversations(companions) {
  const byId = new Map();
  companions.forEach((c) => {
    const profile = c.profile || {};
    const id = String(profile.id || "");
    if (!id) return;
    const lastMsg = chat.lastMessages[id];
    const preview = formatPreviewText(lastMsg?.text || c.last_message || "");
    byId.set(
      id,
      applyConversationDraft(
        {
          id,
          name: formatCompanionName(
            profile.name || lastMsg?.name,
            t("chat.defaultName")
          ),
          avatar:
            c.avatar ||
            lastMsg?.avatar ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(id || "default")}`,
          lastMessage: preview,
          time: lastMsg?.fullTime
            ? formatRelativeTime(lastMsg.fullTime)
            : formatRelativeTime(c.last_message_time),
          rawTime: lastMsg?.fullTime || c.last_message_time || "",
          unread: chat.unreadCounts[id] || 0,
          avatar_generating: c.avatar_generating,
          isDeleted:
            profile.is_deleted === true ||
            profile.is_deleted === 1 ||
            c.is_deleted === true ||
            c.is_deleted === 1,
          isDraft: false,
          draftUpdatedAt: 0,
        },
        id
      )
    );
  });

  // 仅补「刚发出、接口还没来得及收录」的会话；不要把本地 lastMessages 历史全拼进来
  Object.keys(chat.lastMessages || {}).forEach((id) => {
    if (!id || byId.has(id)) return;
    if (!chat.hasPendingOutbox?.(id)) return;
    const lm = chat.lastMessages[id];
    if (!lm?.text && !lm?.fullTime) return;
    byId.set(
      id,
      applyConversationDraft(
        {
          id,
          name: formatCompanionName(lm.name, t("chat.defaultName")),
          avatar:
            lm.avatar ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(id)}`,
          lastMessage: formatPreviewText(lm.text || ""),
          time: lm.fullTime ? formatRelativeTime(lm.fullTime) : "",
          rawTime: lm.fullTime || "",
          unread: chat.unreadCounts[id] || 0,
          avatar_generating: false,
          isDeleted: false,
          isDraft: false,
          draftUpdatedAt: 0,
        },
        id
      )
    );
  });

  const list = Array.from(byId.values());
  const hasDraft = list.some((row) => row.draftUpdatedAt > 0);
  if (hasDraft) {
    list.sort((a, b) => rowSortTime(b) - rowSortTime(a));
  }
  return list;
}

function buildContextConversations() {
  // 兼容旧调用：统一走 buildConversations，由 lastMessages 补全本地发出会话
  return buildConversations([]);
}

const rawCompanions = ref((initialCached) ?? []);
// 冷启动用缓存校正一次，断线/未连上时也能先看到预览与未读角标
if (initialCached?.length) {
  syncCompanionsFromApi(initialCached);
}
const conversations = ref(buildConversations(initialCached ?? []));
const loading = ref(!initialCached?.length && !Object.keys(chat.lastMessages).length);
// 是否已完成过至少一次加载：用于避免已确认空状态后再进页面时骨架屏一闪而过
const hasLoaded = ref(false);
const showMenu = ref(false);
const searchQuery = ref("");

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return conversations.value;
  return conversations.value.filter(
    (c) => c.name.toLowerCase().includes(q) || (c.lastMessage || "").toLowerCase().includes(q)
  );
});

/**
 * 客服入口始终置顶（pinned === true），不因 has_chat 隐藏。
 * 搜索时：入口名/预览命中才显示。
 */
const showFeedbackEntry = computed(() => {
  const inbox = feedbackInbox.value;
  if (!inbox) return false;
  // 文档：pinned 恒 true；显式 false 才不渲染
  if (inbox.pinned === false) return false;
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  const name = String(inbox.entry_name || t("messages.feedback")).toLowerCase();
  const preview = String(inbox.last_message || "").toLowerCase();
  return name.includes(q) || preview.includes(q);
});

const feedbackEntryName = computed(
  () => feedbackInbox.value?.entry_name || t("messages.feedback")
);

const feedbackPreview = computed(() => {
  const text = String(feedbackInbox.value?.last_message || "").trim();
  return text || t("messages.noMessageYet");
});

const feedbackTime = computed(() => {
  // 只用 last_message_at；null / 无消息时不显示时间（不用 updated_at）
  const raw = feedbackInbox.value?.last_message_at;
  if (raw == null || raw === "") return "";
  return formatRelativeTime(raw);
});

const feedbackUnread = computed(
  () => Number(feedbackInbox.value?.unread_count) || 0
);

const showConversationEmpty = computed(
  () =>
    !showFeedbackEntry.value &&
    !filtered.value.length &&
    !searchQuery.value.trim()
);

const showSearchEmpty = computed(
  () =>
    !showFeedbackEntry.value &&
    !filtered.value.length &&
    !!searchQuery.value.trim()
);

async function loadFeedbackInbox() {
  if (!isLoggedIn()) {
    feedbackInbox.value = null;
    return;
  }
  try {
    const data = await apiFetch("/api/feedback/inbox");
    if (data && typeof data === "object") {
      feedbackInbox.value = data;
    }
  } catch (e) {
    console.warn("[messages] feedback inbox failed", e);
  }
}

function connectBackgroundWs(all) {
  // 列表未读走 /ws/inbox watch；聊天仍进页再连 /ws/chat/{id}
  try {
    const ids = (all || [])
      .map((c) => String(c?.profile?.id || c?.id || "").trim())
      .filter(Boolean);
    useInboxWsStore().ensureConnected(ids);
    useInboxWsStore().watchCompanions(ids);
  } catch (e) {
    console.warn("[messages] inbox watch failed", e);
  }
}

/** 拉取会话列表 */
async function loadConversations(background = false, { reset = true } = {}) {
  if (!reset) {
    if (messagesLoadingMore.value || !messagesHasMore.value || loading.value) return;
    messagesLoadingMore.value = true;
  } else {
    // 翻页进行中不要被全量刷新打断/解锁
    if (loadMoreInFlight || messagesLoadingMore.value) return;
    loadMoreBottomLatched = false;
    emptyAppendStreak = 0;
    if (!background) loading.value = true;
  }
  const seq = ++loadSeq;
  const page = reset ? 1 : messagesPage.value + 1;
  try {
    const { list, pagination } = await fetchBCompanions({
      special: "message",
      page,
      page_size: MESSAGES_PAGE_SIZE,
    });
    // 期间又发起了更新的请求（如 onShow 全量刷新），丢弃过期结果
    if (seq !== loadSeq) return;

    const batch = list || [];
    let appended = batch;
    if (reset) {
      // 接口空数据时保留旧列表，避免「刷新后整页空白」
      if (batch.length > 0 || rawCompanions.value.length === 0) {
        rawCompanions.value = batch;
      }
    } else {
      const seen = new Set(
        rawCompanions.value.map((c) => String(c?.profile?.id || c?.id || ""))
      );
      appended = batch.filter((c) => {
        const id = String(c?.profile?.id || c?.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      // 只 push，不主动改滚动；新会话在下方，滑到再看
      if (appended.length) {
        rawCompanions.value.push(...appended);
      }
    }
    syncCompanionsFromApi(batch);
    conversations.value = buildConversations(rawCompanions.value);
    // 用请求页码推进，避免接口 pagination.page 一直回 1 导致反复打同一页
    messagesPage.value = page;

    let hasMore = companionPageHasMore(batch, pagination, MESSAGES_PAGE_SIZE);
    if (!reset) {
      if (appended.length === 0) {
        emptyAppendStreak += 1;
        hasMore = false;
      } else {
        emptyAppendStreak = 0;
        if (batch.length < MESSAGES_PAGE_SIZE) hasMore = false;
      }
      if (emptyAppendStreak >= 1) hasMore = false;
    } else if (batch.length < MESSAGES_PAGE_SIZE) {
      hasMore = false;
    }
    messagesHasMore.value = hasMore;
    connectBackgroundWs(rawCompanions.value);
  } catch {
    if (seq !== loadSeq) return;
    if (!reset) messagesHasMore.value = false;
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      messagesLoadingMore.value = false;
      hasLoaded.value = true;
    }
  }
}

/** 仅短暂驱动 scroll-top，用完解除，避免后续渲染反复套用 */
function pinScrollTop(y) {
  const target = Math.max(0, Number(y) || 0);
  scrollTopArmed = true;
  scrollTopControl.value = target + 0.01;
  nextTick(() => {
    scrollTopControl.value = target;
    setTimeout(() => {
      scrollTopArmed = false;
    }, 50);
  });
}

function loadMoreConversations() {
  if (loadMoreBottomLatched) return;
  if (messagesLoadingMore.value || !messagesHasMore.value || loading.value) return;
  if (loadMoreInFlight) return;
  // App 短列表也会误触 scrolltolower：内容没溢出就不要翻页
  if (lastScrollHeight > 0 && lastScrollHeight <= listViewHeight.value + 24) return;
  loadMoreBottomLatched = true;
  loadMoreInFlight = loadConversations(true, { reset: false }).finally(() => {
    loadMoreInFlight = null;
  });
}

function measureListViewHeight() {
  try {
    uni
      .createSelectorQuery()
      .select(".main")
      .boundingClientRect((rect) => {
        const h = Number(rect?.height) || 0;
        if (h > 0) listViewHeight.value = h;
      })
      .exec();
  } catch {
    /* ignore */
  }
}

// ——— 跳转 ———

function openChat(id) {
  trackProductEvent(
    PRODUCT_EVENTS.CHAT_DETAIL_CLICK,
    withCompanionId({ page: "messages", target_id: String(id ?? "") }, id)
  );
  // 只跳转；由 chat 页统一建连，避免这里 manualReconnect 与 onMounted 抢连把握手掐死
  uni.navigateTo({ url: `/pages/chat/index?id=${id}` });
}

function goFeedback() {
  if (!isLoggedIn()) {
    showToast(t("messages.loginRequiredFeedback"));
    uni.reLaunch({ url: "/pages/login/index" });
    return;
  }
  trackProductEvent(PRODUCT_EVENTS.FEEDBACK_ENTRY_CLICK, {
    page: "messages",
  });
  uni.navigateTo({ url: "/pages-sub/feedback/index" });
}

function openMenu() {
  showMenu.value = true;
}

function closeMenu() {
  showMenu.value = false;
}

const {
  showCreateVipGate,
  createGateVip,
  createGatePoints,
  createGateVipName,
  createGateVipExpire,
  createGateVipType,
  enterCreateCompanion,
  onCreateVipPurchased,
} = useCreateCompanionEntry();

function goCreateCompanion() {
  showMenu.value = false;
  void enterCreateCompanion({ page: "messages", source: "menu" });
}

function goMyCompanions() {
  showMenu.value = false;
  trackProductEvent(PRODUCT_EVENTS.ROBOT_LIST_CLICK, { page: "messages", source: "menu" });
  // 我创建的智能体（明确 mine=1，避免标题/筛选歧义）
  uni.navigateTo({ url: "/pages-sub/my-companions/index?mine=1" });
}

const onOpenChatTap = bindAnalyticsTapArg(
  (id) => `messages-open-chat-${id}`,
  openChat
);

watch(
  () => [chat.unreadCounts, chat.lastMessages, rawCompanions.value],
  () => {
    // 纯组装：WS/本地发出改 store 时刷新列表；此处绝不 syncRemotePreview
    conversations.value = buildConversations(rawCompanions.value || []);
  },
  { deep: true }
);

// 仅用 onShow：首进页也会触发，避免再叠 onMounted 导致后台 WS 连两次被立刻关掉
onShow(() => {
  try {
    chat.syncChatPresenceFromRoute("messages-onShow");
  } catch {
    /* ignore */
  }
  if (hasUserGender()) {
    try {
      useLimitedOfferStore().onTabPageShow();
    } catch {
      /* ignore */
    }
  }
  try {
    chat.reloadForCurrentUser();
  } catch {
    /* ignore */
  }
  try {
    const sys = uni.getSystemInfoSync();
    listViewHeight.value = Math.max(400, (sys.windowHeight || 600) - 160);
  } catch {
    /* keep default */
  }
  conversations.value = buildConversations(rawCompanions.value || []);
  void (async () => {
    const paged = messagesPage.value > 1 || lastScrollTop > 80;
    const busy = Boolean(loadMoreInFlight || messagesLoadingMore.value);
    void loadFeedbackInbox();
    if (!hasLoaded.value) {
      await loadConversations(false, { reset: true });
    } else if (paged || busy) {
      // 已翻过页 / 正在 load-more：禁止 reset 把后面页砍掉打回「第一次」
      conversations.value = buildConversations(rawCompanions.value || []);
    } else {
      await loadConversations(true, { reset: true });
    }
    nextTick(() => measureListViewHeight());
    trackNoDataOfImIfNeeded(chat.totalUnread);
  })();
});

function onScroll(e) {
  const detail = e.detail || {};
  lastScrollTop = detail.scrollTop ?? 0;
  lastScrollHeight = Number(detail.scrollHeight) || lastScrollHeight;
  tabScroll.setScroll(TAB_PATH, lastScrollTop);
  const nearBottom = isScrollNearBottom(detail, listViewHeight.value);
  if (nearBottom) {
    loadMoreConversations();
    return;
  }
  if (messagesLoadingMore.value || loadMoreInFlight) return;
  loadMoreBottomLatched = false;
}

function onScrollToLower() {
  loadMoreConversations();
}

function scrollMessagesToTop() {
  pinScrollTop(0);
}

watch(
  () => tabScroll.scrollToTopTick[TAB_PATH],
  () => {
    scrollMessagesToTop();
  }
);
</script>

<template>
  <AppPageShell :show-header="false" show-tab-bar>
    <template #header>
      <!-- 稿 Frame：h58 px16；标题 24 Medium；+ 图标 28 -->
      <view class="msg-header">
        <text class="page-title">{{ t("messages.title") }}</text>
        <view class="menu-btn" @tap="openMenu">
          <image src="/static/messages/ico-add.svg" class="add-icon icon-on-fg" mode="aspectFit" />
        </view>
      </view>
    </template>
    <view class="msg-page">
      <scroll-view
        class="main"
        scroll-y
        :scroll-top="scrollTopArmed ? scrollTopControl : undefined"
        :show-scrollbar="false"
        :enhanced="true"
        :bounces="false"
        :lower-threshold="120"
        @scroll="onScroll"
        @scrolltolower="onScrollToLower"
      >
        <!-- 稿：px16 py12；搜索框 p12 r16 -->
        <view class="search-section">
          <view class="search-wrap">
            <image src="/static/messages/ico-search.svg" class="search-icon icon-on-fg" mode="aspectFit" />
            <input
              v-model="searchQuery"
              :placeholder="t('messages.searchPlaceholder')"
              placeholder-class="search-placeholder"
              class="search-input"
              confirm-type="search"
            />
            <text
              class="search-clear"
              :class="{ 'is-hidden': !searchQuery }"
              @tap="searchQuery = ''"
            >✕</text>
          </view>
        </view>

        <!-- Feedback 置顶：与会话骨架/列表解耦，避免 inbox 先回来把骨架条件掐掉 -->
        <view v-if="showFeedbackEntry" class="list list--feedback-pin">
          <view
            class="conv-row conv-row--feedback"
            @tap="bindAnalyticsTap('messages-feedback', goFeedback, '反馈入口')"
          >
            <view class="avatar-wrap">
              <image class="feedback-logo" :src="FEEDBACK_LOGO" mode="aspectFit" />
              <view v-if="feedbackUnread" class="badge">{{ feedbackUnread > 99 ? "99+" : feedbackUnread }}</view>
            </view>
            <view class="conv-body">
              <view class="conv-top">
                <view class="name-wrap">
                  <text class="name">{{ feedbackEntryName }}</text>
                  <text class="official-tag">{{ t("messages.feedbackOfficial") }}</text>
                </view>
                <text class="time">{{ feedbackTime }}</text>
              </view>
              <text class="preview">{{ feedbackPreview }}</text>
            </view>
          </view>
        </view>

        <AppListSkeleton v-if="loading && !conversations.length && !hasLoaded" class="flex-1" />

        <view v-else-if="showConversationEmpty" class="empty center">
          <text class="text-muted">{{ t("messages.noMessages") }}</text>
          <text class="text-muted hint">{{ t("messages.createCompanionHint") }}</text>
        </view>

        <view v-else-if="showSearchEmpty" class="empty center text-muted">{{ t("messages.searchNoResults") }}</view>

        <view v-else class="list">
          <!-- 稿行：px16 py12；头像 54；间距 8；名 16 / 时间 12@0.4 / 预览 14@0.6 -->
          <view
            v-for="c in filtered"
            :key="c.id"
            class="conv-row"
            @tap="onOpenChatTap(c.id)"
          >
            <view class="avatar-wrap">
              <AppAvatarImage :src="c.avatar" :seed="c.id" :generating="c.avatar_generating" />
              <view v-if="c.unread" class="badge">{{ c.unread > 99 ? "99+" : c.unread }}</view>
            </view>
            <view class="conv-body">
              <view class="conv-top">
                <view class="name-wrap">
                  <text class="name">{{ c.name }}</text>
                  <text v-if="c.isDeleted" class="deleted-tag">{{ t("common.deleted") }}</text>
                </view>
                <text class="time">{{ c.time }}</text>
              </view>
              <text
                v-if="chat.typingCompanions[c.id] && !c.unread"
                class="typing"
              >{{ t("messages.typing") }}</text>
              <text v-else class="preview" :class="{ 'preview--draft': c.isDraft }">{{ c.lastMessage || t("messages.noMessageYet") }}</text>
            </view>
          </view>
          <view
            v-if="messagesHasMore || messagesLoadingMore"
            class="loadmore-hint"
            :class="{ 'is-visible': messagesLoadingMore }"
          >
            <view v-if="messagesLoadingMore" class="list-loadmore-spinner" />
            <text v-if="messagesLoadingMore" class="text-muted">{{ t("common.loading") }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <view
      v-if="showMenu"
      class="action-modal-mask"
      @tap="closeMenu"
      @touchmove.stop.prevent
    >
      <view class="action-modal-sheet" @tap.stop>
        <view class="popup-content">
          <view class="popup-title">{{ t("messages.chooseAction") }}</view>
          <view class="popup-menu">
            <view class="popup-item" @click="bindAnalyticsTap('messages-create-companion', goCreateCompanion, '创建伴侣')">
              <view class="popup-icon create"><image src="/static/message/create.svg"></image></view>
              <view class="popup-text">
                <text class="popup-item-title">{{ t("home.create") }}</text>
                <text class="popup-item-desc">{{ t("messages.createDesc") }}</text>
              </view>
            </view>
            <view class="popup-item" @click="bindAnalyticsTap('messages-my-companions', goMyCompanions, '我的伴侣')">
              <view class="popup-icon list"><image src="/static/message/look.svg"></image></view>
              <view class="popup-text">
                <text class="popup-item-title">{{ t("messages.checkTitle") }}</text>
                <text class="popup-item-desc">{{ t("messages.checkDesc") }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <AppRechargeModal
      v-model:open="showCreateVipGate"
      default-tab="vip"
      :is-vip="createGateVip"
      :vip-name="createGateVipName"
      :vip-expire-date="createGateVipExpire"
      :vip-type="createGateVipType"
      :points="createGatePoints"
      analytics-scene="agent_create"
      @purchased="onCreateVipPurchased"
    />
    <!-- 限时优惠：消息 Tab 显示悬浮入口 -->
    <AppLimitedOfferHost show-entry />
  </AppPageShell>
</template>

<style scoped lang="scss">
page {
  background: var(--bg);
  overflow-x: hidden;
  overscroll-behavior-x: none;
}

/* 与首页 home-page 一致：占满壳层内容区 */
.msg-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

/* 与首页 home-body 一致：靠 flex 铺满 */
.main {
  flex: 1;
  height: 0;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  overscroll-behavior-x: none;
  touch-action: pan-y;
}

/* 与 settings / profile 一致：fixed 全屏遮罩，避免 u-popup 在壳层 column 内占半屏 */
.action-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}

.action-modal-sheet {
  width: 100%;
  max-width: 672px;
}

/* 稿 348:4746：h58；左右 16pt 由壳层 app-header-inner 提供，此处勿再叠 */
.msg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: var(--header-content-h, 116rpx);
  min-height: var(--header-content-h, 116rpx);
  padding: 0;
  box-sizing: border-box;
}

.page-title {
  font-size: var(--fs-title, 40rpx); /* 20pt，与壳/首页统一 */
  font-weight: 500;
  color: var(--fg);
  line-height: 1.2;
}

.menu-btn {
  width: 56rpx; /* 28 */
  height: 56rpx;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.add-icon {
  width: 56rpx;
  height: 56rpx;
  display: block;
}

/* 稿 348:4753：px16 py12 */
.search-section {
  padding: 24rpx var(--page-gutter, 32rpx);
  box-sizing: border-box;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 16rpx; /* 8 */
  /* 固定高度：避免 App 端 input 有字后撑高、清除按钮出现导致跳动 */
  height: 88rpx;
  min-height: 88rpx;
  max-height: 88rpx;
  padding: 0 24rpx;
  background: var(--surface-inset, rgba(255, 255, 255, 0.05));
  border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.05));
  border-radius: 32rpx; /* 16 */
  box-sizing: border-box;
  overflow: hidden;
}

.search-icon {
  width: 44rpx; /* 22 */
  height: 44rpx;
  flex-shrink: 0;
  display: block;
}

.search-input {
  flex: 1;
  min-width: 0;
  color: var(--fg);
  font-size: 28rpx; /* 14 */
  font-weight: 500;
  height: 44rpx;
  min-height: 44rpx;
  max-height: 44rpx;
  line-height: 44rpx;
  background: transparent;
  padding: 0;
  margin: 0;
}

.search-placeholder {
  color: var(--fg-placeholder, rgba(255, 255, 255, 0.3));
  font-weight: 500;
  font-size: 28rpx;
}

.search-clear {
  color: var(--fg-muted);
  font-size: 28rpx;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  flex-shrink: 0;
  padding: 0;
}

.search-clear.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.list {
  padding-bottom: 24rpx;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 80rpx 32rpx;
  text-align: center;
}

.loadmore-hint {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12rpx;
  /* 固定占位，避免 loading 显隐改 scrollHeight 触发贴底解锁连环请求 */
  height: 80rpx;
  padding: 0 32rpx;
  opacity: 0;
}
.loadmore-hint.is-visible {
  opacity: 1;
}
.list-loadmore-spinner {
  width: 28rpx;
  height: 28rpx;
  border: 4rpx solid var(--fg-faint, rgba(128, 128, 128, 0.25));
  border-top-color: var(--brand-text, var(--brand));
  border-radius: 50%;
  animation: list-loadmore-spin 0.7s linear infinite;
}
@keyframes list-loadmore-spin {
  to { transform: rotate(360deg); }
}

/* 稿会话行：px16 py12；头像 54；gap 8 */
.conv-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx var(--page-gutter, 32rpx);
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.avatar-wrap {
  position: relative;
  flex-shrink: 0;
  width: 108rpx; /* 54 */
  height: 108rpx;
}

.avatar-wrap :deep(.avatar-root) {
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
}

.badge {
  position: absolute;
  top: -4rpx;
  right: -4rpx;
  min-width: 32rpx;
  height: 32rpx;
  background: #ff3b30;
  color: #fff;
  font-size: 20rpx;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8rpx;
  box-sizing: border-box;
}

.conv-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16rpx; /* 8 */
}

.conv-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16rpx;
}

.name-wrap {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
  flex: 1;
}

.name {
  font-weight: 400;
  font-size: var(--fs-row-title, 32rpx); /* 16 */
  color: var(--fg);
  max-width: 360rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deleted-tag {
  flex-shrink: 0;
  padding: 4rpx 12rpx;
  border-radius: 999px;
  font-size: 20rpx;
  line-height: 1.3;
  background: rgba(255, 77, 79, 0.16);
  color: #ff6b6b;
  white-space: nowrap;
}

.official-tag {
  flex-shrink: 0;
  padding: 4rpx 12rpx;
  border-radius: 999px;
  font-size: 20rpx;
  line-height: 1.3;
  background: linear-gradient(135deg, rgba(255, 249, 70, 0.22) 0%, rgba(231, 71, 164, 0.22) 100%);
  color: var(--brand-text, var(--brand, #fff946));
  white-space: nowrap;
}

.theme-light .official-tag,
html[data-theme="light"] .official-tag,
page[data-theme="light"] .official-tag {
  background: linear-gradient(135deg, rgba(255, 249, 70, 0.65) 0%, rgba(231, 71, 164, 0.28) 100%);
  color: #9a6b1a;
}

.conv-row--feedback {
  background: rgba(255, 255, 255, 0.03);
}

.theme-light .conv-row--feedback,
html[data-theme="light"] .conv-row--feedback,
page[data-theme="light"] .conv-row--feedback {
  background: #ffffff;
}

.conv-row--feedback .avatar-wrap {
  width: 120rpx;
  height: 120rpx;
}

.feedback-logo {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  box-sizing: border-box;
  padding: 4rpx;
}

.theme-light .feedback-logo,
html[data-theme="light"] .feedback-logo,
page[data-theme="light"] .feedback-logo {
  background: #eeeeee;
}

.time {
  font-size: var(--fs-caption, 24rpx); /* 12 */
  color: var(--fg);
  opacity: 0.4;
  flex-shrink: 0;
  text-align: right;
}

.preview {
  display: block;
  font-size: var(--fs-body, 28rpx); /* 14 */
  font-weight: 400;
  color: var(--fg);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.preview--draft {
  color: var(--brand-text, var(--brand));
  opacity: 0.85;
}

.typing {
  color: var(--brand-text, var(--brand));
  font-size: 28rpx;
}

.hint {
  display: block;
  font-size: 24rpx;
  margin-top: 8rpx;
}

.center {
  text-align: center;
}

.popup-content {
  padding: 32rpx;
  padding-bottom: calc(50rpx + env(safe-area-inset-bottom));
  background: var(--modal-bg);
  overflow: hidden;
  border-radius: 40rpx 40rpx 0 0;
}

.popup-title {
  font-size: 32rpx;
  color: var(--fg);
  text-align: left;
  margin-bottom: 28rpx;
}

.popup-menu {
  display: flex;
  flex-direction: row;
}

.popup-item {
  margin-right: 24rpx;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding: 40rpx 32rpx;
  background: var(--bg-input);
  border: 1rpx solid var(--border-soft, var(--border));
  border-radius: 32rpx;
  box-sizing: border-box;
  flex: 1;
  transition: opacity 0.2s ease;

  &:last-child {
    margin-right: 0;
  }

  &:active {
    opacity: 0.7;
  }
}

.popup-icon {
  margin-bottom: 20rpx;
  width: 120rpx;
  height: 120rpx;
  border-radius: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  image {
    width: 120rpx;
    height: 120rpx;
  }
}

.popup-text {
  display: flex;
  align-items: center;
  flex-direction: column;
  width: 100%;
}

.popup-item-title {
  text-align: center;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--fg);
}

.popup-item-desc {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--fg-muted);
  text-align: center;
}
</style>
