import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, Table, Tag, Button, Space, Popconfirm, Switch, Drawer, Form,
  Input, InputNumber, Select, DatePicker,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import type { BenefitProduct, BenefitTemplate } from '../../types';
import dayjs from 'dayjs';
import { DEFAULT_APP_KEY, appLabel, normalizeAppKey, parseApps, parseCountryOptions, type AppOption } from './appKey';

const REGION_OPTIONS = [
  'ALL', 'US', 'CN', 'SEA', 'EU', 'TH', 'VN', 'ID', 'JP', 'KR', 'BR', 'MX',
];

/* ===== 模板表单抽屉 ===== */
function TemplateFormDrawer({
  open, onClose, template, products, appOptions, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  template?: BenefitTemplate | null;
  products: BenefitProduct[];
  appOptions: AppOption[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(template?.id);
  const formAppKey = Form.useWatch('app_key', form) as string | undefined;

  useEffect(() => {
    if (open) {
      if (template) {
        form.setFieldsValue({
          ...template,
          app_key: normalizeAppKey(template.app_key),
          product_ids: template.product_ids || [],
          regions: template.regions || [],
          start_at: template.start_at ? dayjs(template.start_at) : null,
          end_at: template.end_at ? dayjs(template.end_at) : null,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ app_key: DEFAULT_APP_KEY });
      }
    }
  }, [open, template, form]);

  async function handleSubmit(values: Record<string, unknown>) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...values };
      body.app_key = normalizeAppKey(body.app_key as string);
      if (body.start_at && typeof body.start_at === 'object' && 'toISOString' in (body.start_at as object)) {
        body.start_at = (body.start_at as dayjs.Dayjs).toISOString();
      }
      if (body.end_at && typeof body.end_at === 'object' && 'toISOString' in (body.end_at as object)) {
        body.end_at = (body.end_at as dayjs.Dayjs).toISOString();
      }
      const url = isEdit
        ? `/api/admin/benefits/templates/${template!.id}`
        : '/api/admin/benefits/templates';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        onSaved();
        onClose();
      } else {
        showError(t('toast.saveFailed') as string);
      }
    } catch {
      showError(t('toast.saveFailed') as string);
    } finally {
      setSaving(false);
    }
  }

  const selectedApp = normalizeAppKey(formAppKey);
  const productOptions = useMemo(
    () =>
      products
        .filter((p) => normalizeAppKey(p.app_key) === selectedApp)
        .map((p) => ({
          value: p.id,
          label: `#${p.id} ${p.title} (${p.platform || 'all'} · ${p.product_type === 'subscribe' ? t('products.subscribe') : t('products.point')}${p.is_limited_offer ? ` · ${t('products.limited')}` : ''} · sort ${p.sort_order ?? 0}) - ${p.price_display || (p.price_usd != null ? `$${p.price_usd}` : '—')}`,
        })),
    [products, selectedApp, t],
  );

  return (
    <Drawer
      title={isEdit ? t('templates.editTemplate') : t('templates.addTemplate')}
      open={open}
      onClose={onClose}
      width={600}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          priority: 0,
          is_active: true,
          app_key: DEFAULT_APP_KEY,
          product_ids: [],
          regions: ['ALL'],
        }}
      >
        <Form.Item name="name" label={t('templates.form.name')} rules={[{ required: true }]}>
          <Input placeholder={t('templates.form.namePlaceholder')} />
        </Form.Item>
        <Form.Item name="description" label={t('templates.form.description')}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="app_key"
          label={t('templates.form.app')}
          rules={[{ required: true }]}
          extra={t('templates.form.appHint') as string}
        >
          <Select
            options={appOptions}
            onChange={() => {
              // 切换应用后清空已选商品，避免跨马甲绑定
              form.setFieldsValue({ product_ids: [] });
            }}
          />
        </Form.Item>
        <Form.Item
          name="priority"
          label={t('templates.form.priority')}
          extra={t('templates.form.priorityHint') as string}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="product_ids"
          label={t('templates.form.bindProducts')}
          extra={t('templates.form.bindProductsHint') as string}
        >
          <Select
            mode="multiple"
            placeholder={t('templates.form.bindProductsPlaceholder')}
            options={productOptions}
            optionFilterProp="label"
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          name="regions"
          label={t('templates.form.bindRegions')}
          extra={t('templates.form.bindRegionsHint') as string}
        >
          <Select
            mode="multiple"
            placeholder={t('templates.form.bindRegionsPlaceholder')}
            options={REGION_OPTIONS.map((r) => ({ value: r, label: r }))}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item name="start_at" label={t('templates.form.startAt')}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="end_at" label={t('templates.form.endAt')}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="is_active" label={t('templates.form.isActive')} valuePropName="checked">
          <Switch />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
          </Space>
        </Form.Item>
      </Form>
    </Drawer>
  );
}

/* ===== 模板列表 ===== */
export default function TemplatesList() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<BenefitTemplate[]>([]);
  const [products, setProducts] = useState<BenefitProduct[]>([]);
  const [appOptions, setAppOptions] = useState<AppOption[]>(() => parseApps(null));
  const [appFilter, setAppFilter] = useState<string | undefined>();
  const [countryFilter, setCountryFilter] = useState<string | undefined>();
  const [activeFilter, setActiveFilter] = useState<string | undefined>();
  const [countryOptions, setCountryOptions] = useState<AppOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<BenefitTemplate | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tplQs = new URLSearchParams();
      if (appFilter) tplQs.set('app_key', appFilter);
      if (countryFilter) tplQs.set('country', countryFilter);
      if (activeFilter === 'true' || activeFilter === 'false') tplQs.set('is_active', activeFilter);
      const tplSuffix = tplQs.toString() ? `?${tplQs.toString()}` : '';
      const [tplRes, prodRes] = await Promise.all([
        adminFetchJson<{ items: BenefitTemplate[]; apps?: AppOption[]; countries?: AppOption[] }>(
          `/api/admin/benefits/templates${tplSuffix}`,
        ),
        // 拉取全部商品供表单按 app_key 过滤绑定（不带 country，避免绑定时缺其它国 SKU）
        adminFetchJson<{ items: BenefitProduct[]; apps?: AppOption[] }>('/api/admin/benefits/products'),
      ]);
      if (tplRes?.items) setTemplates(tplRes.items);
      if (prodRes?.items) setProducts(prodRes.items);
      setAppOptions(parseApps(tplRes?.apps || prodRes?.apps));
      const countries = parseCountryOptions(tplRes?.countries);
      if (countries.length) setCountryOptions(countries);
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, appFilter, countryFilter, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/benefits/templates/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleted') as string);
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      } else {
        showError(t('toast.deleteFailed') as string);
      }
    } catch {
      showError(t('toast.deleteFailed') as string);
    }
  }

  async function toggleActive(template: BenefitTemplate, checked: boolean) {
    try {
      const res = await adminFetch(`/api/admin/benefits/templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: checked }),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setTemplates((prev) =>
          prev.map((t) => (t.id === template.id ? { ...t, is_active: checked } : t))
        );
      } else {
        showError(t('toast.saveFailed') as string);
      }
    } catch {
      showError(t('toast.saveFailed') as string);
    }
  }

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: t('templates.col.name'), dataIndex: 'name', key: 'name' },
    {
      title: t('templates.col.app'),
      dataIndex: 'app_key',
      key: 'app_key',
      width: 110,
      render: (v: string | undefined) => (
        <Tag color={normalizeAppKey(v) === 'kaya' ? 'purple' : 'default'}>
          {appLabel(appOptions, v)}
        </Tag>
      ),
    },
    {
      title: t('templates.col.products'), dataIndex: 'product_ids', key: 'product_ids',
      render: (ids: number[]) => (
        <Space wrap size={4}>
          {(ids || []).map((id) => {
            const p = productMap[id];
            return (
              <Tag key={id} color={p?.is_limited_offer ? 'volcano' : 'blue'}>
                {p?.title || `#${id}`}
                {p?.platform ? ` · ${p.platform}` : ''}
                {p?.is_limited_offer ? ` · ${t('products.limited')}` : ''}
              </Tag>
            );
          })}
        </Space>
      ),
    },
    {
      title: t('templates.col.regions'), dataIndex: 'regions', key: 'regions',
      render: (regions: string[]) => (
        <Space wrap size={4}>
          {(regions || []).map((r) => <Tag key={r}>{r}</Tag>)}
        </Space>
      ),
    },
    { title: t('templates.col.priority'), dataIndex: 'priority', key: 'priority', width: 80 },
    {
      title: t('templates.col.status'), dataIndex: 'is_active', key: 'is_active', width: 100,
      render: (v: boolean, record: BenefitTemplate) => (
        <Switch checked={v} size="small" onChange={(checked) => toggleActive(record, checked)} />
      ),
    },
    {
      title: t('templates.col.actions'), key: 'actions', width: 130,
      render: (_: unknown, record: BenefitTemplate) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditing(record); setDrawerOpen(true); }}>
            {t('common.edit')}
          </Button>
          <Popconfirm title={t('templates.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title={t('templates.title')}
        extra={
          <Space>
            <Select
              allowClear
              placeholder={t('templates.filterApp')}
              style={{ width: 160 }}
              value={appFilter}
              onChange={(v) => setAppFilter(v)}
              options={appOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('templates.filterCountry')}
              style={{ width: 160 }}
              value={countryFilter}
              onChange={(v) => setCountryFilter(v || undefined)}
              options={
                countryOptions.length
                  ? countryOptions
                  : REGION_OPTIONS.map((r) => ({ value: r, label: r }))
              }
            />
            <Select
              allowClear
              placeholder={t('templates.filterActive')}
              style={{ width: 130 }}
              value={activeFilter}
              onChange={(v) => setActiveFilter(v || undefined)}
              options={[
                { value: 'true', label: t('templates.filterActiveOn') },
                { value: 'false', label: t('templates.filterActiveOff') },
              ]}
            />
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => { setEditing(null); setDrawerOpen(true); }}>
              {t('templates.addTemplate')}
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={templates}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 1100 }}
        />
      </Card>

      <TemplateFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        template={editing}
        products={products}
        appOptions={appOptions}
        onSaved={loadData}
      />
    </>
  );
}
