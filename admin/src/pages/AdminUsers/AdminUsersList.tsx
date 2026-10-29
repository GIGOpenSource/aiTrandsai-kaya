import { useTranslation } from 'react-i18next';
import ProTable, { type ProColumns } from '@ant-design/pro-table';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Modal, Space, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import type { AdminAccount, PaginatedResponse } from '../../types';

function isActiveAccount(record: AdminAccount) {
  return record.is_active !== false;
}

export default function AdminUsersList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<AdminAccount>({
      listPath: '/admin-users',
      getRowId: (row) => row.id,
      fetchRow: async (id) => {
        const res = await adminFetchJson<AdminAccount | { results?: AdminAccount }>(
          `/api/admin/admin-users/${id}`,
        );
        if (res && typeof res === 'object' && 'results' in res && res.results && !Array.isArray(res.results)) {
          return res.results;
        }
        if (res && typeof res === 'object' && 'id' in res) return res as AdminAccount;
        return undefined;
      },
    });
  const pagination = useTablePagination(20);

  const columns: ProColumns<AdminAccount>[] = [
    {
      title: t('adminUsers.uid'),
      dataIndex: 'id',
      key: 'id',
      width: 88,
      search: false,
      render: (_: unknown, record: AdminAccount) => String(record.id).padStart(4, '0'),
    },
    {
      title: t('table.username'),
      dataIndex: 'username',
      key: 'username',
      ellipsis: true,
      fieldProps: {
        placeholder: t('search.placeholder.users'),
        allowClear: true,
      },
    },
    {
      title: t('adminUsers.email'),
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      search: false,
      render: (_: unknown, record: AdminAccount) => record.email || '——',
    },
    {
      title: t('adminUsers.password'),
      key: 'password',
      width: 100,
      search: false,
      render: () => '******',
    },
    {
      title: t('adminUsers.role'),
      dataIndex: 'role_key',
      key: 'role_key',
      width: 120,
      search: false,
      render: (_: unknown, record: AdminAccount) => record.role_name || record.role_key || '——',
    },
    {
      title: t('adminUsers.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      search: false,
      render: (_: unknown, record: AdminAccount) =>
        isActiveAccount(record) ? (
          <Tag color="success">{t('adminUsers.statusActive')}</Tag>
        ) : (
          <Tag>{t('adminUsers.statusInactive')}</Tag>
        ),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 280,
      search: false,
      render: (_: unknown, record: AdminAccount) => {
        const active = isActiveAccount(record);
        const protectedUser = record.username === 'gigadmin';
        return (
          <Space size={0}>
            <Button type="link" icon={<EditOutlined />} onClick={() => goToChild(`/admin-users/${record.id}/edit`)}>
              {t('btn.edit')}
            </Button>
            <Button
              type="link"
              icon={active ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => confirmStatus(record, !active)}
            >
              {active ? t('adminUsers.suspend') : t('adminUsers.enable')}
            </Button>
            {!protectedUser && (
              <Button type="link" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(record)}>
                {t('btn.delete')}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  function confirmStatus(record: AdminAccount, nextActive: boolean) {
    const action = nextActive ? t('adminUsers.enable') : t('adminUsers.suspend');
    Modal.confirm({
      title: t('adminUsers.reminder'),
      content: t('adminUsers.confirmAction', {
        action,
        account: `${record.id} ${record.username}`,
      }),
      okText: t('btn.confirm'),
      cancelText: t('btn.cancel'),
      onOk: () => handleStatus(record, nextActive),
    });
  }

  function confirmDelete(record: AdminAccount) {
    Modal.confirm({
      title: t('adminUsers.reminder'),
      content: t('adminUsers.confirmAction', {
        action: t('btn.delete'),
        account: `${record.id} ${record.username}`,
      }),
      okText: t('btn.confirm'),
      cancelText: t('btn.cancel'),
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record.id),
    });
  }

  async function handleStatus(record: AdminAccount, is_active: boolean) {
    try {
      const res = await adminFetch(`/api/admin/admin-users/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active }),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/admin-users/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      } else {
        const err = await res?.text();
        showError(err || (t('toast.loadFailed') as string));
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  async function fetchData(params: { current?: number; pageSize?: number; username?: string }) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 20));
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      const q = String(params.username || '').trim();
      if (q) qs.set('username', q);
      const res = await adminFetchJson<PaginatedResponse<AdminAccount>>(`/api/admin/admin-users?${qs.toString()}`);
      return {
        data: res?.results ?? [],
        success: true,
        total: res?.pagination?.total ?? 0,
      };
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      return { data: [], success: false, total: 0 };
    }
  }

  return (
    <div>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
      <h2>{t('page.adminUsers')}</h2>
      <ProTable<AdminAccount>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        request={fetchData}
        search={{
          labelWidth: 'auto',
          defaultCollapsed: false,
        }}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/admin-users/new')}>
            {t('btn.new')}
          </Button>,
        ]}
      />
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
