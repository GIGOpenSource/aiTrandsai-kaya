/**
 * @file homeCache.js
 * @description 首页「先 UI 后数据」用的本地缓存读写。
 * - moments：朋友圈列表
 * - companions strip：顶部智能体横条
 * @depends storage.js
 * @usedBy pages/home/index.vue
 */

import { getItem, setItem, removeItem } from "./storage";

/** 朋友圈缓存键 */
const MOMENTS_KEY = "home_moments_v1";
/** 首页伴侣横条缓存键 */
const COMPANIONS_STRIP_KEY = "home_companion_strip_v1";

/** 切 Tab（redirectTo）卸页后仍保留的朋友圈现场 */
let momentsRuntime = null;

/**
 * 保存首页朋友圈现场（内存，不写磁盘）
 * @param {object} state
 */
export function saveHomeMomentsRuntime(state) {
  momentsRuntime = state || null;
}

/**
 * 读取首页朋友圈现场
 * @returns {object|null}
 */
export function readHomeMomentsRuntime() {
  return momentsRuntime;
}

/**
 * 读取首页朋友圈缓存
 * @returns {any[]|null}
 */
export function readHomeMomentsCache() {
  try {
    const raw = getItem(MOMENTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 写入首页朋友圈缓存
 * @param {any[]} moments
 */
export function writeHomeMomentsCache(moments) {
  try {
    setItem(MOMENTS_KEY, JSON.stringify(moments));
  } catch {
    /* quota */
  }
}

/**
 * 读取首页伴侣横条缓存
 * @returns {any[]|null}
 */
export function readHomeCompanionsStripCache() {
  try {
    const raw = getItem(COMPANIONS_STRIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 写入首页伴侣横条缓存
 * @param {any[]} companions
 */
export function writeHomeCompanionsStripCache(companions) {
  try {
    setItem(COMPANIONS_STRIP_KEY, JSON.stringify(companions));
  } catch {
    /* quota */
  }
}

/** 登出 / 换账号时清理首页缓存，避免串数据 */
export function clearHomeCache() {
  momentsRuntime = null;
  try {
    removeItem(MOMENTS_KEY);
    removeItem(COMPANIONS_STRIP_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 切换界面语言后失效朋友圈缓存。
 * 下次进首页走网络刷新拿新语言内容；其它切 Tab 仍用 runtime 还原。
 */
export function invalidateHomeMomentsForLanguageChange() {
  momentsRuntime = null;
  try {
    removeItem(MOMENTS_KEY);
  } catch {
    /* ignore */
  }
}
