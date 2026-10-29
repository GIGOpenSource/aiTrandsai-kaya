/**
 * @file analytics.js
 * @description 埋点上报：队列聚合后优先走 `/api/analytics/batch`（一次 HTTP + 服务端一次事务）。
 * 刻意不走 apiFetch，避免未登录/401 触发 toast 或跳转登录。
 *
 * 传输策略（按优先级）：
 * 1. POST /batch — 主路径，满批/定时 flush
 * 2. H5 退后台：sendBeacon(/batch) — 页面关闭仍尽量送达
 * 3. batch 失败时回退逐条 /page-view、/button-click（兼容旧后端）
 *
 * @depends i18n、device.getDeviceId
 * @usedBy App.vue、各页面按钮
 */

import { i18n } from "@/i18n";
import { getDeviceId, getClientHeaders } from "@/utils/device";
import { getAuthHeaders } from "@/utils/authHeaders";
import { getApiBase } from "@/utils/api";
import { APP_KEY } from "@/utils/appKey";

const ANALYTICS_API = "/api/analytics";
const API_BASE = getApiBase();

/** 队列满多少条立即 flush */
const BATCH_SIZE = 10;
/** 最长等待多久 flush（ms） */
const FLUSH_INTERVAL_MS = 5000;
/** 埋点请求超时（短，不阻塞业务） */
const ANALYTICS_TIMEOUT_MS = 4000;
/** 单次上报最多条数（与后端 MAX_BATCH_EVENTS 对齐，留余量） */
const MAX_FLUSH_EVENTS = 50;

/** 后端接受的语言码白名单 */
const ANALYTICS_LANG_CODES = ["zh", "en", "ja", "ko", "pt", "es", "id", "ar", "fa", "ru", "bg", "tr"];

/**
 * @typedef {{ type: 'page_view'|'button_click', page_path?: string, page_name?: string, button_id?: string, button_name?: string, device_id: string, language: string }} AnalyticsEvent
 */

/** @type {AnalyticsEvent[]} */
const queue = [];
let flushTimer = null;
let flushing = false;
let lifecycleBound = false;
/** batch 接口不可用时永久回退到单条（跨刷新持久化，避免反复 POST 405 刷控制台） */
const BATCH_UNSUPPORTED_KEY = "analytics_batch_unsupported";
let batchUnsupported = false;
try {
  // #ifdef H5
  if (typeof sessionStorage !== "undefined") {
    batchUnsupported = sessionStorage.getItem(BATCH_UNSUPPORTED_KEY) === "1";
  }
  // #endif
} catch {
  /* ignore */
}

function markBatchUnsupported() {
  batchUnsupported = true;
  try {
    // #ifdef H5
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(BATCH_UNSUPPORTED_KEY, "1");
    }
    // #endif
  } catch {
    /* ignore */
  }
}

/** 当前 UI 语言（归一到白名单，否则 en） */
function getCurrentLanguage() {
  const raw = (i18n.global.locale.value || "en").split("-")[0].toLowerCase();
  return ANALYTICS_LANG_CODES.includes(raw) ? raw : "en";
}

/** 拼埋点 URL：有 VITE_API_BASE_URL 则绝对路径，否则相对（H5 代理） */
function analyticsUrl(path) {
  if (path.startsWith("http")) return path;
  if (API_BASE) return `${API_BASE}${path}`;
  return path;
}

/** 文档约定 page_path（稳定路由，不带 query） */
const ANALYTICS_PAGE_BY_ROUTE = {
  "pages/home/index": { path: "/home", name: "首页" },
  "pages/discover/index": { path: "/discover", name: "发现" },
  "pages-sub/moment/index": { path: "/moments", name: "朋友圈" },
  "pages-sub/post/index": { path: "/moments", name: "朋友圈" },
  "pages-sub/my-posts/index": { path: "/moments", name: "朋友圈" },
  "pages/chat/index": { path: "/chat", name: "聊天" },
  "pages-sub/my-companions/index": { path: "/companions", name: "智能体列表" },
  "pages-sub/companion/index": { path: "/companion_detail", name: "智能体详情" },
  "pages/profile/index": { path: "/profile", name: "个人中心" },
  "pages/login/index": { path: "/login", name: "登录" },
  "pages/login/account": { path: "/login", name: "登录" },
  "pages/register/index": { path: "/register", name: "注册" },
  "pages/register/step": { path: "/register", name: "注册" },
};

const ANALYTICS_PAGE_BY_PATH = {
  "/home": "首页",
  "/discover": "发现",
  "/moments": "朋友圈",
  "/chat": "聊天",
  "/companions": "智能体列表",
  "/companion_detail": "智能体详情",
  "/benefits": "充值/会员",
  "/profile": "个人中心",
  "/login": "登录",
  "/register": "注册",
};

const SKIP_PAGE_ROUTES = new Set(["pages/splash/index"]);

const EXTRA_PAGE_NAMES = {
  "/messages": "消息",
  "/create": "创建智能体",
  "/create-post": "发帖",
  "/feedback": "反馈",
  "/bills": "账单",
  "/intimacy": "亲密度",
  "/settings": "设置",
  "/notifications": "通知",
  "/notification-settings": "通知设置",
  "/onboarding": "引导",
};

/** 文档约定 button_id；旧 id 在此映射，后台才能对上 */
const BUTTON_ALIASES = {
  "chat-send": { id: "chat_send", name: "发送" },
  "login-submit": { id: "login", name: "登录" },
  "register-submit": { id: "register", name: "注册" },
  "home-moment-like": { id: "like", name: "点赞" },
  "discover-post-like": { id: "like", name: "点赞" },
  "home-moment-comment": { id: "comment", name: "评论" },
  "discover-post-comment": { id: "comment", name: "评论" },
  "home-send-comment": { id: "comment", name: "评论" },
  "home-create-companion": { id: "companion_create", name: "创建智能体" },
  "messages-create-companion": { id: "companion_create", name: "创建智能体" },
  "companion-profile-chat": { id: "chat_enter", name: "进入聊天" },
};

function normalizeRouteKey(uniPath) {
  return String(uniPath || "")
    .trim()
    .split("?")[0]
    .replace(/^\//, "");
}

/**
 * uni 路由 → 文档 page_path / page_name。启动页不上报。
 * @param {string} uniPath
 * @returns {{ path: string, name: string }|null}
 */
export function resolveAnalyticsPage(uniPath) {
  const raw = String(uniPath || "").trim();
  if (!raw) return null;
  if (raw.startsWith("/benefits")) {
    return { path: "/benefits", name: ANALYTICS_PAGE_BY_PATH["/benefits"] };
  }
  const key = normalizeRouteKey(raw);
  if (SKIP_PAGE_ROUTES.has(key)) return null;
  if (ANALYTICS_PAGE_BY_ROUTE[key]) return ANALYTICS_PAGE_BY_ROUTE[key];

  const asSpec = raw.startsWith("/") ? raw.split("?")[0] : `/${key}`;
  if (ANALYTICS_PAGE_BY_PATH[asSpec]) {
    return { path: asSpec, name: ANALYTICS_PAGE_BY_PATH[asSpec] };
  }

  let path = `/${key}`
    .replace(/^\/pages-sub\//, "/")
    .replace(/^\/pages\//, "/")
    .replace(/\/index$/, "");
  if (!path || path === "/") path = asSpec || "/unknown";
  return {
    path,
    name: EXTRA_PAGE_NAMES[path] || ANALYTICS_PAGE_BY_PATH[path] || path,
  };
}

function resolveButton(buttonId, buttonName) {
  const rawId = String(buttonId || "").trim();
  const alias = BUTTON_ALIASES[rawId];
  if (alias) {
    return { id: alias.id, name: buttonName || alias.name };
  }
  if (rawId.startsWith("messages-open-chat")) {
    return { id: "chat_enter", name: buttonName || "进入聊天" };
  }
  if (rawId.startsWith("my-companions-chat")) {
    return { id: "chat_enter", name: buttonName || "进入聊天" };
  }
  if (rawId.startsWith("home-companion-")) {
    return { id: "chat_enter", name: buttonName || "进入聊天" };
  }
  return { id: rawId, name: buttonName || rawId };
}

/** 当前路由 path，形如 /pages/home/index */
function getCurrentPagePath() {
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1];
  return cur?.route ? `/${cur.route}` : "";
}

function getCurrentAnalyticsPage() {
  return resolveAnalyticsPage(getCurrentPagePath());
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAnalyticsQueue();
  }, FLUSH_INTERVAL_MS);
}

/**
 * 入队一条埋点；满批立即 flush
 * @param {AnalyticsEvent} event
 */
function enqueueEvent(event) {
  ensureAnalyticsLifecycle();
  queue.push(event);
  if (queue.length >= BATCH_SIZE) {
    void flushAnalyticsQueue();
  } else {
    scheduleFlush();
  }
}

/**
 * uni.request Promise 封装（静默）
 * @param {string} url
 * @param {object} data
 * @returns {Promise<{ ok: boolean, status: number }>}
 */
function requestJson(url, data) {
  return new Promise((resolve) => {
    try {
      uni.request({
        url,
        method: "POST",
        header: {
          ...getClientHeaders(),
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        data,
        timeout: ANALYTICS_TIMEOUT_MS,
        success(res) {
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status });
        },
        fail: () => resolve({ ok: false, status: 0 }),
      });
    } catch {
      resolve({ ok: false, status: 0 });
    }
  });
}

/**
 * H5：sendBeacon 发 batch（页面隐藏/关闭时最稳）
 * @param {AnalyticsEvent[]} events
 * @returns {boolean} 是否已交出浏览器队列
 */
function trySendBeaconBatch(events) {
  // #ifdef H5
  try {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.sendBeacon !== "function"
    ) {
      return false;
    }
    const url = analyticsUrl(`${ANALYTICS_API}/batch`);
    const blob = new Blob([JSON.stringify({ events, app_key: APP_KEY })], {
      type: "application/json",
    });
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
  // #endif
  // #ifndef H5
  return false;
  // #endif
}

/**
 * 逐条回退（旧后端无 /batch 时）
 * @param {AnalyticsEvent[]} events
 */
async function flushLegacyOneByOne(events) {
  for (const ev of events) {
    if (ev.type === "page_view") {
      await requestJson(analyticsUrl(`${ANALYTICS_API}/page-view`), {
        page_path: ev.page_path,
        page_name: ev.page_name,
        device_id: ev.device_id,
        language: ev.language,
      });
    } else if (ev.type === "button_click") {
      await requestJson(analyticsUrl(`${ANALYTICS_API}/button-click`), {
        button_id: ev.button_id,
        button_name: ev.button_name,
        page_path: ev.page_path,
        device_id: ev.device_id,
        language: ev.language,
      });
    }
  }
}

/**
 * 冲刷队列：优先 batch，失败则回退单条
 * 导出供 App onHide 调用
 */
export async function flushAnalyticsQueue() {
  if (flushing) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!queue.length) return;
  flushing = true;
  try {
    while (queue.length) {
      const chunk = queue.splice(0, MAX_FLUSH_EVENTS);

      // 退后台：优先 Beacon（不阻塞卸载）
      // #ifdef H5
      try {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden" &&
          !batchUnsupported &&
          !getAuthHeaders()["x-token"] &&
          trySendBeaconBatch(chunk)
        ) {
          continue;
        }
      } catch {
        /* fallthrough */
      }
      // #endif

      if (!batchUnsupported) {
        const res = await requestJson(analyticsUrl(`${ANALYTICS_API}/batch`), {
          events: chunk,
        });
        if (res.ok) continue;
        // 404/405：后端未部署 batch，本会话改走 legacy
        if (res.status === 404 || res.status === 405) {
          markBatchUnsupported();
        } else if (res.status === 0) {
          // 网络失败：丢弃本批（埋点允许丢），避免无限重试拖垮设备
          continue;
        } else {
          // 其它错误也回退一次，保证尽量入库
          await flushLegacyOneByOne(chunk);
          continue;
        }
      }

      await flushLegacyOneByOne(chunk);
    }
  } finally {
    flushing = false;
    if (queue.length) scheduleFlush();
  }
}

/** 绑定退后台自动 flush（只绑一次） */
function ensureAnalyticsLifecycle() {
  if (lifecycleBound) return;
  lifecycleBound = true;
  try {
    uni.onAppHide(() => {
      void flushAnalyticsQueue();
    });
  } catch {
    /* ignore */
  }
  // #ifdef H5
  try {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          void flushAnalyticsQueue();
        }
      });
    }
  } catch {
    /* ignore */
  }
  // #endif
}

/** 页面浏览 */
export function trackPageView(pagePath, pageName) {
  const resolved = resolveAnalyticsPage(pagePath);
  if (!resolved) return;
  enqueueEvent({
    type: "page_view",
    page_path: resolved.path,
    page_name: pageName || resolved.name,
    device_id: getDeviceId(),
    language: getCurrentLanguage(),
  });
}

/** 充值/会员弹窗（不是独立路由，文档 page_path=/benefits） */
export function trackBenefitsPageView() {
  trackPageView("/benefits", "充值/会员");
}

/** 按钮点击 */
export function trackButtonClick(buttonId, buttonName, pagePath) {
  const btn = resolveButton(buttonId, buttonName);
  if (!btn.id) return;
  const page = pagePath
    ? resolveAnalyticsPage(pagePath)
    : getCurrentAnalyticsPage();
  enqueueEvent({
    type: "button_click",
    button_id: btn.id,
    button_name: btn.name,
    page_path: page?.path || "/unknown",
    device_id: getDeviceId(),
    language: getCurrentLanguage(),
  });
}

export function getPageName(path) {
  return resolveAnalyticsPage(path)?.name || path;
}

/** 上次已上报的文档 page_path，避免同一页 onShow 连打 */
let lastTrackedRoute = "";

export function trackCurrentPageIfChanged() {
  const page = getCurrentAnalyticsPage();
  if (!page) return;
  if (page.path === lastTrackedRoute) return;
  lastTrackedRoute = page.path;
  trackPageView(page.path, page.name);
}

/**
 * 包装无参点击：先埋点再执行。
 * 模板用法：@tap="bindAnalyticsTap('id', handler, 'name')"
 * （Vue 点击时会调用本函数本身，因此这里直接执行，不再返回闭包）
 * 脚本里同样直接调用，不要再加一层 ()。
 */
export function bindAnalyticsTap(buttonId, handler, buttonName) {
  trackButtonClick(buttonId, buttonName || buttonId);
  handler?.();
}

/** 包装带参点击；buttonId/Name 可为函数 */
export function bindAnalyticsTapArg(buttonId, handler, buttonName) {
  return (arg) => {
    const id = typeof buttonId === "function" ? buttonId(arg) : buttonId;
    const name =
      typeof buttonName === "function"
        ? buttonName(arg)
        : buttonName || id;
    trackButtonClick(id, name);
    handler(arg);
  };
}

/** 仅埋点、无后续逻辑 */
export function tapAnalytics(buttonId, buttonName) {
  trackButtonClick(buttonId, buttonName || buttonId);
}

/**
 * H5：捕获带 data-analytics-button 属性的点击
 * App 端请用 bindAnalyticsTap / trackButtonClick
 */
export function setupGlobalButtonTracking() {
  ensureAnalyticsLifecycle();
  // #ifdef H5
  if (typeof document === "undefined") return;
  document.addEventListener("click", (e) => {
    const target = e.target;
    const trackable = target?.closest?.("[data-analytics-button]");
    if (!trackable) return;
    const buttonId = trackable.getAttribute("data-analytics-button") || "";
    const btnName = trackable.getAttribute("data-analytics-name") || buttonId;
    const pagePath = trackable.getAttribute("data-analytics-page") || getCurrentPagePath();
    if (buttonId) trackButtonClick(buttonId, btnName, pagePath);
  });
  // #endif
}
