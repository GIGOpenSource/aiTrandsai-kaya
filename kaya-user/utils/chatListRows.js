/**
 * @file chatListRows.js
 * @description 聊天页气泡分组 / 日期分隔行（纯函数，不含滚动与发送）。
 */
import { formatBubbleFootTime } from "@/utils/chatTime";

export const CHAT_GROUP_GAP_MIN = 4;

export function isConvSender(s) {
  return s === "user" || s === "ai";
}

export function breaksConversationGroup(s) {
  return s === "system" || s === "thinking" || s === "filler";
}

export function messageInstant(m) {
  if (m?.ts) {
    const tMs = Date.parse(m.ts);
    if (!Number.isNaN(tMs)) return tMs;
  }
  return Date.now();
}

export function userBubbleShape() {
  return "shape-single-user";
}

export function aiBubbleShape() {
  return "shape-single-ai";
}

export function buildChatListRows(list, locale, formatChatDateSeparator, calendarDayKeyFromIso) {
  const rows = [];
  let lastDayKey = "";
  let bubbleIndex = 0;
  let prevRowWasDate = false;

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const prev = i > 0 ? list[i - 1] : null;
    const next = i < list.length - 1 ? list[i + 1] : null;

    if (m.ts) {
      const dk = calendarDayKeyFromIso(m.ts);
      if (dk && dk !== lastDayKey) {
        rows.push({
          kind: "date",
          key: `sep-${dk}-${m.id}`,
          label: formatChatDateSeparator(m.ts, locale),
        });
        lastDayKey = dk;
        prevRowWasDate = true;
      }
    }

    let groupWithPrev = false;
    if (
      prev &&
      isConvSender(m.sender) &&
      isConvSender(prev.sender) &&
      !breaksConversationGroup(prev.sender) &&
      !breaksConversationGroup(m.sender) &&
      prev.sender === m.sender
    ) {
      const gapMin = Math.abs(messageInstant(m) - messageInstant(prev)) / 60000;
      if (gapMin < CHAT_GROUP_GAP_MIN) groupWithPrev = true;
    }

    let groupWithNext = false;
    if (
      next &&
      isConvSender(m.sender) &&
      isConvSender(next.sender) &&
      !breaksConversationGroup(next.sender) &&
      !breaksConversationGroup(m.sender) &&
      next.sender === m.sender
    ) {
      const gapMin = Math.abs(messageInstant(next) - messageInstant(m)) / 60000;
      if (gapMin < CHAT_GROUP_GAP_MIN) groupWithNext = true;
    }

    const showAvatar =
      m.sender === "ai" && !(groupWithPrev && prev?.sender === "ai");
    const avatarSpacer = m.sender === "ai" && !showAvatar;
    const footTime = formatBubbleFootTime(m.ts, locale, m.time);
    const showFootTime = Boolean(
      footTime && (!isConvSender(m.sender) || !groupWithNext)
    );

    const marginTopClass = prevRowWasDate
      ? "mt-date"
      : bubbleIndex === 0
        ? groupWithPrev
          ? "mt-tight"
          : "mt-none"
        : groupWithPrev
          ? "mt-tight"
          : "mt-normal";

    rows.push({
      kind: "bubble",
      key: m.id,
      message: m,
      layout: {
        groupWithPrev,
        groupWithNext,
        showAvatar,
        avatarSpacer,
        showFootTime,
        footTime,
      },
      marginTopClass,
    });
    bubbleIndex += 1;
    prevRowWasDate = false;
  }
  return rows;
}
