<script setup>
/**
 * @file pages-sub/my-companions — 我的伴侣列表
 * @description 展示已创建/拥有的伴侣；支持隐藏本地标记。
 * @depends companionsCache、storage、AppAvatarImage
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { onShow, onLoad } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppMarqueeText from "@/components/AppMarqueeText.vue";
import { requireAuth } from "@/composables/useAuth";
import { getItem } from "@/utils/storage";
import { fetchCompanions, fetchBCompanions, invalidateCompanionsCache } from "@/utils/companionsCache";
import {
  initListViewHeight,
  measureListViewHeight,
  inspectListScroll,
  nextListPage,
  resolveListHasMore,
  pushUniqueById,
  createListScrollGuard,
} from "@/utils/appListScroll";
import { sortCompanionsByUserLang } from "@/utils/companionLang";
import { formatAffectionDisplay } from "@/utils/formatAffection";
import { formatCompanionName } from "@/utils/formatCompanion";
import { useChatStore } from "@/stores/chat";
import { api } from "@/utils/api";
import { showToast } from "@/stores/toast";
import { bindAnalyticsTapArg } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";

const { t, locale } = useI18n();
const chat = useChatStore();
requireAuth();

const specialFrom = ref("");
/** 消息页「查看」：只看我创建的智能体 */
const isCreatedList = computed(() => {
  const v = specialFrom.value;
  return v === "1" || v === 1 || v === "mine" || v === true;
});

const PAGE_SIZE = 20;

const companionsFilter = computed(() => {
  if (isCreatedList.value) {
    return { is_created: true, intimacy_value: 0 };
  }
  return { intimacy_value: 5, intimacy_gt: true };
});

const isLoversList = computed(() => !isCreatedList.value);

const pageTitle = computed(() => {
  if (isCreatedList.value) {
    return t("messages.myCreatedCompanions");
  }
  return t("profile.myCompanions");
});

// ——— 状态与隐藏 ———
function mapCompanion(c) {
  const profile = c.profile || {};
  const state = c.state || {};
  return {
    id: String(profile.id || ""),
    name: formatCompanionName(profile.name, t("home.defaultCompanionName")),
    avatar: c.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
    gender: profile.gender || "",
    city: profile.city || "",
    personality: profile.personality || "",
    mbti: profile.mbti || "",
    affection: state.affection || 0,
    turns: state.turns || 0,
    mood: state.mood || profile.mood || "",
    createdBy: String(profile.created_by || ""),
    avatar_generating: c.avatar_generating,
  };
}

function mapCompanions(data) {
  const sorted = sortCompanionsByUserLang(data || [], locale.value);
  return sorted.map(mapCompanion);
}

const companions = ref([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const companionsPage = ref(0);
const removing = ref(false);
const currentUserId = ref("");
const removeTargetId = ref(null);

const listViewHeight = ref(initListViewHeight(160));
const pin = createListScrollGuard();
let loadMoreLatched = false;
let loadMoreInFlight = null;
let loadSeq = 0;

const visibleCompanions = computed(() => companions.value);

function measureHeight() {
  measureListViewHeight(".list-scroll", (h) => {
    listViewHeight.value = h;
  });
}

function getAffectionLevel(affection) {
  if (affection >= 80) return { label: t("myCompanions.soulmate"), color: "text-primary" };
  if (affection >= 50) return { label: t("myCompanions.close"), color: "purple" };
  if (affection >= 20) return { label: t("myCompanions.familiar"), color: "blue" };
  return { label: t("myCompanions.stranger"), color: "muted" };
}

function resolveCurrentUserId() {
  try {
    const raw = getItem("user_info");
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.id != null && u.id !== "") return String(u.id);
    }
  } catch {
    /* ignore */
  }
  return "";
}

function resolveCurrentUserAliases() {
  const aliases = new Set();
  const id = resolveCurrentUserId();
  if (id) aliases.add(id);
  try {
    const raw = getItem("user_info");
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.username) aliases.add(String(u.username));
      if (u?.nickname) aliases.add(String(u.nickname));
    }
  } catch {
    /* ignore */
  }
  return aliases;
}

/** 兜底：is_created 接口空时，从消息场景列表按 created_by 本地筛 */
async function loadCreatedFallback() {
  const aliases = resolveCurrentUserAliases();
  const raw = await fetchCompanions({ special: "message", page: 1, page_size: 100 }, { force: true });
  let list = mapCompanions(raw);
  if (aliases.size) {
    list = list.filter((c) => c.createdBy && aliases.has(c.createdBy));
  } else {
    list = [];
  }
  return list;
}

// ——— 加载列表 ———
async function loadCompanions(background = false, { reset = true } = {}) {
  if (!reset) {
    if (loadMoreInFlight || loadingMore.value || !hasMore.value || loading.value) return;
    loadingMore.value = true;
  } else {
    if (loadMoreInFlight || loadingMore.value) return;
    if (!background) loading.value = true;
  }
  const seq = ++loadSeq;
  const page = nextListPage(reset, companionsPage.value);
  try {
    const { list, pagination } = await fetchBCompanions({
      ...companionsFilter.value,
      page,
      page_size: PAGE_SIZE,
    });
    if (seq !== loadSeq) return;
    let mapped = mapCompanions(list);
    if (reset && isCreatedList.value && !mapped.length) {
      companions.value = await loadCreatedFallback();
      companionsPage.value = 1;
      hasMore.value = false;
      return;
    }
    if (isLoversList.value) {
      mapped = mapped.filter((c) => Number(c.affection || 0) > 5);
    }
    let appendedCount = mapped.length;
    if (reset) {
      if (!(Array.isArray(list) && list.length === 0 && companions.value.length > 0)) {
        companions.value = mapped;
      }
    } else {
      const { appendedCount: n } = pushUniqueById(companions, mapped);
      appendedCount = n;
    }
    companionsPage.value = page;
    const filteredEmptyButRawFull =
      isLoversList.value &&
      mapped.length === 0 &&
      Array.isArray(list) &&
      list.length > 0;
    hasMore.value = resolveListHasMore({
      batch: list,
      pagination,
      pageSize: PAGE_SIZE,
      appendedCount,
      isReset: reset,
      emptyAppendStops: !filteredEmptyButRawFull,
    });
  } catch (e) {
    console.error("[my-companions] load failed:", e);
    if (seq !== loadSeq) return;
    if (reset && isCreatedList.value) {
      try {
        companions.value = await loadCreatedFallback();
        hasMore.value = false;
      } catch {
        /* keep previous */
      }
    } else if (!reset) {
      hasMore.value = false;
    }
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
    nextTick(measureHeight);
  }
}

function loadMoreCompanions() {
  if (loadMoreLatched) return;
  if (loading.value || loadingMore.value || loadMoreInFlight || !hasMore.value) return;
  if (!pin.contentOverflows(listViewHeight.value)) return;
  loadMoreLatched = true;
  loadMoreInFlight = (async () => {
    await loadCompanions(true, { reset: false });
    trackProductEvent(PRODUCT_EVENTS.ROBOT_LIST_PULL_UP, { page: "my_companions" });
  })().finally(() => {
    loadMoreInFlight = null;
  });
}

function onCompanionsScroll(e) {
  const detail = e?.detail || {};
  pin.noteScroll(detail);
  const { load, unlock } = inspectListScroll(detail, listViewHeight.value, {
    hasMore: hasMore.value,
    busy: Boolean(loading.value || loadingMore.value || loadMoreInFlight),
    latched: loadMoreLatched,
  });
  if (load) {
    loadMoreCompanions();
    return;
  }
  if (unlock) loadMoreLatched = false;
}

onLoad((options) => {
  // 兼容：?a=1（旧） / ?mine=1（新）
  if (options?.mine === "1" || options?.mine === 1 || options?.a === "1" || options?.a === 1) {
    specialFrom.value = "1";
  } else if (options?.a) {
    specialFrom.value = options.a;
  } else if (options?.special) {
    specialFrom.value = options.special;
  }
  currentUserId.value = resolveCurrentUserId();
  loadCompanions(false);
});

onMounted(() => {
  if (!currentUserId.value) currentUserId.value = resolveCurrentUserId();
  // onLoad 未触发时的兜底（极端环境）
  if (!companions.value.length && !loading.value) {
    loadCompanions(false);
  }
});

onShow(() => {
  const busy = Boolean(loadMoreInFlight || loadingMore.value);
  // 已翻页 / 加载中：勿 reset 砍掉后面页
  if (busy || companionsPage.value > 1) return;
  // 创建成功返回时列表可能仍为空，首页态仍要刷新
  loadCompanions(true);
});

const confirmOpen = ref(false);

// ——— 操作 ———
async function handleRemoveConfirm() {
  const id = removeTargetId.value;
  if (!id || removing.value) return;
  removing.value = true;
  try {
    await api.delete(`/companions/${id}`);
    companions.value = companions.value.filter((c) => c.id !== String(id));
    invalidateCompanionsCache();
    chat.clearCompanionMeta(id);
    showToast(t("common.deleteSuccess"));
  } catch (e) {
    console.error("删除伴侣失败:", e);
  } finally {
    removing.value = false;
    removeTargetId.value = null;
    confirmOpen.value = false;
  }
}

function openChat(id) {
  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
    withCompanionId(
      { page: "my_companions", source: "list", target_id: String(id ?? "") },
      id
    )
  );
  // 只跳转；由 chat 页统一建连，避免与 onMounted 抢连
  uni.navigateTo({ url: `/pages/chat/index?id=${id}` });
}

function promptRemove(id) {
  removeTargetId.value = id;
  confirmOpen.value = true;
}

const onChatTap = bindAnalyticsTapArg(
  (id) => `my-companions-chat-${id}`,
  openChat
);
const onRemoveTap = bindAnalyticsTapArg(
  (id) => `my-companions-remove-${id}`,
  promptRemove
);
</script>

<template>
  <AppPageShell
    :title="pageTitle"
    :show-back="specialFrom !== 'message'"
    :show-tab-bar="specialFrom === 'message'"
    back-analytics-id="my-companions-back"
    back-analytics-name="我的伴侣页返回"
  >
    <scroll-view
      scroll-y
      class="list-scroll"
      :lower-threshold="120"
      @scroll="onCompanionsScroll"
      @scrolltolower="loadMoreCompanions"
    >
    <view class="px-md py-sm">
      <view class="stats-row flex-row">
        <view class="stat card"><text class="num">{{ visibleCompanions.length }}</text><text class="text-muted">{{ t("myCompanions.total") }}</text></view>
        <view class="stat card"><text class="num">{{ visibleCompanions.reduce((s, c) => s + c.affection, 0).toFixed(2) }}</text><text class="text-muted">{{ t("myCompanions.totalAffection") }}</text></view>
        <view class="stat card"><text class="num">{{ visibleCompanions.reduce((s, c) => s + c.turns, 0) }}</text><text class="text-muted">{{ t("profile.chatTurns") }}</text></view>
      </view>

      <AppListSkeleton v-if="loading && !visibleCompanions.length" />
      <view v-else-if="!visibleCompanions.length" class="center text-muted py-lg">{{ t("common.noData") }}</view>
      <template v-else>
        <view
          v-for="c in visibleCompanions"
          :key="c.id"
          class="card row mt-md"
        >
        <AppAvatarImage :src="c.avatar" :seed="c.id" :generating="c.avatar_generating" />
        <view class="row-body">
          <view class="title-row">
            <AppMarqueeText class="name" :text="c.name" :threshold="6" />
            <text v-if="c.mbti" class="mbti">{{ c.mbti }}</text>
            <text v-if="c.createdBy === currentUserId" class="self-tag">{{ t("myCompanions.selfCreated") }}</text>
          </view>
          <text class="text-muted meta">{{ c.city }} · {{ c.mood }}</text>
          <text class="affection">♥ {{ formatAffectionDisplay(c.affection) }} · {{ getAffectionLevel(c.affection).label }}</text>
        </view>
        <view class="actions flex-col gap-sm">
          <view
            class="icon-btn primary"
            hover-class="none"
            @tap="onChatTap(c.id)"
          >
            <text class="icon-btn-mark">💬</text>
          </view>
          <view
            class="icon-btn"
            hover-class="none"
            @tap="onRemoveTap(c.id)"
          >
            <text class="icon-btn-mark">🗑️</text>
          </view>
        </view>
        </view>
        <view
          v-if="hasMore || loadingMore"
          class="list-loadmore"
          :class="{ 'is-visible': loadingMore }"
        >
          <view v-if="loadingMore" class="list-loadmore-spinner" />
          <text v-if="loadingMore" class="list-loadmore-text">{{ t("common.loading") }}</text>
        </view>
      </template>
    </view>
    </scroll-view>

    <AppConfirmDialog
      v-model:open="confirmOpen"
      :title="t('myCompanions.removeFromList')"
      :description="t('myCompanions.deleteConfirm')"
      :confirm-text="t('common.confirm')"
      :cancel-text="t('common.cancel')"
      destructive
      @confirm="handleRemoveConfirm"
    />
  </AppPageShell>
</template>

<style scoped lang="scss">
.list-scroll {
  flex: 1;
  height: 0;
  min-height: 0;
  width: 100%;
}
.center { text-align: center; padding: 80rpx 0; }
.stats-row { gap: 16rpx; margin-bottom: 24rpx; }
.stat { flex: 1; padding: 24rpx; text-align: center; }
.num { display: block; font-size: 36rpx; font-weight: 600; }
.row {
  display: flex;
  gap: 16rpx;
  padding: 24rpx;
  align-items: center;
  overflow: hidden;
}
.row-body {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}
.name {
  font-weight: 600;
  font-size: var(--fs-row-title, 32rpx);
  color: var(--fg);
  min-width: 0;
}
.mbti,
.self-tag {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: var(--fs-meta, 22rpx);
  padding: 4rpx 12rpx;
  background: var(--bg-input);
  border-radius: 8rpx;
  line-height: 1.3;
}
.meta {
  display: block;
  font-size: var(--fs-caption, 24rpx);
  margin: 8rpx 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.affection {
  font-size: var(--fs-caption, 24rpx);
  color: var(--brand-text, var(--brand));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  flex-shrink: 0;
}
.icon-btn {
  width: 72rpx;
  height: 72rpx;
  min-width: 72rpx;
  min-height: 72rpx;
  border-radius: 50%;
  padding: 0;
  margin: 0;
  border: none;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: visible;
  flex-shrink: 0;
  line-height: 1;
  background: var(--bg-input);

  &.primary {
    background: var(--gradient-brand);
  }
}

.icon-btn-mark {
  width: 36rpx;
  height: 36rpx;
  font-size: 32rpx;
  line-height: 36rpx;
  text-align: center;
}
.flex-1 { flex: 1; min-width: 0; }
.py-lg { padding: 80rpx 0; }
.list-loadmore {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12rpx;
  height: 80rpx;
  opacity: 0;
}
.list-loadmore.is-visible { opacity: 1; }
.list-loadmore-text { font-size: 24rpx; color: var(--fg-muted); }
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
</style>
