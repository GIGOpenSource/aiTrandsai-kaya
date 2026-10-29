import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { SayHiCopyItem } from '../../types';
import { CONTENT_LANGS, normalizeLangOptions, parsePaged, unwrapResults } from '../Companions/contentApi';
import { patchActive } from '../MsgStrategy/api';
import { ActiveTag } from '../MsgStrategy/shared';
import { getAppLanguage } from '../../locales';

type LangOption = { value: string; label: string };

function parseOptions(res: unknown): LangOption[] {
  const raw = unwrapResults<Record<string, unknown>>(res) ?? (res as Record<string, unknown> | undefined);
  if (!raw || typeof raw !== 'object') return CONTENT_LANGS;
  const langs = raw.languages ?? raw.language_options ?? raw.langs;
  if (langs == null) return CONTENT_LANGS;
  const parsed = normalizeLangOptions(langs);
  return parsed.length ? parsed : CONTENT_LANGS;
}

export default function SayHiCopiesList() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SayHiCopyItem | null>(null);
  const [langOptions, setLangOptions] = useState<LangOption[]>(CONTENT_LANGS);

  useEffect(() => {
    void adminFetchJson('/api/admin/say-hi/options')
      .then((res) => setLangOptions(parseOptions(res)))
      .catch(() => setLangOptions(CONTENT_LANGS));
  }, []);

  const handleToggle = useCallback(
    async (row: SayHiCopyItem, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/say-hi/copies/${row.id}/active`, isActive);
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
        const res = await adminFetch(`/api/admin/say-hi/copies/${id}`, { method: 'DELETE' });
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

  const langEnum = useMemo(
    () => Object.fromEntries(langOptions.map((item) => [item.value, { text: item.label }])),
    [langOptions],
  );

  const columns: ProColumns<SayHiCopyItem>[] = useMemo(
    () => [
      {
        title: t('sayHi.content'),
        dataIndex: 'keyword',
        hideInTable: true,
        fieldProps: { placeholder: t('sayHi.keywordPlaceholder'), allowClear: true },
      },
      {
        title: t('sayHi.content'),
        dataIndex: 'content',
        ellipsis: { showTitle: false },
        search: false,
        render: (_: unknown, row: SayHiCopyItem) => (
          <Tooltip placement="topLeft" title={row.content}>
            {row.content || '—'}
          </Tooltip>
        ),
      },
      {
        title: t('table.language'),
        dataIndex: 'language',
        width: 120,
        valueType: 'select',
        fieldProps: { options: langOptions, allowClear: true },
        valueEnum: langEnum,
      },
      {
        title: t('sayHi.sortOrder'),
        dataIndex: 'sort_order',
        width: 90,
        search: false,
        render: (_: unknown, row: SayHiCopyItem) => row.sort_order ?? 0,
      },
      {
        title: t('table.status'),
        dataIndex: 'is_active',
        width: 110,
        valueType: 'select',
        valueEnum: {
          true: { text: t('content.active') },
          false: { text: t('content.inactive') },
        },
        render: (_: unknown, row: SayHiCopyItem) => <ActiveTag active={row.is_active} />,
      },
      {
        title: t('sayHi.remark'),
        dataIndex: 'remark',
        width: 160,
        ellipsis: true,
        search: false,
        render: (_: unknown, row: SayHiCopyItem) => row.remark || '—',
      },
      {
        title: t('table.updatedAt'),
        dataIndex: 'updated_at',
        width: 180,
        search: false,
        render: (_: unknown, row: SayHiCopyItem) => (
          <FormatDate value={row.updated_at || row.created_at} locale={locale} />
        ),
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        search: false,
        render: (_: unknown, row: SayHiCopyItem) => (
          <Space>
            <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(row);
                form.setFieldsValue({
                  content: row.content,
                  language: row.language,
                  sort_order: row.sort_order ?? 0,
                  is_active: row.is_active !== false,
                  remark: row.remark || '',
                });
                setOpen(true);
              }}
            >
              {t('btn.edit')}
            </Button>
            <Popconfirm
              title={t('sayHi.confirmDelete')}
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
    [form, handleDelete, handleToggle, langEnum, langOptions, locale, t],
  );

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        content: String(values.content || '').trim(),
        language: values.language,
        sort_order: values.sort_order ?? 0,
        is_active: values.is_active !== false,
        remark: values.remark || '',
      };
      const url = editing ? `/api/admin/say-hi/copies/${editing.id}` : '/api/admin/say-hi/copies';
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
    } catch (e) {
      showError((e as Error).message || (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>{t('page.sayHi')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('sayHi.hint')}</p>
      <ProTable<SayHiCopyItem>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1100 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(Math.min(200, Number(params.pageSize) || 20)));
          if (typeof params.keyword === 'string' && params.keyword.trim()) qs.set('keyword', params.keyword.trim());
          if (typeof params.language === 'string' && params.language) qs.set('language', params.language);
          if (params.is_active === true || params.is_active === false || params.is_active === 'true' || params.is_active === 'false') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/say-hi/copies?${qs.toString()}`);
            const { list, total } = parsePaged<SayHiCopyItem>(res);
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
              form.setFieldsValue({
                language: langOptions[0]?.value || 'en',
                is_active: false,
                sort_order: 0,
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
          <Form.Item name="content" label={t('sayHi.content')} rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={4} placeholder={t('sayHi.contentPlaceholder') as string} />
          </Form.Item>
          <Form.Item name="language" label={t('table.language')} rules={[{ required: true }]}>
            <Select options={langOptions} />
          </Form.Item>
          <Form.Item name="sort_order" label={t('sayHi.sortOrder')} extra={t('sayHi.sortOrderHint')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label={t('sayHi.remark')}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label={t('content.isActive')} valuePropName="checked" extra={t('sayHi.activeHint')}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
