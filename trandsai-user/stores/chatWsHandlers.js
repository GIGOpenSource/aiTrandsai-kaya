/**
 * @file chatWsHandlers.js
 * @description 解析并应用一条聊天 WebSocket JSON（不含连/断/重连）。
 */
import { i18n } from "@/i18n";
import { formatNowMessageTime } from "@/utils/chatTime";
import { isWsConnectWelcomeNotice } from "@/utils/chatConnectNotice";
import {
  formatChatImagePreviewText,
  formatMomentBubbleText,
  messageContentKey,
  normalizeMessageContentType,
  normalizeMessageImageUrl,
  normalizeMomentCardData,
} from "@/stores/chatHelpers";
import { recordFreeMessageUsed } from "@/utils/productAnalyticsHelpers";
import {
  formatOurMomentsTipText,
  formatOurMomentsUnlockedBodyParts,
  trackOurMomentsUnlockOnce,
} from "@/utils/ourMoments";
import { useLimitedOfferStore } from "@/stores/limitedOffer";

function clearSendingForCompanion(ctx, companionId) {
  const userMsgs = (ctx.messages.value ?? []).filter(
    (m) => m.companionId === companionId && m.sender === "user"
  );
  for (const m of userMsgs) {
    ctx.sendingMsgIds.value.delete(m.id);
  }
}

function setTyping(ctx, companionId, on) {
  ctx.typingCompanions.value = {
    ...ctx.typingCompanions.value,
    [companionId]: on,
  };
}

/**
 * @param {object} data 已 JSON.parse 的服务端帧
 * @param {object} ctx store 闭包：companionId + refs/方法
 */
export function applyChatWsPayload(data, ctx) {
  const { companionId, locale } = ctx;
  const type = data?.type;

  if (type === "pong" || type === "ping") return;

  // 鉴权后首帧：是否第一次进该智能体聊天
  if (type === "hello") {
    if (data.first_chat === true) {
      try {
        void useLimitedOfferStore().onFirstChatEnter();
      } catch (err) {
        console.warn("[chatWS] limited offer on first_chat", err);
      }
    }
    return;
  }

  if (type === "free_turn_used") {
    const limit = Number(data.free_turns_limit);
    const used = Number(data.free_turns_used);
    let remaining = null;
    if (Number.isFinite(limit) && Number.isFinite(used)) {
      remaining = Math.max(0, limit - used);
    } else if (data.remaining != null) {
      const n = Number(data.remaining);
      if (Number.isFinite(n)) remaining = Math.max(0, n);
    }
    if (remaining != null) {
      ctx.freeTurnsRemaining.value = remaining;
    }
    try {
      recordFreeMessageUsed(
        {
          free_turns_limit: data.free_turns_limit,
          free_turns_used: data.free_turns_used,
          remaining: data.remaining,
          report_free_quota_reached: data.report_free_quota_reached,
        },
        ctx.companionId
      );
    } catch {
      /* ignore */
    }
    return;
  }

  if (type === "queued") {
    setTyping(ctx, companionId, true);
    return;
  }

  if (type === "toast") {
    const text = data.text || "";
    const t = text.trimStart();
    if (t.startsWith("💭")) {
      const thinkId = ctx.nextMsgId();
      ctx.appendEphemeral({
        id: thinkId,
        companionId,
        sender: "thinking",
        text,
        time: formatNowMessageTime(locale),
        ts: new Date().toISOString(),
      });
      setTimeout(() => ctx.dismissMessage(thinkId), 5000);
    }
    return;
  }

  if (type === "filler" && typeof data.text === "string" && data.text.trim()) {
    const fillId = ctx.nextMsgId();
    ctx.appendEphemeral({
      id: fillId,
      companionId,
      sender: "filler",
      text: data.text.trim(),
      time: formatNowMessageTime(locale),
      ts: new Date().toISOString(),
    });
    setTimeout(() => ctx.dismissMessage(fillId), 4500);
    return;
  }

  if (type === "system" && data.text) {
    const sysText = String(data.text);
    if (!isWsConnectWelcomeNotice(sysText)) {
      ctx.appendMessages([
        {
          id: ctx.nextMsgId(),
          companionId,
          sender: "system",
          text: sysText,
          time: formatNowMessageTime(locale),
          ts: new Date().toISOString(),
        },
      ]);
    }
    return;
  }

  if (type === "typing") {
    setTyping(ctx, companionId, true);
    clearSendingForCompanion(ctx, companionId);
    return;
  }

  if (type === "message" && data.role === "assistant") {
    const imageUrl = normalizeMessageImageUrl(data);
    const rawType = normalizeMessageContentType(data);
    const isImage = rawType === "image" || Boolean(imageUrl);
    const text = isImage ? "" : data.text || "";
    const previewText = isImage ? formatChatImagePreviewText() : text;
    const time = formatNowMessageTime(locale);
    ctx.stopReplyWatch(companionId);
    clearSendingForCompanion(ctx, companionId);
    const incoming = {
      id: ctx.nextMsgId(),
      companionId,
      sender: "ai",
      text,
      contentType: isImage ? "image" : rawType || "text",
      imageUrl: isImage ? imageUrl : "",
      time,
      ts: new Date().toISOString(),
    };
    const incomingKey = messageContentKey(incoming);
    const already = (ctx.messages.value ?? []).some(
      (m) =>
        String(m.companionId) === String(companionId) &&
        messageContentKey(m) === incomingKey
    );
    ctx.lastMessages.value = {
      ...ctx.lastMessages.value,
      [companionId]: {
        ...((ctx.lastMessages.value || {})[companionId] || {}),
        text: previewText,
        time,
        fullTime: new Date().toISOString(),
      },
    };
    if (!already) {
      ctx.appendMessages([incoming]);
      // 未读改由 /ws/inbox 权威推送，此处不再本地 +1
    }
    setTyping(ctx, companionId, false);
    return;
  }

  if (type === "message" && data.role === "moment") {
    const time = formatNowMessageTime(locale);
    let text = "";
    let momentData = null;
    try {
      const parsed =
        typeof data.content === "string" ? JSON.parse(data.content) : data.content;
      momentData = normalizeMomentCardData(parsed) || parsed;
      text = formatMomentBubbleText(momentData || parsed, "");
    } catch {
      text = formatMomentBubbleText(null, data.content || "");
    }
    setTyping(ctx, companionId, false);
    clearSendingForCompanion(ctx, companionId);
    ctx.lastMessages.value = {
      ...ctx.lastMessages.value,
      [companionId]: {
        ...((ctx.lastMessages.value || {})[companionId] || {}),
        text,
        time,
        fullTime: new Date().toISOString(),
      },
    };
    ctx.appendMessages([
      {
        id: ctx.nextMsgId(),
        companionId,
        sender: "user",
        text,
        momentData,
        time,
        ts: new Date().toISOString(),
      },
    ]);
    return;
  }

  if (type === "our_moments") {
    // countdown → 底栏进度；unlocked → 中间 tip；文案客户端拼
    const toastKind = String(data.toast || "").trim();
    if (typeof ctx.setOurMomentsProgress === "function") {
      try {
        ctx.setOurMomentsProgress(companionId, data);
      } catch {
        /* ignore */
      }
    }
    if (!toastKind) return;
    // 图1/图3 走常驻条；只有解锁成功才弹中间 tip（图2）
    if (toastKind === "unlocked" && typeof ctx.setOurMomentsTip === "function") {
      const tFn = (key, params) => i18n.global.t(key, params);
      let text = "";
      let bodyParts = null;
      let title = "";
      try {
        text = formatOurMomentsTipText(
          toastKind,
          data.remaining_messages,
          tFn
        );
        title = String(tFn("chat.ourMomentsUnlocked") || "").trim();
        bodyParts = formatOurMomentsUnlockedBodyParts(tFn);
      } catch {
        text = "";
        bodyParts = null;
        title = "";
      }
      if (text) {
        ctx.setOurMomentsTip({
          text,
          title,
          bodyParts,
          toast: toastKind,
          remaining_messages: data.remaining_messages,
          companionId,
          all_unlocked: data.all_unlocked === true,
          photo_count: data.photo_count,
          unlocked_count: data.unlocked_count,
          just_unlocked: Array.isArray(data.just_unlocked)
            ? data.just_unlocked
            : [],
        });
      }
      try {
        trackOurMomentsUnlockOnce(
          companionId,
          data.just_unlocked,
          data.photo_count
        );
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (type === "need_recharge" || type === "need_vip") {
    setTyping(ctx, companionId, false);
    if (typeof ctx.stopReplyWatch === "function") ctx.stopReplyWatch(companionId);
    // 超额已落库：对齐乐观气泡为 unpaid（红感叹号），不进失败重试队列
    if (data.accepted === true && typeof ctx.applyAcceptedUnpaidMessages === "function") {
      try {
        ctx.applyAcceptedUnpaidMessages(companionId, data.messages, {
          sendStatus: data.send_status || "unpaid",
        });
      } catch {
        /* ignore */
      }
    }
    clearSendingForCompanion(ctx, companionId);
    ctx.triggerPaywall({
      type: data.type,
      reason: data.reason,
      balance: data.balance,
      companionId,
      accepted: data.accepted === true,
      send_status: data.send_status || "",
    });
    // 快照 tip 供充值页自定义展示；有 tip 时不要 showToast（nvue navigate 会清掉）
    let momentsText = "";
    try {
      if (typeof ctx.captureMomentsTipForPaywall === "function") {
        ctx.captureMomentsTipForPaywall();
      }
      momentsText = String(
        ctx.ourMomentsTip?.value?.text ||
          (typeof ctx.paywallMomentsTip?.value === "string"
            ? ctx.paywallMomentsTip.value
            : "") ||
          ""
      ).trim();
    } catch {
      momentsText = "";
    }
    if (!momentsText) {
      try {
        const tip =
          data.type === "need_vip"
            ? i18n.global.t("recharge.needVip")
            : i18n.global.t("recharge.insufficientPoints");
        uni.showToast({ title: tip, icon: "none" });
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (type === "error") {
    setTyping(ctx, companionId, false);
    const detail =
      typeof data.text === "string" && data.text.trim()
        ? data.text.trim()
        : i18n.global.t("chat.connectionAbnormal");
    ctx.appendMessages([
      {
        id: ctx.nextMsgId(),
        companionId,
        sender: "ai",
        text: detail,
        time: formatNowMessageTime(locale),
        ts: new Date().toISOString(),
      },
    ]);
  }
}
