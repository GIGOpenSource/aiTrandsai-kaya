/**
 * @file media.js
 * @description 媒体 URL 规范化与缩略图解析，供 Avatar/Moment 图片组件使用。
 * - 相对路径拼 origin（H5 当前站 / App 用 getApiBase）
 * - 旧版 /data/images/ 优先改写为 COS（运营机本地静态常已清空）
 * - localhost 映射，避免真机访问开发机 127.0.0.1 失败
 * - 过滤异常占位/源码路径，防裂图
 */
import { getApiBase } from "./api";

const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i;

const API_BASE = getApiBase();

/** 与后端 cos_storage 默认公网桶一致；可用 VITE_COS_IMAGE_BASE 覆盖 */
const DEFAULT_COS_IMAGE_BASE =
  "https://trandsai-1256118830.cos.ap-bangkok.myqcloud.com/images";

export function getCosImageBase() {
  return (
    (import.meta.env.VITE_COS_IMAGE_BASE || "").trim().replace(/\/$/, "") ||
    DEFAULT_COS_IMAGE_BASE
  );
}

/**
 * 媒体 URL 拼接用的站点 origin。
 * - H5 开发：空 VITE_API_BASE_URL 时用当前页面 origin（走 Vite 代理）
 * - App / 生产：用 VITE_API_BASE_URL 或生产域名
 */
export function getMediaOrigin() {
  // #ifdef H5
  if (!API_BASE && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  // #endif
  if (API_BASE) return API_BASE;
  // #ifdef H5
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  // #endif
  return "https://www.trandsai.com";
}

/** 从 /data/images/xxx.png（或含该 path 的 URL）取出文件名 */
export function dataImagesFilename(src) {
  if (!src) return "";
  try {
    const path = /^https?:\/\//i.test(src) ? new URL(src).pathname : src;
    const m = String(path).match(/^\/data\/images\/([^/]+)$/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

/** 旧本地路径 → COS 公网地址（文件若未上传仍会 404，由组件兜底） */
export function cosUrlForDataImage(src) {
  const name = dataImagesFilename(src);
  if (!name) return undefined;
  return `${getCosImageBase()}/${name}`;
}

/** 仍走站点 / Vite 代理的本地静态路径（本地后端有文件时的回退） */
export function localDataImageUrl(src) {
  const name = dataImagesFilename(src);
  if (!name) return undefined;
  return `${getMediaOrigin()}/data/images/${name}`;
}

/**
 * H5 `<img crossorigin>` 兼容占位；uni-app 图片组件无需 CORS 属性，恒返回 undefined。
 * @param {string} [_url]
 * @returns {undefined}
 */
export function imageCrossOriginForUrl(_url) {
  return undefined;
}

/**
 * 统一处理后端返回的媒体 URL：
 * - 兼容相对路径（/data/images/... 或 data/images/...）
 * - 将 localhost 地址映射为当前站点，避免线上/手机端访问 localhost 失败
 */
export function normalizeMediaUrl(src) {
  if (!src) return undefined;
  const trimmed = src.trim();
  if (!trimmed) return undefined;

  if (
    !trimmed ||
    trimmed === "__GENERATING__" ||
    trimmed.includes("__GENERATING__") ||
    trimmed.includes("/src/") ||
    trimmed.includes("main.tsx") ||
    trimmed.includes("?t=") ||
    /\.(tsx?|jsx?|js|map|json|md|py|html|css|ts|log)$/i.test(trimmed) ||
    trimmed.includes("placeholder") ||
    // 测试/脏数据占位域名（discover 帖子里偶发 https://xxx/1.jpg）
    /^https?:\/\/xxx(\/|$)/i.test(trimmed) ||
    (trimmed.includes("picsum.photos") && trimmed.length < 30)
    // (trimmed.startsWith("http") && trimmed.includes("x.ai")) 
  ) {
    // 已知脏数据静默兜底，避免刷屏；其它异常仍打 warn 便于排查
    const knownJunk = /^https?:\/\/xxx(\/|$)/i.test(trimmed) ||
      trimmed.includes("__GENERATING__") ||
      trimmed.includes("placeholder");
    if (!knownJunk) {
      console.warn("[Image Guard] 检测到无效/异常图片地址，使用 fallback:", trimmed);
    }
    return undefined;
  }

  const origin = getMediaOrigin();

  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    // #ifdef H5
    if (typeof window !== "undefined" && window.location?.protocol) {
      return `${window.location.protocol}${trimmed}`;
    }
    // #endif
    return `https:${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const isLocalHost = LOCAL_HOST_RE.test(trimmed);
    let isSameHost = false;
    try {
      const parsed = new URL(trimmed);
      // #ifdef H5
      if (typeof window !== "undefined" && window.location?.hostname) {
        isSameHost = parsed.hostname === window.location.hostname;
      }
      // #endif
      if (!isSameHost && API_BASE) {
        try {
          isSameHost = parsed.origin === new URL(API_BASE).origin;
        } catch {
          /* ignore */
        }
      }
      // 同源/本地绝对地址里的旧 /data/images → COS
      if (isLocalHost || isSameHost) {
        const cos = cosUrlForDataImage(parsed.pathname);
        if (cos) return cos;
        return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      isSameHost = false;
    }
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    const cos = cosUrlForDataImage(trimmed);
    if (cos) return cos;
    return `${origin}${trimmed}`;
  }

  return `${origin}/${trimmed}`;
}

/**
 * N-07：列表/头像优先用缩略图。
 */
export function resolveThumbUrl(
  src,
  maxEdge = 400
) {
  const full = normalizeMediaUrl(src);
  if (!full) return undefined;
  if (full.startsWith("data:") || full.startsWith("blob:")) return full;
  if (full.includes("_thumb.")) return full;

  const origin = getMediaOrigin();

  try {
    const u = new URL(full, origin);
    const path = u.pathname;
    if (/\.(svg)$/i.test(path)) return full;

    const parts = path.split("/");
    const name = parts.pop() || "";
    const stem = name.replace(/\.[^.]+$/, "");
    if (!stem) return full;
    parts.push(`${stem}_thumb.webp`);
    u.pathname = parts.join("/");
    return u.toString();
  } catch {
    return full;
  }
}

/**
 * 系统级全屏预览：仅图片 / 左右切换 / 关闭，不叠业务顶栏与 Tab。
 * @param {string|string[]|undefined|null} urls
 * @param {string|number} [current] 当前图 URL，或 urls 下标
 */
export function previewMedia(urls, current) {
  const list = (Array.isArray(urls) ? urls : [urls])
    .map((u) => {
      if (!u) return "";
      const n = normalizeMediaUrl(u);
      if (n) return n;
      return typeof u === "string" ? u.trim() : "";
    })
    .filter(Boolean);
  if (!list.length) return;

  let currentIndex = 0;
  if (typeof current === "number" && current >= 0 && current < list.length) {
    currentIndex = current;
  } else if (typeof current === "string" && current.trim()) {
    const n = normalizeMediaUrl(current) || current.trim();
    const idx = list.indexOf(n);
    currentIndex = idx >= 0 ? idx : 0;
  }

  const currentUrl = list[currentIndex];

  // H5 / App：current 同时传 URL（规范）与下标兜底，避免字符串不完全一致导致空白
  uni.previewImage({
    urls: list,
    current: currentUrl,
    fail: (err) => {
      console.warn("[previewMedia] fail, retry with index:", err);
      uni.previewImage({
        urls: list,
        current: currentIndex,
        fail: (err2) => {
          console.warn("[previewMedia] retry fail:", err2);
        },
      });
    },
  });
}
