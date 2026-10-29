import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType } from '@ant-design/pro-table';
import {
  Button,
  Popconfirm,
  Badge,
  Space,
  Tabs,
  Tag,
  Modal,
  Image,
  Descriptions,
  Typography,
  Tooltip,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import { getAppLanguage } from '../../locales';
import CompanionProfileReviewTab from './CompanionProfileReviewTab';
import ReportsAuditTab from './ReportsAuditTab';
import { parsePaged } from '../Companions/contentApi';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { useTablePagination } from '../../hooks/useKeepAliveList';
import {
  isTranslatableText,
  TranslateButton,
  TranslatedValue,
  useAuditTranslate,
} from './auditTranslate';
import { AuditRejectModal } from './AuditRejectModal';

const { Text } = Typography;

/* ---------- 帖子审核 ---------- */

interface PostReviewItem {
  id: number;
  user_id: number;
  username: string;
  user_name: string;
  avatar: string;
  title: string;
  content: string;
  images: string[];
  category: string;
  status: string;
  reject_reason: string;
  reviewed_by: string;
  reviewed_at: string | null;
  created_at: string | null;
}

function PostReviewTab() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const locale = getAppLanguage();
  const pagination = useTablePagination(20);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [detailItem, setDetailItem] = useState<PostReviewItem | null>(null);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const { byKey, loading: translating, loadingKey, translateOne, translateMany, reset: resetTranslate } = useAuditTranslate();

  useEffect(() => {
    resetTranslate();
  }, [detailItem?.id, resetTranslate]);

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'processing', label: t('audit.statusPending') },
    approved: { color: 'success', label: t('audit.statusApproved') },
    rejected: { color: 'error', label: t('audit.statusRejected') },
  };

  const columns = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 60, hideInSearch: true },
    {
      title: t('table.user'),
      key: 'user',
      width: 130,
      hideInSearch: true,
      render: (_: unknown, record: PostReviewItem) => (
        <Space>
          {record.avatar ? (
            <Image src={record.avatar} width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} preview={false} fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xNkREaB4AAAANSURBVBhXY2BgYPgPAAEEAQBwIGULAAAAAElFTkSuQmCC" />
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0f0f0', display: 'inline-block' }} />
          )}
          <span>{record.user_name || record.username || '-'}</span>
        </Space>
      ),
    },
    {
      title: t('table.title'),
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      width: 180,
      hideInSearch: true,
      render: (_: unknown, record: PostReviewItem) => (
        <Tooltip title={record.title}>
          <Text style={{ maxWidth: 160 }} ellipsis>{record.title || '-'}</Text>
        </Tooltip>
      ),
    },
    {
      title: t('table.category'),
      dataIndex: 'category',
      key: 'category',
      width: 90,
      hideInSearch: true,
      render: (_: unknown, record: PostReviewItem) => record.category ? <Tag>{record.category}</Tag> : '-',
    },
    {
      title: t('audit.contentPreview'),
      key: 'content',
      width: 200,
      hideInSearch: true,
      render: (_: unknown, record: PostReviewItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {record.images && record.images.length > 0 && (
            <Image
              src={record.images[0]}
              width={36}
              height={36}
              style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
              preview={false}
              fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xNkREaB4AAAANSURBVBhXY2BgYPgPAAEEAQBwIGULAAAAAElFTkSuQmCC"
            />
          )}
          <Tooltip title={record.content}>
            <Text style={{ maxWidth: 150, fontSize: 13 }} ellipsis type="secondary">
              {record.content || '-'}
            </Text>
          </Tooltip>
        </div>
      ),
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      key: 'status',
      width: 90,
      valueType: 'select',
      fieldProps: {
        options: [
          { label: t('audit.statusPending'), value: 'pending' },
          { label: t('audit.statusApproved'), value: 'approved' },
          { label: t('audit.statusRejected'), value: 'rejected' },
        ],
      },
      render: (_: unknown, record: PostReviewItem) => {
        const s = statusMap[record.status] || statusMap.pending;
        return <Badge status={s.color as any} text={s.label} />;
      },
    },
    {
      title: t('audit.rejectReason'),
      dataIndex: 'reject_reason',
      key: 'reject_reason',
      width: 120,
      hideInSearch: true,
      ellipsis: true,
      render: (_: unknown, record: PostReviewItem) => record.reject_reason || '-',
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      hideInSearch: true,
      render: (_: unknown, record: PostReviewItem) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 220,
      fixed: 'right' as const,
      hideInSearch: true,
      render: (_: unknown, record: PostReviewItem) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailItem(record)}
          >
            {t('btn.viewDetail')}
          </Button>
          {record.status === 'pending' && (
            <>
              <Popconfirm
                title={t('audit.approveConfirm')}
                onConfirm={() => handleApprove(record.id)}
                okText={t('btn.confirm') || 'OK'}
                cancelText={t('btn.cancel')}
              >
                <Button type="link" size="small" icon={<CheckOutlined />} style={{ color: '#52c41a' }}>
                  {t('btn.approve')}
                </Button>
              </Popconfirm>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  setRejectModal({ open: true, id: record.id });
                }}
              >
                {t('btn.reject')}
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  async function fetchData(params?: { pageSize?: number; current?: number; status?: string }) {
    try {
      const st = params?.status || statusFilter;
      const page = Math.max(1, Number(params?.current) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params?.pageSize) || 20));
      const qs = new URLSearchParams({
        status: st,
        page: String(page),
        page_size: String(pageSize),
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      const res = await adminFetchJson(`/api/admin/audit/posts?${qs.toString()}`);
      const { list, total } = parsePaged<PostReviewItem>(res);
      return { data: list, success: true, total };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleApprove(id: number) {
    try {
      const res = await adminFetch(`/api/admin/audit/posts/${id}/approve`, { method: 'POST' });
      if (res && res.ok) {
        showSuccess(t('audit.approveSuccess') as string);
        setDetailItem((prev) => (prev?.id === id ? null : prev));
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  async function handleReject(payload: { reason_id: number; remark: string }) {
    if (!rejectModal.id) return;
    try {
      const res = await adminFetch(`/api/admin/audit/posts/${rejectModal.id}/reject`, {
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
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  return (
    <>
      <ProTable
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={fetchData}
        search={false}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        params={{ status: statusFilter }}
        scroll={{ x: 1260 }}
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

      {/* 帖子详情弹窗 */}
      <Modal
        title={t('audit.postDetail')}
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={
          detailItem
            ? (
              <Space>
                <Button
                  icon={<TranslationOutlined />}
                  loading={translating}
                  disabled={
                    !isTranslatableText(detailItem.title) && !isTranslatableText(detailItem.content)
                  }
                  onClick={() =>
                    void translateMany([
                      { key: 'title', text: detailItem.title || '' },
                      { key: 'content', text: detailItem.content || '' },
                    ])
                  }
                >
                  {t('audit.translateAll')}
                </Button>
                {detailItem.status === 'pending' ? (
                  <>
                    <Popconfirm
                      title={t('audit.approveConfirm')}
                      onConfirm={() => handleApprove(detailItem.id)}
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
            )
            : null
        }
        width={640}
      >
        {detailItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('table.id')}>{detailItem.id}</Descriptions.Item>
            <Descriptions.Item label={t('table.user')}>
              {detailItem.user_name || detailItem.username} (#{detailItem.user_id})
            </Descriptions.Item>
            <Descriptions.Item label={t('table.title')}>
              <TranslatedValue original={detailItem.title || '-'} translated={byKey.title} />
              {isTranslatableText(detailItem.title) && byKey.title == null && (
                <TranslateButton
                  loading={loadingKey === 'title' || translating}
                  onClick={() => void translateOne('title', detailItem.title)}
                />
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.category')}>
              {detailItem.category ? <Tag>{detailItem.category}</Tag> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.content')}>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                <TranslatedValue original={detailItem.content || '-'} translated={byKey.content} multiline />
              </div>
              {isTranslatableText(detailItem.content) && byKey.content == null && (
                <TranslateButton
                  loading={loadingKey === 'content' || translating}
                  onClick={() => void translateOne('content', detailItem.content)}
                />
              )}
            </Descriptions.Item>
            {detailItem.images && detailItem.images.length > 0 && (
              <Descriptions.Item label={t('table.image')}>
                <Image.PreviewGroup>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: '100%' }}>
                    {detailItem.images.map((img, idx) => (
                      <Image key={idx} src={img} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ))}
                  </div>
                </Image.PreviewGroup>
              </Descriptions.Item>
            )}
            <Descriptions.Item label={t('table.status')}>
              <Badge
                status={(statusMap[detailItem.status] || statusMap.pending).color as any}
                text={(statusMap[detailItem.status] || statusMap.pending).label}
              />
            </Descriptions.Item>
            {detailItem.reject_reason && (
              <Descriptions.Item label={t('audit.rejectReason')}>
                <Text type="danger">{detailItem.reject_reason}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label={t('table.createdAt')}>
              <FormatDate value={detailItem.created_at} locale={locale} />
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <AuditRejectModal
        open={rejectModal.open}
        onCancel={() => setRejectModal({ open: false, id: null })}
        onConfirm={handleReject}
      />
    </>
  );
}

/* ---------- 资料审核 ---------- */

interface ProfileReviewItem {
  id: number;
  user_id: number;
  username: string;
  user_name: string;
  pending_data: Record<string, unknown>;
  current_data: Record<string, unknown>;
  status: string;
  reject_reason: string;
  reviewed_by: string;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const FIELD_LABELS: Record<string, Record<string, string>> = {
  zh: {
    nickname: '昵称',
    gender: '性别',
    sexual_orientation: '性取向',
    preferred_gender: '偏好性别',
    chat_purpose: '聊天目的',
    avatar_url: '头像',
    profile_backgrounds: '资料背景图',
    age: '年龄',
    region: '地区',
    occupation: '职业',
  },
  en: {
    nickname: 'Nickname',
    gender: 'Gender',
    sexual_orientation: 'Sexual Orientation',
    preferred_gender: 'Preferred Gender',
    chat_purpose: 'Chat Purpose',
    avatar_url: 'Avatar',
    profile_backgrounds: 'Profile background',
    age: 'Age',
    region: 'Region',
    occupation: 'Occupation',
  },
};

function asUrlList(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((u) => String(u || '').trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim() && /^(https?:\/\/|\/|blob:|data:)/i.test(val.trim())) {
    return [val.trim()];
  }
  return [];
}

function isImageField(key: string) {
  return key === 'avatar_url' || key === 'profile_backgrounds';
}

function sameProfileField(a: unknown, b: unknown) {
  if (Array.isArray(a) || Array.isArray(b) || (typeof a === 'string' && typeof b === 'string' && /^(https?:\/\/|\/)/i.test(a))) {
    const left = asUrlList(a);
    const right = asUrlList(b);
    if (left.length || right.length) return JSON.stringify(left) === JSON.stringify(right);
  }
  return a === b;
}

function ProfileReviewTab() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const locale = getAppLanguage();
  const pagination = useTablePagination(20);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [detailItem, setDetailItem] = useState<ProfileReviewItem | null>(null);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const { byKey, loading: translating, loadingKey, translateMany, reset: resetTranslate } = useAuditTranslate();

  useEffect(() => {
    resetTranslate();
  }, [detailItem?.id, resetTranslate]);

  const langKey = locale === 'en' ? 'en' : 'zh';
  const fieldLabels = FIELD_LABELS[langKey] || FIELD_LABELS.zh;

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'processing', label: t('audit.statusPending') },
    approved: { color: 'success', label: t('audit.statusApproved') },
    rejected: { color: 'error', label: t('audit.statusRejected') },
  };

  function profileTranslateFields(record: ProfileReviewItem): { key: string; text: string }[] {
    const fields: { key: string; text: string }[] = [];
    const collect = (source: 'pending' | 'current', data: Record<string, unknown>) => {
      Object.entries(data || {}).forEach(([key, val]) => {
        if (isImageField(key)) return;
        if (isTranslatableText(val)) fields.push({ key: `${source}.${key}`, text: val });
      });
    };
    collect('current', record.current_data || {});
    collect('pending', record.pending_data || {});
    return fields;
  }

  function renderFieldValue(key: string, val: unknown, translated?: string, tone?: 'old' | 'new') {
    if (key === 'avatar_url') {
      const url = typeof val === 'string' ? val.trim() : '';
      if (!url) return '-';
      return (
        <Image
          src={resolveAdminMediaUrl(url)}
          width={40}
          height={40}
          style={{ borderRadius: '50%', objectFit: 'cover' }}
        />
      );
    }
    if (key === 'profile_backgrounds') {
      const urls = asUrlList(val);
      if (!urls.length) return '-';
      return (
        <Image.PreviewGroup>
          <Space size={4} wrap>
            {urls.map((url) => (
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
      );
    }
    if (val === null || val === undefined) return '-';
    const original = String(val);
    const display = translated || original;
    const showOriginal = translated != null && translated !== original;
    return (
      <span>
        <Text delete={tone === 'old'} type={tone === 'old' ? 'secondary' : tone === 'new' ? 'warning' : undefined}>
          {display}
        </Text>
        {showOriginal ? (
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
            {t('im.original')} · {original}
          </div>
        ) : null}
      </span>
    );
  }

  function renderDiff(record: ProfileReviewItem) {
    const pending = record.pending_data || {};
    const current = record.current_data || {};
    const keys = Object.keys(pending);
    if (keys.length === 0) return <Text type="secondary">-</Text>;

    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {keys.map((key) => {
          const oldVal = current[key];
          const newVal = pending[key];
          const changed = !sameProfileField(oldVal, newVal);
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
              <Text strong style={{ minWidth: 80, paddingTop: 2 }}>{fieldLabels[key] || key}:</Text>
              <div style={{ flex: 1 }}>
                {changed ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <span>{renderFieldValue(key, oldVal, byKey[`current.${key}`], 'old')}</span>
                    <Text style={{ margin: '0 4px' }}>→</Text>
                    <span>{renderFieldValue(key, newVal, byKey[`pending.${key}`], 'new')}</span>
                  </div>
                ) : (
                  renderFieldValue(key, newVal, byKey[`pending.${key}`])
                )}
                {isTranslatableText(newVal) && byKey[`pending.${key}`] == null && (
                  <TranslateButton
                    loading={loadingKey === `pending.${key}` || translating}
                    onClick={() => {
                      const items: { key: string; text: string }[] = [{ key: `pending.${key}`, text: String(newVal) }];
                      if (changed && isTranslatableText(oldVal)) {
                        items.push({ key: `current.${key}`, text: String(oldVal) });
                      }
                      void translateMany(items);
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </Space>
    );
  }

  const columns = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 60, hideInSearch: true },
    {
      title: t('table.user'),
      key: 'user',
      width: 120,
      hideInSearch: true,
      render: (_: unknown, record: ProfileReviewItem) => (
        <span>
          {record.user_name || record.username || '-'} <span style={{ color: '#999', fontSize: 12 }}>(#{record.user_id})</span>
        </span>
      ),
    },
    {
      title: t('audit.changePreview'),
      key: 'changes',
      width: 240,
      hideInSearch: true,
      render: (_: unknown, record: ProfileReviewItem) => {
        const pending = record.pending_data || {};
        const keys = Object.keys(pending);
        if (keys.length === 0) return <Text type="secondary">-</Text>;
        const textKeys = keys.filter((k) => !isImageField(k));
        const imageKeys = keys.filter((k) => isImageField(k));
        const preview = textKeys
          .slice(0, 3)
          .map((k) => `${fieldLabels[k] || k}: ${String(pending[k] ?? '-')}`)
          .join(', ');
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {textKeys.length > 0 ? (
              <Tooltip title={textKeys.map((k) => `${fieldLabels[k] || k}: ${String(pending[k] ?? '-')}`).join('\n')}>
                <Text style={{ maxWidth: 220, fontSize: 13 }} ellipsis>
                  {preview}
                </Text>
              </Tooltip>
            ) : null}
            {imageKeys.map((k) => (
              <div key={k}>
                <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>
                  {fieldLabels[k] || k}:
                </Text>
                {renderFieldValue(k, pending[k])}
              </div>
            ))}
          </Space>
        );
      },
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      key: 'status',
      width: 90,
      valueType: 'select',
      fieldProps: {
        options: [
          { label: t('audit.statusPending'), value: 'pending' },
          { label: t('audit.statusApproved'), value: 'approved' },
          { label: t('audit.statusRejected'), value: 'rejected' },
        ],
      },
      render: (_: unknown, record: ProfileReviewItem) => {
        const s = statusMap[record.status] || statusMap.pending;
        return <Badge status={s.color as any} text={s.label} />;
      },
    },
    {
      title: t('audit.rejectReason'),
      dataIndex: 'reject_reason',
      key: 'reject_reason',
      width: 120,
      hideInSearch: true,
      ellipsis: true,
      render: (_: unknown, record: ProfileReviewItem) => record.reject_reason || '-',
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      hideInSearch: true,
      render: (_: unknown, record: ProfileReviewItem) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 220,
      fixed: 'right' as const,
      hideInSearch: true,
      render: (_: unknown, record: ProfileReviewItem) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailItem(record)}
          >
            {t('btn.viewDetail')}
          </Button>
          {record.status === 'pending' && (
            <>
              <Popconfirm
                title={t('audit.approveConfirm')}
                onConfirm={() => handleApprove(record.id)}
                okText={t('btn.confirm') || 'OK'}
                cancelText={t('btn.cancel')}
              >
                <Button type="link" size="small" icon={<CheckOutlined />} style={{ color: '#52c41a' }}>
                  {t('btn.approve')}
                </Button>
              </Popconfirm>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  setRejectModal({ open: true, id: record.id });
                }}
              >
                {t('btn.reject')}
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  async function fetchData(params?: { pageSize?: number; current?: number; status?: string }) {
    try {
      const st = params?.status || statusFilter;
      const page = Math.max(1, Number(params?.current) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params?.pageSize) || 20));
      const qs = new URLSearchParams({
        status: st,
        page: String(page),
        page_size: String(pageSize),
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      const res = await adminFetchJson(`/api/admin/audit/profiles?${qs.toString()}`);
      const { list, total } = parsePaged<ProfileReviewItem>(res);
      return { data: list, success: true, total };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleApprove(id: number) {
    try {
      const res = await adminFetch(`/api/admin/audit/profiles/${id}/approve`, { method: 'POST' });
      if (res && res.ok) {
        showSuccess(t('audit.approveSuccess') as string);
        setDetailItem((prev) => (prev?.id === id ? null : prev));
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  async function handleReject(payload: { reason_id: number; remark: string }) {
    if (!rejectModal.id) return;
    try {
      const res = await adminFetch(`/api/admin/audit/profiles/${rejectModal.id}/reject`, {
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
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  return (
    <>
      <ProTable
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={fetchData}
        search={false}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        params={{ status: statusFilter }}
        scroll={{ x: 1100 }}
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

      {/* 资料审核详情弹窗 */}
      <Modal
        title={t('audit.profileDetail')}
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={
          detailItem
            ? (
              <Space>
                <Button
                  icon={<TranslationOutlined />}
                  loading={translating}
                  disabled={profileTranslateFields(detailItem).length === 0}
                  onClick={() => void translateMany(profileTranslateFields(detailItem))}
                >
                  {t('audit.translateAll')}
                </Button>
                {detailItem.status === 'pending' ? (
                  <>
                    <Popconfirm
                      title={t('audit.approveConfirm')}
                      onConfirm={() => handleApprove(detailItem.id)}
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
            )
            : null
        }
        width={640}
      >
        {detailItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('table.id')}>{detailItem.id}</Descriptions.Item>
            <Descriptions.Item label={t('table.user')}>
              {detailItem.user_name || detailItem.username} (#{detailItem.user_id})
            </Descriptions.Item>
            <Descriptions.Item label={t('audit.changeDetail')}>
              {renderDiff(detailItem)}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.status')}>
              <Badge
                status={(statusMap[detailItem.status] || statusMap.pending).color as any}
                text={(statusMap[detailItem.status] || statusMap.pending).label}
              />
            </Descriptions.Item>
            {detailItem.reject_reason && (
              <Descriptions.Item label={t('audit.rejectReason')}>
                <Text type="danger">{detailItem.reject_reason}</Text>
              </Descriptions.Item>
            )}
            {detailItem.reviewed_by && (
              <Descriptions.Item label={t('audit.reviewedBy')}>{detailItem.reviewed_by}</Descriptions.Item>
            )}
            <Descriptions.Item label={t('table.createdAt')}>
              <FormatDate value={detailItem.created_at} locale={locale} />
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <AuditRejectModal
        open={rejectModal.open}
        onCancel={() => setRejectModal({ open: false, id: null })}
        onConfirm={handleReject}
      />
    </>
  );
}

/* ---------- 资料审核 / 举报审核（独立路由页） ---------- */

export function ContentAuditList() {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState('profiles');

  return (
    <div>
      <h2>{t('page.auditContent')}</h2>
      <Tabs
        activeKey={subTab}
        onChange={setSubTab}
        items={[
          {
            key: 'profiles',
            label: t('audit.userProfileContentTab'),
            children: <ProfileReviewTab />,
          },
          {
            key: 'companions',
            label: t('audit.companionProfileContentTab'),
            children: <CompanionProfileReviewTab />,
          },
          {
            key: 'posts',
            label: t('audit.postContentTab'),
            children: <PostReviewTab />,
          },
        ]}
      />
    </div>
  );
}

export function ReportAuditList() {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState('user-reports');

  return (
    <div>
      <h2>{t('page.auditReports')}</h2>
      <Tabs
        activeKey={subTab}
        onChange={setSubTab}
        items={[
          {
            key: 'user-reports',
            label: t('audit.userReportsTab'),
            children: <ReportsAuditTab kind="user" />,
          },
          {
            key: 'companion-reports',
            label: t('audit.companionReportsTab'),
            children: <ReportsAuditTab kind="companion" />,
          },
          {
            key: 'post-reports',
            label: t('audit.postReportsTab'),
            children: <ReportsAuditTab kind="post" />,
          },
        ]}
      />
    </div>
  );
}

export default ContentAuditList;
