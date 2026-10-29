<script setup>
/**
 * @file AppPageShell.vue
 * @description 页面壳：自定义顶栏 + 安全区内边距 + 可选底部 TabBar。
 * 顶栏对齐 Figma 创建页：左右 16px、标题行 58、无底部分割线、返回 24 图标；
 * titleAlign=start 时标题紧跟返回（创建页）；center 为居中（主 Tab / 通用）。
 */
import { computed, onMounted, onUnmounted, watch } from "vue";
import { onReady, onShow, onHide } from "@dcloudio/uni-app";
import {
  useStatusBar,
  HEADER_CONTENT_PX,
  safeTopCss,
  refreshSafeArea,
} from "@/composables/useStatusBar";
import { trackButtonClick } from "@/utils/analytics";
import { useThemeStore } from "@/stores/theme";
import { lockWebviewBounce } from "@/utils/lockWebviewBounce";
import AppTabBar from "./AppTabBar.vue";

const themeStore = useThemeStore();

const TAB_FALLBACK = "/pages/home/index";

const props = defineProps({
  /** 顶栏标题 */
  title: String,
  /** 是否显示顶栏 */
  showHeader: { type: Boolean, default: true },
  /**
   * 是否显示返回：
   * - true / false：强制开关
   * - 未传：非 Tab 页自动显示（showTabBar=false）
   */
  showBack: { type: Boolean, default: undefined },
  /** 是否挂载底部自定义 TabBar（主 Tab 页） */
  showTabBar: { type: Boolean, default: false },
  /** 是否在主 Tab 页临时隐藏 TabBar（如键盘弹出时） */
  tabBarHidden: { type: Boolean, default: false },
  /**
   * 全屏遮罩弹层打开时：压低顶栏层级（弹层在 body 内无法越过 header z-index:999），
   * 并隐藏底部 TabBar，避免关闭按钮与顶栏图标重叠、底栏遮挡声明文案。
   */
  overlayOpen: { type: Boolean, default: false },
  /**
   * 是否在壳层预留底栏高度。首页评论弹键盘时关掉：
   * 占位改放列表里，避免整页被顶起后露出一条黑垫。
   */
  reserveTabBar: { type: Boolean, default: true },
  /** 是否预留顶栏右侧插槽区域 */
  headerRight: { type: Boolean, default: false },
  /** 顶栏透明（无背景/无下边框），用于页面自带顶部背景图的场景 */
  transparentHeader: { type: Boolean, default: false },
  /**
   * 标题对齐：
   * - center：居中（默认）
   * - start：紧跟返回键左侧组（Figma 创建页）
   */
  titleAlign: { type: String, default: "center" },
  /** 返回按钮埋点 ID */
  backAnalyticsId: String,
  /** 返回按钮埋点名称 */
  backAnalyticsName: String,
  /** navigateBack 失败时的兜底路径 */
  backFallbackUrl: { type: String, default: TAB_FALLBACK },
  /** 全屏背景图/渐变（会铺到状态栏后面） */
  bgImage: { type: String, default: "" },
  /** 状态栏文字颜色：light / dark；不传则按主题自动 */
  statusBarStyle: { type: String, default: undefined },
  /** 是否预留底部安全区；键盘弹出时关掉，避免和键盘高度叠出一条空带 */
  padSafeBottom: { type: Boolean, default: true },
  /** 聊天等全屏 flex 页：不要用 100vh，iOS 键盘弹出后 vh 不会跟着变矮 */
  fillWebview: { type: Boolean, default: false },
  /** 内容从屏幕顶开始（顶图铺到状态栏后），不再垫 状态栏+标题行 */
  flushTop: { type: Boolean, default: false },
  /** 与主 Tab 相同的马甲包背景（纹理/浅色光晕），用于聊天等非 Tab 全屏页 */
  vestBackdrop: { type: Boolean, default: false },
});

const emit = defineEmits(["back"]);

// 必须用响应式安全区：裸 computed(() => readSafeArea()) 无依赖，首屏 0 会锁死不再更新
const safe = useStatusBar();

const shouldShowBack = computed(() => {
  if (props.showBack === true) return true;
  if (props.showBack === false) return false;
  return !props.showTabBar;
});

const isTitleStart = computed(() => props.titleAlign === "start");

const hideTabBar = computed(() => props.tabBarHidden || props.overlayOpen);

const shellClass = computed(() => ({
  "app-shell": true,
  "theme-light": !themeStore.isDark,
  "theme-dark": themeStore.isDark,
  "app-shell--tab": props.showTabBar,
  "app-shell--vest-bg": props.vestBackdrop,
  "has-bg-image": props.bgImage,
  "transparent-header-body": props.transparentHeader,
  "app-shell--fill": props.fillWebview,
  "shell-overlay-open": props.overlayOpen,
}));

const safeTop = computed(() => safeTopCss(safe.value.safeAreaTop));

/** 底栏是 fixed，藏起来也不要改 padding，否则安卓弹键盘时页面高度一变就会失焦循环 */
const tabBarOffsetPx = computed(() =>
  props.showTabBar ? safe.value.safeAreaBottom + 68 : 0
);

const pageMetaStyle = computed(() => {
  if (!props.fillWebview) return "";
  return "overflow: hidden; height: 100%; width: 100%;";
});

const shellStyle = computed(() => ({
  // 供子页 / 装饰层用 CSS 变量消费
  "--app-safe-top": safeTop.value,
  "--app-header-content": `${HEADER_CONTENT_PX}px`,
  // 底栏总高（含安全区）；悬浮按钮用 max(JS, env) 避免首屏读到 0
  "--app-tab-bar": tabBarOffsetPx.value
    ? `max(${tabBarOffsetPx.value}px, calc(68px + env(safe-area-inset-bottom, 0px)))`
    : "0px",
  paddingBottom: props.showTabBar && props.reserveTabBar
    ? `${safe.value.safeAreaBottom + 68}px`
    : props.showTabBar
      ? "0px"
      : props.padSafeBottom
        ? `${safe.value.safeAreaBottom}px`
        : "0px",
  ...(props.bgImage
    ? {
        backgroundImage: props.bgImage,
        backgroundSize: "cover",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
      }
    : {}),
}));

/**
 * 顶栏安全区占位：
 * - JS 有值时写 height，立刻生效
 * - JS 为 0 时不写死 height:0（会压过 min-height），交给 CSS env()
 */
const statusBarInsetStyle = computed(() => {
  const top = Math.max(0, Number(safe.value.safeAreaTop) || 0);
  if (top > 0) return { height: `${top}px` };
  return {};
});

/**
 * 固定顶栏始终占 状态栏 + 58 标题行（含自定义 #header）。
 * 页面勿再叠 58px spacer / marginTop，否则会双重留白。
 */
const bodyStyle = computed(() => ({
  paddingTop: props.flushTop
    ? "0px"
    : `calc(${safeTop.value} + ${HEADER_CONTENT_PX}px)`,
}));

function onBack() {
  if (props.backAnalyticsId) {
    trackButtonClick(
      props.backAnalyticsId,
      props.backAnalyticsName || props.backAnalyticsId
    );
  }
  emit("back");

  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack({
      fail: () => uni.reLaunch({ url: props.backFallbackUrl }),
    });
    return;
  }
  uni.reLaunch({ url: props.backFallbackUrl });
}

function applyBounceLock() {
  lockWebviewBounce();
  // enhanced scroll-view 晚于页面就绪才挂上，延迟再关一次内部 UIScrollView.bounces
  setTimeout(lockWebviewBounce, 80);
  setTimeout(lockWebviewBounce, 320);
}

/** 同一页反复改 Window flags / SystemUiVisibility 会让安卓键盘失焦闪烁 */
let lastStatusBarKey = "";
let iosStatusBarTimer1 = 0;
let iosStatusBarTimer2 = 0;

function statusBarIconStyle() {
  return props.statusBarStyle || (themeStore.isDark ? "light" : "dark");
}

function statusBarBgColor() {
  if (props.transparentHeader) return "rgba(0,0,0,0)";
  return themeStore.isDark ? "#0c0813" : "#f5f5f5";
}

function applyStatusBar(force = false) {
  // #ifdef APP-PLUS
  try {
    const style = statusBarIconStyle();
    const bg = statusBarBgColor();
    const key = `${style}|${bg}`;
    if (typeof plus === "undefined" || !plus.navigator) return;
    if (!force && lastStatusBarKey === key) return;
    lastStatusBarKey = key;
    plus.navigator.setStatusBarBackground(bg);
    plus.navigator.setStatusBarStyle(style);
    try {
      uni.setNavigationBarColor({
        frontColor: style === "dark" ? "#000000" : "#ffffff",
        backgroundColor: themeStore.isDark ? "#0c0813" : "#f5f5f5",
      });
    } catch {
      /* 自定义导航页仍可改 iOS 状态栏字色 */
    }

    // #ifdef APP-ANDROID
    const Color = plus.android.importClass("android.graphics.Color");
    const WindowManager = plus.android.importClass("android.view.WindowManager");
    const View = plus.android.importClass("android.view.View");
    const main = plus.android.runtimeMainActivity();
    const window = main.getWindow();
    window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
    window.setStatusBarColor(Color.TRANSPARENT);
    window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
    // 浅色底必须带 LIGHT_STATUS_BAR，否则会把时间/电量盖回白字
    let vis =
      View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
    if (style === "dark") {
      vis |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
    }
    window.getDecorView().setSystemUiVisibility(vis);
    try {
      const controller = window.getInsetsController();
      if (controller && typeof controller.setSystemBarsAppearance === "function") {
        const WindowInsetsController = plus.android.importClass(
          "android.view.WindowInsetsController"
        );
        const lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
        controller.setSystemBarsAppearance(style === "dark" ? lightBars : 0, lightBars);
      }
    } catch {
      /* API < 30 */
    }
    // #endif
  } catch {
    /* ignore */
  }
  // #endif
}

onMounted(() => {
  applyStatusBar();
  applyBounceLock();
  themeStore.syncNativePageBackground();
  // 沉浸式状态栏打开后，再刷一次安全区（首屏常读到 0）
  refreshSafeArea();
  setTimeout(refreshSafeArea, 80);
});

onReady(() => {
  applyBounceLock();
});

onShow(() => {
  applyStatusBar(true);
  applyBounceLock();
  // iOS 进页会按 pages.json / manifest 的白色状态栏再刷一次，晚一点盖回去
  // #ifdef APP-IOS
  clearTimeout(iosStatusBarTimer1);
  clearTimeout(iosStatusBarTimer2);
  iosStatusBarTimer1 = setTimeout(() => applyStatusBar(true), 60);
  iosStatusBarTimer2 = setTimeout(() => applyStatusBar(true), 320);
  // #endif
});

onHide(() => {
  clearTimeout(iosStatusBarTimer1);
  clearTimeout(iosStatusBarTimer2);
});

onUnmounted(() => {
  clearTimeout(iosStatusBarTimer1);
  clearTimeout(iosStatusBarTimer2);
});

watch(
  () => [themeStore.isDark, props.statusBarStyle, props.transparentHeader],
  () => applyStatusBar()
);
</script>

<template>
  <page-meta bounce="none" :page-style="pageMetaStyle" />
  <view :class="shellClass" :style="shellStyle">
    <view
      class="app-header"
      :class="{ 'app-header-transparent': transparentHeader }"
      @touchmove.stop.prevent
    >
      <view class="status-bar-inset" :style="statusBarInsetStyle" />
      <view
        v-if="showHeader"
        class="app-header-inner"
        :class="{ 'is-title-start': isTitleStart }"
      >
        <template v-if="isTitleStart">
          <view class="header-leading">
            <view
              v-if="shouldShowBack"
              class="back-btn"
              hover-class="back-btn-hover"
              @tap.stop="onBack"
            >
              <image
                class="back-ico icon-on-fg"
                src="/static/common/ico-arrow-left.svg"
                mode="aspectFit"
              />
            </view>
            <slot name="header-title">
              <text v-if="title" class="app-title app-title-start">{{ title }}</text>
              <text v-else class="app-title app-title-spacer" />
            </slot>
          </view>
          <view class="header-trailing">
            <slot name="header-right" />
          </view>
        </template>

        <template v-else>
          <view class="header-side header-left">
            <view
              v-if="shouldShowBack"
              class="back-btn"
              hover-class="back-btn-hover"
              @tap.stop="onBack"
            >
              <image
                class="back-ico icon-on-fg"
                src="/static/common/ico-arrow-left.svg"
                mode="aspectFit"
              />
            </view>
          </view>

          <view class="header-main">
            <slot name="header-title">
              <text v-if="title" class="app-title">{{ title }}</text>
              <text v-else class="app-title app-title-spacer" />
            </slot>
          </view>

          <view class="header-side header-right">
            <slot name="header-right" />
          </view>
        </template>
      </view>
      <view v-else class="app-header-inner">
        <slot name="header" />
      </view>
    </view>

    <view class="app-shell-body" :style="bodyStyle">
      <slot />
    </view>
    <AppTabBar v-if="showTabBar" :hidden="hideTabBar" />
  </view>
</template>

<style scoped lang="scss">
.app-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  box-sizing: border-box;
  overflow-x: hidden;
  overscroll-behavior-x: none;
  position: relative;
}

/* 主 Tab 页背景：深色纹理 + 下半渐黑；浅色青 mint + 天蓝（对照 Figma） */
.app-shell--tab.theme-dark {
  background-color: #0c0813;
  background-image:
    linear-gradient(180deg, rgba(26, 22, 39, 0) 0%, #000 50%),
    url("/static/vest/bg/home-dark-texture.png");
  background-size: cover, cover;
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
}

.app-shell--tab.theme-light {
  background-color: #f5f5f5;
  background-image: none;
}

.app-shell--tab.theme-dark::before,
.app-shell--tab.theme-dark::after {
  display: none;
}

.app-shell--tab.theme-light::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 360rpx;
  pointer-events: none;
  z-index: 0;
  background: linear-gradient(180deg, #c8ddff 0.16%, #f5f5f5 86.67%);
}

.app-shell--tab.theme-light::after {
  content: "";
  position: absolute;
  left: -80rpx;
  top: -40rpx;
  width: 476rpx;
  height: 476rpx;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
  background: #c7fff2;
  filter: blur(50px);
  opacity: 0.95;
}

/* 聊天页：与主 Tab 同一套马甲底，避免非 Tab 轻量光晕对不上稿 */
.app-shell--vest-bg.theme-dark {
  background-color: #0c0813;
  background-image:
    linear-gradient(180deg, rgba(26, 22, 39, 0) 0%, #000 50%),
    url("/static/vest/bg/home-dark-texture.png");
  background-size: cover, cover;
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
}

.app-shell--vest-bg.theme-light {
  background-color: #f5f5f5;
  background-image: none;
}

.app-shell--vest-bg.theme-dark::before,
.app-shell--vest-bg.theme-dark::after {
  display: none;
}

.app-shell--vest-bg.theme-light::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 360rpx;
  pointer-events: none;
  z-index: 0;
  background: linear-gradient(180deg, #c8ddff 0.16%, #f5f5f5 86.67%);
}

.app-shell--vest-bg.theme-light::after {
  content: "";
  position: absolute;
  left: -80rpx;
  top: -40rpx;
  width: 476rpx;
  height: 476rpx;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
  background: #c7fff2;
  filter: blur(50px);
  opacity: 0.95;
}

/* 非 Tab、且未走马甲底的页：轻量顶区光晕 */
.app-shell.theme-dark:not(.app-shell--tab):not(.app-shell--vest-bg)::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 520rpx;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(120% 80% at 15% -10%, rgba(185, 51, 230, 0.38) 0%, transparent 55%),
    radial-gradient(90% 70% at 85% 0%, rgba(255, 101, 155, 0.28) 0%, transparent 50%);
}

.app-shell.theme-light:not(.app-shell--tab):not(.app-shell--vest-bg)::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 520rpx;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(110% 85% at 8% -5%, rgba(199, 255, 242, 0.95) 0%, transparent 55%),
    radial-gradient(95% 75% at 92% 0%, rgba(200, 221, 255, 0.75) 0%, transparent 52%);
}

.app-header,
.app-shell-body {
  position: relative;
  z-index: 1;
}

.app-shell--fill {
  min-height: 100% !important;
  height: 100%;
  overflow: hidden;
}

.app-shell-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: transparent;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overscroll-behavior-x: none;
}

.app-shell.theme-light .app-shell-body {
  background: transparent;
}

.app-shell.has-bg-image .app-shell-body,
.app-shell.transparent-header-body .app-shell-body {
  background: transparent;
}

.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 999;
  display: flex;
  flex-direction: column;
  background-color: transparent;
  border-bottom: none; /* 覆盖全局、对齐稿面：标题下无黑线 */
  transition: background-color 0.25s ease;
  overflow: visible;
}

/* 弹层在 body 内：临时把顶栏压到弹层之下，避免关闭钮与编辑图标叠层 */
.app-shell.shell-overlay-open .app-header {
  z-index: 1 !important;
  pointer-events: none;
}

/* Tab / 马甲底顶栏始终透出背景光晕，避免浅色刷成白条 */
.app-shell--tab .app-header,
.app-shell--tab.theme-light .app-header:not(.app-header-transparent),
.app-shell--vest-bg .app-header,
.app-shell--vest-bg.theme-light .app-header:not(.app-header-transparent) {
  background-color: transparent;
}

.app-shell.theme-light:not(.app-shell--tab):not(.app-shell--vest-bg) .app-header:not(.app-header-transparent) {
  background-color: var(--bg);
}

.app-header-transparent {
  background-color: transparent;
  border-bottom: none;
}

/* 状态栏占位：JS height>0 时写入；否则靠 env() min-height，避免 height:0 压死安全区 */
.status-bar-inset {
  width: 100%;
  flex-shrink: 0;
  min-height: constant(safe-area-inset-top);
  min-height: env(safe-area-inset-top, 0px);
  box-sizing: content-box;
}

/* Figma：标题行高 58px、左右 16pt（=32rpx）；底部留白由 body paddingTop 预留 */
.app-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-content-h, 116rpx);
  min-height: var(--header-content-h, 116rpx);
  padding: 0 var(--page-gutter, 32rpx);
  box-sizing: border-box;
  gap: 0;
  position: relative;
  overflow: visible;
}

.app-header-inner.is-title-start {
  gap: 12rpx;
}

.header-leading {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 0;
}

.header-trailing {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}

.header-side {
  min-height: 72rpx;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  z-index: 2;
  box-sizing: border-box;
}

/* 左右等宽占位：标题在中间 flex:1 内居中；右侧允许略超以免编辑按钮被裁切 */
.header-left,
.header-right {
  flex: 0 0 96rpx;
  width: 96rpx;
  min-width: 96rpx;
}

.header-left {
  justify-content: flex-start;
  max-width: 96rpx;
}

.header-right {
  justify-content: flex-end;
  max-width: 120rpx;
  overflow: visible;
}

.header-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.app-title {
  width: 100%;
  text-align: center;
  font-size: var(--fs-title, 40rpx); /* Figma 20pt */
  font-weight: 500;
  line-height: 1.2;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-title-start {
  width: auto;
  flex: 1;
  min-width: 0;
  text-align: left;
  padding-left: 8rpx;
}

.app-title-spacer {
  opacity: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  padding: 12rpx 12rpx 12rpx 0;
  margin-right: 0;
  box-sizing: border-box;
  border-radius: 32rpx;
  position: relative;
  z-index: 3;
  flex-shrink: 0;
}

.back-btn-hover {
  opacity: 0.7;
}

.back-ico {
  width: 48rpx;
  height: 48rpx;
  display: block;
}
</style>
