import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import type { MsgStrategyMeta, MsgStrategyRule } from '../../types';
import { loadMsgStrategyMeta, parsePaged, parseScopeValue, patchActive, triggerLabel } from './api';
import {
  ActiveTag,
  scopeTypeLabel,
  SenderModeTag,
  serializeUserScope,
  UserScopeFormItems,
  UserScopeTagsCell,
  useScopeOptions,
} from './shared';

export default function RulesList() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<MsgStrategyMeta | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MsgStrategyRule | null>(null);
  const { options: scopeOptions, loading: scopeLoading, reload: reloadScopeOptions } = useScopeOptions();

  const reloadMeta = useCallback(async () => {
    const next = await loadMsgStrategyMeta();
    setMeta(next);
    return next;
  }, []);

  useEffect(() => {
    void reloadMeta();
  }, [reloadMeta]);

  const triggers = meta?.triggers || [];

  const handleToggle = useCallback(
    async (row: MsgStrategyRule, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/msg-strategy/rules/${row.id}/active`, isActive);
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          actionRef.current?.reload();
        } else {
          showError(t('toast.loadFailed') as string);
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [t],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        const res = await adminFetch(`/api/admin/msg-strategy/rules/${id}`, { method: 'DELETE' });
        if (res && res.ok) {
          showSuccess(t('toast.deleteSuccess') as string);
          actionRef.current?.reload();
        } else {
          showError(t('toast.loadFailed') as string);
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [t],
  );

  const columns: ProColumns<MsgStrategyRule>[] = useMemo(() => {
    const triggerCols: ProColumns<MsgStrategyRule>[] = triggers.map((item) => ({
      title: (
        <Space size={4} wrap>
          <span>{triggerLabel(item)}</span>
          <SenderModeTag mode={item.sender_mode} />
        </Space>
      ),
      dataIndex: ['triggers', item.trigger_key],
      key: item.trigger_key,
      search: false,
      width: 160,
      ellipsis: true,
      render: (_: unknown, row: MsgStrategyRule) => {
        const n = row.triggers?.[item.trigger_key];
        return n == null || n === 0 ? '—' : n;
      },
    }));
    return [
      {
        title: t('content.serialNo'),
        dataIndex: 'id',
        width: 80,
        search: false,
        render: (_: unknown, __: MsgStrategyRule, index: number) => index + 1,
      },
      {
        title: t('msgStrategy.strategyName'),
        dataIndex: 'name',
        ellipsis: true,
        width: 160,
      },
      {
        title: t('msgStrategy.userScope'),
        dataIndex: 'user_scope_type',
        search: false,
        width: 140,
        render: (_: unknown, row: MsgStrategyRule) => scopeTypeLabel(row.user_scope_type, t),
      },
      {
        title: t('msgStrategy.userScopeValue'),
        dataIndex: 'user_scope_value',
        search: false,
        width: 280,
        render: (_: unknown, row: MsgStrategyRule) => (
          <UserScopeTagsCell
            type={row.user_scope_type}
            value={row.user_scope_value}
            ads={scopeOptions.ads}
            attr={scopeOptions.attr}
          />
        ),
      },
      ...triggerCols,
      {
        title: t('msgStrategy.priority'),
        dataIndex: 'priority',
        search: false,
        width: 90,
      },
      {
        title: t('table.status'),
        dataIndex: 'is_active',
        width: 100,
        valueType: 'select',
        valueEnum: {
          true: { text: t('content.active') },
          false: { text: t('content.inactive') },
        },
        render: (_: unknown, row: MsgStrategyRule) => <ActiveTag active={row.is_active} />,
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        search: false,
        render: (_: unknown, row: MsgStrategyRule) => (
          <Space>
            <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                void reloadScopeOptions();
                void reloadMeta();
                setEditing(row);
                form.setFieldsValue({
                  name: row.name,
                  user_scope_type: row.user_scope_type || 'all',
                  user_scope_value: parseScopeValue(row.user_scope_value),
                  triggers: row.triggers || {},
                  priority: row.priority ?? 0,
                  is_active: row.is_active !== false,
                });
                setOpen(true);
              }}
            >
              {t('btn.edit')}
            </Button>
            <Popconfirm
              title={t('msgStrategy.confirmDelete')}
              onConfirm={() => handleDelete(row.id)}
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
  }, [form, handleDelete, handleToggle, reloadMeta, reloadScopeOptions, scopeOptions.ads, scopeOptions.attr, t, triggers]);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const triggerValues = (values.triggers || {}) as Record<string, number | null | undefined>;
      const triggersPayload: Record<string, number> = {};
      Object.entries(triggerValues).forEach(([key, val]) => {
        if (val != null && val !== ('' as unknown) && Number(val) > 0) {
          triggersPayload[key] = Number(val);
        }
      });
      const body = {
        name: values.name,
        ...serializeUserScope(values.user_scope_type, values.user_scope_value),
        triggers: triggersPayload,
        priority: values.priority ?? 0,
        is_active: values.is_active !== false,
      };
      const url = editing ? `/api/admin/msg-strategy/rules/${editing.id}` : '/api/admin/msg-strategy/rules';
      const res = await adminFetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setOpen(false);
        setEditing(null);
        form.resetFields();
        actionRef.current?.reload();
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>{t('page.msgStrategyRules')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>
        {t('msgStrategy.rulesHint')} {t('msgStrategy.rulesHintExtra')}
      </p>
      <ProTable<MsgStrategyRule>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1960 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(params.pageSize || 10));
          if (typeof params.name === 'string' && params.name) qs.set('keyword', params.name);
          if (params.is_active === true || params.is_active === false || typeof params.is_active === 'string') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/msg-strategy/rules?${qs.toString()}`);
            const { list, total } = parsePaged<MsgStrategyRule>(res);
            return { data: list, success: true, total };
          } catch {
            showError(t('toast.loadFailed') as string);
            return { data: [], success: false, total: 0 };
          }
        }}
        toolBarRender={() => [
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              void reloadScopeOptions();
              void reloadMeta();
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({
                user_scope_type: 'all',
                user_scope_value: [],
                is_active: true,
                priority: 0,
                triggers: {},
              });
              setOpen(true);
            }}
          >
            {t('btn.new')}
          </Button>,
        ]}
      />
      <Modal
        title={editing ? t('btn.edit') : t('btn.new')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('msgStrategy.strategyName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <UserScopeFormItems form={form} ads={scopeOptions.ads} attr={scopeOptions.attr} loading={scopeLoading} />
          {triggers.map((item) => (
            <Form.Item
              key={item.trigger_key}
              name={['triggers', item.trigger_key]}
              label={
                <Space size={6}>
                  <span>{triggerLabel(item)}</span>
                  <SenderModeTag mode={item.sender_mode} />
                </Space>
              }
            >
              <InputNumber min={0} style={{ width: '100%' }} placeholder={t('msgStrategy.triggerCountHint') as string} />
            </Form.Item>
          ))}
          <Form.Item name="priority" label={t('msgStrategy.priority')} extra={t('msgStrategy.priorityHint')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('content.isActive')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
