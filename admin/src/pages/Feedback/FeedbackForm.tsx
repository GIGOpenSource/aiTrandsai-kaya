import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Input, Button, Card, Badge, Switch } from 'antd';
import { ArrowLeftOutlined, SendOutlined, TranslationOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError, showWarning, formatDate } from '../../api/request';
import type { FeedbackMessage, FeedbackThreadDetail } from '../../types';
import { getAppLanguage } from '../../locales';
import { translateImText } from '../ChatSessions/imApi';

const POLL_MS = 4000;
const TRANSLATE_MAX_LEN = 6000;
/** 意见反馈统一译成中文，不跟随后台界面语言 */
const FEEDBACK_TRANSLATE_LANG = 'zh-CN';

function canTranslateFeedback(msg: FeedbackMessage) {
  const text = (msg.content || '').trim();
  return text.length > 0 && text.length <= TRANSLATE_MAX_LEN;
}

function keepTranslations(incoming: FeedbackMessage[], prevList: FeedbackMessage[]) {
  const prevById = new Map(prevList.map((m) => [m.id, m]));
  return incoming.map((m) => {
    const old = prevById.get(m.id);
    if (old?.translated_content != null && m.translated_content == null) {
      return { ...m, translated_content: old.translated_content };
    }
    return m;
  });
}

function normalizeDetail(raw: unknown, fallbackId?: string): FeedbackThreadDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const messages = Array.isArray(obj.messages) ? (obj.messages as FeedbackMessage[]) : [];
  if (obj.thread && typeof obj.thread === 'object') {
    const thread = obj.thread as FeedbackThreadDetail['thread'];
    return {
      thread: {
        ...thread,
        unread_count: thread.unread_count ?? (typeof obj.unread_count === 'number' ? obj.unread_count : 0),
      },
      unread_count: typeof obj.unread_count === 'number' ? obj.unread_count : thread.unread_count,
      messages,
    };
  }
  if (obj.thread_id != null || fallbackId) {
    return {
      thread: {
        id: Number(obj.thread_id ?? fallbackId),
        user_id: Number(obj.user_id) || 0,
        username: (obj.username as string | null) ?? null,
        nickname: (obj.nickname as string | null) ?? null,
        user_name: (obj.user_name as string | null) ?? null,
        language: (obj.language as string | null) ?? null,
        status: String(obj.status || 'open'),
        unread_count: typeof obj.unread_count === 'number' ? obj.unread_count : 0,
      },
      unread_count: typeof obj.unread_count === 'number' ? obj.unread_count : 0,
      messages,
    };
  }
  return null;
}

function senderLabel(sender: string, t: (key: string) => string) {
  if (sender === 'user') return t('feedback.senderUser');
  if (sender === 'admin') return t('feedback.senderAdmin');
  return t('feedback.senderSystem');
}

function displayName(thread: FeedbackThreadDetail['thread']) {
  return thread.nickname || thread.user_name || thread.username || '-';
}

export default function FeedbackForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [threadDetail, setThreadDetail] = useState<FeedbackThreadDetail | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [replying, setReplying] = useState(false);
  const locale = getAppLanguage();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const maxIdRef = useRef(0);
  const listRef = useRef<FeedbackMessage[]>([]);
  const pageTranslateRef = useRef(false);
  const translatingIdsRef = useRef<Set<number>>(new Set());
  const [pageTranslate, setPageTranslate] = useState(false);
  const [translatingPage, setTranslatingPage] = useState(false);
  const [translatingIds, setTranslatingIds] = useState<Set<number>>(new Set());
  const [translatedIds, setTranslatedIds] = useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const applyMessages = useCallback((next: FeedbackMessage[], replace: boolean) => {
    const merged = keepTranslations(next, listRef.current);
    if (replace) {
      listRef.current = merged;
    } else if (merged.length) {
      const seen = new Set(listRef.current.map((m) => m.id));
      const appended = merged.filter((m) => !seen.has(m.id));
      if (!appended.length) return false;
      listRef.current = [...listRef.current, ...appended];
    } else {
      return false;
    }
    maxIdRef.current = listRef.current.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
    setThreadDetail((prev) => (prev ? { ...prev, messages: listRef.current } : prev));
    return true;
  }, []);

  const patchMessages = useCallback((updater: (prev: FeedbackMessage[]) => FeedbackMessage[]) => {
    listRef.current = updater(listRef.current);
    setThreadDetail((prev) => (prev ? { ...prev, messages: listRef.current } : prev));
  }, []);

  const translateMessages = useCallback(
    async (targets: FeedbackMessage[]) => {
      const pending = targets.filter(
        (m) => canTranslateFeedback(m) && m.translated_content == null && !translatingIdsRef.current.has(m.id),
      );
      if (!pending.length) return 0;
      for (const m of pending) translatingIdsRef.current.add(m.id);
      setTranslatingIds(new Set(translatingIdsRef.current));
      let failed = 0;
      try {
        const results = await Promise.allSettled(
          pending.map(async (m) => {
            const content = m.content.trim();
            const data = await translateImText(content, FEEDBACK_TRANSLATE_LANG);
            return { id: m.id, content, data };
          }),
        );
        const translated = new Map<number, string>();
        const okIds: number[] = [];
        const badIds: number[] = [];
        results.forEach((result, index) => {
          const id = pending[index].id;
          if (result.status !== 'fulfilled' || !result.value.data) {
            failed += 1;
            badIds.push(id);
            return;
          }
          const { content, data } = result.value;
          if (data.translated != null) {
            translated.set(id, data.translated);
            okIds.push(id);
          } else if (data.skipped) {
            translated.set(id, content);
            okIds.push(id);
          } else {
            failed += 1;
            badIds.push(id);
          }
        });
        if (translated.size) {
          patchMessages((prev) =>
            prev.map((m) => (translated.has(m.id) ? { ...m, translated_content: translated.get(m.id) ?? m.content } : m)),
          );
        }
        setFailedIds((prev) => {
          const next = new Set(prev);
          okIds.forEach((mid) => next.delete(mid));
          badIds.forEach((mid) => next.add(mid));
          return next;
        });
      } finally {
        for (const m of pending) translatingIdsRef.current.delete(m.id);
        setTranslatingIds(new Set(translatingIdsRef.current));
      }
      return failed;
    },
    [patchMessages],
  );

  const loadData = useCallback(
    async (opts?: { sinceId?: number; markRead?: boolean; silent?: boolean }) => {
      if (!id) return;
      const sinceId = opts?.sinceId;
      const markRead = opts?.markRead !== false && sinceId == null;
      if (!opts?.silent) setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (sinceId != null && sinceId > 0) qs.set('since_id', String(sinceId));
        if (!markRead) qs.set('mark_read', 'false');
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        const res = await adminFetchJson(`/api/admin/feedback/${id}/messages${suffix}`);
        const detail = normalizeDetail(res, id);
        if (!detail) return;
        if (sinceId != null && sinceId > 0) {
          const changed = applyMessages(detail.messages, false);
          if (changed) {
            setThreadDetail((prev) =>
              prev
                ? {
                    ...prev,
                    thread: { ...prev.thread, ...detail.thread, unread_count: detail.thread.unread_count },
                    unread_count: detail.unread_count,
                    messages: listRef.current,
                  }
                : { ...detail, messages: listRef.current },
            );
            requestAnimationFrame(scrollToBottom);
            if (pageTranslateRef.current) {
              const missing = listRef.current.filter((m) => canTranslateFeedback(m) && m.translated_content == null);
              if (missing.length) {
                void translateMessages(missing).then((failed) => {
                  if (failed > 0) showError(t('im.translateFailed') as string);
                });
              }
            }
          }
        } else {
          applyMessages(detail.messages, true);
          setThreadDetail(detail);
          requestAnimationFrame(scrollToBottom);
        }
      } catch {
        if (!opts?.silent) showError(t('toast.loadFailed') as string);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [applyMessages, id, scrollToBottom, t, translateMessages],
  );

  const handleTranslateOne = useCallback(
    async (msg: FeedbackMessage) => {
      if (msg.translated_content != null) {
        setTranslatedIds((prev) => new Set(prev).add(msg.id));
        setFailedIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
        return;
      }
      const failed = await translateMessages([msg]);
      if (failed > 0) {
        showError(t('im.translateFailed') as string);
        return;
      }
      setTranslatedIds((prev) => new Set(prev).add(msg.id));
    },
    [t, translateMessages],
  );

  const handlePageTranslate = useCallback(
    async (checked: boolean) => {
      pageTranslateRef.current = checked;
      setPageTranslate(checked);
      if (!checked) return;
      setTranslatingPage(true);
      try {
        const failed = await translateMessages(listRef.current);
        if (failed > 0) showError(t('im.translateFailed') as string);
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
      } finally {
        setTranslatingPage(false);
      }
    },
    [t, translateMessages],
  );

  useEffect(() => {
    if (!id) {
      navigate('/feedback', { replace: true });
      return;
    }
    listRef.current = [];
    maxIdRef.current = 0;
    pageTranslateRef.current = false;
    translatingIdsRef.current = new Set();
    setPageTranslate(false);
    setTranslatingPage(false);
    setTranslatingIds(new Set());
    setTranslatedIds(new Set());
    setFailedIds(new Set());
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, loadData, navigate]);

  useEffect(() => {
    if (!id || !threadDetail) return;
    const timer = window.setInterval(() => {
      void loadData({ sinceId: maxIdRef.current, markRead: false, silent: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [id, loadData, threadDetail]);

  async function handleReply() {
    if (!replyContent.trim()) {
      showWarning(t('toast.enterContent'));
      return;
    }
    if (!threadDetail) return;
    setReplying(true);
    try {
      const res = await adminFetch(`/api/admin/feedback/${threadDetail.thread.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyContent.trim() }),
      });
      if (res && res.ok) {
        showSuccess(t('toast.sent') as string);
        setReplyContent('');
        await loadData({ sinceId: maxIdRef.current, markRead: false, silent: true });
      } else {
        showError(t('toast.sendFailed') as string);
      }
    } catch {
      showError(t('toast.sendFailed') as string);
    } finally {
      setReplying(false);
    }
  }

  if (!id) return null;

  if (!threadDetail && !loading) {
    return (
      <div>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/feedback')}>
          {t('btn.back')}
        </Button>
        <p style={{ marginTop: 24 }}>{t('empty.data')}</p>
      </div>
    );
  }

  const statusText =
    threadDetail?.thread.status === 'replied'
      ? t('status.replied')
      : threadDetail?.thread.status === 'closed'
        ? t('status.closed')
        : t('status.open');

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/feedback')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>
          {t('modal.feedbackDetail')} #{id}
        </h2>
      </div>

      <Card loading={loading && !threadDetail}>
        {threadDetail ? (
          <>
            <div
              style={{
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 13, color: '#666', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <span>
                  {t('table.user')}: {displayName(threadDetail.thread)} (ID: {threadDetail.thread.user_id})
                </span>
                {threadDetail.thread.language ? (
                  <span>
                    {t('table.language')}: {threadDetail.thread.language}
                  </span>
                ) : null}
                <span>
                  {t('table.status')}: {statusText}
                </span>
                {(Number(threadDetail.unread_count ?? threadDetail.thread.unread_count) || 0) > 0 ? (
                  <Badge
                    count={threadDetail.unread_count ?? threadDetail.thread.unread_count}
                    overflowCount={99}
                    title={t('feedback.unread') as string}
                  />
                ) : null}
              </div>
              {threadDetail.messages.length > 0 ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <TranslationOutlined style={{ color: pageTranslate ? '#1677ff' : '#8c8c8c' }} />
                  {t('im.translatePage')}
                  <Switch
                    size="small"
                    checked={pageTranslate}
                    loading={translatingPage}
                    onChange={(checked) => void handlePageTranslate(checked)}
                  />
                </span>
              ) : null}
            </div>
            <div
              style={{
                maxHeight: 420,
                overflowY: 'auto',
                marginBottom: 16,
                border: '1px solid #eee',
                borderRadius: 8,
                padding: 12,
                background: '#fafafa',
              }}
            >
              {threadDetail.messages.length === 0 && (
                <p style={{ textAlign: 'center', color: '#999' }}>{t('empty.messages')}</p>
              )}
              {threadDetail.messages.map((m) => {
                const showTranslated = pageTranslate || translatedIds.has(m.id);
                const displayText = showTranslated ? m.translated_content || m.content : m.content;
                const hasTranslation = Boolean(
                  showTranslated && m.translated_content && m.translated_content !== m.content,
                );
                const translating = translatingIds.has(m.id);
                const failed = failedIds.has(m.id);
                const showingResult = showTranslated && m.translated_content != null && !failed;
                const showTranslate = canTranslateFeedback(m) && !showingResult;
                return (
                  <div
                    key={m.id}
                    style={{
                      marginBottom: 10,
                      textAlign: m.sender === 'admin' ? 'right' : 'left',
                    }}
                  >
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>
                      {senderLabel(m.sender, t)} · {formatDate(m.created_at, locale)}
                    </div>
                    <div
                      style={{
                        display: 'inline-block',
                        padding: '8px 12px',
                        borderRadius: 12,
                        background:
                          m.sender === 'user' ? '#e94560' : m.sender === 'admin' ? '#4a69bd' : '#555',
                        color: '#fff',
                        maxWidth: '80%',
                        wordBreak: 'break-word',
                        textAlign: 'left',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {displayText}
                      {hasTranslation ? (
                        <div
                          style={{
                            fontSize: 12,
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: '1px dashed rgba(255,255,255,0.45)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {t('im.original')} · {m.content}
                        </div>
                      ) : null}
                    </div>
                    {showTranslate ? (
                      <div>
                        <Button
                          type="link"
                          size="small"
                          icon={<TranslationOutlined />}
                          loading={translating}
                          style={{ padding: 0, height: 'auto', marginTop: 4 }}
                          onClick={() => void handleTranslateOne(m)}
                        >
                          {translating
                            ? t('im.translating')
                            : failed
                              ? t('im.translateRetry')
                              : t('im.translate')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div
              style={{
                border: '1px solid #e8e8e8',
                borderRadius: 10,
                background: '#fff',
                padding: 12,
              }}
            >
              <Input.TextArea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={t('modal.replyPlaceholder') as string}
                autoSize={{ minRows: 3, maxRows: 8 }}
                variant="borderless"
                style={{ padding: 0, resize: 'none', marginBottom: 10 }}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void handleReply();
                  }
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={replying}
                  disabled={!replyContent.trim()}
                  onClick={() => void handleReply()}
                >
                  {t('modal.sendReply')}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
