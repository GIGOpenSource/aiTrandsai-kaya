<script setup>
/**
 * @file AppWheelPickerPopup.vue
 * @description 底部滚轮选择弹窗（自绘 scroll，无原生 picker-view 白线）。
 * 风格对齐创建页深色表单 + 黄粉品牌。
 * iOS：scroll-view 会忽略内容 padding，需用占位 view；高亮条固定在视窗正中，不跟条目走。
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeStore } from "@/stores/theme";
import { useStatusBar } from "@/composables/useStatusBar";

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: "" },
  /** string[] | { label, value?/key? }[] */
  options: { type: Array, default: () => [] },
  /** 当前选中下标 */
  modelValue: { type: Number, default: 0 },
});

const emit = defineEmits(["update:show", "update:modelValue", "confirm", "cancel"]);

const { t } = useI18n();
const themeStore = useThemeStore();
const safe = useStatusBar();
/** iOS 底部安全区要铺实色，uView 的 inset 是透明的会透出表单文字 */
const sheetBg = computed(() => (themeStore.isDark ? "#0a0a0a" : "#ffffff"));
const safePadPx = computed(() => Math.max(0, Number(safe.value.safeAreaBottom) || 0));

const ITEM_H = 44;
const ITEM_GAP = 8;
const ITEM_STEP = ITEM_H + ITEM_GAP;
const VIEW_H = ITEM_STEP * 5;
const PAD_Y = Math.floor((VIEW_H - ITEM_STEP) / 2);
const HIGHLIGHT_TOP = Math.floor((VIEW_H - ITEM_H) / 2);
const FADE_H = ITEM_STEP;

const items = computed(() =>
  (props.options || []).map((o, i) => {
    if (o == null) return { label: String(i), value: i };
    if (typeof o === "string" || typeof o === "number") {
      return { label: String(o), value: o };
    }
    return {
      label: o.label ?? o.name ?? String(o.key ?? o.value ?? i),
      value: o.value ?? o.key ?? i,
    };
  })
);

const draftIndex = ref(0);
const scrollTop = ref(0);
const scrollAnimating = ref(false);
let liveTop = 0;
let snapTimer = 0;
let reopenTimer = 0;

function clampIndex(idx) {
  const max = Math.max(0, items.value.length - 1);
  return Math.min(max, Math.max(0, Number(idx) || 0));
}

function indexFromTop(top) {
  return clampIndex(Math.round(Number(top || 0) / ITEM_STEP));
}

function forceScrollTop(next) {
  const target = next === scrollTop.value ? next + 0.01 : next;
  scrollTop.value = target;
}

function scrollToIndex(idx, animate = true) {
  const i = clampIndex(idx);
  draftIndex.value = i;
  scrollAnimating.value = animate;
  const top = i * ITEM_STEP;
  forceScrollTop(top);
  liveTop = top;
}

function onScroll(e) {
  liveTop = e?.detail?.scrollTop || 0;
  draftIndex.value = indexFromTop(liveTop);
  clearTimeout(snapTimer);
  snapTimer = setTimeout(snapNow, 80);
}

function snapNow() {
  const i = indexFromTop(liveTop);
  draftIndex.value = i;
  forceScrollTop(i * ITEM_STEP);
  liveTop = i * ITEM_STEP;
}

function selectIndex(idx) {
  scrollToIndex(idx, true);
}

function onCancel() {
  emit("cancel");
  emit("update:show", false);
}

function onConfirm() {
  const i = clampIndex(draftIndex.value);
  emit("update:modelValue", i);
  emit("confirm", i, items.value[i]);
  emit("update:show", false);
}

watch(
  () => props.show,
  async (open) => {
    if (!open) {
      clearTimeout(reopenTimer);
      return;
    }
    scrollAnimating.value = false;
    await nextTick();
    scrollToIndex(props.modelValue, false);
    // 弹层动画未完成时 iOS 会丢掉 scroll-top，再对齐一次
    reopenTimer = setTimeout(() => {
      scrollToIndex(props.modelValue, false);
      nextTick(() => {
        scrollAnimating.value = true;
      });
    }, 80);
  }
);

watch(
  () => props.options?.length,
  () => {
    if (props.show) scrollToIndex(draftIndex.value, false);
  }
);
</script>

<template>
  <up-popup
    :show="show"
    class="awp-host"
    :class="{ 'awp-host-open': show }"
    mode="bottom"
    :safe-area-inset-bottom="false"
    :z-index="12000"
    round="24"
    :bg-color="sheetBg"
    @close="onCancel"
  >
    <view class="awp">
      <view class="awp-toolbar">
        <text class="awp-btn cancel" @tap="onCancel">{{ t("common.cancel") }}</text>
        <text class="awp-title">{{ title }}</text>
        <text class="awp-btn confirm" @tap="onConfirm">{{ t("common.confirm") }}</text>
      </view>

      <view class="awp-body" :style="{ height: VIEW_H + 'px' }">
        <view
          class="awp-highlight"
          :style="{ height: ITEM_H + 'px', top: HIGHLIGHT_TOP + 'px' }"
        />
        <view class="awp-edge awp-edge-top" />
        <view class="awp-edge awp-edge-bot" />
        <view class="awp-fade awp-fade-top" :style="{ height: FADE_H + 'px' }" />
        <view class="awp-fade awp-fade-bot" :style="{ height: FADE_H + 'px' }" />

        <scroll-view
          class="awp-scroll"
          scroll-y
          :bounces="false"
          :show-scrollbar="false"
          :scroll-top="scrollTop"
          :scroll-with-animation="scrollAnimating"
          :style="{ backgroundColor: 'var(--surface-sheet, #0a0a0a)', height: VIEW_H + 'px' }"
          @scroll="onScroll"
          @touchend="snapNow"
          @mouseup="snapNow"
        >
          <!-- iOS 会忽略内容 padding，必须用占位 view 才能把首尾滚到正中 -->
          <view class="awp-pad" :style="{ height: PAD_Y + 'px' }" />
          <view
            v-for="(item, index) in items"
            :key="`${item.value}-${index}`"
            class="awp-slot"
            :style="{ height: ITEM_STEP + 'px' }"
            @tap="selectIndex(index)"
          >
            <view class="awp-pill" :style="{ height: ITEM_H + 'px' }">
              <text
                class="awp-pill-text"
                :class="{ selected: draftIndex === index }"
              >{{ item.label }}</text>
            </view>
          </view>
          <view class="awp-pad" :style="{ height: PAD_Y + 'px' }" />
        </scroll-view>
      </view>
      <view class="awp-safe" :style="{ height: safePadPx + 'px' }" />
    </view>
  </up-popup>
</template>

<style scoped lang="scss">
.awp {
  background: var(--surface-sheet, #0a0a0a);
  border-radius: 32rpx 32rpx 0 0;
  border-top: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.06));
  overflow: hidden;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.awp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 28rpx 32rpx;
  background: var(--surface-sheet, #0a0a0a);
  border-bottom: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.06));
}

.awp-btn {
  min-width: 104rpx;
  font-size: 28rpx;
  line-height: 1.2;
  padding: 8rpx 0;
}

.awp-btn.cancel {
  color: var(--fg-dim, rgba(255, 255, 255, 0.4));
}

.awp-btn.confirm {
  color: var(--brand-text, var(--brand, #fff946));
  font-weight: 600;
  text-align: right;
}

.awp-title {
  flex: 1;
  text-align: center;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--fg, rgba(255, 255, 255, 0.92));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awp-body {
  position: relative;
  background: var(--surface-sheet, #0a0a0a);
  overflow: hidden;
  overscroll-behavior: none;
  transform: translateZ(0);
}

.awp-highlight {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  z-index: 1;
  pointer-events: none;
  border-radius: 24rpx;
  box-sizing: border-box;
  background: rgba(255, 249, 70, 0.12);
  border: 1rpx solid rgba(255, 249, 70, 0.28);
}

.awp-scroll {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  background: var(--surface-sheet, #0a0a0a) !important;
  overscroll-behavior: none;
}

.awp-body :deep(.uni-scroll-view),
.awp-body :deep(.uni-scroll-view-content),
.awp-body :deep(.uni-scroll-view > div),
.awp-body :deep(.uni-scroll-view-content > div) {
  background-color: var(--surface-sheet, #0a0a0a) !important;
  background: var(--surface-sheet, #0a0a0a) !important;
}

.awp-pad {
  width: 100%;
  flex-shrink: 0;
  background: var(--surface-sheet, #0a0a0a);
}

.awp-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background: var(--surface-sheet, #0a0a0a);
  padding: 0 32rpx;
}

.awp-pill {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 0 24rpx;
  background: transparent;
}

.awp-pill-text {
  font-size: 30rpx;
  font-weight: 400;
  color: var(--fg-dim, rgba(255, 255, 255, 0.4));
  line-height: 1.2;
  text-align: center;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.awp-pill-text.selected {
  color: var(--brand-text, var(--brand, #fff946));
  font-weight: 600;
}

.awp-fade {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  pointer-events: none;
}

.awp-fade-top {
  top: 0;
  background: linear-gradient(
    180deg,
    var(--surface-sheet, #0a0a0a) 0%,
    var(--surface-sheet-fade, rgba(10, 10, 10, 0.55)) 55%,
    transparent 100%
  );
}

.awp-fade-bot {
  bottom: 0;
  background: linear-gradient(
    0deg,
    var(--surface-sheet, #0a0a0a) 0%,
    var(--surface-sheet, #0a0a0a) 35%,
    var(--surface-sheet-fade, rgba(10, 10, 10, 0.55)) 70%,
    transparent 100%
  );
}

.awp-edge {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  background: var(--surface-sheet, #0a0a0a);
  z-index: 4;
  pointer-events: none;
}

.awp-edge-top {
  top: 0;
}

.awp-edge-bot {
  bottom: 0;
}

.awp-safe {
  flex-shrink: 0;
  width: 100%;
  min-height: constant(safe-area-inset-bottom);
  min-height: env(safe-area-inset-bottom, 0px);
  background: var(--surface-sheet, #0a0a0a);
}
</style>

<style>
.awp-scroll ::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* 打开时铺满视口，避免 iOS 把 fixed 蒙层裁在安全区上方、透出创建页文字 */
.awp-host-open.u-popup,
.u-popup.awp-host-open,
.awp-host.awp-host-open {
  position: fixed !important;
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  bottom: 0 !important;
  width: auto !important;
  height: auto !important;
  overflow: hidden !important;
  z-index: 12000 !important;
}
</style>
