import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ProTable, { type ActionType } from '@ant-design/pro-table';
import {
  Badge,
  Button,
  Descriptions,
  Image,
  Modal,
  Popconfirm,
  Space,
  Tabs,
  Typography,
} from 'antd';
import { CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import { getAppLanguage } from '../../locales';
import { parsePaged } from '../Companions/contentApi';
import { useTablePagination } from '../../hooks/useKeepAliveList';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { AuditRejectModal } from './AuditRejectModal';

const { Text } = Typography;

export interface CompanionProfileReviewItem {
  id: number;
  companion_id: string;
  companion_name?: string | null;
  companion_avatar_url?: string | null;
  submitter_user_id?: number | null;
  submitter_nickname?: string | null;
  pending_backgrounds?: string[] | null;
  current_backgrounds?: string[] | null;
  status: string;
  reject_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
}

function bgList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((u) => String(u || '').trim()).filter(Boolean);
}

export default function CompanionProfileReviewTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actionRef = useRef<ActionType | null>(null);
  const locale = getAppLanguage();
  const pagination = useTablePagination(20);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [detailItem, setDetailItem] = useState<CompanionProfileReviewItem | null>(null);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({
    open: false,
    id: null,
  });

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'processing', label: t('audit.statusPending') },
    approved: { color: 'success', label: t('audit.statusApproved') },
    rejected: { color: 'error', label: t('audit.statusRejected') },
  };

  async function handleApprove(id: number) {
    try {
      const res = await adminFetch(`/api/admin/audit/companions/${id}/approve`, { method: 'POST' });
      if (res && res.ok) {
        showSuccess(t('audit.approveSuccess') as string);
        setDetailItem((prev) => (prev?.id === id ? null : prev));
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  async function handleReject(payload: { reason_id: number; remark: string }) {
    if (!rejectModal.id) return;
    try {
      const res = await adminFetch(`/api/admin/audit/companions/${rejectModal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res && res.ok) {
        showSuccess(t('audit.rejectSuccess') as string);
        setDetailItem((prev) => (prev?.id === rejectModal.id ? null : prev));
        setRejectModal({ open: false, id: null });
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  const columns = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 70, hideInSearch: true },
    {
      title: t('moment.companionColumn'),
      key: 'companion',
      width: 200,
      hideInSearch: true,
      render: (_: unknown, record: CompanionProfileReviewItem) => (
        <Space>
          {record.companion_avatar_url ? (
            <Image
              src={resolveAdminMediaUrl(record.companion_avatar_url)}
              width={28}
              height={28}
              style={{ borderRadius: '50%', objectFit: 'cover' }}
              preview={false}
            />
          ) : null}
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => navigate(`/companions/${record.companion_id}/edit`)}
          >
            {record.companion_name || record.companion_id}
          </Button>
        </Space>
      ),
    },
    {
      title: t('audit.submitter'),
      key: 'submitter',
      width: 150,
      hideInSearch: true,
      render: (_: unknown, record: CompanionProfileReviewItem) =>
        record.submitter_nickname
          ? `${record.submitter_nickname}${record.submitter_user_id != null ? ` (#${record.submitter_user_id})` : ''}`
          : record.submitter_user_id != null
            ? `#${record.submitter_user_id}`
            : '—',
    },
    {
      title: t('audit.pendingBackgrounds'),
      key: 'pending_backgrounds',
      width: 220,
      hideInSearch: true,
      render: (_: unknown, record: CompanionProfileReviewItem) => {
        const urls = bgList(record.pending_backgrounds);
        if (!urls.length) return '—';
        return (
          <Image.PreviewGroup>
            <Space size={4} wrap>
              {urls.map((url) => (
                <Image
                  key={url}
                  src={resolveAdminMediaUrl(url)}
                  width={48}
                  height={36}
                  style={{ objectFit: 'cover', borderRadius: 4 }}
                />
              ))}
            </Space>
          </Image.PreviewGroup>
        );
      },
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      hideInSearch: true,
      render: (_: unknown, record: CompanionProfileReviewItem) => {
        const s = statusMap[record.status] || statusMap.pending;
        return <Badge status={s.color as 'processing' | 'success' | 'error'} text={s.label} />;
      },
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      hideInSearch: true,
      render: (_: unknown, record: CompanionProfileReviewItem) => (
        <FormatDate value={record.created_at} locale={locale} />
      ),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 220,
      fixed: 'right' as const,
      hideInSearch: true,
      render: (_: unknown, record: CompanionProfileReviewItem) => (
        <Space size={0} wrap={false} style={{ whiteSpace: 'nowrap' }}>
          <Button type="link" icon={<EyeOutlined />} onClick={() => setDetailItem(record)}>
            {t('btn.view')}
          </Button>
          {record.status === 'pending' ? (
            <>
              <Popconfirm
                title={t('audit.approveBackgroundConfirm')}
                onConfirm={() => void handleApprove(record.id)}
                okText={t('btn.confirm')}
                cancelText={t('btn.cancel')}
              >
                <Button type="link" icon={<CheckOutlined />}>
                  {t('btn.approve')}
                </Button>
              </Popconfirm>
              <Button
                type="link"
                danger
                icon={<CloseOutlined />}
                onClick={() => setRejectModal({ open: true, id: record.id })}
              >
                {t('btn.reject')}
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<CompanionProfileReviewItem>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        search={false}
        options={false}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        params={{ status: statusFilter }}
        scroll={{ x: 1200 }}
        request={async (params) => {
          const page = Math.max(1, Number(params.current) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
          const status = String(params.status || statusFilter || 'pending');
          const qs = new URLSearchParams({
            status,
            limit: String(pageSize),
            offset: String((page - 1) * pageSize),
          });
          try {
            const res = await adminFetchJson(`/api/admin/audit/companions?${qs.toString()}`);
            const { list, total } = parsePaged<CompanionProfileReviewItem>(res);
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
              { key: 'pending', label: t('audit.statusPending') },
              { key: 'approved', label: t('audit.statusApproved') },
              { key: 'rejected', label: t('audit.statusRejected') },
              { key: 'all', label: t('audit.statusAll') },
            ]}
          />,
        ]}
      />

      <Modal
        title={t('audit.companionProfileDetail')}
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={
          detailItem ? (
            <Space>
              {detailItem.status === 'pending' ? (
                <>
                  <Popconfirm
                    title={t('audit.approveBackgroundConfirm')}
                    onConfirm={() => void handleApprove(detailItem.id)}
                    okText={t('btn.confirm')}
                    cancelText={t('btn.cancel')}
                  >
                    <Button type="primary" icon={<CheckOutlined />}>
                      {t('btn.approve')}
                    </Button>
                  </Popconfirm>
                  <Button
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => setRejectModal({ open: true, id: detailItem.id })}
                  >
                    {t('btn.reject')}
                  </Button>
                </>
              ) : null}
              <Button onClick={() => setDetailItem(null)}>{t('btn.close')}</Button>
            </Space>
          ) : null
        }
        width={640}
      >
        {detailItem ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('table.id')}>{detailItem.id}</Descriptions.Item>
            <Descriptions.Item label={t('moment.companionColumn')}>
              <Button
                type="link"
                style={{ padding: 0 }}
                onClick={() => navigate(`/companions/${detailItem.companion_id}/edit`)}
              >
                {detailItem.companion_name || detailItem.companion_id}
              </Button>
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.submitter')}>
              {detailItem.submitter_nickname || detailItem.submitter_user_id || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.pendingBackgrounds')}>
              {bgList(detailItem.pending_backgrounds).length ? (
                <Image.PreviewGroup>
                  <Space wrap>
                    {bgList(detailItem.pending_backgrounds).map((url) => (
                      <Image
                        key={url}
                        src={resolveAdminMediaUrl(url)}
                        width={96}
                        height={72}
                        style={{ objectFit: 'cover', borderRadius: 4 }}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.currentBackgrounds')}>
              {bgList(detailItem.current_backgrounds).length ? (
                <Image.PreviewGroup>
                  <Space wrap>
                    {bgList(detailItem.current_backgrounds).map((url) => (
                      <Image
                        key={url}
                        src={resolveAdminMediaUrl(url)}
                        width={96}
                        height={72}
                        style={{ objectFit: 'cover', borderRadius: 4 }}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              ) : (
                <Text type="secondary">—</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.status')}>
              <Badge
                status={(statusMap[detailItem.status] || statusMap.pending).color as 'processing'}
                text={(statusMap[detailItem.status] || statusMap.pending).label}
              />
            </Descriptions.Item>
            {detailItem.reject_reason ? (
              <Descriptions.Item label={t('audit.rejectReason')}>
                <Text type="danger">{detailItem.reject_reason}</Text>
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label={t('table.createdAt')}>
              <FormatDate value={detailItem.created_at} locale={locale} />
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>

      <AuditRejectModal
        open={rejectModal.open}
        onCancel={() => setRejectModal({ open: false, id: null })}
        onConfirm={handleReject}
      />
    </>
  );
}
