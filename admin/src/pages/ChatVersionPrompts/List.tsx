import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Tag, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ChatVersionPromptItem } from '../../types';
import { parsePaged } from '../Companions/contentApi';
import { getAppLanguage } from '../../locales';
import ScopeUsersDrawer from './ScopeUsersDrawer';

const LOCKED_VERSION = '1.1.1';

function normalizeVersion(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '');
}

function isLockedVersion(row: Pick<ChatVersionPromptItem, 'version'>) {
  return normalizeVersion(row.version) === LOCKED_VERSION;
}

function toIsoOrNull(value: unknown) {
  if (value == null || value === '') return null;
  if (dayjs.isDayjs(value)) return value.toISOString();
  const parsed = dayjs(value as string);
  return parsed.isValid() ? parsed.toISOString() : null;
}

function parseTime(value?: string | null) {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const msg = data.message || data.error || data.detail;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch {
    // ignore
  }
  return fallback;
}

export default function ChatVersionPromptsList() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ChatVersionPromptItem | null>(null);
  const [prompts, setPrompts] = useState<ChatVersionPromptItem[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopePrompt, setScopePrompt] = useState<ChatVersionPromptItem | null>(null);
  const [scopeTab, setScopeTab] = useState<'applied' | 'removed'>('applied');

  const handleToggle = useCallback(
    async (row: ChatVersionPromptItem, isEnabled: boolean) => {
      try {
        const res = await adminFetch(`/api/admin/chat-version-prompts/${row.id}/enabled`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_enabled: isEnabled }),
        });
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readErrorMessage(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [t],
  );

  const handleDelete = useCallback(
    async (row: ChatVersionPromptItem) => {
      if (isLockedVersion(row)) return;
      try {
        const res = await adminFetch(`/api/admin/chat-version-prompts/${row.id}`, { method: 'DELETE' });
        if (res && res.ok) {
          showSuccess(t('toast.deleteSuccess') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readErrorMessage(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [t],
  );

  const openEdit = useCallback(
    (row: ChatVersionPromptItem) => {
      setEditing(row);
      form.setFieldsValue({
        version: row.version,
        prompt: row.prompt,
        remark: row.remark || '',
        sort_order: row.sort_order ?? 0,
        is_enabled: !!row.is_enabled,
        apply_registered_start_at: parseTime(row.apply_registered_start_at),
        apply_registered_end_at: parseTime(row.apply_registered_end_at),
      });
      setOpen(true);
    },
    [form],
  );

  const openScope = useCallback((row: ChatVersionPromptItem, tab: 'applied' | 'removed' = 'applied') => {
    setScopePrompt(row);
    setScopeTab(tab);
    setScopeOpen(true);
  }, []);

  useEffect(() => {
    if (!scopeOpen) return;
    void adminFetchJson('/api/admin/chat-version-prompts?page=1&page_size=200')
      .then((res) => {
        const { list } = parsePaged<ChatVersionPromptItem>(res);
        if (list.length) setPrompts(list);
      })
      .catch(() => undefined);
  }, [scopeOpen]);

  const columns: ProColumns<ChatVersionPromptItem>[] = useMemo(
    () => [
      {
        title: t('table.keyword'),
        dataIndex: 'keyword',
        hideInTable: true,
        fieldProps: { placeholder: t('chatVersion.keywordPlaceholder'), allowClear: true },
      },
      {
        title: t('chatVersion.version'),
        dataIndex: 'version',
        width: 110,
        fieldProps: { placeholder: t('chatVersion.versionPlaceholder'), allowClear: true },
      },
      {
        title: t('chatVersion.prompt'),
        dataIndex: 'prompt',
        ellipsis: { showTitle: false },
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => (
          <Tooltip placement="topLeft" title={row.prompt}>
            {row.prompt || '—'}
          </Tooltip>
        ),
      },
      {
        title: t('chatVersion.registerWindow'),
        key: 'register_window',
        width: 220,
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => {
          if (!row.apply_registered_start_at && !row.apply_registered_end_at) {
            return t('chatVersion.registerUnlimited');
          }
          return (
            <span>
              <FormatDate value={row.apply_registered_start_at} locale={locale} />
              {' ~ '}
              <FormatDate value={row.apply_registered_end_at} locale={locale} />
            </span>
          );
        },
      },
      {
        title: t('chatVersion.appliedCount'),
        dataIndex: 'applied_count',
        width: 90,
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => openScope(row, 'applied')}>
            {row.applied_count ?? 0}
          </Button>
        ),
      },
      {
        title: t('chatVersion.removedCount'),
        dataIndex: 'removed_count',
        width: 90,
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => openScope(row, 'removed')}>
            {row.removed_count ?? 0}
          </Button>
        ),
      },
      {
        title: t('chatVersion.sortOrder'),
        dataIndex: 'sort_order',
        width: 80,
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => row.sort_order ?? 0,
      },
      {
        title: t('table.status'),
        dataIndex: 'is_enabled',
        width: 100,
        valueType: 'select',
        valueEnum: {
          true: { text: t('chatVersion.enabled') },
          false: { text: t('chatVersion.disabled') },
        },
        render: (_: unknown, row: ChatVersionPromptItem) =>
          row.is_enabled ? (
            <Tag color="success">{t('chatVersion.enabled')}</Tag>
          ) : (
            <Tag>{t('chatVersion.disabled')}</Tag>
          ),
      },
      {
        title: t('chatVersion.remark'),
        dataIndex: 'remark',
        width: 140,
        ellipsis: true,
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => row.remark || '—',
      },
      {
        title: t('table.updatedAt'),
        dataIndex: 'updated_at',
        width: 180,
        search: false,
        render: (_: unknown, row: ChatVersionPromptItem) => (
          <FormatDate value={row.updated_at || row.created_at} locale={locale} />
        ),
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 400,
        fixed: 'right',
        search: false,
        onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (_: unknown, row: ChatVersionPromptItem) => (
          <Space size={0} wrap={false}>
            <Switch checked={!!row.is_enabled} onChange={(checked) => void handleToggle(row, checked)} />
            <Button type="link" icon={<TeamOutlined />} onClick={() => openScope(row)}>
              {t('chatVersion.scope')}
            </Button>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              {t('btn.edit')}
            </Button>
            {isLockedVersion(row) ? null : (
              <Popconfirm
                title={t('chatVersion.confirmDelete')}
                onConfirm={() => handleDelete(row)}
                okText={t('btn.delete')}
                cancelText={t('btn.cancel')}
              >
                <Button type="link" danger icon={<DeleteOutlined />}>
                  {t('btn.delete')}
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [handleDelete, handleToggle, locale, openEdit, openScope, t],
  );

  async function handleSave() {
    const values = await form.validateFields();
    const version = normalizeVersion(values.version);
    if (!version) {
      form.setFields([{ name: 'version', errors: [t('chatVersion.versionPlaceholder') as string] }]);
      return;
    }
    const start = toIsoOrNull(values.apply_registered_start_at);
    const end = toIsoOrNull(values.apply_registered_end_at);
    if (start && end && dayjs(start).isAfter(dayjs(end))) {
      form.setFields([{ name: 'apply_registered_end_at', errors: [t('chatVersion.registerWindowHint') as string] }]);
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        prompt: String(values.prompt || '').trim(),
        is_enabled: values.is_enabled !== false,
        remark: values.remark || '',
        sort_order: values.sort_order ?? 0,
        apply_registered_start_at: start,
        apply_registered_end_at: end,
      };
      if (!editing || !isLockedVersion(editing)) {
        body.version = version;
      }
      const url = editing
        ? `/api/admin/chat-version-prompts/${editing.id}`
        : '/api/admin/chat-version-prompts';
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
        showError(res ? await readErrorMessage(res, t('settings.saveFailed') as string) : (t('settings.saveFailed') as string));
      }
    } catch (e) {
      showError((e as Error).message || (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  const editingLocked = editing ? isLockedVersion(editing) : false;

  return (
    <div>
      <h2>{t('page.chatVersionPrompts')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('chatVersion.hint')}</p>
      <ProTable<ChatVersionPromptItem>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        scroll={{ x: 1680 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(Math.min(200, Number(params.pageSize) || 20)));
          if (typeof params.keyword === 'string' && params.keyword.trim()) qs.set('keyword', params.keyword.trim());
          if (typeof params.version === 'string' && params.version.trim()) qs.set('version', params.version.trim());
          if (
            params.is_enabled === true ||
            params.is_enabled === false ||
            params.is_enabled === 'true' ||
            params.is_enabled === 'false'
          ) {
            qs.set('is_enabled', String(params.is_enabled));
          }
          try {
            const res = await adminFetchJson(`/api/admin/chat-version-prompts?${qs.toString()}`);
            const { list, total } = parsePaged<ChatVersionPromptItem>(res);
            setPrompts((prev) => (list.length ? list : prev));
            setScopePrompt((prev) => {
              if (!prev) return prev;
              return list.find((item) => item.id === prev.id) || prev;
            });
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
                is_enabled: false,
                sort_order: 0,
                apply_registered_start_at: null,
                apply_registered_end_at: null,
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
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="version"
            label={t('chatVersion.version')}
            extra={editingLocked ? t('chatVersion.lockedHint') : undefined}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input
              placeholder={t('chatVersion.versionPlaceholder') as string}
              disabled={editingLocked}
            />
          </Form.Item>
          <Form.Item name="prompt" label={t('chatVersion.prompt')} rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={6} placeholder={t('chatVersion.promptPlaceholder') as string} />
          </Form.Item>
          <Form.Item
            name="apply_registered_start_at"
            label={t('chatVersion.registerStart')}
            extra={t('chatVersion.registerWindowHint')}
          >
            <DatePicker showTime allowClear style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="apply_registered_end_at" label={t('chatVersion.registerEnd')}>
            <DatePicker showTime allowClear style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sort_order" label={t('chatVersion.sortOrder')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label={t('chatVersion.remark')}>
            <Input />
          </Form.Item>
          <Form.Item
            name="is_enabled"
            label={t('content.isActive')}
            valuePropName="checked"
            extra={t('chatVersion.enabledHint')}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <ScopeUsersDrawer
        open={scopeOpen}
        prompt={scopePrompt}
        prompts={prompts}
        scope={scopeTab}
        onScopeChange={setScopeTab}
        onPromptChange={setScopePrompt}
        onClose={() => setScopeOpen(false)}
        onCountsChange={() => actionRef.current?.reload()}
      />
    </div>
  );
}
