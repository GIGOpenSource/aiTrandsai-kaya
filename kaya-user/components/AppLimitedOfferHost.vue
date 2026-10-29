<script setup>
/**
 * @file AppLimitedOfferHost.vue
 * @description 限时优惠宿主：弹窗 + 可选悬浮入口（showEntry 仅首页/消息）。
 * 自动弹窗：首页选完性别 / 首次进聊天(first_chat)；关闭后出悬浮入口。
 * 付费墙仍可按商品类型切限时弹窗；pending 可延迟打开。
 */
import { watch, nextTick, onMounted } from "vue";
import AppLimitedOfferModal from "@/components/AppLimitedOfferModal.vue";
import AppLimitedOfferEntry from "@/components/AppLimitedOfferEntry.vue";
import { useLimitedOfferStore } from "@/stores/limitedOffer";

defineProps({
  /** 首页 / 聊天页显示右侧悬浮入口 */
  showEntry: { type: Boolean, default: false },
});

const offer = useLimitedOfferStore();

let flushTimer = null;

function tryFlush() {
  if (!offer.pendingAutoOpen) return;
  if (flushTimer) clearTimeout(flushTimer);
  // 等付费弹窗关闭 / 充值页返回动画
  flushTimer = setTimeout(() => {
    flushTimer = null;
    nextTick(() => offer.flushPendingAutoOpen());
  }, 320);
}

onMounted(tryFlush);

watch(
  () => offer.pendingAutoOpen,
  (v) => {
    if (v) tryFlush();
  }
);
</script>

<template>
  <AppLimitedOfferModal />
  <AppLimitedOfferEntry v-if="showEntry" />
</template>
