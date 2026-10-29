import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Drawer, Popconfirm, Select, Space, Tabs } from 'antd';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ChatVersionPromptItem, ChatVersionPromptUser } from '../../types';
import { parsePaged } from '../Companions/contentApi';
import { getAppLanguage } from '../../locales';

type Scope = 'applied' | 'removed';

type Props = {
  open: boolean;
  prompt: ChatVersionPromptItem | null;
  prompts: ChatVersionPromptItem[];
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onPromptChange: (prompt: ChatVersionPromptItem) => void;
  onClose: () => void;
  onCountsChange: () => void;
};

function errorMessage(detail: unknown, fallback: string, t: (key: string) => unknown) {
  const code = typeof detail === 'string' ? detail : '';
  if (code === 'already_removed') return t('chatVersion.errAlreadyRemoved') as string;
  if (code === 'user_not_found') return t('chatVersion.errUserNotFound') as string;
  if (code === 'not_removed') return t('chatVersion.errNotRemoved') as string;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return fallback;
}

async function readError(res: Response, fallback: string, t: (key: string) => unknown) {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    return errorMessage(data.detail || data.message || data.error, fallback, t);
  } catch {
    return fallback;
  }
}

export default function ScopeUsersDrawer({
  open,
  prompt,
  prompts,
  scope,
  onScopeChange,
  onPromptChange,
  onClose,
  onCountsChange,
}: Props) {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const actionRef = useRef<ActionType | null>(null);

  const mutateUser = useCallback(
    async (userId: number, action: 'remove' | 'restore') => {
      if (!prompt) return;
      try {
        const res = await adminFetch(
          `/api/admin/chat-version-prompts/${prompt.id}/users/${userId}/${action}`,
          { method: 'POST' },
        );
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          actionRef.current?.reload();
          onCountsChange();
        } else {
          showError(res ? await readError(res, t('toast.loadFailed') as string, t) : (t('toast.loadFailed') as string));
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [onCountsChange, prompt, t],
  );

  const columns: ProColumns<ChatVersionPromptUser>[] = useMemo(
    () => [
      {
        title: t('table.keyword'),
        dataIndex: 'keyword',
        hideInTable: true,
        fieldProps: { placeholder: t('chatVersion.userKeyword'), allowClear: true },
      },
      { title: t('table.id'), dataIndex: 'id', width: 88, search: false },
      {
        title: t('table.username'),
        dataIndex: 'username',
        width: 140,
        ellipsis: true,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.username || '—',
      },
      {
        title: t('table.nickname'),
        dataIndex: 'nickname',
        width: 120,
        ellipsis: true,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.nickname || '—',
      },
      {
        title: t('chatVersion.email'),
        dataIndex: 'email',
        width: 180,
        ellipsis: true,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.email || '—',
      },
      {
        title: t('chatVersion.appVersion'),
        dataIndex: 'app_version',
        width: 110,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.app_version || '—',
      },
      {
        title: t('table.createdAt'),
        dataIndex: 'created_at',
        width: 180,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => <FormatDate value={row.created_at} locale={locale} />,
      },
      {
        title: t('chatVersion.accountStatus'),
        dataIndex: 'account_status',
        width: 110,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.account_status || '—',
      },
      {
        title: t('chatVersion.platform'),
        dataIndex: 'platform',
        width: 100,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.platform || '—',
      },
      {
        title: t('table.language'),
        dataIndex: 'language',
        width: 80,
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) => row.language || '—',
      },
      ...(scope === 'removed'
        ? ([
            {
              title: t('chatVersion.removedAt'),
              dataIndex: 'removed_at',
              width: 180,
              search: false,
              render: (_: unknown, row: ChatVersionPromptUser) => (
                <FormatDate value={row.removed_at} locale={locale} />
              ),
            },
            {
              title: t('chatVersion.removedBy'),
              dataIndex: 'removed_by',
              width: 120,
              search: false,
              render: (_: unknown, row: ChatVersionPromptUser) =>
                row.removed_by != null && row.removed_by !== '' ? String(row.removed_by) : '—',
            },
          ] as ProColumns<ChatVersionPromptUser>[])
        : []),
      {
        title: t('table.action'),
        key: 'action',
        width: 100,
        fixed: 'right',
        search: false,
        render: (_: unknown, row: ChatVersionPromptUser) =>
          scope === 'applied' ? (
            <Popconfirm
              title={t('chatVersion.confirmRemove')}
              onConfirm={() => mutateUser(row.id, 'remove')}
              okText={t('chatVersion.remove')}
              cancelText={t('btn.cancel')}
            >
              <Button type="link" danger>
                {t('chatVersion.remove')}
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title={t('chatVersion.confirmRestore')}
              onConfirm={() => mutateUser(row.id, 'restore')}
              okText={t('chatVersion.restore')}
              cancelText={t('btn.cancel')}
            >
              <Button type="link">{t('chatVersion.restore')}</Button>
            </Popconfirm>
          ),
      },
    ],
    [locale, mutateUser, scope, t],
  );

  return (
    <Drawer
      title={t('chatVersion.scope')}
      open={open}
      onClose={onClose}
      width={1080}
      destroyOnHidden
    >
      <p style={{ color: '#666', marginTop: 0 }}>{t('chatVersion.scopeHint')}</p>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>{t('chatVersion.version')}</span>
        <Select
          style={{ minWidth: 160 }}
          value={prompt?.id}
          options={prompts.map((item) => ({
            value: item.id,
            label: item.version,
          }))}
          onChange={(id) => {
            const next = prompts.find((item) => item.id === id);
            if (next) onPromptChange(next);
          }}
        />
      </Space>
      <Tabs
        activeKey={scope}
        onChange={(key) => onScopeChange(key as Scope)}
        items={[
          {
            key: 'applied',
            label: `${t('chatVersion.scopeApplied')}${prompt?.applied_count != null ? ` (${prompt.applied_count})` : ''}`,
          },
          {
            key: 'removed',
            label: `${t('chatVersion.scopeRemoved')}${prompt?.removed_count != null ? ` (${prompt.removed_count})` : ''}`,
          },
        ]}
      />
      <ProTable<ChatVersionPromptUser>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        params={{ version: prompt?.version, scope, promptId: prompt?.id }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1200 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          if (!prompt?.version) return { data: [], success: true, total: 0 };
          const qs = new URLSearchParams();
          qs.set('version', prompt.version);
          qs.set('scope', scope);
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(Math.min(200, Number(params.pageSize) || 20)));
          if (typeof params.keyword === 'string' && params.keyword.trim()) {
            qs.set('keyword', params.keyword.trim());
          }
          try {
            const res = await adminFetchJson(`/api/admin/chat-version-prompts/users?${qs.toString()}`);
            const { list, total } = parsePaged<ChatVersionPromptUser>(res);
            return { data: list, success: true, total };
          } catch {
            showError(t('toast.loadFailed') as string);
            return { data: [], success: false, total: 0 };
          }
        }}
        toolBarRender={() => []}
      />
    </Drawer>
  );
}
