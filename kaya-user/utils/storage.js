/**
 * @file storage.js
 * @description localStorage 适配层：统一走 uni 同步存储 API，屏蔽各端差异与异常。
 * @usedBy api.js、authHeaders、device、homeCache、companionsCache、theme、i18n 等依赖本地持久化的模块。
 */

/**
 * 读取字符串存储项。
 * @param {string} key 存储键
 * @returns {string|null} 存在时返回字符串；空串/缺失/异常时返回 null
 */
function readStore(key) {
  try {
    const u = typeof uni !== "undefined" ? uni : globalThis.uni;
    if (u?.getStorageSync) return u.getStorageSync(key);
  } catch {
    /* uni 未就绪时走 localStorage */
  }
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  return null;
}

function writeStore(key, value) {
  try {
    const u = typeof uni !== "undefined" ? uni : globalThis.uni;
    if (u?.setStorageSync) {
      u.setStorageSync(key, value);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    /* quota */
  }
}

function deleteStore(key) {
  try {
    const u = typeof uni !== "undefined" ? uni : globalThis.uni;
    if (u?.removeStorageSync) {
      u.removeStorageSync(key);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getItem(key) {
  try {
    const v = readStore(key);
    if (v === "" || v == null) return null;
    return typeof v === "string" ? v : String(v);
  } catch {
    return null;
  }
}

/**
 * 写入存储项（失败时静默，常见于配额不足）。
 * @param {string} key 存储键
 * @param {string} value 要写入的值
 */
export function setItem(key, value) {
  writeStore(key, value);
}

/**
 * 删除单个存储项。
 * @param {string} key 存储键
 */
export function removeItem(key) {
  deleteStore(key);
}

/**
 * 读取并解析 JSON 存储项。
 * @param {string} key 存储键
 * @returns {any|null} 解析成功返回对象；缺失或解析失败返回 null
 */
export function getJson(key) {
  const raw = getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 将值序列化为 JSON 后写入。
 * @param {string} key 存储键
 * @param {any} value 可 JSON 序列化的值
 */
export function setJson(key, value) {
  setItem(key, JSON.stringify(value));
}

/**
 * 列出以指定前缀开头的全部存储键。
 * @param {string} prefix 键前缀
 * @returns {string[]} 匹配的键列表；异常时返回空数组
 */
export function keysWithPrefix(prefix) {
  try {
    const u = typeof uni !== "undefined" ? uni : globalThis.uni;
    if (u?.getStorageInfoSync) {
      const info = u.getStorageInfoSync();
      return (info.keys || []).filter((k) => k.startsWith(prefix));
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof localStorage === "undefined") return [];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * 删除所有带指定前缀的存储键（用于缓存整批失效）。
 * @param {string} prefix 键前缀
 */
export function removeKeysWithPrefix(prefix) {
  for (const k of keysWithPrefix(prefix)) {
    removeItem(k);
  }
}
