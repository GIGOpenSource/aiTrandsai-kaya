<script setup>
/**
 * @file pages-sub/report-character
 * @description App 聊天 nvue 无法挂 Vue 组件，打开与智能体详情相同的 AppReportCharacterPopup。
 */
import { ref, nextTick } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppReportCharacterPopup from "@/components/AppReportCharacterPopup.vue";

const open = ref(false);
const characterId = ref("");
const source = ref("chat");
const messageId = ref("");
const messageText = ref("");
const messageSender = ref("");

let closing = false;

function goBack() {
  if (closing) return;
  closing = true;
  uni.navigateBack({ fail: () => {} });
}

onLoad((query) => {
  characterId.value = String(query?.id || "");
  source.value = String(query?.source || "chat");
  messageId.value = String(query?.messageId || "");
  try {
    messageText.value = decodeURIComponent(String(query?.text || ""));
  } catch {
    messageText.value = String(query?.text || "");
  }
  messageSender.value = String(query?.sender || "");
  nextTick(() => {
    open.value = true;
  });
});
</script>

<template>
  <view class="report-host">
    <AppReportCharacterPopup
      :open="open"
      :character-id="characterId"
      :source="source"
      :message-id="messageId"
      :message-text="messageText"
      :message-sender="messageSender"
      @update:open="open = $event"
      @done="goBack"
    />
  </view>
</template>

<style scoped>
.report-host {
  min-height: 100vh;
  width: 100%;
  background-color: transparent;
}
</style>
