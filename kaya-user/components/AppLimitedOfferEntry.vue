<script setup>
/**
 * @file AppLimitedOfferEntry.vue
 * @description 限时优惠悬浮入口：仅 TabBar 首页 / 消息页；固定在底栏上方右侧。
 * 底图 entry-badge 为 144×155 无字图；时间对齐上方粉圈，文案对齐中间色带。
 * 显示条件：entryAllowed + entryVisible && isActive（新用户选完性别 / 已有性别进首页 GET 后）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLimitedOfferStore } from "@/stores/limitedOffer";

const { t } = useI18n();
const offer = useLimitedOfferStore();

const visible = computed(
  () => offer.entryVisible && offer.isActive && !offer.modalOpen
);

const countdownText = computed(() => offer.countdownText || "00:00");

function onTap() {
  offer.openFromEntry();
}
</script>

<template>
  <view v-if="visible" class="limited-offer-entry" @tap.stop="onTap">
    <image
      class="limited-offer-entry-bg"
      src="/static/discount/entry-badge.svg"
      mode="scaleToFill"
    />
    <text class="limited-offer-entry-time">{{ countdownText }}</text>
    <!-- 文案可含 \n，固定折成两行 -->
    <text class="limited-offer-entry-label">{{
      t("limitedOffer.entryLabel")
    }}</text>
  </view>
</template>

<style scoped lang="scss">
/*
 * 底图 144×155，容器严格同比例 + scaleToFill，避免留白错位。
 * 粉圈中心约 32%；色带约 47%~78%（按像素行采样）。
 */
.limited-offer-entry {
  position: fixed;
  right: 8rpx;
  bottom: calc(130rpx + env(safe-area-inset-bottom));
  width: 160rpx;
  height: 172rpx; /* 160 * 155 / 144 */
  z-index: 1200;
}

.limited-offer-entry-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 160rpx;
  height: 172rpx;
}

/* 时间落在粉圈中心 */
.limited-offer-entry-time {
  position: absolute;
  left: 0;
  right: 20rpx;
  top: 38rpx;
  text-align: center;
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 700;
  font-style: normal;
  line-height: 1;
  letter-spacing: 1rpx;
  text-shadow: 0 2rpx 3rpx rgba(119, 0, 20, 0.4);
}

.limited-offer-entry-label {
  position: absolute;
  left: 10rpx;
  right: 10rpx;
  /* 色带内尽量两行展示完整文案 */
  top: 78rpx;
  height: 52rpx;
  overflow: hidden;
  color: #ffffff;
  font-size: 18rpx;
  font-weight: 700;
  font-style: normal;
  line-height: 1.25;
  text-align: center;
  text-transform: none;
  transform: none;
  text-shadow: 0 1rpx 2rpx rgba(119, 0, 20, 0.35);
  word-break: break-word;
  white-space: pre-line;
}
</style>
