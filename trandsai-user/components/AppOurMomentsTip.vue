<script setup>
/**
 * @file AppOurMomentsTip.vue
 * @description Our Moments 解锁 Toast：约屏幕上方 1/4；
 * 固定两行文案（标题 + 副文案），纯文字不可点。
 * 付费弹窗打开时改由 AppRechargeModal 内 tip 展示。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useChatStore } from "@/stores/chat";
import { useThemeStore } from "@/stores/theme";
import {
  OUR_MOMENTS_TIP_MS,
  OUR_MOMENTS_UNLOCKED_TIP_MS,
} from "@/utils/ourMoments";

const { t } = useI18n();
const chatStore = useChatStore();
const themeStore = useThemeStore();

const tip = computed(() => {
  const live = chatStore.ourMomentsTip;
  if (!live?.text) return null;
  const ttl =
    Number(live.ttl) ||
    (live.toast === "unlocked"
      ? OUR_MOMENTS_UNLOCKED_TIP_MS
      : OUR_MOMENTS_TIP_MS);
  if (Date.now() - Number(live.ts || 0) > ttl) return null;
  return live;
});

const isUnlocked = computed(() => tip.value?.toast === "unlocked");

/** 第 1 行：标题 */
const title = computed(() => {
  if (!isUnlocked.value) return "";
  return (
    String(tip.value?.title || "").trim() ||
    String(t("chat.ourMomentsUnlocked") || "").trim()
  );
});

/** 第 2 行：完整副文案（一整句，不拆成多段） */
const bodyText = computed(() => {
  if (!isUnlocked.value) return "";
  const fromI18n = String(t("chat.ourMomentsUnlockedPaywallBody") || "").trim();
  if (fromI18n) return fromI18n;
  const full = String(tip.value?.text || "").trim();
  const head = title.value;
  if (head && full.startsWith(head)) return full.slice(head.length).trim();
  return full;
});

const plainText = computed(() => {
  if (isUnlocked.value) return "";
  return String(tip.value?.text || "").trim();
});
</script>

<template>
  <view
    v-if="tip"
    class="our-moments-tip-mask"
    :class="themeStore.isDark ? 'theme-dark' : 'theme-light'"
  >
    <view class="our-moments-tip">
      <template v-if="isUnlocked">
        <text v-if="title" class="our-moments-tip-title">{{ title }}</text>
        <text v-if="bodyText" class="our-moments-tip-text">{{ bodyText }}</text>
      </template>
      <text v-else class="our-moments-tip-text">{{ plainText }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.our-moments-tip-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 25vh;
  pointer-events: none;
  box-sizing: border-box;
}

.our-moments-tip {
  /* 加宽，尽量让副文案保持一行，整体两行 */
  max-width: 640rpx;
  margin: 0 40rpx;
  padding: 22rpx 28rpx;
  border-radius: 16rpx;
  background: #2c2c2c;
  box-sizing: border-box;
}

.our-moments-tip-title {
  display: block;
  font-size: 28rpx;
  line-height: 1.35;
  font-weight: 600;
  color: #ffffff;
  text-align: center;
  white-space: nowrap;
}

.our-moments-tip-text {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  line-height: 1.35;
  color: #ffffff;
  text-align: center;
  /* 第 2 行尽量单行；过长再折，最多再占 1 行 */
  white-space: normal;
  word-break: break-word;
}

.theme-light .our-moments-tip {
  background: #ffffff;
  box-shadow: 0 8rpx 28rpx rgba(0, 0, 0, 0.12);
}

.theme-light .our-moments-tip-title,
.theme-light .our-moments-tip-text {
  color: #0a0a0a;
}
</style>
