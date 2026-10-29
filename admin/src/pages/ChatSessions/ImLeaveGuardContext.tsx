import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

export type ImLeaveGuard = {
  shouldBlock: (nextPath: string) => boolean;
  requestLeave: () => Promise<boolean>;
};

type ImLeaveGuardContextValue = {
  setGuard: (guard: ImLeaveGuard | null) => void;
  confirmNavigation: (nextPath: string) => Promise<boolean>;
};

const ImLeaveGuardContext = createContext<ImLeaveGuardContextValue | null>(null);

export function normalizeNavPath(path: string) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return p.split('?')[0].split('#')[0];
}

export function isChatSessionsPath(path: string) {
  const p = normalizeNavPath(path);
  return p === '/chat-sessions' || p.startsWith('/chat-sessions/');
}

export function ImLeaveGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<ImLeaveGuard | null>(null);

  const setGuard = useCallback((guard: ImLeaveGuard | null) => {
    guardRef.current = guard;
  }, []);

  const confirmNavigation = useCallback(async (nextPath: string) => {
    const guard = guardRef.current;
    if (!guard?.shouldBlock(nextPath)) return true;
    return guard.requestLeave();
  }, []);

  const value = useMemo(
    () => ({ setGuard, confirmNavigation }),
    [confirmNavigation, setGuard],
  );

  return <ImLeaveGuardContext.Provider value={value}>{children}</ImLeaveGuardContext.Provider>;
}

export function useImLeaveGuard() {
  const ctx = useContext(ImLeaveGuardContext);
  if (!ctx) {
    throw new Error('useImLeaveGuard must be used within ImLeaveGuardProvider');
  }
  return ctx;
}
