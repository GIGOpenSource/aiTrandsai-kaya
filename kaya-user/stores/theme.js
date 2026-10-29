/**
 * @file theme.js
 * @description 明/暗主题。H5 写 data-theme 到 documentElement；App 依赖 CSS 变量。
 * 本地键：theme = "dark" | "light"
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { getItem, setItem } from "@/utils/storage";
import {
  getCurrentRoute,
  isTransparentOverlayRoute,
} from "@/utils/overlayWebview";

/** 主题 Store：初始化时 applyTheme，切换时持久化 */
export const useThemeStore = defineStore("theme", () => {
  const theme = ref(getItem("theme") || "dark");

  const appliedNativeBg = new Map();

  function nativeBgKey() {
    try {
      const route = getCurrentRoute();
      if (route) return route;
    } catch {
      /* ignore */
    }
    return "app";
  }

  /**
   * App 原生窗口底色（iOS 键盘四周会露出这块）。
   * 安卓禁止 WebView.setStyle / 改 DecorView：弹键盘时会整页闪黑，还会失焦。
   * 透明叠层页（充值/限时优惠）绝不能刷成主题黑底，否则盖住下层 nvue 聊天。
   */
  function syncNativePageBackground(force = false) {
    const route = getCurrentRoute();
    if (isTransparentOverlayRoute(route)) return;

    const color = theme.value === "light" ? "#f5f5f5" : "#0a0a0a";
    const key = nativeBgKey();
    if (!force && appliedNativeBg.get(key) === color) return;
    appliedNativeBg.set(key, color);
    try {
      uni.setBackgroundColor({
        backgroundColor: color,
        backgroundColorTop: color,
        backgroundColorBottom: color,
      });
    } catch {
      /* ignore */
    }
    try {
      const plusObj = typeof plus !== "undefined" ? plus : null;
      if (!plusObj?.webview) return;
      // #ifdef APP-ANDROID
      return;
      // #endif
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const page = pages[pages.length - 1];
      const wv =
        (typeof page?.$getAppWebview === "function" && page.$getAppWebview()) ||
        plusObj.webview.currentWebview();
      if (!wv?.setStyle) return;
      wv.setStyle({ background: color });
      const parent = typeof wv.parent === "function" ? wv.parent() : null;
      if (parent?.setStyle) parent.setStyle({ background: color });
    } catch {
      /* ignore */
    }
  }

  /**
   * 系统状态栏时间/电量颜色：深色底用浅字，浅色底用深字。
   * 必须在主题切换时立刻改，否则会一直沿用 pages.json 的白色字。
   */
  let lastStatusBarSync = "";

  function syncStatusBarStyle() {
    // #ifndef H5
    const barStyle = theme.value === "dark" ? "light" : "dark";
    const key = `${theme.value}|${barStyle}`;
    if (lastStatusBarSync === key) return;
    lastStatusBarSync = key;
    try {
      uni.setNavigationBarColor({
        frontColor: theme.value === "dark" ? "#ffffff" : "#000000",
        backgroundColor: theme.value === "dark" ? "#0a0a0a" : "#f5f5f5",
      });
    } catch {
      /* ignore */
    }
    try {
      const plusObj = typeof plus !== "undefined" ? plus : null;
      if (!plusObj?.navigator?.setStatusBarStyle) return;
      plusObj.navigator.setStatusBarStyle(barStyle);
    } catch {
      /* ignore */
    }
    // #endif
  }

  /** 将当前 theme 同步到 DOM；同时写 data-theme 与 .theme-light/.theme-dark */
  function applyTheme() {
    // 仅在 H5 环境操作 DOM，APP/小程序环境不支持 document
    if (typeof document !== 'undefined' && document.documentElement) {
      const el = document.documentElement;
      el.setAttribute("data-theme", theme.value);
      el.classList.toggle("dark", theme.value === "dark");
      el.classList.toggle("theme-light", theme.value === "light");
      el.classList.toggle("theme-dark", theme.value === "dark");
    }
    syncNativePageBackground();
    syncStatusBarStyle();
  }

  /** 在 dark / light 间切换并写入本地 */
  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    setItem("theme", theme.value);
    applyTheme();
  }

  const isDark = computed(() => theme.value === "dark");

  applyTheme();

  return {
    theme,
    isDark,
    toggleTheme,
    applyTheme,
    syncNativePageBackground,
    syncStatusBarStyle,
  };
});