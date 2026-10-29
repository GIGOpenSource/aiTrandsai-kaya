/**
 * @file env.js
 * @description 应用环境（prod / test）。与 NODE_ENV 无关：本地跑基座也可能连生产 API。
 *
 * 通过 Vite 编译期注入：
 * - VITE_APP_ENV=prod | test  → 决定后端 Body.app_env、Firebase 事件名是否加 test_
 * - VITE_API_BASE_URL / VITE_WS_URL → 只决定请求打到哪台后端，不决定 app_env
 *
 * 改 .env 后必须重新编译/运行（热更新不会改 import.meta.env）；云打包 AAB 也要重打。
 * 测试环境示例见仓库根目录 `.env.test`。
 */

/** @returns {'prod'|'test'} */
export function getAppEnv() {
  let raw = "prod";
  try {
    raw = String(import.meta.env?.VITE_APP_ENV || "prod").trim().toLowerCase();
  } catch {
    /* ignore */
  }
  if (raw === "test" || raw === "staging" || raw === "dev") return "test";
  return "prod";
}

/** 是否测试环境（Firebase 事件名加 test_ 前缀） */
export function isTestEnv() {
  return getAppEnv() === "test";
}

/**
 * Firebase 实际上报的事件名：测试环境统一加 test_ 前缀（已带前缀则不重复加）。
 * @param {string} name
 * @returns {string}
 */
export function resolveFirebaseEventName(name) {
  if (!name) return "";
  const n = String(name);
  if (!isTestEnv()) return n;
  if (n.startsWith("test_")) return n;
  return `test_${n}`;
}

/**
 * 后端统计用的正式事件名：firebase_event_name 去掉 test_ 前缀。
 * 测试/正式包 product_event 都是 login、login_page_show，不会带 test_。
 * @param {string} firebaseEventName
 * @returns {string}
 */
export function canonicalProductEventName(firebaseEventName) {
  const n = String(firebaseEventName || "");
  return n.startsWith("test_") ? n.slice(5) : n;
}

/** 启动时打一次，方便核对打包是否吃到了 .env */
export function logAppEnvOnce() {
  let api = "(empty)";
  let raw = "(unset)";
  try {
    api = String(import.meta.env?.VITE_API_BASE_URL || "").trim() || "(empty)";
    raw = String(import.meta.env?.VITE_APP_ENV || "").trim() || "(unset)";
  } catch {
    /* ignore */
  }
  const appEnv = getAppEnv();
  console.log(
    `[env] app_env=${appEnv} VITE_APP_ENV=${raw} API=${api}` +
      (isTestEnv() ? " (Firebase events use test_ prefix)" : "")
  );
}
