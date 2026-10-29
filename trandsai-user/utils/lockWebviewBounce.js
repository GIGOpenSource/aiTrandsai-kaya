/**
 * 锁住 iOS WebView 整页橡皮筋（标题被拽下来露出黑缝）。
 * pages.json bounce:none 热更新无效；必须运行时 setStyle + 原生 bounces=NO + 拦住 page 的 touchmove。
 */

function currentWebview() {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const page = pages[pages.length - 1];
  const tries = [
    () => (typeof page?.$getAppWebview === "function" ? page.$getAppWebview() : null),
    () => page?.$vm?.$scope?.$getAppWebview?.(),
    () => page?.$vm?.$getAppWebview?.(),
    () => plus.webview.currentWebview(),
    () => plus.webview.getTopWebview?.(),
  ];
  for (const get of tries) {
    try {
      const wv = get();
      if (wv) return wv;
    } catch {
      /* next */
    }
  }
  return null;
}

function iosRead(obj, key) {
  if (!obj) return null;
  try {
    const v = plus.ios.invoke(obj, key);
    if (v != null) return v;
  } catch {
    /* ignore */
  }
  try {
    return plus.ios.invoke(obj, "valueForKey:", key);
  } catch {
    return null;
  }
}

function lockOneScrollView(view) {
  if (!view) return;
  try {
    plus.ios.invoke(view, "setBounces:", false);
  } catch {
    /* not UIScrollView */
  }
  try {
    plus.ios.invoke(view, "setAlwaysBounceVertical:", false);
  } catch {
    /* ignore */
  }
}

function lockIosScrollTree(view, depth, budget) {
  if (!view || depth > 8 || budget.count > 24) return;
  budget.count += 1;
  lockOneScrollView(view);
  const nested = iosRead(view, "scrollView");
  if (nested && nested !== view) lockOneScrollView(nested);
  // 只关 WebView 自己的橡皮筋，不要递归进业务 scroll-view
}

function lockNativeIosBounce(wv) {
  try {
    if (String(plus.os.name || "").toLowerCase() !== "ios") return;
    try {
      plus.ios.importClass("WKWebView");
    } catch {
      /* ignore */
    }
    try {
      plus.ios.importClass("UIScrollView");
    } catch {
      /* ignore */
    }
    const nativeObj =
      typeof wv.nativeInstanceObject === "function"
        ? wv.nativeInstanceObject()
        : null;
    if (nativeObj) lockIosScrollTree(nativeObj, 0, { count: 0 });
  } catch {
    /* ignore */
  }
}

const bounceStyledIds = new Set();

function webviewKey(wv) {
  if (!wv) return "";
  if (wv.id != null && String(wv.id) !== "") return String(wv.id);
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const route = pages[pages.length - 1]?.route;
    if (route) return String(route);
  } catch {
    /* ignore */
  }
  return "current";
}

function applyBounceNone(wv) {
  if (!wv) return;
  const key = webviewKey(wv);
  // 同一 WebView 反复 setStyle 会把安卓输入焦点打掉，所有页键盘都会闪
  if (!bounceStyledIds.has(key)) {
    try {
      wv.setStyle?.({ bounce: "none", scalable: false });
      bounceStyledIds.add(key);
    } catch {
      /* ignore */
    }
  }
  lockNativeIosBounce(wv);
}

function lockAllWebviews() {
  applyBounceNone(currentWebview());
}

/**
 * 锁定当前页（及所有 WebView）的 iOS 回弹。
 */
export function lockWebviewBounce() {
  // #ifdef APP-PLUS
  try {
    if (typeof plus === "undefined" || !plus.webview) return;
    if (typeof plus.ready === "function") {
      plus.ready(lockAllWebviews);
    } else {
      lockAllWebviews();
    }
  } catch {
    /* ignore */
  }
  // #endif
}

let touchLockInstalled = false;

function isInsideScrollView(target) {
  let el = target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.nodeType === 1) {
      const tag = String(el.tagName || "").toLowerCase();
      const cls = String(el.className?.baseVal || el.className || "");
      if (
        tag === "uni-scroll-view" ||
        tag === "scroll-view" ||
        cls.includes("uni-scroll-view") ||
        el.getAttribute?.("scroll-y") != null ||
        el.getAttribute?.("scroll-x") != null
      ) {
        return true;
      }
    }
    el = el.parentNode;
  }
  return false;
}

/**
 * 拦住 WebView 自己吃掉的 touchmove（顶栏、空白处下拉）。
 * 只在 H5 用；App 端 document.preventDefault 会误伤 native scroll-view。
 */
export function setupPageTouchLock() {
  if (touchLockInstalled) return;
  // #ifdef APP-PLUS
  return;
  // #endif
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
    return;
  }
  touchLockInstalled = true;
  document.addEventListener(
    "touchmove",
    (e) => {
      if (isInsideScrollView(e.target)) return;
      if (typeof e.preventDefault === "function") e.preventDefault();
    },
    { passive: false }
  );
}
