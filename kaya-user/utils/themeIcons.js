/**
 * @file themeIcons.js
 * @description 主题图标：马甲包切图（深色白描边 / 浅色黑描边）
 */
export function likeIconSrc(isDark) {
  return isDark
    ? "/static/vest/common/like-white.png"
    : "/static/vest/common/like-black.png";
}

/** Moments 头像条「创建」相机：深色白图标 / 浅色黑描边 */
export function momentCreateIconSrc(isDark) {
  return isDark
    ? "/static/vest/moments/create-dark.png"
    : "/static/vest/moments/create-light.svg";
}

export function commentIconSrc(isDark) {
  return isDark
    ? "/static/vest/common/comment-white.png"
    : "/static/vest/common/comment-black.png";
}

export function moreIconSrc(isDark) {
  return isDark
    ? "/static/vest/common/more-dark.png"
    : "/static/vest/common/more-light.png";
}

export function titleBellIconSrc(isDark) {
  return isDark
    ? "/static/vest/home/bell-dark.png"
    : "/static/vest/home/bell-light.png";
}

export function titleFilterIconSrc(isDark) {
  return isDark
    ? "/static/vest/home/filter-dark.png"
    : "/static/vest/home/filter-light.png";
}

export function titleAddIconSrc(isDark) {
  return isDark
    ? "/static/vest/common/add-dark.png"
    : "/static/vest/common/add-light.png";
}

export function titleSearchIconSrc(isDark) {
  return isDark
    ? "/static/vest/common/search-dark.png"
    : "/static/vest/common/search-light.png";
}

export function profileMenuIconSrc(key, isDark) {
  const map = {
    companions: [
      "/static/vest/profile/companions-dark.png",
      "/static/vest/profile/companions-light.png",
    ],
    posts: [
      "/static/vest/profile/posts-dark.png",
      "/static/vest/profile/posts-light.png",
    ],
    intimacy: [
      "/static/vest/profile/intimacy-dark.png",
      "/static/vest/profile/intimacy-light.png",
    ],
    create: [
      "/static/vest/profile/create-dark.png",
      "/static/vest/profile/create-light.png",
    ],
    settings: [
      "/static/vest/profile/settings-dark.png",
      "/static/vest/profile/settings-light.png",
    ],
    more: [
      "/static/vest/profile/more-dark.png",
      "/static/vest/profile/more-light.png",
    ],
  };
  const pair = map[key];
  if (!pair) return "";
  return isDark ? pair[0] : pair[1];
}

export function likeActiveIconSrc() {
  return "/static/vest/common/like-red.png";
}

export function translateIconSrc(isDark) {
  return isDark
    ? "/static/message/ico-translate-light.svg"
    : "/static/message/ico-translate-dark.svg";
}

/** 聊天输入栏粉表情 */
export function chatEmojiIconSrc() {
  return "/static/vest/chat/emoji.png";
}

/** 聊天输入栏粉纸飞机 */
export function chatSendIconSrc() {
  return "/static/vest/chat/send.png";
}
