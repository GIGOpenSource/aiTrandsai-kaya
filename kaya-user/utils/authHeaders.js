/**
 * @file authHeaders.js
 * @description 组装 REST 认证请求头，与后端 `x-token` 约定一致。
 * @depends storage.js（读取 user_token）
 * @usedBy api.js；页面一般不直接调用，由 apiFetch 自动注入
 */

import { getItem } from "./storage";

/**
 * 若本地存在登录 token，返回 { "x-token": token }；否则返回空对象。
 * @returns {Record<string, string>}
 */
export function getAuthHeaders() {
  // 登录成功后写入的键，与 login/register 页一致
  const token = getItem("user_token");
  if (!token) return {};
  return { "x-token": token };
}
