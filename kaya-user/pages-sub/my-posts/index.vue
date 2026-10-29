<script setup>
/**
 * @file pages-sub/my-posts — 我的帖子
 * @description 拉取当前用户发帖列表，支持删除。
 * @depends apiFetch
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import { requireAuth } from "@/composables/useAuth";
import { normalizeMediaUrl, previewMedia } from "@/utils/media";
import apiFetch from "@/utils/api";
import {
  initListViewHeight,
  measureListViewHeight,
  inspectListScroll,
  nextListPage,
  resolveListHasMore,
  pushUniqueById,
  createListScrollGuard,
} from "@/utils/appListScroll";
import { useRelativeTime } from "@/composables/useRelativeTime";
import { useThemeStore } from "@/stores/theme";
import { likeIconSrc, commentIconSrc } from "@/utils/themeIcons";

const { t } = useI18n();
const { format: formatTime } = useRelativeTime("discover");
const themeStore = useThemeStore();
const commentIcon = computed(() =>
  commentIconSrc(themeStore.isDark)
);
requireAuth();

// ——— 状态 ———
const posts = ref([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const postsPage = ref(0);
const PAGE_SIZE = 5;
const deleteTargetId = ref(null);
const confirmOpen = ref(false);
/** 从帖子详情返回时才重拉列表（同步点赞数等） */
let pendingPostsSync = false;
let pageInitialized = false;

const listViewHeight = ref(initListViewHeight(160));
const pin = createListScrollGuard();
let loadMoreLatched = false;
let loadMoreInFlight = null;
let loadSeq = 0;

function measureHeight() {
  measureListViewHeight(".list-scroll", (h) => {
    listViewHeight.value = h;
  });
}

function pickPostsList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.posts)) return body.posts;
  return [];
}

/** 仅 true/1 视为已点赞；0 赞时强制未点赞（避免接口误标 liked 一直显示彩色心） */
function isPostLiked(p) {
  if (Number(p?.likes_count || 0) <= 0) return false;
  const v = p?.liked ?? p?.is_liked;
  return v === true || v === 1 || v === "1" || v === "true";
}

function likeSrc(p) {
  return isPostLiked(p)
    ? "/static/vest/common/like-red.png"
    : likeIconSrc(themeStore.isDark);
}

function reviewStatusLabel(status) {
  const s = status || "approved";
  if (s === "pending") return t("discover.reviewPending");
  if (s === "rejected") return t("discover.reviewRejected");
  return t("discover.reviewApproved");
}

function reviewStatusClass(status) {
  const s = status || "approved";
  if (s === "pending") return "status-pending";
  if (s === "rejected") return "status-rejected";
  return "status-approved";
}

/** 拉取我的帖子列表：GET /api/bposts/my */
async function fetchMyPosts({ reset = true } = {}) {
  if (!reset) {
    if (loadMoreInFlight || loadingMore.value || !hasMore.value || loading.value) return;
    loadingMore.value = true;
  } else if (!posts.value.length) {
    loading.value = true;
  }
  const seq = ++loadSeq;
  const page = nextListPage(reset, postsPage.value);
  try {
    const data = await apiFetch(
      `/api/bposts/my?page=${encodeURIComponent(page)}&page_size=${encodeURIComponent(PAGE_SIZE)}`
    );
    if (seq !== loadSeq) return;
    const batch = pickPostsList(data).map((p) => ({
      ...p,
      liked: isPostLiked(p),
    }));
    const pagination =
      data?.pagination && typeof data.pagination === "object"
        ? data.pagination
        : {};
    let appendedCount = batch.length;
    if (reset) {
      if (!(batch.length === 0 && posts.value.length > 0)) {
        posts.value = batch;
      }
    } else {
      const { appendedCount: n } = pushUniqueById(posts, batch);
      appendedCount = n;
    }
    postsPage.value = page;
    hasMore.value = resolveListHasMore({
      batch,
      pagination,
      pageSize: PAGE_SIZE,
      appendedCount,
      isReset: reset,
    });
  } catch (e) {
    console.error("[my-posts] load failed:", e);
    if (seq !== loadSeq) return;
    if (!reset) hasMore.value = false;
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
    nextTick(measureHeight);
  }
}

function loadMoreMyPosts() {
  if (loadMoreLatched) return;
  if (loading.value || loadingMore.value || loadMoreInFlight || !hasMore.value) return;
  if (!pin.contentOverflows(listViewHeight.value)) return;
  loadMoreLatched = true;
  loadMoreInFlight = fetchMyPosts({ reset: false }).finally(() => {
    loadMoreInFlight = null;
  });
}

function onMyPostsScroll(e) {
  const detail = e?.detail || {};
  pin.noteScroll(detail);
  const { load, unlock } = inspectListScroll(detail, listViewHeight.value, {
    hasMore: hasMore.value,
    busy: Boolean(loading.value || loadingMore.value || loadMoreInFlight),
    latched: loadMoreLatched,
  });
  if (load) {
    loadMoreMyPosts();
    return;
  }
  if (unlock) loadMoreLatched = false;
}

onMounted(async () => {
  measureHeight();
  await fetchMyPosts({ reset: true });
  pageInitialized = true;
});

onShow(() => {
  if (!pageInitialized) return;
  if (!pendingPostsSync) return;
  const busy = Boolean(loadMoreInFlight || loadingMore.value);
  if (busy || postsPage.value > 1) {
    pendingPostsSync = false;
    return;
  }
  pendingPostsSync = false;
  fetchMyPosts({ reset: true });
});

/** 确认删除帖子 */
async function handleDeleteConfirm() {
  if (deleteTargetId.value == null) return;
  try {
    await apiFetch(`/api/posts/${deleteTargetId.value}`, { method: "DELETE" });
    posts.value = posts.value.filter((p) => p.id !== deleteTargetId.value);
  } finally {
    deleteTargetId.value = null;
    confirmOpen.value = false;
  }
}
const topath = (id) => {
  pendingPostsSync = true;
  uni.navigateTo({ url: `/pages-sub/post/index?id=${id}` });
};
</script>

<template>
  <AppPageShell :title="t('profile.myMoments')" :show-back="true">
    <scroll-view
      scroll-y
      class="list-scroll"
      :lower-threshold="120"
      @scroll="onMyPostsScroll"
      @scrolltolower="loadMoreMyPosts"
    >
    <view class="px-md py-sm">
      <AppListSkeleton v-if="loading && !posts.length" />
      <view v-else-if="!posts.length" class="center text-muted py-lg">{{ t("discover.noPosts") }}</view>
      <view v-else>
        <view v-for="p in posts" :key="p.id" class="card post mt-md">
        <view class="flex-row justify-between items-center">
          <view class="flex-row items-center gap-sm">
            <AppAvatarImage :src="p.avatar" :seed="String(p.user_id || 'user')" size="sm" />
            <view>
              <text>{{ p.user_name }}</text>
              <text class="text-muted" style="display: block; font-size: 22rpx">{{ formatTime(p.created_at) }}</text>
            </view>
          </view>
          <view class="flex-row items-center gap-sm">
            <text class="status-tag" :class="reviewStatusClass(p.review_status)">{{ reviewStatusLabel(p.review_status) }}</text>
            <text @tap="deleteTargetId = p.id; confirmOpen = true">🗑</text>
          </view>
        </view>
        <view @click="topath(p.id)">
          <text class="title">{{ p.title }}</text>
          <text class="text-muted content">{{ p.content }}</text>
        </view>
        <scroll-view v-if="p.images?.length" scroll-x class="imgs">
          <image
            v-for="(img, i) in p.images.slice(0, 3)"
            :key="i"
            class="thumb"
            :src="normalizeMediaUrl(img) || ''"
            mode="aspectFill"
            @tap.stop="previewMedia(p.images, i)"
          />
        </scroll-view>
        <view class="social-actions meta">
          <view class="action-btn">
            <image
              class="action-img"
              :src="likeSrc(p)"
              mode="aspectFit"
            />
            <text class="action-count">{{ p.likes_count || 0 }}</text>
          </view>
          <view class="action-btn">
            <image class="action-img" :src="commentIcon" mode="aspectFit" />
            <text class="action-count">{{ p.comments_count || 0 }}</text>
          </view>
        </view>
        </view>
      </view>
    </view>
    </scroll-view>
    <AppConfirmDialog
      v-model:open="confirmOpen"
      :title="t('profile.deletePost')"
      :description="t('profile.deletePostConfirm')"
      :confirm-text="t('profile.deletePost')"
      destructive
      @confirm="handleDeleteConfirm"
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
.post { padding: 24rpx; }
.title { display: block; font-weight: 600; margin: 16rpx 0 8rpx; word-break: break-word; overflow-wrap: break-word; }
.content { display: block; font-size: 26rpx; line-height: 1.5; word-break: break-word; overflow-wrap: break-word; }
.imgs { white-space: nowrap; margin: 16rpx 0; }
.thumb { width: 160rpx; height: 160rpx; border-radius: 16rpx; margin-right: 12rpx; display: inline-block; }
.meta {
  justify-content: flex-start;
  margin-top: 12rpx;
}
.status-tag {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  line-height: 1.4;
}
.status-pending { color: #b45309; background: rgba(245, 158, 11, 0.15); }
.status-approved { color: #047857; background: rgba(16, 185, 129, 0.15); }
.status-rejected { color: #b91c1c; background: rgba(239, 68, 68, 0.15); }
.py-lg { padding: 80rpx 0; }
</style>
