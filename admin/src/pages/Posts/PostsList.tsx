import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ProColumns } from '@ant-design/pro-table';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Image, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ContentPost } from '../../types';
import { CONTENT_LANGS, unwrapResults } from '../Companions/contentApi';
import { getAppLanguage } from '../../locales';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';

const { Text } = Typography;

const POST_CATEGORIES = ['dating', 'psychology', 'tips', 'stories', 'off-topic'] as const;

const postCategoryValueEnum = Object.fromEntries(
  POST_CATEGORIES.map((item) => [item, { text: item }]),
);

function setQuery(qs: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  qs.set(key, String(value));
}

function reviewStatusOf(record: ContentPost) {
  return record.review_status || record.status || '';
}

const SORT_FIELDS = new Set(['created_at', 'reviewed_at', 'likes_count', 'comments_count']);

export default function PostsList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<ContentPost>({
      listPath: '/posts',
      getRowId: (row) => row.id,
      fetchRow: async (id) => {
        const res = await adminFetchJson(`/api/admin/content/posts/${id}`);
        return unwrapResults<ContentPost>(res) ?? (res as ContentPost | undefined);
      },
    });
  const pagination = useTablePagination(20);
  const locale = getAppLanguage();

  const languageValueEnum = useMemo(
    () => Object.fromEntries(CONTENT_LANGS.map((item) => [item.value, { text: item.label }])),
    [],
  );

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'processing', label: t('audit.statusPending') },
    approved: { color: 'success', label: t('audit.statusApproved') },
    rejected: { color: 'error', label: t('audit.statusRejected') },
  };

  const columns: ProColumns<ContentPost>[] = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 80, search: false },
    {
      title: t('table.keyword'),
      dataIndex: 'keyword',
      key: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: t('search.placeholder.posts'), allowClear: true },
    },
    {
      title: t('table.user'),
      key: 'user',
      width: 160,
      search: false,
      render: (_, record) => (
        <Space>
          {record.avatar ? (
            <Image
              src={resolveAdminMediaUrl(record.avatar)}
              width={28}
              height={28}
              style={{ borderRadius: '50%', objectFit: 'cover' }}
              preview={false}
            />
          ) : null}
          <span>{record.user_name || record.username || '-'}</span>
        </Space>
      ),
    },
    {
      title: t('table.userId'),
      dataIndex: 'user_id',
      key: 'user_id',
      width: 100,
      hideInTable: true,
      valueType: 'digit',
      fieldProps: { precision: 0, min: 1, controls: false, style: { width: '100%' } },
    },
    {
      title: t('table.nickname'),
      dataIndex: 'user_nickname',
      key: 'user_nickname',
      hideInTable: true,
      fieldProps: { allowClear: true, placeholder: t('search.placeholder.nickname') },
    },
    {
      title: t('table.title'),
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_, record) => (
        <Space size={6}>
          {record.title?.includes('[指南]') ? <Tag color="gold">{t('post.guideTag')}</Tag> : null}
          <Text ellipsis style={{ maxWidth: 140 }}>
            {record.title || '-'}
          </Text>
        </Space>
      ),
    },
    {
      title: t('table.summary'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      search: false,
      render: (_, record) => record.content || '-',
    },
    {
      title: t('table.image'),
      dataIndex: 'images',
      key: 'images',
      width: 90,
      search: false,
      render: (_, record) =>
        record.images?.[0] ? (
          <Image
            src={resolveAdminMediaUrl(record.images[0])}
            width={48}
            height={48}
            style={{ objectFit: 'cover', borderRadius: 4 }}
          />
        ) : (
          <span style={{ color: '#999' }}>—</span>
        ),
    },
    {
      title: t('content.hasImage'),
      dataIndex: 'has_image',
      key: 'has_image',
      hideInTable: true,
      valueType: 'select',
      valueEnum: {
        true: { text: t('content.hasImageYes') },
        false: { text: t('content.hasImageNo') },
      },
    },
    {
      title: t('table.category'),
      dataIndex: 'category',
      key: 'category',
      width: 110,
      ellipsis: true,
      valueType: 'select',
      valueEnum: postCategoryValueEnum,
      fieldProps: { allowClear: true, placeholder: t('post.categoryPlaceholder') },
      render: (_, record) => (record.category ? <Tag>{record.category}</Tag> : '-'),
    },
    {
      title: t('table.language'),
      dataIndex: 'language',
      key: 'language',
      width: 100,
      valueType: 'select',
      valueEnum: languageValueEnum,
    },
    {
      title: t('table.likes'),
      dataIndex: 'likes_count',
      key: 'likes_count',
      width: 80,
      search: false,
      sorter: true,
    },
    {
      title: t('table.comments'),
      dataIndex: 'comments_count',
      key: 'comments_count',
      width: 80,
      search: false,
      sorter: true,
    },
    {
      title: t('table.status'),
      dataIndex: 'review_status',
      key: 'review_status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        pending: { text: t('audit.statusPending') },
        approved: { text: t('audit.statusApproved') },
        rejected: { text: t('audit.statusRejected') },
        all: { text: t('audit.statusAll') },
      },
      render: (_, record) => {
        const status = reviewStatusOf(record);
        const s = statusMap[status];
        return s ? <Tag color={s.color === 'processing' ? 'blue' : s.color}>{s.label}</Tag> : status || '-';
      },
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_range',
      key: 'created_range',
      hideInTable: true,
      valueType: 'dateRange',
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 168,
      search: false,
      sorter: true,
      render: (_, record) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 180,
      fixed: 'right',
      search: false,
      render: (_, record) => (
        <Space size={0} wrap={false} style={{ whiteSpace: 'nowrap' }}>
          <Button type="link" icon={<EditOutlined />} onClick={() => goToChild(`/posts/${record.id}/edit`)}>
            {t('btn.edit')}
          </Button>
          <Popconfirm
            title={t('confirm.deletePost')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('btn.delete')}
            cancelText={t('btn.cancel')}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              {t('btn.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  async function fetchData(params: Record<string, unknown>, sort: Record<string, 'ascend' | 'descend' | null | undefined>) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 20));
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      setQuery(qs, 'keyword', params.keyword);
      setQuery(qs, 'user_id', params.user_id);
      setQuery(qs, 'user_nickname', params.user_nickname);
      setQuery(qs, 'category', params.category);
      setQuery(qs, 'language', params.language);
      if (params.review_status && params.review_status !== 'all') {
        qs.set('review_status', String(params.review_status));
      }
      if (params.has_image === true || params.has_image === false || params.has_image === 'true' || params.has_image === 'false') {
        qs.set('has_image', String(params.has_image));
      }
      const range = params.created_range ?? params.created_at;
      if (Array.isArray(range)) {
        const toDay = (v: unknown) => {
          if (v == null || v === '') return '';
          if (typeof v === 'object' && v && 'format' in v) {
            return (v as { format: (s: string) => string }).format('YYYY-MM-DD');
          }
          return String(v).slice(0, 10);
        };
        const from = toDay(range[0]);
        const to = toDay(range[1]);
        if (from) qs.set('created_from', from);
        if (to) qs.set('created_to', to);
      }
      const sortEntry = Object.entries(sort || {}).find(
        ([field, order]) => SORT_FIELDS.has(field) && (order === 'ascend' || order === 'descend'),
      );
      qs.set('sort_by', sortEntry?.[0] || 'created_at');
      qs.set('sort_order', sortEntry?.[1] === 'ascend' ? 'asc' : 'desc');

      const res = await adminFetchJson<{
        results?: ContentPost[];
        pagination?: { total?: number };
      }>(`/api/admin/content/posts?${qs.toString()}`);
      const rows = unwrapResults<ContentPost[]>(res) ?? [];
      const list = Array.isArray(rows) ? rows : [];
      return { data: list, success: true, total: res?.pagination?.total ?? 0 };
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/content/posts/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  return (
    <div>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
      <h2>{t('page.posts')}</h2>
      <ProTable<ContentPost>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        request={fetchData}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        scroll={{ x: 1500 }}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        locale={{ emptyText: t('empty.posts') }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/posts/new')}>
            {t('btn.new')}
          </Button>,
        ]}
      />
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
