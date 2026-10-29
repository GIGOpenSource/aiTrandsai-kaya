import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ProColumns } from '@ant-design/pro-table';
import { StatisticCard } from '@ant-design/pro-card';
import {
  Button, Col, DatePicker, Descriptions, Drawer, Form, Input, InputNumber,
  Popconfirm, Row, Select, Space, Spin, Tag, Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import { parsePaged, unwrapResults } from '../Companions/contentApi';
import { useResizableColumns } from '../../components/resizableColumns';
import { getAppLanguage } from '../../locales';
import type { I18nLabel, PendingOrder, PendingOrderSummary } from '../../types';

const { RangePicker } = DatePicker;
const { Text } = Typography;

type FilterOption = { value: string; label: string };

function utcTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickObject<T extends object>(res: unknown, marker?: keyof T): T | null {
  if (!res || typeof res !== 'object') return null;
  const row = res as Record<string, unknown>;
  for (const key of ['results', 'data']) {
    const inner = row[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      if (!marker || marker in (inner as object)) return inner as T;
    }
  }
  if (!marker || marker in row) return res as T;
  return null;
}

function toCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  });
  return out;
}

function pickLabel(label: I18nLabel | string | undefined, lang: 'zh' | 'en', fallback = ''): string {
  if (!label) return fallback;
  if (typeof label === 'string') return label;
  return (lang === 'en' ? label.en || label.zh : label.zh || label.en) || fallback;
}

function parseLabeledOptions(raw: unknown, lang: 'zh' | 'en'): FilterOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return { value: item, label: item };
      const row = item as Record<string, unknown>;
      const value = String(row.value ?? row.key ?? row.id ?? '');
      if (!value) return null;
      const labelRaw = row.label ?? row.name;
      let label = value;
      if (typeof labelRaw === 'string') {
        label = labelRaw;
      } else if (labelRaw && typeof labelRaw === 'object') {
        label = pickLabel(labelRaw as I18nLabel, lang, value);
      } else if (lang === 'zh' && row.label_zh != null) {
        label = String(row.label_zh);
      } else if (row.label_en != null) {
        label = String(row.label_en);
      } else if (row.zh != null || row.en != null) {
        label = String((lang === 'zh' ? row.zh : row.en) || row.zh || row.en);
      }
      return { value, label };
    })
    .filter((item): item is FilterOption => Boolean(item));
}

function appendDateQuery(qs: URLSearchParams, range: [string, string] | null) {
  if (!range) return;
  const [start, end] = range;
  if (start === end) qs.set('date', start);
  else {
    qs.set('start_date', start);
    qs.set('end_date', end);
  }
}

function compactPayload(values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    out[key] = value;
  });
  return out;
}

function stringifyCallback(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatUsd(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '-';
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'gold',
  completed: 'green',
  failed: 'red',
  expired: 'default',
};

function fallbackStatusOptions(t: (key: string) => string): FilterOption[] {
  return [
    { value: 'pending', label: t('pendingOrders.statusPending') },
    { value: 'completed', label: t('pendingOrders.statusCompleted') },
    { value: 'failed', label: t('pendingOrders.statusFailed') },
    { value: 'expired', label: t('pendingOrders.statusExpired') },
  ];
}

function fallbackProductTypeOptions(t: (key: string) => string): FilterOption[] {
  return [
    { value: 'subscribe', label: t('products.subscribe') },
    { value: 'point', label: t('products.point') },
  ];
}

function fallbackStoreTypeOptions(): FilterOption[] {
  return [
    { value: 'app_store', label: 'App Store' },
    { value: 'google_play', label: 'Google Play' },
  ];
}

function fallbackPlanTypeOptions(): FilterOption[] {
  return [
    { value: 'daily', label: 'daily' },
    { value: 'weekly', label: 'weekly' },
    { value: 'monthly', label: 'monthly' },
    { value: 'yearly', label: 'yearly' },
    { value: 'lifetime', label: 'lifetime' },
  ];
}

function OrderFormDrawer({
  open, onClose, order, statusOptions, productTypeOptions, storeTypeOptions, planTypeOptions, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  order?: PendingOrder | null;
  statusOptions: FilterOption[];
  productTypeOptions: FilterOption[];
  storeTypeOptions: FilterOption[];
  planTypeOptions: FilterOption[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const productType = Form.useWatch('product_type', form) || order?.product_type || 'subscribe';
  const isEdit = Boolean(order?.id);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (order) {
        form.setFieldsValue({
          ...order,
          callback_data: stringifyCallback(order.callback_data),
        });
      } else {
        form.resetFields();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, order, form]);

  async function handleSubmit(values: Record<string, unknown>) {
    setSaving(true);
    try {
      const body = compactPayload(values);
      const url = isEdit
        ? `/api/admin/pending-orders/${order!.id}`
        : '/api/admin/pending-orders';
      const res = await adminFetchJson<{ code?: number; message?: string }>(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && typeof res.code === 'number' && res.code !== 200) {
        showError(res.message || t('toast.saveFailed'));
        return;
      }
      showSuccess(t('toast.saved') as string);
      onSaved();
      onClose();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : t('toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={isEdit ? t('pendingOrders.edit') : t('pendingOrders.create')}
      open={open}
      onClose={onClose}
      width={520}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ product_type: 'subscribe', store_type: 'app_store', status: 'pending' }}
      >
        <Form.Item name="transaction_id" label={t('pendingOrders.transactionId')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="original_transaction_id" label={t('pendingOrders.originalTransactionId')}>
          <Input />
        </Form.Item>
        <Form.Item name="product_id" label={t('pendingOrders.productId')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="product_type" label={t('pendingOrders.productType')} rules={[{ required: true }]}>
          <Select options={productTypeOptions} />
        </Form.Item>
        <Form.Item name="store_type" label={t('pendingOrders.storeType')} rules={[{ required: true }]}>
          <Select options={storeTypeOptions} />
        </Form.Item>
        <Form.Item name="status" label={t('pendingOrders.status')}>
          <Select allowClear options={statusOptions} />
        </Form.Item>
        <Form.Item name="user_id" label={t('pendingOrders.userId')}>
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        {productType === 'subscribe' ? (
          <>
            <Form.Item name="plan_type" label={t('pendingOrders.planType')}>
              <Select allowClear options={planTypeOptions} />
            </Form.Item>
            <Form.Item name="duration_days" label={t('pendingOrders.durationDays')}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item name="package_key" label={t('pendingOrders.packageKey')}>
              <Input />
            </Form.Item>
            <Form.Item name="credits_amount" label={t('pendingOrders.credits')}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}
        <Form.Item name="price_usd" label={t('pendingOrders.price')}>
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} prefix="$" />
        </Form.Item>
        <Form.Item name="callback_data" label={t('pendingOrders.callbackData')}>
          <Input.TextArea rows={4} />
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

export default function PendingOrdersList() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PendingOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [summary, setSummary] = useState<PendingOrderSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [status, setStatus] = useState<string | undefined>();
  const [storeType, setStoreType] = useState<string | undefined>();
  const [productType, setProductType] = useState<string | undefined>();
  const [planType, setPlanType] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [maxDays, setMaxDays] = useState(60);

  const [statusOptions, setStatusOptions] = useState<FilterOption[]>([]);
  const [storeTypeOptions, setStoreTypeOptions] = useState<FilterOption[]>([]);
  const [productTypeOptions, setProductTypeOptions] = useState<FilterOption[]>([]);
  const [planTypeOptions, setPlanTypeOptions] = useState<FilterOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PendingOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<PendingOrder | null>(null);

  const buildQuery = useCallback((withPaging: boolean) => {
    const qs = new URLSearchParams();
    appendDateQuery(qs, dateRange);
    if (status) qs.set('status', status);
    if (storeType) qs.set('store_type', storeType);
    if (productType) qs.set('product_type', productType);
    if (planType) qs.set('plan_type', planType);
    if (keyword) qs.set('keyword', keyword);
    if (withPaging) {
      qs.set('page', String(page));
      qs.set('page_size', String(pageSize));
    }
    return qs;
  }, [dateRange, status, storeType, productType, planType, keyword, page, pageSize]);

  const loadFilterOptions = useCallback(async () => {
    try {
      const res = await adminFetchJson('/api/admin/pending-orders/filter-options');
      const data = pickObject<Record<string, unknown>>(res);
      if (!data) {
        setStatusOptions(fallbackStatusOptions((key) => t(key) as string));
        setProductTypeOptions(fallbackProductTypeOptions((key) => t(key) as string));
        setStoreTypeOptions(fallbackStoreTypeOptions());
        setPlanTypeOptions(fallbackPlanTypeOptions());
        return;
      }
      const nextStatus = parseLabeledOptions(data.statuses, locale);
      const nextStores = parseLabeledOptions(data.store_types, locale);
      const nextTypes = parseLabeledOptions(data.product_types, locale);
      const nextPlans = parseLabeledOptions(data.plan_types, locale);
      setStatusOptions(nextStatus.length ? nextStatus : fallbackStatusOptions((key) => t(key) as string));
      setStoreTypeOptions(nextStores.length ? nextStores : fallbackStoreTypeOptions());
      setProductTypeOptions(nextTypes.length ? nextTypes : fallbackProductTypeOptions((key) => t(key) as string));
      setPlanTypeOptions(nextPlans.length ? nextPlans : fallbackPlanTypeOptions());
      const days = Number(data.max_days);
      if (Number.isFinite(days) && days > 0) setMaxDays(days);
    } catch {
      setStatusOptions(fallbackStatusOptions((key) => t(key) as string));
      setProductTypeOptions(fallbackProductTypeOptions((key) => t(key) as string));
      setStoreTypeOptions(fallbackStoreTypeOptions());
      setPlanTypeOptions(fallbackPlanTypeOptions());
    }
  }, [locale, t]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const qs = buildQuery(false);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await adminFetchJson(`/api/admin/pending-orders/summary${suffix}`);
      const data = pickObject<Record<string, unknown>>(res);
      if (!data) return;
      const totalCount = Number(data.total);
      setSummary({
        total: Number.isFinite(totalCount) ? totalCount : 0,
        by_status: toCountMap(data.by_status),
        by_store_type: toCountMap(data.by_store_type),
        by_product_type: toCountMap(data.by_product_type),
        price_usd_sum: Number(data.price_usd_sum) || 0,
        credits_amount_sum: Number(data.credits_amount_sum) || 0,
        completed_price_usd_sum: Number(data.completed_price_usd_sum) || 0,
      });
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : t('toast.loadFailed'));
    } finally {
      setSummaryLoading(false);
    }
  }, [buildQuery, t]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetchJson(`/api/admin/pending-orders?${buildQuery(true).toString()}`);
      const { list, total: nextTotal } = parsePaged<PendingOrder>(res);
      setItems(list);
      setTotal(nextTotal);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : t('toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [buildQuery, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFilterOptions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFilterOptions]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const refresh = useCallback(() => {
    void loadSummary();
    void loadData();
  }, [loadSummary, loadData]);

  const openDetail = useCallback(async (record: PendingOrder) => {
    setDetail(record);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await adminFetchJson<PendingOrder | { results?: PendingOrder }>(
        `/api/admin/pending-orders/${record.id}`,
      );
      const one = unwrapResults<PendingOrder>(res) ?? (res as PendingOrder | null);
      if (one && one.id) setDetail(one);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : t('toast.loadFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      const res = await adminFetch(`/api/admin/pending-orders/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        refresh();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : t('toast.loadFailed'));
    }
  }, [refresh, t]);

  const columns: ProColumns<PendingOrder>[] = useMemo(() => [
    {
      title: t('pendingOrders.orderId'),
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: t('pendingOrders.transactionId'),
      dataIndex: 'transaction_id',
      key: 'transaction_id',
      width: 180,
      ellipsis: true,
      render: (_, record) =>
        record.transaction_id
          ? <Text copyable={{ text: record.transaction_id }} style={{ fontSize: 12 }}>{record.transaction_id}</Text>
          : '-',
    },
    {
      title: t('pendingOrders.user'),
      key: 'user',
      width: 160,
      ellipsis: true,
      render: (_, record) => {
        if (!record.user) {
          return <Text type="secondary">{t('pendingOrders.unbound')}</Text>;
        }
        const name = record.user.nickname || record.user.username || `#${record.user.id}`;
        return (
          <span>
            {name} <Text type="secondary" style={{ fontSize: 12 }}>#{record.user.id}</Text>
          </span>
        );
      },
    },
    {
      title: t('pendingOrders.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (_, record) => (
        <Tag color={STATUS_COLOR[record.status] || 'default'}>
          {pickLabel(record.status_label, locale, record.status)}
        </Tag>
      ),
    },
    {
      title: t('pendingOrders.product'),
      key: 'product',
      width: 160,
      ellipsis: true,
      render: (_, record) => record.product_name || record.product?.title || record.product_id || '-',
    },
    {
      title: t('pendingOrders.productType'),
      dataIndex: 'product_type',
      key: 'product_type',
      width: 100,
      render: (_, record) => pickLabel(record.product_type_label, locale, record.product_type) || '-',
    },
    {
      title: t('pendingOrders.storeType'),
      dataIndex: 'store_type',
      key: 'store_type',
      width: 120,
      render: (_, record) => pickLabel(record.store_type_label, locale, record.store_type) || '-',
    },
    {
      title: t('pendingOrders.price'),
      dataIndex: 'price_usd',
      key: 'price_usd',
      width: 100,
      render: (_, record) => formatUsd(record.price_usd),
    },
    {
      title: t('pendingOrders.credits'),
      dataIndex: 'credits_amount',
      key: 'credits_amount',
      width: 90,
      render: (_, record) => (record.credits_amount ? record.credits_amount : '-'),
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 168,
      render: (_, record) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap={false}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(record)}>
            {t('btn.view')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => { setEditing(record); setFormOpen(true); }}
          >
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('pendingOrders.deleteConfirm')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('btn.delete')}
            cancelText={t('btn.cancel')}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [handleDelete, locale, openDetail, t]);

  const { columns: tableColumns, scrollX, components } = useResizableColumns(
    columns,
    'pending-orders-col-widths',
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{t('pendingOrders.title')}</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditing(null); setFormOpen(true); }}
        >
          {t('pendingOrders.create')}
        </Button>
      </div>

      <Spin spinning={summaryLoading}>
        {summary && (
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={12} sm={8} md={6} lg={4}>
              <StatisticCard statistic={{ title: t('pendingOrders.summaryTotal'), value: summary.total }} />
            </Col>
            <Col xs={12} sm={8} md={6} lg={4}>
              <StatisticCard statistic={{ title: t('pendingOrders.statusPending'), value: summary.by_status.pending || 0 }} />
            </Col>
            <Col xs={12} sm={8} md={6} lg={4}>
              <StatisticCard statistic={{ title: t('pendingOrders.statusCompleted'), value: summary.by_status.completed || 0 }} />
            </Col>
            <Col xs={12} sm={8} md={6} lg={4}>
              <StatisticCard statistic={{ title: t('pendingOrders.completedAmount'), value: formatUsd(summary.completed_price_usd_sum) }} />
            </Col>
            <Col xs={12} sm={8} md={6} lg={4}>
              <StatisticCard statistic={{ title: t('pendingOrders.amountSum'), value: formatUsd(summary.price_usd_sum) }} />
            </Col>
            <Col xs={12} sm={8} md={6} lg={4}>
              <StatisticCard statistic={{ title: t('pendingOrders.creditsSum'), value: summary.credits_amount_sum }} />
            </Col>
          </Row>
        )}
      </Spin>

      <Space style={{ marginBottom: 8 }} wrap>
        <Space size={8}>
          <span>{t('attribution.dateRange')}</span>
          <RangePicker
            allowClear
            value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
            disabledDate={(current: Dayjs, info?: { from?: Dayjs }) => {
              if (!current) return false;
              if (current.format('YYYY-MM-DD') > utcTodayStr()) return true;
              if (info?.from) {
                return Math.abs(current.diff(info.from, 'day')) > maxDays - 1;
              }
              return false;
            }}
            onChange={(vals) => {
              if (vals?.[0] && vals[1]) {
                const start = vals[0].format('YYYY-MM-DD');
                const end = vals[1].format('YYYY-MM-DD');
                if (vals[1].diff(vals[0], 'day') > maxDays - 1) {
                  showError(t('attribution.dateRangeMax', { days: maxDays }) as string);
                  return;
                }
                setDateRange([start, end]);
                setPage(1);
              } else {
                setDateRange(null);
                setPage(1);
              }
            }}
          />
        </Space>
        <Select
          placeholder={t('pendingOrders.status')}
          allowClear
          style={{ width: 140 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={statusOptions}
        />
        <Select
          placeholder={t('pendingOrders.storeType')}
          allowClear
          style={{ width: 150 }}
          value={storeType}
          onChange={(v) => { setStoreType(v); setPage(1); }}
          options={storeTypeOptions}
        />
        <Select
          placeholder={t('pendingOrders.productType')}
          allowClear
          style={{ width: 140 }}
          value={productType}
          onChange={(v) => { setProductType(v); setPage(1); }}
          options={productTypeOptions}
        />
        <Select
          placeholder={t('pendingOrders.planType')}
          allowClear
          style={{ width: 140 }}
          value={planType}
          onChange={(v) => { setPlanType(v); setPage(1); }}
          options={planTypeOptions}
        />
        <Input.Search
          placeholder={t('pendingOrders.searchPlaceholder')}
          allowClear
          style={{ width: 280 }}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
        {t('attribution.dateHint', { days: maxDays })}
      </Text>

      <Spin spinning={loading}>
        <ProTable
          rowKey="id"
          columns={tableColumns}
          dataSource={items}
          search={false}
          toolBarRender={false}
          components={components}
          scroll={{ x: scrollX }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '30', '50', '100', '200'],
            showTotal: (n) => t('table.total', { total: n }),
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </Spin>

      <OrderFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        order={editing}
        statusOptions={statusOptions}
        productTypeOptions={productTypeOptions}
        storeTypeOptions={storeTypeOptions}
        planTypeOptions={planTypeOptions}
        onSaved={refresh}
      />

      <Drawer
        title={t('pendingOrders.detail')}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={640}
      >
        <Spin spinning={detailLoading}>
          {detail && (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('pendingOrders.orderId')}>{detail.id}</Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.transactionId')}>
                {detail.transaction_id ? (
                  <Text copyable={{ text: detail.transaction_id }}>{detail.transaction_id}</Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.originalTransactionId')}>
                {detail.original_transaction_id || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.user')}>
                {detail.user
                  ? `${detail.user.nickname || detail.user.username || '-'} (#${detail.user.id})`
                  : t('pendingOrders.unbound')}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.status')}>
                <Tag color={STATUS_COLOR[detail.status] || 'default'}>
                  {pickLabel(detail.status_label, locale, detail.status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.product')}>
                {detail.product_name || detail.product?.title || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.productId')}>{detail.product_id || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.productType')}>
                {pickLabel(detail.product_type_label, locale, detail.product_type) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.planType')}>
                {pickLabel(detail.plan_type_label, locale, detail.plan_type) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.packageKey')}>{detail.package_key || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.storeType')}>
                {pickLabel(detail.store_type_label, locale, detail.store_type) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.price')}>{formatUsd(detail.price_usd)}</Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.credits')}>{detail.credits_amount ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.durationDays')}>{detail.duration_days ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={t('table.createdAt')}><FormatDate value={detail.created_at} locale={locale} /></Descriptions.Item>
              <Descriptions.Item label={t('table.updatedAt')}><FormatDate value={detail.updated_at} locale={locale} /></Descriptions.Item>
              <Descriptions.Item label={t('pendingOrders.callbackData')}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflow: 'auto' }}>
                  {stringifyCallback(detail.callback_data) || '-'}
                </pre>
              </Descriptions.Item>
            </Descriptions>
          )}
        </Spin>
      </Drawer>
    </div>
  );
}
