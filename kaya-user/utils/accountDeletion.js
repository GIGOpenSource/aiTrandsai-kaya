/**
 * 账号注销冷静期：解析登录失败体、写入登录态。
 * 文档：account-deletion-restore.md
 * 注销仍走 POST /api/auth/delete-account。
 * 恢复：邮箱密码 restore-account；OAuth 原登录接口加 restore；游客无密码，只能 POST /api/auth/quick-login 加 restore。
 */
import { setItem } from "./storage";

export function parseAccountDeletionPayload(body) {
  if (!body || typeof body !== "object") return null;
  const results =
    body.results && typeof body.results === "object" ? body.results : null;
  const src = results || (typeof body.detail === "object" ? body.detail : body);
  const detailRaw = src.detail != null && typeof src.detail !== "object" ? src.detail : body.detail;
  const detail = String(detailRaw || body.error || "").trim();
  const status = String(src.account_status || body.account_status || "");
  const canRestore = src.can_restore === true || body.can_restore === true;

  if (detail === "account_closed" || status === "closed") {
    return { kind: "closed" };
  }
  if (detail === "account_pending_deletion" || canRestore || status === "deleted") {
    const daysLeft = Number(src.days_left);
    const grace = Number(src.grace_days);
    const days =
      Number.isFinite(daysLeft) && daysLeft > 0
        ? daysLeft
        : Number.isFinite(grace) && grace > 0
          ? grace
          : 7;
    return { kind: "pending", daysLeft: days };
  }
  return null;
}

export function persistAuthSession(payload) {
  if (!payload || typeof payload !== "object") return false;
  const data =
    payload.results && typeof payload.results === "object"
      ? payload.results
      : payload.data && typeof payload.data === "object"
        ? payload.data
        : payload;
  const token = data.token || payload.token;
  const userSrc = data.user || payload.user;
  if (!token) return false;
  const user =
    userSrc && typeof userSrc === "object" ? { ...userSrc } : {};
  if (data.is_guest != null) user.is_guest = data.is_guest;
  if (payload.is_guest != null) user.is_guest = payload.is_guest;
  if (data.can_pay != null) user.can_pay = data.can_pay;
  if (payload.can_pay != null) user.can_pay = payload.can_pay;
  if (data.platform) user.platform = data.platform;
  try {
    setItem("user_token", token);
    if (Object.keys(user).length) {
      setItem("user_info", JSON.stringify(user));
    }
  } catch {
    return false;
  }
  return true;
}
