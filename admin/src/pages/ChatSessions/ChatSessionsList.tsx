import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import type { ProFormInstance } from '@ant-design/pro-components';
import { Button, Badge, DatePicker, Modal, Popconfirm, Select, Space, Spin, Switch, Tag, Tooltip, Typography, Alert } from 'antd';
import { CheckOutlined, ClearOutlined, CommentOutlined, DisconnectOutlined, DownloadOutlined, EyeOutlined, LoadingOutlined, TranslationOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { adminFetch, adminFetchJson, formatDate, getAdminSession, showError, showSuccess, showWarning } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ChatSessionItem, ChatSessionMessage, ChatSessionMessagesResponse, ContentCompanion } from '../../types';
import { getAppLanguage } from '../../locales';
import TakeoverWindow from './TakeoverWindow';
import ImReplyModeBar from './ImReplyModeBar';
import {
  appendImSessionFilters,
  assignOpsAdmin,
  fetchImMessages,
  formatUtcIsoSeconds,
  IM_MESSAGE_PAGE_SIZE,
  loadAdminOptions,
  markImAllRead,
  parseDownloadFilename,
  readBlobApiError,
  translateImText,
  utcIsoToFileStamp,
  utcIsoToPickerValue,
  visibleImMessages,
  loadPersistedTakeovers,
  opsAdminLabel,
  parseImSessions,
  persistedToSession,
  readApiError,
  releaseTakeover,
  savePersistedTakeovers,
  sessionToPersisted,
  type PersistedTakeover,
} from './imApi';
import { normalizeCompanion, unwrapResults } from '../Companions/contentApi';
import { useResizableColumns } from '../../components/resizableColumns';
import { SHOW_IM_MESSAGE_ALERTS, useImUnread } from './ImUnreadContext';
import { isChatSessionsPath, useImLeaveGuard } from './ImLeaveGuardContext';
import { ImMomentCard, parseImMomentContent } from './ImMomentCard';
import { ImMessageContent } from './ImChatImage';
import { ImUnpaidMark } from './ImUnpaidMark';

const { Text } = Typography;

const TRANSLATE_MAX_LEN = 6000;

function canTranslateMessage(msg: ChatSessionMessage) {
  const role = (msg.role || '').toLowerCase();
  if (role === 'moment' || role === 'system') return false;
  const text = (msg.content || '').trim();
  return text.length > 0 && text.length <= TRANSLATE_MAX_LEN;
}

function sessionKey(row: { user_id: number; companion_id: string }) {
  return `${row.user_id}-${row.companion_id}`;
}

function resolveHasOlder(res: ChatSessionMessagesResponse | null | undefined) {
  if (!res) return false;
  if (typeof res.has_older === 'boolean') return res.has_older;
  const page = Math.max(1, res.page ?? 1);
  const pageSize = Math.max(1, res.page_size ?? IM_MESSAGE_PAGE_SIZE);
  const total = typeof res.total === 'number' ? res.total : 0;
  if (total > 0) return page * pageSize < total;
  return (res.messages?.length ?? 0) >= pageSize;
}

export default function ChatSessionsList() {
  const { t } = useTranslation();
  const location = useLocation();
  const { setGuard } = useImLeaveGuard();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance>(undefined);
  const locale = getAppLanguage();
  const [adminOptions, setAdminOptions] = useState<{ value: number; label: string }[]>([]);
  const [companionOptions, setCompanionOptions] = useState<{ value: string; label: string }[]>([]);
  const [companionLoading, setCompanionLoading] = useState(false);
  const [companionLoadingMore, setCompanionLoadingMore] = useState(false);
  const [companionPage, setCompanionPage] = useState(1);
  const [companionHasMore, setCompanionHasMore] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ChatSessionMessagesResponse | null>(null);
  const [detailHasOlder, setDetailHasOlder] = useState(false);
  const [detailLoadingOlder, setDetailLoadingOlder] = useState(false);
  const [detailPageTranslate, setDetailPageTranslate] = useState(false);
  const [detailTranslatingPage, setDetailTranslatingPage] = useState(false);
  const [detailTranslatingIds, setDetailTranslatingIds] = useState<Set<number | string>>(new Set());
  const [detailTranslatedIds, setDetailTranslatedIds] = useState<Set<number | string>>(new Set());
  const [showUnpaidMessages, setShowUnpaidMessages] = useState(false);
  const showUnpaidMessagesRef = useRef(false);
  const detailTranslatingIdsRef = useRef<Set<number | string>>(new Set());
  const detailListRef = useRef<HTMLDivElement | null>(null);
  const detailOldestPageRef = useRef(1);
  const detailHasOlderRef = useRef(false);
  const detailLoadingOlderRef = useRef(false);
  const detailPageTranslateRef = useRef(false);
  const [takeovers, setTakeovers] = useState<PersistedTakeover[]>(() => loadPersistedTakeovers());
  const takeoversRef = useRef(takeovers);
  const { summary, markSessionOpened, clearSessionUnread, sessionUnreadOf, applyReadAll } = useImUnread();
  const unreadTotalRef = useRef(summary.total_unread);
  const listTimeRef = useRef<{ time_mode: string; start_at: string | null; end_at: string | null }>({
    time_mode: 'last_2_days',
    start_at: null,
    end_at: null,
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  detailPageTranslateRef.current = detailPageTranslate;
  showUnpaidMessagesRef.current = showUnpaidMessages;

  takeoversRef.current = takeovers;

  const releaseAllTakeovers = useCallback(async () => {
    const items = takeoversRef.current;
    await Promise.all(
      items.map(async (row) => {
        try {
          await releaseTakeover(row.user_id, row.companion_id);
        } catch {
          /* ignore */
        }
      }),
    );
    setTakeovers([]);
    savePersistedTakeovers([]);
  }, []);

  useEffect(() => {
    setGuard({
      shouldBlock: (nextPath) => {
        if (takeoversRef.current.length === 0) return false;
        const onPage = isChatSessionsPath(location.pathname);
        const leaving = !isChatSessionsPath(nextPath);
        return onPage && leaving;
      },
      requestLeave: () =>
        new Promise((resolve) => {
          Modal.confirm({
            title: t('im.confirmLeavePage') as string,
            content: t('im.confirmLeavePageHint') as string,
            okText: t('btn.confirm') as string,
            cancelText: t('btn.cancel') as string,
            onOk: async () => {
              await releaseAllTakeovers();
              showSuccess(t('im.releasedAll') as string);
              resolve(true);
            },
            onCancel: () => resolve(false),
          });
        }),
    });
    return () => setGuard(null);
  }, [location.pathname, releaseAllTakeovers, setGuard, t]);

  useEffect(() => {
    savePersistedTakeovers(takeovers);
  }, [takeovers]);

  useEffect(() => {
    void loadAdminOptions().then(setAdminOptions);
  }, []);

  const fetchCompanions = useCallback(async (page = 1, isLoadMore = false) => {
    if (isLoadMore) {
      if (companionLoadingMore) return;
      setCompanionLoadingMore(true);
    } else {
      if (companionLoading) return;
      setCompanionLoading(true);
    }
    try {
      const res = await adminFetchJson(`/api/admin/content/companions?page=${page}&page_size=20`);
      const list = (unwrapResults<ContentCompanion[]>(res) ?? []).map(normalizeCompanion);
      const newOptions = list.map((c) => ({ value: c.id, label: `${c.name || c.id} (${c.id})` }));
      const pagination = (res as { pagination?: { total?: number; page?: number; page_size?: number; total_pages?: number } } | null)?.pagination;
      const totalPages = pagination?.total_pages ?? 1;
      setCompanionHasMore(page < totalPages);
      setCompanionPage(page);
      if (isLoadMore) {
        setCompanionOptions((prev) => [...prev, ...newOptions]);
      } else {
        setCompanionOptions(newOptions);
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      if (isLoadMore) {
        setCompanionLoadingMore(false);
      } else {
        setCompanionLoading(false);
      }
    }
  }, [companionLoading, companionLoadingMore, t]);

  const loadCompanionsRef = useRef<(page?: number, isLoadMore?: boolean) => void>(() => {});
  loadCompanionsRef.current = fetchCompanions;

  const openDetail = useCallback(
    async (row: ChatSessionItem) => {
      const unread = sessionUnreadOf(row.user_id, row.companion_id, row.ops_unread_count ?? 0);
      markSessionOpened(row.user_id, row.companion_id, unread);
      setDetailOpen(true);
      setDetailLoading(true);
      setDetail(null);
      setDetailHasOlder(false);
      detailHasOlderRef.current = false;
      detailOldestPageRef.current = 1;
      setDetailPageTranslate(false);
      setDetailTranslatingPage(false);
      detailTranslatingIdsRef.current = new Set();
      setDetailTranslatingIds(new Set());
      setDetailTranslatedIds(new Set());
      try {
        const res = await fetchImMessages(row.user_id, row.companion_id, {
          page: 1,
          page_size: IM_MESSAGE_PAGE_SIZE,
        });
        if (res == null) {
          showError(t('toast.authRequired') as string);
          setDetailOpen(false);
          return;
        }
        const hasOlder = resolveHasOlder(res);
        detailOldestPageRef.current = res.page ?? 1;
        detailHasOlderRef.current = hasOlder;
        setDetailHasOlder(hasOlder);
        setDetail({
          ...res,
          username: res.username || row.username,
          nickname: res.nickname || row.nickname,
          companion_name: res.companion_name || row.companion_name,
        });
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
        setDetailOpen(false);
      } finally {
        setDetailLoading(false);
      }
    },
    [markSessionOpened, sessionUnreadOf, t],
  );

  const patchDetailMessages = useCallback((updater: (prev: ChatSessionMessage[]) => ChatSessionMessage[]) => {
    setDetail((prev) => (prev ? { ...prev, messages: updater(prev.messages) } : prev));
  }, []);

  const loadDetailOlder = useCallback(async () => {
    if (!detail || detailLoadingOlderRef.current || !detailHasOlderRef.current) return;
    detailLoadingOlderRef.current = true;
    setDetailLoadingOlder(true);
    try {
      const nextPage = detailOldestPageRef.current + 1;
      const res = await fetchImMessages(detail.user_id, detail.companion_id, {
        page: nextPage,
        page_size: detail.page_size || IM_MESSAGE_PAGE_SIZE,
        translate: detailPageTranslateRef.current,
      });
      const incoming = res?.messages ?? [];
      const existingIds = new Set(detail.messages.map((m) => m.id));
      const older = incoming.filter((m) => !existingIds.has(m.id));
      const hasOlder = older.length > 0 && resolveHasOlder(res);
      detailOldestPageRef.current = res?.page ?? nextPage;
      detailHasOlderRef.current = hasOlder;
      setDetailHasOlder(hasOlder);

      const el = detailListRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const prevTop = el?.scrollTop ?? 0;
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          page: res?.page ?? prev.page,
          page_size: res?.page_size ?? prev.page_size,
          has_older: hasOlder,
          total: res?.total ?? prev.total,
          messages: older.length ? [...older, ...prev.messages] : prev.messages,
        };
      });
      if (older.length) {
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
        });
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    } finally {
      detailLoadingOlderRef.current = false;
      setDetailLoadingOlder(false);
    }
  }, [detail, t]);

  const handleDetailTranslateOne = useCallback(
    async (msg: ChatSessionMessage) => {
      if (!canTranslateMessage(msg) || detailTranslatingIdsRef.current.has(msg.id)) return;
      if (msg.translated_content != null) {
        setDetailTranslatedIds((prev) => new Set(prev).add(msg.id));
        return;
      }
      detailTranslatingIdsRef.current.add(msg.id);
      setDetailTranslatingIds(new Set(detailTranslatingIdsRef.current));
      try {
        const data = await translateImText(msg.content);
        if (data?.translated != null) {
          patchDetailMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, translated_content: data.translated } : m)),
          );
          setDetailTranslatedIds((prev) => new Set(prev).add(msg.id));
        } else if (data && !data.skipped) {
          showError(t('im.translateFailed') as string);
        }
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
      } finally {
        detailTranslatingIdsRef.current.delete(msg.id);
        setDetailTranslatingIds(new Set(detailTranslatingIdsRef.current));
      }
    },
    [patchDetailMessages, t],
  );

  const handleDetailPageTranslateChange = useCallback(
    async (checked: boolean) => {
      setDetailPageTranslate(checked);
      if (!checked || !detail) return;
      const missing = detail.messages.some((m) => canTranslateMessage(m) && m.translated_content == null);
      if (!missing) return;
      setDetailTranslatingPage(true);
      try {
        const pages = Array.from({ length: Math.max(1, detailOldestPageRef.current) }, (_, i) => i + 1);
        const pageSize = detail.page_size || IM_MESSAGE_PAGE_SIZE;
        const results = await Promise.all(
          pages.map((page) =>
            fetchImMessages(detail.user_id, detail.companion_id, {
              page,
              page_size: pageSize,
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
        patchDetailMessages((prev) =>
          prev.map((m) => {
            const next = translatedById.get(m.id);
            return next != null ? { ...m, translated_content: next } : m;
          }),
        );
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
      } finally {
        setDetailTranslatingPage(false);
      }
    },
    [detail, patchDetailMessages, t],
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetail(null);
    setDetailHasOlder(false);
    detailHasOlderRef.current = false;
    detailOldestPageRef.current = 1;
    setDetailLoadingOlder(false);
    detailLoadingOlderRef.current = false;
    setDetailPageTranslate(false);
    setDetailTranslatingPage(false);
    detailTranslatingIdsRef.current = new Set();
    setDetailTranslatingIds(new Set());
    setDetailTranslatedIds(new Set());
  }, []);

  const handleMarkReadAll = useCallback(async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    try {
      const res = await markImAllRead();
      if (!res) {
        showError(t('toast.authRequired') as string);
        return;
      }
      applyReadAll(res);
      showSuccess(t('im.markReadAllDone', { count: res.cleared_unread, sessions: res.cleared_sessions }) as string);
      actionRef.current?.reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    } finally {
      setMarkingAllRead(false);
    }
  }, [applyReadAll, markingAllRead, t]);

  const openExportModal = useCallback(() => {
    const start = utcIsoToPickerValue(listTimeRef.current.start_at);
    const end = utcIsoToPickerValue(listTimeRef.current.end_at);
    if (start && end) {
      setExportRange([dayjs(start), dayjs(end)]);
    } else {
      setExportRange(null);
    }
    setExportOpen(true);
  }, []);

  const handleExportChats = useCallback(async () => {
    const start = exportRange?.[0];
    const end = exportRange?.[1];
    if (!start || !end) {
      showError(t('im.selectTimeRange') as string);
      return;
    }
    const startAt = formatUtcIsoSeconds(start);
    const endAt = formatUtcIsoSeconds(end);
    if (!startAt || !endAt) {
      showError(t('im.selectTimeRange') as string);
      return;
    }
    if (startAt > endAt) {
      showError(t('im.startAfterEnd') as string);
      return;
    }
    if (exporting) return;
    setExporting(true);
    try {
      const q = new URLSearchParams({ start_at: startAt, end_at: endAt });
      const formValues = (formRef.current?.getFieldsValue?.() || {}) as Record<string, unknown>;
      appendImSessionFilters(q, {
        ...formValues,
        companion_id: formValues.companion_ids ?? formValues.companion_id,
      });
      const res = await adminFetch(`/api/admin/im/sessions/export?${q.toString()}`);
      if (!res) {
        showError(t('toast.authRequired') as string);
        return;
      }
      const blob = await res.blob();
      if (!res.ok) {
        showError(await readBlobApiError(res, blob, t('toast.exportFailed') as string));
        return;
      }
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = parseDownloadFilename(
        res.headers.get('content-disposition'),
        `IM聊天记录_${utcIsoToFileStamp(startAt)}_${utcIsoToFileStamp(endAt)}.xlsx`,
      );
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);
      setExportOpen(false);
      showSuccess(t('toast.exportSuccess') as string);
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.exportFailed') as string));
    } finally {
      setExporting(false);
    }
  }, [exportRange, exporting, t]);

  const handleMarkRead = useCallback(
    async (row: ChatSessionItem) => {
      const unread = sessionUnreadOf(row.user_id, row.companion_id, row.ops_unread_count ?? 0);
      const ok = await clearSessionUnread(row.user_id, row.companion_id, unread);
      if (ok) {
        showSuccess(t('im.markReadDone') as string);
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    },
    [clearSessionUnread, sessionUnreadOf, t],
  );

  const handleClear = useCallback(
    async (row: ChatSessionItem) => {
      const q = new URLSearchParams({
        user_id: String(row.user_id),
        companion_id: row.companion_id,
      });
      try {
        const res = await adminFetch(`/api/admin/im/sessions/messages?${q.toString()}`, { method: 'DELETE' });
        if (res && res.ok) {
          showSuccess(t('toast.deleteSuccess') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readApiError(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      }
    },
    [t],
  );

  const handleAssignOps = useCallback(
    async (row: ChatSessionItem, opsAdminId: number | null) => {
      try {
        const res = await assignOpsAdmin(row.user_id, row.companion_id, opsAdminId);
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readApiError(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      }
    },
    [t],
  );

  const openTakeover = useCallback((row: ChatSessionItem) => {
    setTakeovers((prev) => {
      const key = sessionKey(row);
      if (prev.some((item) => sessionKey(item) === key)) {
        return prev.map((item) => (sessionKey(item) === key ? { ...item, minimized: false } : item));
      }
      return [...prev, sessionToPersisted(row, { minimized: false })];
    });
  }, []);

  const closeTakeoverWindow = useCallback((row: { user_id: number; companion_id: string }) => {
    setTakeovers((prev) => prev.filter((item) => sessionKey(item) !== sessionKey(row)));
  }, []);

  const openCompanionUnread = useCallback(
    async (companionId: string) => {
      formRef.current?.setFieldsValue({ companion_ids: [companionId] });
      actionRef.current?.reload(true);
      try {
        const q = new URLSearchParams({
          page: '1',
          page_size: '50',
          companion_id: companionId,
        });
        const res = await adminFetchJson(`/api/admin/im/sessions?${q.toString()}`);
        if (res == null) {
          showError(t('toast.authRequired') as string);
          return;
        }
        const { list } = parseImSessions(res);
        const myId = getAdminSession()?.user_id;
        const unreadRows = list.filter((row) => (row.ops_unread_count ?? 0) > 0);
        const openable = unreadRows.filter((row) => {
          const canTakeover = !row.is_taken_over && row.can_takeover !== false;
          const mine = row.is_taken_over && row.takeover_by === myId;
          return canTakeover || mine;
        });
        const toOpen = (openable.length ? openable : unreadRows).slice(0, 8);
        if (!toOpen.length) {
          showWarning(t('im.noCompanionUnreadSession') as string);
          return;
        }
        toOpen.forEach((row) => openTakeover(row));
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      }
    },
    [openTakeover, t],
  );

  const handleReleaseTakeover = useCallback(
    async (row: ChatSessionItem) => {
      try {
        const res = await releaseTakeover(row.user_id, row.companion_id);
        if (!res) {
          showError(t('toast.authRequired') as string);
          return;
        }
        if (!res.ok) {
          showError(await readApiError(res, t('toast.loadFailed') as string));
          return;
        }
        let reason = 'manual';
        try {
          const data = (await res.json()) as { reason?: string };
          if (data?.reason) reason = data.reason;
        } catch {
          /* ignore */
        }
        closeTakeoverWindow(row);
        showSuccess((reason === 'force' ? t('im.forceReleased') : t('im.released')) as string);
        actionRef.current?.reload();
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      }
    },
    [closeTakeoverWindow, t],
  );

  const confirmToggleUnpaid = useCallback(() => {
    const showing = showUnpaidMessagesRef.current;
    Modal.confirm({
      title: showing ? (t('im.hideUnpaidConfirm') as string) : (t('im.showUnpaidConfirm') as string),
      okText: t('btn.confirm') as string,
      cancelText: t('btn.cancel') as string,
      onOk: () => setShowUnpaidMessages(!showing),
    });
  }, [t]);

  const columns: ProColumns<ChatSessionItem>[] = useMemo(
    () => [
    {
      title: (
        <span onDoubleClick={(e) => { e.preventDefault(); confirmToggleUnpaid(); }}>
          {t('table.userId')}
        </span>
      ),
      dataIndex: 'user_id',
      width: 90,
      fieldProps: {
        onDoubleClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          confirmToggleUnpaid();
        },
      },
    },
    {
      title: t('table.user'),
      key: 'user',
      search: false,
      ellipsis: true,
      width: 140,
      render: (_: unknown, record: ChatSessionItem) => record.nickname || record.username || '—',
    },
    {
      title: t('table.nickname'),
      dataIndex: 'user_nickname',
      hideInTable: true,
    },
    {
      title: t('im.timeMode'),
      dataIndex: 'time_mode',
      hideInTable: true,
      valueType: 'select',
      initialValue: 'last_2_days',
      tooltip: t('im.timeRangeHint'),
      fieldProps: {
        allowClear: false,
        options: [
          { value: 'last_2_days', label: t('im.timeModeLast2Days') },
          { value: 'custom', label: t('im.timeModeCustom') },
          { value: 'all', label: t('im.timeModeAll') },
        ],
      },
    },
    {
      title: t('im.customRange'),
      dataIndex: 'time_range',
      hideInTable: true,
      valueType: 'dateTimeRange',
      colSize: 2,
      fieldProps: {
        showTime: { format: 'HH:mm:ss' },
        format: 'YYYY-MM-DD HH:mm:ss',
        placeholder: [t('im.startAtUtc'), t('im.endAtUtc')],
      },
    },
    {
      title: t('table.companionId'),
      dataIndex: 'companion_id',
      width: 110,
      ellipsis: true,
      search: false,
    },
    {
      title: t('table.companion'),
      dataIndex: 'companion_name',
      ellipsis: true,
      search: false,
      width: 160,
      render: (_: unknown, record: ChatSessionItem) => record.companion_name || '—',
    },
    {
      dataIndex: 'companion_ids',
      hideInTable: true,
      search: {
        transform: (value) => ({ companion_id: value }),
      },
      valueType: 'select',
      fieldProps: {
        mode: 'multiple',
        options: companionOptions,
        loading: companionLoading,
        placeholder: t('table.companion'),
        notFoundContent: companionLoading ? t('loading') : undefined,
        onDropdownVisibleChange: (open: boolean) => {
          if (open) loadCompanionsRef.current(1, false);
        },
        onPopupScroll: (e: React.UIEvent) => {
          if (!companionHasMore || companionLoadingMore) return;
          const target = e.target as HTMLElement;
          if (target.scrollTop + target.clientHeight >= target.scrollHeight - 50) {
            loadCompanionsRef.current(companionPage + 1, true);
          }
        },
        optionFilterProp: 'label',
        showSearch: true,
        allowClear: true,
        dropdownRender: (menu: React.ReactNode) => (
          <div>
            {menu}
            {companionLoadingMore && (
              <div
                style={{
                  padding: '8px 12px',
                  textAlign: 'center',
                  fontSize: 12,
                  color: '#999',
                }}
              >
                <Spin indicator={<LoadingOutlined style={{ fontSize: 14 }} spin />} />
                <span style={{ marginLeft: 8 }}>{t('loading')}</span>
              </div>
            )}
          </div>
        ),
      },
    },
    {
      title: (
        <Tooltip title={t('table.messageCountHint')}>
          <span>{t('table.messageCount')}</span>
        </Tooltip>
      ),
      dataIndex: 'message_count',
      width: 90,
      search: false,
    },
    {
      title: t('table.turns'),
      dataIndex: 'turns',
      width: 90,
      search: false,
    },
    {
      title: t('table.lastMessage'),
      dataIndex: 'last_message',
      ellipsis: true,
      search: false,
      width: 180,
      render: (_: unknown, record: ChatSessionItem) => {
        const moment = parseImMomentContent(record.last_message);
        if (moment) return moment.caption || (t('im.moment') as string);
        return record.last_message || '—';
      },
    },
    {
      title: (
        <Tooltip title={t('im.unreadHint')}>
          <span>{t('im.unread')}</span>
        </Tooltip>
      ),
      dataIndex: 'ops_unread_count',
      width: 80,
      search: false,
      render: (_: unknown, record: ChatSessionItem) => {
        const count = sessionUnreadOf(record.user_id, record.companion_id, record.ops_unread_count ?? 0);
        return count > 0 ? <Badge count={count} overflowCount={99} /> : <Text type="secondary">0</Text>;
      },
    },
    {
      title: (
        <Tooltip title={t('table.sessionUpdatedAtHint')}>
          <span>{t('table.sessionUpdatedAt')}</span>
        </Tooltip>
      ),
      dataIndex: 'session_updated_at',
      width: 180,
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
      render: (_: unknown, record: ChatSessionItem) => (
        <FormatDate value={record.session_updated_at} locale={locale} />
      ),
    },
    {
      title: t('im.opsAdmin'),
      dataIndex: 'ops_admin_id',
      width: 180,
      valueType: 'select',
      fieldProps: { options: adminOptions, allowClear: true, showSearch: true, optionFilterProp: 'label' },
      render: (_: unknown, record: ChatSessionItem) => (
        <Select
          size="small"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          placeholder={t('im.assignOps')}
          value={record.ops_admin_id ?? undefined}
          options={adminOptions}
          onChange={(value) => void handleAssignOps(record, value ?? null)}
        />
      ),
    },
    {
      title: t('im.takeoverState'),
      dataIndex: 'takeover_only',
      width: 130,
      valueType: 'select',
      valueEnum: {
        true: { text: t('im.takenOver') },
        false: { text: t('im.notTakenOver') },
      },
      render: (_: unknown, record: ChatSessionItem) => {
        if (!record.is_taken_over) return <Tag>{t('im.notTakenOver')}</Tag>;
        const name = opsAdminLabel(record.takeover_admin);
        return (
          <Tag color="processing">{name ? t('im.takenOverBy', { name }) : t('im.takenOver')}</Tag>
        );
      },
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 420,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: ChatSessionItem) => {
        const unread = sessionUnreadOf(record.user_id, record.companion_id, record.ops_unread_count ?? 0);
        const myId = getAdminSession()?.user_id;
        const mine = record.takeover_by != null && record.takeover_by === myId;
        const canTakeover = !record.is_taken_over && record.can_takeover !== false;
        const canRelease =
          !!record.is_taken_over && (record.can_release === true || (record.can_release == null && mine));
        const canOpenChat = !!record.is_taken_over && mine;
        return (
        <Space size={0} wrap>
          <Button type="link" icon={<EyeOutlined />} onClick={() => void openDetail(record)}>
            {t('btn.view')}
          </Button>
          <Button
            type="link"
            icon={<CheckOutlined />}
            disabled={unread <= 0}
            onClick={() => void handleMarkRead(record)}
          >
            {t('im.markRead')}
          </Button>
          <Popconfirm
            title={t('im.confirmClear')}
            onConfirm={() => handleClear(record)}
            okText={t('btn.confirm')}
            cancelText={t('btn.cancel')}
          >
            <Button type="link" danger icon={<ClearOutlined />}>
              {t('im.clear')}
            </Button>
          </Popconfirm>
          {canTakeover ? (
            <Button type="link" icon={<CommentOutlined />} onClick={() => openTakeover(record)}>
              {t('im.takeover')}
            </Button>
          ) : null}
          {canOpenChat ? (
            <Button type="link" icon={<CommentOutlined />} onClick={() => openTakeover(record)}>
              {t('im.openChat')}
            </Button>
          ) : null}
          {canRelease ? (
            <Popconfirm
              title={mine ? t('im.confirmReleaseRow') : t('im.confirmForceRelease')}
              onConfirm={() => void handleReleaseTakeover(record)}
              okText={t('btn.confirm')}
              cancelText={t('btn.cancel')}
            >
              <Button type="link" danger icon={<DisconnectOutlined />}>
                {mine ? t('im.release') : t('im.forceRelease')}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
        );
      },
    },
  ],
    [
      adminOptions,
      companionHasMore,
      companionLoading,
      companionLoadingMore,
      companionOptions,
      companionPage,
      confirmToggleUnpaid,
      handleAssignOps,
      handleClear,
      handleMarkRead,
      handleReleaseTakeover,
      locale,
      openDetail,
      openTakeover,
      sessionUnreadOf,
      t,
    ],
  );

  const { columns: tableColumns, scrollX, components } = useResizableColumns(
    columns,
    'admin.table.colWidths.chat-sessions',
  );

  useEffect(() => {
    if (summary.total_unread > unreadTotalRef.current) {
      actionRef.current?.reload();
    }
    unreadTotalRef.current = summary.total_unread;
  }, [summary.total_unread]);

  const visibleDetailMessages = useMemo(
    () => visibleImMessages(detail?.messages, showUnpaidMessages),
    [detail?.messages, showUnpaidMessages],
  );

  const companionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    companionOptions.forEach((item) => map.set(item.value, item.label));
    return map;
  }, [companionOptions]);

  return (
    <div>
      <h2>{t('page.chatSessions')}</h2>
      <ImReplyModeBar />
      {SHOW_IM_MESSAGE_ALERTS && summary.total_unread > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('im.unreadSummary', { count: summary.total_unread, sessions: summary.session_count })}
        />
      )}
      {SHOW_IM_MESSAGE_ALERTS && summary.by_companion.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ marginRight: 8 }}>{t('im.unreadCompanions')}</Text>
          <Space wrap size={[8, 8]}>
            {summary.by_companion.map((item) => (
              <Tooltip key={item.companion_id} title={t('im.openCompanionUnread')}>
                <Tag
                  color="red"
                  style={{ cursor: 'pointer' }}
                  onClick={() => void openCompanionUnread(item.companion_id)}
                >
                  {item.companion_name || companionNameMap.get(item.companion_id) || item.companion_id}
                  <Badge
                    count={item.unread_count}
                    overflowCount={99}
                    size="small"
                    style={{ marginLeft: 6, background: '#fff', color: '#cf1322', boxShadow: '0 0 0 1px #ffa39e inset' }}
                  />
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </div>
      )}
      <ProTable<ChatSessionItem>
        actionRef={actionRef}
        formRef={formRef}
        columns={tableColumns}
        rowKey={(r) => sessionKey(r)}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        components={components}
        scroll={{ x: scrollX }}
        tableLayout="fixed"
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        toolBarRender={() => [
          <Button key="export" icon={<DownloadOutlined />} onClick={openExportModal}>
            {t('im.exportChats')}
          </Button>,
          <Popconfirm
            key="readAll"
            title={t('im.confirmMarkReadAll')}
            okText={t('btn.confirm')}
            cancelText={t('btn.cancel')}
            onConfirm={() => void handleMarkReadAll()}
          >
            <Button icon={<CheckOutlined />} loading={markingAllRead}>
              {t('im.markReadAll')}
            </Button>
          </Popconfirm>,
        ]}
        request={async (params, sort) => {
          const page = Math.max(1, Number(params.current) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
          const timeMode = String(params.time_mode || 'last_2_days');
          const range = Array.isArray(params.time_range) ? params.time_range : null;
          let startAt = '';
          let endAt = '';
          if (timeMode === 'custom') {
            startAt = formatUtcIsoSeconds(range?.[0]);
            endAt = formatUtcIsoSeconds(range?.[1]);
            if (!startAt || !endAt) {
              showError(t('im.selectTimeRange') as string);
              return { data: [], success: false, total: 0 };
            }
            if (startAt > endAt) {
              showError(t('im.startAfterEnd') as string);
              return { data: [], success: false, total: 0 };
            }
          }
          const q = new URLSearchParams({
            page: String(page),
            page_size: String(pageSize),
            time_mode: timeMode,
          });
          if (timeMode === 'custom') {
            q.set('start_at', startAt);
            q.set('end_at', endAt);
          }
          appendImSessionFilters(q, params);
          // 后端暂未接入 sort_by；列表仍固定按用户最近发言时间，这里只做当前页保底排序
          const sortEntry = Object.entries(sort || {}).find(
            ([, order]) => order === 'ascend' || order === 'descend',
          );
          if (sortEntry) {
            const [field, order] = sortEntry;
            q.set('sort_by', field);
            q.set('sort_order', order === 'ascend' ? 'asc' : 'desc');
          }
          try {
            const res = await adminFetchJson(`/api/admin/im/sessions?${q.toString()}`);
            if (res == null) {
              showError(t('toast.authRequired') as string);
              return { data: [], success: false, total: 0 };
            }
            let { list, total, time_mode, start_at, end_at } = parseImSessions(res);
            listTimeRef.current = {
              time_mode: time_mode || timeMode,
              start_at: start_at ?? (timeMode === 'custom' ? startAt : null),
              end_at: end_at ?? (timeMode === 'custom' ? endAt : null),
            };
            // 客户端排序保底:即使后端不支持排序,点击列头也能生效
            if (sortEntry) {
              const [, order] = sortEntry;
              list = [...list].sort((a, b) => {
                const ta = a.session_updated_at ? new Date(a.session_updated_at).getTime() : 0;
                const tb = b.session_updated_at ? new Date(b.session_updated_at).getTime() : 0;
                return order === 'ascend' ? ta - tb : tb - ta;
              });
            }
            return { data: list, success: true, total };
          } catch (e) {
            showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
            return { data: [], success: false, total: 0 };
          }
        }}
      />

      <Modal
        title={t('im.exportRangeTitle')}
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={() => void handleExportChats()}
        confirmLoading={exporting}
        okText={t('im.exportChats') as string}
        cancelText={t('btn.cancel') as string}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {t('im.exportRangeHint')}
        </Text>
        <DatePicker.RangePicker
          showTime={{ format: 'HH:mm:ss' }}
          format="YYYY-MM-DD HH:mm:ss"
          style={{ width: '100%' }}
          value={exportRange}
          onChange={(value) => setExportRange(value as [Dayjs, Dayjs] | null)}
          placeholder={[t('im.startAtUtc') as string, t('im.endAtUtc') as string]}
        />
      </Modal>

      <Modal
        title={
          detail
            ? `${t('modal.chatSessionDetail')} — ${detail.nickname || detail.username} × ${detail.companion_name || detail.companion_id}`
            : t('modal.chatSessionDetail')
        }
        open={detailOpen}
        onCancel={closeDetail}
        footer={null}
        width={720}
        destroyOnHidden
      >
        {detailLoading && <Text type="secondary">{t('loading')}</Text>}
        {!detailLoading && detail && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <Space wrap>
                <Text type="secondary">
                  {t('table.userId')}: {detail.user_id}
                </Text>
                <Text type="secondary">
                  {t('table.companionId')}: {detail.companion_id}
                </Text>
                <Text type="secondary">
                  {t('table.messageCount')}: {visibleDetailMessages.length}
                  {detail.total > visibleDetailMessages.length ? ` / ${detail.total}` : ''}
                </Text>
              </Space>
              {visibleDetailMessages.length > 0 ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <TranslationOutlined style={{ color: detailPageTranslate ? '#1677ff' : '#8c8c8c' }} />
                  {t('im.translatePage')}
                  <Switch
                    size="small"
                    checked={detailPageTranslate}
                    loading={detailTranslatingPage}
                    onChange={(checked) => void handleDetailPageTranslateChange(checked)}
                  />
                </span>
              ) : null}
            </div>
            {visibleDetailMessages.length > 0 || detailHasOlder ? (
              <div style={{ marginBottom: 8 }}>
                <Button
                  size="small"
                  type="link"
                  disabled={!detailHasOlder}
                  loading={detailLoadingOlder}
                  onClick={() => void loadDetailOlder()}
                  style={{ padding: 0 }}
                >
                  {detailHasOlder ? t('im.loadOlder') : t('im.noOlder')}
                </Button>
              </div>
            ) : null}
            <div
              ref={detailListRef}
              style={{
                maxHeight: '60vh',
                overflowY: 'auto',
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                padding: 12,
                background: '#fafafa',
              }}
            >
              {visibleDetailMessages.length === 0 ? (
                <Text type="secondary">{t('empty.messages')}</Text>
              ) : (
                <>
                {detailLoadingOlder ? (
                  <div style={{ textAlign: 'center', padding: '4px 0 10px', color: '#888', fontSize: 12 }}>
                    <Spin size="small" /> {t('im.loadingOlder')}
                  </div>
                ) : null}
                {visibleDetailMessages.map((m) => {
                  const isMoment = (m.role || '').toLowerCase() === 'moment';
                  const showTranslated = !isMoment && (detailPageTranslate || detailTranslatedIds.has(m.id));
                  const displayText = showTranslated ? (m.translated_content || m.content) : m.content;
                  const hasTranslation = Boolean(
                    showTranslated && m.translated_content && m.translated_content !== m.content,
                  );
                  const translating = detailTranslatingIds.has(m.id);
                  const showTranslate = canTranslateMessage(m) && !showTranslated;
                  const isUser = (m.role || '').toLowerCase() === 'user';
                  const align = isUser || isMoment ? 'flex-start' : 'flex-end';
                  const bg = isUser ? '#e6f7ff' : m.role === 'operator' ? '#fff7e6' : isMoment ? '#fff' : '#f6ffed';
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        justifyContent: align,
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 12,
                      }}
                    >
                    <div
                      style={{
                        maxWidth: isMoment ? '86%' : '76%',
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: bg,
                        border: '1px solid #e8e8e8',
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
                          if (showTranslate) void handleDetailTranslateOne(m);
                        }}
                      >
                        <ImMessageContent msg={m} text={displayText} />
                      </div>
                      )}
                      {hasTranslation ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: '#8c8c8c',
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: '1px dashed #d9d9d9',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
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
                            void handleDetailTranslateOne(m);
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
          </div>
        )}
      </Modal>

      {takeovers.map((row, index) => (
        <TakeoverWindow
          key={sessionKey(row)}
          session={persistedToSession(row)}
          offset={index}
          initialMinimized={!!row.minimized}
          initialPos={row.pos}
          showUnpaidMessages={showUnpaidMessages}
          onUiChange={(patch) =>
            setTakeovers((prev) =>
              prev.map((item) => (sessionKey(item) === sessionKey(row) ? { ...item, ...patch } : item)),
            )
          }
          onTakenOver={() => actionRef.current?.reload()}
          onClosed={(closed) => {
            setTakeovers((prev) => prev.filter((item) => sessionKey(item) !== sessionKey(closed)));
            actionRef.current?.reload();
          }}
        />
      ))}
    </div>
  );
}
