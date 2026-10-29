/**
 * @file inboxWs.js
 * @description 用户级 Messages 未读长连接 `/ws/inbox`。
 * - 总角标 + 当前列表每行未读只信这条 WS（不再本地 +1）
 * - Feedback 未读不走此处
 * - token 鉴权（勿用一次性 ticket）；断线指数退避；前后台/网络恢复立刻重连
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { getItem } from "@/utils/storage";
import { isLoggedIn } from "@/composables/useAuth";
import { i18n } from "@/i18n";
import { normalizeUiLang } from "@/utils/uiLanguage";
import { getWsOrigin, reconnectDelayMs } from "@/stores/chatHelpers";
import { useChatStore } from "@/stores/chat";

const MAX_WATCH = 200;
const CLIENT_PING_MS = 25000;
const PONG_WAIT_MS = 10000;

export const useInboxWsStore = defineStore("inboxWs", () => {
  /** 服务端权威总未读；null 表示尚未收到过 hello（断线期间保留上次值） */
  const totalUnread = ref(null);
  const connected = ref(false);

  let socketTask = null;
  let intentionallyClosed = false;
  let connectSeq = 0;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let clientPingTimer = null;
  let pongWatchdog = null;
  let heartbeatSec = 25;
  let lastRecvAt = 0;
  /** 最近一次 watch 的 companion id，重连后自动再 watch */
  let watchedIds = [];
  let pendingWatchIds = null;

  function currentLang() {
    try {
      return normalizeUiLang(i18n.global.locale.value || "en") || "en";
    } catch {
      return "en";
    }
  }

  function currentToken() {
    return String(getItem("user_token") || "").trim();
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (clientPingTimer) {
      clearTimeout(clientPingTimer);
      clientPingTimer = null;
    }
    if (pongWatchdog) {
      clearTimeout(pongWatchdog);
      pongWatchdog = null;
    }
  }

  function sendJson(obj) {
    if (!socketTask || typeof socketTask.send !== "function") return false;
    try {
      socketTask.send({ data: JSON.stringify(obj) });
      return true;
    } catch {
      return false;
    }
  }

  function scheduleClientPing() {
    if (clientPingTimer) clearTimeout(clientPingTimer);
    const gap = Math.max(15000, Math.min(30000, (Number(heartbeatSec) || 25) * 1000));
    clientPingTimer = setTimeout(() => {
      if (!connected.value) return;
      sendJson({ type: "ping" });
      if (pongWatchdog) clearTimeout(pongWatchdog);
      pongWatchdog = setTimeout(() => {
        // 发出 ping 后超时无下行 → 主动断开重连
        console.warn("[inboxWS] pong timeout, reconnect");
        forceReconnect("pong-timeout");
      }, PONG_WAIT_MS);
      scheduleClientPing();
    }, gap);
  }

  function markRecv() {
    lastRecvAt = Date.now();
    if (pongWatchdog) {
      clearTimeout(pongWatchdog);
      pongWatchdog = null;
    }
  }

  function applyTotal(n) {
    if (n == null || Number.isNaN(Number(n))) return;
    totalUnread.value = Math.max(0, Number(n) || 0);
  }

  function applyUnreadList(payload) {
    const chat = useChatStore();
    applyTotal(payload?.total_unread);
    const list = Array.isArray(payload?.companions) ? payload.companions : [];
    if (!list.length) return;
    const next = { ...(chat.unreadCounts || {}) };
    const bumped = [];
    for (const row of list) {
      const id = String(row?.companion_id || "").trim();
      if (!id) continue;
      const count = Math.max(0, Number(row?.unread_count) || 0);
      const prev = Math.max(0, Number(next[id]) || 0);
      if (count > 0) next[id] = count;
      else delete next[id];
      if (count > 0 && count !== prev) bumped.push([id, count]);
    }
    chat.unreadCounts = next;
    for (const [id, count] of bumped) {
      try {
        chat.onInboxUnread?.(id, count);
      } catch {
        /* ignore */
      }
    }
  }

  function applyUnreadOne(payload) {
    const chat = useChatStore();
    const id = String(payload?.companion_id || "").trim();
    applyTotal(payload?.total_unread);
    if (!id) return;
    const count = Math.max(0, Number(payload?.unread_count) || 0);
    const prev = Math.max(0, Number(chat.unreadCounts?.[id]) || 0);
    const next = { ...(chat.unreadCounts || {}) };
    if (count > 0) next[id] = count;
    else delete next[id];
    chat.unreadCounts = next;
    if (count > 0 && count !== prev) {
      try {
        chat.onInboxUnread?.(id, count);
      } catch {
        /* ignore */
      }
    }
  }

  function handleMessage(raw) {
    markRecv();
    let data = null;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const type = String(data.type || "");

    if (type === "ping") {
      console.log("[inboxWS] recv ping → pong");
      sendJson({ type: "pong" });
      return;
    }
    if (type === "pong") {
      console.log("[inboxWS] recv pong");
      return;
    }
    if (type === "hello") {
      console.log("[inboxWS] hello", {
        total_unread: data.total_unread,
        watch_required: data.watch_required,
        heartbeat_sec: data.heartbeat_sec,
      });
      applyTotal(data.total_unread);
      if (data.heartbeat_sec != null) {
        heartbeatSec = Math.max(10, Number(data.heartbeat_sec) || 25);
      }
      scheduleClientPing();
      const ids =
        pendingWatchIds ||
        (watchedIds.length ? watchedIds : null);
      pendingWatchIds = null;
      if (ids?.length) {
        watchCompanions(ids);
      }
      return;
    }
    if (type === "unread_list") {
      console.log("[inboxWS] unread_list", {
        total_unread: data.total_unread,
        n: Array.isArray(data.companions) ? data.companions.length : 0,
      });
      applyUnreadList(data);
      return;
    }
    if (type === "unread") {
      console.log("[inboxWS] unread", {
        companion_id: data.companion_id,
        unread_count: data.unread_count,
        total_unread: data.total_unread,
      });
      applyUnreadOne(data);
      return;
    }
    if (type === "error") {
      console.warn("[inboxWS] error", data.text || data.code || data);
    }
  }

  function normalizeIds(ids) {
    const out = [];
    const seen = new Set();
    for (const raw of ids || []) {
      const id = String(raw || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_WATCH) break;
    }
    return out;
  }

  function watchCompanions(ids) {
    const list = normalizeIds(ids);
    watchedIds = list;
    if (!list.length) return;
    if (!connected.value) {
      pendingWatchIds = list;
      return;
    }
    sendJson({ type: "watch", companion_ids: list });
  }

  function markRead(companionId) {
    const id = String(companionId || "").trim();
    if (!id) return;
    if (connected.value) {
      sendJson({ type: "read", companion_id: id });
    }
  }

  function scheduleReconnect() {
    if (intentionallyClosed || !isLoggedIn()) return;
    if (reconnectTimer) return;
    const delay = reconnectDelayMs(reconnectAttempt);
    reconnectAttempt += 1;
    console.log("[inboxWS] reconnect in", delay, "ms attempt", reconnectAttempt);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect({ force: true });
    }, delay);
  }

  function cleanupSocket() {
    clearTimers();
    connected.value = false;
    const task = socketTask;
    socketTask = null;
    if (task) {
      try {
        task.close?.({ code: 1000, reason: "cleanup" });
      } catch {
        /* ignore */
      }
    }
  }

  function forceReconnect(reason) {
    console.log("[inboxWS] forceReconnect", reason);
    intentionallyClosed = false;
    cleanupSocket();
    scheduleReconnect();
  }

  function disconnect() {
    intentionallyClosed = true;
    connectSeq += 1;
    reconnectAttempt = 0;
    watchedIds = [];
    pendingWatchIds = null;
    totalUnread.value = null;
    cleanupSocket();
  }

  function connect(opts = {}) {
    if (!isLoggedIn()) {
      disconnect();
      return;
    }
    const token = currentToken();
    if (!token) {
      disconnect();
      return;
    }

    if (!opts.force && connected.value && socketTask) return;
    if (!opts.force && socketTask && !connected.value) {
      // 握手中，勿重复建连
      return;
    }

    intentionallyClosed = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    cleanupSocket();

    const seq = ++connectSeq;
    const lang = currentLang();
    const origin = getWsOrigin();
    const parts = [
      `token=${encodeURIComponent(token)}`,
      `lang=${encodeURIComponent(lang)}`,
    ];
    const seedIds = normalizeIds(opts.companionIds || watchedIds);
    if (seedIds.length) {
      parts.push(`companion_ids=${encodeURIComponent(seedIds.join(","))}`);
      pendingWatchIds = seedIds;
    }
    const wsUrl = `${origin}/ws/inbox?${parts.join("&")}`;
    const logUrl = wsUrl.replace(/token=[^&]+/, "token=***");
    console.log("[inboxWS] connect", logUrl);

    const connectOpts = {
      url: wsUrl,
      method: "GET",
      complete: () => {},
      fail: (err) => {
        console.error("[inboxWS] connectSocket fail", err);
        if (connectSeq !== seq || intentionallyClosed) return;
        connected.value = false;
        socketTask = null;
        scheduleReconnect();
      },
    };
    // #ifdef APP-PLUS
    connectOpts.multiple = true;
    // #endif
    // App 端务必 multiple，避免挤掉其它长连接
    if (typeof plus !== "undefined") {
      connectOpts.multiple = true;
    }

    let task = null;
    try {
      task = uni.connectSocket(connectOpts);
    } catch (e) {
      console.error("[inboxWS] connectSocket throw", e);
      scheduleReconnect();
      return;
    }
    if (!task) {
      scheduleReconnect();
      return;
    }
    socketTask = task;

    task.onOpen?.(() => {
      if (connectSeq !== seq || intentionallyClosed) return;
      console.log("[inboxWS] open");
      connected.value = true;
      reconnectAttempt = 0;
      markRecv();
      scheduleClientPing();
    });

    task.onMessage?.((res) => {
      if (connectSeq !== seq || intentionallyClosed) return;
      handleMessage(res?.data);
    });

    task.onError?.((err) => {
      console.warn("[inboxWS] error", err);
      if (connectSeq !== seq || intentionallyClosed) return;
      connected.value = false;
    });

    task.onClose?.((ev) => {
      console.log("[inboxWS] close", ev?.code, ev?.reason);
      if (connectSeq !== seq) return;
      connected.value = false;
      if (socketTask === task) socketTask = null;
      clearTimers();
      if (!intentionallyClosed) scheduleReconnect();
    });
  }

  /** 登录后 / 冷启动已登录：建立连接 */
  function ensureConnected(companionIds) {
    if (!isLoggedIn()) return;
    intentionallyClosed = false;
    if (companionIds?.length) {
      pendingWatchIds = normalizeIds(companionIds);
      watchedIds = pendingWatchIds;
    }
    if (connected.value && socketTask) {
      // 可能被后续 chat WS 挤掉但标志仍为 true：超过心跳窗口无下行则强制重连
      const silentMs = lastRecvAt ? Date.now() - lastRecvAt : 0;
      const staleLimit = Math.max(45000, (Number(heartbeatSec) || 25) * 2500);
      if (lastRecvAt && silentMs > staleLimit) {
        console.warn("[inboxWS] ensureConnected: stale socket, heal", {
          silentMs,
          staleLimit,
        });
        forceReconnect("stale-on-ensure");
        return;
      }
      if (pendingWatchIds?.length) watchCompanions(pendingWatchIds);
      return;
    }
    connect({ force: !socketTask, companionIds: companionIds || watchedIds });
  }

  /**
   * chat WS 连上 / 离开聊天页后调用：探活 inbox，死了立刻重连。
   * uni-app 在部分机型上新 connectSocket 会挤掉旧连接，且不一定触发 onClose。
   */
  let lastHealAt = 0;
  let healTimer = null;
  function healAfterChatSocket(reason = "chat") {
    if (!isLoggedIn() || intentionallyClosed) return;
    // 所有 reason 统一限流：避免 foreground 风暴把 inbox 打爆
    const now = Date.now();
    if (now - lastHealAt < 2000) {
      if (!healTimer) {
        healTimer = setTimeout(() => {
          healTimer = null;
          healAfterChatSocket(reason);
        }, 2000 - (now - lastHealAt));
      }
      return;
    }
    lastHealAt = now;
    console.log("[inboxWS] healAfterChatSocket", reason, {
      connected: connected.value,
      hasTask: !!socketTask,
      lastRecvAge: lastRecvAt ? Date.now() - lastRecvAt : null,
    });
    if (!connected.value || !socketTask) {
      reconnectAttempt = 0;
      connect({ force: true, companionIds: watchedIds });
      return;
    }
    // 发 ping；超时则 forceReconnect（已有 pongWatchdog）
    sendJson({ type: "ping" });
    if (pongWatchdog) clearTimeout(pongWatchdog);
    pongWatchdog = setTimeout(() => {
      forceReconnect(`heal-pong-timeout:${reason}`);
    }, PONG_WAIT_MS);
  }

  /** 回前台 / 网络恢复：探活 inbox（强限流，避免 page onShow 风暴） */
  let lastForegroundAt = 0;
  function onAppForeground() {
    if (!isLoggedIn()) return;
    const now = Date.now();
    if (now - lastForegroundAt < 5000) return;
    lastForegroundAt = now;
    reconnectAttempt = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    healAfterChatSocket("foreground");
  }

  function onNetworkChange(res) {
    if (!isLoggedIn()) return;
    if (res?.isConnected === false) return;
    reconnectAttempt = 0;
    if (!connected.value) {
      connect({ force: true, companionIds: watchedIds });
    }
  }

  function onLanguageChanged() {
    if (!isLoggedIn()) return;
    connect({ force: true, companionIds: watchedIds });
  }

  /** Tab 角标：已收到过 hello 用权威值，否则回退本地 unreadCounts 之和（冷启动短窗） */
  function resolveBadgeTotal(localSum) {
    if (totalUnread.value != null) return totalUnread.value;
    return Math.max(0, Number(localSum) || 0);
  }

  /** 本地清某一会话时同步扣减权威总数（乐观），inbox 随后会推准确值 */
  function optimisticClear(companionId, prevCount) {
    const n = Math.max(0, Number(prevCount) || 0);
    if (totalUnread.value != null && n > 0) {
      totalUnread.value = Math.max(0, totalUnread.value - n);
    }
    markRead(companionId);
  }

  return {
    totalUnread,
    connected,
    connect,
    disconnect,
    ensureConnected,
    watchCompanions,
    markRead,
    onAppForeground,
    onNetworkChange,
    onLanguageChanged,
    resolveBadgeTotal,
    optimisticClear,
    healAfterChatSocket,
  };
});
