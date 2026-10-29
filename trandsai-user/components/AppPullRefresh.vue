<template>
  <!-- #ifdef APP-PLUS -->
  <view class="app-pull-refresh">
    <view
      class="refresh-area"
      :class="{ 'is-touching': touching }"
      :style="{ height: pullDistance + 'px' }"
    >
      <view v-show="status === 'refreshing'"><slot name="refreshing" /></view>
      <view v-show="status === 'release'"><slot name="release" /></view>
      <view v-show="status === 'pull'"><slot name="pull" /></view>
    </view>
    <scroll-view
      class="app-pull-refresh-inner"
      scroll-y
      :enhanced="true"
      :bounces="false"
      :enable-back-to-top="enableBackToTop"
      :lower-threshold="lowerThreshold"
      :scroll-top="innerScrollTop"
      :scroll-with-animation="false"
      @scroll="onScroll"
      @scrolltolower="onLoadmore"
      @touchmove.stop
    >
      <view
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <slot />
        <u-loadmore v-if="showLoadmore" v-bind="loadmoreProps" />
      </view>
    </scroll-view>
  </view>
  <!-- #endif -->

  <!-- #ifndef APP-PLUS -->
  <u-pull-refresh
    class="app-pull-refresh"
    :refreshing="refreshing"
    :threshold="threshold"
    :enable-back-to-top="enableBackToTop"
    v-bind="scrollTopBind"
    :lower-threshold="lowerThreshold"
    :show-loadmore="showLoadmore"
    :loadmore-props="loadmoreProps"
    @refresh="$emit('refresh')"
    @loadmore="$emit('loadmore')"
    @scroll="onScroll"
  >
    <template #pull><slot name="pull" /></template>
    <template #release><slot name="release" /></template>
    <template #refreshing><slot name="refreshing" /></template>
    <slot />
  </u-pull-refresh>
  <!-- #endif -->
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps({
  refreshing: { type: Boolean, default: false },
  threshold: { type: Number, default: 80 },
  showLoadmore: { type: Boolean, default: false },
  loadmoreProps: {
    type: Object,
    default: () => ({ status: "loadmore" }),
  },
  enableBackToTop: { type: Boolean, default: false },
  lowerThreshold: { type: [Number, String], default: 50 },
  scrollTop: { type: [Number, String], default: 0 },
});

const emit = defineEmits(["refresh", "loadmore", "scroll"]);

/** 图二 Refreshing 状态的可视高度，到这就锁住 */
const MAX_PULL = 120;
const DAMPING = 0.5;

const touching = ref(false);
const pulling = ref(false);
const isRefreshing = ref(false);
const pullDistance = ref(0);
const startY = ref(0);
const currentScrollTop = ref(0);
/**
 * App 端持续绑定 scroll-top，避免程序化滚动后解绑被 iOS 吸顶。
 * 滑动过程中不回写，只在停住后再对齐，避免每帧 setData 卡顿。
 */
const innerScrollTop = ref(0);
let syncFromScrollAfter = 0;
let scrollIdleTimer = 0;
const jumpTop = ref(0);
const jumpArmed = ref(false);

const status = computed(() => {
  if (isRefreshing.value) return "refreshing";
  if (pullDistance.value >= props.threshold) return "release";
  return "pull";
});

/** H5：短暂绑定即可 */
const scrollTopBind = computed(() =>
  jumpArmed.value ? { scrollTop: jumpTop.value } : {}
);

watch(
  () => props.refreshing,
  (v) => {
    if (v) {
      isRefreshing.value = true;
      pullDistance.value = MAX_PULL;
    } else {
      isRefreshing.value = false;
      pulling.value = false;
      pullDistance.value = 0;
    }
  }
);

watch(
  () => props.scrollTop,
  (val, prev) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return;
    if (prev !== undefined && Number(prev) === n) return;

    // #ifdef APP-PLUS
    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = 0;
    }
    // 程序化跳动后短时间忽略误报的 0
    syncFromScrollAfter = Date.now() + 200;
    const nudged = n > 0 ? n - 0.01 : 0.01;
    innerScrollTop.value = Math.abs(innerScrollTop.value - n) < 0.5 ? nudged : n;
    currentScrollTop.value = n;
    nextTick(() => {
      innerScrollTop.value = n;
    });
    // #endif

    // #ifndef APP-PLUS
    jumpTop.value = n;
    jumpArmed.value = true;
    nextTick(() => {
      setTimeout(() => {
        jumpArmed.value = false;
      }, 50);
    });
    // #endif
  }
);

function atTop() {
  return (currentScrollTop.value || 0) <= 1;
}

function onTouchStart(e) {
  if (isRefreshing.value) return;
  touching.value = true;
  pulling.value = false;
  startY.value = e.touches[0].pageY;
}

function onTouchMove(e) {
  if (!touching.value || isRefreshing.value) return;
  const diff = e.touches[0].pageY - startY.value;
  if ((diff > 0 && atTop()) || pulling.value) {
    pulling.value = diff > 0 && atTop();
    if (!pulling.value) {
      pullDistance.value = 0;
      return;
    }
    pullDistance.value = Math.min(diff * DAMPING, MAX_PULL);
  }
}

function onTouchEnd() {
  if (!touching.value) return;
  touching.value = false;
  pulling.value = false;
  if (pullDistance.value >= props.threshold && !isRefreshing.value) {
    isRefreshing.value = true;
    pullDistance.value = MAX_PULL;
    emit("refresh");
  } else if (!isRefreshing.value) {
    pullDistance.value = 0;
  }
}

function onScroll(e) {
  const st = Number(e?.detail?.scrollTop) || 0;

  // #ifdef APP-PLUS
  if (Date.now() < syncFromScrollAfter && st < 2 && currentScrollTop.value > 40) {
    emit("scroll", e);
    return;
  }
  currentScrollTop.value = st;
  // 滑动/惯性过程中不回写 scroll-top；停住后再对齐绑定值
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = 0;
    if (Date.now() < syncFromScrollAfter) return;
    if (Math.abs(innerScrollTop.value - currentScrollTop.value) < 0.5) return;
    innerScrollTop.value = currentScrollTop.value;
  }, 120);
  // #endif

  // #ifndef APP-PLUS
  currentScrollTop.value = st;
  // #endif

  emit("scroll", e);
}

function onLoadmore() {
  emit("loadmore");
}
</script>

<style scoped>
.app-pull-refresh {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.refresh-area {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  transition: height 0.2s ease-out;
}

.refresh-area.is-touching {
  transition: none;
}

.app-pull-refresh-inner {
  flex: 1;
  height: 0;
  min-height: 0;
}
</style>
