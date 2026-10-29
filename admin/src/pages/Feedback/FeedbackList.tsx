import { useTranslation } from 'react-i18next';
import ProTable from '@ant-design/pro-table';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Popconfirm, Badge, Space } from 'antd';
import { EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { FeedbackItem, FeedbackThreadDetail } from '../../types';
import { getAppLanguage } from '../../locales';
import { parsePaged } from '../Companions/contentApi';

function displayUserName(record: Pick<FeedbackItem, 'nickname' | 'user_name' | 'username'>) {
  return record.nickname || record.user_name || record.username || '-';
}

function threadToListItem(res: FeedbackThreadDetail): FeedbackItem {
  const last = res.messages?.[res.messages.length - 1];
  const thread = res.thread;
  return {
    id: thread.id,
    user_id: thread.user_id,
    username: thread.username,
    nickname: thread.nickname,
    user_name: thread.user_name,
    language: thread.language,
    status: thread.status,
    unread_count: 0,
    last_message: last?.content ?? '',
    last_message_sender: last?.sender ?? '',
    last_message_at: last?.created_at ?? null,
    created_at: last?.created_at ?? '',
    updated_at: last?.created_at ?? '',
  };
}

export default function FeedbackList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<FeedbackItem>({
      listPath: '/feedback',
      getRowId: (row) => row.id,
      fetchRow: async (id) => {
        const res = await adminFetchJson<FeedbackThreadDetail>(`/api/admin/feedback/${id}/messages`);
        if (!res?.thread) return undefined;
        return threadToListItem(res);
      },
    });
  const pagination = useTablePagination(10);
  const locale = getAppLanguage();

  const columns = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 70, search: false },
    {
      title: t('table.user'),
      key: 'user',
      width: 180,
      search: false,
      render: (_: unknown, record: FeedbackItem) => (
        <span>
          {displayUserName(record)}{' '}
          <span style={{ color: '#999', fontSize: 12 }}>(#{record.user_id})</span>
        </span>
      ),
    },
    {
      title: t('table.keyword'),
      dataIndex: 'keyword',
      key: 'keyword',
      hideInTable: true,
      fieldProps: {
        placeholder: t('search.placeholder.feedback'),
        allowClear: true,
      },
    },
    {
      title: t('table.userId'),
      dataIndex: 'user_id',
      key: 'user_id',
      hideInTable: true,
      valueType: 'digit' as const,
      fieldProps: { precision: 0, min: 1 },
    },
    {
      title: t('table.language'),
      dataIndex: 'language',
      key: 'language',
      width: 80,
      search: false,
      render: (_: unknown, record: FeedbackItem) => record.language || '—',
    },
    {
      title: t('table.lastMessage'),
      key: 'lastMessage',
      width: 240,
      ellipsis: true,
      search: false,
      render: (_: unknown, record: FeedbackItem) => (
        <span>
          {record.last_message || '—'}
          {record.last_message_sender ? (
            <span style={{ color: '#999', fontSize: 12 }}> [{record.last_message_sender}]</span>
          ) : null}
        </span>
      ),
    },
    {
      title: t('feedback.unread'),
      dataIndex: 'unread_count',
      key: 'unread_count',
      width: 90,
      search: false,
      render: (_: unknown, record: FeedbackItem) => {
        const count = Number(record.unread_count) || 0;
        return count > 0 ? <Badge count={count} overflowCount={99} /> : <span style={{ color: '#999' }}>0</span>;
      },
    },
    {
      title: t('feedback.hasUnread'),
      dataIndex: 'has_unread',
      key: 'has_unread',
      hideInTable: true,
      valueType: 'select' as const,
      fieldProps: { allowClear: true },
      valueEnum: {
        true: { text: t('feedback.hasUnreadYes') },
      },
      search: {
        transform: (value: string | boolean) =>
          String(value) === 'true' ? { has_unread: 'true' } : {},
      },
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      valueType: 'select' as const,
      valueEnum: {
        open: { text: t('status.open') },
        replied: { text: t('status.replied') },
        closed: { text: t('status.closed') },
      },
      render: (_: unknown, record: FeedbackItem) => {
        if (record.status === 'replied') {
          return <Badge status="success" text={t('status.replied')} />;
        }
        if (record.status === 'closed') {
          return <Badge status="default" text={t('status.closed')} />;
        }
        return <Badge status="warning" text={t('status.open')} />;
      },
    },
    {
      title: t('table.lastMessageAt'),
      dataIndex: 'last_user_msg_at',
      key: 'last_user_msg_at',
      width: 180,
      search: false,
      render: (_: unknown, record: FeedbackItem) => (
        <FormatDate value={record.last_user_msg_at || record.last_message_at || record.updated_at} locale={locale} />
      ),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 180,
      search: false,
      fixed: 'right' as const,
      render: (_: unknown, record: FeedbackItem) => (
        <Space size={0} wrap={false}>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => goToChild(`/feedback/${record.id}/edit`)}
          >
            {t('btn.viewReply')}
          </Button>
          <Popconfirm
            title={t('feedback.deleteConfirm')}
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

  async function fetchData(params: Record<string, unknown>) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 10));
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      const keyword = typeof params.keyword === 'string' ? params.keyword.trim() : '';
      if (keyword) qs.set('keyword', keyword);
      if (params.status) qs.set('status', String(params.status));
      if (params.user_id != null && params.user_id !== '') qs.set('user_id', String(params.user_id));
      if (params.has_unread != null && params.has_unread !== '') {
        qs.set('has_unread', String(params.has_unread));
      }
      const res = await adminFetchJson(`/api/admin/feedback?${qs.toString()}`);
      const { list, total } = parsePaged<FeedbackItem>(res);
      return { data: list, success: true, total };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/feedback/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  return (
    <div>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
        <h2>{t('page.feedback')}</h2>
        <ProTable
          actionRef={actionRef}
          columns={columns}
          rowKey="id"
          dataSource={dataSource}
          onDataSourceChange={setDataSource}
          request={fetchData}
          scroll={{ x: 1100 }}
          pagination={{
            ...pagination,
            showTotal: (total) => t('table.total', { total }),
          }}
          search={{ labelWidth: 'auto', defaultCollapsed: false }}
          toolBarRender={() => []}
        />
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
