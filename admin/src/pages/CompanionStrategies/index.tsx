import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Avatar, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, formatDate, showError, showSuccess } from '../../api/request';
import { getAppLanguage } from '../../locales';
import type { CompanionStrategy, ProductEvent } from '../../types';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import {
  CONTENT_LANGS,
  eventLabel,
  normalizeLangOptions,
  normalizeProductEvents,
  parsePaged,
} from '../Companions/contentApi';
import CompanionSearchSelect from '../Moments/CompanionSearchSelect';
import { ActiveTag } from '../MsgStrategy/shared';
import { patchActive } from '../MsgStrategy/api';
import StrategyImageField, { StrategyImageThumb } from '../MsgStrategy/StrategyImageField';

const { Text } = Typography;

export default function CompanionStrategiesList() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CompanionStrategy | null>(null);
  const [events, setEvents] = useState<ProductEvent[]>([]);
  const [langOptions, setLangOptions] = useState(CONTENT_LANGS);
  const [extraCompanionOptions, setExtraCompanionOptions] = useState<{ value: string; label: string }[]>([]);

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

  const eventOptions = useMemo(
    () => events.map((ev) => ({ value: ev.event_key, label: eventLabel(ev) })),
    [events],
  );

  const eventEnum = useMemo(() => {
    const map: Record<string, { text: string }> = {};
    events.forEach((ev) => {
      map[ev.event_key] = { text: eventLabel(ev) };
    });
    return map;
  }, [events]);

  const handleToggle = useCallback(
    async (row: CompanionStrategy, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/companion-strategies/${row.id}/active`, isActive);
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
    async (id: number | string) => {
      try {
        const res = await adminFetch(`/api/admin/companion-strategies/${id}`, { method: 'DELETE' });
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

  const columns: ProColumns<CompanionStrategy>[] = useMemo(
    () => [
      {
        title: t('table.id'),
        dataIndex: 'id',
        width: 72,
        search: false,
      },
      {
        title: t('companionStrategies.companion'),
        dataIndex: 'companion_id',
        width: 220,
        fieldProps: { placeholder: t('msgStrategy.companionIdsPlaceholder'), allowClear: true },
        renderFormItem: () => (
          <CompanionSearchSelect allowClear placeholder={t('msgStrategy.companionIdsPlaceholder') as string} />
        ),
        render: (_: unknown, row: CompanionStrategy) => {
          const name = row.companion_name || row.companion_id || '—';
          const avatar = row.companion_avatar ? resolveAdminMediaUrl(row.companion_avatar) : undefined;
          return (
            <Space>
              <Avatar size={28} src={avatar}>
                {(row.companion_name || row.companion_id || '?').slice(0, 1)}
              </Avatar>
              <div style={{ minWidth: 0 }}>
                <div>{name}</div>
                {row.companion_id ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {row.companion_id}
                  </Text>
                ) : null}
              </div>
            </Space>
          );
        },
      },
      {
        title: t('companionStrategies.companionName'),
        dataIndex: 'companion_name',
        hideInTable: true,
        fieldProps: { placeholder: t('companionStrategies.companionName'), allowClear: true },
      },
      {
        title: t('companionStrategies.triggerEvent'),
        dataIndex: 'trigger_event',
        width: 180,
        valueType: 'select',
        valueEnum: eventEnum,
        fieldProps: { options: eventOptions, allowClear: true, showSearch: true, optionFilterProp: 'label' },
        render: (_: unknown, row: CompanionStrategy) => {
          const key = row.trigger_event || row.strategy_type || '';
          return row.trigger_event_name || eventEnum[key]?.text || key || '—';
        },
      },
      {
        title: t('content.strategyContent'),
        dataIndex: 'content',
        width: 280,
        ellipsis: { showTitle: false },
        fieldProps: { placeholder: t('companionStrategies.keyword'), allowClear: true },
        render: (_: unknown, row: CompanionStrategy) => (
          <Tooltip placement="topLeft" title={row.content}>
            {row.content || '—'}
          </Tooltip>
        ),
      },
      {
        title: t('table.image'),
        dataIndex: 'image_url',
        width: 80,
        search: false,
        render: (_: unknown, row: CompanionStrategy) => <StrategyImageThumb url={row.image_url} />,
      },
      {
        title: t('table.language'),
        dataIndex: 'language',
        width: 100,
        valueType: 'select',
        fieldProps: { options: langOptions, allowClear: true },
      },
      {
        title: t('companionStrategies.sortOrder'),
        dataIndex: 'sort_order',
        width: 80,
        search: false,
        render: (_: unknown, row: CompanionStrategy) => row.sort_order ?? 0,
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
        render: (_: unknown, row: CompanionStrategy) => <ActiveTag active={row.is_active} />,
      },
      {
        title: t('table.updatedAt'),
        dataIndex: 'updated_at',
        width: 160,
        search: false,
        render: (_: unknown, row: CompanionStrategy) =>
          row.updated_at ? formatDate(row.updated_at, locale) : '—',
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        search: false,
        render: (_: unknown, row: CompanionStrategy) => (
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
              <Button type="link" danger icon={<DeleteOutlined />}>
                {t('btn.delete')}
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [eventEnum, eventOptions, form, handleDelete, handleToggle, langOptions, locale, t],
  );

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        companion_id: values.companion_id,
        trigger_event: values.trigger_event,
        language: values.language,
        content: values.content,
        image_url: String(values.image_url || ''),
        sort_order: values.sort_order ?? 0,
        is_active: values.is_active !== false,
      };
      const url = editing
        ? `/api/admin/companion-strategies/${editing.id}`
        : '/api/admin/companion-strategies';
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
      <h2>{t('page.companionStrategies')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('companionStrategies.hint')}</p>
      <ProTable<CompanionStrategy>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1600 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(params.pageSize || 10));
          if (typeof params.companion_id === 'string' && params.companion_id) qs.set('companion_id', params.companion_id);
          if (typeof params.companion_name === 'string' && params.companion_name) {
            qs.set('companion_name', params.companion_name);
          }
          if (typeof params.language === 'string' && params.language) qs.set('language', params.language);
          if (typeof params.trigger_event === 'string' && params.trigger_event) {
            qs.set('trigger_event', params.trigger_event);
          }
          if (typeof params.content === 'string' && params.content) qs.set('keyword', params.content);
          if (params.is_active === true || params.is_active === false || typeof params.is_active === 'string') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/companion-strategies?${qs.toString()}`);
            const { list, total } = parsePaged<CompanionStrategy>(res);
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
          <Form.Item
            name="companion_id"
            label={t('companionStrategies.companion')}
            rules={[{ required: true }]}
          >
            <CompanionSearchSelect
              extraOptions={extraCompanionOptions}
              placeholder={t('msgStrategy.companionIdsPlaceholder') as string}
            />
          </Form.Item>
          <Form.Item
            name="trigger_event"
            label={t('companionStrategies.triggerEvent')}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={eventOptions}
              placeholder={t('companionStrategies.triggerEvent') as string}
            />
          </Form.Item>
          <Form.Item name="language" label={t('table.language')} rules={[{ required: true }]}>
            <Select options={langOptions} />
          </Form.Item>
          <Form.Item name="content" label={t('content.strategyContent')} rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="image_url" label={t('table.image')} extra={t('strategy.imageHint')}>
            <StrategyImageField />
          </Form.Item>
          <Form.Item
            name="sort_order"
            label={t('companionStrategies.sortOrder')}
            extra={t('companionStrategies.sortOrderHint')}
          >
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
