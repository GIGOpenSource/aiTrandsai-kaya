import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { adminFetchJson, showError, showSuccess } from '../../api/request';

type TagDef = {
  key: string;
  side: 'user' | 'agent';
  group: string;
  label_zh: string;
  label_en: string;
  enabled: boolean;
  source: string;
};

type MetaOption = { value: string; label_zh?: string; label_en?: string };

type TagMeta = {
  sides: MetaOption[];
  sources: MetaOption[];
  groups: string[];
};

type Filters = {
  side?: string;
  group?: string;
  key?: string;
  label_zh?: string;
  label_en?: string;
  enabled?: string;
  source?: string;
};

const EMPTY_FILTERS: Filters = {};

type Envelope<T> = {
  code?: number;
  message?: string;
  results?: T;
  pagination?: { page?: number; page_size?: number; total?: number; total_pages?: number };
};

function assertOk<T>(body: Envelope<T> | null, fallback: string): T {
  if (!body) throw new Error(fallback);
  if (typeof body.code === 'number' && body.code !== 200) {
    throw new Error(body.message || fallback);
  }
  return body.results as T;
}

function tagPath(side: string, key: string) {
  return `/api/admin/recommend/tag-dictionary/${side}/${encodeURIComponent(key)}`;
}

function canDelete(row: TagDef) {
  return row.source !== 'seed';
}

function canEditGroup(row: TagDef) {
  return row.source !== 'seed';
}

export default function TagDictionaryTab({ onChanged }: { onChanged?: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'zh';
  const [filterForm] = Form.useForm<Filters>();
  const [editForm] = Form.useForm();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<TagDef[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<TagMeta>({ sides: [], sources: [], groups: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TagDef | null>(null);
  const [saving, setSaving] = useState(false);

  const sideLabel = useCallback(
    (value: string) => {
      const hit = meta.sides.find((item) => item.value === value);
      if (hit) return (locale === 'en' ? hit.label_en : hit.label_zh) || value;
      if (value === 'user') return t('recommend.defSideUser') as string;
      if (value === 'agent') return t('recommend.defSideAgent') as string;
      return value;
    },
    [locale, meta.sides, t],
  );

  const sourceLabel = useCallback(
    (value: string) => {
      const hit = meta.sources.find((item) => item.value === value);
      if (hit) return (locale === 'en' ? hit.label_en : hit.label_zh) || value;
      const key = `recommend.defSource.${value}`;
      const translated = t(key);
      return translated === key ? value : (translated as string);
    },
    [locale, meta.sources, t],
  );

  const loadMeta = useCallback(async () => {
    try {
      const res = await adminFetchJson<Envelope<TagMeta>>('/api/admin/recommend/tag-dictionary/meta');
      const data = assertOk(res, t('toast.loadFailed') as string);
      setMeta({
        sides: Array.isArray(data?.sides) ? data.sides : [],
        sources: Array.isArray(data?.sources) ? data.sources : [],
        groups: Array.isArray(data?.groups) ? data.groups : [],
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }, [t]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('page_size', String(pageSize));
      if (filters.side) qs.set('side', filters.side);
      if (filters.group) qs.set('group', filters.group);
      if (filters.key) qs.set('key', filters.key);
      if (filters.label_zh) qs.set('label_zh', filters.label_zh);
      if (filters.label_en) qs.set('label_en', filters.label_en);
      if (filters.enabled === 'true' || filters.enabled === 'false') qs.set('enabled', filters.enabled);
      if (filters.source) qs.set('source', filters.source);
      const res = await adminFetchJson<Envelope<TagDef[]>>(
        `/api/admin/recommend/tag-dictionary?${qs.toString()}`,
      );
      if (!res) throw new Error(t('toast.loadFailed') as string);
      if (typeof res.code === 'number' && res.code !== 200) {
        throw new Error(res.message || (t('toast.loadFailed') as string));
      }
      const list = Array.isArray(res.results) ? res.results : [];
      setRows(list);
      setTotal(res.pagination?.total ?? list.length);
    } catch (e) {
      setRows([]);
      setTotal(0);
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, t]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const groupOptions = useMemo(() => {
    const set = new Set(meta.groups.filter(Boolean));
    rows.forEach((row) => {
      if (row.group) set.add(row.group);
    });
    return [...set].sort().map((value) => ({ value, label: value }));
  }, [meta.groups, rows]);

  const applyFilters = () => {
    setPage(1);
    setFilters({ ...filterForm.getFieldsValue() });
  };

  const resetFilters = () => {
    filterForm.resetFields();
    setPage(1);
    setFilters(EMPTY_FILTERS);
  };

  const openCreate = () => {
    setEditing(null);
    editForm.resetFields();
    editForm.setFieldsValue({
      side: 'agent',
      group: 'ops',
      enabled: true,
      key: '',
      label_zh: '',
      label_en: '',
    });
    setModalOpen(true);
  };

  const openEdit = (row: TagDef) => {
    setEditing(row);
    editForm.setFieldsValue({
      key: row.key,
      side: row.side,
      group: row.group,
      label_zh: row.label_zh,
      label_en: row.label_en,
      enabled: row.enabled,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values: {
      key: string;
      side: 'user' | 'agent';
      group: string;
      label_zh?: string;
      label_en?: string;
      enabled?: boolean;
    };
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          label_zh: values.label_zh ?? '',
          label_en: values.label_en ?? '',
          enabled: values.enabled !== false,
        };
        if (canEditGroup(editing)) body.group = String(values.group || '').trim();
        const res = await adminFetchJson<Envelope<TagDef>>(tagPath(editing.side, editing.key), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        assertOk(res, t('settings.saveFailed') as string);
      } else {
        const res = await adminFetchJson<Envelope<TagDef>>('/api/admin/recommend/tag-dictionary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: values.key.trim(),
            side: values.side,
            group: String(values.group || '').trim(),
            label_zh: values.label_zh ?? '',
            label_en: values.label_en ?? '',
            enabled: values.enabled !== false,
          }),
        });
        assertOk(res, t('settings.saveFailed') as string);
      }
      showSuccess(t('toast.saved') as string);
      setModalOpen(false);
      await Promise.all([loadList(), loadMeta()]);
      onChanged?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  };

  const patchEnabled = async (row: TagDef, enabled: boolean) => {
    try {
      const res = await adminFetchJson<Envelope<TagDef>>(`${tagPath(row.side, row.key)}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      assertOk(res, t('settings.saveFailed') as string);
      setRows((prev) =>
        prev.map((item) =>
          item.side === row.side && item.key === row.key ? { ...item, enabled } : item,
        ),
      );
      onChanged?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    }
  };

  const handleDelete = async (row: TagDef) => {
    try {
      const res = await adminFetchJson<Envelope<{ ok?: boolean }>>(tagPath(row.side, row.key), {
        method: 'DELETE',
      });
      assertOk(res, t('settings.saveFailed') as string);
      showSuccess(t('toast.deleteSuccess') as string);
      if (rows.length <= 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        await loadList();
      }
      await loadMeta();
      onChanged?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    }
  };

  const columns = [
    {
      title: t('recommend.defColKey'),
      dataIndex: 'key',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('recommend.defColSide'),
      dataIndex: 'side',
      width: 110,
      render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{sideLabel(v)}</span>,
    },
    {
      title: t('recommend.defColGroup'),
      dataIndex: 'group',
      width: 120,
      ellipsis: true,
    },
    {
      title: t('recommend.defColZh'),
      dataIndex: 'label_zh',
      width: 140,
      ellipsis: true,
    },
    {
      title: t('recommend.defColEn'),
      dataIndex: 'label_en',
      width: 140,
      ellipsis: true,
    },
    {
      title: t('recommend.enabled'),
      dataIndex: 'enabled',
      width: 88,
      render: (_: boolean, row: TagDef) => (
        <Switch checked={row.enabled} onChange={(v) => void patchEnabled(row, v)} />
      ),
    },
    {
      title: t('recommend.defColSource'),
      dataIndex: 'source',
      width: 100,
      render: (v: string) => <Tag>{sourceLabel(v)}</Tag>,
    },
    {
      title: t('table.action'),
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, row: TagDef) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            {t('btn.edit')}
          </Button>
          {canDelete(row) ? (
            <Popconfirm
              title={t('recommend.defConfirmDelete')}
              onConfirm={() => void handleDelete(row)}
              okText={t('btn.delete')}
              cancelText={t('btn.cancel')}
            >
              <Button type="link" size="small" danger>
                {t('btn.delete')}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  const groupEditable = !editing || canEditGroup(editing);

  return (
    <Card>
      <Form form={filterForm} layout="vertical" style={{ marginBottom: 8 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <Form.Item name="side" label={t('recommend.defColSide')} style={{ marginBottom: 8 }}>
            <Select
              allowClear
              placeholder={t('recommend.defFilterAll') as string}
              options={
                meta.sides.length
                  ? meta.sides.map((item) => ({
                      value: item.value,
                      label: sideLabel(item.value),
                    }))
                  : [
                      { value: 'user', label: t('recommend.defSideUser') as string },
                      { value: 'agent', label: t('recommend.defSideAgent') as string },
                    ]
              }
            />
          </Form.Item>
          <Form.Item name="group" label={t('recommend.defColGroup')} style={{ marginBottom: 8 }}>
            <Select
              allowClear
              showSearch
              placeholder={t('recommend.defFilterAll') as string}
              options={groupOptions}
            />
          </Form.Item>
          <Form.Item name="key" label={t('recommend.defColKey')} style={{ marginBottom: 8 }}>
            <Input allowClear placeholder={t('recommend.defKeyPlaceholder') as string} />
          </Form.Item>
          <Form.Item name="label_zh" label={t('recommend.defColZh')} style={{ marginBottom: 8 }}>
            <Input allowClear placeholder={t('recommend.defZhPlaceholder') as string} />
          </Form.Item>
          <Form.Item name="label_en" label={t('recommend.defColEn')} style={{ marginBottom: 8 }}>
            <Input allowClear placeholder={t('recommend.defEnPlaceholder') as string} />
          </Form.Item>
          <Form.Item name="enabled" label={t('recommend.enabled')} style={{ marginBottom: 8 }}>
            <Select
              allowClear
              placeholder={t('recommend.defFilterAll') as string}
              options={[
                { value: 'true', label: t('content.active') as string },
                { value: 'false', label: t('content.inactive') as string },
              ]}
            />
          </Form.Item>
          <Form.Item name="source" label={t('recommend.defColSource')} style={{ marginBottom: 8 }}>
            <Select
              allowClear
              placeholder={t('recommend.defFilterAll') as string}
              options={(meta.sources.length
                ? meta.sources
                : [{ value: 'seed' }, { value: 'ops' }, { value: 'ua_auto' }]
              ).map((item) => ({
                value: item.value,
                label: sourceLabel(item.value),
              }))}
            />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Space wrap>
            <Button onClick={resetFilters}>{t('recommend.defReset')}</Button>
            <Button type="primary" onClick={applyFilters}>
              {t('recommend.defSearch')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t('btn.new')}
            </Button>
          </Space>
        </div>
      </Form>

      <Table
        rowKey={(r) => `${r.side}:${r.key}`}
        loading={loading}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 1100 }}
        tableLayout="fixed"
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (n) => t('table.total', { total: n }),
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
      />

      <Modal
        open={modalOpen}
        title={editing ? t('recommend.defEditTitle') : t('recommend.defCreateTitle')}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        destroyOnClose
        width={520}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="key"
            label={t('recommend.defColKey')}
            rules={[{ required: true, message: t('recommend.defKeyRequired') as string }]}
            extra={editing ? t('recommend.defKeyReadonly') : t('recommend.defKeyHint')}
          >
            <Input maxLength={64} disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item
            name="side"
            label={t('recommend.defColSide')}
            rules={[{ required: true, message: t('recommend.defSideRequired') as string }]}
            extra={editing ? t('recommend.defSideReadonly') : undefined}
          >
            <Select
              disabled={Boolean(editing)}
              options={[
                { value: 'user', label: t('recommend.defSideUser') as string },
                { value: 'agent', label: t('recommend.defSideAgent') as string },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="group"
            label={t('recommend.defColGroup')}
            rules={[{ required: true, message: t('recommend.defGroupRequired') as string }]}
            extra={
              editing && !canEditGroup(editing)
                ? t('recommend.defGroupSeedReadonly')
                : t('recommend.defGroupHint')
            }
          >
            <AutoComplete
              disabled={!groupEditable}
              options={groupOptions}
              filterOption={(input, option) =>
                String(option?.value || '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              placeholder={t('recommend.defGroupPlaceholder') as string}
            />
          </Form.Item>
          <Form.Item name="label_zh" label={t('recommend.defColZh')}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="label_en" label={t('recommend.defColEn')}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="enabled" label={t('recommend.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
