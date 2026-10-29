import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Badge, Button, Descriptions, Input, Modal, Popconfirm, Space, Tabs, Tag, Typography } from 'antd';
import { CheckOutlined, EyeOutlined, StopOutlined, WarningOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, formatDate, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ChatSessionMessagesResponse, CompanionReportItem } from '../../types';
import { getAppLanguage } from '../../locales';
import { useTablePagination } from '../../hooks/useKeepAliveList';
import { fetchImMessages } from '../ChatSessions/imApi';
import { ImMessageContent } from '../ChatSessions/ImChatImage';
import { ImUnpaidMark } from '../ChatSessions/ImUnpaidMark';

const { Text } = Typography;
const { TextArea } = Input;

export type ReportKind = 'companion' | 'user' | 'post';

/** 三类举报列表共用字段 + 各类型目标字段 */
export type AuditReportItem = CompanionReportItem & {
  reported_user_id?: number | null;
  reported_nickname?: string | null;
  reported_username?: string | null;
  post_id?: number | null;
  post_title?: string | null;
  post_content?: string | null;
};

function unwrapList(res: unknown): { list: AuditReportItem[]; total: number } {
  if (!res || typeof res !== 'object') return { list: [], total: 0 };
  const root = res as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;
  const listRaw = [nested.results, nested.items, nested.reports, root.results, root.items].find(Array.isArray) ?? [];
  const pagination = (nested.pagination || root.pagination) as { total?: number } | undefined;
  const total =
    (typeof nested.total === 'number' ? nested.total : undefined) ??
    (typeof root.total === 'number' ? root.total : undefined) ??
    pagination?.total ??
    listRaw.length;
  return { list: listRaw as AuditReportItem[], total };
}

function unwrapReport(res: unknown): AuditReportItem | null {
  if (!res || typeof res !== 'object') return null;
  const root = res as Record<string, unknown>;
  const candidates = [root.data, root.results, root];
  for (const item of candidates) {
    if (item && typeof item === 'object' && !Array.isArray(item) && 'id' in item) {
      return item as AuditReportItem;
    }
  }
  return null;
}

const KIND_CONFIG: Record<
  ReportKind,
  {
    basePath: string;
    approveConfirmKey: string;
    approveSuccessKey: string;
    approveBtnKey: string;
  }
> = {
  companion: {
    basePath: '/api/admin/audit/companion-reports',
    approveConfirmKey: 'audit.hideAiConfirm',
    approveSuccessKey: 'audit.hideAiSuccess',
    approveBtnKey: 'audit.hideAi',
  },
  user: {
    basePath: '/api/admin/audit/user-reports',
    approveConfirmKey: 'audit.banUserConfirm',
    approveSuccessKey: 'audit.banUserSuccess',
    approveBtnKey: 'audit.banUser',
  },
  post: {
    basePath: '/api/admin/audit/post-reports',
    approveConfirmKey: 'audit.takeDownPostConfirm',
    approveSuccessKey: 'audit.takeDownPostSuccess',
    approveBtnKey: 'audit.takeDownPost',
  },
};

function chatUserId(record: AuditReportItem) {
  return record.chat_detail?.user_id ?? record.reporter_user_id;
}

function chatCompanionId(record: AuditReportItem) {
  return record.chat_detail?.companion_id || record.companion_id;
}

export default function ReportsAuditTab({ kind }: { kind: ReportKind }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cfg = KIND_CONFIG[kind];
  const actionRef = useRef<ActionType | null>(null);
  const locale = getAppLanguage();
  const pagination = useTablePagination(20);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [detailItem, setDetailItem] = useState<AuditReportItem | null>(null);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [reviewNote, setReviewNote] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [chatDetail, setChatDetail] = useState<ChatSessionMessagesResponse | null>(null);

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'processing', label: t('audit.reportStatusPending') },
    approved: { color: 'success', label: t('audit.reportStatusApproved') },
    rejected: { color: 'default', label: t('audit.reportStatusRejected') },
  };

  function reasonLabel(record: AuditReportItem) {
    const reasonKeyMap: Record<string, string> = {
      minor_safety: 'audit.reasonMinorSafety',
      sensitive: 'audit.reasonSensitive',
      disturbing: 'audit.reasonDisturbing',
      copyright: 'audit.reasonCopyright',
      other: 'audit.reasonOther',
    };
    const key = reasonKeyMap[record.reason_code];
    if (key) return t(key) as string;
    return (locale === 'en' ? record.reason_label_en : record.reason_label_zh) || record.reason_code;
  }

  async function openReportDetail(record: AuditReportItem) {
    try {
      const res = await adminFetchJson(`${cfg.basePath}/${record.id}`);
      setDetailItem(unwrapReport(res) ?? record);
    } catch {
      setDetailItem(record);
    }
  }

  async function openChat(record: AuditReportItem) {
    const userId = chatUserId(record);
    const companionId = chatCompanionId(record);
    if (userId == null || !companionId) {
      showError(t('toast.loadFailed') as string);
      return;
    }
    setDetailOpen(true);
    setDetailLoading(true);
    setChatDetail(null);
    try {
      const res = await fetchImMessages(userId, companionId);
      if (res == null) {
        showError(t('toast.authRequired') as string);
        setDetailOpen(false);
        return;
      }
      setChatDetail({
        ...res,
        nickname: res.nickname || record.reporter_nickname || undefined,
        companion_name: res.companion_name || record.companion_name || undefined,
        user_id: res.user_id ?? userId,
        companion_id: res.companion_id || companionId,
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleApprove(id: number) {
    try {
      const res = await adminFetch(`${cfg.basePath}/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_note: '' }),
      });
      if (res && res.ok) {
        showSuccess(t(cfg.approveSuccessKey) as string);
        setDetailItem((prev) => (prev?.id === id ? null : prev));
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  async function handleReject() {
    if (!rejectModal.id) return;
    try {
      const res = await adminFetch(`${cfg.basePath}/${rejectModal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_note: reviewNote }),
      });
      if (res && res.ok) {
        showSuccess(t('audit.rejectReportSuccess') as string);
        setDetailItem((prev) => (prev?.id === rejectModal.id ? null : prev));
        setRejectModal({ open: false, id: null });
        setReviewNote('');
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  const targetColumns: ProColumns<AuditReportItem>[] =
    kind === 'companion'
      ? [
          {
            title: t('audit.reportedCompanionId'),
            dataIndex: 'companion_id',
            key: 'companion_id',
            width: 160,
            ellipsis: true,
            search: false,
            render: (_, record) =>
              record.companion_id ? (
                <Button
                  type="link"
                  style={{ padding: 0 }}
                  onClick={() => navigate(`/companions/${record.companion_id}/edit`)}
                >
                  {record.companion_id}
                </Button>
              ) : (
                '-'
              ),
          },
          {
            title: t('audit.reportedCompanionName'),
            dataIndex: 'companion_name',
            key: 'companion_name',
            width: 140,
            ellipsis: true,
            search: false,
            render: (_, record) => record.companion_name || '-',
          },
          {
            title: t('audit.chatDetail'),
            key: 'chat_detail',
            width: 100,
            search: false,
            render: (_, record) => (
              <Button type="link" icon={<EyeOutlined />} onClick={() => void openChat(record)}>
                {t('btn.view')}
              </Button>
            ),
          },
        ]
      : kind === 'user'
        ? [
            {
              title: t('audit.reportedUserId'),
              dataIndex: 'reported_user_id',
              key: 'reported_user_id',
              width: 120,
              search: false,
              render: (_, record) => record.reported_user_id ?? '-',
            },
            {
              title: t('audit.reportedUserNickname'),
              key: 'reported_nickname',
              width: 160,
              ellipsis: true,
              search: false,
              render: (_, record) =>
                record.reported_nickname || record.reported_username || '-',
            },
          ]
        : [
            {
              title: t('audit.reportedPostId'),
              dataIndex: 'post_id',
              key: 'post_id',
              width: 100,
              search: false,
              render: (_, record) =>
                record.post_id != null ? (
                  <Button
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() => navigate(`/posts/${record.post_id}/edit`)}
                  >
                    {record.post_id}
                  </Button>
                ) : (
                  '-'
                ),
            },
            {
              title: t('audit.reportedPostTitle'),
              dataIndex: 'post_title',
              key: 'post_title',
              width: 180,
              ellipsis: true,
              search: false,
              render: (_, record) => record.post_title || '-',
            },
          ];

  const columns: ProColumns<AuditReportItem>[] = [
    {
      title: t('audit.reporterId'),
      dataIndex: 'reporter_user_id',
      key: 'reporter_user_id',
      width: 110,
      search: false,
    },
    {
      title: t('audit.reporterNickname'),
      dataIndex: 'reporter_nickname',
      key: 'reporter_nickname',
      width: 140,
      ellipsis: true,
      search: false,
      render: (_, record) => record.reporter_nickname || '-',
    },
    ...targetColumns,
    {
      title: t('audit.reportType'),
      dataIndex: 'reason_code',
      key: 'reason_code',
      width: 150,
      search: false,
      render: (_, record) => <Tag>{reasonLabel(record)}</Tag>,
    },
    {
      title: t('audit.reportContent'),
      dataIndex: 'content',
      key: 'content',
      width: 220,
      ellipsis: true,
      search: false,
      render: (_, record) => record.content?.trim() || record.remark?.trim() || '-',
    },
    {
      title: t('audit.reportStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 130,
      search: false,
      render: (_, record) => {
        const s = statusMap[record.status] || statusMap.pending;
        return <Badge status={s.color as 'processing' | 'success' | 'default'} text={s.label} />;
      },
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 280,
      fixed: 'right',
      search: false,
      render: (_, record) => (
        <Space size={0} wrap={false}>
          <Button type="link" icon={<EyeOutlined />} onClick={() => void openReportDetail(record)}>
            {t('btn.view')}
          </Button>
          {record.status === 'pending' && (
            <>
              <Popconfirm
                title={t(cfg.approveConfirmKey)}
                onConfirm={() => handleApprove(record.id)}
                okText={t('btn.confirm')}
                cancelText={t('btn.cancel')}
                okButtonProps={{ danger: true }}
              >
                <Button type="link" danger icon={<StopOutlined />}>
                  {t(cfg.approveBtnKey)}
                </Button>
              </Popconfirm>
              <Button
                type="link"
                icon={<WarningOutlined />}
                onClick={() => {
                  setReviewNote('');
                  setRejectModal({ open: true, id: record.id });
                }}
              >
                {t('audit.rejectReport')}
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<AuditReportItem>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        search={false}
        options={false}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        params={{ status: statusFilter, kind }}
        scroll={{ x: kind === 'companion' ? 1640 : 1400 }}
        request={async (params) => {
          const page = Math.max(1, Number(params.current) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
          const status = String(params.status || statusFilter || 'pending');
          const qs = new URLSearchParams({
            status,
            page: String(page),
            page_size: String(pageSize),
          });
          try {
            const res = await adminFetchJson(`${cfg.basePath}?${qs.toString()}`);
            const { list, total } = unwrapList(res);
            return { data: list, success: true, total };
          } catch (e) {
            showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
            return { data: [], success: false, total: 0 };
          }
        }}
        toolBarRender={() => [
          <Tabs
            key="status-tabs"
            activeKey={statusFilter}
            onChange={(key) => {
              setStatusFilter(key);
              setTimeout(() => actionRef.current?.reload(), 0);
            }}
            items={[
              { key: 'pending', label: t('audit.reportStatusPending') },
              { key: 'approved', label: t('audit.reportStatusApproved') },
              { key: 'rejected', label: t('audit.reportStatusRejected') },
              { key: 'all', label: t('audit.statusAll') },
            ]}
          />,
        ]}
      />

      <Modal
        title={t('audit.reportDetail')}
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={
          detailItem ? (
            <Space>
              {detailItem.status === 'pending' ? (
                <>
                  <Popconfirm
                    title={t(cfg.approveConfirmKey)}
                    onConfirm={() => handleApprove(detailItem.id)}
                    okText={t('btn.confirm')}
                    cancelText={t('btn.cancel')}
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="primary" icon={<CheckOutlined />}>
                      {t('btn.approve')}
                    </Button>
                  </Popconfirm>
                  <Button
                    danger
                    icon={<WarningOutlined />}
                    onClick={() => {
                      setReviewNote('');
                      setRejectModal({ open: true, id: detailItem.id });
                    }}
                  >
                    {t('audit.rejectReport')}
                  </Button>
                </>
              ) : null}
              <Button onClick={() => setDetailItem(null)}>{t('btn.close')}</Button>
            </Space>
          ) : null
        }
        width={640}
      >
        {detailItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('table.id')}>{detailItem.id}</Descriptions.Item>
            <Descriptions.Item label={t('audit.reporterId')}>{detailItem.reporter_user_id}</Descriptions.Item>
            <Descriptions.Item label={t('audit.reporterNickname')}>
              {detailItem.reporter_nickname || '-'}
            </Descriptions.Item>
            {kind === 'companion' ? (
              <>
                <Descriptions.Item label={t('audit.reportedCompanionId')}>
                  <Button
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() => navigate(`/companions/${detailItem.companion_id}/edit`)}
                  >
                    {detailItem.companion_id}
                  </Button>
                </Descriptions.Item>
                <Descriptions.Item label={t('audit.reportedCompanionName')}>
                  {detailItem.companion_name || '-'}
                </Descriptions.Item>
              </>
            ) : null}
            {kind === 'user' ? (
              <>
                <Descriptions.Item label={t('audit.reportedUserId')}>
                  {detailItem.reported_user_id ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('audit.reportedUserNickname')}>
                  {detailItem.reported_nickname || detailItem.reported_username || '-'}
                </Descriptions.Item>
              </>
            ) : null}
            {kind === 'post' ? (
              <>
                <Descriptions.Item label={t('audit.reportedPostId')}>
                  {detailItem.post_id != null ? (
                    <Button
                      type="link"
                      style={{ padding: 0 }}
                      onClick={() => navigate(`/posts/${detailItem.post_id}/edit`)}
                    >
                      {detailItem.post_id}
                    </Button>
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={t('audit.reportedPostTitle')}>
                  {detailItem.post_title || '-'}
                </Descriptions.Item>
                {detailItem.post_content ? (
                  <Descriptions.Item label={t('audit.content')}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{detailItem.post_content}</div>
                  </Descriptions.Item>
                ) : null}
              </>
            ) : null}
            <Descriptions.Item label={t('audit.reportType')}>
              <Tag>{reasonLabel(detailItem)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.reportContent')}>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {detailItem.content?.trim() || '-'}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.reportStatus')}>
              <Badge
                status={(statusMap[detailItem.status] || statusMap.pending).color as 'processing' | 'success' | 'default'}
                text={(statusMap[detailItem.status] || statusMap.pending).label}
              />
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.reportRemark')}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{detailItem.remark || '-'}</div>
            </Descriptions.Item>
            {detailItem.source ? (
              <Descriptions.Item label={t('audit.reportSource')}>{detailItem.source}</Descriptions.Item>
            ) : null}
            {detailItem.review_note ? (
              <Descriptions.Item label={t('audit.rejectReportNote')}>{detailItem.review_note}</Descriptions.Item>
            ) : null}
            {detailItem.created_at ? (
              <Descriptions.Item label={t('table.createdAt')}>
                <FormatDate value={detailItem.created_at} locale={locale} />
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        )}
      </Modal>

      {kind === 'companion' ? (
        <Modal
          title={
            chatDetail
              ? `${t('modal.chatSessionDetail')} — ${chatDetail.nickname || chatDetail.username || chatDetail.user_id} × ${chatDetail.companion_name || chatDetail.companion_id}`
              : t('modal.chatSessionDetail')
          }
          open={detailOpen}
          onCancel={() => setDetailOpen(false)}
          footer={null}
          width={720}
          destroyOnHidden
        >
          {detailLoading && <Text type="secondary">{t('loading')}</Text>}
          {!detailLoading && chatDetail && (
            <div>
              <Space wrap style={{ marginBottom: 12 }}>
                <Text type="secondary">
                  {t('table.userId')}: {chatDetail.user_id}
                </Text>
                <Text type="secondary">
                  {t('table.companionId')}: {chatDetail.companion_id}
                </Text>
                <Text type="secondary">
                  {t('table.messageCount')}: {chatDetail.messages?.length ?? 0}
                  {chatDetail.total > (chatDetail.messages?.length ?? 0) ? ` / ${chatDetail.total}` : ''}
                </Text>
              </Space>
              <div
                style={{
                  maxHeight: '60vh',
                  overflowY: 'auto',
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: 12,
                  background: '#fafafa',
                }}
              >
                {!chatDetail.messages?.length ? (
                  <Text type="secondary">{t('empty.messages')}</Text>
                ) : (
                  chatDetail.messages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: m.role === 'user' ? '#e6f7ff' : m.role === 'operator' ? '#fff7e6' : '#fff',
                          border: '1px solid #e8e8e8',
                        }}
                      >
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                          {m.role === 'user'
                            ? t('chat.roleUser')
                            : m.role === 'operator'
                              ? t('chat.roleOperator')
                              : t('chat.roleAssistant')}
                          {m.created_at ? ` · ${formatDate(m.created_at, locale)}` : ''}
                        </div>
                        <ImMessageContent msg={m} />
                      </div>
                      <ImUnpaidMark msg={m} />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Modal>
      ) : null}

      <Modal
        title={t('audit.rejectReportTitle')}
        open={rejectModal.open}
        onOk={() => void handleReject()}
        onCancel={() => {
          setRejectModal({ open: false, id: null });
          setReviewNote('');
        }}
        okText={t('btn.confirm')}
        cancelText={t('btn.cancel')}
      >
        <p>{t('audit.rejectReportNote')}</p>
        <TextArea
          rows={3}
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          maxLength={500}
          showCount
          style={{ marginBottom: 24 }}
        />
      </Modal>
    </>
  );
}
