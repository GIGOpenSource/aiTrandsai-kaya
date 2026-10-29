<script setup>
/**
 * @file AppAvatarImage.vue
 * @description 头像：normalizeMediaUrl + 失败兜底（Dicebear）；生图/上传中显示等待遮罩。
 * size: sm | md | lg
 */
import { ref, watch, computed } from "vue";
import { normalizeMediaUrl } from "@/utils/media";

const props = defineProps({
  src: String,
  seed: String,
  size: { type: String, default: "md" },
  generating: { type: Boolean, default: false },
});

const failed = ref(false);
const displaySrc = ref("");

const isGenerating = computed(() => {
  const raw = String(props.src || "").trim();
  if (props.generating) return true;
  if (!raw) return false;
  if (raw === "__GENERATING__" || raw.includes("__GENERATING__")) return true;
  return false;
});

watch(
  () => [props.src, props.seed],
  () => {
    failed.value = false;
    const raw = String(props.src || "").trim();
    if (!raw || raw === "__GENERATING__" || raw.includes("__GENERATING__")) {
      displaySrc.value = "";
      return;
    }
    displaySrc.value = normalizeMediaUrl(raw) || "";
  },
  { immediate: true }
);

const fallback = computed(
  () =>
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(props.seed || "default")}`
);

const finalSrc = computed(() => {
  if (failed.value || !displaySrc.value) return fallback.value;
  return displaySrc.value;
});

const showImage = computed(() => !isGenerating.value || !!displaySrc.value);

function onError() {
  failed.value = true;
}
</script>

<template>
  <view class="avatar-root" :class="'size-' + size">
    <image
      v-if="showImage"
      class="avatar-img"
      :class="{ dimmed: isGenerating }"
      :src="finalSrc"
      mode="aspectFill"
      lazy-load
      @error="onError"
    />
    <view v-if="isGenerating" class="avatar-gen" :class="{ overlay: showImage }">
      <view class="spinner" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.avatar-root {
  position: relative;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-input);
  flex-shrink: 0;
}
.size-sm {
  width: 64rpx;
  height: 64rpx;
}
.size-md {
  width: 80rpx;
  height: 80rpx;
}
.size-lg {
  width: 160rpx;
  height: 160rpx;
}
.avatar-img {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 50%;

  &.dimmed {
    opacity: 0.45;
  }
}
.avatar-gen {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    rgba(255, 249, 70, 0.12) 0%,
    rgba(231, 71, 164, 0.18) 100%
  );

  &.overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
  }
}
.spinner {
  width: 32rpx;
  height: 32rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.35);
  border-top-color: #ff659b;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
