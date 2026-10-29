/**
 * @file overlayWebview.js
 * @description App 透明叠层页（充值 / 限时优惠等）：
 * 1) 全局 theme.scss 把 page/body 刷成 --bg(#0a0a0a)，必须在页面里用 page 选择器盖成透明
 * 2) 主题 syncNativePageBackground 也会刷原生底，叠层路由需跳过并在此强制透明
 */

export const OVERLAY_ROUTE_SUFFIXES = [
  "pages-sub/recharge/index",
  "pages-sub/limited-offer/index",
  "pages-sub/report-character/index",
];

export function isTransparentOverlayRoute(route = "") {
  const r = String(route || "");
  return OVERLAY_ROUTE_SUFFIXES.some(
    (s) => r === s || r.endsWith(s) || r.includes(s)
  );
}

export function getCurrentRoute() {
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    return String(pages[pages.length - 1]?.route || "");
  } catch {
    return "";
  }
}

/**
 * 把当前页原生窗口 / WebView 背景设为透明；短延迟再刷一次，压过 App.onShow 的主题同步。
 */
export function enableTransparentOverlayWebview() {
  // #ifdef APP-PLUS
  const apply = () => {
    try {
      uni.setBackgroundColor({
        backgroundColor: "#00000000",
        backgroundColorTop: "#00000000",
        backgroundColorBottom: "#00000000",
      });
    } catch {
      /* ignore */
    }
    try {
      const plusObj = typeof plus !== "undefined" ? plus : null;
      if (!plusObj?.webview) return;
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const page = pages[pages.length - 1];
      const wv =
        (typeof page?.$getAppWebview === "function" && page.$getAppWebview()) ||
        plusObj.webview.currentWebview();
      if (!wv?.setStyle) return;
      // 含 Android：叠层页必须透明，不能跟 theme 一样禁 setStyle
      wv.setStyle({
        background: "transparent",
        opacity: 1,
        popGesture: "close",
      });
      const parent = typeof wv.parent === "function" ? wv.parent() : null;
      if (parent?.setStyle) {
        parent.setStyle({ background: "transparent" });
      }
    } catch {
      /* ignore */
    }
  };

  apply();
  setTimeout(apply, 50);
  setTimeout(apply, 200);
  // #endif
}
