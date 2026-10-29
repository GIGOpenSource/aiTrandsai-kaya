import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App as AntdApp, Badge, Button, Input, Modal, Popover, Spin, Switch, Tag } from 'antd';
import { CloseOutlined, MinusOutlined, SmileOutlined, TranslationOutlined } from '@ant-design/icons';
import { formatDate, showError, showSuccess, showWarning } from '../../api/request';
import type { ChatSessionItem, ChatSessionMessage, ImCompanionProfile, ImConsumeStats } from '../../types';
import { getAppLanguage } from '../../locales';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { formatOrientation } from '../Users/userFields';
import { fetchImCompanion, fetchImConsumeStats, fetchImMessages, formatIdleRemaining, IM_MESSAGE_PAGE_SIZE, imMessageImageUrl, imWebSocketUrl, isImImageMessage, isImUnpaidMessage, readApiError, releaseTakeover, sendImMessage, takeoverSession, translateImText, visibleImMessages } from './imApi';
import { useImUnread } from './ImUnreadContext';
import { ImMomentCard } from './ImMomentCard';
import { ImMessageContent } from './ImChatImage';
import { ImUnpaidMark } from './ImUnpaidMark';

const EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜', '🤗', '🤔', '😅', '😭', '😡', '👍', '👎', '❤️', '🔥', '✨', '🎉', '🙏'];
const TRANSLATE_MAX_LEN = 6000;
const WINDOW_W = 860;
const WINDOW_H = 560;
const VIEW_MARGIN = 24;
const PILL_W = 220;
const PILL_H = 44;

function stopWheelBubble(e: React.WheelEvent) {
  e.stopPropagation();
}

const scrollPaneStyle: React.CSSProperties = {
  overscrollBehavior: 'contain',
};

type DragState = { dx: number; dy: number; w: number; h: number };

function getViewport() {
  if (typeof window === 'undefined') return { w: 1280, h: 800 };
  const vv = window.visualViewport;
  return {
    w: Math.round(vv?.width ?? window.innerWidth),
    h: Math.round(vv?.height ?? window.innerHeight),
  };
}

function getWindowSize() {
  const { w: vw, h: vh } = getViewport();
  const margin = Math.max(VIEW_MARGIN, Math.round(Math.min(vw, vh) * 0.04));
  return {
    w: Math.min(WINDOW_W, Math.round(vw * 0.92), Math.max(320, vw - margin * 2)),
    h: Math.min(WINDOW_H, Math.round(vh * 0.78), Math.max(280, vh - margin * 2)),
  };
}

function layoutSize(isMinimized: boolean) {
  return isMinimized ? { w: PILL_W, h: PILL_H } : getWindowSize();
}

function clampPos(x: number, y: number, w: number, h: number) {
  const { w: vw, h: vh } = getViewport();
  const margin = Math.max(VIEW_MARGIN, Math.round(Math.min(vw, vh) * 0.04));
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y)),
  };
}

function defaultPos(offset: number) {
  const size = getWindowSize();
  const { w: vw, h: vh } = getViewport();
  return clampPos(vw - size.w - VIEW_MARGIN - offset * 28, vh - size.h - VIEW_MARGIN - offset * 28, size.w, size.h);
}

type Props = {
  session: ChatSessionItem;
  offset?: number;
  initialMinimized?: boolean;
  initialPos?: { x: number; y: number };
  showUnpaidMessages?: boolean;
  onClosed: (session: ChatSessionItem) => void;
  onTakenOver?: (session: ChatSessionItem) => void;
  onUiChange?: (patch: { minimized?: boolean; pos?: { x: number; y: number } }) => void;
};

function isIncomingUser(role?: string) {
  const r = (role || 'user').toLowerCase();
  return r === 'user' || r === 'human' || r === 'customer';
}

function canTranslateMessage(msg: ChatSessionMessage) {
  const role = (msg.role || '').toLowerCase();
  if (role === 'moment' || role === 'system') return false;
  const text = (msg.content || '').trim();
  return text.length > 0 && text.length <= TRANSLATE_MAX_LEN;
}

function previewText(content: string, max = 80) {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function roleStyle(role: string) {
  if (role === 'user') return { align: 'flex-start' as const, bg: '#e6f7ff', border: '#91d5ff' };
  if (role === 'moment') return { align: 'flex-start' as const, bg: '#fff', border: '#f0f0f0' };
  if (role === 'operator') return { align: 'flex-end' as const, bg: '#fff7e6', border: '#ffd591' };
  return { align: 'flex-end' as const, bg: '#f6ffed', border: '#b7eb8f' };
}

function ProfileField({ label, value }: { label: string; value?: React.ReactNode }) {
  const empty = value == null || value === '';
  return (
    <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55 }}>
      <div style={{ color: '#888', marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{empty ? '—' : value}</div>
    </div>
  );
}

function statsText(stats: ImConsumeStats | null, t: (key: string) => unknown) {
  if (!stats) return t('im.noStats') as string;
  const bits: string[] = [];
  if (stats.is_vip) bits.push('VIP');
  const points = stats.remaining_points ?? stats.credits;
  if (points != null) bits.push(`${t('im.points')}: ${points}`);
  if (stats.free_messages_remaining != null) bits.push(`${t('im.freeTurns')}: ${stats.free_messages_remaining}`);
  if (stats.session_turns != null) bits.push(`${t('table.turns')}: ${stats.session_turns}`);
  if (stats.credits_spent != null) bits.push(`${t('im.spent')}: ${stats.credits_spent}`);
  return bits.join(' · ') || (t('im.noStats') as string);
}

export default function TakeoverWindow({
  session,
  offset = 0,
  initialMinimized = false,
  initialPos,
  showUnpaidMessages = false,
  onClosed,
  onTakenOver,
  onUiChange,
}: Props) {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const { notification } = AntdApp.useApp();
  const { markSessionOpened, clearSessionUnread } = useImUnread();
  const [minimized, setMinimized] = useState(initialMinimized);
  const [unread, setUnread] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatSessionMessage[]>([]);
  const visibleMessages = useMemo(
    () => visibleImMessages(messages, showUnpaidMessages),
    [messages, showUnpaidMessages],
  );
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pageTranslate, setPageTranslate] = useState(false);
  const [translatingPage, setTranslatingPage] = useState(false);
  const [translatingIds, setTranslatingIds] = useState<Set<number | string>>(() => new Set());
  const [individuallyTranslatedIds, setIndividuallyTranslatedIds] = useState<Set<number | string>>(() => new Set());
  const [input, setInput] = useState('');
  const [companion, setCompanion] = useState<ImCompanionProfile | null>(null);
  const [stats, setStats] = useState<ImConsumeStats | null>(null);
  const [pos, setPos] = useState(() => initialPos || defaultPos(offset));
  const [winSize, setWinSize] = useState(getWindowSize);
  const dragging = useRef<DragState | null>(null);
  const didDrag = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const onUiChangeRef = useRef(onUiChange);
  onUiChangeRef.current = onUiChange;
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;
  const messagesRef = useRef<ChatSessionMessage[]>([]);
  const oldestPageRef = useRef(1);
  const hasOlderRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const pageTranslateRef = useRef(false);
  const translatingPageRef = useRef(false);
  const translatingIdsRef = useRef<Set<number | string>>(new Set());
  const individuallyTranslatedIdsRef = useRef<Set<number | string>>(new Set());
  const allowAutoLoadRef = useRef(true);
  const notificationRef = useRef(notification);
  notificationRef.current = notification;
  const listRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<number | null>(null);
  const released = useRef(false);
  const [idleRemaining, setIdleRemaining] = useState<number | null>(null);
  const [inputLocked, setInputLocked] = useState(false);

  useEffect(() => {
    markSessionOpened(session.user_id, session.companion_id, session.ops_unread_count ?? 0);
  }, [markSessionOpened, session.companion_id, session.ops_unread_count, session.user_id]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const patchMessages = useCallback((updater: (prev: ChatSessionMessage[]) => ChatSessionMessage[]) => {
    messagesRef.current = updater(messagesRef.current);
    setMessages(messagesRef.current);
  }, []);

  const appendMessage = useCallback((msg: ChatSessionMessage) => {
    const prev = messagesRef.current;
    const sameId = (a: ChatSessionMessage, b: ChatSessionMessage) =>
      a.id != null && b.id != null && String(a.id) === String(b.id);
    if (msg.id != null && prev.some((m) => sameId(m, msg))) {
      if (isImUnpaidMessage(msg)) {
        messagesRef.current = prev.map((m) =>
          sameId(m, msg) ? { ...m, send_status: m.send_status || msg.send_status } : m,
        );
        setMessages(messagesRef.current);
      }
      return;
    }
    const last = prev[prev.length - 1];
    if (
      last &&
      last.role === msg.role &&
      last.content === msg.content &&
      (last.image_url || '') === (msg.image_url || '') &&
      !isImUnpaidMessage(msg) &&
      !isImUnpaidMessage(last)
    ) {
      return;
    }
    messagesRef.current = [...prev, msg];
    setMessages(messagesRef.current);
    if (isIncomingUser(msg.role)) {
      setUnread(true);
      setUnreadCount((n) => n + 1);
      if (minimizedRef.current) {
        const userName = session.nickname || session.username || `#${session.user_id}`;
        notificationRef.current.info({
          key: `im-unread-${session.user_id}-${session.companion_id}`,
          message: t('im.newMessageHint', { user: userName }) as string,
          description:
            isImImageMessage(msg) && !(msg.content || '').trim()
              ? (t('im.imageMessage') as string)
              : previewText(msg.content || ''),
          placement: 'topRight',
          duration: 4.5,
        });
      }
    }
    window.setTimeout(scrollToBottom, 30);
    if (pageTranslateRef.current && canTranslateMessage(msg) && msg.translated_content == null) {
      void translateImText(msg.content)
        .then((data) => {
          if (data?.translated != null) {
            patchMessages((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...m, translated_content: data.translated } : m)),
            );
          }
        })
        .catch(() => {
          /* keep original */
        });
    }
  }, [patchMessages, scrollToBottom, session.companion_id, session.nickname, session.user_id, session.username, t]);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const nextPage = oldestPageRef.current + 1;
      const res = await fetchImMessages(session.user_id, session.companion_id, {
        page: nextPage,
        page_size: IM_MESSAGE_PAGE_SIZE,
        translate: pageTranslateRef.current,
      });
      const incoming = res?.messages ?? [];
      const el = listRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const prevTop = el?.scrollTop ?? 0;
      const existingIds = new Set(messagesRef.current.map((m) => m.id));
      const older = incoming.filter((m) => !existingIds.has(m.id));
      if (older.length) {
        messagesRef.current = [...older, ...messagesRef.current];
        setMessages(messagesRef.current);
      } else {
        allowAutoLoadRef.current = false;
      }
      oldestPageRef.current = res?.page ?? nextPage;
      hasOlderRef.current = !!res?.has_older;
      setHasOlder(hasOlderRef.current);
      requestAnimationFrame(() => {
        if (el && older.length) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [session.companion_id, session.user_id, t]);

  const markIndividuallyTranslated = useCallback((id: number | string) => {
    individuallyTranslatedIdsRef.current.add(id);
    setIndividuallyTranslatedIds(new Set(individuallyTranslatedIdsRef.current));
  }, []);

  const handleTranslateOne = useCallback(async (msg: ChatSessionMessage) => {
    if (!canTranslateMessage(msg) || translatingIdsRef.current.has(msg.id)) return;
    if (msg.translated_content != null) {
      markIndividuallyTranslated(msg.id);
      return;
    }
    translatingIdsRef.current.add(msg.id);
    setTranslatingIds(new Set(translatingIdsRef.current));
    try {
      const data = await translateImText(msg.content);
      if (data?.translated != null) {
        patchMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, translated_content: data.translated } : m)),
        );
        markIndividuallyTranslated(msg.id);
      } else if (data && !data.skipped) {
        showError(t('im.translateFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
    } finally {
      translatingIdsRef.current.delete(msg.id);
      setTranslatingIds(new Set(translatingIdsRef.current));
    }
  }, [markIndividuallyTranslated, patchMessages, t]);

  const fetchLoadedPageTranslations = useCallback(async () => {
    if (translatingPageRef.current || messagesRef.current.length === 0) return;
    const missing = messagesRef.current.some((m) => canTranslateMessage(m) && m.translated_content == null);
    if (!missing) return;
    translatingPageRef.current = true;
    setTranslatingPage(true);
    try {
      const pages = Array.from({ length: oldestPageRef.current }, (_, i) => i + 1);
      const results = await Promise.all(
        pages.map((page) =>
          fetchImMessages(session.user_id, session.companion_id, {
            page,
            page_size: IM_MESSAGE_PAGE_SIZE,
            translate: true,
          }),
        ),
      );
      const translatedById = new Map<number | string, string | null | undefined>();
      for (const res of results) {
        for (const m of res?.messages ?? []) {
          translatedById.set(m.id, m.translated_content);
        }
      }
      patchMessages((prev) =>
        prev.map((m) => {
          const next = translatedById.get(m.id);
          return next != null ? { ...m, translated_content: next } : m;
        }),
      );
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
    } finally {
      translatingPageRef.current = false;
      setTranslatingPage(false);
    }
  }, [patchMessages, session.companion_id, session.user_id, t]);

  const handlePageTranslateChange = useCallback((checked: boolean) => {
    pageTranslateRef.current = checked;
    setPageTranslate(checked);
    if (checked) void fetchLoadedPageTranslations();
  }, [fetchLoadedPageTranslations]);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop > 80) allowAutoLoadRef.current = true;
    if (!allowAutoLoadRef.current || loadingOlderRef.current || !hasOlderRef.current) return;
    if (el.scrollTop <= 48) void loadOlder();
  }, [loadOlder]);

  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const onTakenOverRef = useRef(onTakenOver);
  onTakenOverRef.current = onTakenOver;

  useEffect(() => {
    setMinimized(initialMinimized);
    if (!initialMinimized) {
      setUnread(false);
      setUnreadCount(0);
    }
  }, [initialMinimized]);

  useLayoutEffect(() => {
    if (minimized) return;
    scrollToBottom();
    const t0 = window.setTimeout(scrollToBottom, 0);
    const t1 = window.setTimeout(scrollToBottom, 50);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [minimized, scrollToBottom]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIdleRemaining((n) => (n == null || n <= 0 ? n : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const takeoverRes = await takeoverSession(session.user_id, session.companion_id);
        if (!takeoverRes) return;
        if (!takeoverRes.ok) {
          showError(await readApiError(takeoverRes, t('im.takeoverFailed') as string));
          released.current = true;
          onClosedRef.current(session);
          return;
        }
        try {
          const payload = (await takeoverRes.json()) as {
            idle_remaining_seconds?: number | null;
            idle_timeout_seconds?: number | null;
          };
          const remaining = Number(payload.idle_remaining_seconds ?? payload.idle_timeout_seconds);
          if (Number.isFinite(remaining) && remaining > 0) setIdleRemaining(remaining);
        } catch {
          /* 旧响应无空闲字段 */
        }
        onTakenOverRef.current?.(session);
        const [msgRes, companionRes, statsRes] = await Promise.all([
          fetchImMessages(session.user_id, session.companion_id, { page: 1, page_size: IM_MESSAGE_PAGE_SIZE }),
          fetchImCompanion(session.companion_id),
          fetchImConsumeStats(session.user_id, session.companion_id),
        ]);
        if (cancelled) return;
        const history = msgRes?.messages ?? [];
        messagesRef.current = history;
        setMessages(history);
        oldestPageRef.current = msgRes?.page ?? 1;
        hasOlderRef.current = !!msgRes?.has_older;
        setHasOlder(hasOlderRef.current);
        setCompanion(companionRes);
        setStats(statsRes);
        window.setTimeout(scrollToBottom, 50);
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('im.takeoverFailed') as string));
        released.current = true;
        onClosedRef.current(session);
        return;
      } finally {
        if (!cancelled) setLoading(false);
      }

      const ws = new WebSocket(imWebSocketUrl(session.user_id, session.companion_id));
      wsRef.current = ws;
      const sendPing = () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      };
      ws.onopen = () => sendPing();
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            type?: string;
            role?: string;
            content?: string;
            text?: string;
            image_url?: string;
            content_type?: string;
            send_status?: string;
            id?: number | string;
            created_at?: string;
            timestamp?: string;
            message?: ChatSessionMessage;
            messages?: Array<{
              id?: number | string;
              role?: string;
              content?: string;
              send_status?: string;
              timestamp?: string;
              created_at?: string;
              image_url?: string;
              content_type?: string;
            }>;
            is_taken_over?: boolean;
            reason?: string;
            idle_remaining_seconds?: number | null;
          };
          if (data.type === 'pong') {
            const remaining = Number(data.idle_remaining_seconds);
            if (Number.isFinite(remaining)) setIdleRemaining(remaining);
            return;
          }
          if (data.type === 'takeover_state') {
            if (data.is_taken_over === false) {
              if (released.current) return;
              released.current = true;
              setInputLocked(true);
              if (data.reason === 'timeout') {
                showWarning(t('im.timeoutReleased') as string);
              } else {
                showSuccess(t('im.released') as string);
              }
              onClosedRef.current(session);
            }
            return;
          }
          if (data.type === 'ping' || data.type === 'ack' || data.type === 'error') return;
          if (data.type === 'need_vip') {
            const items = Array.isArray(data.messages) ? data.messages : [];
            items.forEach((item, index) => {
              const content = item.content || '';
              const image_url = item.image_url || '';
              if (!content && !image_url) return;
              appendMessage({
                id: item.id ?? `unpaid-${Date.now()}-${index}`,
                role: item.role || 'user',
                content,
                image_url,
                content_type: item.content_type,
                send_status: item.send_status || data.send_status || 'unpaid',
                created_at: item.created_at || item.timestamp || new Date().toISOString(),
              });
            });
            return;
          }
          const payload = data.message;
          const content = payload?.content || data.content || data.text || '';
          const image_url = payload?.image_url || data.image_url || '';
          const content_type = payload?.content_type || data.content_type || '';
          const send_status = payload?.send_status || data.send_status || '';
          if (!payload && !content && !image_url && content_type !== 'image') return;
          const msg: ChatSessionMessage = payload
            ? {
                ...payload,
                image_url: payload.image_url || image_url,
                content_type: payload.content_type || content_type,
                send_status: payload.send_status || send_status || undefined,
              }
            : {
                id: data.id || Date.now(),
                role: data.role || 'user',
                content,
                image_url,
                content_type,
                send_status: send_status || undefined,
                created_at: data.created_at || data.timestamp || new Date().toISOString(),
              };
          if (!msg.content && !imMessageImageUrl(msg)) return;
          appendMessage(msg);
        } catch {
          /* ignore malformed frames */
        }
      };
      pingRef.current = window.setInterval(sendPing, 30000);
    })();

    return () => {
      cancelled = true;
      if (pingRef.current) window.clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [appendMessage, scrollToBottom, session.companion_id, session.user_id, t]);

  async function handleClose() {
    if (released.current) {
      onClosed(session);
      return;
    }
    released.current = true;
    try {
      await releaseTakeover(session.user_id, session.companion_id);
    } catch {
      /* ignore */
    }
    wsRef.current?.close();
    onClosed(session);
    showSuccess(t('im.released') as string);
  }

  function requestClose() {
    Modal.confirm({
      title: t('im.confirmRelease') as string,
      okText: t('btn.confirm') as string,
      cancelText: t('btn.cancel') as string,
      onOk: () => handleClose(),
    });
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending || inputLocked || released.current) return;
    setSending(true);
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'send', text: content }));
        appendMessage({
          id: Date.now(),
          role: 'operator',
          content,
          created_at: new Date().toISOString(),
        });
      } else {
        const res = await sendImMessage(session.user_id, session.companion_id, content);
        if (!res || !res.ok) {
          showError(res ? await readApiError(res, t('toast.sendFailed') as string) : (t('toast.sendFailed') as string));
          return;
        }
        appendMessage({
          id: Date.now(),
          role: 'operator',
          content,
          created_at: new Date().toISOString(),
        });
      }
      setInput('');
      setUnread(false);
      setUnreadCount(0);
      void clearSessionUnread(
        session.user_id,
        session.companion_id,
        unreadCount || session.ops_unread_count || 0,
      );
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.sendFailed') as string));
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const apply = () => {
      const size = layoutSize(minimized);
      if (!minimized) setWinSize(size);
      setPos((current) => {
        const next = clampPos(current.x, current.y, size.w, size.h);
        posRef.current = next;
        return next;
      });
    };
    apply();
    window.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('scroll', apply);
    };
  }, [minimized]);

  function persistUi(patch: { minimized?: boolean; pos?: { x: number; y: number } }) {
    onUiChangeRef.current?.(patch);
  }

  function setMinimizedAndPersist(value: boolean) {
    const size = layoutSize(value);
    if (!value) setWinSize(size);
    const next = clampPos(posRef.current.x, posRef.current.y, size.w, size.h);
    posRef.current = next;
    setPos(next);
    setMinimized(value);
    persistUi({ minimized: value, pos: next });
  }

  function onHeaderDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragging.current = {
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
      w: minimized ? rect.width : winSize.w,
      h: minimized ? rect.height : winSize.h,
    };
    didDrag.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onHeaderMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const next = clampPos(
      e.clientX - dragging.current.dx,
      e.clientY - dragging.current.dy,
      dragging.current.w,
      dragging.current.h,
    );
    if (Math.abs(next.x - pos.x) > 3 || Math.abs(next.y - pos.y) > 3) didDrag.current = true;
    setPos(next);
  }

  function onHeaderUp(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    persistUi({ minimized, pos: posRef.current });
  }

  const userLabel = session.nickname || session.username || `#${session.user_id}`;
  const companionLabel = companion?.name || companion?.nickname || session.companion_name || session.companion_id;

  if (minimized) {
    return (
      <div
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={onHeaderUp}
        onPointerCancel={onHeaderUp}
        onWheel={stopWheelBubble}
        onClick={() => {
          if (didDrag.current) return;
          setMinimizedAndPersist(false);
          setUnread(false);
          setUnreadCount(0);
        }}
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 1100 + offset,
        }}
      >
        <Badge count={unreadCount} overflowCount={99} offset={[-4, 4]}>
          <div
            style={{
              minWidth: 220,
              padding: '10px 14px',
              borderRadius: 20,
              color: '#fff',
              cursor: 'pointer',
              boxShadow: unread ? '0 0 0 4px rgba(255,77,79,0.28), 0 8px 24px rgba(0,0,0,0.18)' : '0 8px 24px rgba(0,0,0,0.18)',
              background: unread ? '#ff4d4f' : '#1677ff',
              userSelect: 'none',
              touchAction: 'none',
              animation: unread ? 'im-unread-pulse 1.4s ease-in-out infinite' : undefined,
            }}
          >
            {userLabel} × {companionLabel}
            {unread ? ` · ${t('im.newMessage')}` : ''}
          </div>
        </Badge>
      </div>
    );
  }

  return (
    <div
      onWheel={stopWheelBubble}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 1100 + offset,
        width: winSize.w,
        height: winSize.h,
        maxWidth: 'calc(100vw - 48px)',
        maxHeight: 'calc(100dvh - 48px)',
        boxSizing: 'border-box',
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        overscrollBehavior: 'contain',
        border: '1px solid #f0f0f0',
      }}
    >
      <div
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={onHeaderUp}
        onPointerCancel={onHeaderUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#1677ff',
          color: '#fff',
          cursor: 'move',
          userSelect: 'none',
          touchAction: 'none',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {t('table.userId')} {session.user_id} · {userLabel}
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {statsText(stats, t)}
            {idleRemaining != null ? ` · ${t('im.idleHint', { time: formatIdleRemaining(idleRemaining) })}` : ''}
          </div>
        </div>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {t('table.companionId')} {session.companion_id}
        </div>
        <div onPointerDown={(e) => e.stopPropagation()}>
          <Button
            type="text"
            size="small"
            icon={<MinusOutlined />}
            style={{ color: '#fff' }}
            onClick={() => setMinimizedAndPersist(true)}
          />
          <Button type="text" size="small" icon={<CloseOutlined />} style={{ color: '#fff' }} onClick={requestClose} />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!loading && messages.length > 0 ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 12px',
                borderBottom: '1px solid #f0f0f0',
                background: '#fff',
                flexShrink: 0,
              }}
            >
              <Button size="small" type="link" disabled={!hasOlder} loading={loadingOlder} onClick={() => void loadOlder()}>
                {hasOlder ? t('im.loadOlder') : t('im.noOlder')}
              </Button>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <TranslationOutlined style={{ color: pageTranslate ? '#1677ff' : '#8c8c8c' }} />
                {t('im.translatePage')}
                <Switch
                  size="small"
                  checked={pageTranslate}
                  loading={translatingPage}
                  onChange={handlePageTranslateChange}
                />
              </span>
            </div>
          ) : null}
          <div
            ref={listRef}
            onScroll={onListScroll}
            style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#f7f8fa', ...scrollPaneStyle }}
          >
            {loading ? (
              <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>
            ) : visibleMessages.length === 0 ? (
              <div style={{ color: '#999', textAlign: 'center', paddingTop: 80 }}>{t('empty.messages')}</div>
            ) : (
              <>
                {loadingOlder ? (
                  <div style={{ textAlign: 'center', padding: '4px 0 10px', color: '#888', fontSize: 12 }}>
                    <Spin size="small" /> {t('im.loadingOlder')}
                  </div>
                ) : null}
                {visibleMessages.map((m) => {
                  const isMoment = (m.role || '').toLowerCase() === 'moment';
                  const s = roleStyle(m.role);
                  const showTranslated = !isMoment && (pageTranslate || individuallyTranslatedIds.has(m.id));
                  const displayText = showTranslated ? (m.translated_content || m.content) : m.content;
                  const hasTranslation = Boolean(showTranslated && m.translated_content && m.translated_content !== m.content);
                  const translating = translatingIds.has(m.id);
                  const showTranslate = canTranslateMessage(m) && !showTranslated;
                  return (
                    <div key={`${m.id}-${m.created_at}`} style={{ display: 'flex', justifyContent: s.align, alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <div
                        style={{
                          maxWidth: isMoment ? '86%' : '76%',
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: s.bg,
                          border: `1px solid ${s.border}`,
                        }}
                      >
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                          {m.role === 'user'
                            ? t('chat.roleUser')
                            : m.role === 'operator'
                              ? t('chat.roleOperator')
                              : isMoment
                                ? t('chat.roleMoment')
                                : t('chat.roleAssistant')}
                          {m.created_at ? ` · ${formatDate(m.created_at, locale)}` : ''}
                        </div>
                        {isMoment ? (
                          <ImMomentCard content={m.content} />
                        ) : (
                        <div
                          style={{
                            cursor: showTranslate ? 'pointer' : undefined,
                          }}
                          title={showTranslate ? (t('im.clickToTranslate') as string) : undefined}
                          onClick={() => {
                            if (showTranslate) void handleTranslateOne(m);
                          }}
                        >
                          <ImMessageContent msg={m} text={displayText} />
                        </div>
                        )}
                        {hasTranslation ? (
                          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6, paddingTop: 6, borderTop: '1px dashed #d9d9d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {t('im.original')} · {m.content}
                          </div>
                        ) : null}
                        {showTranslate ? (
                          <Button
                            type="link"
                            size="small"
                            icon={<TranslationOutlined />}
                            loading={translating}
                            style={{ padding: 0, height: 'auto', marginTop: 4 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleTranslateOne(m);
                            }}
                          >
                            {translating ? t('im.translating') : t('im.translate')}
                          </Button>
                        ) : null}
                      </div>
                      <ImUnpaidMark msg={m} />
                    </div>
                  );
                })}
              </>
            )}
          </div>
          <div style={{ padding: 10, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
            <Popover
              trigger="click"
              placement="topLeft"
              zIndex={1200 + offset}
              content={
                <div style={{ width: 240, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {EMOJIS.map((emo) => (
                    <Button key={emo} type="text" size="small" onClick={() => setInput((prev) => prev + emo)}>
                      {emo}
                    </Button>
                  ))}
                </div>
              }
            >
              <Button icon={<SmileOutlined />} />
            </Popover>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoSize={{ minRows: 1, maxRows: 3 }}
              disabled={inputLocked}
              placeholder={t('im.inputPlaceholder') as string}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            <Button type="primary" loading={sending} disabled={inputLocked} onClick={() => void handleSend()}>
              {t('btn.send') || t('im.send')}
            </Button>
          </div>
        </div>
        <div style={{ width: Math.min(240, Math.max(168, Math.round(winSize.w * 0.28))), flexShrink: 0, borderLeft: '1px solid #f0f0f0', padding: 12, overflowY: 'auto', background: '#fff', ...scrollPaneStyle }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('im.companionProfile')}</div>
          {companion?.avatar_url ? (
            <img
              src={resolveAdminMediaUrl(companion.avatar_url)}
              alt=""
              style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', marginBottom: 8 }}
            />
          ) : null}
          <div>{companionLabel}</div>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>{session.companion_id}</div>
          {companion?.gender ? <Tag>{companion.gender}</Tag> : null}
          {companion?.language ? <Tag>{companion.language}</Tag> : null}
          <ProfileField label={t('table.age') as string} value={companion?.age} />
          <ProfileField label={t('table.mbti') as string} value={companion?.mbti} />
          <ProfileField label={t('table.background') as string} value={companion?.background} />
          <ProfileField
            label={t('table.sexualOrientation') as string}
            value={companion?.sexual_orientation ? formatOrientation(companion.sexual_orientation, t) : undefined}
          />
          <ProfileField label={t('table.city') as string} value={companion?.city} />
          <ProfileField label={t('table.country') as string} value={companion?.country} />
          <ProfileField label={t('table.speechStyle') as string} value={companion?.speech_style} />
        </div>
      </div>
    </div>
  );
}
