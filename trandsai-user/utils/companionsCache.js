/**
 * @file companionsCache.js
 * @description 伴侣列表内存 + 本地双重缓存，降低发现页/首页条带重复请求。
 *
 * 设计：
 * - 内存 Map：同页多次读即时命中
 * - Storage（TTL 60s）：冷启动可先出 UI
 * - inflight：同一 key 并发请求合并为一次网络
 *
 * @depends api.js（apiFetch）、storage.js
 * @usedBy pages/discover、pages/home、pages-sub/my-companions 等
 */

import { apiFetch } from "./api";
import { getItem, setItem, removeKeysWithPrefix } from "./storage";

/** 缓存有效期：60 秒 */
const CACHE_TTL_MS = 60_000;
/** 本地存储键前缀 */
const LS_PREFIX = "companions_cache_v1:";
/** 进程内内存缓存：key → { data, ts } */
const cache = new Map();
/** 进行中的请求：key → Promise，用于去重 */
const inflight = new Map();

/** 当前登录用户分区键，避免同机换号命中旧列表 */
function currentUserScope() {
  try {
    const raw = getItem("user_info");
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.id != null) return `u${u.id}`;
      if (u?.username) return `n${u.username}`;
    }
  } catch {
    /* ignore */
  }
  return getItem("user_token") ? "authed" : "anon";
}

/**
 * 将查询参数对象规范为稳定字符串键（键名排序，保证等价 params 命中同一缓存）
 * @param {Record<string, *>} params
 * @returns {string}
 */
function cacheKey(params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("&");
  const scope = currentUserScope();
  return `${scope}|${sorted || "default"}`;
}

/**
 * 兼容多种列表响应：裸数组 / { results|data|items|companions: [] }
 * @param {*} body
 * @returns {any[]}
 */
function normalizeCompanionsList(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  for (const key of ["results", "data", "items", "companions", "list"]) {
    if (Array.isArray(body[key])) return body[key];
  }
  for (const key of ["results", "data"]) {
    const inner = body[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const nested = normalizeCompanionsList(inner);
      if (nested.length) return nested;
    }
  }
  return [];
}

function pickPagination(body) {
  if (body?.pagination && typeof body.pagination === "object") {
    return body.pagination;
  }
  const inner = body?.results ?? body?.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner) && inner.pagination) {
    return inner.pagination;
  }
  return {};
}

/**
 * 从本地存储读取未过期缓存
 * @param {string} key
 * @returns {{ data: any[], ts: number }|null}
 */
function readLsCache(key) {
  try {
    const raw = getItem(LS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.ts >= CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 写入本地缓存（带时间戳）
 * @param {string} key
 * @param {any[]} data
 */
function writeLsCache(key, data) {
  try {
    setItem(LS_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* 配额不足时静默失败，不影响主流程 */
  }
}

/** 主动失效：创建/删除伴侣后调用，避免列表陈旧 */
export function invalidateCompanionsCache() {
  cache.clear();
  removeKeysWithPrefix(LS_PREFIX);
}

/**
 * 同步读取缓存（不发网络）。先内存后本地。
 * @param {Record<string, *>} [params]
 * @returns {any[]|null}
 */
export function getCachedCompanions(params = {}) {
  const key = cacheKey(params);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit.data;
  const ls = readLsCache(key);
  if (ls) {
    cache.set(key, ls);
    return ls.data;
  }
  return null;
}

/**
 * 拉取伴侣列表：优先缓存，miss 时请求 `/api/bcompanions?...`（page / page_size）。
 * 若仍传入 limit/offset，会在请求前转换成 page/page_size。
 * @param {Record<string, *>} [params] 查询参数（lang、gender、special 等）
 * @param {{ force?: boolean }} [options] force=true 跳过缓存强制刷新
 * @returns {Promise<any[]>}
 */
export async function fetchCompanions(params = {}, options = {}) {
  const query = toBCompanionsParams(params);
  const key = cacheKey(query);
  const now = Date.now();

  // 非强制：走缓存 / 合并 inflight
  if (!options.force) {
    const hit = cache.get(key);
    if (hit && now - hit.ts < CACHE_TTL_MS) return hit.data;
    const ls = readLsCache(key);
    if (ls) {
      cache.set(key, ls);
      return ls.data;
    }
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const promise = fetchBCompanions(query)
    .then(({ list }) => {
      const entry = { data: list, ts: Date.now() };
      cache.set(key, entry);
      writeLsCache(key, list);
      return list;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

const BCOMPANIONS_PAGE_SIZE = 20;

/**
 * 旧分页 limit/offset → 标准 page / page_size；其余查询参数原样保留。
 * @param {Record<string, *>} [params]
 * @returns {Record<string, *>}
 */
function toBCompanionsParams(params = {}) {
  const next = { ...params };
  const limit = next.limit;
  const offset = next.offset;
  delete next.limit;
  delete next.offset;
  if (next.page_size == null && limit != null && limit !== "") {
    next.page_size = limit;
  }
  if (next.page == null) {
    const size = Number(next.page_size) || BCOMPANIONS_PAGE_SIZE;
    const off = Number(offset);
    next.page =
      Number.isFinite(off) && off > 0 ? Math.floor(off / size) + 1 : 1;
  }
  return next;
}

/**
 * 首页 Companions Tab：GET /api/bcompanions，标准分页 page / page_size。
 * @param {Record<string, *>} [params]
 * @returns {Promise<{ list: any[], pagination: { page: number, page_size: number, total: number, total_pages: number } }>}
 */
export async function fetchBCompanions(params = {}) {
  const query = toBCompanionsParams(params);
  const queryParts = [];
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") {
      queryParts.push(
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      );
    }
  }
  const queryString = queryParts.join("&");
  const url = `/api/bcompanions${queryString ? `?${queryString}` : ""}`;
  const body = await apiFetch(url);
  const list = normalizeCompanionsList(body);
  const pg = pickPagination(body);
  const page = Number(pg.page) || Number(query.page) || 1;
  const pageSize =
    Number(pg.page_size) || Number(query.page_size) || BCOMPANIONS_PAGE_SIZE;
  const total = Number(pg.total);
  const totalPages = Number(pg.total_pages);
  return {
    list,
    pagination: {
      page,
      page_size: pageSize,
      total: Number.isFinite(total) ? total : list.length,
      // 接口没给 total_pages 时不要伪造 page+1，交给 companionPageHasMore 用「是否满页」判断
      total_pages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 0,
    },
  };
}

/**
 * 是否还有下一页：优先用接口 pagination.page / total_pages。
 * @param {any[]} batch
 * @param {{ page?: number, page_size?: number, total_pages?: number }} [pagination]
 * @param {number} [pageSize]
 */
export function companionPageHasMore(batch, pagination, pageSize) {
  const page = Number(pagination?.page);
  const totalPages = Number(pagination?.total_pages);
  const size =
    Number(pagination?.page_size) || Number(pageSize) || BCOMPANIONS_PAGE_SIZE;
  const len = Array.isArray(batch) ? batch.length : 0;
  // 本页不足一页：一定没有更多
  if (len < size) return false;
  // 仅当接口明确给了 total_pages 时才用 page < total_pages
  // （缺省时勿用 page+1 兜底，否则满页会永远 hasMore）
  if (
    Number.isFinite(page) &&
    page > 0 &&
    Number.isFinite(totalPages) &&
    totalPages > 0 &&
    pagination?.total_pages != null
  ) {
    return page < totalPages;
  }
  return len >= size;
}
