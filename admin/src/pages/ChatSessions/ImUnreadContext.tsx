import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ImReadAllResult, ImUnreadSummary } from '../../types';
import { getToken } from '../../api/request';
import { fetchUnreadSummary, markImCompanionRead } from './imApi';

const POLL_MS = 8000;
const MUTE_KEY = 'im_alert_muted';
const VOLUME_KEY = 'im_alert_volume';

/** IM 未读角标 / 顶部提醒 / 按智能体未读条。需要时改为 true。 */
export const SHOW_IM_MESSAGE_ALERTS = false;

const EMPTY_SUMMARY: ImUnreadSummary = {
  total_unread: 0,
  session_count: 0,
  by_companion: [],
};

function sessionKey(userId: number, companionId: string) {
  return `${userId}-${companionId}`;
}

function readMuted() {
  return localStorage.getItem(MUTE_KEY) !== '0';
}

function readVolume() {
  const n = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
}

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  const w = window as WindowWithWebkitAudio;
  const Ctor = window.AudioContext || w.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function startBeep(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(1174.7, now + 0.12);
  const peak = Math.max(0.15, Math.min(1, volume)) * 0.55;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.6);
}

function playImAlert(volume: number) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const kick = () => {
    try {
      startBeep(ctx, volume);
    } catch {
      /* ignore */
    }
  };
  if (ctx.state === 'running') {
    kick();
    return;
  }
  void ctx.resume().then(kick);
}

type ImUnreadContextValue = {
  summary: ImUnreadSummary;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  refresh: () => Promise<boolean>;
  markSessionOpened: (userId: number, companionId: string, unreadCount?: number) => void;
  clearSessionUnread: (userId: number, companionId: string, unreadCount?: number) => Promise<boolean>;
  sessionUnreadOf: (userId: number, companionId: string, fallback?: number) => number;
  applyReadAll: (result: ImReadAllResult | ImUnreadSummary) => void;
};

const ImUnreadContext = createContext<ImUnreadContextValue | null>(null);

export function ImUnreadProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<ImUnreadSummary>(EMPTY_SUMMARY);
  const [muted, setMutedState] = useState(readMuted);
  const [sessionUnread, setSessionUnread] = useState<Record<string, number>>({});
  const [unreadZeroed, setUnreadZeroed] = useState(false);
  const prevTotalRef = useRef<number | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const volumeRef = useRef(readVolume());
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return false;
    const seq = ++seqRef.current;
    try {
      const data = await fetchUnreadSummary();
      if (seq !== seqRef.current) return false;
      const prev = prevTotalRef.current;
      if (SHOW_IM_MESSAGE_ALERTS && prev != null && data.total_unread > prev && !mutedRef.current) {
        playImAlert(volumeRef.current);
      }
      prevTotalRef.current = data.total_unread;
      setSummary(data);
      setUnreadZeroed(false);
      if (prev != null && data.total_unread > prev) {
        setSessionUnread({});
      }
      return true;
    } catch {
      /* Redis 不可用时多为 0，不打断登录与聊天 */
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const scheduleNext = () => {
      clearTimer();
      if (cancelled) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void tick();
      }, POLL_MS);
    };

    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (!cancelled) scheduleNext();
    };

    void tick();
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      cancelled = true;
      clearTimer();
      seqRef.current += 1;
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [clearTimer, refresh]);

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setMutedState(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    if (!next) {
      playImAlert(volumeRef.current);
    }
  }, []);

  const applyLocalCleared = useCallback((userId: number, companionId: string, unreadCount = 0) => {
    const key = sessionKey(userId, companionId);
    const n = Math.max(0, unreadCount);
    setSessionUnread((prev) => ({ ...prev, [key]: 0 }));
    if (n <= 0) return;
    setSummary((prev) => {
      const by_companion = prev.by_companion
        .map((item) =>
          item.companion_id === companionId
            ? { ...item, unread_count: Math.max(0, item.unread_count - n) }
            : item,
        )
        .filter((item) => item.unread_count > 0);
      const next = {
        total_unread: Math.max(0, prev.total_unread - n),
        session_count: Math.max(0, prev.session_count - 1),
        by_companion,
      };
      prevTotalRef.current = next.total_unread;
      return next;
    });
  }, []);

  const clearSessionUnread = useCallback(async (userId: number, companionId: string, unreadCount = 0) => {
    applyLocalCleared(userId, companionId, unreadCount);
    try {
      const res = await markImCompanionRead(userId, companionId);
      if (!res || !res.ok) {
        await refresh();
        return false;
      }
      if (res.summary) {
        prevTotalRef.current = res.summary.total_unread;
        setSummary(res.summary);
      }
      return true;
    } catch {
      await refresh();
      return false;
    }
  }, [applyLocalCleared, refresh]);

  const markSessionOpened = useCallback((userId: number, companionId: string, unreadCount = 0) => {
    void clearSessionUnread(userId, companionId, unreadCount);
  }, [clearSessionUnread]);

  const sessionUnreadOf = useCallback((userId: number, companionId: string, fallback = 0) => {
    if (unreadZeroed) return 0;
    const key = sessionKey(userId, companionId);
    if (Object.prototype.hasOwnProperty.call(sessionUnread, key)) return sessionUnread[key];
    return fallback;
  }, [sessionUnread, unreadZeroed]);

  const applyReadAll = useCallback((result: ImReadAllResult | ImUnreadSummary) => {
    const next: ImUnreadSummary = {
      total_unread: result.total_unread,
      session_count: result.session_count,
      by_companion: result.by_companion || [],
    };
    prevTotalRef.current = next.total_unread;
    setSummary(next);
    setSessionUnread({});
    setUnreadZeroed(true);
  }, []);

  const value = useMemo(
    () => ({ summary, muted, setMuted, refresh, markSessionOpened, clearSessionUnread, sessionUnreadOf, applyReadAll }),
    [applyReadAll, clearSessionUnread, markSessionOpened, muted, refresh, sessionUnreadOf, summary],
  );

  return <ImUnreadContext.Provider value={value}>{children}</ImUnreadContext.Provider>;
}

export function useImUnread() {
  const ctx = useContext(ImUnreadContext);
  if (!ctx) {
    return {
      summary: EMPTY_SUMMARY,
      muted: true,
      setMuted: () => undefined,
      refresh: async () => false,
      markSessionOpened: () => undefined,
      clearSessionUnread: async () => false,
      sessionUnreadOf: (_userId: number, _companionId: string, fallback = 0) => fallback,
      applyReadAll: () => undefined,
    } satisfies ImUnreadContextValue;
  }
  return ctx;
}
