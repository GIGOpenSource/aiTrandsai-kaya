import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import type { MsgStrategyGlobal } from '../../types';
import { parsePaged, parseScopeValue, patchActive } from './api';
import { ActiveTag, scopeTypeLabel, serializeUserScope, UserScopeFormItems, UserScopeTagsCell, useScopeOptions } from './shared';

const INTERVAL_SEC_MIN = 15;
const INTERVAL_SEC_MAX = 45;

export default function GlobalsList() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MsgStrategyGlobal | null>(null);
  const { options: scopeOptions, loading: scopeLoading, reload: reloadScopeOptions } = useScopeOptions();

  const handleToggle = useCallback(
    async (row: MsgStrategyGlobal, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/msg-strategy/globals/${row.id}/active`, isActive);
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
        const res = await adminFetch(`/api/admin/msg-strategy/globals/${id}`, { method: 'DELETE' });
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

  const columns: ProColumns<MsgStrategyGlobal>[] = [
    {
      title: t('content.serialNo'),
      dataIndex: 'id',
      width: 80,
      search: false,
      render: (_: unknown, __: MsgStrategyGlobal, index: number) => index + 1,
    },
    {
      title: t('msgStrategy.ruleName'),
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: t('msgStrategy.userScope'),
      dataIndex: 'user_scope_type',
      search: false,
      width: 140,
      render: (_: unknown, row: MsgStrategyGlobal) => scopeTypeLabel(row.user_scope_type, t),
    },
    {
      title: t('msgStrategy.userScopeValue'),
      dataIndex: 'user_scope_value',
      search: false,
      width: 280,
      render: (_: unknown, row: MsgStrategyGlobal) => (
        <UserScopeTagsCell
          type={row.user_scope_type}
          value={row.user_scope_value}
          ads={scopeOptions.ads}
          attr={scopeOptions.attr}
        />
      ),
    },
    {
      title: t('msgStrategy.fatigue'),
      key: 'fatigue',
      search: false,
      width: 160,
      render: (_: unknown, row: MsgStrategyGlobal) =>
        `${row.fatigue_window_hours ?? '-'}h / ${row.fatigue_max_unreplied ?? '-'}`,
    },
    {
      title: t('msgStrategy.dailyLimit'),
      dataIndex: 'daily_limit',
      search: false,
      width: 100,
    },
    {
      title: t('msgStrategy.interval'),
      key: 'interval',
      search: false,
      width: 120,
      render: (_: unknown, row: MsgStrategyGlobal) => {
        const min = row.interval_min_sec;
        const max = row.interval_max_sec;
        if (min == null && max == null) return '—';
        if (min != null && max != null && min !== max) return `${min}–${max}s`;
        return `${min ?? max}s`;
      },
    },
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
      render: (_: unknown, row: MsgStrategyGlobal) => <ActiveTag active={row.is_active} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 220,
      fixed: 'right',
      search: false,
      render: (_: unknown, row: MsgStrategyGlobal) => (
        <Space>
          <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => {
              void reloadScopeOptions();
              setEditing(row);
              form.setFieldsValue({
                name: row.name,
                user_scope_type: row.user_scope_type || 'all',
                user_scope_value: parseScopeValue(row.user_scope_value),
                fatigue_window_hours: row.fatigue_window_hours,
                fatigue_max_unreplied: row.fatigue_max_unreplied,
                daily_limit: row.daily_limit,
                interval_min_sec: row.interval_min_sec,
                interval_max_sec: row.interval_max_sec,
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

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        ...values,
        ...serializeUserScope(values.user_scope_type, values.user_scope_value),
      };
      const url = editing
        ? `/api/admin/msg-strategy/globals/${editing.id}`
        : '/api/admin/msg-strategy/globals';
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
      <h2>{t('page.msgStrategyGlobals')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('msgStrategy.globalsHint')}</p>
      <ProTable<MsgStrategyGlobal>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1400 }}
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
            const res = await adminFetchJson(`/api/admin/msg-strategy/globals?${qs.toString()}`);
            const { list, total } = parsePaged<MsgStrategyGlobal>(res);
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
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({
                user_scope_type: 'all',
                user_scope_value: [],
                is_active: true,
                priority: 0,
                daily_limit: 0,
                interval_min_sec: INTERVAL_SEC_MIN,
                interval_max_sec: INTERVAL_SEC_MAX,
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
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('msgStrategy.ruleName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <UserScopeFormItems form={form} ads={scopeOptions.ads} attr={scopeOptions.attr} loading={scopeLoading} />
          <Form.Item name="fatigue_window_hours" label={t('msgStrategy.fatigueWindow')} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="fatigue_max_unreplied" label={t('msgStrategy.fatigueMax')} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="daily_limit"
            label={t('msgStrategy.dailyLimit')}
            rules={[{ required: true }]}
          >
            <InputNumber precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="interval_min_sec"
            label={t('msgStrategy.intervalMin')}
            extra={t('msgStrategy.intervalHint')}
            rules={[
              { required: true },
              {
                type: 'number',
                min: INTERVAL_SEC_MIN,
                max: INTERVAL_SEC_MAX,
                message: t('msgStrategy.intervalBound') as string,
              },
            ]}
          >
            <InputNumber
              min={INTERVAL_SEC_MIN}
              max={INTERVAL_SEC_MAX}
              precision={0}
              style={{ width: '100%' }}
              onChange={() => {
                void form.validateFields(['interval_max_sec']);
              }}
            />
          </Form.Item>
          <Form.Item
            name="interval_max_sec"
            label={t('msgStrategy.intervalMax')}
            dependencies={['interval_min_sec']}
            rules={[
              { required: true },
              {
                type: 'number',
                min: INTERVAL_SEC_MIN,
                max: INTERVAL_SEC_MAX,
                message: t('msgStrategy.intervalBound') as string,
              },
              {
                validator: async (_, value) => {
                  const min = form.getFieldValue('interval_min_sec');
                  if (value != null && min != null && Number(value) < Number(min)) {
                    throw new Error(t('msgStrategy.intervalRangeInvalid') as string);
                  }
                },
              },
            ]}
          >
            <InputNumber min={INTERVAL_SEC_MIN} max={INTERVAL_SEC_MAX} precision={0} style={{ width: '100%' }} />
          </Form.Item>
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
