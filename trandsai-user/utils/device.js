/**
 * @file device.js
 * @description 设备标识与图片上传（App/H5 统一走 uni API）。
 *
 * 分层说明：
 * - getDeviceId / getClientHeaders：匿名互动、增长归因、全局 API Header
 * - uploadImage / chooseAndUploadImages：multipart 上传，不走 apiFetch
 *
 * @depends storage.js
 * @related api.js（JSON REST）、media.js（URL 规范化）
 */

import { getItem, setItem } from "./storage";
import i18n from "@/i18n";
import { APP_KEY } from "./appKey";

/**
 * 与 api.js 相同的 API 根。不从 api.js 引用，避免 api ↔ device 循环初始化。
 * @returns {string}
 */
function resolveApiBase() {
  let fromEnv = "";
  try {
    fromEnv = String(import.meta.env?.VITE_API_BASE_URL || "").trim();
  } catch {
    /* ignore */
  }
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // #ifdef H5
  return "";
  // #endif
  return "https://www.trandsai.com";
}
const API_BASE = resolveApiBase();

/** 启动后缓存的商店国家（Alpha-2），供同步 Header 使用 */
let cachedStorefrontCountry = "";

/**
 * 读不到系统版本时的兜底，需与 manifest.json versionName 保持一致。
 * H5 / 极早启动阶段 getSystemInfo 可能拿不到 appVersion。
 */
const APP_VERSION_FALLBACK = "1.7.4";

/**
 * 规范成后端可识别的版本号：去空白、去前导 v/V
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeAppVersion(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^[vV]/, "");
  return s;
}

/**
 * 当前包版本（如 1.7.4），供 Header / WS query 统一使用。
 * 优先级：plus.runtime.version → appWgtVersion → appVersion → 兜底常量
 * @returns {string}
 */
export function getAppVersion() {
  try {
    // App 真机：plus.runtime.version 与商店包 versionName 一致，比 getSystemInfo 更稳
    if (typeof plus !== "undefined" && plus.runtime?.version) {
      const v = normalizeAppVersion(plus.runtime.version);
      if (v) return v;
    }
  } catch {
    /* ignore */
  }
  try {
    const info = uni.getSystemInfoSync?.() || {};
    const v = normalizeAppVersion(info.appWgtVersion || info.appVersion);
    if (v) return v;
  } catch {
    /* ignore */
  }
  return APP_VERSION_FALLBACK;
}

/**
 * 拼接上传地址
 * @param {string} url
 * @returns {string}
 */
function buildUrl(url) {
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function generateDeviceId() {
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 获取或生成持久化设备 ID（≤64 字符，卸载前不变）
 * @returns {string}
 */
export function getDeviceId() {
  let id = getItem("device_id");
  if (!id) {
    id = generateDeviceId();
    setItem("device_id", id);
  }
  return String(id).slice(0, 64);
}

/** @param {string} country Alpha-2 */
export function setCachedStorefrontCountry(country) {
  cachedStorefrontCountry = String(country || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

/**
 * 读取 App / 系统元信息，供增长归因与全局 Header
 * @returns {{
 *   appVersion: string,
 *   os: string,
 *   osVersion: string,
 *   deviceModel: string,
 *   timezone: string,
 *   locale: string,
 *   storefrontCountry: string,
 * }}
 */
export function getAppMeta() {
  const appVersion = getAppVersion();
  let os = "web";
  let osVersion = "";
  let deviceModel = "";
  let timezone = "";
  let locale = "";

  try {
    const info = uni.getSystemInfoSync();
    const platform = String(info.platform || info.osName || "unknown").toLowerCase();
    if (platform === "ios" || platform === "android") {
      os = platform;
    } else {
      os = "web";
    }
    osVersion = String(info.osVersion || info.system || "").trim();
    deviceModel = String(info.model || info.deviceModel || "").trim();
  } catch {
    /* ignore */
  }

  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* ignore */
  }

  try {
    locale = String(i18n.global.locale.value || "en");
  } catch {
    locale = "en";
  }

  return {
    appVersion,
    os,
    osVersion,
    deviceModel,
    timezone,
    locale,
    storefrontCountry: cachedStorefrontCountry,
  };
}

/**
 * 全局 HTTP Header（P0：X-Device-Id、X-App-Key 等；与后端 growth / 马甲文档对齐）
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string>}
 */
export function getClientHeaders(extra = {}) {
  const meta = getAppMeta();
  const deviceId = getDeviceId();
  const headers = {
    "X-App-Key": APP_KEY,
    "X-Device-Id": deviceId,
    "x-device-id": deviceId,
    "Accept-Language": meta.locale || "en",
    // 聊天版本提示词等依赖此头；始终带上，避免空串被后端当未传
    "X-App-Version": meta.appVersion || APP_VERSION_FALLBACK,
  };
  if (meta.os) headers["X-OS"] = meta.os;
  if (meta.osVersion) headers["X-OS-Version"] = meta.osVersion;
  if (meta.deviceModel) headers["X-Device-Model"] = meta.deviceModel;
  if (meta.timezone) {
    headers["X-Timezone"] = meta.timezone;
    headers["x-timezone"] = meta.timezone;
  }
  if (cachedStorefrontCountry) {
    headers["X-Storefront-Country"] = cachedStorefrontCountry;
  }
  return { ...headers, ...extra };
}

/**
 * 返回带 x-device-id / x-timezone 的请求头对象（兼容旧调用）
 * @returns {{ "X-App-Key": string, "x-device-id": string, "X-App-Version": string, "x-timezone"?: string }}
 */
export function deviceHeaders() {
  const headers = getClientHeaders();
  const out = {
    "X-App-Key": headers["X-App-Key"],
    "x-device-id": headers["X-Device-Id"],
    "X-App-Version": headers["X-App-Version"],
  };
  if (headers["X-Timezone"]) out["x-timezone"] = headers["X-Timezone"];
  return out;
}

/** 原图（尤其 HEIC / 相册 content://）在 App 上较大，拉长超时 */
const UPLOAD_TIMEOUT_MS = 120000;
/** 超过该体积再降一点质量，避免网关 413 */
const LARGE_ORIGINAL_BYTES = 8 * 1024 * 1024;
/** iOS 原图边长过大时压到这个长边，HEIC 才能稳妥转成 jpg */
const MAX_UPLOAD_EDGE = 1920;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errText(err) {
  return String(err?.errMsg || err?.message || err || "");
}

/** 用户关掉相册 / 点取消，不要当上传失败 */
export function isChooseImageCancel(err) {
  return /cancel|取消/i.test(errText(err));
}

function isChooseImageAuthIssue(err) {
  return /auth|denied|permission|authorize|权限|隐私/i.test(errText(err));
}

function guessUploadFileName(filePath) {
  const raw = String(filePath || "").split("?")[0];
  const base = raw.split("/").pop() || "image.jpg";
  if (/\.(heic|heif)$/i.test(base)) {
    return base.replace(/\.(heic|heif)$/i, ".jpg");
  }
  if (/\.(jpe?g|png|webp|gif)$/i.test(base)) return base;
  return "image.jpg";
}

function stripFileScheme(filePath) {
  return String(filePath || "").replace(/^file:\/\//i, "");
}

/** getImageInfo / compressImage 在部分机型上要 file:// */
function toUniMediaPath(filePath) {
  const s = String(filePath || "").trim();
  if (!s) return s;
  if (
    s.startsWith("file://") ||
    s.startsWith("content://") ||
    s.startsWith("blob:") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("_doc") ||
    s.startsWith("_www") ||
    s.startsWith("_downloads")
  ) {
    return s;
  }
  if (s.startsWith("/")) return `file://${s}`;
  return s;
}

/** uploadFile 用绝对路径时不要带 file://，否则 Android 上可能一直不回调 */
function toUniUploadPath(filePath) {
  const s = String(filePath || "").trim();
  if (!s) return s;
  if (
    s.startsWith("content://") ||
    s.startsWith("blob:") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("_doc") ||
    s.startsWith("_www") ||
    s.startsWith("_downloads")
  ) {
    return s;
  }
  return stripFileScheme(s);
}

function withTimeout(promise, ms, label) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label || "op"} timeout`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function readLocalFileSize(filePath) {
  return new Promise((resolve) => {
    if (!filePath || typeof uni.getFileInfo !== "function") {
      resolve(0);
      return;
    }
    uni.getFileInfo({
      filePath: toUniUploadPath(filePath),
      success: (info) => resolve(Number(info.size) || 0),
      fail: () => {
        // 再试 file://
        uni.getFileInfo({
          filePath: toUniMediaPath(filePath),
          success: (info) => resolve(Number(info.size) || 0),
          fail: () => resolve(0),
        });
      },
    });
  });
}

/** 相册刚关掉时临时文件有时还没落盘，等可读再压/传 */
async function waitForReadableFile(filePath, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const size = await readLocalFileSize(filePath);
    if (size > 0) return size;
    await delay(80);
  }
  return 0;
}

function getImageInfo(src) {
  return new Promise((resolve) => {
    if (!src || typeof uni.getImageInfo !== "function") {
      resolve(null);
      return;
    }
    uni.getImageInfo({
      src: toUniMediaPath(src),
      success: (info) => resolve(info || null),
      fail: () => resolve(null),
    });
  });
}

function compressToJpeg(filePath, quality, maxSide = 0) {
  return new Promise((resolve, reject) => {
    if (typeof uni.compressImage !== "function") {
      resolve(toUniUploadPath(filePath));
      return;
    }
    const opts = { src: toUniMediaPath(filePath), quality };
    if (maxSide > 0) opts.compressedWidth = maxSide;
    uni.compressImage({
      ...opts,
      success: (res) => {
        const out = res.tempFilePath;
        if (out) resolve(out);
        else reject(new Error("compress empty"));
      },
      fail: reject,
    });
  });
}

/**
 * App 相册路径 / HEIC 不能直接 uploadFile，先转成可读 jpg。
 * 大图压长边，避免 iOS 原图体积把上传打挂。
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function prepareImageForUpload(filePath) {
  // #ifdef H5
  return Promise.resolve(filePath);
  // #endif
  return (async () => {
    const uploadPath = toUniUploadPath(filePath);
    // Photo Picker 已落到 cache，再 compress 容易卡死；直接上传
    if (/\/uni_pick_[^/]+\.(jpe?g|png|webp|bin)$/i.test(uploadPath)) {
      return uploadPath;
    }
    const size = await waitForReadableFile(uploadPath);
    let info = null;
    try {
      info = await withTimeout(getImageInfo(uploadPath), 3000, "getImageInfo");
    } catch {
      info = null;
    }
    const longEdge = Math.max(Number(info?.width) || 0, Number(info?.height) || 0);
    const needScale = longEdge > MAX_UPLOAD_EDGE || size > LARGE_ORIGINAL_BYTES;
    const quality = needScale ? 80 : 85;
    const maxSide = needScale ? MAX_UPLOAD_EDGE : 0;
    try {
      const out = await withTimeout(
        compressToJpeg(uploadPath, quality, maxSide),
        8000,
        "compress"
      );
      return toUniUploadPath(out);
    } catch {
      await delay(240);
      try {
        const out = await withTimeout(
          compressToJpeg(uploadPath, 70, MAX_UPLOAD_EDGE),
          8000,
          "compress-retry"
        );
        return toUniUploadPath(out);
      } catch {
        return uploadPath;
      }
    }
  })();
}

function parseUploadBody(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function uploadErrText(err) {
  if (!err) return "upload failed";
  if (typeof err === "string") return err;
  const msg = err.errMsg || err.message || err.msg;
  if (msg) return String(msg);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function buildUploadHeaders() {
  const token = getItem("user_token");
  // 上传头尽量精简：过多自定义头在部分 Android WebView/WAF 下会导致连不上（statusCode: null）
  const base = getClientHeaders();
  const header = {
    "X-App-Key": base["X-App-Key"],
    "x-device-id": base["x-device-id"] || base["X-Device-Id"],
  };
  if (base["X-App-Version"]) header["X-App-Version"] = base["X-App-Version"];
  if (base["X-OS"]) header["X-OS"] = base["X-OS"];
  if (base["Accept-Language"]) header["Accept-Language"] = base["Accept-Language"];
  if (token) header["x-token"] = token;
  return header;
}

/** 把绝对路径 / cache 文件拷进 _doc，uni.uploadFile / plus.uploader 更稳 */
function copyToDocUploadPath(filePath) {
  return new Promise((resolve) => {
    const raw = toUniUploadPath(filePath);
    if (!raw) {
      resolve(filePath);
      return;
    }
    if (
      raw.startsWith("_doc/") ||
      raw.startsWith("_www/") ||
      raw.startsWith("_downloads/")
    ) {
      resolve(raw);
      return;
    }
    if (typeof plus === "undefined" || !plus.io) {
      resolve(raw);
      return;
    }
    const srcUrl = raw.startsWith("file://")
      ? raw
      : raw.startsWith("/")
        ? `file://${raw}`
        : raw;
    const destName = `uni_up_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`;
    plus.io.resolveLocalFileSystemURL(
      srcUrl,
      (entry) => {
        plus.io.resolveLocalFileSystemURL(
          "_doc/",
          (doc) => {
            entry.copyTo(
              doc,
              destName,
              () => {
                const out = `_doc/${destName}`;
                androidLog(`copy _doc ok ${out}`);
                resolve(out);
              },
              (e) => {
                androidLog(`copy _doc fail ${uploadErrText(e)}`);
                resolve(raw);
              }
            );
          },
          () => resolve(raw)
        );
      },
      (e) => {
        androidLog(`resolve src fail ${uploadErrText(e)}`);
        resolve(raw);
      }
    );
  });
}

function resolveUploadLocalUrl(filePath) {
  const raw = toUniUploadPath(filePath);
  if (!raw) return raw;
  try {
    if (typeof plus !== "undefined" && plus.io?.convertLocalFileSystemURL) {
      if (raw.startsWith("_doc") || raw.startsWith("_www") || raw.startsWith("_downloads")) {
        const abs = plus.io.convertLocalFileSystemURL(raw);
        if (abs) return String(abs);
      }
    }
  } catch {
    /* ignore */
  }
  if (raw.startsWith("/")) return `file://${raw}`;
  return raw;
}

function finalizeUploadResponse(status, bodyRaw, rejectEmpty = true) {
  const data = parseUploadBody(bodyRaw);
  const code = Number(status) || 0;
  if (code && (code < 200 || code >= 300)) {
    const msg =
      data?.detail || data?.error || data?.message || `upload failed (${code})`;
    throw new Error(msg);
  }
  if (data?.url) return data;
  if (!rejectEmpty && !code) return null;
  throw new Error(data?.detail || "upload failed");
}

function postImageFileUni(localPath) {
  const header = buildUploadHeaders();
  const filePath = toUniUploadPath(localPath);
  const url = buildUrl("/api/upload/image");
  return new Promise((resolve, reject) => {
    androidLog(`uni.upload path=${String(filePath).slice(-80)}`);
    uni.uploadFile({
      url,
      filePath,
      name: "file",
      timeout: UPLOAD_TIMEOUT_MS,
      header,
      success(res) {
        try {
          androidLog(`uni.upload status=${res.statusCode}`);
          resolve(finalizeUploadResponse(res.statusCode, res.data));
        } catch (e) {
          reject(e);
        }
      },
      fail(err) {
        reject(new Error(uploadErrText(err) || "uni.uploadFile fail"));
      },
    });
  });
}

function postImageFilePlus(localPath) {
  if (typeof plus === "undefined" || !plus.uploader) {
    return Promise.reject(new Error("plus.uploader unavailable"));
  }
  const header = buildUploadHeaders();
  const url = buildUrl("/api/upload/image");
  const fileUrl = resolveUploadLocalUrl(localPath);
  const fileName = guessUploadFileName(localPath);
  return new Promise((resolve, reject) => {
    androidLog(`plus.upload path=${String(fileUrl).slice(-80)}`);
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const task = plus.uploader.createUpload(
      url,
      { method: "POST", timeout: Math.ceil(UPLOAD_TIMEOUT_MS / 1000) },
      (t, status) => {
        try {
          androidLog(
            `plus.upload status=${status} body=${String(t?.responseText || "").slice(0, 100)}`
          );
          done(resolve, finalizeUploadResponse(status, t?.responseText));
        } catch (e) {
          done(reject, e);
        }
      }
    );
    try {
      Object.keys(header).forEach((k) => {
        if (header[k] != null && header[k] !== "") {
          task.setRequestHeader(k, String(header[k]));
        }
      });
      const added = task.addFile(fileUrl, { key: "file", name: fileName });
      if (added === false) {
        done(reject, new Error("plus addFile failed"));
        return;
      }
      task.start();
    } catch (e) {
      done(reject, e instanceof Error ? e : new Error(uploadErrText(e)));
    }
  });
}

async function postImageFile(localPath) {
  const docPath = await copyToDocUploadPath(localPath);
  const candidates = [];
  const push = (p) => {
    if (p && candidates.indexOf(p) < 0) candidates.push(p);
  };
  push(docPath);
  push(toUniUploadPath(localPath));
  push(resolveUploadLocalUrl(docPath));

  let lastErr = null;
  // Android：先 plus.uploader（对 file:// / _doc 更稳），再 uni.uploadFile
  const usePlusFirst =
    typeof plus !== "undefined" && !!plus.uploader && isAndroidApp();

  for (const path of candidates) {
    const methods = usePlusFirst
      ? [postImageFilePlus, postImageFileUni]
      : [postImageFileUni, postImageFilePlus];
    for (const method of methods) {
      try {
        return await method(path);
      } catch (e) {
        lastErr = e;
        androidLog(`upload try fail ${method.name}: ${uploadErrText(e)}`);
      }
    }
  }
  throw lastErr || new Error("upload failed");
}

/**
 * 上传单张本地图片到 `/api/upload/image`
 * App 首次从相册返回时偶发文件未就绪，失败自动再试一次。
 * @param {string} filePath uni.chooseImage 返回的临时路径
 * @returns {Promise<{ url: string }>}
 */
export async function uploadImage(filePath) {
  androidLog(`upload start ${String(filePath || "").slice(-96)}`);
  androidLog(`upload url=${buildUrl("/api/upload/image")} token=${getItem("user_token") ? 1 : 0}`);
  const localPath = await prepareImageForUpload(filePath);
  androidLog(`upload prepared ${String(localPath || "").slice(-96)}`);
  try {
    const data = await postImageFile(localPath);
    androidLog(`upload ok ${String(data?.url || "").slice(0, 96)}`);
    return data;
  } catch (e) {
    androidLog(`upload fail1 ${uploadErrText(e)}`);
    await delay(280);
    const retryPath = await prepareImageForUpload(filePath);
    try {
      const data = await postImageFile(retryPath);
      androidLog(`upload ok2 ${String(data?.url || "").slice(0, 96)}`);
      return data;
    } catch (e2) {
      androidLog(`upload fail2 ${uploadErrText(e2)}`);
      throw e2 instanceof Error ? e2 : new Error(uploadErrText(e2));
    }
  }
}

function pickFromChooseResult(res) {
  const paths = Array.isArray(res?.tempFilePaths) ? res.tempFilePaths.filter(Boolean) : [];
  if (paths.length) return paths;
  const files = Array.isArray(res?.tempFiles) ? res.tempFiles : [];
  return files
    .map((f) => f?.path || f?.tempFilePath || f?.filePath)
    .filter(Boolean);
}

function nativeChooseImage(count, options = {}) {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count,
      sizeType: options.sizeType || ["compressed", "original"],
      sourceType: options.sourceType || ["album", "camera"],
      success: (res) => {
        const paths = pickFromChooseResult(res);
        if (paths.length) resolve(paths);
        else reject({ errMsg: "chooseImage:fail empty" });
      },
      fail: reject,
    });
  });
}

function isAndroidApp() {
  try {
    if (typeof plus === "undefined" || !plus.android) return false;
    return String(uni.getSystemInfoSync?.()?.platform || "").toLowerCase() === "android";
  } catch {
    return false;
  }
}

function androidSdkInt() {
  try {
    const Build = plus.android.importClass("android.os.Build");
    return Number(Build.VERSION.SDK_INT) || 0;
  } catch {
    return 0;
  }
}

function requestAndroidPermissions(perms) {
  return new Promise((resolve) => {
    if (!perms?.length) {
      resolve();
      return;
    }
    try {
      plus.android.requestPermissions(
        perms,
        () => resolve(),
        () => resolve()
      );
    } catch {
      resolve();
    }
  });
}

function sourcePickLabels() {
  const loc = String(
    i18n?.global?.locale?.value || i18n?.global?.locale || "en"
  ).toLowerCase();
  if (loc.startsWith("zh")) return { album: "从相册选择", camera: "拍照" };
  if (loc.startsWith("ja")) return { album: "アルバムから選択", camera: "写真を撮る" };
  if (loc.startsWith("ko")) return { album: "앨범에서 선택", camera: "사진 촬영" };
  return { album: "Choose from Album", camera: "Take Photo" };
}

/** 先选相册/拍照，避免一上来就弹 CAMERA 权限 */
function resolvePickSource(sourceType) {
  const sources =
    Array.isArray(sourceType) && sourceType.length
      ? sourceType
      : ["album", "camera"];
  const wantAlbum = sources.indexOf("album") >= 0;
  const wantCamera = sources.indexOf("camera") >= 0;
  if (wantAlbum && wantCamera) {
    const labels = sourcePickLabels();
    return new Promise((resolve, reject) => {
      uni.showActionSheet({
        itemList: [labels.album, labels.camera],
        success: (res) => resolve(res.tapIndex === 1 ? "camera" : "album"),
        fail: () => reject({ errMsg: "chooseImage:fail cancel" }),
      });
    });
  }
  if (wantCamera && !wantAlbum) return Promise.resolve("camera");
  return Promise.resolve("album");
}

function androidLog(msg) {
  const text = String(msg || "");
  try {
    const Log = plus.android.importClass("android.util.Log");
    Log.e("TrandsPick", text);
  } catch {
    /* ignore */
  }
  try {
    console.log("[TrandsPick]", text);
  } catch {
    /* ignore */
  }
}

function androidFileReady(file) {
  try {
    return !!(file && file.exists() && Number(file.length()) > 0);
  } catch {
    return false;
  }
}

/**
 * Photo Picker content:// → 本地路径。
 * 禁止在 JS 里 while(read(buf))：多图时会把 JSBridge 卡死，表现为一直转圈。
 * 只走纯 Java 拷贝：FileUtils → NIO → Channel → Bitmap。
 */
function androidUriStringToCachePath(uriStr, opts = {}) {
  const Uri = plus.android.importClass("android.net.Uri");
  const uri = Uri.parse(String(uriStr || ""));
  const main = plus.android.runtimeMainActivity();
  const resolver = main.getContentResolver();
  plus.android.importClass(resolver);
  const File = plus.android.importClass("java.io.File");
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const errors = [];
  const maxEdge = Number(opts.maxEdge) > 0 ? Number(opts.maxEdge) : 1920;

  // 1) FileUtils.copy（API29+，读写全在 Java）
  if (androidSdkInt() >= 29) {
    try {
      const FileUtils = plus.android.importClass("android.os.FileUtils");
      const FileOutputStream = plus.android.importClass("java.io.FileOutputStream");
      const out = new File(main.getCacheDir(), `uni_pick_${stamp}.jpg`);
      const input = resolver.openInputStream(uri);
      if (!input) throw new Error("openInputStream empty");
      const fos = new FileOutputStream(out);
      try {
        FileUtils.copy(input, fos);
        fos.flush();
      } finally {
        try {
          fos.close();
        } catch {
          /* ignore */
        }
        try {
          input.close();
        } catch {
          /* ignore */
        }
      }
      if (!androidFileReady(out)) throw new Error("FileUtils copy empty");
      return String(out.getAbsolutePath()).replace(/^file:\/\//, "");
    } catch (e) {
      errors.push(`fileutils:${errText(e)}`);
    }
  }

  // 2) NIO Files.copy（InputStream 由 Java 读完）
  try {
    const Files = plus.android.importClass("java.nio.file.Files");
    const StandardCopyOption = plus.android.importClass(
      "java.nio.file.StandardCopyOption"
    );
    const out = new File(main.getCacheDir(), `uni_pick_${stamp}_nio.jpg`);
    const input = resolver.openInputStream(uri);
    if (!input) throw new Error("openInputStream empty");
    try {
      Files.copy(input, out.toPath(), StandardCopyOption.REPLACE_EXISTING);
    } finally {
      try {
        input.close();
      } catch {
        /* ignore */
      }
    }
    if (!androidFileReady(out)) throw new Error("nio copy empty");
    return String(out.getAbsolutePath()).replace(/^file:\/\//, "");
  } catch (e) {
    errors.push(`nio:${errText(e)}`);
  }

  // 3) FileChannel.transferTo
  try {
    const FileInputStream = plus.android.importClass("java.io.FileInputStream");
    const FileOutputStream = plus.android.importClass("java.io.FileOutputStream");
    const out = new File(main.getCacheDir(), `uni_pick_${stamp}_ch.jpg`);
    const pfd = resolver.openFileDescriptor(uri, "r");
    if (!pfd) throw new Error("openFileDescriptor empty");
    const fis = new FileInputStream(pfd.getFileDescriptor());
    const fos = new FileOutputStream(out);
    try {
      const inCh = fis.getChannel();
      const outCh = fos.getChannel();
      let size = 0;
      try {
        size = Number(inCh.size()) || 0;
      } catch {
        size = 0;
      }
      if (size <= 0) throw new Error("channel size 0");
      inCh.transferTo(0, size, outCh);
      fos.flush();
    } finally {
      try {
        fis.close();
      } catch {
        /* ignore */
      }
      try {
        fos.close();
      } catch {
        /* ignore */
      }
      try {
        pfd.close();
      } catch {
        /* ignore */
      }
    }
    if (!androidFileReady(out)) throw new Error("channel copy empty");
    return String(out.getAbsolutePath()).replace(/^file:\/\//, "");
  } catch (e) {
    errors.push(`channel:${errText(e)}`);
  }

  // 4) Bitmap 缩略转 jpg（兜底）
  try {
    const BitmapFactory = plus.android.importClass("android.graphics.BitmapFactory");
    const Bitmap = plus.android.importClass("android.graphics.Bitmap");
    const FileOutputStream = plus.android.importClass("java.io.FileOutputStream");
    const out = new File(main.getCacheDir(), `uni_pick_${stamp}_bm.jpg`);
    const bmpOpts = new BitmapFactory.Options();
    bmpOpts.inJustDecodeBounds = true;
    let input = resolver.openInputStream(uri);
    if (!input) throw new Error("openInputStream empty");
    BitmapFactory.decodeStream(input, null, bmpOpts);
    try {
      input.close();
    } catch {
      /* ignore */
    }
    let sample = 1;
    const longEdge = Math.max(Number(bmpOpts.outWidth) || 0, Number(bmpOpts.outHeight) || 0);
    while (longEdge / sample > maxEdge) sample *= 2;
    bmpOpts.inJustDecodeBounds = false;
    bmpOpts.inSampleSize = Math.max(1, sample);
    input = resolver.openInputStream(uri);
    if (!input) throw new Error("openInputStream empty");
    const bitmap = BitmapFactory.decodeStream(input, null, bmpOpts);
    try {
      input.close();
    } catch {
      /* ignore */
    }
    if (!bitmap) throw new Error("decode bitmap empty");
    const fos = new FileOutputStream(out);
    try {
      bitmap.compress(Bitmap.CompressFormat.JPEG, 85, fos);
      fos.flush();
    } finally {
      try {
        fos.close();
      } catch {
        /* ignore */
      }
      try {
        bitmap.recycle();
      } catch {
        /* ignore */
      }
    }
    if (!androidFileReady(out)) throw new Error("bitmap copy empty");
    return String(out.getAbsolutePath()).replace(/^file:\/\//, "");
  } catch (e) {
    errors.push(`bitmap:${errText(e)}`);
  }

  androidLog(`uri copy fail ${errors.join(" | ")}`);
  throw new Error(errors[0] || "uri copy failed");
}

function collectUriStringsFromIntentData(data) {
  const out = [];
  if (!data) return out;
  try {
    plus.android.importClass(data);
  } catch {
    /* ignore */
  }
  try {
    const clip = data.getClipData();
    if (clip) {
      plus.android.importClass(clip);
      const n = Number(clip.getItemCount()) || 0;
      for (let i = 0; i < n; i++) {
        const item = clip.getItemAt(i);
        if (!item) continue;
        try {
          plus.android.importClass(item);
        } catch {
          /* ignore */
        }
        const uri = item.getUri();
        if (uri) out.push(String(uri.toString()));
      }
    }
  } catch {
    /* ignore */
  }
  if (!out.length) {
    try {
      const uri = data.getData();
      if (uri) out.push(String(uri.toString()));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * Google Play 合规：Android 相册用系统 Photo Picker / OPEN_DOCUMENT，不申请 READ_MEDIA_*。
 * onActivityResult 里先回调 onPreparing（立刻转圈），再异步拷贝 URI。
 */
function chooseAndroidSystemImages(count, onPreparing) {
  const n = Math.max(1, Math.min(Number(count) || 1, 9));
  return new Promise((resolve, reject) => {
    try {
      const main = plus.android.runtimeMainActivity();
      plus.android.importClass(main);
      const Intent = plus.android.importClass("android.content.Intent");
      const sdk = androidSdkInt();
      const reqCode = 0x9517;
      const intent =
        sdk >= 33
          ? new Intent("android.provider.action.PICK_IMAGES")
          : new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.setType("image/*");
      if (sdk < 33) {
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      }
      if (n > 1) {
        if (sdk >= 33) {
          intent.putExtra("android.provider.extra.PICK_IMAGES_MAX", n);
        } else {
          intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
      }
      const prev = main.onActivityResult;
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        try {
          main.onActivityResult = prev;
        } catch {
          /* ignore */
        }
        fn(arg);
      };
      main.onActivityResult = function (requestCode, resultCode, data) {
        // 必须先处理自己的 requestCode；先调 prev 可能把 Intent data 消耗掉导致 empty uri
        if (Number(requestCode) === reqCode) {
          androidLog(`onActivityResult code=${resultCode} hasData=${!!data}`);
          if (Number(resultCode) !== -1 || !data) {
            finish(reject, { errMsg: "chooseImage:fail cancel" });
            return;
          }
          let uriStrs = [];
          try {
            uriStrs = collectUriStringsFromIntentData(data).slice(0, n);
          } catch (e) {
            androidLog(`collect uri fail ${errText(e)}`);
            finish(reject, e || { errMsg: "chooseImage:fail uri" });
            return;
          }
          androidLog(`uri count=${uriStrs.length} first=${uriStrs[0] || ""}`);
          if (!uriStrs.length) {
            finish(reject, { errMsg: "chooseImage:fail empty uri" });
            return;
          }
          // 先通知 UI 转圈，再拷贝，避免「选完半天没反应」
          try {
            if (typeof onPreparing === "function") onPreparing(uriStrs.length);
          } catch {
            /* ignore */
          }
          setTimeout(async () => {
            try {
              // 让出一帧，确保 loading 先画出来
              await delay(32);
              const paths = [];
              // 多图时压一点边长，Bitmap 兜底更快
              const maxEdge = uriStrs.length >= 4 ? 1600 : 1920;
              for (let i = 0; i < uriStrs.length; i++) {
                androidLog(`copy ${i + 1}/${uriStrs.length}`);
                try {
                  const p = androidUriStringToCachePath(uriStrs[i], { maxEdge });
                  if (p) paths.push(p);
                } catch (e) {
                  androidLog(`copy ${i + 1} fail ${errText(e)}`);
                }
                // 每张让出事件循环，避免 UI 假死
                await delay(0);
              }
              androidLog(`copied paths=${paths.length} p0=${paths[0] || ""}`);
              if (!paths.length) {
                finish(reject, { errMsg: "chooseImage:fail empty" });
                return;
              }
              finish(resolve, paths);
            } catch (e) {
              androidLog(`convert fail ${errText(e)}`);
              finish(reject, e || { errMsg: "chooseImage:fail convert" });
            }
          }, 0);
          return;
        }
        try {
          if (typeof prev === "function") prev.call(main, requestCode, resultCode, data);
        } catch {
          /* ignore */
        }
      };
      androidLog(`start picker sdk=${sdk} count=${n}`);
      main.startActivityForResult(intent, reqCode);
    } catch (e) {
      androidLog(`start fail ${errText(e)}`);
      reject(e || { errMsg: "chooseImage:fail" });
    }
  });
}

/**
 * 只选图、不上传。
 * - Android 相册：系统 Photo Picker（不申请 READ_MEDIA_*，过 Google 审核）
 * - Android 拍照：只申请 CAMERA + uni.chooseImage
 * - 其它端：保持 uni.chooseImage
 * @param {number} count
 * @param {{ sizeType?: string[], sourceType?: string[], onPreparing?: (count: number) => void }} [options]
 * @returns {Promise<string[]>}
 */
export async function chooseLocalImages(count, options = {}) {
  const n = Math.max(1, Math.min(Number(count) || 1, 9));
  const source = await resolvePickSource(options.sourceType);

  if (isAndroidApp()) {
    if (source === "camera") {
      await requestAndroidPermissions(["android.permission.CAMERA"]);
      const pickCamera = () =>
        nativeChooseImage(1, { ...options, sourceType: ["camera"] });
      try {
        return await pickCamera();
      } catch (err) {
        if (isChooseImageCancel(err)) throw err;
        await delay(isChooseImageAuthIssue(err) ? 480 : 280);
        return pickCamera();
      }
    }
    // 相册：合规 Photo Picker，绝不申请 READ_MEDIA_IMAGES
    return chooseAndroidSystemImages(n, options.onPreparing);
  }

  // 非 Android：沿用原 uni.chooseImage；低端 Android 以外不走这里
  if (source === "album" || source === "camera") {
    // iOS 等：相册无需我们申请 Android 那套权限
    const pick = () =>
      nativeChooseImage(n, { ...options, sourceType: [source] });
    try {
      return await pick();
    } catch (err) {
      if (isChooseImageCancel(err)) throw err;
      await delay(isChooseImageAuthIssue(err) ? 480 : 280);
      return pick();
    }
  }

  const pick = () => nativeChooseImage(n, options);
  try {
    return await pick();
  } catch (err) {
    if (isChooseImageCancel(err)) throw err;
    await delay(isChooseImageAuthIssue(err) ? 480 : 280);
    return pick();
  }
}

/**
 * 选图并逐张上传，返回远端 URL 列表
 * @param {number} [max=9]
 * @param {number} [existing=0]
 * @param {{ sizeType?: string[], sourceType?: string[], onPicked?: (paths: string[]) => void }} [options]
 * @returns {Promise<string[]>}
 */
export async function chooseAndUploadImages(max = 9, existing = 0, options = {}) {
  const count = Math.max(1, Math.min(max - existing, 9));
  const paths = await chooseLocalImages(count, options);
  if (typeof options.onPicked === "function") options.onPicked(paths);
  if (!paths.length) return [];
  const urls = [];
  for (const p of paths) {
    const data = await uploadImage(p);
    if (data.url) urls.push(data.url);
  }
  return urls;
}
