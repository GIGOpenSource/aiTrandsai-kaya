/**
 * @file api.js
 * @description 统一 HTTP API 客户端（uni-app 版）
 *
 * 设计目标（对齐本目录架构）：
 * 1. 与 React `client/src/app/utils/api.ts` 契约一致（路径、401、toast）
 * 2. 底层使用 `uni.request`，适配 H5 / App，不依赖 `window.fetch`
 * 3. 鉴权头委托 `authHeaders.js`；本地清 token 委托 `storage.js`
 * 4. Toast 委托 `stores/toast.js`，避免在 utils 里直接操作 UI 细节
 * 5. 文件上传走 `device.js` 的 `uni.uploadFile`，本文件的 `api.upload`
 *    仅用于 H5 FormData 场景；App 端请优先 `uploadImage`
 *
 * 调用约定（uni 风格，全项目统一）：
 * - options.header  — 请求头（不是 fetch 的 headers）
 * - options.data    — 请求体（对象会 JSON.stringify；字符串原样发送）
 * - options.method  — GET / POST / PUT / DELETE …
 *
 * 导出：
 * - apiFetch / default — 需登录的业务请求，成功返回 JSON/data
 * - rawFetch           — 登录/注册专用，返回 { ok, status, data }，不触发 401 跳转
 * - api / apiUpload    — get/post/put/delete/upload 便捷封装
 */

import { removeItem } from "./storage";
import { getAuthHeaders } from "./authHeaders";
import { getClientHeaders } from "./device";
import { showToast } from "../stores/toast";
import i18n from "@/i18n";

/**
 * API 根地址：优先 VITE_API_BASE_URL。
 * 为空时 H5 用相对路径走 Vite 代理；App 回退生产域名。
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

/**
 * 获取 API 根地址（供其他工具模块统一使用）。
 * 必须是纯函数：api.js ↔ device.js 循环引用时，不能读尚未初始化的 const。
 * @returns {string}
 */
export function getApiBase() {
  return resolveApiBase();
}
/** 业务 REST 默认超时（ms）；弱网尽快失败，避免挂死连接与 loading */
const DEFAULT_TIMEOUT_MS = 15000;
/** 登录/注册可稍长 */
const AUTH_TIMEOUT_MS = 20000;

/**
 * 拼接完整 URL：绝对地址原样返回，相对路径加 API_BASE
 * @param {string} url
 * @returns {string}
 */
function buildUrl(url) {
  const apiBase = getApiBase();
  if (!url) return apiBase || "/";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${apiBase}${path}`;
}

/**
 * 合并请求头：默认认证头 + 调用方 header；非 FormData 时补 Content-Type
 * @param {Record<string, string>} [extra]
 * @param {boolean} skipJsonContentType
 */
function mergeHeaders(extra = {}, skipJsonContentType = false, omitHeaders = []) {
  const header = {
    ...getClientHeaders(),
    "Accept-Language": i18n.global.locale.value,
    ...getAuthHeaders(),
    ...extra,
  };
  for (const key of omitHeaders) {
    delete header[key];
  }
  if (!skipJsonContentType && !header["Content-Type"] && !header["content-type"]) {
    header["Content-Type"] = "application/json";
  }
  return header;
}

/**
 * 规范化请求体：对象 → JSON 字符串；已是字符串则原样；无体则 undefined
 * @param {*} data
 */
function normalizeData(data) {
  if (data == null) return undefined;
  if (typeof data === "string") return data;
  // H5 FormData：交由运行时处理（部分端需走 uploadFile，见 device.js）
  if (typeof FormData !== "undefined" && data instanceof FormData) return data;
  return JSON.stringify(data);
}

/**
 * 登录过期：清本地态并回登录页（与 React 版 window.location=/login 等价）
 */
function handle401() {
  removeItem("user_token");
  removeItem("user_info");
  showToast(i18n.global.t("recharge.loginExpired"));
  uni.reLaunch({ url: "/pages/login/index" });
}

/**
 * 非 2xx / 包装错误的统一处理：401 清登录，402 拉起充值，429 限流，5xx/网络走 i18n。
 * @param {Error} error
 * @param {number} status
 */
function applyStatusErrorHandling(error, status) {
  if (status === 401) {
    handle401();
    return;
  }
  if (status === 402) {
    try {
      const detail =
        error?.detail && typeof error.detail === "object"
          ? error.detail
          : error?.body && typeof error.body === "object"
            ? error.body.detail && typeof error.body.detail === "object"
              ? error.body.detail
              : error.body
            : {};
      uni.$emit("chat-paywall", {
        type: detail.type === "need_vip" ? "need_vip" : "need_recharge",
        reason: detail.reason || "credits_insufficient",
        balance: detail.balance,
        accepted: detail.accepted === true,
        send_status: detail.send_status || "",
        messages: Array.isArray(detail.messages) ? detail.messages : [],
        companionId: detail.companion_id || detail.companionId || "",
        detail: error.detail,
        ts: Date.now(),
      });
    } catch {
      /* ignore */
    }
    showToast(i18n.global.t("recharge.insufficientPoints"));
    return;
  }
  if (status === 403) {
    const blob = `${JSON.stringify(error?.body || {})} ${error?.message || ""}`;
    const code = String(
      error?.body?.error_code || error?.body?.code || error?.detail?.error_code || ""
    );
    if (
      code === "guest_cannot_pay" ||
      /guest_cannot_pay|临时登录无法支付/.test(blob)
    ) {
      showToast(i18n.global.t("login.guestCannotPay"));
      return;
    }
  }
  if (status === 429) {
    showToast(i18n.global.t("common.tooManyRequests"));
    return;
  }
  if (status >= 500) {
    showToast(i18n.global.t("common.serverError"));
    return;
  }
  showToast(formatErrorToast(error) || i18n.global.t("common.requestFailed"));
}

/** 后端文案里的 {max}/{cost} 在 App 端不会自动替换 */
function formatErrorToast(error) {
  let s = String(error?.message || "");
  const src = {
    ...(typeof error?.body === "object" && error.body ? error.body : {}),
    ...(typeof error?.detail === "object" && error.detail ? error.detail : {}),
  };
  const vars = {
    max: src.max_agents ?? src.max ?? src.results?.max_agents,
    cost: src.cost,
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v == null || v === "") continue;
    s = s.split("{" + k + "}").join(String(v));
  }
  return s;
}

/**
 * 从 uni.request 成功回调里解析错误详情
 * @param {*} data
 * @param {number} status
 */
function pickErrorDetail(data, status) {
  if (data == null) return `HTTP ${status}`;
  if (typeof data === "string") return data;
  return data.detail || data.message || data.error || `HTTP ${status}`;
}

/**
 * 业务请求：自动带 token，失败 toast，401 跳登录
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.header]
 * @param {*} [options.data]  请求体（对象或 JSON 字符串）
 * @param {number} [options.timeout] 超时 ms，默认 15000
 * @returns {Promise<*>} 成功时一般为 JSON body；非 JSON 时返回完整 res
 */
export function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const rawData = options.data;
  const isFormData =
    typeof FormData !== "undefined" && rawData instanceof FormData;
  const header = mergeHeaders(options.header || {}, isFormData, options.omitHeaders || []);
  const data = normalizeData(rawData);
  const fullUrl = buildUrl(url);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method,
      header,
      data,
      timeout,
      success(res) {
        const status = res.statusCode || 0;

        // 2xx：优先返回解析后的 JSON
        if (status >= 200 && status < 300) {
          const ct =
            res.header?.["content-type"] ||
            res.header?.["Content-Type"] ||
            "";
          let body = res.data;
          if (
            typeof body !== "object" ||
            body === null
          ) {
            if (typeof body === "string") {
              try {
                body = JSON.parse(body);
              } catch {
                /* keep string */
              }
            }
          } else if (
            typeof ct === "string" &&
            ct.includes("application/json") &&
            typeof body === "string"
          ) {
            try {
              body = JSON.parse(body);
            } catch {
              /* keep */
            }
          }

          // HTTP 200 但业务失败：{ error/detail } 或 { code: 400, message }
          // 460 = 朋友圈评论达上限，交给页面弹引导私聊，不当普通失败 toast
          const bizCode = Number(body?.code);
          if (bizCode === 460 || body?.results?.error_code === "comment_limit_reached") {
            resolve(body);
            return;
          }
          if (
            body &&
            typeof body === "object" &&
            body.ok !== true &&
            (body.error || body.detail || bizCode === 400) &&
            body.id == null &&
            body.token == null
          ) {
            const msg = pickErrorDetail(body, status);
            const error = new Error(msg);
            error.status = Number(body.status_code) || (bizCode === 400 ? 400 : status);
            error.detail = body.detail || body.error || body.message;
            error.body = body;
            // 仅当 body.status_code 明确为 401/402/429 时走对应专用分支，否则统一按普通错误处理
            // 避免 HTTP 2xx 下的消息关键词（如"权限"）误触发 401 跳转、清 token
            if (error.status === 401) {
              handle401();
            } else if (error.status === 402 || error.status === 429) {
              applyStatusErrorHandling(error, error.status);
            } else {
              showToast(formatErrorToast(error) || i18n.global.t("common.requestFailed"));
            }
            reject(error);
            return;
          }

          resolve(body);
          return;
        }

        // 非 2xx：构造带 status/detail 的 Error，供页面按状态分支
        const errorData = res.data || {};
        const error = new Error(pickErrorDetail(errorData, status));
        error.status = status;
        error.detail =
          typeof errorData === "object" ? errorData.detail : undefined;
        error.body = typeof errorData === "object" ? errorData : undefined;

        if (status === 460) {
          reject(error);
          return;
        }
        applyStatusErrorHandling(error, status);
        reject(error);
      },
      fail(err) {
        console.error("网络错误:", err);
        showToast(i18n.global.t("common.networkError"));
        reject(new Error(i18n.global.t("common.networkError")));
      },
    });
  });
}

/**
 * 标准化业务请求（新接口统一返回 { ok, message, ... }）：
 * - 自动带 token、401 跳转、网络错误 toast 等逻辑与 apiFetch 一致
 * - 2xx 且 body.ok === false 时，取 message 提示并 reject
 * - 成功时返回完整 body，页面可自行读取 message / data
 *
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<*>}
 */
export function standardFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const rawData = options.data;
  const isFormData =
    typeof FormData !== "undefined" && rawData instanceof FormData;
  const header = mergeHeaders(options.header || {}, isFormData);
  const data = normalizeData(rawData);
  const fullUrl = buildUrl(url);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method,
      header,
      data,
      timeout,
      success(res) {
        const status = res.statusCode || 0;
        let body = res.data;
        if (typeof body !== "object" || body === null) {
          if (typeof body === "string") {
            try {
              body = JSON.parse(body);
            } catch {
              /* keep string */
            }
          }
        }

        if (status >= 200 && status < 300) {
          const bizCode = Number(body?.code);
          if (
            body &&
            typeof body === "object" &&
            (body.ok === false || bizCode === 400)
          ) {
            const msg =
              body.message ||
              body.detail ||
              body.error ||
              i18n.global.t("common.requestFailed");
            const error = new Error(msg);
            error.status = Number(body.status_code) || (bizCode === 400 ? 400 : status);
            error.body = body;
            error.detail = body.detail || body.error || body.message;
            applyStatusErrorHandling(error, error.status);
            reject(error);
            return;
          }
          resolve(body);
          return;
        }

        const errorData = body || {};
        const msg = pickErrorDetail(errorData, status);
        const error = new Error(msg);
        error.status = status;
        error.detail =
          typeof errorData === "object" ? errorData.detail : undefined;

        applyStatusErrorHandling(error, status);
        reject(error);
      },
      fail(err) {
        console.error("网络错误:", err);
        showToast(i18n.global.t("common.networkError"));
        reject(new Error(i18n.global.t("common.networkError")));
      },
    });
  });
}

/**
 * 标准化请求便捷方法
 */
export const standardApi = {
  get(url, options = {}) {
    return standardFetch(url, { ...options, method: "GET" });
  },
  post(url, data, options = {}) {
    return standardFetch(url, { ...options, method: "POST", data });
  },
  put(url, data, options = {}) {
    return standardFetch(url, { ...options, method: "PUT", data });
  },
  delete(url, options = {}) {
    return standardFetch(url, { ...options, method: "DELETE" });
  },
};

/**
 * 未认证请求（登录/注册）：
 * - 不注入业务失败 toast（由页面展示表单错误）
 * - 不因 401 清 token / 跳转（避免登录页死循环）
 * - 返回形态接近 fetch Response：{ ok, status, data }
 *
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, status: number, data: * }>}
 */
export function rawFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const rawData = options.data;
  const isFormData =
    typeof FormData !== "undefined" && rawData instanceof FormData;
  const header = {
    ...getClientHeaders(),
    "Accept-Language": i18n.global.locale.value,
    ...(options.header || {}),
  };
  if (!isFormData && !header["Content-Type"] && !header["content-type"]) {
    header["Content-Type"] = "application/json";
  }
  const data = normalizeData(rawData);
  const fullUrl = buildUrl(url);
  const timeout = options.timeout ?? AUTH_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method,
      header,
      data,
      timeout,
      success(res) {
        const status = res.statusCode || 0;
        let body = res.data;
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch {
            /* 保持字符串 */
          }
        }
        resolve({
          ok: status >= 200 && status < 300,
          status,
          data: body,
        });
      },
      fail(err) {
        console.error("[rawFetch] 请求失败:", fullUrl, err);
        reject(err);
      },
    });
  });
}

/**
 * 解包后端统一成功体：{ ok, message, results } → results
 *（兼容个别接口仍用 data）
 * @param {*} body
 * @returns {*}
 */
export function unwrapApiResults(body) {
  if (!body || typeof body !== "object") return body;
  if (body.results != null) return body.results;
  if (body.data != null) return body.data;
  return body;
}

/**
 * 便捷方法：与 React `api` 对象同名同语义，参数适配 uni `data`
 */
export const api = {
  /** GET */
  get(url, options = {}) {
    return apiFetch(url, { ...options, method: "GET" });
  },

  /** POST JSON（data 为对象） */
  post(url, data, options = {}) {
    return apiFetch(url, { ...options, method: "POST", data });
  },

  /** PUT JSON */
  put(url, data, options = {}) {
    return apiFetch(url, { ...options, method: "PUT", data });
  },

  /** DELETE */
  delete(url, options = {}) {
    return apiFetch(url, { ...options, method: "DELETE" });
  },

  /**
   * H5 FormData 上传；App 端图片请用 `@/utils/device` 的 uploadImage
   */
  upload(url, formData, options = {}) {
    return apiFetch(url, {
      ...options,
      method: "POST",
      data: formData,
      header: { ...(options.header || {}) },
    });
  },
};

/** 兼容旧导入名 */
export const apiUpload = api.upload;

export default apiFetch;
