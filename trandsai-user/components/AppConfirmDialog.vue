<script setup>
/**
 * @file AppConfirmDialog.vue
 * @description 确认弹窗：v-model:open，confirm / 可选 destructive 样式。
 * 按钮默认走 i18n（common.confirm / common.cancel）；cancelText="" 时隐藏取消。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeStore } from "@/stores/theme";

const { t } = useI18n();
const themeStore = useThemeStore();

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "" },
  description: { type: String, default: "" },
  confirmText: { type: String, default: undefined },
  cancelText: { type: String, default: undefined },
  destructive: { type: Boolean, default: false },
  /** 点遮罩是否关闭；成功提示等场景应关掉 */
  closeOnMask: { type: Boolean, default: true },
  /** 居中卡片（评论上限引导私信），跟随深浅色；默认仍是底部确认条 */
  centered: { type: Boolean, default: false },
});

const emit = defineEmits(["update:open", "confirm", "cancel"]);

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

function onCancel() {
  emit("cancel");
  close();
}
</script>

<template>
  <view
    v-if="open"
    class="mask"
    :class="[
      centered ? 'mask-center' : '',
      themeStore.isDark ? 'theme-dark' : 'theme-light',
    ]"
    @tap="onMaskTap"
  >
    <view class="dialog card" :class="{ 'dialog-center': centered }" @tap.stop>
      <text v-if="title" class="dlg-title">{{ title }}</text>
      <text v-if="description" class="dlg-desc" :class="{ 'text-muted': !centered }">{{ description }}</text>
      <view class="dlg-actions flex-row">
        <view v-if="showCancel" class="dlg-btn cancel" hover-class="none" @tap="onCancel">
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

.mask-center {
  background: rgba(0, 0, 0, 0.4);
  padding: 0 40rpx;
}

.dialog-center {
  position: relative;
  left: auto;
  right: auto;
  bottom: auto;
  transform: none;
  width: 100%;
  max-width: 670rpx;
  padding: 40rpx 36rpx 32rpx;
  background: var(--modal-bg, #0a0a0a);
  border: none;
  border-radius: 48rpx;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.28);

  .dlg-title {
    font-size: 34rpx;
    font-weight: 700;
    line-height: 1.35;
    color: var(--fg, #fafafa);
    margin-bottom: 16rpx;
  }

  .dlg-desc {
    font-size: 28rpx;
    line-height: 1.45;
    color: var(--fg-muted, #b5b5b5);
    margin-bottom: 36rpx;
  }

  .dlg-btn {
    height: 88rpx;
    min-height: 88rpx;
    border-radius: 44rpx;
  }

  .dlg-btn.cancel {
    background: var(--bg-secondary, #444444);
    border: none;
    color: var(--fg, #fafafa);
    margin-right: 24rpx;
  }

  .dlg-btn.confirm {
    background: linear-gradient(90deg, #fff946 0%, #ffb347 62%, #ff7eb3 100%);
    color: var(--fg-on-brand, #111111);
  }

  .dlg-btn-text {
    font-size: 30rpx;
    font-weight: 600;
  }
}
</style>
