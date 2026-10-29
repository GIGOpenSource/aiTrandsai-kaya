<script setup>
/**
 * @file pages/splash — 启动引导页（对照 Figma 886:9586）
 * @description 营销原片 + Skip 倒计时，结束后进入登录或首页。
 */
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { isLoggedIn, goAfterAuth } from "@/composables/useAuth";

const { t } = useI18n();
/** 每次冷启短暂展示（对照营销稿语言，可 Skip） */
const TOTAL = 3;
const remain = ref(TOTAL);
let timer = null;

function goNext() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (isLoggedIn()) {
    goAfterAuth();
  } else {
    uni.reLaunch({ url: "/pages/login/index" });
  }
}

function handleSkip() {
  goNext();
}

onMounted(() => {
  timer = setInterval(() => {
    remain.value -= 1;
    if (remain.value <= 0) goNext();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <view class="splash-page">
    <image class="hero-img" src="/static/splash/hero.png" mode="aspectFill" />
    <!-- 暖色提亮：琥珀/蜜桃色叠层，尽量不改原片构图 -->
    <view class="hero-warm" />
    <view class="hero-dim" />

    <view class="skip-btn" @tap="handleSkip">
      <text class="skip-text">{{ remain }}s</text>
      <view class="skip-div" />
      <text class="skip-text">{{ t("onboarding.skip") }}</text>
    </view>

    <view class="brand">
      <view class="logo-wrap">
        <image class="logo" src="/static/common/logo1.svg" mode="aspectFit" />
      </view>
      <text class="name">Trands Ai</text>
      <text class="tagline">{{ t("login.subtitle") }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.splash-page {
  position: relative;
  width: 100%;
  min-height: 100vh;
  background: var(--splash-warm-bg, #1a100c);
  overflow: hidden;
}

.hero-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 轻微暖：略提饱和与橙向色相，少变凉灰 */
  filter: saturate(1.12) sepia(0.18) hue-rotate(-8deg) contrast(1.04) brightness(1.03);
}

.hero-warm {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 80% at 50% 18%, rgba(255, 176, 110, 0.28) 0%, transparent 58%),
    linear-gradient(
      180deg,
      rgba(255, 150, 80, 0.16) 0%,
      rgba(220, 110, 70, 0.1) 42%,
      rgba(26, 16, 12, 0.28) 100%
    );
}

.hero-dim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* 减轻冷黑压暗，改用暖棕透明罩 */
  background: linear-gradient(
    180deg,
    rgba(40, 22, 14, 0.08) 0%,
    rgba(20, 12, 8, 0.18) 100%
  );
}

.skip-btn {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 24rpx);
  right: 32rpx;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 24rpx;
  border-radius: 32rpx;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.skip-text {
  color: #fff;
  font-size: 24rpx;
  line-height: 1;
}

.skip-div {
  width: 1px;
  height: 22rpx;
  background: rgba(255, 255, 255, 0.35);
}

.brand {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  height: 288rpx;
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
  // background: var(--splash-warm-bg, #1a100c);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 40rpx;
  background: #000;
}

.logo-wrap {
  width: 104rpx;
  height: 104rpx;
  border-radius: 30rpx;
  overflow: hidden;
  // background: linear-gradient(180deg, #3a2a22 0%, var(--splash-warm-bg, #1a100c) 100%);
  // border: 1px solid rgba(255, 255, 255, 0.05);

  margin-bottom: 8rpx;
}

.logo {
  width: 100%;
  height: 100%;
}

.name {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
  line-height: 36rpx;
  margin-bottom: 8rpx;
}

.tagline {
  font-size: 20rpx;
  color: #fff;
  opacity: 0.4;
  line-height: 1.3;
}
</style>
