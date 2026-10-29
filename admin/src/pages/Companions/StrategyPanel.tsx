import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import type { ContentStrategy, ProductEvent } from '../../types';
import { CONTENT_LANGS, eventLabel, normalizeLangOptions, normalizeProductEvents, parsePaged } from './contentApi';
import StrategyImageField, { StrategyImageThumb } from '../MsgStrategy/StrategyImageField';

export default function StrategyPanel({ companionId }: { companionId: string }) {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ContentStrategy | null>(null);
  const [events, setEvents] = useState<ProductEvent[]>([]);
  const [langOptions, setLangOptions] = useState(CONTENT_LANGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [evRes, langRes] = await Promise.all([
          adminFetchJson('/api/admin/content/strategy-types'),
          adminFetchJson('/api/admin/content/languages'),
        ]);
        if (cancelled) return;
        setEvents(normalizeProductEvents(evRes));
        setLangOptions(normalizeLangOptions(langRes));
      } catch {
        /* fallback constants */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const eventEnum = useMemo(() => {
    const map: Record<string, { text: string }> = {};
    events.forEach((ev) => {
      map[ev.event_key] = { text: eventLabel(ev) };
    });
    return map;
  }, [events]);

  const handleToggle = useCallback(
    async (row: ContentStrategy, isActive: boolean) => {
      try {
        const res = await adminFetch(
          `/api/admin/content/companions/${companionId}/strategies/${row.id}/active`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: isActive }),
          },
        );
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
    [companionId, t],
  );

  const handleDelete = useCallback(
    async (id: number | string) => {
      try {
        const res = await adminFetch(
          `/api/admin/content/companions/${companionId}/strategies/${id}`,
          { method: 'DELETE' },
        );
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
    [companionId, t],
  );

  const columns: ProColumns<ContentStrategy>[] = [
    {
      title: t('content.serialNo'),
      dataIndex: 'sort_order',
      width: 80,
      search: false,
      render: (_: unknown, __: ContentStrategy, index: number) => index + 1,
    },
    {
      title: t('content.strategyContent'),
      dataIndex: 'content',
      ellipsis: true,
      search: false,
    },
    {
      title: t('table.image'),
      dataIndex: 'image_url',
      width: 80,
      search: false,
      render: (_: unknown, row: ContentStrategy) => <StrategyImageThumb url={row.image_url} />,
    },
    {
      title: t('table.language'),
      dataIndex: 'language',
      width: 120,
      valueType: 'select',
      fieldProps: { options: langOptions },
    },
    {
      title: t('content.triggerEvent'),
      dataIndex: 'trigger_event',
      width: 200,
      valueType: 'select',
      valueEnum: eventEnum,
      render: (_: unknown, row: ContentStrategy) => {
        const key = row.trigger_event || row.strategy_type || '';
        const ev = events.find((e) => e.event_key === key);
        return ev ? eventLabel(ev) : key || '-';
      },
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
      render: (_: unknown, row: ContentStrategy) => (
        <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
      ),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 148,
      fixed: 'right',
      search: false,
      render: (_: unknown, row: ContentStrategy) => (
        <Space size={0} wrap={false}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(row);
              form.setFieldsValue({
                content: row.content,
                image_url: row.image_url || '',
                language: row.language,
                trigger_event: row.trigger_event || row.strategy_type,
                is_active: row.is_active !== false,
                sort_order: row.sort_order ?? 0,
              });
              setOpen(true);
            }}
          >
            {t('btn.edit')}
          </Button>
          <Popconfirm
            title={t('content.confirmDeleteStrategy')}
            onConfirm={() => handleDelete(row.id)}
            okText={t('btn.delete')}
            cancelText={t('btn.cancel')}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
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
      const url = editing
        ? `/api/admin/content/companions/${companionId}/strategies/${editing.id}`
        : `/api/admin/content/companions/${companionId}/strategies`;
      const res = await adminFetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, image_url: String(values.image_url || '') }),
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
      <ProTable<ContentStrategy>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        tableLayout="fixed"
        scroll={{ x: 1000 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        params={{ companionId }}
        request={async (params) => {
          const page = Math.max(1, Number(params.current) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
          const qs = new URLSearchParams({
            page: String(page),
            page_size: String(pageSize),
          });
          if (typeof params.language === 'string' && params.language) qs.set('language', params.language);
          if (typeof params.trigger_event === 'string' && params.trigger_event) qs.set('trigger_event', params.trigger_event);
          if (params.is_active === true || params.is_active === false || typeof params.is_active === 'string') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/content/companions/${companionId}/strategies?${qs.toString()}`);
            const { list, total } = parsePaged<ContentStrategy>(res);
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
              form.resetFields();
              form.setFieldsValue({ language: 'zh', is_active: true, sort_order: 0, image_url: '' });
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
          <Form.Item name="content" label={t('content.strategyContent')} rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="image_url" label={t('table.image')} extra={t('strategy.imageHint')}>
            <StrategyImageField />
          </Form.Item>
          <Form.Item name="language" label={t('table.language')} rules={[{ required: true }]}>
            <Select options={langOptions} />
          </Form.Item>
          <Form.Item name="trigger_event" label={t('content.triggerEvent')} rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={events.map((ev) => ({ value: ev.event_key, label: eventLabel(ev) }))}
            />
          </Form.Item>
          <Form.Item name="sort_order" label={t('content.serialNo')}>
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
