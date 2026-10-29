<script setup>
/**
 * @file AppMessageActionPopup.vue
 * @description 聊天气泡长按：复制 / 举报。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStatusBar } from "@/composables/useStatusBar";

const props = defineProps({
  open: { type: Boolean, default: false },
  preview: { type: String, default: "" },
  /** 长按手指还未抬起时为 false，挡住这次松手，避免点到复制/举报 */
  interactive: { type: Boolean, default: true },
});

const emit = defineEmits(["update:open", "copy", "report", "gesture-end"]);

const { t } = useI18n();
const safe = useStatusBar();
const safePadPx = computed(() => Math.max(0, Number(safe.value.safeAreaBottom) || 0));

const previewText = computed(() => {
  const s = String(props.preview || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > 72 ? `${s.slice(0, 72)}…` : s;
});

function close() {
  if (!props.interactive) return;
  emit("update:open", false);
}

function onCopy() {
  if (!props.interactive) return;
  emit("copy");
  emit("update:open", false);
}

function onReport() {
  if (!props.interactive) return;
  emit("report");
  emit("update:open", false);
}
</script>

<template>
  <view v-if="open" class="msg-action-mask" @tap="close" @touchmove.stop.prevent>
    <view
      class="msg-action-sheet"
      :style="{ paddingBottom: safePadPx + 16 + 'px' }"
      @tap.stop
    >
      <view class="msg-action-handle" />
      <text v-if="previewText" class="msg-action-preview">{{ previewText }}</text>
      <view class="msg-action-row">
        <view class="msg-action-btn" hover-class="msg-action-btn-hover" @tap="onCopy">
          <view class="msg-action-ico copy">
            <view class="copy-back" />
            <view class="copy-front" />
          </view>
          <text class="msg-action-label">{{ t("chat.copy") }}</text>
        </view>
        <view class="msg-action-btn report" hover-class="msg-action-btn-hover" @tap="onReport">
          <view class="msg-action-ico flag">
            <view class="flag-pole" />
            <view class="flag-cloth" />
          </view>
          <text class="msg-action-label">{{ t("chat.report") }}</text>
        </view>
      </view>
      <view class="msg-action-cancel" hover-class="msg-action-btn-hover" @tap="close">
        <text class="msg-action-cancel-text">{{ t("common.cancel") }}</text>
      </view>
    </view>
    <view
      v-if="!interactive"
      class="msg-action-lock"
      @touchstart.stop.prevent
      @touchmove.stop.prevent
      @touchend.stop.prevent="emit('gesture-end')"
      @tap.stop.prevent
    />
  </view>
</template>

<style scoped lang="scss">
.msg-action-mask {
  position: fixed;
  inset: 0;
  z-index: 10500;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.msg-action-lock {
  position: absolute;
  inset: 0;
  z-index: 2;
}

.msg-action-sheet {
  position: relative;
  z-index: 1;
  width: 100%;
  border-radius: 32rpx 32rpx 0 0;
  padding: 16rpx 32rpx 0;
  box-sizing: border-box;
  background: var(--bubble-ai-bg, #1c1c1e);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.16));
  border-bottom: none;
  box-shadow: 0 -16rpx 64rpx rgba(0, 0, 0, 0.5);
}

.msg-action-handle {
  width: 72rpx;
  height: 8rpx;
  border-radius: 8rpx;
  background: var(--border, rgba(255, 255, 255, 0.16));
  margin: 8rpx auto 24rpx;
}

.msg-action-preview {
  display: block;
  font-size: 24rpx;
  line-height: 1.4;
  color: var(--fg-muted);
  background: var(--bg-input);
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  margin-bottom: 24rpx;
  overflow: hidden;
}

.msg-action-row {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-bottom: 20rpx;
}

.msg-action-btn {
  flex: 1;
  min-height: 148rpx;
  border-radius: 24rpx;
  background: var(--bg-input);
  border: 2rpx solid var(--border);
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.msg-action-btn-hover {
  opacity: 0.72;
}

.msg-action-label {
  font-size: 26rpx;
  color: var(--fg);
}

.msg-action-btn.report {
  background: var(--gradient-brand-btn);
  border: 0;
  .msg-action-label {
    color: var(--fg-on-brand, #0a0a0a);
  }
  .flag-pole,
  .flag-cloth {
    background: var(--fg-on-brand, #0a0a0a);
  }
}

.msg-action-ico {
  width: 48rpx;
  height: 48rpx;
  position: relative;
}

.copy-back,
.copy-front {
  position: absolute;
  width: 28rpx;
  height: 34rpx;
  border: 3rpx solid var(--fg);
  border-radius: 6rpx;
  box-sizing: border-box;
}
.copy-back {
  top: 4rpx;
  left: 14rpx;
  opacity: 0.45;
}
.copy-front {
  top: 12rpx;
  left: 4rpx;
  background: var(--bubble-ai-bg, #1c1c1e);
}

.flag-pole {
  position: absolute;
  left: 12rpx;
  top: 4rpx;
  width: 4rpx;
  height: 40rpx;
  border-radius: 4rpx;
  background: var(--fg);
}
.flag-cloth {
  position: absolute;
  left: 16rpx;
  top: 6rpx;
  width: 24rpx;
  height: 18rpx;
  border-radius: 0 8rpx 8rpx 0;
  background: var(--fg);
}

.msg-action-cancel {
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-input);
  border: 2rpx solid var(--border);
  margin-bottom: 8rpx;
}

.msg-action-cancel-text {
  font-size: 28rpx;
  color: var(--fg);
}
</style>
