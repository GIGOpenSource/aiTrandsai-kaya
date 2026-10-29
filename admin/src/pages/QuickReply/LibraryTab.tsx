import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Switch, Tag, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import type { ContentCompanion, QuickReplyCompanion, QuickReplyLibraryItem } from '../../types';
import { CONTENT_LANGS, normalizeCompanion } from '../Companions/contentApi';
import CompanionSearchSelect from '../Moments/CompanionSearchSelect';
import { parsePaged, patchActive, splitIds } from '../MsgStrategy/api';
import { ActiveTag } from '../MsgStrategy/shared';

const COMPANION_PAGE_SIZE = 20;

type SelectOption = { value: string; label: string };

/** keywords / trigger_keywords 任一有值即可 */
function keywordsOf(row: QuickReplyLibraryItem): string[] {
  const raw = row.keywords?.length ? row.keywords : row.trigger_keywords;
  return (raw || []).map(String).map((s) => s.trim()).filter(Boolean);
}

function companionOption(item: Pick<ContentCompanion, 'id' | 'name'> | QuickReplyCompanion): SelectOption | null {
  if (!item.id) return null;
  return {
    value: item.id,
    label: item.name ? `${item.name} (${item.id})` : item.id,
  };
}

function companionIdsOf(row: QuickReplyLibraryItem): string[] {
  const fromCompanions = (row.companions || []).map((item) => item.id).filter(Boolean);
  if (fromCompanions.length) return fromCompanions;
  return (row.companion_ids || []).map(String);
}

function companionOptionsOf(row: QuickReplyLibraryItem): SelectOption[] {
  const fromCompanions = (row.companions || [])
    .map(companionOption)
    .filter((item): item is SelectOption => Boolean(item));
  if (fromCompanions.length) return fromCompanions;
  return companionIdsOf(row).map((id) => ({ value: id, label: id }));
}

function mergeOptions(prev: SelectOption[], next: SelectOption[]) {
  const map = new Map(prev.map((item) => [item.value, item]));
  next.forEach((item) => map.set(item.value, item));
  return [...map.values()];
}

export default function LibraryTab() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<QuickReplyLibraryItem | null>(null);
  const [companionOptions, setCompanionOptions] = useState<SelectOption[]>([]);
  const [companionLoading, setCompanionLoading] = useState(false);
  const companionPageRef = useRef(1);
  const companionHasMoreRef = useRef(true);
  const companionKeywordRef = useRef('');
  const companionLoadingRef = useRef(false);
  const companionSearchTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (companionSearchTimer.current) window.clearTimeout(companionSearchTimer.current);
    };
  }, []);

  const loadCompanions = useCallback(async (page: number, keyword = '', append = false) => {
    if (companionLoadingRef.current) return;
    companionLoadingRef.current = true;
    setCompanionLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(COMPANION_PAGE_SIZE),
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      if (keyword) qs.set('keyword', keyword);
      const res = await adminFetchJson(`/api/admin/content/companions?${qs.toString()}`);
      const { list, total } = parsePaged<ContentCompanion>(res);
      const next = list.map(normalizeCompanion).map(companionOption).filter((item): item is SelectOption => Boolean(item));
      const selected = splitIds(form.getFieldValue('companion_ids'));
      setCompanionOptions((prev) => {
        const kept = prev.filter((item) => selected.includes(item.value));
        return mergeOptions(append ? prev : kept, next);
      });
      companionPageRef.current = page;
      companionKeywordRef.current = keyword;
      companionHasMoreRef.current =
        list.length >= COMPANION_PAGE_SIZE && (total > 0 ? page * COMPANION_PAGE_SIZE < total : true);
    } catch {
      companionHasMoreRef.current = false;
    } finally {
      companionLoadingRef.current = false;
      setCompanionLoading(false);
    }
  }, [form]);

  const handleCompanionDropdown = (visible: boolean) => {
    if (!visible) return;
    companionKeywordRef.current = '';
    companionHasMoreRef.current = true;
    void loadCompanions(1, '', false);
  };

  const handleCompanionSearch = (value: string) => {
    if (companionSearchTimer.current) window.clearTimeout(companionSearchTimer.current);
    companionSearchTimer.current = window.setTimeout(() => {
      companionHasMoreRef.current = true;
      void loadCompanions(1, value.trim(), false);
    }, 300);
  };

  const handleCompanionScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    if (target.scrollTop + target.offsetHeight + 32 < target.scrollHeight) return;
    if (!companionHasMoreRef.current || companionLoadingRef.current) return;
    void loadCompanions(companionPageRef.current + 1, companionKeywordRef.current, true);
  };

  const langOptions = CONTENT_LANGS;

  const handleToggle = useCallback(
    async (row: QuickReplyLibraryItem, isActive: boolean) => {
      try {
        const res = await patchActive(`/api/admin/quick-reply/library/${row.id}/active`, isActive);
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
        const res = await adminFetch(`/api/admin/quick-reply/library/${id}`, { method: 'DELETE' });
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

  const columns: ProColumns<QuickReplyLibraryItem>[] = useMemo(
    () => [
      {
        title: t('quickReply.keywords'),
        dataIndex: 'keyword',
        width: 200,
        fieldProps: { placeholder: t('quickReply.keywordsSearch'), allowClear: true },
        render: (_: unknown, row: QuickReplyLibraryItem) => {
          const list = keywordsOf(row);
          if (!list.length) return <Tag>{t('quickReply.fallback')}</Tag>;
          return (
            <Space size={[4, 4]} wrap>
              {list.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </Space>
          );
        },
      },
      {
        title: t('table.language'),
        dataIndex: 'language',
        width: 110,
        valueType: 'select',
        fieldProps: { options: langOptions, allowClear: true },
      },
      {
        title: t('quickReply.content'),
        dataIndex: 'content',
        width: 280,
        ellipsis: { showTitle: false },
        search: false,
        render: (_: unknown, row: QuickReplyLibraryItem) => (
          <Tooltip placement="topLeft" title={row.content}>
            {row.content || '—'}
          </Tooltip>
        ),
      },
      {
        title: t('msgStrategy.companionIds'),
        dataIndex: 'companion_id',
        width: 220,
        hideInTable: false,
        renderFormItem: () => (
          <CompanionSearchSelect
            allowClear
            placeholder={t('msgStrategy.companionIdsPlaceholder') as string}
            style={{ width: '100%' }}
          />
        ),
        render: (_: unknown, row: QuickReplyLibraryItem) => {
          const names = (row.companions || [])
            .map((item) => item.name || item.id)
            .filter(Boolean);
          if (names.length) {
            return (
              <Tooltip title={names.join(', ')}>
                <span>{names.join(', ')}</span>
              </Tooltip>
            );
          }
          const ids = companionIdsOf(row);
          return ids.length ? ids.join(', ') : '—';
        },
      },
      {
        title: t('quickReply.sortOrder'),
        dataIndex: 'sort_order',
        width: 90,
        search: false,
        render: (_: unknown, row: QuickReplyLibraryItem) => row.sort_order ?? 0,
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
        render: (_: unknown, row: QuickReplyLibraryItem) => <ActiveTag active={row.is_active} />,
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        search: false,
        render: (_: unknown, row: QuickReplyLibraryItem) => (
          <Space>
            <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                const companionIds = companionIdsOf(row);
                setEditing(row);
                form.setFieldsValue({
                  content: row.content,
                  language: row.language,
                  keywords: keywordsOf(row),
                  companion_ids: companionIds,
                  is_active: row.is_active !== false,
                  sort_order: row.sort_order ?? 0,
                });
                setCompanionOptions((prev) => mergeOptions(companionOptionsOf(row), prev));
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
    [form, handleDelete, handleToggle, langOptions, t],
  );

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        content: values.content,
        language: values.language,
        keywords: splitIds(values.keywords),
        companion_ids: splitIds(values.companion_ids),
        is_active: values.is_active !== false,
        sort_order: values.sort_order ?? 0,
      };
      const url = editing
        ? `/api/admin/quick-reply/library/${editing.id}`
        : '/api/admin/quick-reply/library';
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
      <p style={{ color: '#666', marginBottom: 12 }}>{t('quickReply.libraryHint')}</p>
      <ProTable<QuickReplyLibraryItem>
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
          if (typeof params.keyword === 'string' && params.keyword) qs.set('keyword', params.keyword);
          if (typeof params.language === 'string' && params.language) qs.set('language', params.language);
          if (typeof params.companion_id === 'string' && params.companion_id) qs.set('companion_id', params.companion_id);
          if (params.is_active === true || params.is_active === false || typeof params.is_active === 'string') {
            qs.set('is_active', String(params.is_active));
          }
          try {
            const res = await adminFetchJson(`/api/admin/quick-reply/library?${qs.toString()}`);
            const { list, total } = parsePaged<QuickReplyLibraryItem>(res);
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
              form.setFieldsValue({ language: 'zh', is_active: true, sort_order: 0, keywords: [] });
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
          <Form.Item name="content" label={t('quickReply.content')} rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="language" label={t('table.language')} rules={[{ required: true }]}>
            <Select options={langOptions} />
          </Form.Item>
          <Form.Item
            name="keywords"
            label={t('quickReply.keywords')}
            extra={t('quickReply.keywordsHint')}
          >
            <Select
              mode="tags"
              tokenSeparators={[',', '，']}
              placeholder={t('quickReply.keywordsPlaceholder') as string}
              open={false}
            />
          </Form.Item>
          <Form.Item name="companion_ids" label={t('msgStrategy.companionIds')} extra={t('msgStrategy.companionIdsHint')}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={false}
              loading={companionLoading}
              options={companionOptions}
              placeholder={t('msgStrategy.companionIdsPlaceholder') as string}
              notFoundContent={companionLoading ? <Spin size="small" /> : undefined}
              onSearch={handleCompanionSearch}
              onPopupScroll={handleCompanionScroll}
              onOpenChange={handleCompanionDropdown}
              popupRender={(menu) => (
                <>
                  {menu}
                  {companionLoading && (
                    <div style={{ padding: '8px 0', textAlign: 'center' }}>
                      <Spin size="small" />
                      <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
                        {t('loading') as string}
                      </span>
                    </div>
                  )}
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="sort_order" label={t('quickReply.sortOrder')} extra={t('quickReply.sortOrderHint')}>
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
