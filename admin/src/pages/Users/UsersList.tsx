import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ProColumns } from '@ant-design/pro-table';
import { Button, Popconfirm, Space, Tag } from 'antd';
import { DeleteOutlined, EyeOutlined, PlusOutlined, StopOutlined, UnlockOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { UserAccountStatus, UserItem, UsersListResponse } from '../../types';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { getAppLanguage } from '../../locales';
import {
  formatGender,
  formatOrientation,
  getRemainingFreeMessages,
  getRemainingPoints,
  getUserStatus,
  isVipUser,
  unwrapUser,
} from './userFields';

const HIGHLIGHT_HEADER = { color: '#cf1322' };

const STATUS_TAG: Record<UserAccountStatus, { color: string; labelKey: string }> = {
  normal: { color: 'success', labelKey: 'users.statusNormal' },
  banned: { color: 'error', labelKey: 'users.statusBanned' },
  cancelled: { color: 'default', labelKey: 'users.statusCancelled' },
};

function setQuery(qs: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  qs.set(key, String(value));
}

export default function UsersList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<UserItem>({
      listPath: '/users',
      getRowId: (row) => row.id,
      createdStateKey: 'usersCreated',
      fetchRow: async (id) => {
        const raw = await adminFetchJson<UserItem | { results?: UserItem }>(`/api/admin/users/${id}`);
        return unwrapUser(raw);
      },
    });
  const pagination = useTablePagination(20);
  const locale = getAppLanguage();

  const [selectedRowKeys, setSelectedRowKeys] = useState<(string | number)[]>([]);
  const [banningIds, setBanningIds] = useState<Set<number>>(new Set());

  const genderValueEnum = useMemo(
    () => ({
      male: { text: t('gender.male') },
      female: { text: t('gender.female') },
      'non-binary': { text: t('gender.nonBinary') },
      confidential: { text: t('gender.confidential') },
    }),
    [t],
  );

  const orientationValueEnum = useMemo(
    () => ({
      heterosexual: { text: t('orientation.heterosexual') },
      homosexual: { text: t('orientation.homosexual') },
      bisexual: { text: t('orientation.bisexual') },
      pansexual: { text: t('orientation.pansexual') },
      asexual: { text: t('orientation.asexual') },
      secret: { text: t('orientation.secret') },
    }),
    [t],
  );

  const vipValueEnum = useMemo(
    () => ({
      true: { text: t('yes') },
      false: { text: t('no') },
    }),
    [t],
  );

  const acquisitionValueEnum = useMemo(
    () => ({
      none: { text: t('users.acquisitionNone') },
      ads: { text: t('users.acquisitionAds') },
      attributed: { text: t('users.acquisitionAttributed') },
    }),
    [t],
  );

  const columns: ProColumns<UserItem>[] = [
    {
      title: t('table.id'),
      dataIndex: 'id',
      key: 'id',
      width: 88,
      valueType: 'digit',
      fieldProps: {
        precision: 0,
        min: 1,
        placeholder: t('search.placeholder.userId'),
        controls: false,
        style: { width: '100%' },
      },
    },
    {
      title: t('table.username'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
      ellipsis: true,
      search: false,
      sorter: (a, b) => String(a.username || '').localeCompare(String(b.username || '')),
    },
    {
      title: t('table.nickname'),
      dataIndex: 'nickname',
      key: 'nickname',
      width: 120,
      ellipsis: true,
      fieldProps: {
        placeholder: t('search.placeholder.nickname'),
        allowClear: true,
      },
      render: (_: unknown, record: UserItem) => record.nickname || '-',
    },
    {
      title: t('table.gender'),
      dataIndex: 'gender',
      key: 'gender',
      width: 80,
      valueType: 'select',
      valueEnum: genderValueEnum,
      fieldProps: { allowClear: true },
      sorter: (a, b) => String(a.gender || '').localeCompare(String(b.gender || '')),
      render: (_: unknown, record: UserItem) => formatGender(record.gender, t),
    },
    {
      title: t('table.sexualOrientation'),
      dataIndex: 'sexual_orientation',
      key: 'sexual_orientation',
      width: 100,
      valueType: 'select',
      valueEnum: orientationValueEnum,
      fieldProps: { allowClear: true },
      render: (_: unknown, record: UserItem) => formatOrientation(record.sexual_orientation, t),
    },
    {
      title: t('table.age'),
      dataIndex: 'age',
      key: 'age',
      width: 88,
      valueType: 'digit',
      fieldProps: {
        min: 0,
        max: 150,
        precision: 0,
        controls: false,
        placeholder: t('table.age'),
        style: { width: '100%' },
      },
      render: (_: unknown, record: UserItem) =>
        record.age !== undefined && record.age !== null ? record.age : '-',
    },
    {
      title: t('table.region'),
      dataIndex: 'region',
      key: 'region',
      width: 100,
      ellipsis: true,
      fieldProps: {
        allowClear: true,
        placeholder: t('table.region'),
      },
      render: (_: unknown, record: UserItem) => record.region || '-',
    },
    {
      title: t('users.acquisition'),
      dataIndex: 'acquisition',
      key: 'acquisition',
      width: 110,
      valueType: 'select',
      valueEnum: acquisitionValueEnum,
      fieldProps: { allowClear: true },
      render: (_: unknown, record: UserItem) =>
        record.acquisition_label || t('users.acquisitionNone'),
    },
    {
      title: <span style={HIGHLIGHT_HEADER}>{t('table.vip')}</span>,
      dataIndex: 'is_vip',
      key: 'is_vip',
      width: 88,
      valueType: 'select',
      valueEnum: vipValueEnum,
      fieldProps: { allowClear: true },
      render: (_: unknown, record: UserItem) => (isVipUser(record) ? t('yes') : t('no')),
    },
    {
      title: t('table.vipExpireAt'),
      dataIndex: 'vip_expire_at',
      key: 'vip_expire_at',
      width: 168,
      search: false,
      render: (_: unknown, record: UserItem) => {
        if (!isVipUser(record)) return '——';
        if (record.vip_type === 'lifetime' || !record.vip_expire_at) return t('users.vipLifetime') as string;
        return <FormatDate value={record.vip_expire_at} locale={locale} />;
      },
    },
    {
      title: <span style={HIGHLIGHT_HEADER}>{t('table.remainingPoints')}</span>,
      dataIndex: 'credits',
      key: 'credits',
      width: 100,
      search: false,
      sorter: (a, b) => (getRemainingPoints(a) ?? -1) - (getRemainingPoints(b) ?? -1),
      render: (_: unknown, record: UserItem) => {
        const n = getRemainingPoints(record);
        return n === null ? '-' : n;
      },
    },
    {
      title: <span style={HIGHLIGHT_HEADER}>{t('table.remainingFreeMessages')}</span>,
      dataIndex: 'free_messages_remaining',
      key: 'free_messages_remaining',
      width: 130,
      search: false,
      render: (_: unknown, record: UserItem) => {
        const n = getRemainingFreeMessages(record);
        return n === null ? '-' : n;
      },
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 168,
      search: false,
      sorter: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')),
      render: (_: unknown, record: UserItem) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: <span style={HIGHLIGHT_HEADER}>{t('table.status')}</span>,
      dataIndex: 'status',
      key: 'status',
      width: 88,
      search: false,
      render: (_: unknown, record: UserItem) => {
        const s = STATUS_TAG[getUserStatus(record)];
        return <Tag color={s.color}>{t(s.labelKey)}</Tag>;
      },
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 280,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: UserItem) => {
        const status = getUserStatus(record);
        const banned = status === 'banned';
        const busy = banningIds.has(record.id);
        return (
          <Space size={0} wrap={false}>
            {status !== 'cancelled' && (
              <Popconfirm
                title={banned ? t('users.unbanConfirm') : t('users.banConfirm')}
                onConfirm={() => handleBanToggle(record)}
                okText={t('btn.confirm')}
                cancelText={t('btn.cancel')}
                disabled={busy}
              >
                <Button
                  type="link"
                  loading={busy}
                  icon={banned ? <UnlockOutlined /> : <StopOutlined />}
                >
                  {banned ? t('users.unban') : t('users.ban')}
                </Button>
              </Popconfirm>
            )}
            <Button type="link" icon={<EyeOutlined />} onClick={() => goToChild(`/users/${record.id}/edit`)}>
              {t('btn.viewDetail')}
            </Button>
            <Popconfirm
              title={t('confirm.deleteUser')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('btn.delete')}
              cancelText={t('btn.cancel')}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                {t('btn.delete')}
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  async function fetchData(params: Record<string, unknown>) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      setQuery(qs, 'id', params.id);
      setQuery(qs, 'nickname', params.nickname);
      setQuery(qs, 'gender', params.gender);
      setQuery(qs, 'sexual_orientation', params.sexual_orientation);
      setQuery(qs, 'age', params.age);
      setQuery(qs, 'region', params.region);
      if (params.acquisition) qs.set('acquisition', String(params.acquisition));
      if (params.is_vip === true || params.is_vip === false || params.is_vip === 'true' || params.is_vip === 'false') {
        qs.set('is_vip', String(params.is_vip));
      }
      const res = await adminFetchJson<UsersListResponse>(`/api/admin/users?${qs.toString()}`);
      const rows = res?.results ?? [];
      setDataSource(rows);
      return {
        data: rows,
        success: true,
        total: res?.pagination?.total ?? 0,
      };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleBanToggle(record: UserItem) {
    const banned = getUserStatus(record) === 'banned';
    const nextBanned = !banned;
    setBanningIds((prev) => new Set(prev).add(record.id));
    try {
      const res = await adminFetch(`/api/admin/users/${record.id}/ban-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: nextBanned }),
      });
      if (res && res.ok) {
        showSuccess((nextBanned ? t('users.banSuccess') : t('users.unbanSuccess')) as string);
        actionRef.current?.reload();
      } else {
        const err = await res?.text();
        showError(err || (t('toast.loadFailed') as string));
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setBanningIds((prev) => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
        setSelectedRowKeys((prev) => prev.filter((key) => key !== id));
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
      const res = await adminFetch('/api/admin/users/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      if (res && res.ok) {
        const result = await res.json();
        showSuccess(
          t('users.batchDeleteSuccess', { count: result.deleted || selectedRowKeys.length }) as string,
        );
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
        <h2>{t('page.users')}</h2>
        <ProTable<UserItem>
          actionRef={actionRef}
          columns={columns}
          rowKey="id"
          dataSource={dataSource}
          onDataSourceChange={setDataSource}
          request={fetchData}
          search={{
            labelWidth: 'auto',
            defaultCollapsed: false,
            span: 6,
          }}
          scroll={{ x: 1760 }}
          pagination={{
            ...pagination,
            showTotal: (n) => t('table.total', { total: n }),
          }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as (string | number)[]),
          }}
          toolBarRender={() => [
            <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/users/new')}>
              {t('btn.new')}
            </Button>,
            selectedRowKeys.length > 0 && (
              <Popconfirm
                key="batch-delete"
                title={t('confirm.batchDeleteUsers', { count: selectedRowKeys.length })}
                onConfirm={handleBatchDelete}
                okText={t('btn.delete')}
                cancelText={t('btn.cancel')}
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  {t('btn.delete')} ({selectedRowKeys.length})
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
