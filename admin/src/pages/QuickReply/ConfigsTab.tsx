import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import type { QuickReplyConfigItem } from '../../types';
import CompanionSearchSelect from '../Moments/CompanionSearchSelect';
import { parsePaged, patchActive } from '../MsgStrategy/api';
import { ActiveTag } from '../MsgStrategy/shared';

export default function ConfigsTab() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<QuickReplyConfigItem | null>(null);
  const [extraCompanionOptions, setExtraCompanionOptions] = useState<{ value: string; label: string }[]>([]);

  const handleToggle = useCallback(
    async (row: QuickReplyConfigItem, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/quick-reply/configs/${row.id}/active`, isActive);
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
        const res = await adminFetch(`/api/admin/quick-reply/configs/${id}`, { method: 'DELETE' });
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

  const columns: ProColumns<QuickReplyConfigItem>[] = useMemo(
    () => [
      {
        title: t('content.serialNo'),
        dataIndex: 'id',
        width: 70,
        search: false,
        render: (_: unknown, __: QuickReplyConfigItem, index: number) => index + 1,
      },
      {
        title: t('quickReply.configName'),
        dataIndex: 'name',
        width: 180,
        ellipsis: true,
        fieldProps: { placeholder: t('quickReply.configName'), allowClear: true },
        render: (_: unknown, row: QuickReplyConfigItem) => row.name || '—',
      },
      {
        title: t('quickReply.companionId'),
        dataIndex: 'companion_id',
        width: 240,
        fieldProps: { placeholder: t('msgStrategy.companionIdsPlaceholder'), allowClear: true },
        render: (_: unknown, row: QuickReplyConfigItem) =>
          row.companion_name
            ? `${row.companion_name} (${row.companion_id})`
            : row.companion_id || '—',
      },
      {
        title: t('msgStrategy.priority'),
        dataIndex: 'priority',
        width: 90,
        search: false,
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
        render: (_: unknown, row: QuickReplyConfigItem) => <ActiveTag active={row.is_active} />,
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        search: false,
        render: (_: unknown, row: QuickReplyConfigItem) => (
          <Space>
            <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(row);
                setExtraCompanionOptions(
                  row.companion_id
                    ? [
                        {
                          value: row.companion_id,
                          label: row.companion_name
                            ? `${row.companion_name} (${row.companion_id})`
                            : row.companion_id,
                        },
                      ]
                    : [],
                );
                form.setFieldsValue({
                  companion_id: row.companion_id,
                  name: row.name,
                  priority: row.priority ?? 0,
                  is_active: row.is_active !== false,
                });
                setOpen(true);
              }}
            >
              {t('btn.edit')}
            </Button>
            <Popconfirm
              title={t('quickReply.confirmDelete')}
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
    ],
    [form, handleDelete, handleToggle, t],
  );

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: values.name || '',
        priority: values.priority ?? 0,
        is_active: values.is_active !== false,
      };
      if (!editing) {
        body.companion_id = values.companion_id;
      }
      const url = editing
        ? `/api/admin/quick-reply/configs/${editing.id}`
        : '/api/admin/quick-reply/configs';
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
    <>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('quickReply.configsHint')}</p>
      <ProTable<QuickReplyConfigItem>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1000 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(params.pageSize || 10));
          if (typeof params.name === 'string' && params.name) qs.set('keyword', params.name);
          if (typeof params.companion_id === 'string' && params.companion_id) qs.set('companion_id', params.companion_id);
          if (params.is_active === true || params.is_active === false || typeof params.is_active === 'string') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/quick-reply/configs?${qs.toString()}`);
            const { list, total } = parsePaged<QuickReplyConfigItem>(res);
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
              setEditing(null);
              setExtraCompanionOptions([]);
              form.resetFields();
              form.setFieldsValue({ is_active: true, priority: 0 });
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
        width={480}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="companion_id"
            label={t('quickReply.companionId')}
            rules={editing ? undefined : [{ required: true }]}
            extra={editing ? t('quickReply.companionIdHint') : undefined}
          >
            <CompanionSearchSelect
              disabled={!!editing}
              extraOptions={extraCompanionOptions}
              placeholder={t('msgStrategy.companionIdsPlaceholder') as string}
            />
          </Form.Item>
          <Form.Item name="name" label={t('quickReply.configName')}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="priority" label={t('msgStrategy.priority')} extra={t('msgStrategy.priorityHint')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('content.isActive')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
