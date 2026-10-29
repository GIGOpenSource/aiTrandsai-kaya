<script setup>
/**
 * @file AppMomentImage.vue
 * @description 动态/帖子图：优先缩略图，失败回退原图；旧 /data/images 再试本地代理，最后占位 SVG。
 */
import { ref, watch, computed } from "vue";
import {
  normalizeMediaUrl,
  resolveThumbUrl,
  cosUrlForDataImage,
  localDataImageUrl,
} from "@/utils/media";

const FALLBACK =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTJlOGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk0YTNiOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuWbvueJh+WKoOi9veWksei0pTwvdGV4dD48L3N2Zz4=";

const props = defineProps({
  src: String,
  preferThumb: { type: Boolean, default: true },
  mode: { type: String, default: "widthFix" },
  imgClass: String,
});

const emit = defineEmits(["click", "error"]);

function resolveInitialStage() {
  const cos = cosUrlForDataImage(props.src);
  const local = localDataImageUrl(props.src);
  const full = normalizeMediaUrl(props.src) || cos || local;
  return full ? (props.preferThumb ? "thumb" : "full") : "fallback";
}

/** @type {import('vue').Ref<'thumb'|'full'|'local'|'fallback'>} */
const stage = ref(resolveInitialStage());

watch(
  () => [props.src, props.preferThumb],
  () => {
    stage.value = resolveInitialStage();
  }
);

// 无论是因为图片加载失败回退到 fallback，还是初始就没有有效地址，
// 只要进入 fallback 就通知父组件，让首页可以触发重新生成。
watch(
  stage,
  (newStage, oldStage) => {
    if (newStage === "fallback" && oldStage !== "fallback") {
      emit("error");
    }
  },
  { immediate: true }
);

const displaySrc = computed(() => {
  if (stage.value === "fallback") return FALLBACK;

  const cos = cosUrlForDataImage(props.src);
  const local = localDataImageUrl(props.src);
  const full = normalizeMediaUrl(props.src) || cos || local;
  if (!full) return FALLBACK;

  if (stage.value === "thumb") {
    return resolveThumbUrl(full) || full;
  }
  if (stage.value === "full") {
    return full;
  }
  // local：COS/规范化地址失败后再打一次站点静态（本地后端有文件时）
  return local || FALLBACK;
});

function onError() {
  if (stage.value === "thumb") {
    stage.value = "full";
    return;
  }
  if (stage.value === "full") {
    // 仅本地后端（localhost）值得再打 /data/images；打运营机只会多一次 404
    const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
    const localBackend =
      /localhost|127\.0\.0\.1/.test(apiBase) ||
      import.meta.env.VITE_PREFER_LOCAL_IMAGES === "1";
    const local = localDataImageUrl(props.src);
    if (localBackend && local && local !== displaySrc.value) {
      stage.value = "local";
      return;
    }
  }
  stage.value = "fallback";
}

function onTap() {
  emit("click");
}
</script>

<template>
  <image
    :class="imgClass"
    :src="displaySrc"
    :mode="mode"
    lazy-load
    class="moment-image-base"
    @error="onError"
    @tap="onTap"
  />
</template>

<style scoped>
.moment-image-base {
  background: var(--bg-input);
}
</style>
