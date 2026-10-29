<script setup>
	/**
	 * @file AppMomentCard.vue
	 * @description 朋友圈动态卡片（首页与伴侣资料页共用）。
	 * - variant="full"：首页完整形态（头像/姓名/send、点赞评论、评论列表与输入框）
	 * - variant="compact"：资料页精简形态（文案 + 图片 + 时间与点赞评论计数），点卡片进详情
	 * 状态（评论草稿、发送中等）由父页面管理，本组件只负责展示与抛事件。
	 */
	import {
		computed,
		ref
	} from "vue";
	import {
		useI18n
	} from "vue-i18n";
	import AppAvatarImage from "@/components/AppAvatarImage.vue";
	import AppMomentImage from "@/components/AppMomentImage.vue";
	import SvgIcon from "@/components/SvgIcon.vue";
	import { likeIconSrc, commentIconSrc, moreIconSrc } from "@/utils/themeIcons";
	import {
		useRelativeTime
	} from "@/composables/useRelativeTime";
	import {
		formatCompanionName
	} from "@/utils/formatCompanion";
	import {
		useThemeStore
	} from "@/stores/theme";
import { MOMENT_COMMENT_MAX_LENGTH } from "@/utils/constants";

function breakableText(text, max = 48) {
	if (!text) return "";
	return String(text).replace(new RegExp(`[^\\s]{${max}}`, "g"), (m) => m + "\u200B");
}

	const props = defineProps({
		/** 动态数据对象 */
		moment: {
			type: Object,
			required: true
		},
		/** 卡片形态：full（首页）| compact（资料页） */
		variant: {
			type: String,
			default: "full"
		},
		/** 发布者头像 / 姓名 / 性别（full 形态使用，父页面计算好传入） */
		avatar: {
			type: String,
			default: ""
		},
		name: {
			type: String,
			default: ""
		},
		gender: {
			type: String,
			default: ""
		},
		/** send 按钮请求破冰中 */
		sending: {
			type: Boolean,
			default: false
		},
		/** 图片重新生成中 */
		regenerating: {
			type: Boolean,
			default: false
		},
		/** 评论输入框状态（full 形态使用） */
		commentDraft: {
			type: String,
			default: ""
		},
		commentBusy: {
			type: Boolean,
			default: false
		},
		commentInputKey: {
			type: [String, Number],
			default: 0
		},
		commentFocused: {
			type: Boolean,
			default: false
		},
		/** 判断评论是否本人发出 */
		isCommentMine: {
			type: Function,
			default: () => false
		},
	});

	const emit = defineEmits([
		"avatar-tap",
		"send",
		"image-click",
		"image-error",
		"like",
		"comment-tap",
		"detail-tap",
		"comment-input",
		"comment-confirm",
		"comment-blur",
		"comment-focus",
		"comment-send",
		"dislike",
		"block",
		"report",
	]);

	const {
		t
	} = useI18n();
	const {
		format: formatRelativeTime
	} = useRelativeTime("home");
	const themeStore = useThemeStore();
	const likeIcon = computed(() => likeIconSrc(themeStore.isDark));
	const commentIcon = computed(() => commentIconSrc(themeStore.isDark));
	const moreIcon = computed(() => moreIconSrc(themeStore.isDark));
	const isLiked = computed(() => {
		const m = props.moment || {};
		if (Number(m.likes_count || 0) <= 0) return false;
		const v = m.liked ?? m.is_liked;
		return v === true || v === 1 || v === "1" || v === "true";
	});

	const showOverflow = ref(false);

	const isFull = () => props.variant === "full";

	function onCardTap() {
		// compact 形态整卡进详情；full 形态各区域有独立点击
		if (!isFull()) emit("detail-tap");
	}

	function onCaptionTap(e) {
		e?.stopPropagation?.();
		emit("detail-tap");
	}

	function toggleOverflow(e) {
		e?.stopPropagation?.();
		showOverflow.value = !showOverflow.value;
	}

	function emitOutreach(action) {
		showOverflow.value = false;
		const companionId = props.moment?.companion_id;
		if (!companionId) return;
		emit(action, companionId);
	}

	function emitReport() {
		showOverflow.value = false;
		const companionId = props.moment?.companion_id;
		if (!companionId) return;
		emit("report", companionId, props.moment?.id);
	}

const MAX_PREVIEW_COMMENTS = 10;

const previewComments = computed(() =>
	(props.moment.comments || []).slice(0, MAX_PREVIEW_COMMENTS)
);

const hasMoreComments = computed(() =>
	(props.moment.comments_count || 0) > previewComments.value.length ||
	(props.moment.comments || []).length > MAX_PREVIEW_COMMENTS
);

const viewAllHint = computed(() => {
	const count = props.moment.comments_count || 0;
	return t("home.viewAllComments", { count }).replace(/{count}/g, String(count));
});
</script>

<template>
	<view class="moment-card" @tap="onCardTap">
		<!-- 发布者信息（仅 full） -->
		<view v-if="variant === 'full'" class="flex-row items-center moment-head">
			<view class="avatar-wrap" @tap="emit('avatar-tap')">
				<AppAvatarImage :src="avatar" :seed="moment.companion_id" size="md" />
			</view>
			<view class="flex-1">
				<view class="flex-row items-center name-row">
					<text class="moment-name">{{ name }}</text>
					<image v-if="gender === '男'" src="/static/home/icon-male.svg" class="gender-icon"
						mode="aspectFit" />
					<image v-if="gender === '女'" src="/static/home/icon-female.svg" class="gender-icon"
						mode="aspectFit" />
				</view>
				<text class="text-muted moment-time">{{ formatRelativeTime(moment.created_at) }}</text>
			</view>
			<view class="moment-share" @tap="emit('send')">
				<view v-if="sending" class="moment-send-spinner" />
				<SvgIcon v-else class="icon-brand" name="icon-send" size="56rpx" />
			</view>
		</view>

		<!-- 文案 -->
		<text class="moment-caption" @tap.stop="onCaptionTap">{{ moment.caption }}</text>

		<!-- 图片：生成中 → 占位，否则展示（compact 无图不占位） -->
		<view v-if="moment.image_generating" class="moment-generating">
			<text class="text-muted">{{ t("common.loading") }}</text>
		</view>
		<view v-else-if="variant === 'full' || moment.image_url" class="moment-img-wrap">
			<AppMomentImage :src="moment.image_url" mode="aspectFill" img-class="moment-img"
				@click="emit('image-click')" @error="emit('image-error')" />
			<view v-if="regenerating" class="img-regenerating-mask">
				<view class="img-regenerating-spinner" />
				<text class="img-regenerating-text">{{ t("common.loading") }}</text>
			</view>
		</view>

		<!-- compact：时间 + 点赞/评论计数 -->
		<view v-if="variant === 'compact'" class="compact-footer flex-row items-center">
			<text class="text-muted compact-time">{{ formatRelativeTime(moment.created_at) }}</text>
			<view class="compact-actions flex-row items-center">
				<view class="action-btn flex-row items-center">
					<image :src="isLiked ? '/static/vest/common/like-red.png' : likeIcon"
						class="action-img" mode="aspectFit" />
					<text class="action-count" :class="{ 'is-liked': isLiked }">{{ moment.likes_count || 0 }}</text>
				</view>
				<view class="action-btn flex-row items-center">
					<image :src="commentIcon" class="action-img" mode="aspectFit" />
					<text class="action-count">{{ moment.comments_count || 0 }}</text>
				</view>
			</view>
		</view>

		<!-- full：点赞 / 评论 / 溢出菜单 -->
		<template v-else>
			<view class="moment-actions flex-row justify-end items-center">
				<view class="action-btn flex-row items-center" @tap="emit('like')">
					<image :src="isLiked ? '/static/vest/common/like-red.png' : likeIcon"
						class="action-img" mode="aspectFit" />
					<text class="action-count" :class="{ 'is-liked': isLiked }">{{ moment.likes_count }}</text>
				</view>
				<view class="action-btn flex-row items-center" @tap="emit('comment-tap')">
					<image :src="commentIcon" class="action-img" mode="aspectFit" />
					<text class="action-count">{{ moment.comments_count }}</text>
				</view>
				<view class="overflow-wrap" :class="{ open: showOverflow }">
					<view class="overflow-btn" @tap.stop="toggleOverflow">
						<image :src="moreIcon" class="overflow-icon" mode="aspectFit" />
					</view>
					<view v-if="showOverflow" class="overflow-menu" @tap.stop>
						<view class="overflow-item" @tap.stop="emitReport">
							{{ t("characterReport.menuItem") }}
						</view>
						<view class="overflow-item" @tap.stop="emitOutreach('dislike')">
							{{ t("moment.notInterested") }}
						</view>
						<view class="overflow-item danger" @tap.stop="emitOutreach('block')">
							{{ t("moment.block") }}
						</view>
					</view>
				</view>
			</view>
			<view v-if="showOverflow" class="overflow-mask" @tap.stop="showOverflow = false" />

			<!-- 评论列表：仅展示，不进详情（详情只从文案 / 评论图标进入） -->
			<view v-if="previewComments.length" class="comments-box">
				<view v-for="comment in previewComments" :key="comment.id" class="comment-line">
					<text class="comment-name" :class="{ mine: isCommentMine(comment) }">
						{{
              isCommentMine(comment)
                ? t("common.me")
                : (comment.companion_name || formatCompanionName(comment.companion_name, t("home.defaultCompanionName")))
            }}
					</text>
					<view class="comment-content" :class="{ pending: comment.pending }">
						<text v-if="!isCommentMine(comment) && (comment.is_reply_me || comment.reply_to_name)"
							:class="[comment.is_reply_me ? 'reply-to-me' : 'reply-to']" style="color: #3291f6;">
							@{{ comment.is_reply_me ? t("common.me") : comment.reply_to_name }}
						</text>
						{{ breakableText(comment.content) }}
					</view>
				</view>
				<text v-if="hasMoreComments" class="view-all-hint"
					@tap.stop="emit('detail-tap')">
					{{ viewAllHint }}
				</text>
			</view>

			<!-- 评论输入（uni-input 清空 :value 不刷新 DOM，靠 :key remount） -->
			<view class="comment-input-row flex-row items-center">
				<input :key="`cmt-${moment.id}-${commentInputKey}`" :value="commentDraft" class="comment-input" :maxlength="MOMENT_COMMENT_MAX_LENGTH"
					:focus="commentFocused" :adjust-position="false" :cursor-spacing="0" :disabled="commentBusy" :placeholder="t('home.writeComment')"
					confirm-type="send" @touchstart="emit('comment-focus')" @input="emit('comment-input', $event)"
					@focus="emit('comment-focus')"
					@confirm="emit('comment-confirm', $event)" @blur="emit('comment-blur')" />
				<view v-if="(commentDraft || '').trim() || commentBusy" class="send-btn" :class="{ busy: commentBusy }"
					@tap="emit('comment-send')">
					<text v-if="commentBusy" class="send-spinner"></text>
					<image v-else src="/static/home/icon-send.svg" class="comment-send-img icon-brand" mode="aspectFit" />
				</view>
			</view>
		</template>
	</view>
</template>

<style scoped lang="scss">
	.moment-card {
		background: var(--card-bg, rgba(255, 255, 255, 0.05));
		border-radius: 32rpx; /* 16 */
		padding: 32rpx; /* 16 */
	}

	.moment-head {
		position: relative;
		margin-bottom: 24rpx; /* 与稿 gap≈12 贴近 */
		padding-right: 104rpx; /* 给 send 区 52 留位 */
	}

	.moment-share {
		position: absolute;
		right: -8rpx; /* 视觉贴齐卡片右缘，略向右收 */
		top: 50%;
		transform: translateY(-50%);
		width: 104rpx; /* 52 */
		height: 80rpx;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.moment-send-spinner {
		width: 36rpx; /* ~18，小于小飞机 28 */
		height: 36rpx;
		border: 3rpx solid rgba(255, 255, 255, 0.15);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: moment-spin 0.8s linear infinite;
		box-sizing: border-box;
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: 8rpx;
	}

	.moment-name {
		font-size: 28rpx; /* 14 */
		font-weight: 500;
		color: var(--fg);
		margin-right: 0;
		max-width: 400rpx;
	}

	.gender-icon {
		width: 26rpx; /* 13 */
		height: 26rpx;
		flex-shrink: 0;
	}

	.avatar-wrap {
		margin-right: 20rpx; /* 10 */
	}

	/* 稿面帖卡头像 42 */
	.avatar-wrap :deep(.avatar-root),
	.avatar-wrap :deep(.size-md) {
		width: 84rpx !important;
		height: 84rpx !important;
	}

	.moment-time {
		font-size: 22rpx; /* 11 */
		opacity: 0.6;
		margin-top: 8rpx;
	}

	.moment-caption {
		display: block;
		font-size: 32rpx; /* 16 */
		line-height: 1.35;
		font-weight: 400;
		color: var(--fg);
		margin: 0 0 24rpx;
	}

	.moment-generating {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 360rpx;
		background: var(--bg-input);
		border-radius: 16rpx; /* 8 */
		margin-bottom: 24rpx;
	}

	:deep(.moment-img) {
		display: block;
		width: 100%;
		/* aspectFill 必须有明确高度，否则 H5/uni-image 高度塌为 0 */
		height: 480rpx;
		max-height: 720rpx;
		border-radius: 16rpx; /* 8 */
		margin-bottom: 24rpx;
		overflow: hidden;
		background: var(--bg-input);
	}

	.moment-img-wrap {
		position: relative;
		width: 100%;
		overflow: hidden;
		border-radius: 16rpx;
	}

	.img-regenerating-mask {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 24rpx;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.45);
		border-radius: 16rpx;
	}

	.img-regenerating-spinner {
		width: 48rpx;
		height: 48rpx;
		border: 4rpx solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: moment-spin 0.8s linear infinite;
		margin-bottom: 16rpx;
	}

	.img-regenerating-text {
		font-size: 24rpx;
		color: #fff;
	}

	.moment-actions {
		display: flex;
		margin: 0 0 16rpx;
		justify-content: flex-end;
		gap: 48rpx; /* Twitter 互动组间距略疏 */
		position: relative;
	}

	.moment-actions .action-btn {
		margin-left: 0;
	}

	.overflow-wrap {
		position: relative;
		margin-left: 0;
		z-index: 1;

		&.open {
			z-index: 60; /* 高于遮罩，保证菜单可点 */
		}
	}

	.overflow-btn {
		padding: 8rpx;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.overflow-icon {
		display: block;
		width: 40rpx;
		height: 40rpx;
		opacity: 0.6;
	}

	.overflow-menu {
		position: absolute;
		right: 0;
		top: 56rpx;
		z-index: 60;
		min-width: 320rpx;
		background: var(--modal-bg, #1c1c1e);
		border-radius: 16rpx;
		box-shadow: 0 8rpx 28rpx rgba(0, 0, 0, 0.35);
		overflow: hidden;
	}

	.overflow-item {
		padding: 24rpx 28rpx;
		font-size: 28rpx;
		color: var(--fg);
		white-space: nowrap;

		&.danger {
			color: var(--destructive, #ef4444);
		}
	}

	.overflow-mask {
		position: fixed;
		inset: 0;
		z-index: 50;
	}

	.compact-actions {
		display: flex;
		gap: 48rpx;
	}

	.compact-actions .action-btn {
		margin-left: 0;
	}

	.action-btn {
		display: flex;
		flex-direction: row;
		align-items: center; /* Twitter：图标与数字垂直居中 */
		gap: 8rpx; /* ~4 */
		font-size: 26rpx; /* ~13，Twitter metrics 量级 */
		font-weight: 400;
		line-height: 1.2;
	}

	.action-img {
		display: block;
		width: 40rpx; /* ~20，贴近 Twitter 互动图标 */
		height: 40rpx;
		margin-right: 0;
		flex-shrink: 0;
	}

	.action-count {
		/* 与 CSS rpx 同源；勿内联 rpx（H5 会编成固定 rem） */
		font-size: 26rpx; /* ~13 */
		font-weight: 400;
		line-height: 1.2;
		color: var(--fg);
		opacity: 0.6; /* Twitter 次级灰感 */

		&.is-liked {
			color: #ff375f;
			opacity: 1;
		}
	}

	/* ── compact 形态底部：时间 + 计数 ── */
	.compact-footer {
		justify-content: space-between;
		margin-top: 4rpx;
	}

	.compact-time {
		font-size: 24rpx;
	}

	/* ── 评论区：稿 14 Medium ── */
	.comments-box {
		padding: 0;
		margin-bottom: 24rpx; /* 与输入区间隙 12 */
	}

	.view-all-hint {
		display: block;
		font-size: 24rpx;
		color: var(--fg-muted);
		margin-top: 8rpx;
		padding-top: 8rpx;
	}

	.comment-line {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: baseline;
		font-size: 28rpx; /* 14 */
		line-height: 1.35;
		font-weight: 500;
		color: var(--fg);
		margin-bottom: 0;
		padding: 8rpx 0; /* py 4 */
		word-break: break-word;
		overflow-wrap: break-word;
		gap: 16rpx; /* 8 */
	}

	.comment-name {
		flex-shrink: 0;
		font-weight: 500;
		font-size: 28rpx;
		margin-right: 0;
		max-width: 200rpx;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--fg-muted, rgba(255, 255, 255, 0.6));

		&.mine {
			font-weight: 900;
			color: var(--fg-muted, rgba(255, 255, 255, 0.6));
		}
	}

	.comment-content {
		flex: 1;
		min-width: 0;
		word-break: break-word;
		word-wrap: break-word;
		overflow-wrap: break-word;
		font-weight: 500;
		font-size: 28rpx;
		color: var(--fg, #fff);

		&.pending {
			opacity: 0.65;
		}
	}

	.reply-to {
		font-weight: 500;
		margin-right: 4rpx;
	}

	.reply-to-me {
		font-weight: 900;
		margin-right: 4rpx;
	}

	.comment-input-row {
		margin-top: 0;
	}

	.comment-input {
		flex: 1;
		margin-right: 0;
		border-radius: 32rpx; /* 16 */
		font-size: 24rpx; /* 12 */
		font-weight: 500;
		background: var(--surface-inset, rgba(255, 255, 255, 0.05)) !important;
		border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.05)) !important;
		color: var(--fg);
		padding: 24rpx !important; /* 12 */
		height: auto !important;
		min-height: 76rpx;
		line-height: 1.35;
		overflow: visible;
		box-sizing: border-box;
	}

	.send-btn {
		padding: 10rpx 14rpx;
		color: var(--brand);

		&.busy {
			opacity: 0.45;
			pointer-events: none;
		}
	}

	.comment-send-img {
		width: 56rpx;
		height: 56rpx;
	}

	.send-spinner {
		display: inline-block;
		width: 28rpx;
		height: 28rpx;
		border: 4rpx solid rgba(236, 72, 153, 0.25);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: moment-spin 0.6s linear infinite;
	}

	@keyframes moment-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>