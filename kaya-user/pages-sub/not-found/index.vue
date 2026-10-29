<script setup>
/**
 * @file pages-sub/not-found — 404
 * @description 未匹配路由的占位页，提供返回首页。
 */
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";

const { t } = useI18n();
</script>

<template>
  <AppPageShell title="404" :show-back="true">
    <view class="center">
      <text class="code">404</text>
      <text class="text-muted">{{ t("notFound.desc") }}</text>
      <button class="btn-primary mt-md" @tap="uni.reLaunch({ url: '/pages/home/index' })">
        {{ t("notFound.home") }}
      </button>
    </view>
  </AppPageShell>
</template>

<style scoped lang="scss">
.center { text-align: center; padding: 120rpx 32rpx; }
.code { display: block; font-size: 120rpx; font-weight: 700; color: var(--brand); margin-bottom: 24rpx; }
</style>
