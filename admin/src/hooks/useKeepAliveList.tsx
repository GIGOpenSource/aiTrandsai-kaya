/* eslint-disable react-refresh/only-export-components */
import { Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ActionType } from '@ant-design/pro-table';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function restorePageScroll(top: number) {
  document
    .querySelectorAll('.ant-pro-layout-content, .ant-layout-content, .ant-pro-layout .ant-layout')
    .forEach((el) => {
      (el as HTMLElement).scrollTop = top;
    });
  const scrolling = document.scrollingElement as HTMLElement | null;
  if (scrolling) scrolling.scrollTop = top;
  window.scrollTo(0, top);
}

function readPageScroll(from: HTMLElement | null): number {
  const tops: number[] = [window.scrollY];
  const push = (el: Element | null | undefined) => {
    if (el && 'scrollTop' in el) tops.push((el as HTMLElement).scrollTop);
  };
  push(from);
  push(document.scrollingElement);
  document
    .querySelectorAll('.ant-pro-layout-content, .ant-layout-content, .ant-pro-layout .ant-layout')
    .forEach(push);
  let node = from?.parentElement ?? null;
  while (node && node !== document.body) {
    tops.push(node.scrollTop);
    node = node.parentElement;
  }
  return Math.max(0, ...tops);
}

export function KeepAliveOutlet() {
  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
}

const TABLE_PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

/** ProTable 受控分页：避免写死 pageSize 后切换每页条数被重置。 */
export function useTablePagination(defaultPageSize = 20) {
  const [pageSize, setPageSize] = useState(defaultPageSize);
  return {
    pageSize,
    showSizeChanger: true as const,
    pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
    onChange(_page: number, next?: number) {
      if (typeof next === 'number' && next > 0 && next !== pageSize) {
        setPageSize(next);
      }
    },
  };
}

export function useKeepAliveList<T>(options: {
  listPath: string;
  getRowId: (row: T) => string | number;
  fetchRow?: (id: string) => Promise<T | null | undefined>;
  /** 若设置，仅当从 /new 返回且 location.state[key] 为真时才整表刷新 */
  createdStateKey?: string;
}) {
  const { listPath, getRowId, fetchRow, createdStateKey } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType | null>(null);
  const listWrapRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);
  const pendingPatchIdRef = useRef<string | null>(null);
  const prevPathRef = useRef(location.pathname);
  const fetchRowRef = useRef(fetchRow);
  const getRowIdRef = useRef(getRowId);
  const [dataSource, setDataSource] = useState<T[]>([]);

  useLayoutEffect(() => {
    fetchRowRef.current = fetchRow;
    getRowIdRef.current = getRowId;
  });

  const listPathNorm = listPath.replace(/\/$/, '') || '/';
  const isListPage = location.pathname === listPathNorm || location.pathname === `${listPathNorm}/`;
  const newPath = `${listPathNorm}/new`;

  const goToChild = useCallback(
    (path: string) => {
      savedScrollRef.current = readPageScroll(listWrapRef.current);
      navigate(path);
    },
    [navigate],
  );

  const patchRow = useCallback(async (id: string) => {
    const fetch = fetchRowRef.current;
    if (!fetch) return;
    try {
      const item = await fetch(id);
      if (!item) return;
      setDataSource((prev) => {
        const rid = String(getRowIdRef.current(item));
        if (!prev.some((row) => String(getRowIdRef.current(row)) === rid)) return prev;
        return prev.map((row) => (String(getRowIdRef.current(row)) === rid ? { ...row, ...item } : row));
      });
    } catch {
      /* 单条刷新失败时保留现有行 */
    }
  }, []);

  useLayoutEffect(() => {
    const editRe = new RegExp(`^${escapeRegExp(listPathNorm)}/([^/]+)/edit$`);
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;

    const editMatch = location.pathname.match(editRe);
    if (editMatch) {
      pendingPatchIdRef.current = decodeURIComponent(editMatch[1]);
      return;
    }
    if (location.pathname === newPath) {
      pendingPatchIdRef.current = null;
      return;
    }
    if (!isListPage) return;

    const returnedFromChild = prev === newPath || editRe.test(prev);
    if (!returnedFromChild) return;

    restorePageScroll(savedScrollRef.current);
    window.dispatchEvent(new Event('resize'));

    if (prev === newPath) {
      pendingPatchIdRef.current = null;
      const created = createdStateKey
        ? Boolean((location.state as Record<string, unknown> | null)?.[createdStateKey])
        : true;
      if (created) {
        if (createdStateKey) {
          navigate(listPathNorm, { replace: true, state: {} });
        }
        actionRef.current?.reload();
      }
      return;
    }

    const id = pendingPatchIdRef.current;
    pendingPatchIdRef.current = null;
    if (id != null) void patchRow(id);
  }, [
    createdStateKey,
    isListPage,
    listPathNorm,
    location.pathname,
    location.state,
    navigate,
    newPath,
    patchRow,
  ]);

  return {
    isListPage,
    listWrapRef,
    dataSource,
    setDataSource,
    actionRef,
    goToChild,
  };
}
