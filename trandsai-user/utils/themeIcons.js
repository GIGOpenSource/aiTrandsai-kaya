/**
 * @file themeIcons.js
 * @description 主题图标路径：深色用浅描边；浅色用 *-on-light / *-light（深色描边）。
 */
export function likeIconSrc(isDark) {
  return isDark ? "/static/home/icon-like.svg" : "/static/home/icon-like-on-light.svg";
}

export function commentIconSrc(isDark) {
  return isDark
    ? "/static/home/icon-comment.svg"
    : "/static/home/icon-comment-on-light.svg";
}

export function moreIconSrc(isDark) {
  return isDark ? "/static/home/icon-more.svg" : "/static/home/icon-more-on-light.svg";
}

export function translateIconSrc(isDark) {
  return isDark
    ? "/static/message/ico-translate-light.svg"
    : "/static/message/ico-translate-dark.svg";
}
