import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, List, Switch, Tag, Button, Space, Skeleton, Popconfirm } from 'antd';
import { KeepAliveOutlet, useKeepAliveList } from '../../hooks/useKeepAliveList';
import { EditOutlined, PlusOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import type { ConfigGroup } from '../../types';
import {
  fetchConfigGroupOptions,
  fetchConfigGroups,
  resolveFormSchema,
  type ConfigGroupOptions,
} from './configGroupApi';

function typeColor(type: string) {
  if (type === 'model_service') return 'purple';
  if (type === 'image_generation') return 'orange';
  if (type === 'payment') return 'gold';
  if (type === 'system') return 'magenta';
  if (type === 'agent') return 'cyan';
  return 'default';
}

function canTestGroup(group: ConfigGroup, options: ConfigGroupOptions | null) {
  const layout = resolveFormSchema(group, options).layout;
  return layout === 'agent' || layout === 'model_service' || layout === 'image_generation';
}

export default function SettingsList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource: groups, setDataSource: setGroups, goToChild } =
    useKeepAliveList<ConfigGroup>({
      listPath: '/settings',
      getRowId: (row) => row.id,
      fetchRow: async (id) => adminFetchJson<ConfigGroup>(`/api/admin/config-groups/${id}`),
    });
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<ConfigGroupOptions | null>(null);
  const [testStatuses, setTestStatuses] = useState<Record<number, 'unknown' | 'testing' | 'connected' | 'disconnected'>>({});

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const [list, opts] = await Promise.all([
        fetchConfigGroups(),
        fetchConfigGroupOptions().catch(() => ({} as ConfigGroupOptions)),
      ]);
      setOptions(opts);
      setGroups(list);
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [setGroups, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGroups();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGroups]);

  async function toggleEnabled(group: ConfigGroup, checked: boolean) {
    try {
      const res = await adminFetch(`/api/admin/config-groups/${group.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: checked }),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setGroups((prev) =>
          prev.map((g) => (g.id === group.id ? { ...g, enabled: checked } : g)),
        );
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    }
  }

  async function handleDelete(group: ConfigGroup) {
    try {
      const res = await adminFetch(`/api/admin/config-groups/${group.id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        setGroups((prev) => prev.filter((g) => g.id !== group.id));
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    }
  }

  async function testConnection(group: ConfigGroup) {
    setTestStatuses((prev) => ({ ...prev, [group.id]: 'testing' }));
    try {
      const res = await adminFetchJson<{ ok: boolean; response?: string; error?: string }>(
        `/api/admin/config-groups/${group.id}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (res?.ok) {
        setTestStatuses((prev) => ({ ...prev, [group.id]: 'connected' }));
        showSuccess(`${t('toast.testSuccess')}: ${res.response || ''}`);
      } else {
        setTestStatuses((prev) => ({ ...prev, [group.id]: 'disconnected' }));
        showError(`${t('toast.testFailed')}: ${res?.error || ''}`);
      }
    } catch {
      setTestStatuses((prev) => ({ ...prev, [group.id]: 'disconnected' }));
      showError(t('toast.testError') as string);
    }
  }

  function getConnectionTag(group: ConfigGroup) {
    const status = testStatuses[group.id] || 'unknown';
    if (status === 'connected') return <Tag color="success">{t('settings.statusConnected')}</Tag>;
    if (status === 'disconnected') return <Tag color="error">{t('settings.statusDisconnected')}</Tag>;
    if (status === 'testing') return <Tag color="processing">{t('settings.statusTesting')}</Tag>;
    return <Tag>{t('settings.statusUnknown')}</Tag>;
  }

  function getConfigSummary(group: ConfigGroup) {
    const cfg = group.config_json || {};
    const layout = resolveFormSchema(group, options).layout;
    if (layout === 'single_number') {
      const path = group.key;
      const value = cfg[path];
      return (
        <Tag color="magenta">
          {path}: {value == null ? '—' : String(value)}
        </Tag>
      );
    }
    if (layout === 'cost_grid') {
      return (
        <Space size="small" wrap>
          <Tag>chat: {String(cfg.chat_cost ?? '—')}</Tag>
          <Tag>create: {String(cfg.create_agent_cost ?? '—')}</Tag>
          <Tag>daily: {String(cfg.daily_agent_cost ?? '—')}</Tag>
        </Space>
      );
    }
    if (layout === 'vip_plans') {
      const plans = cfg.plans && typeof cfg.plans === 'object' ? Object.keys(cfg.plans as object).length : 0;
      const packs =
        cfg.recharge_packages && typeof cfg.recharge_packages === 'object'
          ? Object.keys(cfg.recharge_packages as object).length
          : 0;
      return (
        <Space size="small" wrap>
          <Tag color="gold">
            {t('settings.vipPlans')}: {plans}
          </Tag>
          <Tag>
            {t('settings.rechargePackages')}: {packs}
          </Tag>
        </Space>
      );
    }
    if (layout === 'model_service') {
      const provider = (cfg.model_provider as string) || '--';
      const keys: string[] = [];
      if (cfg.google_ready) keys.push('Google');
      if (cfg.deepseek_ready) keys.push('DeepSeek');
      if (cfg.xai_ready) keys.push('xAI');
      if (cfg.openai_ready) keys.push('OpenAI');
      if (cfg.anthropic_ready) keys.push('Anthropic');
      return (
        <Space size="small" wrap>
          <Tag>{provider}</Tag>
          {keys.map((k) => (
            <Tag key={k} color="success">
              {k}
            </Tag>
          ))}
        </Space>
      );
    }
    if (layout === 'agent') {
      return (
        <Space size="small" wrap>
          <Tag color="blue">Temp: {(cfg.temperature as number) ?? 0.93}</Tag>
          <Tag color="blue">Max: {(cfg.max_tokens as number) ?? 2048}</Tag>
          <Tag>{(cfg.model_provider as string) || t('settings.followSystem')}</Tag>
        </Space>
      );
    }
    if (layout === 'image_generation') {
      return (
        <Space size="small" wrap>
          <Tag color="orange">{(cfg.provider as string) || '--'}</Tag>
          <Tag>{(cfg.model as string) || '--'}</Tag>
        </Space>
      );
    }
    return <Tag>{layout || 'json'}</Tag>;
  }

  return (
    <div>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{t('page.settings')}</h2>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/settings/new')}>
            {t('settings.newConfig')}
          </Button>
        </div>

        <Card style={{ marginTop: 16 }}>
          {loading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
            <List
              dataSource={groups}
              locale={{ emptyText: t('empty.data') as string }}
              renderItem={(group) => (
                <List.Item
                  actions={[
                    <Switch
                      key="enable"
                      checked={group.enabled}
                      onChange={(checked) => toggleEnabled(group, checked)}
                      checkedChildren={t('yes')}
                      unCheckedChildren={t('no')}
                    />,
                    ...(canTestGroup(group, options)
                      ? [
                          <Button
                            key="test"
                            icon={<ApiOutlined />}
                            onClick={() => testConnection(group)}
                            loading={testStatuses[group.id] === 'testing'}
                          >
                            {t('settings.testConnectionBtn')}
                          </Button>,
                        ]
                      : []),
                    <Button
                      key="edit"
                      type="primary"
                      icon={<EditOutlined />}
                      onClick={() => goToChild(`/settings/${group.id}/edit`)}
                    >
                      {t('btn.edit')}
                    </Button>,
                    <Popconfirm
                      key="delete"
                      title={t('settings.deleteConfirm')}
                      onConfirm={() => handleDelete(group)}
                      okText={t('yes')}
                      cancelText={t('no')}
                    >
                      <Button danger icon={<DeleteOutlined />}>
                        {t('btn.delete')}
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        <span>{group.name}</span>
                        <Tag color={typeColor(group.config_type)}>{group.config_type}</Tag>
                        <Tag>{group.key}</Tag>
                        {group.enabled ? (
                          <Tag color="success">{t('settings.enabled')}</Tag>
                        ) : (
                          <Tag>{t('settings.disabled')}</Tag>
                        )}
                        {canTestGroup(group, options) && getConnectionTag(group)}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <span style={{ color: '#888' }}>
                          {group.key === 'free_turns_limit'
                            ? (t('settings.freeTurnsLimit') as string)
                            : group.description}
                        </span>
                        <div style={{ marginTop: 4 }}>{getConfigSummary(group)}</div>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
