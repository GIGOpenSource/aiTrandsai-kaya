import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable from '@ant-design/pro-table';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Popconfirm, Space, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { SystemNotificationItem } from '../../types';
import { getAppLanguage } from '../../locales';
import { parsePaged } from '../Companions/contentApi';

const LANGUAGE_MAP: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  es: 'Español',
  id: 'Bahasa Indonesia',
};

export default function NotificationsList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<SystemNotificationItem>({
      listPath: '/notifications',
      getRowId: (row) => row.id,
    });
  const pagination = useTablePagination(10);
  const locale = getAppLanguage();
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const columns = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 60 },
    {
      title: t('table.title'),
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('table.content'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
    },
    {
      title: t('table.language'),
      dataIndex: 'language',
      key: 'language',
      width: 120,
      render: (_: unknown, record: SystemNotificationItem) => (
        <Tag>{LANGUAGE_MAP[record.language] || record.language}</Tag>
      ),
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (_: unknown, record: SystemNotificationItem) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 120,
      render: (_: unknown, record: SystemNotificationItem) => (
        <Space>
          <Popconfirm
            title={t('user.confirmDeleteNotification')}
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

  async function fetchData(params: { current?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      const res = await adminFetchJson(`/api/admin/notifications?${qs.toString()}`);
      const { list, total } = parsePaged<SystemNotificationItem>(res);
      return { data: list, success: true, total };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/notifications/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
        setSelectedRowKeys(prev => prev.filter(key => key !== id));
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  async function handleBatchDelete() {
    if (selectedRowKeys.length === 0) return;
    try {
      const res = await adminFetch('/api/admin/notifications/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      if (res && res.ok) {
        const result = await res.json();
        showSuccess(t('user.deleteSuccessCount', { count: result.deleted || selectedRowKeys.length }) as string);
        setSelectedRowKeys([]);
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
      <ProTable<SystemNotificationItem>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        request={fetchData}
        search={false}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
        toolBarRender={() => [
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => goToChild('/notifications/new')}
          >
            {t('btn.new')}
          </Button>,
          selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title={t('user.batchDeleteNotificationsConfirm', { count: selectedRowKeys.length })}
              onConfirm={handleBatchDelete}
              okText={t('btn.delete')}
              cancelText={t('btn.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t('user.batchDelete')} ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ]}
      />
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
