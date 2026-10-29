<script setup>
/**
 * @file pages-sub/limited-offer
 * @description 透明宿主页：叠在上一页（聊天）之上，半透明遮罩可看到底层记录。
 */
import { onMounted, onUnmounted, watch } from "vue";
import { onLoad, onShow, onReady } from "@dcloudio/uni-app";
import AppLimitedOfferModal from "@/components/AppLimitedOfferModal.vue";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import { enableTransparentOverlayWebview } from "@/utils/overlayWebview";

const offer = useLimitedOfferStore();
let stopWatch = null;
let closing = false;

function goBack() {
  if (closing) return;
  closing = true;
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: "/pages/home/index" });
    },
  });
}

function tryOpen() {
  if (offer.modalOpen) return true;
  if (offer.flushPendingAutoOpen()) return true;
  return offer.openModal({ source: "auto" });
}

onLoad(() => {
  enableTransparentOverlayWebview();
  const ok = tryOpen();
  // 无法展示时立刻退出，避免透明页挡住底层且点不到
  if (!ok) {
    try {
      offer.closeModal({ fromUser: false });
    } catch {
      /* ignore */
    }
    goBack();
  }
});

onReady(() => {
  enableTransparentOverlayWebview();
});

onShow(() => {
  enableTransparentOverlayWebview();
});

onMounted(() => {
  enableTransparentOverlayWebview();
  if (!offer.modalOpen) tryOpen();
  stopWatch = watch(
    () => offer.modalOpen,
    (open, wasOpen) => {
      if (wasOpen && !open) {
        // 游客去登录等场景：不要 navigateBack，否则和 reLaunch 登录打架卡死
        if (offer.consumeSuppressHostBack()) return;
        // 关掉后回上一页；入口只在首页/消息 Tab 显示
        goBack();
      }
    }
  );
});

onUnmounted(() => {
  if (stopWatch) stopWatch();
});
</script>

<template>
  <view class="limited-offer-page">
    <AppLimitedOfferModal />
  </view>
</template>

<style scoped>
.limited-offer-page {
  min-height: 100vh;
  width: 100%;
  background-color: transparent !important;
  background: transparent !important;
}
</style>

<!-- 非 scoped：盖掉全局 theme.scss 的 page/body 黑底，才能透出下层聊天 -->
<style>
page {
  background: transparent !important;
  background-color: transparent !important;
}
uni-page,
uni-page-wrapper,
uni-page-body,
.uni-page-body,
html,
body,
#app {
  background: transparent !important;
  background-color: transparent !important;
}
</style>
