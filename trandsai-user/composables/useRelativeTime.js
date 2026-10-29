/**
 * @file useRelativeTime.js
 * @description 相对时间文案（刚刚 / N 分钟前…），按 i18n 命名空间切换。
 * 占位符手动替换，兼容 React 的 {{count}} 与 vue-i18n 的 {count}，
 * 避免 message-compiler 对嵌套花括号报错（含 HMR 残留旧文案）。
 * @param {string} [prefix="home"] 文案前缀：home | messages | discover
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatLocaleMonthDay } from "@/utils/chatTime";

/**
 * 从 locale message 树取原始字符串（不走编译器）
 * @param {Record<string, any>} tree
 * @param {string} key
 * @returns {string|undefined}
 */
function resolveRaw(tree, key) {
  if (!tree || !key) return undefined;
  let cur = tree;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * @param {string} template
 * @param {number} count
 */
function withCount(template, count) {
  return String(template)
    .replace(/\{\{count\}\}/g, String(count))
    .replace(/\{count\}/g, String(count));
}

/**
 * @param {string} [prefix="home"]
 * @returns {{ format: (isoTime: string) => string, t: import('vue').ComputedRef }}
 */
export function useRelativeTime(prefix = "home") {
  const { t, locale, messages } = useI18n();

  /**
   * @param {string} key
   * @param {number} [count]
   */
  function tr(key, count) {
    const tree =
      messages.value?.[locale.value] ||
      messages.value?.zh ||
      messages.value?.en ||
      {};
    const raw =
      resolveRaw(tree, key) ||
      resolveRaw(messages.value?.en || {}, key) ||
      resolveRaw(messages.value?.zh || {}, key);
    if (raw != null && count != null) return withCount(raw, count);
    if (raw != null) return raw;
    // 最后兜底：仍走 t（justNow 等无占位符键）
    return count != null ? t(key, { count }) : t(key);
  }

  function format(isoTime) {
    if (!isoTime) return "";
    const diffMs = Date.now() - new Date(isoTime).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (prefix === "messages") {
      if (diffSec < 60) return tr("messages.justNow");
      if (diffMin < 60) return tr("messages.minutesAgo", diffMin);
      if (diffHour < 24) return tr("messages.hoursAgo", diffHour);
      if (diffDay === 1) return tr("messages.yesterday");
      if (diffDay < 7) return tr("messages.daysAgo", diffDay);
      return formatLocaleMonthDay(isoTime, locale.value);
    }

    if (diffSec < 60) return tr(`${prefix}.justNow`);
    if (diffMin < 60) return tr(`${prefix}.minutesAgo`, diffMin);
    if (diffHour < 24) return tr(`${prefix}.hoursAgo`, diffHour);
    if (diffDay < 7) return tr(`${prefix}.daysAgo`, diffDay);
    return formatLocaleMonthDay(isoTime, locale.value);
  }

  return { format, t: computed(() => t) };
}
