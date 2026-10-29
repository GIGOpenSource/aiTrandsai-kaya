<script setup>
/**
 * @file MomentsFeedPanel.vue
 * @description 发现页 Moments Tab：头像条 + 双列朋友圈网格（对照 Figma 发现-Moments）
 */
import { ref, onMounted, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import { useHomeCompanions } from "@/composables/useHomeCompanions";
import apiFetch, { unwrapApiResults } from "@/utils/api";
import { deviceHeaders } from "@/utils/device";
import {
  readHomeMomentsCache,
  writeHomeMomentsCache,
} from "@/utils/homeCache";
import { formatCompanionName } from "@/utils/formatCompanion";
import { normalizeMediaUrl } from "@/utils/media";
import { bindAnalyticsTap } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { showToast } from "@/stores/toast";
import { likeIconSrc, momentCreateIconSrc } from "@/utils/themeIcons";
import { useThemeStore } from "@/stores/theme";

const props = defineProps({
  active: { type: Boolean, default: true },
});

const emit = defineEmits(["create"]);

const { t, locale } = useI18n();
const themeStore = useThemeStore();
const likeIcon = computed(() => likeIconSrc(themeStore.isDark));
const createIcon = computed(() => momentCreateIconSrc(themeStore.isDark));
/** 深色 PNG 已含圆底，铺满容器；浅色 SVG 纯图标，由 CSS 画圆 */
const createIconHasBase = computed(() => themeStore.isDark);

/** 双列瀑布流：按奇偶分列，列内紧挨、列间可错位 */
const momentColumns = computed(() => {
  const cols = [[], []];
  for (let i = 0; i < moments.value.length; i++) {
    cols[i % 2].push(moments.value[i]);
  }
  return cols;
});

const cachedMoments = readHomeMomentsCache();
const moments = ref(cachedMoments ?? []);
const loading = ref(!cachedMoments?.length);
const loadingMore = ref(false);
const hasMore = ref(true);
const momentsLoadError = ref(false);
let momentsPage = 0;
let momentsReqSeq = 0;
const PAGE_SIZE = 10;

const {
  companions,
  loadCompanionStrip,
  loadMoreCompanionStrip,
} = useHomeCompanions({ locale, t });

function pickMomentsList(body) {
  const unwrapped = unwrapApiResults(body);
  if (Array.isArray(unwrapped)) return unwrapped;
  if (Array.isArray(body?.moments)) return body.moments;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function loadMoments({ reset = true } = {}) {
  if (!reset) {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
  } else if (!moments.value.length) {
    loading.value = true;
  }

  const seq = ++momentsReqSeq;
  // 以本地已加载页为准推进；不要用接口里可能错误的 pagination.page 回写
  const page = reset ? 1 : momentsPage + 1;
  momentsLoadError.value = false;
  try {
    const momentsRes = await apiFetch(
      `/api/bmoments?page=${page}&page_size=${PAGE_SIZE}`,
      { header: deviceHeaders() }
    );
    if (seq !== momentsReqSeq) return;
    const newMoments = pickMomentsList(momentsRes);
    const pagination =
      momentsRes?.pagination && typeof momentsRes.pagination === "object"
        ? momentsRes.pagination
        : {};

    momentsPage = page;

    let appendedCount = newMoments.length;
    if (reset) {
      moments.value = newMoments;
    } else {
      const existingIds = new Set(moments.value.map((m) => String(m.id)));
      const appended = newMoments.filter((m) => !existingIds.has(String(m.id)));
      appendedCount = appended.length;
      moments.value = [...moments.value, ...appended];
    }

    const totalPages = Number(pagination.total_pages);
    if (!reset && appendedCount === 0) {
      hasMore.value = false;
    } else if (Number.isFinite(totalPages) && totalPages > 0) {
      hasMore.value = page < totalPages;
    } else {
      hasMore.value = newMoments.length >= PAGE_SIZE;
    }
    writeHomeMomentsCache(moments.value);
  } catch (err) {
    console.error("[moments-panel] load failed", err);
    if (reset && !moments.value.length) momentsLoadError.value = true;
  } finally {
    if (seq === momentsReqSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function goCreate() {
  // 由发现页统一走 create gate + AppRechargeModal，避免子组件另开一份 gate 状态
  emit("create");
}

function openCompanion(id) {
  if (!id) return;
  uni.navigateTo({ url: `/pages-sub/companion/index?id=${id}` });
}

function openMoment(m) {
  const momentId = m?.id != null ? String(m.id) : "";
  trackProductEvent(
    PRODUCT_EVENTS.MOMENTS_DETAIL_CLICK,
    withCompanionId({ page: "discover", target_id: momentId }, m?.companion_id)
  );
  uni.navigateTo({ url: `/pages-sub/moment/index?id=${momentId}` });
}

function displayName(m) {
  return formatCompanionName(
    m?.companion_name || m?.name,
    t("home.defaultCompanionName")
  );
}

function displayAvatar(m) {
  return m?.companion_avatar || m?.avatar || "";
}

function displayGender(m) {
  return m?.companion_gender || m?.gender || "";
}

function coverSrc(m) {
  return normalizeMediaUrl(m?.image_url || m?.cover || "") || "";
}

function captionText(m) {
  return String(m?.caption || m?.content || "").trim();
}

function isLiked(m) {
  if (Number(m?.likes_count || m?.likes || 0) <= 0) return false;
  const v = m?.liked ?? m?.is_liked;
  return v === true || v === 1 || v === "1" || v === "true";
}

function likesCount(m) {
  return Number(m?.likes_count ?? m?.likes ?? 0) || 0;
}

async function onLikeTap(m) {
  const id = m?.id;
  const idx = moments.value.findIndex((x) => String(x.id) === String(id));
  if (idx < 0) return;
  const prev = moments.value[idx];
  const liked = !isLiked(prev);
  const nextCount = Math.max(0, likesCount(prev) + (liked ? 1 : -1));
  moments.value[idx] = {
    ...prev,
    liked,
    is_liked: liked,
    likes_count: nextCount,
    likes: nextCount,
  };
  try {
    await apiFetch(`/api/moments/${id}/like`, {
      method: "POST",
      header: deviceHeaders(),
      body: { liked },
    });
  } catch {
    moments.value[idx] = prev;
    showToast(t("common.failed") || "Failed");
  }
}

function onCompanionStripTap(id) {
  openCompanion(id);
}

async function refresh() {
  await Promise.all([
    loadCompanionStrip({ reset: true }),
    loadMoments({ reset: true }),
  ]);
}

function loadMore() {
  void loadMoments({ reset: false });
}

watch(
  () => props.active,
  (on) => {
    if (on && !moments.value.length && !loading.value) {
      void refresh();
    }
  }
);

onMounted(() => {
  if (props.active) void refresh();
});

defineExpose({ refresh, loadMore });
</script>

<template>
  <view class="moments-panel">
    <view class="strip-wrap">
      <scroll-view
        scroll-x
        class="companion-strip"
        show-scrollbar="false"
        :lower-threshold="80"
        @scrolltolower="loadMoreCompanionStrip"
      >
        <view class="strip-row">
          <view
            class="strip-item"
            @tap="bindAnalyticsTap('discover-moments-create', goCreate, '创建伴侣')"
          >
            <view
              class="strip-create"
              :class="{ 'strip-create--asset': createIconHasBase }"
            >
              <image
                :src="createIcon"
                class="add-img"
                :class="{ 'add-img--full': createIconHasBase }"
                mode="aspectFit"
              />
            </view>
            <text class="strip-name">{{ t("home.create") }}</text>
          </view>
          <view
            v-for="c in companions"
            :key="c.id"
            class="strip-item"
            @tap="onCompanionStripTap(c.id)"
          >
            <view class="strip-avatar">
              <AppAvatarImage
                size="lg"
                :src="c.avatar"
                :seed="c.id"
                :generating="c.avatar_generating"
              />
            </view>
            <text class="strip-name">{{ c.name }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <view v-if="loading && !moments.length">
      <AppListSkeleton :rows="4" />
    </view>
    <view v-else-if="!moments.length" class="empty text-muted">
      <text>{{
        momentsLoadError ? t("common.loadFailed") : t("home.noMoments")
      }}</text>
    </view>
    <view v-else class="moments-masonry">
      <view
        v-for="(col, colIndex) in momentColumns"
        :key="colIndex"
        class="moments-col"
      >
        <view
          v-for="m in col"
          :key="m.id"
          class="moment-grid-card"
          @tap="openMoment(m)"
        >
          <view class="moment-cover-wrap">
            <image
              v-if="coverSrc(m)"
              class="moment-cover"
              :src="coverSrc(m)"
              mode="widthFix"
            />
            <view v-else class="moment-cover moment-cover--empty" />
          </view>
          <view class="moment-card-body">
            <text v-if="captionText(m)" class="moment-caption">{{
              captionText(m)
            }}</text>
            <view class="moment-card-footer">
              <view
                class="moment-author"
                @tap.stop="openCompanion(m.companion_id)"
              >
                <AppAvatarImage
                  class="moment-author-avatar"
                  :src="displayAvatar(m)"
                  :seed="String(m.companion_id || m.id)"
                  size="sm"
                />
                <text class="moment-author-name">{{ displayName(m) }}</text>
                <image
                  v-if="displayGender(m) === '男'"
                  src="/static/home/icon-male.svg"
                  class="gender-icon"
                  mode="aspectFit"
                />
                <image
                  v-else-if="displayGender(m) === '女'"
                  src="/static/home/icon-female.svg"
                  class="gender-icon"
                  mode="aspectFit"
                />
              </view>
              <view class="moment-like" @tap.stop="onLikeTap(m)">
                <image
                  class="moment-like-ico"
                  :src="isLiked(m) ? '/static/vest/common/like-red.png' : likeIcon"
                  mode="aspectFit"
                />
                <text class="moment-like-num">{{ likesCount(m) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
    <view v-if="loadingMore" class="feed-loadmore">
      <text class="text-muted">{{ t("common.loading") }}</text>
    </view>
    <view v-else-if="!hasMore && moments.length" class="feed-loadmore">
      <text class="text-muted">{{ t("home.noMoreMoments") }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.moments-panel {
  width: 100%;
  padding-bottom: 24rpx;
}

.strip-wrap {
  padding: 8rpx 0 20rpx;
}

.companion-strip {
  width: 100%;
  white-space: nowrap;
}

.strip-row {
  display: inline-flex;
  flex-direction: row;
  gap: 28rpx;
  padding: 0 32rpx;
}

.strip-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  width: 108rpx;
}

.strip-create,
.strip-avatar {
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.strip-avatar :deep(.avatar-root),
.strip-avatar :deep(.size-lg) {
  width: 108rpx !important;
  height: 108rpx !important;
}

/* 深色：PNG 自带圆底，不再叠一层背景 */
.strip-create--asset {
  background: transparent !important;
}

/* 浅色：只保留这一层圆底 */
html[data-theme="light"] .strip-create:not(.strip-create--asset),
page[data-theme="light"] .strip-create:not(.strip-create--asset),
.theme-light .strip-create:not(.strip-create--asset) {
  background: rgba(10, 10, 10, 0.08);
}

.add-img {
  width: 44rpx;
  height: 44rpx;
  display: block;
}

.add-img--full {
  width: 100%;
  height: 100%;
}

.strip-name {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  max-width: 108rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.moments-masonry {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 16rpx;
  padding: 0 32rpx;
  box-sizing: border-box;
}

.moments-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.moment-grid-card {
  width: 100%;
  border-radius: 24rpx;
  overflow: hidden;
  background: #2a2438;
  box-sizing: border-box;
}

html[data-theme="light"] .moment-grid-card,
page[data-theme="light"] .moment-grid-card,
.theme-light .moment-grid-card {
  background: #ffffff;
  box-shadow: 0 8rpx 24rpx rgba(15, 23, 42, 0.06);
}

.moment-cover-wrap {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}

.moment-cover {
  width: 100%;
  display: block;
  vertical-align: top;
}

.moment-cover--empty {
  width: 100%;
  height: 360rpx;
  background: linear-gradient(160deg, #2a1a3a, #151018);
}

html[data-theme="light"] .moment-cover--empty,
page[data-theme="light"] .moment-cover--empty,
.theme-light .moment-cover--empty {
  background: linear-gradient(160deg, #e8eef2, #d5dde3);
}

.moment-card-body {
  padding: 16rpx 18rpx 18rpx;
  box-sizing: border-box;
}

.moment-caption {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: 24rpx;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.92);
  word-break: break-word;
  margin-bottom: 16rpx;
}

html[data-theme="light"] .moment-caption,
page[data-theme="light"] .moment-caption,
.theme-light .moment-caption {
  color: #0a0a0a;
}

.moment-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
}

.moment-author {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  flex: 1;
}

.moment-author :deep(.avatar-root),
.moment-author-avatar {
  width: 36rpx !important;
  height: 36rpx !important;
  flex-shrink: 0;
}

.moment-author-name {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120rpx;
}

html[data-theme="light"] .moment-author-name,
page[data-theme="light"] .moment-author-name,
.theme-light .moment-author-name {
  color: #6b7280;
}

.gender-icon {
  width: 22rpx;
  height: 22rpx;
  flex-shrink: 0;
}

.moment-like {
  display: flex;
  align-items: center;
  gap: 6rpx;
  flex-shrink: 0;
}

.moment-like-ico {
  width: 28rpx;
  height: 28rpx;
}

.moment-like-num {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.55);
}

html[data-theme="light"] .moment-like-num,
page[data-theme="light"] .moment-like-num,
.theme-light .moment-like-num {
  color: #9ca3af;
}

.empty {
  padding: 80rpx 32rpx;
  text-align: center;
}

.feed-loadmore {
  padding: 24rpx;
  text-align: center;
}
</style>
