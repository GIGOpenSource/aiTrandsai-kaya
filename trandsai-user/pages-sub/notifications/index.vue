<script setup>
/**
 * @file pages-sub/notifications — 通知列表
 * @description 聚合：朋友圈新动态 + 系统通知。支持触底分页加载。
 * UI 对齐：AppPageShell + bills tab 指示条 + messages 列表行。
 * @depends apiFetch、storage、utils/notifications
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppMomentImage from "@/components/AppMomentImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import { requireAuth } from "@/composables/useAuth";
import { getItem, setItem } from "@/utils/storage";
import { deviceHeaders } from "@/utils/device";
import { previewMedia } from "@/utils/media";
import apiFetch from "@/utils/api";
import { readHomeMomentsCache } from "@/utils/homeCache";
import {
  initListViewHeight,
  measureListViewHeight,
  inspectListScroll,
  createListScrollGuard,
} from "@/utils/appListScroll";
import { useRelativeTime } from "@/composables/useRelativeTime";
import {
  buildMomentPostItems,
  parseStoredIdList,
} from "@/utils/notifications";

const { t, locale } = useI18n();
const { format: formatTime } = useRelativeTime("messages");
requireAuth();

const PAGE_SIZE = 5;
let momentsOffset = 0;

/** 朋友圈通知 items */
const momentItems = ref([]);
/** 系统通知 items */
const systemNotifs = ref([]);
/** 合并排序后的全部通知（computed 自动响应） */
const notifications = computed(() => {
  const list = [...momentItems.value, ...systemNotifs.value];
  list.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
  return list;
});

const filter = ref("all");
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);

const listViewHeight = ref(initListViewHeight(200));
const pin = createListScrollGuard();
let loadMoreLatched = false;
let loadMoreInFlight = null;

function measureHeight() {
  measureListViewHeight(".list-scroll", (h) => {
    listViewHeight.value = h;
  });
}

const filtered = computed(() =>
  filter.value === "all"
    ? notifications.value
    : notifications.value.filter((n) => n.type === filter.value)
);

const tabs = computed(() => [
  ["all", t("notifications.tabAll")],
  ["moment", t("notification.moments")],
  ["system", t("notification.system")],
]);

function setFilter(key) {
  if (filter.value === key) return;
  filter.value = key;
}

function avatarLetter(item) {
  const s = String(item?.title || item?.content || "?").trim();
  return s ? s.slice(0, 1).toUpperCase() : "?";
}

function buildFromMoments(moments) {
  const lastViewed = getItem("moments_last_viewed");
  return buildMomentPostItems(moments, lastViewed, t);
}

/** 加载朋友圈（支持分页） */
async function loadMomentsPage(offset = 0) {
  const mq = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    lang: locale.value || "zh",
  });

  const momentsRes = await apiFetch(
    `/api/moments?${mq.toString()}`,
    { header: deviceHeaders() }
  );

  const newMoments = momentsRes?.moments || [];
  const total = momentsRes?.total || 0;
  const nextOffset = offset + newMoments.length;
  momentsOffset = nextOffset;
  if (!newMoments.length) {
    hasMore.value = false;
  } else {
    hasMore.value = nextOffset < total;
  }

  const items = buildFromMoments(newMoments);
  return { items, total };
}

/** 加载系统通知（仅首次；apiFetch 自动带 x-token，可拿到审核通过定向通知） */
async function loadSystemNotifs() {
  try {
    const viewedKey = `sys_notifications_viewed_${locale.value}`;
    const viewedIds = parseStoredIdList(getItem(viewedKey));

    const sysRes = await apiFetch(
      `/api/notifications?language=${locale.value}&limit=20`,
      { header: deviceHeaders() }
    );

    systemNotifs.value = (sysRes?.notifications || []).map((n) => ({
      id: `sys-${n.id}`,
      type: "system",
      sysId: String(n.id),
      title: n.title,
      content: n.content,
      time: n.created_at,
      read: viewedIds.includes(String(n.id)),
      companionId: n.companion_id || null,
    }));
  } catch (e) {
    console.error("加载系统通知失败:", e);
  }
}

/** 将单条系统通知标记为已读并持久化 */
function markSystemNotifRead(item) {
  if (!item || item.type !== "system" || item.read || !item.sysId) return;
  systemNotifs.value = systemNotifs.value.map((n) =>
    n.id === item.id ? { ...n, read: true } : n
  );
  const viewedKey = `sys_notifications_viewed_${locale.value}`;
  const viewedIds = parseStoredIdList(getItem(viewedKey));
  if (!viewedIds.includes(item.sysId)) {
    viewedIds.push(item.sysId);
    setItem(viewedKey, JSON.stringify(viewedIds));
  }
}

/** 首次加载 */
async function loadInitialNotifications() {
  loading.value = true;
  try {
    const [{ items }] = await Promise.all([
      loadMomentsPage(0),
      loadSystemNotifs(),
    ]);
    momentItems.value = items;
    setItem("moments_last_viewed", new Date().toISOString());
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  measureHeight();
  loadInitialNotifications().then(() => nextTick(measureHeight));
});

function previewNotifImage(url) {
  if (!url) return;
  previewMedia(url);
}

/** 触底加载更多 */
async function loadMore() {
  if (loadMoreLatched) return;
  if (loadingMore.value || !hasMore.value || loading.value || loadMoreInFlight) return;
  if (!pin.contentOverflows(listViewHeight.value)) return;
  loadMoreLatched = true;
  loadingMore.value = true;
  loadMoreInFlight = (async () => {
    try {
      const { items } = await loadMomentsPage(momentsOffset);
      if (items.length) {
        momentItems.value.push(...items);
      } else {
        hasMore.value = false;
      }
    } catch (e) {
      console.error("加载更多失败:", e);
      hasMore.value = false;
    } finally {
      loadingMore.value = false;
      loadMoreInFlight = null;
      nextTick(measureHeight);
    }
  })();
}

function onNotificationsScroll(e) {
  const detail = e?.detail || {};
  pin.noteScroll(detail);
  const { load, unlock } = inspectListScroll(detail, listViewHeight.value, {
    hasMore: hasMore.value,
    busy: Boolean(loading.value || loadingMore.value || loadMoreInFlight),
    latched: loadMoreLatched,
  });
  if (load) {
    void loadMore();
    return;
  }
  if (unlock) loadMoreLatched = false;
}

function handleClick(item) {
  if (item.type === "system") {
    markSystemNotifRead(item);
    if (item.companionId) {
      uni.navigateTo({
        url: `/pages/chat/index?id=${encodeURIComponent(item.companionId)}`,
      });
    }
    return;
  }
  if (item.type === "moment" && item.momentId) {
    uni.navigateTo({ url: `/pages-sub/moment/index?id=${item.momentId}` });
  }
}

/* 用首页缓存做初始占位，不参与 loadMore 逻辑 */
function hydrateFromCache() {
  const cached = readHomeMomentsCache();
  if (!cached?.length) return;
  const items = buildFromMoments(cached);
  momentItems.value = items;
}
hydrateFromCache();
</script>

<template>
  <AppPageShell
    :title="t('notifications.title')"
    :show-back="true"
    title-align="start"
    back-analytics-id="notifications-back"
    back-analytics-name="通知页返回"
  >
    <view class="notif-body">
      <view class="notif-tabs-wrap">
        <scroll-view scroll-x class="notif-tabs-scroll" :show-scrollbar="false">
          <view class="notif-tabs">
            <view
              v-for="tab in tabs"
              :key="tab[0]"
              class="notif-chip"
              :class="{ active: filter === tab[0] }"
              @tap.stop="setFilter(tab[0])"
            >
              <text>{{ tab[1] }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <scroll-view
        scroll-y
        class="list-scroll"
        :lower-threshold="150"
        @scroll="onNotificationsScroll"
        @scrolltolower="loadMore"
      >
        <AppListSkeleton v-if="loading && !notifications.length" :rows="5" />

        <view v-else-if="!filtered.length" class="empty">
          <text class="empty-title">{{ t("notifications.empty") }}</text>
          <text class="empty-hint text-muted">{{ t("notifications.emptyHint") }}</text>
        </view>

        <view v-else class="notif-list">
          <view
            v-for="item in filtered"
            :key="item.id"
            class="notif-row"
            @tap="handleClick(item)"
          >
            <view class="avatar-wrap">
              <AppAvatarImage
                v-if="item.avatar"
                :src="item.avatar"
                :seed="item.companionId || item.id"
                size="md"
              />
              <view v-else class="letter-avatar">
                <text class="letter-avatar-text">{{ avatarLetter(item) }}</text>
              </view>
              <view v-if="!item.read" class="unread-dot" />
            </view>

            <view class="notif-body-col">
              <view class="notif-top">
                <text class="title">{{ item.title }}</text>
                <text class="time">{{ formatTime(item.time) }}</text>
              </view>
              <text class="snippet">{{ item.content }}</text>
              <AppMomentImage
                v-if="item.imageUrl"
                :src="item.imageUrl"
                mode="aspectFill"
                img-class="notif-moment-img"
                @click="previewNotifImage(item.imageUrl)"
              />
            </view>
          </view>

          <view
            v-if="filtered.length && (hasMore || loadingMore)"
            class="list-loadmore"
            :class="{ 'is-visible': loadingMore }"
          >
            <view v-if="loadingMore" class="list-loadmore-spinner" />
            <text v-if="loadingMore" class="list-loadmore-text">{{ t("common.loading") }}</text>
          </view>
          <view v-else-if="!hasMore && notifications.length" class="footer-hint">
            <text class="text-muted no-more">{{ t("home.noMoreMoments") }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </AppPageShell>
</template>

<style scoped lang="scss">
.notif-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg);
}

/* tabs：垂直 padding 放在 wrap 外，避免 scroll-x 裁切 chip 上下边 */
.notif-tabs-wrap {
  flex-shrink: 0;
  width: 100%;
  padding: 16rpx 0 20rpx;
  background: var(--bg);
  box-sizing: border-box;
}

.notif-tabs-scroll {
  width: 100%;
  white-space: nowrap;
  /* 给 chip 上下留 2rpx，防 1rpx border 被 scroll-view overflow 吃掉 */
  height: 76rpx;
  box-sizing: content-box;
}

.notif-tabs {
  display: inline-flex;
  align-items: center;
  gap: 24rpx;
  height: 76rpx;
  padding: 0 var(--page-gutter, 32rpx);
  box-sizing: border-box;
}

.notif-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 32rpx;
  font-size: 28rpx;
  line-height: 1.2;
  white-space: nowrap;
  background: var(--surface-faint, rgba(255, 255, 255, 0.03));
  border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.05));
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  box-sizing: border-box;

  &.active {
    background: var(--fg);
    border-color: var(--fg);
    color: var(--bg);
    font-weight: 500;
  }
}

.list-scroll {
  flex: 1;
  min-height: 0;
}

.notif-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx; /* 通知条目之间留白 */
  padding: 8rpx 0 32rpx;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 48rpx;
  text-align: center;
  gap: 12rpx;
}

.empty-title {
  font-size: 30rpx;
  color: var(--fg);
  opacity: 0.85;
}

.empty-hint {
  font-size: 26rpx;
  min-height: 1em;
}

/* 列表行：对齐 messages，条目间距由 .notif-list gap 承担 */
.notif-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 20rpx var(--page-gutter, 32rpx);
  box-sizing: border-box;
}

.avatar-wrap {
  position: relative;
  flex-shrink: 0;
  width: 96rpx;
  height: 96rpx;
}

.avatar-wrap :deep(.avatar-root),
.avatar-wrap :deep(.size-md) {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
}

.letter-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  justify-content: center;
}

.letter-avatar-text {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--fg);
  opacity: 0.7;
}

.unread-dot {
  position: absolute;
  top: 2rpx;
  right: 2rpx;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  // background: #ff3b30;
  border: 2rpx solid var(--bg);
  box-sizing: border-box;
}

.notif-body-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding-top: 4rpx;
}

.notif-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  width: 100%;
}

.title {
  font-size: var(--fs-row-title, 32rpx);
  font-weight: 400;
  color: var(--fg);
  max-width: 420rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: var(--fs-caption, 24rpx);
  color: var(--fg);
  opacity: 0.4;
  flex-shrink: 0;
}

.snippet {
  display: block;
  font-size: var(--fs-body, 28rpx);
  font-weight: 400;
  color: var(--fg);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-moment-img {
  width: 160rpx;
  height: 160rpx;
  border-radius: 16rpx;
  margin-top: 8rpx;
  overflow: hidden;
}

.footer-hint {
  padding: 32rpx 0;
  text-align: center;

  .no-more {
    font-size: 24rpx;
    opacity: 0.6;
  }
}
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
