<script setup>
/**
 * @file pages-sub/moment — 朋友圈动态详情
 * @description 单条 moment 详情、点赞、评论；带 x-device-id。
 * @depends apiFetch、deviceHeaders、useAuth
 */
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  nextTick
} from "vue";
import {
  onLoad,
  onHide
} from "@dcloudio/uni-app";
import {
  useI18n
} from "vue-i18n";
import {
  useThemeStore
} from "@/stores/theme";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppMomentImage from "@/components/AppMomentImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppReportCharacterPopup from "@/components/AppReportCharacterPopup.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import {
  requireAuth,
  getCurrentUserId
} from "@/composables/useAuth";
import {
  deviceHeaders
} from "@/utils/device";
import { previewMedia } from "@/utils/media";
import apiFetch from "@/utils/api";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import {
  useRelativeTime
} from "@/composables/useRelativeTime";
import {
  showToast
} from "@/stores/toast";
import {
  findAiRepliesToUser,
  recordLocalReplyNotif
} from "@/utils/notifications";
import {
  formatCompanionName
} from "@/utils/formatCompanion";
import {
  MOMENT_COMMENT_MAX_LENGTH
} from "@/utils/constants";
import { goMainTab } from "@/utils/navigation";
import {
  parseMomentCommentLimit,
  prepareCommentLimitChat,
} from "@/utils/momentCommentLimit";
import { fillI18n } from "@/utils/createCompanionForm";
import { likeIconSrc, moreIconSrc } from "@/utils/themeIcons";

let momentId = "";
const {
  t
} = useI18n();
const {
  format: formatTime
} = useRelativeTime("home");
const themeStore = useThemeStore();
const likeIcon = computed(() => likeIconSrc(themeStore.isDark));
const moreIcon = computed(() => moreIconSrc(themeStore.isDark));
const companionDisplayName = computed(() =>
  formatCompanionName(moment.value?.companion_name, t("home.defaultCompanionName"))
);
const canSendComment = computed(
  () => Boolean(commentText.value.trim()) && !sending.value && Boolean(moment.value)
);
requireAuth();

// ——— 状态 ———
const moment = ref(null);
const loading = ref(true);
const commentText = ref("");
const commentInputKey = ref(0);
const commentFocus = ref(false);
const sending = ref(false);
const replyTo = ref(null);
const scrollIntoView = ref("");
const showMenu = ref(false);
const reportOpen = ref(false);
const commentLimitOpen = ref(false);
const commentLimitCount = ref(1);
const commentLimitCompanionId = ref("");
const commentLimitMomentId = ref("");
const commentLimitDraft = ref("");

function openCommentLimitDialog(data, err, extra = {}) {
  const meta = parseMomentCommentLimit(data, err);
  if (!meta) return false;
  commentLimitCount.value = meta.count;
  commentLimitCompanionId.value =
    meta.companionId || String(moment.value?.companion_id || "");
  commentLimitMomentId.value = String(
    meta.momentId || extra.momentId || moment.value?.id || ""
  );
  commentLimitDraft.value = String(extra.draft || "");
  commentLimitOpen.value = true;
  return true;
}

function goCommentLimitChat() {
  void prepareCommentLimitChat({
    companionId: commentLimitCompanionId.value,
    momentId: commentLimitMomentId.value,
    draft: commentLimitDraft.value,
  });
}

/** App 端 vue-i18n 不替换 {count}，再用 fillI18n 写入次数 */
const commentLimitDesc = computed(() =>
  fillI18n(t("home.commentLimitDesc", { count: commentLimitCount.value }), {
    count: commentLimitCount.value,
  })
);

onLoad((q) => {
  momentId = String(q?.id || "");
});

// 滚动到底部锚点
function scrollBottom() {
  scrollIntoView.value = "";
  void nextTick(() => {
    scrollIntoView.value = "bottom-anchor";
  });
}

// 记录 AI 回复通知
function captureReplyNotifs(prevReplyIds = new Set()) {
  const m = moment.value;
  if (!m) return;
  for (const c of findAiRepliesToUser(m.comments)) {
    if (prevReplyIds.has(String(c.id))) continue;
    recordLocalReplyNotif({
      replyId: c.id,
      momentId: m.id,
      title: c.companion_name || m.companion_name || t("home.defaultCompanionName"),
      content: c.content || "",
      avatar: m.companion_avatar || "",
      imageUrl: m.image_url || "",
      time: c.created_at,
      companionId: c.companion_id || m.companion_id,
    });
  }
}

// ——— 加载详情 ———
async function fetchMoment() {
  if (!moment.value) loading.value = true;
  try {
    moment.value = await apiFetch(`/api/moments/${momentId}`, {
      header: deviceHeaders()
    });
    if (moment.value) {
      moment.value = {
        ...moment.value,
        liked: coerceMomentLiked(moment.value),
      };
    }
  } finally {
    loading.value = false;
  }
}

onMounted(fetchMoment);

function emitMomentStats() {
  const m = moment.value;
  if (!m?.id) return;
  uni.$emit("moment-stats-updated", {
    id: m.id,
    liked: !!m.liked,
    likes_count: Number(m.likes_count || 0),
    comments_count: Number(m.comments_count ?? m.comments?.length ?? 0),
  });
}

onHide(emitMomentStats);
onUnmounted(emitMomentStats);

function coerceMomentLiked(m) {
  if (Number(m?.likes_count || 0) <= 0) return false;
  const v = m?.liked ?? m?.is_liked;
  return v === true || v === 1 || v === "1" || v === "true";
}

// ——— 点赞评论 ———
let likeLock = false;

async function handleLike() {
  if (!moment.value || likeLock) return;
  likeLock = true;
  const prevLiked = coerceMomentLiked(moment.value);
  const prevCount = Number(moment.value.likes_count || 0);
  const nextLiked = !prevLiked;
  const nextCount = Math.max(0, prevCount + (prevLiked ? -1 : 1));
  moment.value = {
    ...moment.value,
    liked: nextLiked,
    likes_count: nextCount,
  };
  emitMomentStats();
  try {
    const data = await apiFetch(
      `/api/moments/${moment.value.id}/like`,
      {
        method: "POST",
        header: deviceHeaders(),
      }
    );
    if (moment.value && (data?.ok || data?.liked != null)) {
      moment.value = {
        ...moment.value,
        liked: data.liked != null ? !!data.liked : nextLiked,
        likes_count: data.likes_count ?? nextCount,
      };
      emitMomentStats();
    } else if (moment.value) {
      moment.value = { ...moment.value, liked: prevLiked, likes_count: prevCount };
      emitMomentStats();
    }
  } catch (e) {
    console.error("点赞失败:", e);
    if (moment.value) {
      moment.value = { ...moment.value, liked: prevLiked, likes_count: prevCount };
      emitMomentStats();
    }
  } finally {
    setTimeout(() => {
      likeLock = false;
    }, 320);
  }
}

function onCommentInput(e) {
  commentText.value = e?.detail?.value ?? "";
}

function focusCommentInput() {
  commentFocus.value = false;
  void nextTick(() => {
    commentFocus.value = true;
  });
}

function onCommentBlur() {
  commentFocus.value = false;
}

// 点击大图预览（系统全屏，无页面头栏）
function openPreview(url) {
  if (!url) return;
  previewMedia(url);
}

// 长文本插入零宽空格，防止 iOS 长符号串撑破布局
function breakableText(text, max = 48) {
  if (!text) return "";
  return String(text).replace(new RegExp(`[^\\s]{${max}}`, "g"), (m) => m + "\u200B");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** AI 后台生成完成后刷新详情评论 */
async function pollAiReply(afterCount) {
  const prevReplyIds = new Set(
    findAiRepliesToUser(moment.value?.comments).map((c) => String(c.id))
  );
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    try {
      await fetchMoment();
      const count = moment.value?.comments?.length || 0;
      if (count > afterCount) {
        captureReplyNotifs(prevReplyIds);
        void nextTick(() => {
          scrollBottom();
        });
        return;
      }
    } catch (e) {
      console.warn("轮询 AI 回复失败:", e);
    }
  }
}

// ——— 发送评论 ———
async function handleSendComment(e) {
  const fromEvent = typeof e?.detail?.value === "string" ? e.detail.value : null;
  const content = (fromEvent ?? commentText.value).trim();
  if (!content || !moment.value || sending.value) return;
  sending.value = true;

  const curReplyTo = replyTo.value;
  const tempId = `temp-${Date.now()}`;
  const optimistic = {
    id: tempId,
    content,
    companion_name: t("common.me"),
    created_at: new Date().toISOString(),
    is_me: true,
    _optimistic: true,
  };
  if (curReplyTo) {
    optimistic.parent_id = curReplyTo.id;
    optimistic.reply_to_name = isMe(curReplyTo) ?
      t("common.me") :
      (curReplyTo.companion_name || t("home.defaultCompanionName"));
  }

  // 乐观插入，同时清空输入框
  const comments = moment.value.comments || [];
  moment.value.comments = [...comments, optimistic];
  moment.value.comments_count = (moment.value.comments_count || 0) + 1;

  commentText.value = "";
  commentInputKey.value += 1;
  commentFocus.value = false;
  replyTo.value = null;

  void nextTick(() => {
    scrollBottom();
  });

  // 保存当前回复信息，失败时需要恢复
  const savedReplyTo = curReplyTo;

  const prevCount = comments.length;
  try {
    const body = {
      content
    };
    if (curReplyTo) body.parent_id = curReplyTo.id;
    const req = {
      url: `/api/moments/${moment.value.id}/comment`,
      method: "POST",
      data: body,
      header: {
        ...deviceHeaders(),
        "Content-Type": "application/json",
      },
    };
    console.log("[moments/comment] 请求", {
      ...req,
      contentLength: content.length,
    });
    const data = await apiFetch(req.url, {
      method: req.method,
      header: req.header,
      data: req.data,
      timeout: 20000,
    });
    if (openCommentLimitDialog(data, null, { momentId: moment.value?.id, draft: content })) {
      moment.value.comments = moment.value.comments.filter((c) => c.id !== tempId);
      moment.value.comments_count = Math.max(0, (moment.value.comments_count || 0) - 1);
      commentText.value = content;
      replyTo.value = savedReplyTo;
      return;
    }
    if (data?.ok === false || data?.error || Number(data?.code) === 400) {
      moment.value.comments = moment.value.comments.filter((c) => c.id !== tempId);
      moment.value.comments_count = Math.max(0, (moment.value.comments_count || 0) - 1);
      commentText.value = content;
      replyTo.value = savedReplyTo;
      showToast(
        String(
          data?.error ||
            data?.detail ||
            data?.message ||
            t("common.sendFailed")
        )
      );
      return;
    }
    await fetchMoment();
    void nextTick(() => {
      scrollBottom();
    });
    if (data?.ai_reply) {
      captureReplyNotifs(new Set());
    } else {
      void pollAiReply(prevCount + 1);
    }
  } catch (err) {
    moment.value.comments = moment.value.comments.filter((c) => c.id !== tempId);
    moment.value.comments_count = Math.max(0, (moment.value.comments_count || 0) - 1);
    commentText.value = content;
    replyTo.value = savedReplyTo;
    if (openCommentLimitDialog(null, err, { momentId: moment.value?.id, draft: content })) {
      return;
    }
    console.error("评论失败:", err);
    // 展示接口原文，如 { error: "评论内容无效，请修改后重试", status_code: 400 }
    const msg = String(
      (typeof err?.detail === "string" && err.detail) ||
        (typeof err?.message === "string" && err.message) ||
        t("common.sendFailed")
    );
    // apiFetch 对带 status 的业务/HTTP 错误已 toast，避免重复盖掉接口文案
    if (typeof err?.status !== "number") {
      showToast(msg);
    }
    if (/timeout|超时|timed?\s*out/i.test(msg)) {
      void pollAiReply(prevCount);
    }
  } finally {
    sending.value = false;
  }
}

// 判断评论是否当前用户自己
function isMe(comment) {
  if (!comment) return false;
  // 优先用接口返回的 is_me 字段
  if (comment.is_me === true) return true;
  // 兼容未返回 is_me 的情况，回退 user_id 比对
  const uid = getCurrentUserId();
  const userId = comment.user_id;
  return userId != null && uid != null && String(userId) === String(uid);
}

function setReplyTo(comment) {
  replyTo.value = comment;
  focusCommentInput();
}

// ——— 评论长按回复交互 ———
let longPressTimer = null;
let touchStartY = 0;

function onCommentTouchStart(comment, e) {
  const y = e?.touches?.[0]?.clientY ?? e?.changedTouches?.[0]?.clientY ?? 0;
  touchStartY = y;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    setReplyTo(comment);
  }, 600);
}

function onCommentTouchMove(e) {
  if (!longPressTimer) return;
  const y = e?.touches?.[0]?.clientY ?? e?.changedTouches?.[0]?.clientY ?? 0;
  if (Math.abs(y - touchStartY) > 10) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onCommentTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// App 端 vue-i18n 不编译 {name} 占位符，手动替换兜底
const replyToName = computed(() => {
  if (!replyTo.value) return "";
  return isMe(replyTo.value) ?
    t("common.me") :
    formatCompanionName(replyTo.value.companion_name, t("home.defaultCompanionName"));
});
const replyToLabel = computed(() =>
  replyTo.value ? t("home.replyTo", {
    name: replyToName.value
  }).replace(/{name}/g, replyToName.value) : ""
);
const replyPlaceholderText = computed(() =>
  replyTo.value ? t("home.replyPlaceholder", {
    name: replyToName.value
  }).replace(/{name}/g, replyToName.value) : ""
);
const commentsCount = computed(() => Number(moment.value?.comments_count || 0));

function formatPublishDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${t("discover.publishedOn")} ${y}-${m}-${day}`;
}

/** 顶栏头像/名称 → 伴侣资料页；若上一页已是该资料则返回，避免再叠一层 */
function goCompanionProfile() {
  const id = moment.value?.companion_id;
  if (!id) return;
  trackProductEvent(
    PRODUCT_EVENTS.AVATAR_PROFILE_CLICK,
    withCompanionId(
      {
        page: "moment",
        target_id: String(moment.value?.id || ""),
      },
      id
    )
  );
  const pages = getCurrentPages();
  const prev = pages.length > 1 ? pages[pages.length - 2] : null;
  const route = String(prev?.route || "");
  const fullPath = String(prev?.$page?.fullPath || prev?.$page?.path || "");
  const prevQuery = {
    ...(prev?.options || {}),
    ...(prev?.$page?.options || {}),
  };
  let prevId = String(prevQuery.id || "");
  if (!prevId) {
    const m = fullPath.match(/[?&]id=([^&]+)/);
    if (m) prevId = decodeURIComponent(m[1]);
  }
  const fromCompanion =
    route.includes("companion/index") || fullPath.includes("companion/index");
  if (fromCompanion && (!prevId || prevId === String(id))) {
    uni.navigateBack();
    return;
  }
  uni.navigateTo({
    url: `/pages-sub/companion/index?id=${id}`,
  });
}

/** 详情页：不感兴趣 / 屏蔽后返回上一页 */
async function setOutreachPreference(action) {
  showMenu.value = false;
  const companionId = moment.value?.companion_id;
  if (!companionId) return;
  const run = async () => {
    try {
      await apiFetch(`/companions/${companionId}/outreach-preference`, {
        method: "POST",
        data: { action },
      });
      showToast(
        action === "block"
          ? t("companionProfile.outreachBlocked")
          : t("companionProfile.outreachDisliked")
      );
      uni.navigateBack({ fail: () => goMainTab("/pages/home/index") });
    } catch {
      showToast(t("companionProfile.outreachFailed"));
    }
  };
  if (action === "block") {
    uni.showModal({
      title: t("companionProfile.blockOutreach"),
      content: t("companionProfile.blockOutreachConfirm"),
      confirmText: t("common.confirm"),
      cancelText: t("common.cancel"),
      success: (res) => {
        if (res.confirm) void run();
      },
    });
    return;
  }
  await run();
}

function openReportCharacter() {
  showMenu.value = false;
  if (!moment.value?.companion_id) return;
  reportOpen.value = true;
}
</script>

<template>
  <AppPageShell title-align="start" :show-back="true" header-right fill-webview :pad-safe-bottom="false">
    <template #header-title>
      <view
        v-if="moment"
        class="header-identity"
      >
        <view class="header-identity-avatar" @tap.stop="goCompanionProfile">
          <AppAvatarImage
            :src="moment.companion_avatar"
            :seed="moment.companion_id"
            size="sm"
          />
        </view>
        <text class="header-identity-name" @tap.stop="goCompanionProfile">{{ companionDisplayName }}</text>
      </view>
      <text v-else class="header-identity-name">{{ t("home.momentDetail") }}</text>
    </template>
    <template #header-right>
      <view v-if="moment" class="menu-btn" @tap="showMenu = !showMenu">
        <image :src="moreIcon" class="menu-more-icon" mode="aspectFit" />
      </view>
    </template>

    <view class="detail-wrap">
      <scroll-view scroll-y class="scroll-area" :scroll-into-view="scrollIntoView">
        <AppListSkeleton v-if="loading && !moment" :rows="3" />
        <view v-else-if="!moment" class="center text-muted">{{ t("home.momentNotFound") }}</view>
        <template v-else>
          <!-- 全宽主图 -->
          <view v-if="moment.image_generating || moment.image_url" class="hero">
            <view v-if="moment.image_generating" class="generating">{{ t("home.imageGenerating") }}</view>
            <AppMomentImage
              v-else
              :src="moment.image_url"
              :prefer-thumb="false"
              mode="aspectFill"
              img-class="hero-img"
              @click="openPreview(moment.image_url)"
            />
          </view>

          <!-- 正文：caption 作 body；无独立标题/分类 -->
          <view class="content">
            <text v-if="moment.caption" class="body-text">{{ moment.caption }}</text>
            <view class="meta-row">
              <text class="publish-date">{{ formatPublishDate(moment.created_at) }}</text>
              <view class="action-btn" @tap.stop="handleLike">
                <view class="like-icon-wrap">
                  <image
                    class="action-img"
                    :class="{ 'is-hidden': !!moment.liked }"
                    :src="likeIcon"
                    mode="aspectFit"
                  />
                  <image
                    class="action-img"
                    :class="{ 'is-hidden': !moment.liked }"
                    src="/static/vest/common/like-red.png"
                    mode="aspectFit"
                  />
                </view>
                <text class="action-count">{{ moment.likes_count || 0 }}</text>
              </view>
            </view>
          </view>

          <!-- 评论 -->
          <view class="comments-section">
            <view class="comments-header">
              <text class="comments-label">{{ t("home.comments") }}</text>
              <text class="comments-count">({{ commentsCount }})</text>
            </view>

            <view
              v-for="c in moment.comments"
              :key="c.id"
              class="comment-card"
              @touchstart="onCommentTouchStart(c, $event)"
              @touchmove="onCommentTouchMove($event)"
              @touchend="onCommentTouchEnd"
              @touchcancel="onCommentTouchEnd"
            >
              <view class="comment-avatar">
                <AppAvatarImage :src="c.avatar_url" :seed="c.id" size="sm" />
              </view>
              <view class="comment-main">
                <text class="comment-name" :class="{ me: isMe(c) }">{{
                  isMe(c)
                    ? t("common.me")
                    : formatCompanionName(c.companion_name, t("home.defaultCompanionName"))
                }}</text>
                <view class="comment-content">
                  <text
                    v-if="c.reply_to_name"
                    :class="c.is_reply_me ? 'reply-to-me' : 'reply-to'"
                  >@{{ c.reply_to_name }}
                  </text>
                  <text>{{ breakableText(c.content) }}</text>
                </view>
                <text class="comment-time">{{ formatTime(c.created_at) }}</text>
              </view>
            </view>
          </view>

          <view id="bottom-anchor" class="bottom-anchor"></view>
        </template>
      </scroll-view>

      <view class="composer-bar composer-bar--safe">
        <view v-if="replyTo" class="reply-hint flex-row justify-between">
          <text class="text-muted">{{ replyToLabel }}</text>
          <text @tap="replyTo = null">{{ t("common.cancel") }}</text>
        </view>
        <view class="composer-row">
          <input
            :key="`moment-cmt-${commentInputKey}`"
            :value="commentText"
            class="composer-field"
            :placeholder="replyTo ? replyPlaceholderText : t('home.writeComment')"
            :maxlength="MOMENT_COMMENT_MAX_LENGTH"
            confirm-type="send"
            :focus="commentFocus"
            :adjust-position="false"
            :disabled="sending"
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
            <text v-if="sending" class="send-spinner"></text>
            <image
              v-else
              src="/static/discover/ico-Send.svg"
              class="composer-action-ico icon-brand"
              mode="aspectFit"
            />
          </button>
        </view>
      </view>
    </view>

    <view v-if="showMenu && moment" class="menu-mask" @tap="showMenu = false">
      <view class="menu-popup" @tap.stop>
        <view class="menu-item" @tap="openReportCharacter">{{ t("characterReport.menuItem") }}</view>
        <view class="menu-item" @tap="setOutreachPreference('dislike')">{{ t("moment.notInterested") }}</view>
        <view class="menu-item danger" @tap="setOutreachPreference('block')">{{ t("moment.block") }}</view>
      </view>
    </view>
    <AppReportCharacterPopup
      v-model:open="reportOpen"
      :character-id="moment?.companion_id"
      source="moments"
    />
    <AppConfirmDialog
      v-model:open="commentLimitOpen"
      centered
      :title="t('home.commentLimitTitle')"
      :description="commentLimitDesc"
      :confirm-text="t('home.commentLimitGoChat')"
      :cancel-text="t('common.cancel')"
      @confirm="goCommentLimitChat"
    />
  </AppPageShell>
</template>

<style scoped lang="scss">
/* 顶栏身份：见全局 .header-identity* */

.center {
  text-align: center;
  padding: 80rpx 0;
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

.hero {
  position: relative;
  width: 100%;
  height: 880rpx; /* 440 */
  background: var(--bg-input);
  overflow: hidden;
}

.generating {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  font-size: var(--fs-body, 28rpx);
}

:deep(.hero-img),
.hero :deep(.moment-image-base) {
  width: 100%;
  height: 880rpx;
  border-radius: 0;
  display: block;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 24rpx; /* 12 */
  padding: var(--page-gutter, 32rpx);
}

.body-text {
  display: block;
  font-size: 32rpx; /* 16 */
  font-weight: 400;
  line-height: 1.5;
  color: var(--fg);
  word-break: break-word;
  overflow-wrap: break-word;
}

.meta-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.publish-date {
  font-size: var(--fs-caption, 24rpx); /* 12 */
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
  font-size: 36rpx; /* 18 */
  font-weight: 500;
  color: var(--fg);
}

.comments-count {
  font-size: var(--fs-body, 28rpx); /* 14 */
  font-weight: 500;
  color: var(--fg);
  opacity: 0.4;
}

.comment-card {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 16rpx; /* 8 */
  padding: 32rpx; /* 16 */
  border-radius: 32rpx; /* 16 */
  background: var(--bg-input);
}

.comment-avatar {
  width: 64rpx; /* 32 */
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
  gap: 12rpx; /* 6 */
}

.comment-name {
  font-size: var(--fs-caption, 24rpx); /* 12 */
  font-weight: 400;
  color: var(--fg);
  opacity: 0.6;

  &.me {
    font-weight: 600;
    opacity: 0.8;
  }
}

.comment-content {
  font-size: var(--fs-body, 28rpx); /* 14 */
  font-weight: 500;
  color: var(--fg);
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: break-word;
}

.comment-time {
  font-size: 22rpx; /* 11 */
  color: var(--fg);
  opacity: 0.4;
}

.reply-to,
.reply-to-me {
  color: #3291f6;
  font-weight: 500;
  margin-right: 4rpx;
}

.reply-to-me {
  font-weight: 700;
}

.bottom-anchor {
  height: 1rpx;
}

.reply-hint {
  padding: 0 0 12rpx;
}

/* Composer / 顶栏身份：见 static/styles/ui.scss */

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

.menu-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-more-icon {
  width: 40rpx;
  height: 40rpx;
  opacity: 0.85;
}

.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.menu-popup {
  position: absolute;
  right: 24rpx;
  top: calc(env(safe-area-inset-top) + 100rpx);
  background: var(--modal-bg, #1c1c1e);
  border-radius: 16rpx;
  min-width: 260rpx;
  overflow: hidden;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.4);
}

.menu-item {
  padding: 28rpx 32rpx;
  font-size: 28rpx;
  color: var(--fg);

  &.danger {
    color: var(--destructive, #ef4444);
  }
}
</style>