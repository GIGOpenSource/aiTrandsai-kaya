/**
 * @file googleAuthConfig.js
 * @description Google OAuth 配置（勿放进 *.android.js，避免条件编译循环引用）
 *
 * GOOGLE_WEB_CLIENT_ID 必须是 Google Cloud Console 里「Web 应用」类型客户端 ID。
 * Android 类型 Client ID 无法用于 requestIdToken，会导致 id_token 为空。
 * 后端校验 id_token 的 aud 也必须对这个 Web Client ID。
 */
export const GOOGLE_WEB_CLIENT_ID =
  "505895695411-dbo7nfeskdi39hu83vg1ubauot2h1as7.apps.googleusercontent.com";
