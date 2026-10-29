/**
 * 安卓软键盘模式。
 * Manifest 是 adjustResize；退到后台再回来时系统会把窗口模式打回 Resize。
 * WebView 154 在 Resize 下聚焦会「弹一下键盘再失焦关掉」。
 * 首页等页 pages.json 写了 nothing，回前台必须再写回 Window。
 */
const NOTHING_ROUTES = [
  "pages/home/index",
  "pages-sub/moment/index",
  "pages-sub/post/index",
  "pages-sub/feedback/index",
];

function currentRoute() {
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const route = pages[pages.length - 1]?.route;
    return route ? String(route) : "";
  } catch {
    return "";
  }
}

function setAdjust(modeFlag) {
  // #ifdef APP-ANDROID
  try {
    const plusObj = typeof plus !== "undefined" ? plus : null;
    if (!plusObj?.android) return;
    const apply = () => {
      try {
        const WindowManager = plusObj.android.importClass(
          "android.view.WindowManager"
        );
        const lp = WindowManager.LayoutParams;
        const win = plusObj.android.runtimeMainActivity().getWindow();
        const cur = win.getAttributes().softInputMode;
        const next = (cur & ~lp.SOFT_INPUT_MASK_ADJUST) | modeFlag;
        if (cur === next) return;
        win.setSoftInputMode(next);
      } catch {
        /* ignore */
      }
    };
    if (typeof plusObj.ready === "function") plusObj.ready(apply);
    else apply();
  } catch {
    /* ignore */
  }
  // #endif
}

/** 反馈等页进页立刻锁 nothing，避免上一页的 resize 还在，JS 再垫一层就变成两个键盘高 */
export function lockAndroidAdjustNothing() {
  // #ifdef APP-ANDROID
  try {
    const plusObj = typeof plus !== "undefined" ? plus : null;
    if (!plusObj?.android) return;
    const WindowManager = plusObj.android.importClass(
      "android.view.WindowManager"
    );
    setAdjust(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
  } catch {
    /* ignore */
  }
  // #endif
}

/** 反馈页：锁 resize，顶栏留在压矮后的页面顶，不要 pan（顶栏会滑走） */
export function lockPageSoftinputResize() {
  // #ifdef APP-ANDROID
  try {
    const plusObj = typeof plus !== "undefined" ? plus : null;
    if (!plusObj?.android) return;
    const WindowManager = plusObj.android.importClass(
      "android.view.WindowManager"
    );
    setAdjust(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
  } catch {
    /* ignore */
  }
  // #endif
  // #ifdef APP-PLUS
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const page = pages[pages.length - 1];
    const wv =
      (typeof page?.$getAppWebview === "function" && page.$getAppWebview()) ||
      (typeof plus !== "undefined" && plus.webview?.currentWebview?.());
    if (wv && typeof wv.setStyle === "function") {
      wv.setStyle({ softinputMode: "adjustResize" });
    }
  } catch {
    /* ignore */
  }
  // #endif
}

/** 窗口 + 当前 WebView 都写成 nothing（pages.json 自定义基座里可能还是旧配置） */
export function lockPageSoftinputNothing() {
  lockAndroidAdjustNothing();
  // #ifdef APP-PLUS
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const page = pages[pages.length - 1];
    const wv =
      (typeof page?.$getAppWebview === "function" && page.$getAppWebview()) ||
      (typeof plus !== "undefined" && plus.webview?.currentWebview?.());
    if (wv && typeof wv.setStyle === "function") {
      wv.setStyle({ softinputMode: "nothing" });
    }
  } catch {
    /* ignore */
  }
  // #endif
}

/** 按当前页把软键盘模式写回 nothing / resize */
export function syncAndroidSoftInputForCurrentPage() {
  // #ifdef APP-ANDROID
  try {
    const plusObj = typeof plus !== "undefined" ? plus : null;
    if (!plusObj?.android) return;
    const WindowManager = plusObj.android.importClass(
      "android.view.WindowManager"
    );
    const lp = WindowManager.LayoutParams;
    const route = currentRoute();
    const nothing = NOTHING_ROUTES.some((r) => route === r || route.endsWith(r));
    setAdjust(nothing ? lp.SOFT_INPUT_ADJUST_NOTHING : lp.SOFT_INPUT_ADJUST_RESIZE);
  } catch {
    /* ignore */
  }
  // #endif
}
