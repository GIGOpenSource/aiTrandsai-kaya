import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import type { MsgStrategyLibraryItem, MsgStrategyLibraryType, MsgStrategyMeta } from '../../types';
import { CONTENT_LANGS, normalizeLangOptions } from '../Companions/contentApi';
import {
  libraryTypeLabel,
  loadMsgStrategyMeta,
  parsePaged,
  patchActive,
  toLibraryTypeSelectOptions,
} from './api';
import { ActiveTag, senderModeExtra, SenderModeTag, TypeKeySelect } from './shared';

export default function LibraryList() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<MsgStrategyMeta | null>(null);
  const [langOptions, setLangOptions] = useState(CONTENT_LANGS);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MsgStrategyLibraryItem | null>(null);
  const typeKeyWatch = Form.useWatch('type_key', form);

  /** 展示用接口返回的 label（如 العربية（ar））；只提交 value 短码 */
  const languageLabel = useCallback(
    (code?: string) => {
      if (!code) return '—';
      return langOptions.find((item) => item.value === code)?.label || code;
    },
    [langOptions],
  );

  const reloadMeta = useCallback(async () => {
    const next = await loadMsgStrategyMeta();
    setMeta(next);
    return next;
  }, []);

  const reloadLanguages = useCallback(async () => {
    try {
      const [metaNext, langRes] = await Promise.all([
        loadMsgStrategyMeta(),
        adminFetchJson('/api/admin/content/languages').catch(() => null),
      ]);
      setMeta(metaNext);
      const fromMeta = metaNext.languages?.length ? metaNext.languages : [];
      const fromApi = langRes ? normalizeLangOptions(langRes) : [];
      // meta.language_options / languages 与 content/languages 等价；有则优先用接口 label
      const map = new Map<string, { value: string; label: string }>();
      fromApi.forEach((item) => {
        if (item.value) map.set(item.value, item);
      });
      fromMeta.forEach((item) => {
        if (item.value) map.set(item.value, item);
      });
      setLangOptions(map.size ? [...map.values()] : CONTENT_LANGS);
    } catch {
      try {
        const metaNext = await loadMsgStrategyMeta();
        setMeta(metaNext);
        if (metaNext.languages?.length) setLangOptions(metaNext.languages);
      } catch {
        /* keep current */
      }
    }
  }, []);

  useEffect(() => {
    void reloadLanguages();
    // 仅挂载拉取；打开弹窗时再刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const libraryTypes: MsgStrategyLibraryType[] = meta?.library_types || [];

  const typeOptions = useMemo(() => toLibraryTypeSelectOptions(libraryTypes), [libraryTypes]);

  const typeMap = useMemo(() => {
    const map: Record<string, MsgStrategyLibraryType> = {};
    libraryTypes.forEach((item) => {
      map[item.type_key] = item;
    });
    return map;
  }, [libraryTypes]);

  const selectedType = typeKeyWatch ? typeMap[String(typeKeyWatch)] : undefined;

  const openModal = useCallback(
    async (row?: MsgStrategyLibraryItem | null) => {
      await reloadLanguages();
      if (row) {
        setEditing(row);
        form.setFieldsValue({
          content: row.content,
          language: row.language,
          type_key: row.type_key,
          is_active: row.is_active !== false,
          sort_order: row.sort_order ?? 0,
        });
      } else {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ language: 'zh', is_active: true, sort_order: 0 });
      }
      setOpen(true);
    },
    [form, reloadLanguages],
  );

  const handleToggle = useCallback(
    async (row: MsgStrategyLibraryItem, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/msg-strategy/library/${row.id}/active`, isActive);
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
        const res = await adminFetch(`/api/admin/msg-strategy/library/${id}`, { method: 'DELETE' });
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

  const columns: ProColumns<MsgStrategyLibraryItem>[] = [
    {
      title: t('content.serialNo'),
      dataIndex: 'id',
      width: 80,
      search: false,
      render: (_: unknown, __: MsgStrategyLibraryItem, index: number) => index + 1,
    },
    {
      title: t('content.strategyContent'),
      dataIndex: 'content',
      width: 420,
      ellipsis: { showTitle: false },
      render: (_: unknown, row: MsgStrategyLibraryItem) => (
        <Tooltip placement="topLeft" title={row.content}>
          {row.content || '—'}
        </Tooltip>
      ),
    },
    {
      title: t('table.language'),
      dataIndex: 'language',
      width: 140,
      valueType: 'select',
      fieldProps: { options: langOptions, allowClear: true, showSearch: true, optionFilterProp: 'label' },
      render: (_: unknown, row: MsgStrategyLibraryItem) => languageLabel(row.language),
    },
    {
      title: t('content.triggerEvent'),
      dataIndex: 'type_key',
      width: 360,
      valueType: 'select',
      fieldProps: { options: typeOptions, allowClear: true, showSearch: true, optionFilterProp: 'label' },
      render: (_: unknown, row: MsgStrategyLibraryItem) => {
        const hit = typeMap[row.type_key || ''];
        const label = hit ? libraryTypeLabel(hit) : row.type_key || '—';
        return (
          <Space size={6} wrap>
            <span>{label}</span>
            {hit ? <SenderModeTag mode={hit.sender_mode} /> : null}
          </Space>
        );
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
      render: (_: unknown, row: MsgStrategyLibraryItem) => <ActiveTag active={row.is_active} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 220,
      fixed: 'right',
      search: false,
      render: (_: unknown, row: MsgStrategyLibraryItem) => (
        <Space>
          <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
          <Button type="link" icon={<EditOutlined />} onClick={() => void openModal(row)}>
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
        content: values.content,
        language: values.language,
        type_key: values.type_key,
        is_active: values.is_active !== false,
        sort_order: values.sort_order ?? 0,
      };
      const url = editing
        ? `/api/admin/msg-strategy/library/${editing.id}`
        : '/api/admin/msg-strategy/library';
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
      <h2>{t('page.msgStrategyLibrary')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('msgStrategy.libraryHint')}</p>
      <ProTable<MsgStrategyLibraryItem>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1300 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(params.pageSize || 10));
          qs.set('scope', 'global');
          if (typeof params.content === 'string' && params.content) qs.set('keyword', params.content);
          if (typeof params.language === 'string' && params.language) qs.set('language', params.language);
          if (typeof params.type_key === 'string' && params.type_key) qs.set('type_key', params.type_key);
          if (params.is_active === true || params.is_active === false || typeof params.is_active === 'string') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/msg-strategy/library?${qs.toString()}`);
            const { list, total } = parsePaged<MsgStrategyLibraryItem>(res);
            return { data: list, success: true, total };
          } catch {
            showError(t('toast.loadFailed') as string);
            return { data: [], success: false, total: 0 };
          }
        }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => void openModal(null)}>
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
          <Form.Item name="content" label={t('content.strategyContent')} rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            name="language"
            label={t('table.language')}
            rules={[{ required: true }]}
            extra={t('msgStrategy.libraryLanguageHint')}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={langOptions}
              onDropdownVisibleChange={(visible) => {
                if (visible) void reloadLanguages();
              }}
            />
          </Form.Item>
          <Form.Item
            name="type_key"
            label={t('content.triggerEvent')}
            rules={[{ required: true }]}
            extra={senderModeExtra(selectedType?.sender_mode, t)}
          >
            <TypeKeySelect
              options={typeOptions}
              placeholder={t('content.triggerEvent') as string}
              onDropdownVisibleChange={(visible) => {
                if (visible) void reloadMeta();
              }}
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
    </div>
  );
}
