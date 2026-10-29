/**
 * @file chat.js
 * @description 全局聊天状态（由 React ChatContext 迁移）。
 *
 * 规范（client-uni）：
 * - 纯 JavaScript + Pinia setup store（无 TypeScript）
 * - WebSocket 使用 uni.connectSocket（非浏览器 WebSocket）
 * - 持久化走 utils/storage（uni.setStorageSync）
 * - H5 专属能力用条件编译（ifdef H5）
 *
 * 职责：WS 连接、消息/未读/最后消息、离线 outbox、前后台与语言切换重连。
 * 服务端负载友好：
 * - 全局 WS 上限 + LRU 驱逐（避免连接只增不减）
 * - 重连指数退避带抖动；前台恢复/切语言错峰重连（削峰）
 * - 应用层 ping/pong 心跳，避免空闲被网关掐掉后客户端仍以为在线
 *
 * 依赖：i18n、chatTime、uiLanguage、storage、chatHelpers、chatWsHandlers
 * 页面：messages、chat、AppTabBar（未读角标）
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { i18n } from "@/i18n";
import { formatNowMessageTime, formatMessageTime } from "@/utils/chatTime";
import { normalizeUiLang } from "@/utils/uiLanguage";
import { getItem, setItem } from "@/utils/storage";
import { devLog } from "@/utils/devLog";
import apiFetch, { unwrapApiResults } from "@/utils/api";
import { getAppVersion } from "@/utils/device";
import { applyChatWsPayload } from "@/stores/chatWsHandlers";
import {
  resolveChatUserId,
  unreadStorageKey,
  lastMessagesStorageKey,
  outboxStorageKey,
  formatMomentBubbleText,
  normalizeMomentCardData,
  getWsOrigin,
  buildChatWsPayload,
  messageContentKey,
  isChatImageMessage,
  formatChatImagePreviewText,
  reconnectDelayMs,
  pollChatTurnJob,
  formatHistoryIncoming,
  mergeCompanionHistory,
} from "@/stores/chatHelpers";
import { useInboxWsStore } from "@/stores/inboxWs";
import {
  OUR_MOMENTS_TIP_MS,
  OUR_MOMENTS_UNLOCKED_TIP_MS,
  rememberOurMomentsTip,
  fetchOurMoments,
  normalizeOurMomentsProgress,
} from "@/utils/ourMoments";

const CHAT_SYNC_CHANNEL = "chat-meta-sync-v1";
const MAX_MESSAGES = 5000;
const MESSAGE_TRIM_TARGET = 3000;
/** 单客户端同时持有的 WS 上限（当前聊天 + 后台预连 + 余量） */
const MAX_WS_CONNECTIONS = 4;
/** 前台恢复时按 companion 错开重连的基础间隔（ms） */
const RECONNECT_STAGGER_MS = 180;

/**
 * 全局聊天 Pinia Store
 */
export const useChatStore = defineStore("chat", () => {
  // ——— 对外响应式状态 ———
  const messages = ref([]);
  const unreadCounts = ref({});
  const lastMessages = ref({});
  /** companionId → 已读到的 last_message 时间，避免 syncRemotePreview 把已读会话重新打未读 */
  const lastReadFullTimes = ref({});
  const isConnected = ref({});
  const typingCompanions = ref({});
  const activeCompanionId = ref(null);
  const ephemeral = ref({});
  const sendingMsgIds = ref(new Set());
  const pendingMsgIds = ref(new Set());
  /** WS/本地触发的充值/VIP 拦截面板信号 */
  const paywall = ref(null);
  /**
   * Our Moments 聊天 Toast（主要为 unlocked；countdown 走底栏进度条）。
   * 短时展示；付费弹窗另用 paywallMomentsTip 快照，避免跳转充值页后读不到。
   */
  const ourMomentsTip = ref(null);
  /** companionId → Our Moments 进度（进页 GET + WS 增量） */
  const ourMomentsProgress = ref({});
  /** 付费弹窗专用快照文案（打开付费时写入，短时展示） */
  const paywallMomentsTip = ref("");
  let ourMomentsTipTimer = null;
  let paywallMomentsTipTimer = null;

  /** 付费快照比聊天 tip 更长：给 nvue 跳转充值页 / 弹窗打开留时间 */
  const PAYWALL_TIP_KEEP_MS = 15000;

  function setOurMomentsProgress(companionId, raw) {
    const id = String(companionId || "").trim();
    if (!id) return;
    const prev = ourMomentsProgress.value[id] || {};
    const next = normalizeOurMomentsProgress(raw, id);
    if (next.photo_count <= 0 && Number(prev.photo_count) > 0) {
      next.photo_count = Number(prev.photo_count);
    }
    if (
      next.unlocked_count <= 0 &&
      Number(prev.unlocked_count) > 0 &&
      next.all_unlocked
    ) {
      next.unlocked_count = Number(prev.unlocked_count);
    }
    ourMomentsProgress.value = { ...ourMomentsProgress.value, [id]: next };
  }

  /** 进聊天拉一次进度，供图1/图3 常驻条（全部解锁后 WS 不再推） */
  async function loadOurMomentsProgress(companionId) {
    const id = String(companionId || "").trim();
    if (!id) return null;
    try {
      const data = await fetchOurMoments(id);
      setOurMomentsProgress(id, data);
      return ourMomentsProgress.value[id] || null;
    } catch {
      return null;
    }
  }

  function setOurMomentsTip(payload) {
    const text = String(payload?.text || "").trim();
    if (!text) return;
    const toast = payload?.toast || "countdown";
    const ttl =
      toast === "unlocked" ? OUR_MOMENTS_UNLOCKED_TIP_MS : OUR_MOMENTS_TIP_MS;
    ourMomentsTip.value = {
      text,
      toast,
      title: String(payload?.title || "").trim(),
      bodyParts:
        payload?.bodyParts && typeof payload.bodyParts === "object"
          ? payload.bodyParts
          : null,
      remaining_messages: payload?.remaining_messages,
      companionId: payload?.companionId || "",
      all_unlocked: payload?.all_unlocked === true,
      photo_count: payload?.photo_count,
      unlocked_count: payload?.unlocked_count,
      just_unlocked: Array.isArray(payload?.just_unlocked)
        ? payload.just_unlocked
        : [],
      ttl,
      ts: Date.now(),
    };
    // 落盘：nvue navigateTo 充值页后仍可读（内存 tip / 原生 toast 都会丢）
    rememberOurMomentsTip(text);
    setPaywallMomentsTip(text);
    try {
      uni.$emit("our-moments-tip", text);
    } catch {
      /* ignore */
    }
    if (ourMomentsTipTimer) clearTimeout(ourMomentsTipTimer);
    ourMomentsTipTimer = setTimeout(() => {
      ourMomentsTip.value = null;
      ourMomentsTipTimer = null;
    }, ttl);
  }

  function setPaywallMomentsTip(text) {
    const t = String(text || "").trim();
    if (!t) return;
    paywallMomentsTip.value = t;
    if (paywallMomentsTipTimer) clearTimeout(paywallMomentsTipTimer);
    paywallMomentsTipTimer = setTimeout(() => {
      paywallMomentsTip.value = "";
      paywallMomentsTipTimer = null;
    }, PAYWALL_TIP_KEEP_MS);
  }

  /** 打开付费弹窗时：把当前 tip 快照到 paywallMomentsTip */
  function captureMomentsTipForPaywall() {
    const tip = ourMomentsTip.value;
    const text = String(tip?.text || paywallMomentsTip.value || "").trim();
    if (!text) return false;
    setPaywallMomentsTip(text);
    return true;
  }

  function clearOurMomentsTip() {
    if (ourMomentsTipTimer) {
      clearTimeout(ourMomentsTipTimer);
      ourMomentsTipTimer = null;
    }
    ourMomentsTip.value = null;
  }
  /** companionId → 重连次数用尽，需用户手动点重连 */
  const reconnectFailed = ref({});
  /** 最近一次 free_turn_used 剩余次数（limit - used，可选展示） */
  const freeTurnsRemaining = ref(null);
  /**
   * companionId → 清空次数。详情页清空后聊天页可据此强制重拉历史，
   * 避免栈内缓存页或 mergeHistory 把旧消息合回来。
   */
  const historyEpoch = ref({});
  /** 清空后下一次 initial merge 以服务端为准，不再保留内存 live 消息 */
  const trustServerInitial = {};

  // ——— 连接与重连内部表（非响应式） ———
  let msgIdCounter = 1000000;
  let activeStorageUserId = resolveChatUserId();
  const connections = {};
  const reconnectTimers = {};
  const reconnectAttempts = {};
  const intentionallyClosed = {};
  /** H5 取 ticket / App 握手期间的代数，避免过期回调绑错连接或误触发重连 */
  const connectSeq = {};
  /** companionId → 离开聊天页的延迟 disconnect，吞掉 onHide 闪烁 */
  const leaveChatTimers = {};
  /** companionId → 聊天页当前是否视为前台可见（仅 show/boot 置 true，hide/leave 置 false） */
  const chatPagePresent = {};
  const LEAVE_CHAT_DELAY_MS = 480;

  function cancelLeaveChat(companionId) {
    const id = String(companionId || "");
    if (!id || !leaveChatTimers[id]) return false;
    clearTimeout(leaveChatTimers[id]);
    delete leaveChatTimers[id];
    console.log("[WS] cancelLeaveChat", id);
    return true;
  }

  /** 聊天页 onShow / boot：只有这条路径能取消「离开断连」 */
  function noteChatPageShow(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    chatPagePresent[id] = true;
    cancelLeaveChat(id);
    console.log("[WS] noteChatPageShow", id);
  }

  /**
   * 聊天页 onHide：标记不可见并延迟断连。
   * 真离开后 show 不会再来，定时器会 disconnect；键盘闪 hide 会紧跟 show 取消。
   */
  function noteChatPageHide(companionId, reason = "hide") {
    const id = String(companionId || "");
    if (!id) return;
    chatPagePresent[id] = false;
    scheduleLeaveChat(id, reason);
  }

  /** 聊天页卸载：立刻断，不等延迟 */
  function noteChatPageLeave(companionId, reason = "leave") {
    const id = String(companionId || "");
    if (!id) return;
    chatPagePresent[id] = false;
    cancelLeaveChat(id);
    if (String(activeCompanionId.value || "") === id) {
      setActiveCompanionId(null);
    }
    disconnect(id, reason);
    try {
      useInboxWsStore().healAfterChatSocket(`leave:${reason}`);
    } catch {
      /* ignore */
    }
  }

  /**
   * 离开聊天页再断 /ws/chat（未读依赖）。
   * 仅当 chatPagePresent 仍为 false 时执行；show 会置回 true 并 cancel。
   */
  function scheduleLeaveChat(companionId, reason = "") {
    const id = String(companionId || "");
    if (!id) return;
    if (leaveChatTimers[id]) clearTimeout(leaveChatTimers[id]);
    console.log("[WS] scheduleLeaveChat", id, reason);
    leaveChatTimers[id] = setTimeout(() => {
      delete leaveChatTimers[id];
      if (chatPagePresent[id]) {
        console.log("[WS] leaveChat 取消：页面又可见", id, reason);
        return;
      }
      console.log("[WS] leaveChat 执行", id, reason);
      if (String(activeCompanionId.value || "") === id) {
        setActiveCompanionId(null);
      }
      disconnect(id, reason || "leaveChat");
      try {
        useInboxWsStore().healAfterChatSocket(`leave:${reason || "chat"}`);
      } catch {
        /* ignore */
      }
    }, LEAVE_CHAT_DELAY_MS);
  }

  /** companionId → 开始握手时间戳；用于区分「正在连接」与「僵死」 */
  const connectingSince = {};
  /** 握手超过此时长仍未 onOpen，才允许当僵死强制重建 */
  const CONNECTING_STALE_MS = 10000;
  /** 应用层心跳：低于 30s/60s 网关空闲超时；链式 timeout 比 setInterval 更抗节流 */
  const HEARTBEAT_INTERVAL_MS = 12000;
  /** 已证明服务端会 pong 时，等下行超时则当僵尸连接 */
  const HEARTBEAT_TIMEOUT_MS = 10000;
  /** 心跳/下行都静默超过此时长（含 JS 被挂起）视为死连接 */
  const ALIVE_TIMEOUT_MS = 40000;
  const heartbeatTimers = {};
  const heartbeatWatchdogs = {};
  const lastRecvAt = {};
  const lastPingOkAt = {};
  const lastBeatAt = {};
  const pingSentAt = {};
  const pongSeen = {};
  /** 希望保持连接的 companion；LRU 驱逐时会剔除 */
  const trackedCompanionIds = new Set();
  /** companionId → 最近活跃时间戳（收发消息 / 进入聊天页） */
  const lastActiveAt = {};
  /** 前台恢复 / 语言切换时的错峰定时器列表 */
  let staggerTimers = [];
  let visibilityReconnectTimer = null;
  let languageReconnectTimer = null;
  const outbox = {};
  const queueNoticeSent = {};
  let persistTimer = null;
  const pendingPersist = {};
  let syncChannel = null;
  let suppressSync = false;
  /** companionId → 等待 AI 回复时的轮询 timer（离页后补拉落库消息） */
  const replyWatchTimers = {};
  const catchUpInFlight = {};

  function nextMsgId() {
    return msgIdCounter++;
  }

  /** 标记 companion 活跃，供 LRU 保留 */
  function touchActive(companionId) {
    if (!companionId) return;
    lastActiveAt[companionId] = Date.now();
  }

  function clearStaggerTimers() {
    for (const t of staggerTimers) clearTimeout(t);
    staggerTimers = [];
  }

  /**
   * 连接数超限时断开最久未活跃的连接（永不踢掉当前聊天页 companion）
   * @param {string} [protectId] 即将连接 / 必须保留的 id
   */
  function evictLruIfNeeded(protectId) {
    const openIds = Object.keys(connections);
    if (openIds.length < MAX_WS_CONNECTIONS) return;

    const protectedIds = new Set();
    if (protectId) protectedIds.add(protectId);
    if (activeCompanionId.value) protectedIds.add(activeCompanionId.value);
    for (const [id, typing] of Object.entries(typingCompanions.value || {})) {
      if (typing) protectedIds.add(id);
    }

    const victims = openIds
      .filter((id) => !protectedIds.has(id))
      .sort((a, b) => (lastActiveAt[a] || 0) - (lastActiveAt[b] || 0));

    const need = openIds.length - MAX_WS_CONNECTIONS + 1;
    for (let i = 0; i < need && i < victims.length; i++) {
      const id = victims[i];
      trackedCompanionIds.delete(id);
      disconnect(id);
    }
  }

  /**
   * 错峰重连一组 companion（前台恢复 / 切语言）
   * @param {Iterable<string>} ids
   * @param {number} [baseDelay=400]
   * @param {{ force?: boolean }} [opts] force=true 时强制拆掉已有连接再连（如切语言）
   */
  function reconnectTrackedStaggered(ids, baseDelay = 400, opts = {}) {
    clearStaggerTimers();
    const force = opts.force === true;
    const list = Array.from(ids).filter((cid) => {
      if (!cid) return false;
      if (!force && reconnectFailed.value[cid]) return false;
      if (!force && isSocketHealthy(cid)) return false;
      // 已在退避排队 / 握手中：勿插队，否则会打断 backoff 并烧掉重连次数
      if (!force && reconnectTimers[cid]) return false;
      const existing = connections[cid];
      const pendingTicket = !!(existing && existing._pendingTicket);
      if (!force && pendingTicket) return false;
      return true;
    });
    list.forEach((cid, idx) => {
      const jitter = Math.floor(Math.random() * 120);
      const t = setTimeout(() => {
        const needForce = force || (!!isConnected.value[cid] && !isSocketHealthy(cid));
        connect(cid, { force: needForce });
      }, baseDelay + idx * RECONNECT_STAGGER_MS + jitter);
      staggerTimers.push(t);
    });
  }

  function getLang() {
    return normalizeUiLang(i18n.global.locale.value);
  }

  function getUserGender() {
    try {
      const userInfoStr = getItem("user_info");
      return userInfoStr ? JSON.parse(userInfoStr).gender || "" : "";
    } catch {
      return "";
    }
  }

  function localeForTime() {
    return i18n.global.locale.value || "zh";
  }

  // ——— 消息列表操作 ———
  function appendMessages(newMsgs) {
    if (!newMsgs?.length) return;
    const base = messages.value ?? [];
    const next = [...base, ...newMsgs];
    messages.value =
      next.length > MAX_MESSAGES ? next.slice(-MESSAGE_TRIM_TARGET) : next;
  }

  /** 评论上限进私聊：把该动态卡片放到会话最底部（最新一条） */
  function placeMomentCardAtEnd(companionId, momentSnap) {
    const id = String(companionId || "");
    const snap = normalizeMomentCardData(momentSnap);
    if (!id || !snap) return false;
    const mid = String(snap.moment_id || "");
    const now = new Date().toISOString();
    const text = formatMomentBubbleText(snap, "") || snap.caption || "";
    messages.value = (messages.value || []).filter((m) => {
      if (String(m.companionId) !== id) return true;
      if (!m.momentData) return true;
      const existing = String(m.momentData.moment_id ?? m.momentData.id ?? "");
      return !mid || existing !== mid;
    });
    appendMessages([
      {
        id: mid ? `moment-im-${mid}` : `moment-im-${Date.now()}`,
        companionId: id,
        sender: "user",
        text,
        momentData: snap,
        time: formatNowMessageTime(localeForTime()),
        ts: now,
      },
    ]);
    const prev = lastMessages.value[id] || {};
    lastMessages.value = {
      ...lastMessages.value,
      [id]: {
        ...prev,
        text,
        time: formatNowMessageTime(localeForTime()),
        fullTime: now,
      },
    };
    return true;
  }

  function dismissMessage(id) {
    messages.value = (messages.value ?? []).filter((m) => m.id !== id);
    const next = { ...ephemeral.value };
    for (const cid of Object.keys(next)) {
      next[cid] = next[cid].filter((m) => m.id !== id);
      if (next[cid].length === 0) delete next[cid];
    }
    ephemeral.value = next;
  }

  function appendEphemeral(msg) {
    ephemeral.value = {
      ...ephemeral.value,
      [msg.companionId]: [...(ephemeral.value[msg.companionId] || []), msg],
    };
  }

  function flushOutboxForCompanion(companionId) {
    const task = connections[companionId];
    if (!task || !isConnected.value[companionId]) return;
    const pending = outbox[companionId];
    if (!pending?.length) return;
    const lang = getLang();
    const userGender = getUserGender();
    for (const queued of pending) {
      try {
        sendingMsgIds.value.add(queued.msgId);
        pendingMsgIds.value.delete(queued.msgId);
        // WS 调试日志：打印队列中补发的消息
        const queuedPayload = buildChatWsPayload(queued.text, lang, userGender);
        devLog("[WS send] queued:", queuedPayload);
        task.send({
          data: JSON.stringify(queuedPayload),
        });
        typingCompanions.value = {
          ...typingCompanions.value,
          [companionId]: true,
        };
        startReplyWatch(companionId);
      } catch (err) {
        console.error("发送队列消息失败:", err);
        sendingMsgIds.value.delete(queued.msgId);
        pendingMsgIds.value.add(queued.msgId);
        break;
      }
    }
    delete outbox[companionId];
    persistOutbox();
  }

  // ——— 未读 / 最后消息持久化（按 userId 分区）+ H5 BroadcastChannel ———
  function flushPersist() {
    const uid = activeStorageUserId || resolveChatUserId();
    if (pendingPersist.unread !== undefined) {
      setItem(unreadStorageKey(uid), JSON.stringify(pendingPersist.unread));
    }
    if (pendingPersist.last !== undefined) {
      setItem(lastMessagesStorageKey(uid), JSON.stringify(pendingPersist.last));
    }
    persistOutbox();
    pendingPersist.unread = undefined;
    pendingPersist.last = undefined;
    persistTimer = null;
  }

  function persistOutbox() {
    try {
      const uid = activeStorageUserId || resolveChatUserId();
      setItem(outboxStorageKey(uid), JSON.stringify(outbox));
    } catch {
      /* ignore */
    }
  }

  function loadOutboxFromStorage() {
    for (const k of Object.keys(outbox)) delete outbox[k];
    try {
      const raw = getItem(outboxStorageKey(activeStorageUserId || resolveChatUserId()));
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(outbox, parsed);
      }
    } catch {
      /* ignore */
    }
  }

  function schedulePersist(patch) {
    if (patch.unread !== undefined) pendingPersist.unread = patch.unread;
    if (patch.last !== undefined) pendingPersist.last = patch.last;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, 300);
  }

  function initFromStorage() {
    activeStorageUserId = resolveChatUserId();
    unreadCounts.value = {};
    lastMessages.value = {};
    lastReadFullTimes.value = {};
    const saved = getItem(unreadStorageKey(activeStorageUserId));
    if (saved) {
      try {
        unreadCounts.value = JSON.parse(saved) || {};
      } catch {
        /* ignore */
      }
    }
    const savedLast = getItem(lastMessagesStorageKey(activeStorageUserId));
    if (savedLast) {
      try {
        lastMessages.value = JSON.parse(savedLast) || {};
      } catch {
        /* ignore */
      }
    }
    loadOutboxFromStorage();
  }

  /** 切换账号时重载分区缓存，避免串会话 */
  function reloadForCurrentUser() {
    const next = resolveChatUserId();
    if (next === activeStorageUserId) return;
    if (persistTimer) {
      flushPersist();
    } else {
      persistOutbox();
    }
    activeStorageUserId = next;
    messages.value = [];
    disconnectAll();
    initFromStorage();
    try {
      if (getItem("user_token")) useInboxWsStore().ensureConnected();
    } catch {
      /* ignore */
    }
  }

  function clearCompanionMeta(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    const nextLast = { ...lastMessages.value };
    delete nextLast[id];
    lastMessages.value = nextLast;
    const nextUnread = { ...unreadCounts.value };
    delete nextUnread[id];
    unreadCounts.value = nextUnread;
    const nextRead = { ...lastReadFullTimes.value };
    delete nextRead[id];
    lastReadFullTimes.value = nextRead;
  }

  function clearTypingOnPaywall(companionId) {
    const id = String(companionId || activeCompanionId.value || "");
    if (!id) return;
    stopReplyWatch(id);
    if (typingCompanions.value[id]) {
      typingCompanions.value = {
        ...typingCompanions.value,
        [id]: false,
      };
    }
  }

  function triggerPaywall(payload) {
    clearTypingOnPaywall(payload?.companionId);
    paywall.value = {
      type: payload?.type || "need_recharge",
      reason: payload?.reason || "",
      balance: payload?.balance,
      companionId: payload?.companionId || "",
      ts: Date.now(),
    };
    try {
      uni.$emit("chat-paywall", paywall.value);
    } catch {
      /* ignore */
    }
  }

  function initBroadcastSync() {
    // #ifdef H5
    if (typeof BroadcastChannel === "undefined") return;
    syncChannel = new BroadcastChannel(CHAT_SYNC_CHANNEL);
    syncChannel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "meta") return;
      suppressSync = true;
      if (data.unreadCounts) unreadCounts.value = data.unreadCounts;
      if (data.lastMessages) lastMessages.value = data.lastMessages;
      setTimeout(() => {
        suppressSync = false;
      }, 0);
    };
    // #endif
  }

  function postMetaSync() {
    if (suppressSync || !syncChannel) return;
    // BroadcastChannel uses structured clone; Vue Proxies are not cloneable.
    try {
      syncChannel.postMessage({
        type: "meta",
        unreadCounts: JSON.parse(JSON.stringify(unreadCounts.value)),
        lastMessages: JSON.parse(JSON.stringify(lastMessages.value)),
      });
    } catch (err) {
      console.warn("chat meta sync failed:", err);
    }
  }

  /** 某会话已有 AI 回复后清掉用户气泡上的发送中转圈（离页时 WS 不会再推 typing/message） */
  function clearSendingForCompanion(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    const next = new Set(sendingMsgIds.value);
    let changed = false;
    for (const m of messages.value ?? []) {
      if (String(m.companionId) === id && m.sender === "user" && next.delete(m.id)) {
        changed = true;
      }
    }
    if (changed) sendingMsgIds.value = next;
  }

  function removeOutboxByMsgId(companionId, msgId) {
    const id = String(companionId || "");
    if (!id || msgId == null) return;
    const pending = outbox[id];
    if (!pending?.length) return;
    const next = pending.filter((q) => String(q.msgId) !== String(msgId));
    if (next.length === pending.length) return;
    if (next.length) outbox[id] = next;
    else delete outbox[id];
    persistOutbox();
  }

  /**
   * 超额已落库：用服务端 messages 对齐乐观气泡，标 sendStatus=unpaid。
   * 不进 pending/outbox 重试（再点发送会再落一条）。
   */
  function applyAcceptedUnpaidMessages(companionId, serverMessages, opts = {}) {
    const id = String(companionId || "");
    const rows = Array.isArray(serverMessages) ? serverMessages : [];
    if (!id) return false;
    const defaultStatus =
      String(opts.sendStatus || "unpaid").trim() === "unpaid" ? "unpaid" : "unpaid";
    const locale = localeForTime();
    let list = [...(messages.value ?? [])];
    const claimed = new Set();
    let changed = false;

    const markUnpaidAt = (idx, patch) => {
      const old = list[idx];
      if (!old) return;
      sendingMsgIds.value.delete(old.id);
      pendingMsgIds.value.delete(old.id);
      removeOutboxByMsgId(id, old.id);
      const nextId = patch.id != null ? patch.id : old.id;
      if (String(nextId) !== String(old.id)) {
        sendingMsgIds.value.delete(nextId);
        pendingMsgIds.value.delete(nextId);
        removeOutboxByMsgId(id, nextId);
      }
      list[idx] = {
        ...old,
        ...patch,
        id: nextId,
        sendStatus: defaultStatus,
      };
      claimed.add(String(nextId));
      claimed.add(String(old.id));
      changed = true;
    };

    for (const sm of rows) {
      const text = String(sm?.content ?? sm?.text ?? "").trim();
      const serverId =
        sm?.id != null && String(sm.id) !== "" ? sm.id : null;
      const ts =
        typeof sm?.timestamp === "string" && sm.timestamp
          ? sm.timestamp
          : new Date().toISOString();
      const time = sm?.timestamp
        ? formatMessageTime(sm.timestamp, locale)
        : formatNowMessageTime(locale);

      let matchIdx = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (String(m.companionId) !== id || m.sender !== "user") continue;
        if (m.momentData) continue;
        if (claimed.has(String(m.id))) continue;
        if (serverId != null && String(m.id) === String(serverId)) {
          matchIdx = i;
          break;
        }
        if ((m.text || "").trim() !== text) continue;
        if (m.sendStatus === "unpaid") continue;
        matchIdx = i;
        if (sendingMsgIds.value.has(m.id) || pendingMsgIds.value.has(m.id)) {
          break;
        }
      }

      if (matchIdx >= 0) {
        markUnpaidAt(matchIdx, {
          id: serverId != null ? serverId : list[matchIdx].id,
          text: text || list[matchIdx].text,
          ts,
          time: time || list[matchIdx].time,
        });
      } else if (serverId != null && text) {
        list.push({
          id: serverId,
          companionId: id,
          sender: "user",
          text,
          sendStatus: defaultStatus,
          time,
          ts,
        });
        changed = true;
        claimed.add(String(serverId));
      }
    }

    // messages 为空但已 accepted：把仍在发送中的用户气泡标 unpaid
    if (!rows.length) {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (String(m.companionId) !== id || m.sender !== "user") continue;
        if (m.momentData || m.sendStatus === "unpaid") continue;
        if (!sendingMsgIds.value.has(m.id) && !pendingMsgIds.value.has(m.id)) {
          continue;
        }
        markUnpaidAt(i, {});
      }
    }

    if (!changed) return false;
    sendingMsgIds.value = new Set(sendingMsgIds.value);
    pendingMsgIds.value = new Set(pendingMsgIds.value);
    messages.value = list;
    return true;
  }

  // ——— 历史 REST 与内存消息合并 ———
  function mergeHistoryMessages(companionId, incoming, mode) {
    const id = String(companionId || "");
    const trust = Boolean(trustServerInitial[id]);
    const { messages: next, consumedTrustServer } = mergeCompanionHistory(
      messages.value ?? [],
      id,
      incoming,
      mode,
      trust
    );
    if (consumedTrustServer) delete trustServerInitial[id];
    messages.value = next;
    const last = next.filter((m) => String(m.companionId) === id).pop();
    if (last && last.sender === "ai") clearSendingForCompanion(id);
  }

  function formatHistoryIncomingLocal(companionId, rawMessages) {
    return formatHistoryIncoming(companionId, rawMessages, localeForTime());
  }

  function stopReplyWatch(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    if (replyWatchTimers[id]) {
      clearTimeout(replyWatchTimers[id]);
      delete replyWatchTimers[id];
    }
  }

  /**
   * 离页/重连后补拉服务端已落库的新消息，避免生成完成时原 WS 已断而丢回复。
   */
  async function catchUpCompanionMessages(companionId) {
    const id = String(companionId || "");
    if (!id || catchUpInFlight[id]) return;
    catchUpInFlight[id] = true;
    try {
      const data = await apiFetch(`/companions/${id}/messages?limit=20&offset=0`);
      const raw = data?.messages || [];
      if (!raw.length) return;
      const formatted = formatHistoryIncomingLocal(id, raw);
      const beforeKeys = new Set(
        getCompanionMessages(id).map(messageContentKey)
      );
      const addedAi = formatted.filter(
        (m) => m.sender === "ai" && !beforeKeys.has(messageContentKey(m))
      );
      // 还没有新的 AI 回复就不要 merge：否则会把刚发出的乐观气泡换成服务端 id，nvue 整泡闪一下
      if (!addedAi.length) return;
      mergeHistoryMessages(id, formatted, "initial");
      clearSendingForCompanion(id);
      stopReplyWatch(id);
      typingCompanions.value = {
        ...typingCompanions.value,
        [id]: false,
      };
      const last = addedAi[addedAi.length - 1];
      const prevMeta = lastMessages.value[id] || {};
      let preview = last.text;
      try {
        if (isChatImageMessage(last)) {
          preview = formatChatImagePreviewText();
        }
      } catch {
        /* ignore */
      }
      lastMessages.value = {
        ...lastMessages.value,
        [id]: {
          ...prevMeta,
          text: preview,
          time: last.time || prevMeta.time || "",
          fullTime: last.ts || new Date().toISOString(),
        },
      };
      // 未读只认 /ws/inbox；此处只更新预览并结束 typing
    } catch (err) {
      console.warn("chat catch-up failed:", err);
    } finally {
      delete catchUpInFlight[id];
    }
  }

  function startReplyWatch(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    stopReplyWatch(id);
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      await catchUpCompanionMessages(id);
      // catch-up 找到回复时会 stopReplyWatch 并清 typing
      if (!replyWatchTimers[id]) return;
      if (attempts >= 48) {
        stopReplyWatch(id);
        typingCompanions.value = {
          ...typingCompanions.value,
          [id]: false,
        };
        return;
      }
      replyWatchTimers[id] = setTimeout(tick, 2500);
    };
    replyWatchTimers[id] = setTimeout(tick, 1800);
  }

  function stopHeartbeat(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    if (heartbeatTimers[id]) {
      clearTimeout(heartbeatTimers[id]);
      delete heartbeatTimers[id];
    }
    if (heartbeatWatchdogs[id]) {
      clearTimeout(heartbeatWatchdogs[id]);
      delete heartbeatWatchdogs[id];
    }
    delete pingSentAt[id];
  }

  function markRecv(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    lastRecvAt[id] = Date.now();
    if (heartbeatWatchdogs[id]) {
      clearTimeout(heartbeatWatchdogs[id]);
      delete heartbeatWatchdogs[id];
    }
  }

  function isSocketHealthy(companionId) {
    const id = String(companionId || "");
    if (!id || !isConnected.value[id]) return false;
    const existing = connections[id];
    if (!existing || existing._pendingTicket || typeof existing.send !== "function") {
      return false;
    }
    const last = Math.max(lastRecvAt[id] || 0, lastPingOkAt[id] || 0);
    if (!last) return true;
    return Date.now() - last < ALIVE_TIMEOUT_MS;
  }

  /**
   * ticket 申请中 / 已 bind 且仍在 connectingSince 窗口：视为握手中。
   */
  function isHandshaking(companionId) {
    const id = String(companionId || "");
    if (!id || isConnected.value[id]) return false;
    const existing = connections[id];
    if (existing && existing._pendingTicket) return true;
    const startedAt = connectingSince[id] || 0;
    if (startedAt && Date.now() - startedAt < CONNECTING_STALE_MS) return true;
    return false;
  }

  function sendJson(companionId, obj, { onFail, onSuccess } = {}) {
    const task = connections[companionId];
    if (!task || typeof task.send !== "function") {
      onFail?.("no-task");
      return false;
    }
    try {
      task.send({
        data: JSON.stringify(obj),
        success: () => onSuccess?.(),
        fail: () => onFail?.("send-fail"),
      });
      return true;
    } catch (err) {
      onFail?.(err);
      return false;
    }
  }

  function replyPong(companionId, src) {
    const pong = { type: "pong" };
    if (src && typeof src === "object") {
      if (src.ts != null) pong.ts = src.ts;
      if (src.id != null) pong.id = src.id;
    }
    sendJson(companionId, pong);
  }

  /**
   * @returns {boolean} true 表示已作为 ping/pong 处理完
   */
  function handlePingPongPayload(companionId, data, rawText) {
    const trimmed = String(rawText || "").trim();
    if (trimmed === "ping" || trimmed === '"ping"') {
      pongSeen[companionId] = true;
      replyPong(companionId);
      return true;
    }
    if (trimmed === "pong" || trimmed === '"pong"') {
      pongSeen[companionId] = true;
      return true;
    }
    if (!data || typeof data !== "object") return false;
    const t = data.type || data.event || data.action || data.cmd;
    if (t === "pong") {
      pongSeen[companionId] = true;
      return true;
    }
    if (t === "ping") {
      pongSeen[companionId] = true;
      replyPong(companionId, data);
      return true;
    }
    return false;
  }

  /**
   * 空闲超时 / 发送失败 / ping 无响应：拆掉僵尸连接并重连。
   * 不设 intentionallyClosed，让 onClose 走自动重连；若 onClose 丢失则自行补连。
   */
  const deadHandling = {};
  function handleDeadSocket(companionId, task, reason) {
    const id = String(companionId || "");
    if (!id) return;
    if (deadHandling[id]) return;
    deadHandling[id] = true;
    console.warn("[WS] dead socket", id, reason);
    stopHeartbeat(id);
    isConnected.value = { ...isConnected.value, [id]: false };
    if (task && connections[id] === task) {
      try {
        task.close({});
      } catch {
        /* ignore */
      }
    } else if (!task && connections[id]) {
      try {
        connections[id].close?.({});
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      delete deadHandling[id];
      if (intentionallyClosed[id]) return;
      if (isConnected.value[id]) return;
      if (reconnectTimers[id]) return;
      if (connections[id] && connections[id] !== task) return;
      if (connections[id] === task) delete connections[id];
      if (!connections[id]) connect(id);
    }, 200);
  }

  function pingCompanion(companionId) {
    const id = String(companionId || "");
    const task = connections[id];
    if (!id || !task || typeof task.send !== "function" || !isConnected.value[id]) {
      return;
    }
    if (heartbeatWatchdogs[id]) {
      clearTimeout(heartbeatWatchdogs[id]);
      delete heartbeatWatchdogs[id];
    }
    pingSentAt[id] = Date.now();
    const sent = sendJson(
      id,
      { type: "ping" },
      {
        onSuccess: () => {
          lastPingOkAt[id] = Date.now();
        },
        onFail: () => handleDeadSocket(id, task, "ping-fail"),
      }
    );
    // 部分 App 机型 send 不回调 success，先记一次，避免误判心跳失败
    if (sent) lastPingOkAt[id] = Date.now();
    heartbeatWatchdogs[id] = setTimeout(() => {
      delete heartbeatWatchdogs[id];
      const recv = lastRecvAt[id] || 0;
      const sent = pingSentAt[id] || 0;
      if (recv >= sent) return;
      // 服务端从不 pong：只靠 ping send 保活，不要拆健康连接
      if (!pongSeen[id]) return;
      handleDeadSocket(id, task, "pong-timeout");
    }, HEARTBEAT_TIMEOUT_MS);
  }

  function heartbeatTick(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    const now = Date.now();
    const prevBeat = lastBeatAt[id] || 0;
    lastBeatAt[id] = now;
    const isActive = String(activeCompanionId.value || "") === id;
    if (prevBeat && now - prevBeat > HEARTBEAT_INTERVAL_MS * 2.5) {
      console.warn("[WS] heartbeat gap, reconnect", id, now - prevBeat);
      handleDeadSocket(id, connections[id], "js-thaw");
    } else if (!isConnected.value[id] || !connections[id]) {
      if (isActive && !intentionallyClosed[id]) {
        connect(id);
      } else if (!isActive) {
        stopHeartbeat(id);
        return;
      }
    } else if (pongSeen[id] && now - (lastRecvAt[id] || 0) > ALIVE_TIMEOUT_MS) {
      handleDeadSocket(id, connections[id], "alive-timeout");
    } else {
      pingCompanion(id);
    }
    heartbeatTimers[id] = setTimeout(
      () => heartbeatTick(id),
      HEARTBEAT_INTERVAL_MS
    );
  }

  function startHeartbeat(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    stopHeartbeat(id);
    const now = Date.now();
    lastRecvAt[id] = now;
    lastPingOkAt[id] = now;
    lastBeatAt[id] = now;
    heartbeatTimers[id] = setTimeout(() => heartbeatTick(id), 1500);
  }

  function resetReconnectGate(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    reconnectAttempts[id] = 0;
    if (reconnectTimers[id]) {
      clearTimeout(reconnectTimers[id]);
      delete reconnectTimers[id];
    }
    if (!reconnectFailed.value[id]) return;
    const next = { ...reconnectFailed.value };
    delete next[id];
    reconnectFailed.value = next;
  }

  /**
   * 用户仍在聊天页时保证有活连接：打字/聚焦/发送/回前台/健康检查调用。
   * 已连通但心跳/下行过久（僵尸连接）则强制重建。
   */
  function ensureConnected(companionId, opts = {}) {
    const id = String(companionId || "");
    if (!id) return;
    // 正在离开：禁止补连（也不要 cancelLeave——只有 noteChatPageShow 能取消）
    if (leaveChatTimers[id] && !chatPagePresent[id]) {
      console.log("[WS] ensureConnected 跳过：正在离开聊天页", id);
      return;
    }
    const fromUser = opts.fromUser === true;
    trackedCompanionIds.add(id);
    touchActive(id);
    if (fromUser) resetReconnectGate(id);

    const reallyOpen = !!isConnected.value[id];
    const existing = connections[id];
    const pendingTicket = !!(existing && existing._pendingTicket);
    const awaitingOpen = !!(
      existing &&
      typeof existing.send === "function" &&
      !reallyOpen &&
      connectingSince[id]
    );
    const startedAt = connectingSince[id] || 0;
    const connectingAge = startedAt ? Date.now() - startedAt : 0;

    // 正在申请 ticket / 已绑定等 onOpen：绝不再开一条，避免 seq 被踩掉
    if (isHandshaking(id)) {
      console.log("[WS] ensureConnected 跳过：握手中", id, {
        pendingTicket,
        awaitingOpen,
        connectingAge,
      });
      return;
    }

    // onOpen 后若标志位被误清但 SocketTask 仍在：拉回，勿拆连重连
    if (
      !reallyOpen &&
      existing &&
      typeof existing.send === "function" &&
      !existing._pendingTicket
    ) {
      console.log("[WS] ensureConnected 修复：task 仍在，恢复 isConnected", id);
      isConnected.value = { ...isConnected.value, [id]: true };
      markRecv(id);
      return;
    }

    if (isSocketHealthy(id)) return;

    console.log("[WS] ensureConnected 补连", id, {
      fromUser,
      reallyOpen,
      healthy: isSocketHealthy(id),
    });
    // 仅真正开着的僵尸连接才 force；勿对 pending / 等 onOpen 的 task force
    connect(id, { force: reallyOpen });
  }

  // ——— WebSocket 连接 / 收消息 / 指数退避重连 ———
  /**
   * @param {string} companionId
   * @param {{ force?: boolean }} [opts] force=true 时关掉已有连接再重建（切语言等）
   */
  function connect(companionId, opts = {}) {
    if (!companionId) {
      console.warn("[WS] connect 跳过：companionId 为空");
      return;
    }
    if (leaveChatTimers[companionId] && !chatPagePresent[companionId]) {
      console.log("[WS] connect 跳过：正在离开聊天页", companionId);
      return;
    }
    const force = opts.force === true;
    // 已判定失败：禁止消息页/前后台继续狂连；仅 manualReconnect(force) 可再试
    if (!force && reconnectFailed.value[companionId]) {
      console.log("[WS] connect 跳过：reconnectFailed", companionId);
      return;
    }
    // 退避定时器已挂起：勿被 onAppShow 插队提前连
    if (!force && reconnectTimers[companionId]) {
      console.log("[WS] connect 跳过：等待退避重连", companionId);
      return;
    }

    const existing = connections[companionId];
    const reallyOpen = !!isConnected.value[companionId];
    const pendingTicket = !!(existing && existing._pendingTicket);
    const awaitingOpen = !!(
      existing &&
      typeof existing.send === "function" &&
      !reallyOpen
    );
    const startedAt = connectingSince[companionId] || 0;
    const connectingAge = startedAt ? Date.now() - startedAt : 0;
    const stillHandshaking = isHandshaking(companionId);

    // 已在握手：一律不拆（含 force/manualReconnect）。超时由 handshakeTimer 收尾，避免 seq 风暴
    if (stillHandshaking) {
      console.log("[WS] connect 跳过：握手中", {
        companionId,
        force,
        pendingTicket,
        awaitingOpen,
        connectingAge,
      });
      return;
    }

    // 非 force：已连接则直接返回
    if (!force && reallyOpen) {
      console.log("[WS] connect 跳过", {
        companionId,
        pendingTicket,
        isConnected: reallyOpen,
        stillHandshaking,
        connectingAge,
      });
      return;
    }

    trackedCompanionIds.add(companionId);
    touchActive(companionId);

    if (reconnectTimers[companionId]) {
      clearTimeout(reconnectTimers[companionId]);
      delete reconnectTimers[companionId];
    }

    // 先占坑再关旧连接，避免中间空窗被另一路 ensureConnected 插队
    const prevTask =
      existing && !existing._pendingTicket && typeof existing.close === "function"
        ? existing
        : null;
    stopHeartbeat(companionId);
    if (prevTask) {
      console.log("[WS] 关闭旧连接后重建", companionId, { force });
      // 只作废旧代回调，不要标 intentionallyClosed：否则异步 ticket 会误判「已关闭」
      connectSeq[companionId] = (connectSeq[companionId] || 0) + 1;
      try {
        prevTask.close({});
      } catch {
        /* ignore */
      }
    }

    intentionallyClosed[companionId] = false;
    const seq = (connectSeq[companionId] = (connectSeq[companionId] || 0) + 1);
    connections[companionId] = { _pendingTicket: true };
    connectingSince[companionId] = Date.now();
    isConnected.value = { ...isConnected.value, [companionId]: false };

    // 新连接前腾出槽位，避免人均连接膨胀压垮服务端
    evictLruIfNeeded(companionId);

    const lang = getLang();
    const token = getItem("user_token") || "";
    const origin = getWsOrigin();

    console.log("[WS] connect 开始", {
      companionId,
      force,
      seq,
      origin,
      lang,
      hasToken: !!token,
      tokenLen: token.length,
      attempt: reconnectAttempts[companionId] || 0,
      envWs: (import.meta.env.VITE_WS_URL || "").trim() || "(empty)",
      envApi: (import.meta.env.VITE_API_BASE_URL || "").trim() || "(empty)",
    });

    // 以 seq 判定当前代；勿要求 connections===task，否则 onError 先 delete 后 onClose 会被当成过期丢掉 close code
    const isCurrentSeq = () => connectSeq[companionId] === seq;

    const scheduleReconnect = (reason) => {
      if (intentionallyClosed[companionId]) return;
      if (reconnectTimers[companionId]) return;
      if (!isCurrentSeq()) return;
      if (reconnectFailed.value[companionId]) return;
      const attempts = reconnectAttempts[companionId] || 0;
      const isActive =
        String(activeCompanionId.value || "") === String(companionId);
      if (attempts >= 5 && !isActive) {
        console.error("[WS] 重连次数耗尽，停止自动重连", companionId, {
          reason,
          attempts,
        });
        reconnectFailed.value = {
          ...reconnectFailed.value,
          [companionId]: true,
        };
        delete connectingSince[companionId];
        return;
      }
      const next = attempts + 1;
      reconnectAttempts[companionId] = next;
      // 当前聊天页：立刻补连，退避封顶 3s，避免干等 15s
      const delay = isActive
        ? attempts === 0
          ? 200
          : Math.min(reconnectDelayMs(Math.min(attempts, 2)), 3000)
        : reconnectDelayMs(attempts);
      console.log("[WS] 将重连", companionId, {
        reason,
        attempt: next,
        delayMs: delay,
        isActive,
      });
      reconnectTimers[companionId] = setTimeout(
        () => connect(companionId),
        delay
      );
    };

    const finalizeSocketFailure = (task, reason) => {
      if (!isCurrentSeq()) return;
      stopHeartbeat(companionId);
      delete connectingSince[companionId];
      isConnected.value = { ...isConnected.value, [companionId]: false };
      if (!replyWatchTimers[companionId]) {
        typingCompanions.value = {
          ...typingCompanions.value,
          [companionId]: false,
        };
      }
      if (connections[companionId] === task) {
        delete connections[companionId];
      }
      scheduleReconnect(reason);
    };

    const bindSocketTask = (task, urlForLog) => {
      if (!isCurrentSeq() || intentionallyClosed[companionId]) {
        console.log("[WS] bind 时已过期，关闭", companionId, { seq });
        try {
          task?.close?.({});
        } catch {
          /* ignore */
        }
        return;
      }
      if (!task || typeof task.onOpen !== "function") {
        console.error("[WS] bindSocketTask 失败：未拿到 SocketTask", {
          companionId,
          taskType: typeof task,
          url: urlForLog,
        });
        scheduleReconnect("no-socket-task");
        return;
      }
      connections[companionId] = task;
      connectingSince[companionId] = Date.now();
      console.log("[WS] SocketTask 已绑定，等待 onOpen", companionId, urlForLog);

      // 部分机型只打 onError、迟迟不 onClose：超时兜底，避免卡在 stillHandshaking
      const handshakeTimer = setTimeout(() => {
        if (!isCurrentSeq()) return;
        if (isConnected.value[companionId]) return;
        if (connections[companionId] !== task) return;
        console.warn("[WS] 握手超时未 onOpen", companionId, { seq });
        try {
          task.close({});
        } catch {
          /* ignore */
        }
        finalizeSocketFailure(task, "handshake-timeout");
      }, 8000);

      task.onOpen((res) => {
        clearTimeout(handshakeTimer);
        if (!isCurrentSeq() || connections[companionId] !== task) {
          console.log("[WS] onOpen 忽略过期 task", companionId);
          return;
        }
        console.log("[WS] onOpen 成功", companionId, res || {});
        delete connectingSince[companionId];
        if (reconnectTimers[companionId]) {
          clearTimeout(reconnectTimers[companionId]);
          delete reconnectTimers[companionId];
        }
        isConnected.value = { ...isConnected.value, [companionId]: true };
        reconnectAttempts[companionId] = 0;
        pongSeen[companionId] = false;
        markRecv(companionId);
        startHeartbeat(companionId);
        if (reconnectFailed.value[companionId]) {
          const nextFailed = { ...reconnectFailed.value };
          delete nextFailed[companionId];
          reconnectFailed.value = nextFailed;
        }
        queueNoticeSent[companionId] = false;
        touchActive(companionId);
        flushOutboxForCompanion(companionId);
        if (replyWatchTimers[companionId] || typingCompanions.value[companionId]) {
          catchUpCompanionMessages(companionId);
        }
        // 部分机型新 chat WS 会挤掉 inbox：连上后立刻探活/重连 inbox
        try {
          useInboxWsStore().healAfterChatSocket("chat-onOpen");
        } catch {
          /* ignore */
        }
      });

      task.onMessage((event) => {
        if (!isCurrentSeq() || connections[companionId] !== task) return;
        try {
          console.log(
            "[WS] onMessage",
            companionId,
            typeof event?.data,
            String(event?.data || "").slice(0, 200)
          );
          devLog("[WS recv] raw:", event.data);
          markRecv(companionId);
          const rawText = String(event?.data || "");
          let data = null;
          try {
            data = JSON.parse(event.data);
          } catch {
            data = null;
          }
          if (handlePingPongPayload(companionId, data, rawText)) {
            return;
          }
          if (!data) {
            console.error("[WS] 解析消息失败:", companionId, event?.data);
            return;
          }
          devLog("[WS recv] parsed:", data);
          touchActive(companionId);
          applyChatWsPayload(data, {
            companionId,
            locale: localeForTime(),
            messages,
            sendingMsgIds,
            typingCompanions,
            lastMessages,
            unreadCounts,
            activeCompanionId,
            freeTurnsRemaining,
            ourMomentsTip,
            paywallMomentsTip,
            nextMsgId,
            appendEphemeral,
            dismissMessage,
            appendMessages,
            stopReplyWatch,
            triggerPaywall,
            applyAcceptedUnpaidMessages,
            setOurMomentsTip,
            setOurMomentsProgress,
            captureMomentsTipForPaywall,
            setPaywallMomentsTip,
          });
        } catch (e) {
          console.error("[WS] 解析消息失败:", companionId, e, event?.data);
        }
      });

      task.onError((err) => {
        // App 端 err 经常是 {}；真正原因看随后 onClose.code
        console.error("[WS] onError", companionId, {
          seq,
          currentSeq: isCurrentSeq(),
          errMsg: err?.errMsg,
          message: err?.message,
          errJson: (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })(),
        });
        if (!isCurrentSeq()) return;
        isConnected.value = { ...isConnected.value, [companionId]: false };
        // 先等 onClose（约 300ms）；若只有 onError，再兜底重连
        setTimeout(() => {
          if (!isCurrentSeq()) return;
          if (connections[companionId] !== task) return;
          clearTimeout(handshakeTimer);
          finalizeSocketFailure(task, "onError-deferred");
        }, 300);
      });

      task.onClose((res) => {
        clearTimeout(handshakeTimer);
        const code = res?.code;
        const reason = res?.reason;
        // 始终先打日志（即便 seq 已过期，也便于对照谁掐了连接）
        console.warn("[WS] onClose", companionId, {
          code,
          reason,
          wasClean: res?.wasClean,
          seq,
          currentSeq: isCurrentSeq(),
          intentionallyClosed: !!intentionallyClosed[companionId],
          resJson: (() => {
            try {
              return JSON.stringify(res || {});
            } catch {
              return String(res);
            }
          })(),
        });
        if (!isCurrentSeq()) return;
        finalizeSocketFailure(task, `onClose:${code ?? "?"}`);
      });
    };

    // App / H5 统一：先取 ws-ticket 再连（App 仅靠 header 在部分机型会直接 onError 且 err 为空）
    // 必须传 complete/success/fail 之一，才会同步返回 SocketTask（否则是 Promise）
    // connections/_pendingTicket 已在上方占坑
    (async () => {
      console.log("[WS] 开始申请 ws-ticket", companionId, "seq=", seq);
      let ticket = "";
      try {
        const body = await apiFetch("/api/auth/ws-ticket", { method: "POST" });
        const data =
          body?.results && typeof body.results === "object"
            ? body.results
            : body?.data && typeof body.data === "object"
              ? body.data
              : body;
        ticket =
          data?.ticket ||
          body?.ticket ||
          body?.data?.ticket ||
          body?.results?.ticket ||
          "";
        console.log("[WS] ws-ticket 第1次", {
          ok: !!ticket,
          ticketLen: ticket.length,
          ticketPreview: ticket ? `${String(ticket).slice(0, 8)}...` : "",
          bodyKeys: body && typeof body === "object" ? Object.keys(body) : typeof body,
          dataKeys: data && typeof data === "object" ? Object.keys(data) : typeof data,
        });
      } catch (e) {
        console.warn("[WS] ws-ticket 第1次失败", e);
      }
      if (!ticket) {
        try {
          const body2 = await apiFetch("/api/auth/ws-ticket", { method: "POST" });
          ticket =
            body2?.ticket ||
            body2?.data?.ticket ||
            body2?.results?.ticket ||
            "";
          console.log("[WS] ws-ticket 第2次", {
            ok: !!ticket,
            ticketLen: ticket.length,
          });
        } catch (e) {
          console.warn("[WS] ws-ticket 第2次失败", e);
        }
      }
      if (connectSeq[companionId] !== seq || intentionallyClosed[companionId]) {
        console.log("[WS] ticket 返回后已过期/已关闭，放弃连接", {
          companionId,
          seq,
          currentSeq: connectSeq[companionId],
          intentionallyClosed: !!intentionallyClosed[companionId],
        });
        return;
      }
      if (!ticket && !token) {
        console.error("[WS] 无 ticket 且无 token，标记 reconnectFailed", companionId);
        reconnectFailed.value = {
          ...reconnectFailed.value,
          [companionId]: true,
        };
        delete connections[companionId];
        delete connectingSince[companionId];
        return;
      }
      const parts = [`lang=${encodeURIComponent(lang)}`];
      // 浏览器/部分 App 原生 WS 不宜自定义 Header，版本号走 query（与 X-App-Version 对齐）
      const appVersion = getAppVersion();
      if (appVersion) {
        parts.push(`app_version=${encodeURIComponent(appVersion)}`);
      }
      if (ticket) parts.push(`ticket=${encodeURIComponent(ticket)}`);
      // #ifndef H5
      // App：ticket 缺失时把 token 放 query 兜底
      if (!ticket && token) parts.push(`token=${encodeURIComponent(token)}`);
      // #endif
      const wsUrl = `${origin}/ws/chat/${companionId}?${parts.join("&")}`;
      const logUrl = wsUrl
        .replace(/ticket=[^&]+/, "ticket=***")
        .replace(/token=[^&]+/, "token=***");
      // 有 ticket 时不要带自定义 header：部分 Android 原生 WS 升级会因额外头直接 onError(空对象)
      const socketHeader = ticket ? {} : token ? { "x-token": token } : {};
      console.log(
        "[WS] connectSocket",
        logUrl,
        "headerKeys=",
        Object.keys(socketHeader)
      );
      // method/GET + complete 保证 App 同步返回 SocketTask；multiple 允许多路并存
      const connectOpts = {
        url: wsUrl,
        header: socketHeader,
        method: "GET",
        complete: () => {},
        fail: (err) => {
          console.error("[WS] connectSocket fail 回调", companionId, err);
        },
      };
      // #ifdef APP-PLUS
      connectOpts.multiple = true;
      // #endif
      if (typeof plus !== "undefined") {
        connectOpts.multiple = true;
      }
      const task = uni.connectSocket(connectOpts);
      if (connectSeq[companionId] !== seq || intentionallyClosed[companionId]) {
        console.log("[WS] SocketTask 创建后已过期，关闭", companionId);
        try {
          task.close({});
        } catch {
          /* ignore */
        }
        return;
      }
      bindSocketTask(task, logUrl);
    })();
  }

  function disconnect(companionId, reason = "") {
    const id = String(companionId || "");
    if (!id) return;
    cancelLeaveChat(id);
    console.warn("[WS] disconnect", id, reason || "");
    intentionallyClosed[id] = true;
    connectSeq[id] = (connectSeq[id] || 0) + 1;
    trackedCompanionIds.delete(id);
    delete lastActiveAt[id];
    stopHeartbeat(id);
    const waitingReply =
      !!typingCompanions.value[id] || !!replyWatchTimers[id];
    stopReplyWatch(id);
    // typing 保留到 catch-up 拿到 AI 回复再清（Messages 继续显示 typing...）
    delete connectingSince[id];
    delete chatPagePresent[id];
    if (reconnectTimers[id]) {
      clearTimeout(reconnectTimers[id]);
      delete reconnectTimers[id];
    }
    const task = connections[id];
    if (task) {
      try {
        task.close({});
      } catch {
        /* ignore */
      }
      delete connections[id];
    }
    isConnected.value = { ...isConnected.value, [id]: false };
    // AI 还在生成：断 chat WS 后继续 poll，回复落地后再清 typing / 补未读
    if (waitingReply) {
      if (!typingCompanions.value[id]) {
        typingCompanions.value = {
          ...typingCompanions.value,
          [id]: true,
        };
      }
      startReplyWatch(id);
    }
  }

  function disconnectAll() {
    clearStaggerTimers();
    for (const cid of Object.keys(replyWatchTimers)) {
      stopReplyWatch(cid);
    }
    for (const cid of Object.keys(heartbeatTimers)) stopHeartbeat(cid);
    for (const cid of Object.keys(heartbeatWatchdogs)) stopHeartbeat(cid);
    for (const cid of Object.keys(connections)) {
      intentionallyClosed[cid] = true;
      if (reconnectTimers[cid]) {
        clearTimeout(reconnectTimers[cid]);
        delete reconnectTimers[cid];
      }
      try {
        connections[cid]?.close({});
      } catch {
        /* ignore */
      }
      delete connections[cid];
      delete connectingSince[cid];
      connectSeq[cid] = (connectSeq[cid] || 0) + 1;
    }
    trackedCompanionIds.clear();
    for (const k of Object.keys(lastActiveAt)) delete lastActiveAt[k];
    isConnected.value = {};
    typingCompanions.value = {};
    stopActiveWatch();
    try {
      useInboxWsStore().disconnect();
    } catch {
      /* ignore */
    }
  }

  // ——— 发送（含离线 outbox） ———
  /** 写入会话预览元信息（名字/头像），发消息或进聊天页时调用，保证消息列表能拼出条目 */
  function setConversationMeta(companionId, meta = {}) {
    reloadForCurrentUser();
    const id = String(companionId || "");
    if (!id) return;
    const prev = lastMessages.value[id] || {};
    const name = meta.name != null ? String(meta.name) : prev.name || "";
    const avatar = meta.avatar != null ? String(meta.avatar) : prev.avatar || "";
    if (!name && !avatar && !prev.text) return;
    if (name === (prev.name || "") && avatar === (prev.avatar || "")) return;
    lastMessages.value = {
      ...lastMessages.value,
      [id]: {
        ...prev,
        name,
        avatar,
        text: prev.text || "",
        time: prev.time || "",
        fullTime: prev.fullTime || "",
      },
    };
  }

  async function sendViaRest(companionId, text, msgId) {
    const id = String(companionId || "");
    try {
      const payload = buildChatWsPayload(text, getLang(), getUserGender());
      const body = await apiFetch(`/api/chat/${encodeURIComponent(id)}/turns`, {
        method: "POST",
        data: payload,
      });
      const jobId =
        body?.job_id || body?.data?.job_id || body?.results?.job_id || "";
      if (!jobId) throw new Error("no job_id");
      const polled = await pollChatTurnJob(apiFetch, jobId);
      if (!polled.ok) throw new Error(polled.error || "job failed");
      sendingMsgIds.value.delete(msgId);
      typingCompanions.value = {
        ...typingCompanions.value,
        [id]: false,
      };
      await catchUpCompanionMessages(id);
      refreshUserCreditsQuietly();
      return;
    } catch (err) {
      sendingMsgIds.value.delete(msgId);
      typingCompanions.value = {
        ...typingCompanions.value,
        [id]: false,
      };
      // 402 超额已落库：标 unpaid，不要当失败进 outbox 重试
      if (Number(err?.status) === 402 || Number(err?.status) === 403) {
        const detail =
          err?.detail && typeof err.detail === "object"
            ? err.detail
            : err?.body && typeof err.body === "object"
              ? err.body
              : {};
        if (detail.accepted === true) {
          applyAcceptedUnpaidMessages(id, detail.messages, {
            sendStatus: detail.send_status || "unpaid",
          });
          return;
        }
      }
      pendingMsgIds.value.add(msgId);
      const locale = localeForTime();
      appendMessages([
        {
          id: nextMsgId(),
          companionId: id,
          sender: "system",
          text: i18n.global.t("chat.messageQueued"),
          time: formatNowMessageTime(locale),
          ts: new Date().toISOString(),
        },
      ]);
      const pending = outbox[id] || [];
      pending.push({ text, msgId });
      outbox[id] = pending;
      persistOutbox();
    }
  }

  function sendMessage(companionId, text, meta = {}) {
    reloadForCurrentUser();
    touchActive(companionId);
    const locale = localeForTime();
    const msgId = nextMsgId();
    appendMessages([
      {
        id: msgId,
        companionId,
        sender: "user",
        text,
        time: formatNowMessageTime(locale),
        ts: new Date().toISOString(),
      },
    ]);
    const prevMeta = lastMessages.value[companionId] || {};
    lastMessages.value = {
      ...lastMessages.value,
      [companionId]: {
        text,
        time: formatNowMessageTime(locale),
        fullTime: new Date().toISOString(),
        name: meta.name || prevMeta.name || "",
        avatar: meta.avatar || prevMeta.avatar || "",
      },
    };

    ensureConnected(companionId, { fromUser: true });

    const task = connections[companionId];
    const lang = getLang();
    const userGender = getUserGender();
    const canSend =
      task &&
      typeof task.send === "function" &&
      isConnected.value[companionId];

    const queueForReconnect = () => {
      sendingMsgIds.value.delete(msgId);
      pendingMsgIds.value.add(msgId);
      const pending = outbox[companionId] || [];
      pending.push({ text, msgId });
      outbox[companionId] = pending;
      persistOutbox();
      if (!queueNoticeSent[companionId]) {
        queueNoticeSent[companionId] = true;
        appendMessages([
          {
            id: nextMsgId(),
            companionId,
            sender: "system",
            text: i18n.global.t("chat.messageQueued"),
            time: formatNowMessageTime(locale),
            ts: new Date().toISOString(),
          },
        ]);
      }
    };

    if (canSend) {
      flushOutboxForCompanion(companionId);
      try {
        sendingMsgIds.value.add(msgId);
        const payload = buildChatWsPayload(text, lang, userGender);
        devLog("[WS send] new:", payload);
        task.send({
          data: JSON.stringify(payload),
          fail: () => {
            console.warn("[WS] send fail，排队并重连", companionId);
            queueForReconnect();
            handleDeadSocket(companionId, task, "send-fail");
          },
        });
        typingCompanions.value = {
          ...typingCompanions.value,
          [companionId]: true,
        };
        startReplyWatch(companionId);
        refreshUserCreditsQuietly();
      } catch (err) {
        console.error("发送消息失败:", err);
        queueForReconnect();
        handleDeadSocket(companionId, task, "send-throw");
      }
    } else {
      queueForReconnect();
      connect(companionId);
    }
    return true;
  }

  /**
   * inbox 推送未读：回复已落库，结束 typing，并 catch-up 刷新预览。
   * 未读数本身由 inboxWs 写入 unreadCounts，这里不改计数。
   */
  function onInboxUnread(companionId, unreadCount) {
    const id = String(companionId || "");
    if (!id) return;
    const n = Math.max(0, Number(unreadCount) || 0);
    if (n <= 0) return;
    if (typingCompanions.value[id]) {
      typingCompanions.value = {
        ...typingCompanions.value,
        [id]: false,
      };
    }
    stopReplyWatch(id);
    clearSendingForCompanion(id);
    void catchUpCompanionMessages(id);
  }

  function hasPendingOutbox(companionId) {
    const id = String(companionId || "");
    return Boolean(id && (outbox[id] || []).length);
  }

  function clearUnread(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    const prevCount = unreadCounts.value[id] || 0;
    const next = { ...unreadCounts.value };
    delete next[id];
    unreadCounts.value = next;
    const lm = lastMessages.value[id];
    const readAt = lm?.fullTime || new Date().toISOString();
    lastReadFullTimes.value = { ...lastReadFullTimes.value, [id]: readAt };
    try {
      useInboxWsStore().optimisticClear(id, prevCount);
    } catch {
      /* ignore */
    }
  }

  /**
   * 消息列表：用服务端 last_message 同步预览（未读默认不 bump，只走 /ws/inbox）。
   * 内容未变时绝不写 store，避免消息页 watch ↔ sync 死循环。
   */
  function syncRemotePreview(companionId, text, fullTime, { bumpUnread = false } = {}) {
    const id = String(companionId || "");
    if (!id || !text) return;
    // moment JSON 预览友好化
    let preview = text;
    if (typeof text === "string" && text.trim().startsWith("{")) {
      try {
        preview = formatMomentBubbleText(JSON.parse(text), "");
      } catch {
        preview = formatMomentBubbleText(null, text);
      }
    }
    if (!preview) return;

    const prev = lastMessages.value[id];
    const prevTs = prev?.fullTime || "";
    const remoteMs = fullTime ? Date.parse(fullTime) : NaN;
    const localMs = prevTs ? Date.parse(prevTs) : NaN;
    const remoteValid = !Number.isNaN(remoteMs);
    const localValid = !Number.isNaN(localMs);

    // 本地更新：刚发出尚未落库 / AI 未回，绝不被服务端旧预览盖掉
    if (localValid && remoteValid && localMs > remoteMs) {
      return;
    }
    if (localValid && !remoteValid && prev?.text) {
      return;
    }

    const nextFullTime = fullTime || prev?.fullTime || new Date().toISOString();
    // 仅在文案或时间真正变化时写预览；时间相等且文案相同必须 no-op
    const shouldUpdatePreview =
      !prev ||
      prev.text !== preview ||
      (Boolean(fullTime) && prev.fullTime !== fullTime);

    const readTs = lastReadFullTimes.value[id] || "";
    const readMs = readTs ? Date.parse(readTs) : NaN;
    const alreadyRead =
      !Number.isNaN(readMs) &&
      ((remoteValid && remoteMs <= readMs) ||
        (!remoteValid && prev?.text === preview));
    // 未读只在「严格更新」时补一次，避免读完返回列表被同条 last_message 再次打角标
    const strictlyNewer =
      !alreadyRead &&
      (!localValid ||
        (remoteValid && remoteMs > localMs) ||
        (!remoteValid && prev?.text !== preview));

    if (shouldUpdatePreview) {
      lastMessages.value = {
        ...lastMessages.value,
        [id]: {
          text: preview,
          time: prev?.time || "",
          fullTime: nextFullTime,
          name: prev?.name || "",
          avatar: prev?.avatar || "",
        },
      };
    }
    if (bumpUnread && strictlyNewer && activeCompanionId.value !== id) {
      const cur = unreadCounts.value[id] || 0;
      if (cur < 1) {
        unreadCounts.value = { ...unreadCounts.value, [id]: 1 };
      }
    }
  }

  function clearMessages(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    const companionMsgs = (messages.value ?? []).filter(
      (m) => String(m.companionId) === id
    );
    for (const m of companionMsgs) {
      sendingMsgIds.value.delete(m.id);
      pendingMsgIds.value.delete(m.id);
    }
    messages.value = (messages.value ?? []).filter(
      (m) => String(m.companionId) !== id
    );
    const nextLast = { ...lastMessages.value };
    delete nextLast[id];
    lastMessages.value = nextLast;
    const nextUnread = { ...unreadCounts.value };
    delete nextUnread[id];
    unreadCounts.value = nextUnread;
    const nextRead = { ...lastReadFullTimes.value };
    delete nextRead[id];
    lastReadFullTimes.value = nextRead;
    delete outbox[id];
    persistOutbox();
    queueNoticeSent[id] = false;
    const nextEphemeral = { ...ephemeral.value };
    delete nextEphemeral[id];
    ephemeral.value = nextEphemeral;
    trustServerInitial[id] = true;
    historyEpoch.value = {
      ...historyEpoch.value,
      [id]: (historyEpoch.value[id] || 0) + 1,
    };
  }

  function getCompanionMessages(companionId) {
    const id = String(companionId || "");
    return (messages.value ?? []).filter((m) => String(m.companionId) === id);
  }

  function getDisplayMessages(companionId) {
    const id = String(companionId || "");
    const base = getCompanionMessages(id);
    const extra = ephemeral.value[id] || [];
    return extra.length ? [...base, ...extra] : base;
  }

  let activeWatchTimer = null;
  function stopActiveWatch() {
    if (!activeWatchTimer) return;
    clearTimeout(activeWatchTimer);
    activeWatchTimer = null;
  }
  function startActiveWatch() {
    stopActiveWatch();
    const loop = () => {
      activeWatchTimer = setTimeout(loop, 8000);
      const id = String(activeCompanionId.value || "");
      if (!id || intentionallyClosed[id]) return;
      if (!chatPagePresent[id]) {
        syncChatPresenceFromRoute("active-watch");
        return;
      }
      if (leaveChatTimers[id]) return;
      if (isSocketHealthy(id)) return;
      if (isHandshaking(id)) return;
      console.warn("[WS] active watch 补连", id, {
        connected: !!isConnected.value[id],
        lastRecv: lastRecvAt[id] || 0,
        lastPingOk: lastPingOkAt[id] || 0,
      });
      ensureConnected(id);
    };
    activeWatchTimer = setTimeout(loop, 8000);
  }

  function setActiveCompanionId(id) {
    activeCompanionId.value = id;
    if (id) {
      // 不在这里 cancelLeave：键盘/AppShow 误 setActive 会把真离开吃掉
      touchActive(id);
      startActiveWatch();
    } else {
      stopActiveWatch();
    }
  }

  function refreshUserCreditsQuietly() {
    apiFetch("/api/auth/me")
      .then((body) => {
        const data = unwrapApiResults(body) || body;
        if (!data || typeof data !== "object") return;
        let prev = {};
        try {
          prev = JSON.parse(getItem("user_info") || "{}") || {};
        } catch {
          prev = {};
        }
        const merged = {
          ...prev,
          ...data,
          credits: data.credits ?? data.balance ?? prev.credits,
        };
        setItem("user_info", JSON.stringify(merged));
      })
      .catch(() => {});
  }

  function manualReconnect(companionId) {
    const id = String(companionId || "");
    if (!id) return;
    reconnectAttempts[id] = 0;
    const nextFailed = { ...reconnectFailed.value };
    delete nextFailed[id];
    reconnectFailed.value = nextFailed;
    // 握手中勿 force 拆掉；卡住由 handshake 超时自行收尾后再连
    if (isHandshaking(id)) {
      console.log("[WS] manualReconnect 跳过：握手中", id);
      return;
    }
    connect(id, { force: true });
  }

  /**
   * 路由兜底：栈顶不是聊天页时强制离开断连。
   * 部分机型 navigateBack / redirectTo 不走 nvue onHide、beforeDestroy，会把 /ws/chat 留着。
   */
  function syncChatPresenceFromRoute(reason = "route") {
    let onChat = false;
    let pageId = "";
    try {
      const pages = getCurrentPages();
      const top = pages[pages.length - 1];
      const route = String(top?.route || "");
      onChat = route.includes("pages/chat/index");
      if (onChat) {
        const q = top?.options || top?.$page?.options || {};
        pageId = String(q.id || "");
      }
    } catch {
      /* ignore */
    }

    if (onChat) {
      const id = pageId || String(activeCompanionId.value || "");
      if (id && !chatPagePresent[id]) {
        noteChatPageShow(id);
      }
      return;
    }

    const toLeave = new Set();
    for (const id of Object.keys(chatPagePresent)) {
      if (chatPagePresent[id]) toLeave.add(id);
    }
    const active = String(activeCompanionId.value || "");
    if (active) toLeave.add(active);
    for (const id of Object.keys(connections)) {
      if (connections[id]) toLeave.add(id);
    }
    for (const id of Object.keys(leaveChatTimers)) {
      toLeave.add(id);
    }
    if (!toLeave.size) return;
    console.log("[WS] syncPresence: 不在聊天页，强制离开", {
      reason,
      ids: Array.from(toLeave),
    });
    for (const id of toLeave) {
      noteChatPageLeave(id, `route:${reason}`);
    }
  }

  function bindRoutePresenceGuards() {
    const methods = [
      "navigateBack",
      "navigateTo",
      "redirectTo",
      "reLaunch",
      "switchTab",
    ];
    for (const method of methods) {
      try {
        uni.addInterceptor(method, {
          complete() {
            setTimeout(() => syncChatPresenceFromRoute(method), 0);
            setTimeout(() => syncChatPresenceFromRoute(method), 320);
          },
        });
      } catch {
        /* ignore */
      }
    }
  }

  // ——— 生命周期 ———
  function onAppShow() {
    try {
      useInboxWsStore().onAppForeground();
    } catch {
      /* ignore */
    }
    // 先按路由收敛：不在聊天页就断，避免 hide 丢失后前台逻辑又把 chat WS 续上
    syncChatPresenceFromRoute("appShow-immediate");
    if (visibilityReconnectTimer) clearTimeout(visibilityReconnectTimer);
    visibilityReconnectTimer = setTimeout(() => {
      visibilityReconnectTimer = null;
      syncChatPresenceFromRoute("appShow");
      const active = activeCompanionId.value
        ? String(activeCompanionId.value)
        : "";
      if (!active || !chatPagePresent[active]) return;
      for (const id of Array.from(trackedCompanionIds)) {
        if (id !== active) {
          try {
            disconnect(id, "appShow-evict");
          } catch {
            /* ignore */
          }
        }
      }
      ensureConnected(active, { fromUser: true });
    }, 400);
  }

  function onNetworkStatusChange(res) {
    try {
      useInboxWsStore().onNetworkChange(res);
    } catch {
      /* ignore */
    }
    if (res && res.isConnected) {
      onAppShow();
    }
  }

  function onLanguageChanged() {
    try {
      useInboxWsStore().onLanguageChanged();
    } catch {
      /* ignore */
    }
    if (languageReconnectTimer) clearTimeout(languageReconnectTimer);
    languageReconnectTimer = setTimeout(() => {
      languageReconnectTimer = null;
      for (const k of Object.keys(reconnectAttempts)) delete reconnectAttempts[k];
      reconnectFailed.value = {};
      const ordered = Array.from(trackedCompanionIds).sort(
        (a, b) => (lastActiveAt[b] || 0) - (lastActiveAt[a] || 0)
      );
      const keep = ordered.slice(0, MAX_WS_CONNECTIONS);
      for (const id of ordered.slice(MAX_WS_CONNECTIONS)) {
        trackedCompanionIds.delete(id);
      }
      reconnectTrackedStaggered(
        keep,
        200 + Math.floor(Math.random() * 160),
        { force: true }
      );
    }, 320);
  }

  function setupLifecycle() {
    initFromStorage();
    initBroadcastSync();
    bindRoutePresenceGuards();
    uni.onAppShow(onAppShow);
    // #ifdef H5
    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onAppShow();
      });
    } catch {
      /* ignore */
    }
    // #endif
  }

  function watchPersistEffects() {
    watch(
      unreadCounts,
      (v) => {
        schedulePersist({ unread: v });
        postMetaSync();
      },
      { deep: true }
    );
    watch(
      lastMessages,
      (v) => {
        schedulePersist({ last: v });
        postMetaSync();
      },
      { deep: true }
    );
  }

  const totalUnread = computed(() => {
    const localSum = Object.values(unreadCounts.value).reduce(
      (a, b) => a + (b || 0),
      0
    );
    try {
      return useInboxWsStore().resolveBadgeTotal(localSum);
    } catch {
      return localSum;
    }
  });

  return {
    messages,
    unreadCounts,
    lastMessages,
    isConnected,
    typingCompanions,
    activeCompanionId,
    sendingMsgIds,
    pendingMsgIds,
    paywall,
    reconnectFailed,
    freeTurnsRemaining,
    historyEpoch,
    totalUnread,
    dismissMessage,
    mergeHistoryMessages,
    placeMomentCardAtEnd,
    getCompanionMessages,
    getDisplayMessages,
    clearMessages,
    clearCompanionMeta,
    connect,
    disconnect,
    disconnectAll,
    scheduleLeaveChat,
    cancelLeaveChat,
    noteChatPageShow,
    noteChatPageHide,
    noteChatPageLeave,
    syncChatPresenceFromRoute,
    manualReconnect,
    ensureConnected,
    isHandshaking,
    sendMessage,
    setConversationMeta,
    setActiveCompanionId,
    clearUnread,
    onInboxUnread,
    hasPendingOutbox,
    syncRemotePreview,
    reloadForCurrentUser,
    triggerPaywall,
    applyAcceptedUnpaidMessages,
    clearTypingOnPaywall,
    ourMomentsTip,
    ourMomentsProgress,
    paywallMomentsTip,
    setOurMomentsTip,
    setOurMomentsProgress,
    loadOurMomentsProgress,
    setPaywallMomentsTip,
    captureMomentsTipForPaywall,
    clearOurMomentsTip,
    setupLifecycle,
    watchPersistEffects,
    onLanguageChanged,
    onAppShow,
    onNetworkStatusChange,
  };
});
