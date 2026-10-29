<script setup>
/**
 * @file AppMarqueeText.vue
 * @description 单行文本：实际宽度超出容器才横向无缝滚动，否则静止展示。
 */
import {
  computed,
  ref,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  getCurrentInstance,
} from "vue";

const props = defineProps({
  /** 展示文案 */
  text: { type: String, default: "" },
  /** 兼容旧调用；滚动改由实测宽度决定，不再按字数 */
  threshold: { type: Number, default: 6 },
  /** 一轮滚动时长（秒） */
  duration: { type: Number, default: 9 },
});

const content = computed(() => String(props.text || ""));
const overflowing = ref(false);
const instance = getCurrentInstance();
const measureTimers = [];

const trackStyle = computed(() =>
  overflowing.value
    ? { animationDuration: `${Math.max(4, Number(props.duration) || 9)}s` }
    : {}
);

function clearMeasureTimers() {
  while (measureTimers.length) {
    clearTimeout(measureTimers.pop());
  }
}

function measureOverflow() {
  const proxy = instance?.proxy;
  if (!proxy || typeof uni.createSelectorQuery !== "function") return;
  uni
    .createSelectorQuery()
    .in(proxy)
    .select(".marquee-clip")
    .boundingClientRect()
    .select(".marquee-measure")
    .boundingClientRect()
    .exec((res) => {
      const clipW = Math.max(0, Number(res?.[0]?.width) || 0);
      const textW = Math.max(0, Number(res?.[1]?.width) || 0);
      overflowing.value = clipW > 1 && textW > clipW + 2;
    });
}

function scheduleMeasure() {
  clearMeasureTimers();
  nextTick(() => measureOverflow());
  measureTimers.push(setTimeout(measureOverflow, 80));
  measureTimers.push(setTimeout(measureOverflow, 240));
}

onMounted(scheduleMeasure);
onUnmounted(clearMeasureTimers);
watch(() => props.text, () => {
  overflowing.value = false;
  scheduleMeasure();
});
</script>

<template>
  <view class="marquee-clip">
    <text class="marquee-measure">{{ content }}</text>
    <view
      class="marquee-track"
      :class="{ 'is-marquee': overflowing }"
      :style="trackStyle"
    >
      <text class="marquee-text"><slot>{{ content }}</slot></text>
      <text v-if="overflowing" class="marquee-text marquee-dup">
        <slot>{{ content }}</slot>
      </text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.marquee-clip {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.marquee-measure {
  position: absolute;
  left: 0;
  top: 0;
  z-index: -1;
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
}

.marquee-track {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  white-space: nowrap;
  max-width: 100%;
}

.marquee-track.is-marquee {
  max-width: none;
  animation-name: app-marquee-x;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.marquee-text {
  white-space: nowrap;
  flex-shrink: 0;
  font-size: inherit;
  font-weight: inherit;
  color: inherit;
  line-height: inherit;
}

.marquee-dup {
  padding-left: 48rpx;
}

@keyframes app-marquee-x {
  0%,
  12% {
    transform: translateX(0);
  }
  88%,
  100% {
    transform: translateX(-50%);
  }
}
</style>
