<script setup>
/**
 * @file App.vue
 * @description 应用根组件：全局生命周期钩子 + 注入全局 SCSS。
 * 模板为空 view：真实 UI 由 pages.json 路由页面渲染。
 *
 * onLaunch：语言变更 → 通知 chat；H5 全局按钮埋点；首次页面浏览埋点
 * onShow：App 回到前台 → chat 重连/同步；再次页面浏览埋点（去重）
 * onHide：冲刷埋点队列，减少丢失与后台积压
 */
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { useChatStore } from "@/stores/chat";
import { useThemeStore } from "@/stores/theme";
import { i18n } from "@/i18n";
import { watch } from "vue";
import { isLoggedIn, hasUserGender } from "@/composables/useAuth";
import {
  setupGlobalButtonTracking,
  trackCurrentPageIfChanged,
  flushAnalyticsQueue,
} from "@/utils/analytics";
import { configureFirebaseAnalytics } from "@/utils/firebaseAnalytics";
import { runGrowthAttributionOnLaunch, retryPendingInstallReport } from "@/utils/growthAttribution";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import {
  startForegroundDree0Timer,
  pauseForegroundDree0Timer,
} from "@/utils/productAnalyticsHelpers";
import { logAppEnvOnce } from "@/utils/env";
import { setupPushIfLoggedIn } from "@/utils/push";
import { lockWebviewBounce, setupPageTouchLock } from "@/utils/lockWebviewBounce";
import { syncAndroidSoftInputForCurrentPage } from "@/utils/androidSoftInput";
import { bindNvueChatHost } from "@/utils/nvueChatHost";
import { useInboxWsStore } from "@/stores/inboxWs";
import { useLimitedOfferStore } from "@/stores/limitedOffer";

let appWasBackground = false;
/** 进入后台的时间戳；过短的 hide/show 不记热启动（iOS 调试常抖） */
let appHiddenAt = 0;
const HOT_LAUNCH_MIN_BG_MS = 3000;

onLaunch(() => {
  setupPageTouchLock();
  // #ifndef APP-ANDROID
  lockWebviewBounce();
  // #endif
  bindNvueChatHost();
  const chat = useChatStore();
  const theme = useThemeStore();
  theme.applyTheme();
  // UI 语言切换时，WS 侧需带上新 lang
  watch(
    () => i18n.global.locale.value,
    () => chat.onLanguageChanged()
  );

  setupGlobalButtonTracking();
  // 核对打包环境：后端 Body.app_env / Firebase test_ 前缀都看这个
  logAppEnvOnce();
  // Firebase Analytics：App 冷启动初始化（需自定义基座/云打包；H5 为空操作）
  // 登录成功埋点见：pages/login/account.vue、pages/login/index.vue（trackLoginSuccess）
  configureFirebaseAnalytics();
  trackProductEvent(PRODUCT_EVENTS.APP_LAUNCH, { launch_type: "cold" });

  // 增长归因：首次启动 install + ATT/GAID（需云打包含 trands-attribution 插件）
  void runGrowthAttributionOnLaunch();

  // 启动页为 pages.json 第一项；每次冷启短暂展示后进入登录/首页
  const pages = getCurrentPages();
  const route = pages[0]?.route || "";
  const publicRoutes = ["pages/splash/index", "pages/login/index", "pages/register/index"];
  if (!isLoggedIn() && !publicRoutes.some((r) => route.includes(r))) {
    // 首次启动由 splash 作为 pages.json 第一项处理
  }

  trackCurrentPageIfChanged();
  setupPushIfLoggedIn();
  // 已登录冷启动：开始 dree_message_0 在线计时
  if (isLoggedIn()) startForegroundDree0Timer();

  // 已登录：建立 Messages 未读长连接 /ws/inbox
  if (isLoggedIn()) {
    try {
      useInboxWsStore().ensureConnected();
    } catch {
      /* ignore */
    }
    // 已选性别才同步限时优惠（未选性别时留给「选完性别」首次 GET）
    if (hasUserGender()) {
      try {
        useLimitedOfferStore().onTabPageShow();
      } catch {
        /* ignore */
      }
    }
  }

  try {
    uni.onNetworkStatusChange((res) => {
      useChatStore().onNetworkStatusChange(res);
    });
  } catch {
    /* ignore */
  }
});

onShow(() => {
  setupPageTouchLock();
  const bgMs = appHiddenAt ? Date.now() - appHiddenAt : 0;
  const likelyKeyboard = appWasBackground && bgMs > 0 && bgMs < 800;
  // 安卓弹键盘会误触发 App onHide/onShow。Manna 回前台不改 WebView/窗口，所以 Vue input 能住。
  if (likelyKeyboard) {
    appWasBackground = false;
    appHiddenAt = 0;
    return;
  }
  // #ifndef APP-ANDROID
  lockWebviewBounce();
  // #endif
  if (appWasBackground) {
    if (bgMs >= HOT_LAUNCH_MIN_BG_MS) {
      trackProductEvent(PRODUCT_EVENTS.APP_LAUNCH, {
        launch_type: "hot",
        bg_ms: String(bgMs),
      });
    }
  }
  appWasBackground = false;
  appHiddenAt = 0;
  // #ifndef APP-ANDROID
  syncAndroidSoftInputForCurrentPage();
  // #endif
  useChatStore().reloadForCurrentUser();
  useChatStore().onAppShow();
  const theme = useThemeStore();
  theme.syncNativePageBackground();
  theme.syncStatusBarStyle();
  trackCurrentPageIfChanged();
  setupPushIfLoggedIn();
  void retryPendingInstallReport();
  if (isLoggedIn()) {
    startForegroundDree0Timer();
    if (hasUserGender()) {
      try {
        useLimitedOfferStore().onTabPageShow();
      } catch {
        /* ignore */
      }
    }
  }
});

onHide(() => {
  appWasBackground = true;
  appHiddenAt = Date.now();
  pauseForegroundDree0Timer();
  void flushAnalyticsQueue();
});
</script>

<style lang="scss">
/* #ifndef APP-NVUE */
@import "@/static/styles/theme.scss";
@import "@/static/styles/ui.scss";
@import 'uview-plus/index.scss';
/* #endif */
</style>

<template>
  <!-- 勿放占位 view：H5 上可能叠在页面上方拦截点击/输入 -->
</template>
