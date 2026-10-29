/**
 * @description WebSocket 连接欢迎语过滤：识别握手后下发的系统提示，避免在聊天界面展示。
 */

/**
 * 判断消息文本是否为 WebSocket 连接成功后的多语言欢迎系统提示。
 * @param {string} text - 消息正文
 * @returns {boolean} 是欢迎提示则返回 true，应被过滤
 */
export function isWsConnectWelcomeNotice(text) {
  const s = (text || "").trim();
  if (!s) return false;
  if (s.includes("已连接到") && s.includes("开始聊天吧")) return true;
  if (s.startsWith("Connected to") && s.includes("Let's chat")) return true;
  if (s.includes("に接続しました") && s.includes("お話ししましょう")) return true;
  if (s.includes("에 연결") && s.includes("이야기하자")) return true;
  if (s.startsWith("Conectado a") && s.includes("Vamos conversar")) return true;
  if (s.startsWith("Conectado a") && s.includes("¡Hablemos")) return true;
  if (s.startsWith("Terhubung dengan") && s.includes("Mari ngobrol")) return true;
  return false;
}
