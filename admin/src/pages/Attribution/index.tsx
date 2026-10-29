import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable from '@ant-design/pro-table';
import { StatisticCard } from '@ant-design/pro-card';
import { Row, Col, Spin, Tag, Input, Select, Space, Typography, Tooltip, DatePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { adminFetchJson, showError } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';

const { RangePicker } = DatePicker;

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

function normalizeSummary(raw: Record<string, unknown>): Summary {
  const byEventType = toCountMap(raw.by_event_type);
  const totalFromTypes = Object.values(byEventType).reduce((sum, n) => sum + n, 0);
  const total = Number(raw.total);
  return {
    total: Number.isFinite(total) ? total : totalFromTypes,
    by_event_type: byEventType,
    by_install_source: toCountMap(raw.by_install_source),
    by_os: toCountMap(raw.by_os),
    with_ad_id: Number(raw.with_ad_id) || 0,
    with_gclid: Number(raw.with_gclid) || 0,
    with_gad_campaignid: Number(raw.with_gad_campaignid) || 0,
  };
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

const { Text } = Typography;

interface AttributionEvent {
  id: number;
  user_id: number | null;
  device_id: string;
  event_type: string;
  install_source: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  invite_code: string;
  gclid: string;
  gad_campaignid: string;
  ad_id: string;
  ad_id_type: string;
  idfv: string;
  android_id: string;
  network: string;
  login_method: string;
  app_version: string;
  os: string;
  os_version: string;
  device_model: string;
  locale: string;
  timezone: string;
  storefront_country: string;
  ip: string;
  ip_country: string;
  created_at: string;
}

interface Summary {
  total: number;
  by_event_type: Record<string, number>;
  by_install_source: Record<string, number>;
  by_os: Record<string, number>;
  with_ad_id: number;
  with_gclid: number;
  with_gad_campaignid?: number;
}

const EVENT_COLORS: Record<string, string> = {
  install: 'blue',
  register: 'green',
  login: 'cyan',
  purchase: 'gold',
  first_open: 'purple',
};

const SOURCE_COLORS: Record<string, string> = {
  ads: 'volcano',
  organic: 'green',
  invite: 'purple',
  referral: 'geekblue',
};

function shortId(v: string, n = 20) {
  return v.length > n ? `${v.substring(0, n)}…` : v;
}

function CopyId({ text, tag, color }: { text: string; tag: string; color: string }) {
  return (
    <Text copyable={{ text }} style={{ fontSize: 12 }}>
      <Tag color={color} style={{ marginRight: 4 }}>{tag}</Tag>
      {shortId(text)}
    </Text>
  );
}

export default function Attribution() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AttributionEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [eventType, setEventType] = useState<string | undefined>(undefined);
  const [adIdSearch, setAdIdSearch] = useState('');
  const [installSource, setInstallSource] = useState<string | undefined>(undefined);
  const [osFilter, setOsFilter] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [maxDays, setMaxDays] = useState(60);

  const loadFilterOptions = useCallback(async () => {
    try {
      const res = await adminFetchJson('/api/admin/attribution/filter-options');
      const data = pickObject<{ max_days?: number }>(res, 'max_days');
      if (data?.max_days && data.max_days > 0) setMaxDays(data.max_days);
    } catch {
      // 沿用默认 60 天
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const qs = new URLSearchParams();
      appendDateQuery(qs, dateRange);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await adminFetchJson(`/api/admin/attribution/summary${suffix}`);
      const data = pickObject<Record<string, unknown>>(res);
      if (data) setSummary(normalizeSummary(data));
    } catch (e: any) {
      showError(e.message);
    } finally {
      setSummaryLoading(false);
    }
  }, [dateRange]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('page_size', String(pageSize));
      appendDateQuery(params, dateRange);
      if (eventType) params.append('event_type', eventType);
      if (adIdSearch) params.append('ad_id', adIdSearch);
      if (installSource) params.append('install_source', installSource);
      if (osFilter) params.append('os', osFilter);

      const res = await adminFetchJson<{
        code: number;
        results: AttributionEvent[];
        pagination: { total: number; page: number; page_size: number; total_pages: number };
      }>(`/api/admin/attribution/events?${params.toString()}`);
      if (res?.results) {
        setItems(res.results);
        setTotal(res.pagination?.total ?? 0);
      }
    } catch (e: any) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, dateRange, eventType, adIdSearch, installSource, osFilter]);

  useEffect(() => {
    void loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 60,
    },
    {
      title: t('table.userId'),
      dataIndex: 'user_id',
      width: 80,
      render: (v: number | null) => v ?? <Text type="secondary">-</Text>,
    },
    {
      title: t('attribution.eventType'),
      dataIndex: 'event_type',
      width: 90,
      render: (v: string) => <Tag color={EVENT_COLORS[v] || 'default'}>{v}</Tag>,
    },
    {
      title: t('attribution.installSource'),
      dataIndex: 'install_source',
      width: 80,
      render: (v: string) =>
        v ? <Tag color={SOURCE_COLORS[v] || 'default'}>{v}</Tag> : '-',
    },
    {
      title: (
        <Tooltip title={t('attribution.colGclidTooltip')}>
          <span>{t('attribution.colGclid')}</span>
        </Tooltip>
      ),
      dataIndex: 'gclid',
      width: 200,
      render: (v: string | null) =>
        v ? <CopyId text={v} tag="gclid" color="purple" /> : <Text type="secondary">-</Text>,
    },
    {
      title: (
        <Tooltip title={t('attribution.colCampaignTooltip')}>
          <span>{t('attribution.colCampaign')}</span>
        </Tooltip>
      ),
      dataIndex: 'gad_campaignid',
      width: 140,
      render: (v: string | null) =>
        v ? <CopyId text={v} tag="camp" color="magenta" /> : <Text type="secondary">-</Text>,
    },
    {
      title: (
        <Tooltip title={t('attribution.colAdIdTooltip')}>
          <span>{t('attribution.colAdId')}</span>
        </Tooltip>
      ),
      dataIndex: 'ad_id',
      width: 200,
      render: (v: string | null, row: AttributionEvent) => {
        if (!v) return <Text type="secondary">-</Text>;
        const typeLabel = (row.ad_id_type || '').toLowerCase();
        const tag =
          typeLabel === 'gaid' || typeLabel === 'aaid'
            ? 'GAID'
            : typeLabel === 'idfa'
              ? 'IDFA'
              : row.ad_id_type || 'ad_id';
        return <CopyId text={v} tag={tag} color="orange" />;
      },
    },
    {
      title: (
        <Tooltip title={t('attribution.colIdfvTooltip')}>
          <span>{t('attribution.colIdfv')}</span>
        </Tooltip>
      ),
      dataIndex: 'idfv',
      width: 180,
      render: (v: string | null) =>
        v ? <CopyId text={v} tag="idfv" color="blue" /> : <Text type="secondary">-</Text>,
    },
    {
      title: 'UTM',
      width: 160,
      render: (_: unknown, row: AttributionEvent) => {
        const parts = [row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean);
        if (!parts.length) return '-';
        return (
          <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: parts.join(' / ') }}>
            {parts.join(' / ')}
          </Text>
        );
      },
    },
    {
      title: 'OS',
      dataIndex: 'os',
      width: 70,
      render: (v: string, row: AttributionEvent) =>
        v ? `${v} ${row.os_version || ''}`.trim() : '-',
    },
    {
      title: 'Device',
      dataIndex: 'device_model',
      width: 100,
      render: (v: string | null) => v || '-',
    },
    {
      title: t('table.country'),
      width: 70,
      render: (_: unknown, row: AttributionEvent) =>
        row.ip_country || row.storefront_country || '-',
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 120,
      render: (v: string | null) => v || '-',
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      width: 150,
      render: (v: string) => <FormatDate value={v} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2>{t('attribution.title')}</h2>

      <Spin spinning={summaryLoading}>
        {summary && (
          <Row gutter={16} style={{ marginBottom: 24 }} key={dateRange ? dateRange.join('_') : 'all'}>
            <Col span={4}>
              <StatisticCard statistic={{ title: t('attribution.totalEvents'), value: summary.total }} />
            </Col>
            <Col span={4}>
              <StatisticCard statistic={{ title: t('attribution.installs'), value: summary.by_event_type?.install || 0 }} />
            </Col>
            <Col span={4}>
              <StatisticCard statistic={{ title: t('attribution.registers'), value: summary.by_event_type?.register || 0 }} />
            </Col>
            <Col span={4}>
              <StatisticCard statistic={{ title: t('attribution.purchases'), value: summary.by_event_type?.purchase || 0 }} />
            </Col>
            <Col span={4}>
              <StatisticCard
                statistic={{
                  title: t('attribution.withGclid'),
                  value: summary.with_gclid || 0,
                }}
              />
            </Col>
            <Col span={4}>
              <StatisticCard
                statistic={{
                  title: t('attribution.withAdId'),
                  value: summary.with_ad_id,
                }}
              />
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
          placeholder={t('attribution.eventType')}
          allowClear
          style={{ width: 140 }}
          value={eventType}
          onChange={(v) => { setEventType(v); setPage(1); }}
          options={[
            { value: 'install', label: t('attribution.eventInstall') },
            { value: 'register', label: t('attribution.eventRegister') },
            { value: 'login', label: t('attribution.eventLogin') },
            { value: 'purchase', label: t('attribution.eventPurchase') },
            { value: 'first_open', label: t('attribution.eventFirstOpen') },
          ]}
        />
        <Select
          placeholder={t('attribution.installSource')}
          allowClear
          style={{ width: 130 }}
          value={installSource}
          onChange={(v) => { setInstallSource(v); setPage(1); }}
          options={[
            { value: 'ads', label: t('attribution.sourceAds') },
            { value: 'organic', label: t('attribution.sourceOrganic') },
            { value: 'invite', label: t('attribution.sourceInvite') },
            { value: 'referral', label: t('attribution.sourceReferral') },
          ]}
        />
        <Select
          placeholder="OS"
          allowClear
          style={{ width: 110 }}
          value={osFilter}
          onChange={(v) => { setOsFilter(v); setPage(1); }}
          options={[
            { value: 'ios', label: t('attribution.osIos') },
            { value: 'android', label: t('attribution.osAndroid') },
          ]}
        />
        <Input.Search
          placeholder={t('attribution.searchPlaceholder')}
          allowClear
          style={{ width: 300 }}
          onSearch={(v) => { setAdIdSearch(v); setPage(1); }}
        />
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
        {t('attribution.dateHint', { days: maxDays })}
      </Text>

      <Spin spinning={loading}>
        <ProTable
          rowKey="id"
          columns={columns as any}
          dataSource={items}
          search={false}
          toolBarRender={false}
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </Spin>
    </div>
  );
}
