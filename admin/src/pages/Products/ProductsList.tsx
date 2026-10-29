import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, Table, Tag, Button, Space, Popconfirm, Switch, Tabs, Form,
  Input, InputNumber, Select, Drawer, Typography, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import type { BenefitProduct } from '../../types';
import { DEFAULT_APP_KEY, appLabel, normalizeAppKey, parseApps, parseCountryOptions, type AppOption } from './appKey';

/** 商品多语言名称可选国家（图片中的语言 + 阿拉伯语/波斯语） */
const TITLE_COUNTRY_OPTIONS = [
  { value: 'US', labelKey: 'products.country.US' },
  { value: 'JP', labelKey: 'products.country.JP' },
  { value: 'KR', labelKey: 'products.country.KR' },
  { value: 'BR', labelKey: 'products.country.BR' },
  { value: 'ES', labelKey: 'products.country.ES' },
  { value: 'ID', labelKey: 'products.country.ID' },
  { value: 'RU', labelKey: 'products.country.RU' },
  { value: 'BG', labelKey: 'products.country.BG' },
  { value: 'TR', labelKey: 'products.country.TR' },
  { value: 'SA', labelKey: 'products.country.SA' },
  { value: 'IR', labelKey: 'products.country.IR' },
] as const;

type TitleRow = { country: string; name: string };

function titlesToRows(titles?: Record<string, string> | null): TitleRow[] {
  if (!titles || typeof titles !== 'object') return [];
  return Object.entries(titles)
    .filter(([, name]) => typeof name === 'string' && name.trim())
    .map(([country, name]) => ({ country: country.toUpperCase(), name: name.trim() }));
}

function rowsToTitles(rows: TitleRow[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (rows || []).forEach((row) => {
    const country = String(row?.country || '').trim().toUpperCase();
    const name = String(row?.name || '').trim();
    if (!country || !name) return;
    out[country] = name.slice(0, 100);
  });
  return out;
}

/* ===== 商品表单弹窗 ===== */
function ProductFormDrawer({
  open, onClose, product, appOptions, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product?: BenefitProduct | null;
  appOptions: AppOption[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [productType, setProductType] = useState<string>(product?.product_type || 'subscribe');
  const isEdit = Boolean(product?.id);
  const titleRows = Form.useWatch('title_rows', form) as TitleRow[] | undefined;
  const isLimitedOffer = Form.useWatch('is_limited_offer', form) as boolean | undefined;

  const countryOptions = useMemo(
    () => TITLE_COUNTRY_OPTIONS.map((item) => ({
      value: item.value,
      label: `${item.value} · ${t(item.labelKey)}`,
    })),
    [t],
  );

  useEffect(() => {
    if (open) {
      if (product) {
        form.setFieldsValue({
          ...product,
          app_key: normalizeAppKey(product.app_key),
          title_rows: titlesToRows(product.titles),
          price_usd: undefined,
          is_limited_offer: !!product.is_limited_offer,
          limited_duration_sec: product.is_limited_offer
            ? Math.min(3600, Math.max(1, Number(product.limited_duration_sec) || 1800))
            : 1800,
        });
        setProductType(product.product_type);
      } else {
        form.resetFields();
        form.setFieldsValue({ app_key: DEFAULT_APP_KEY });
        setProductType('subscribe');
      }
    }
  }, [open, product, form]);

  async function handleSubmit(values: Record<string, unknown>) {
    setSaving(true);
    try {
      const { title_rows, price_usd: _priceUsd, price_display: _pd, price_currency: _pc, ...rest } = values;
      const limited = !!rest.is_limited_offer;
      const durationRaw = Number(rest.limited_duration_sec);
      const body = {
        ...rest,
        app_key: normalizeAppKey(rest.app_key as string),
        titles: rowsToTitles(title_rows as TitleRow[] | undefined),
        is_limited_offer: limited,
        limited_duration_sec: limited
          ? Math.min(3600, Math.max(1, Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 1800))
          : 0,
      };
      delete (body as Record<string, unknown>).price_usd;
      delete (body as Record<string, unknown>).price_display;
      delete (body as Record<string, unknown>).price_currency;
      const url = isEdit
        ? `/api/admin/benefits/products/${product!.id}`
        : '/api/admin/benefits/products';
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

  return (
    <Drawer
      title={isEdit ? t('products.editProduct') : t('products.addProduct')}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          product_type: 'subscribe', platform: 'all', app_key: DEFAULT_APP_KEY,
          discount_pct: 0, credits_amount: 0, daily_gift_credits: 0,
          max_agents: 0, daily_avg_price: 0, sort_order: 0, is_active: true,
          is_limited_offer: false, limited_duration_sec: 1800,
          title_rows: [],
        }}
      >
        <Form.Item name="title" label={t('products.form.title')} rules={[{ required: true }]}
          extra={t('products.form.titleHint') as string}
        >
          <Input placeholder={t('products.form.titlePlaceholder')} maxLength={100} />
        </Form.Item>

        <Form.Item name="app_key" label={t('products.form.app')} rules={[{ required: true }]}
          extra={t('products.form.appHint') as string}
        >
          <Select options={appOptions} />
        </Form.Item>

        <Form.Item label={t('products.form.titles')} extra={t('products.form.titlesHint') as string}>
          <Form.List name="title_rows">
            {(fields, { add, remove }) => {
              const used = new Set(
                (titleRows || [])
                  .map((row) => String(row?.country || '').toUpperCase())
                  .filter(Boolean),
              );
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {fields.map((field) => {
                    const current = String(titleRows?.[field.name]?.country || '').toUpperCase();
                    const options = countryOptions.filter(
                      (opt) => opt.value === current || !used.has(opt.value),
                    );
                    return (
                      <Space key={field.key} align="start" style={{ display: 'flex' }} wrap>
                        <Form.Item
                          {...field}
                          name={[field.name, 'country']}
                          rules={[{ required: true, message: t('products.form.countryRequired') as string }]}
                          style={{ marginBottom: 0, minWidth: 180 }}
                        >
                          <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder={t('products.form.country')}
                            options={options}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, 'name']}
                          rules={[{ required: true, message: t('products.form.nameRequired') as string }]}
                          style={{ marginBottom: 0, flex: 1, minWidth: 180 }}
                        >
                          <Input placeholder={t('products.form.namePlaceholder') as string} maxLength={100} />
                        </Form.Item>
                        <MinusCircleOutlined
                          style={{ marginTop: 8, color: '#ff4d4f' }}
                          onClick={() => remove(field.name)}
                        />
                      </Space>
                    );
                  })}
                  <Button
                    type="dashed"
                    onClick={() => add({ country: undefined, name: '' })}
                    block
                    icon={<PlusOutlined />}
                    disabled={used.size >= TITLE_COUNTRY_OPTIONS.length}
                  >
                    {t('products.form.addTitleRow')}
                  </Button>
                </div>
              );
            }}
          </Form.List>
        </Form.Item>

        <Form.Item name="product_type" label={t('products.form.type')} rules={[{ required: true }]}>
          <Select onChange={(v) => setProductType(v)} options={[
            { value: 'subscribe', label: t('products.subscribe') },
            { value: 'point', label: t('products.point') },
          ]} />
        </Form.Item>
        <Form.Item
          name="platform"
          label={t('products.form.platform')}
          extra={t('products.form.platformHint') as string}
        >
          <Select options={[
            { value: 'all', label: 'All' },
            { value: 'apple', label: 'Apple' },
            { value: 'google', label: 'Google' },
          ]} />
        </Form.Item>
        {isEdit && (product?.price_display || product?.price_currency) ? (
          <Form.Item label={t('products.col.price')} extra={t('products.form.priceReadonlyHint') as string}>
            <Typography.Text>
              {product?.price_display || '—'}
              {product?.price_currency ? (
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {product.price_currency}
                </Typography.Text>
              ) : null}
            </Typography.Text>
          </Form.Item>
        ) : (
          <Form.Item label={t('products.col.price')} extra={t('products.form.priceReadonlyHint') as string}>
            <Typography.Text type="secondary">{t('products.form.priceFromStore')}</Typography.Text>
          </Form.Item>
        )}
        <Form.Item name="discount_pct" label={t('products.form.discount')}>
          <InputNumber min={0} max={100} style={{ width: '100%' }} suffix="%" />
        </Form.Item>

        {productType === 'subscribe' && (
          <>
            <Form.Item name="period" label={t('products.form.period')}>
              <Select options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
                { value: 'lifetime', label: 'Lifetime' },
              ]} />
            </Form.Item>
            <Form.Item name="daily_gift_credits" label={t('products.form.dailyGiftCredits')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max_agents" label={t('products.form.maxAgents')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="daily_avg_price" label={t('products.form.dailyAvgPrice')}>
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} prefix="$" />
            </Form.Item>
          </>
        )}

        {productType === 'point' && (
          <Form.Item name="credits_amount" label={t('products.form.creditsAmount')} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        )}

        <Form.Item name="store_product_id" label={t('products.form.storeProductId')}>
          <Input placeholder="Google Play product ID" />
        </Form.Item>
        <Form.Item name="apple_product_id" label={t('products.form.appleProductId')}>
          <Input placeholder="App Store product ID" />
        </Form.Item>
        <Form.Item
          name="sort_order"
          label={t('products.form.sortOrder')}
          extra={t('products.form.sortOrderHint') as string}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="is_active" label={t('products.form.isActive')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="is_limited_offer"
          label={t('products.form.limitedOffer')}
          valuePropName="checked"
          extra={t('products.form.limitedOfferHint') as string}
        >
          <Switch
            onChange={(checked) => {
              if (checked && !form.getFieldValue('limited_duration_sec')) {
                form.setFieldValue('limited_duration_sec', 1800);
              }
            }}
          />
        </Form.Item>
        {isLimitedOffer ? (
          <Form.Item
            name="limited_duration_sec"
            label={t('products.form.limitedDuration')}
            extra={t('products.form.limitedDurationHint') as string}
            rules={[{ required: true, message: t('products.form.limitedDuration') as string }]}
          >
            <InputNumber min={1} max={3600} style={{ width: '100%' }} addonAfter="s" />
          </Form.Item>
        ) : null}

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

function TitlesPreview({ titles }: { titles?: Record<string, string> }) {
  const { t } = useTranslation();
  const entries = Object.entries(titles || {}).filter(([, name]) => String(name || '').trim());
  if (!entries.length) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  const preview = entries.slice(0, 3).map(([code, name]) => `${code}: ${name}`).join(' · ');
  const more = entries.length > 3 ? ` (+${entries.length - 3})` : '';
  const tip = (
    <div>
      {entries.map(([code, name]) => (
        <div key={code}>{code}: {name}</div>
      ))}
    </div>
  );
  return (
    <Tooltip title={tip}>
      <Typography.Text ellipsis style={{ maxWidth: 220, margin: 0 }}>
        {preview}{more || (entries.length ? '' : t('products.col.titlesEmpty'))}
      </Typography.Text>
    </Tooltip>
  );
}

/* ===== 商品列表 Tab ===== */
export default function ProductsList() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<BenefitProduct[]>([]);
  const [appOptions, setAppOptions] = useState<AppOption[]>(() => parseApps(null));
  const [countryOptions, setCountryOptions] = useState<AppOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [appFilter, setAppFilter] = useState<string | undefined>();
  const [countryFilter, setCountryFilter] = useState<string | undefined>();
  const [limitedFilter, setLimitedFilter] = useState<boolean | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<BenefitProduct | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (appFilter) qs.set('app_key', appFilter);
      if (countryFilter) qs.set('country', countryFilter);
      if (limitedFilter) qs.set('is_limited_offer', 'true');
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await adminFetchJson<{
        items: BenefitProduct[];
        apps?: AppOption[];
        countries?: AppOption[];
        country?: string;
      }>(`/api/admin/benefits/products${suffix}`);
      if (res?.items) {
        const items = [...res.items].sort((a, b) => {
          const sortDiff = (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0);
          if (sortDiff !== 0) return sortDiff;
          return (Number(a.id) || 0) - (Number(b.id) || 0);
        });
        setProducts(items);
      }
      if (res?.apps) setAppOptions(parseApps(res.apps));
      const countries = parseCountryOptions(res?.countries);
      if (countries.length) setCountryOptions(countries);
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [appFilter, countryFilter, limitedFilter, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/benefits/products/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleted') as string);
        setProducts((prev) => prev.filter((p) => p.id !== id));
      } else {
        showError(t('toast.deleteFailed') as string);
      }
    } catch {
      showError(t('toast.deleteFailed') as string);
    }
  }

  async function toggleActive(product: BenefitProduct, checked: boolean) {
    try {
      const res = await adminFetch(`/api/admin/benefits/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: checked }),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setProducts((prev) =>
          prev.map((p) => (p.id === product.id ? { ...p, is_active: checked } : p))
        );
      } else {
        showError(t('toast.saveFailed') as string);
      }
    } catch {
      showError(t('toast.saveFailed') as string);
    }
  }

  const filtered = activeTab === 'all'
    ? products
    : products.filter((p) => p.product_type === activeTab);

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: t('products.col.title'), dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: t('products.col.app'),
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
      title: t('products.col.titles'),
      dataIndex: 'titles',
      key: 'titles',
      width: 240,
      render: (titles: Record<string, string> | undefined) => <TitlesPreview titles={titles} />,
    },
    {
      title: t('products.col.type'), dataIndex: 'product_type', key: 'product_type', width: 100,
      render: (v: string) => (
        <Tag color={v === 'subscribe' ? 'blue' : 'gold'}>
          {v === 'subscribe' ? t('products.subscribe') : t('products.point')}
        </Tag>
      ),
    },
    { title: t('products.col.platform'), dataIndex: 'platform', key: 'platform', width: 80 },
    {
      title: t('products.col.price'),
      key: 'price_display',
      width: 140,
      render: (_: unknown, record: BenefitProduct) => {
        if (record.price_display) {
          return (
            <span>
              {record.price_display}
              {record.price_currency ? (
                <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                  {record.price_currency}
                </Typography.Text>
              ) : null}
            </span>
          );
        }
        return <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: t('products.col.discount'), dataIndex: 'discount_pct', key: 'discount_pct', width: 80,
      render: (v: number) => (v ? `${v}%` : '-'),
    },
    {
      title: t('products.col.limited'),
      key: 'is_limited_offer',
      width: 130,
      render: (_: unknown, record: BenefitProduct) => {
        if (!record.is_limited_offer) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const sec = Number(record.limited_duration_sec);
        const duration = Number.isFinite(sec) && sec > 0 ? `${sec}s` : '';
        return <Tag color="volcano">{t('products.limited')}{duration ? ` ${duration}` : ''}</Tag>;
      },
    },
    {
      title: t('products.col.status'), dataIndex: 'is_active', key: 'is_active', width: 100,
      render: (v: boolean, record: BenefitProduct) => (
        <Switch checked={v} size="small" onChange={(checked) => toggleActive(record, checked)} />
      ),
    },
    {
      title: t('products.col.sort'),
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 90,
      defaultSortOrder: 'descend' as const,
      sorter: (a: BenefitProduct, b: BenefitProduct) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
    },
    {
      title: t('products.col.actions'), key: 'actions', width: 130, fixed: 'right' as const,
      render: (_: unknown, record: BenefitProduct) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditing(record); setDrawerOpen(true); }}>
            {t('common.edit')}
          </Button>
          <Popconfirm title={t('products.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
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
        title={t('products.title')}
        extra={
          <Space>
            <Select
              allowClear
              placeholder={t('products.filterApp')}
              style={{ width: 160 }}
              value={appFilter}
              onChange={(v) => setAppFilter(v)}
              options={appOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('products.filterCountry')}
              title={t('products.filterCountryHint') as string}
              style={{ width: 240 }}
              value={countryFilter}
              onChange={(v) => setCountryFilter(v || undefined)}
              options={countryOptions}
            />
            <Select
              allowClear
              placeholder={t('products.filterLimited')}
              style={{ width: 150 }}
              value={limitedFilter ? 'limited' : undefined}
              onChange={(v) => setLimitedFilter(v === 'limited' ? true : undefined)}
              options={[
                { value: 'limited', label: t('products.filterLimitedOnly') },
              ]}
            />
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => { setEditing(null); setDrawerOpen(true); }}>
              {t('products.addProduct')}
            </Button>
          </Space>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'all', label: t('products.allType') },
            { key: 'subscribe', label: t('products.subscribe') },
            { key: 'point', label: t('products.point') },
          ]}
          style={{ marginBottom: 16 }}
        />
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 1490 }}
        />
      </Card>

      <ProductFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        product={editing}
        appOptions={appOptions}
        onSaved={loadProducts}
      />
    </>
  );
}
