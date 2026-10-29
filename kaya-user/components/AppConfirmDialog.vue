<script setup>
/**
 * @file AppConfirmDialog.vue
 * @description 确认弹窗：v-model:open，confirm / 可选 destructive 样式。
 * 按钮默认走 i18n（common.confirm / common.cancel）；cancelText="" 时隐藏取消。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "" },
  description: { type: String, default: "" },
  confirmText: { type: String, default: undefined },
  cancelText: { type: String, default: undefined },
  destructive: { type: Boolean, default: false },
  /** 点遮罩是否关闭；成功提示等场景应关掉 */
  closeOnMask: { type: Boolean, default: true },
});

const emit = defineEmits(["update:open", "confirm"]);

const confirmLabel = computed(() => props.confirmText || t("common.confirm"));
const showCancel = computed(() => props.cancelText !== "");
const cancelLabel = computed(() => props.cancelText || t("common.cancel"));

function close() {
  emit("update:open", false);
}

function onMaskTap() {
  if (!props.closeOnMask) return;
  close();
}

function onConfirm() {
  emit("confirm");
  close();
}
</script>

<template>
  <view v-if="open" class="mask" @tap="onMaskTap">
    <view class="dialog card" @tap.stop>
      <text v-if="title" class="dlg-title">{{ title }}</text>
      <text v-if="description" class="dlg-desc text-muted">{{ description }}</text>
      <view class="dlg-actions flex-row">
        <view v-if="showCancel" class="dlg-btn cancel" hover-class="none" @tap="close">
          <text class="dlg-btn-text">{{ cancelLabel }}</text>
        </view>
        <view
          class="dlg-btn confirm"
          hover-class="none"
          @tap="onConfirm"
        >
          <text class="dlg-btn-text">{{ confirmLabel }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 12000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
}
.dialog {
  width: 100%;
  max-width: 600rpx;
  padding: 50rpx 32rpx;
  position: absolute;
  left: 50%;
  bottom: 30rpx;
  transform: translateX(-50%);
  background: var(--modal-bg);
  border: 1px solid var(--border);
  border-radius: 32rpx;
  overflow: visible;
  box-sizing: border-box;
}
.dlg-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
}
.dlg-desc {
  display: block;
  font-size: 28rpx;
  line-height: 1.5;
  margin-bottom: 32rpx;
}
.dlg-actions {
  display: flex;
  flex-direction: row;
  overflow: visible;
}
.dlg-btn {
  flex: 1;
  height: 80rpx;
  min-height: 80rpx;
  border-radius: 40rpx;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: visible;
  line-height: 1;
  color: var(--fg);
  border: none;

  &.cancel {
    background: var(--bg-input);
    color: var(--fg);
    margin-right: 20rpx;
    border: 2rpx solid var(--border);
  }
  &.confirm {
    background: var(--gradient-brand-btn);
    color: var(--fg-on-brand, #0a0a0a);
  }
}
.dlg-btn-text {
  font-size: 28rpx;
  line-height: 1.2;
  color: inherit;
}
</style>
