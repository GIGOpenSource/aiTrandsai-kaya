<script setup>
/**
 * @file pages-sub/post — 社区帖子详情
 * @description 布局对齐朋友圈详情：顶栏身份、多图网格（一行三图）、正文+赞、评论卡、底栏输入。
 * @depends apiFetch、deviceHeaders
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import { requireAuth, getCurrentUserId } from "@/composables/useAuth";
import { deviceHeaders } from "@/utils/device";
import { normalizeMediaUrl, previewMedia } from "@/utils/media";
import apiFetch from "@/utils/api";
import { showToast } from "@/stores/toast";
import { useRelativeTime } from "@/composables/useRelativeTime";
import { useThemeStore } from "@/stores/theme";
import { likeIconSrc } from "@/utils/themeIcons";
import { blockUser, reportUgcContent, isUserBlocked } from "@/utils/ugcSafety";

const themeStore = useThemeStore();
const likeIcon = computed(() =>
  likeIconSrc(themeStore.isDark)
);

let postId = "";
const { t, te } = useI18n();
const { format: formatTime } = useRelativeTime("discover");
requireAuth();

const post = ref(null);
const loading = ref(true);
const commentText = ref("");
const commentInputKey = ref(0);
const sending = ref(false);
const inputFocus = ref(false);
const scrollIntoView = ref("");
const showSafetyMenu = ref(false);
const safetyBusy = ref(false);

const isOwnPost = computed(() => {
  const me = getCurrentUserId();
  const uid = post.value?.user_id;
  return me != null && uid != null && String(me) === String(uid);
});

function openSafetyMenu() {
  if (!post.value || isOwnPost.value) return;
  showSafetyMenu.value = true;
}

function closeSafetyMenu() {
  showSafetyMenu.value = false;
}

async function handleReportPost() {
  closeSafetyMenu();
  if (!post.value || safetyBusy.value) return;
  if (isOwnPost.value) {
    showToast(t("ugcSafety.cannotReportSelf"));
    return;
  }
  uni.showModal({
    title: t("ugcSafety.reportTitle"),
    content: t("ugcSafety.reportConfirm"),
    confirmText: t("common.confirm"),
    cancelText: t("common.cancel"),
    success: async (res) => {
      if (!res.confirm) return;
      safetyBusy.value = true;
      try {
        await reportUgcContent({
          type: "post",
          targetId: post.value.id,
          reason: "objectionable",
          extra: `author=${post.value.user_id || ""} title=${post.value.title || ""}`,
        });
        showToast(t("ugcSafety.reportSuccess"));
      } catch (e) {
        console.error(e);
        showToast(t("ugcSafety.reportFailed"));
      } finally {
        safetyBusy.value = false;
      }
    },
  });
}

function handleBlockAuthor() {
  closeSafetyMenu();
  if (!post.value || safetyBusy.value) return;
  if (isOwnPost.value) {
    showToast(t("ugcSafety.cannotBlockSelf"));
    return;
  }
  const uid = post.value.user_id;
  if (uid == null) return;
  if (isUserBlocked(uid)) {
    showToast(t("ugcSafety.blockSuccess"));
    uni.navigateBack({ fail: () => uni.reLaunch({ url: "/pages/discover/index" }) });
    return;
  }
  uni.showModal({
    title: t("ugcSafety.blockUser"),
    content: t("ugcSafety.blockConfirm"),
    confirmText: t("common.confirm"),
    cancelText: t("common.cancel"),
    success: (res) => {
      if (!res.confirm) return;
      blockUser(uid);
      showToast(t("ugcSafety.blockSuccess"));
      uni.navigateBack({ fail: () => uni.reLaunch({ url: "/pages/discover/index" }) });
    },
  });
}

const canSendComment = computed(
  () => Boolean(commentText.value.trim()) && !sending.value && Boolean(post.value)
);
const commentsCount = computed(
  () => post.value?.comments_count ?? post.value?.comments?.length ?? 0
);
const heroImages = computed(() =>
  (post.value?.images || []).map((img) => normalizeMediaUrl(img)).filter(Boolean)
);

onLoad((q) => {
  postId = String(q?.id || "");
  if (q?.focus === "1" || q?.focus === "true") {
    inputFocus.value = true;
  }
});

async function fetchPost({ silent = false } = {}) {
  if (!silent && !post.value) loading.value = true;
  try {
    post.value = await apiFetch(`/api/posts/${postId}`, { header: deviceHeaders() });
  } catch (e) {
    const err = e;
    if (err.status === 401) uni.navigateBack();
  } finally {
    loading.value = false;
  }
}

onMounted(fetchPost);

function onCommentInput(e) {
  commentText.value = e?.detail?.value ?? "";
}

function onCommentBlur() {
  inputFocus.value = false;
}

function categoryLabel(key) {
  if (!key) return "";
  const i18nKey = `discover.cat_${key}`;
  if (typeof te === "function" && !te(i18nKey)) {
    return String(key);
  }
  const label = t(i18nKey);
  return label === i18nKey ? String(key) : label;
}

function formatPublishDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${t("discover.publishedOn")} ${y}-${m}-${day}`;
}

function previewImage(currentIndex) {
  if (!post.value?.images?.length) return;
  previewMedia(post.value.images, currentIndex);
}

function isMe(c) {
  const uid = getCurrentUserId();
  return uid != null && String(c?.user_id) === String(uid);
}

function scrollBottom() {
  scrollIntoView.value = "";
  void nextTick(() => {
    scrollIntoView.value = "bottom-anchor";
  });
}

async function handleLike() {
  if (!post.value || post.value._liking) return;
  const prevLiked = !!post.value.liked;
  const prevCount = Number(post.value.likes_count || 0);
  post.value = {
    ...post.value,
    liked: !prevLiked,
    likes_count: Math.max(0, prevCount + (prevLiked ? -1 : 1)),
    _liking: true,
  };
  try {
    const data = await apiFetch(`/api/posts/${post.value.id}/like`, {
      method: "POST",
      header: deviceHeaders(),
    });
    if (post.value && (data?.ok || data?.liked != null)) {
      post.value = {
        ...post.value,
        liked: data.liked != null ? !!data.liked : !prevLiked,
        likes_count: data.likes_count ?? post.value.likes_count,
        _liking: false,
      };
    } else if (post.value) {
      post.value = { ...post.value, liked: prevLiked, likes_count: prevCount, _liking: false };
    }
  } catch (e) {
    console.error("点赞失败:", e);
    if (post.value) {
      post.value = { ...post.value, liked: prevLiked, likes_count: prevCount, _liking: false };
    }
  }
}

async function handleSendComment() {
  const content = commentText.value.trim();
  if (!content || !post.value || sending.value) return;
  sending.value = true;
  try {
    const data = await apiFetch(`/api/posts/${post.value.id}/comment`, {
      method: "POST",
      header: {
        ...deviceHeaders(),
        "Content-Type": "application/json",
      },
      data: { content },
    });

    commentText.value = "";
    commentInputKey.value += 1;
    inputFocus.value = false;

    if (data?.ok || data?.id != null) {
      const next = {
        id: data.id,
        user_id: getCurrentUserId(),
        user_name: data.user_name || t("common.me"),
        content: data.content || content,
        created_at: data.created_at || new Date().toISOString(),
        avatar: data.avatar,
      };
      const comments = [...(post.value.comments || []), next];
      post.value = {
        ...post.value,
        comments,
        comments_count: (post.value.comments_count || 0) + 1,
      };
      void nextTick(() => scrollBottom());
      void fetchPost({ silent: true });
    } else {
      await fetchPost({ silent: true });
    }
  } catch (e) {
    const err = e;
    if (err.status === 401) showToast(t("discover.loginExpired"));
    else console.error("评论失败:", e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <AppPageShell title-align="start" :show-back="true" header-right :pad-safe-bottom="false">
    <template #header-title>
      <view v-if="post" class="header-identity">
        <view class="header-identity-avatar">
          <AppAvatarImage
            :src="post.avatar"
            :seed="String(post.user_id || 'user')"
            size="sm"
          />
        </view>
        <text class="header-identity-name">{{ post.user_name }}</text>
      </view>
      <text v-else class="header-identity-name">{{ t("discover.postDetail") }}</text>
    </template>
    <template #header-right>
      <view
        v-if="post && !isOwnPost"
        class="safety-menu-btn"
        @tap="openSafetyMenu"
      >
        <text class="safety-menu-dots">···</text>
      </view>
    </template>

    <view v-if="showSafetyMenu" class="safety-mask" @tap="closeSafetyMenu" />
    <view v-if="showSafetyMenu" class="safety-sheet">
      <text class="safety-item" @tap="handleReportPost">{{ t("ugcSafety.report") }}</text>
      <text class="safety-item danger" @tap="handleBlockAuthor">{{ t("ugcSafety.blockUser") }}</text>
      <text class="safety-item cancel" @tap="closeSafetyMenu">{{ t("common.cancel") }}</text>
    </view>

    <view class="detail-wrap">
      <scroll-view scroll-y class="scroll-area" :scroll-into-view="scrollIntoView">
        <AppListSkeleton v-if="loading && !post" :rows="3" />
        <view v-else-if="!post" class="center text-muted">{{ t("discover.postNotFound") }}</view>
        <template v-else>
          <view v-if="heroImages.length" class="post-images">
            <view class="image-grid" :class="{ 'is-single': heroImages.length === 1 }">
              <view
                v-for="(src, idx) in heroImages"
                :key="`${src}-${idx}`"
                class="image-item"
                @tap="previewImage(idx)"
              >
                <image class="post-thumb" :src="src" mode="aspectFill" />
              </view>
            </view>
          </view>

          <view class="content">
            <text v-if="post.title" class="title-text">{{ post.title }}</text>
            <text v-if="post.category" class="post-cat-tag">{{ categoryLabel(post.category) }}</text>
            <text v-if="post.content" class="body-text">{{ post.content }}</text>
            <view class="meta-row">
              <text class="publish-date">{{ formatPublishDate(post.created_at) }}</text>
              <view class="action-btn" @tap="handleLike">
                <image
                  :src="post.liked ? '/static/vest/common/like-red.png' : likeIcon"
                  class="action-img"
                  mode="aspectFit"
                />
                <text class="action-count">{{ post.likes_count || 0 }}</text>
              </view>
            </view>
          </view>

          <view class="comments-section">
            <view class="comments-header">
              <text class="comments-label">{{ t("discover.comments") }}</text>
              <text class="comments-count">({{ commentsCount }})</text>
            </view>

            <view v-if="!(post.comments && post.comments.length)" class="empty-comments text-muted">
              {{ t("discover.noComments") }}
            </view>

            <view v-for="c in post.comments" :key="c.id" class="comment-card">
              <view class="comment-avatar">
                <AppAvatarImage
                  :src="c.avatar"
                  :seed="String(c.user_id || c.user_name || 'user')"
                  size="sm"
                />
              </view>
              <view class="comment-main">
                <text class="comment-name" :class="{ me: isMe(c) }">
                  {{ isMe(c) ? t("common.me") : c.user_name }}
                </text>
                <text class="comment-content">{{ c.content }}</text>
                <text class="comment-time">{{ formatTime(c.created_at) }}</text>
              </view>
            </view>
          </view>

          <view id="bottom-anchor" class="bottom-anchor" />
        </template>
      </scroll-view>

      <view class="composer-bar composer-bar--safe">
        <view class="composer-row">
          <input
            :key="`post-cmt-${commentInputKey}`"
            class="composer-field"
            :value="commentText"
            :placeholder="t('discover.commentPlaceholder')"
            :disabled="sending || !post"
            :focus="inputFocus"
            :adjust-position="false"
            maxlength="500"
            confirm-type="send"
            @input="onCommentInput"
            @confirm="handleSendComment"
            @blur="onCommentBlur"
          />
          <button
            class="composer-action composer-action--send"
            :class="{ busy: sending, dimmed: !canSendComment, active: canSendComment && !sending }"
            :disabled="!canSendComment"
            @tap="handleSendComment"
          >
            <text v-if="sending" class="send-spinner" />
            <image
              v-else
              class="composer-action-ico icon-brand"
              src="/static/discover/ico-Send.svg"
              mode="aspectFit"
            />
          </button>
        </view>
      </view>
    </view>
  </AppPageShell>
</template>

<style scoped lang="scss">
/* 顶栏身份 / Composer：见 static/styles/ui.scss */

.center {
  text-align: center;
  padding: 80rpx 0;
}

.safety-menu-btn {
  min-width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.safety-menu-dots {
  font-size: 36rpx;
  font-weight: 700;
  color: var(--fg, #fafafa);
  letter-spacing: 2rpx;
}
.safety-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.45);
}
.safety-sheet {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  bottom: calc(env(safe-area-inset-bottom) + 32rpx);
  z-index: 90;
  background: var(--surface-sheet, var(--modal-bg, #0a0a0a));
  border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.08));
  border-radius: 24rpx;
  overflow: hidden;
}
.safety-item {
  display: block;
  padding: 32rpx;
  text-align: center;
  font-size: 30rpx;
  color: var(--fg);
  border-bottom: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.08));
}
.safety-item.danger {
  color: var(--destructive, #ef4444);
}
.safety-item.cancel {
  border-bottom: none;
  color: var(--fg-muted);
}

.detail-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.scroll-area {
  flex: 1;
  min-height: 0;
}

.post-images {
  padding: var(--page-gutter, 32rpx) var(--page-gutter, 32rpx) 0;
  width: 100%;
  box-sizing: border-box;
}

.image-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
  width: 100%;
}

.image-item {
  position: relative;
  width: calc((100% - 32rpx) / 3);
  height: 0;
  padding-bottom: calc((100% - 32rpx) / 3);
  border-radius: 16rpx;
  overflow: hidden;
  background: var(--bg-input);
}

.image-grid.is-single .image-item {
  width: 100%;
  padding-bottom: 56%;
}

.post-thumb {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 16rpx;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: var(--page-gutter, 32rpx);
}

.title-text {
  display: block;
  font-size: 36rpx;
  font-weight: 500;
  line-height: 1.35;
  color: var(--fg);
  word-break: break-word;
  overflow-wrap: break-word;
}

.post-cat-tag {
  align-self: flex-start;
  font-size: var(--fs-meta, 22rpx);
  padding: 6rpx 16rpx;
  background: var(--bg-input);
  border: 1rpx solid var(--border);
  border-radius: 999px;
  color: var(--fg-muted);
  box-sizing: border-box;
}

.body-text {
  display: block;
  font-size: 32rpx;
  font-weight: 400;
  line-height: 1.5;
  color: var(--fg);
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.meta-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.publish-date {
  font-size: var(--fs-caption, 24rpx);
  color: var(--fg);
  opacity: 0.4;
}

.comments-section {
  padding: 0 var(--page-gutter, 32rpx) 24rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.comments-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  padding: 20rpx 0 4rpx;
}

.comments-label {
  font-size: 36rpx;
  font-weight: 500;
  color: var(--fg);
}

.comments-count {
  font-size: var(--fs-body, 28rpx);
  font-weight: 500;
  color: var(--fg);
  opacity: 0.4;
}

.empty-comments {
  text-align: center;
  padding: 48rpx 0;
  font-size: 26rpx;
}

.comment-card {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 16rpx;
  padding: 32rpx;
  border-radius: 32rpx;
  background: var(--bg-input);
}

.comment-avatar {
  width: 64rpx;
  height: 64rpx;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;

  :deep(.avatar-root) {
    width: 100%;
    height: 100%;
  }
}

.comment-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.comment-name {
  font-size: var(--fs-caption, 24rpx);
  font-weight: 400;
  color: var(--fg);
  opacity: 0.6;

  &.me {
    font-weight: 600;
    opacity: 0.8;
  }
}

.comment-content {
  font-size: var(--fs-body, 28rpx);
  font-weight: 500;
  color: var(--fg);
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: break-word;
}

.comment-time {
  font-size: 22rpx;
  color: var(--fg);
  opacity: 0.4;
}

.bottom-anchor {
  height: 1rpx;
}

.send-spinner {
  display: inline-block;
  width: 32rpx;
  height: 32rpx;
  border: 4rpx solid var(--border);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: send-spin 0.6s linear infinite;
}

@keyframes send-spin {
  to {
    transform: rotate(360deg);
  }
}

.flex-1 {
  flex: 1;
}
</style>
