import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatisticCard } from '@ant-design/pro-card';
import ProTable, { type ProColumns } from '@ant-design/pro-table';
import { Row, Col, Spin, DatePicker, Button, Space, Select, Input, Tabs, Tooltip } from 'antd';
import {
  UserOutlined,
  MessageOutlined,
  HeartOutlined,
  BookOutlined,
  TeamOutlined,
  EyeOutlined,
  LikeOutlined,
  CommentOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { adminFetchJson, adminFetch, showError, showSuccess } from '../../api/request';
import type {
  PaginatedResponse,
  StatsFunnelItem,
  StatsModule,
  StatsOverview,
  StatsRetentionItem,
  StatsRevenueItem,
  StatsTableRow,
  StatsUserType,
} from '../../types';
import {
  DEFAULT_APP_KEY,
  FALLBACK_APP_OPTIONS,
  appLabel,
  normalizeAppKey,
  parseApps,
  type AppOption,
} from '../Products/appKey';

const { RangePicker } = DatePicker;

const PAGE_SIZE = 10;
const MAX_RANGE_DAYS = 60;
// const FUNNEL_FETCH_SIZE = 200;

function utcTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function utcDaysAgoStr(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatPct(value: unknown) {
  return `${num(value).toFixed(2)}%`;
}

function formatUsd(value: unknown) {
  return `$${num(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCountRate(count: unknown, rate: unknown) {
  return `${formatPct(rate)} (${num(count)})`;
}

function funnelDisplay(row: StatsFunnelItem, key: keyof StatsFunnelItem) {
  const text = row[key];
  return typeof text === 'string' && text.trim() ? text : '—';
}

const RETENTION_DAYS = [0, 1, 2, 3, 4, 5, 6, 7, 30] as const;

function retentionValue(row: StatsRetentionItem, day: (typeof RETENTION_DAYS)[number]) {
  return formatCountRate(row[`d${day}_count`], row[`d${day}_rate`]);
}

function parseFilename(header: string | null, fallback: string) {
  if (!header) return fallback;
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/['"]/g, '').trim());
    } catch {
      /* ignore */
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  if (plain?.[1]) return plain[1].replace(/['"]/g, '').trim();
  return fallback;
}

function getRowKey(row: StatsTableRow, index?: number) {
  if ('cohort_date' in row) return String(row.cohort_date);
  if ('event_name_en' in row) return `${row.date}-${row.event_name_en}-${index ?? 0}`;
  if ('date' in row) {
    const appKey = 'app_key' in row ? String((row as { app_key?: string }).app_key || '') : '';
    return `${row.date}-${appKey}-${index ?? 0}`;
  }
  return String(index ?? 0);
}

/* 漏斗图暂时隐藏
const FUNNEL_STEPS: Array<{
  key: keyof StatsFunnelItem;
  labelKey: string;
  color: string;
}> = [
  { key: 'login_users', labelKey: 'analytics.funnelLogin', color: '#1677ff' },
  { key: 'message_users', labelKey: 'analytics.funnelMessage', color: '#4096ff' },
  { key: 'free_exhausted_users', labelKey: 'analytics.funnelFreeExhausted', color: '#13c2c2' },
  { key: 'pay_popup_users', labelKey: 'analytics.funnelPayPopup', color: '#faad14' },
  { key: 'pay_click_users', labelKey: 'analytics.funnelPayClick', color: '#ff7a45' },
  { key: 'recharge_users', labelKey: 'analytics.funnelRecharge', color: '#52c41a' },
];

function FunnelChart({
  rows,
  loading,
  emptyText,
  t,
}: {
  rows: StatsFunnelItem[];
  loading: boolean;
  emptyText: string;
  t: (key: string) => string;
}) {
  const totals = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const step of FUNNEL_STEPS) acc[step.key] = 0;
    for (const row of rows) {
      for (const step of FUNNEL_STEPS) {
        acc[step.key] += num(row[step.key]);
      }
    }
    return acc;
  }, [rows]);

  const base = Math.max(totals.login_users || 0, 1);

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 24, padding: '8px 0 4px' }}>
        {rows.length === 0 && !loading ? (
          <div style={{ color: '#999', padding: '12px 0' }}>{emptyText}</div>
        ) : (
          FUNNEL_STEPS.map((step, index) => {
            const value = totals[step.key] || 0;
            const prev = index === 0 ? value : totals[FUNNEL_STEPS[index - 1].key] || 0;
            const fromPrev = prev > 0 ? (value / prev) * 100 : 0;
            const fromLogin = (value / base) * 100;
            const widthPct = Math.min(100, Math.max(18, fromLogin));
            const inset = ((100 - widthPct) / 2).toFixed(2);
            return (
              <div key={step.key} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                    fontSize: 13,
                    color: '#333',
                  }}
                >
                  <span>
                    {index + 1}. {t(step.labelKey)}
                  </span>
                  <span>
                    {value.toLocaleString()}
                    {index > 0 ? ` · ${fromPrev.toFixed(1)}%` : ''}
                  </span>
                </div>
                <div
                  style={{
                    height: 36,
                    background: step.color,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    clipPath: `polygon(${inset}% 0, ${100 - Number(inset)}% 0, ${100 - Number(inset) - 2}% 100%, ${Number(inset) + 2}% 100%)`,
                    transition: 'clip-path 0.3s ease',
                  }}
                >
                  {fromLogin.toFixed(1)}%
                </div>
              </div>
            );
          })
        )}
      </div>
    </Spin>
  );
}
*/

export default function Analytics() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [tab, setTab] = useState<StatsModule>('dau');
  const [dates, setDates] = useState<[string, string]>(() => [utcDaysAgoStr(29), utcTodayStr()]);
  const [userType, setUserType] = useState<StatsUserType>('all');
  const [appKey, setAppKey] = useState(DEFAULT_APP_KEY);
  const [appOptions, setAppOptions] = useState<AppOption[]>(FALLBACK_APP_OPTIONS);
  const [eventInput, setEventInput] = useState('');
  const [event, setEvent] = useState('');
  const [exporting, setExporting] = useState<'current' | 'all' | false>(false);
  // const [funnelRows, setFunnelRows] = useState<StatsFunnelItem[]>([]);
  // const [funnelChartLoading, setFunnelChartLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setEvent(eventInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [eventInput]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetchJson<{ apps?: unknown }>('/api/admin/stats/filter-options');
        if (cancelled) return;
        setAppOptions(parseApps(res?.apps));
      } catch {
        if (!cancelled) setAppOptions(FALLBACK_APP_OPTIONS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await adminFetchJson<{ results?: StatsOverview }>('/api/admin/stats/overview');
      if (res?.results) setOverview(res.results);
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setOverviewLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  // const loadFunnelChart = useCallback(async () => {
  //   setFunnelChartLoading(true);
  //   try {
  //     const qs = new URLSearchParams({
  //       start_date: dates[0],
  //       end_date: dates[1],
  //       user_type: userType,
  //       page: '1',
  //       page_size: String(FUNNEL_FETCH_SIZE),
  //     });
  //     const res = await adminFetchJson<PaginatedResponse<StatsFunnelItem>>(
  //       `/api/admin/stats/funnel?${qs.toString()}`,
  //     );
  //     setFunnelRows(res?.results ?? []);
  //   } catch {
  //     showError(t('toast.loadFailed') as string);
  //     setFunnelRows([]);
  //   } finally {
  //     setFunnelChartLoading(false);
  //   }
  // }, [dates, userType, t]);

  // useEffect(() => {
  //   if (tab !== 'funnel') return;
  //   const timer = window.setTimeout(() => {
  //     void loadFunnelChart();
  //   }, 0);
  //   return () => window.clearTimeout(timer);
  // }, [tab, loadFunnelChart]);

  const buildFilterParams = useCallback(
    (module: StatsModule) => {
      const qs = new URLSearchParams({
        start_date: dates[0],
        end_date: dates[1],
        // 不传 = 主包；显式传 trandsai/kaya。无「全部合计」。
        app_key: normalizeAppKey(appKey),
      });
      if (module === 'events' || module === 'funnel') {
        qs.set('user_type', userType);
      }
      if (module === 'events' && event) {
        qs.set('event', event);
      }
      return qs;
    },
    [dates, userType, event, appKey],
  );

  const fetchTable = useCallback(
    async (params: Record<string, unknown>) => {
      const module = String(params.module || tab) as StatsModule;
      const pageNum = Math.max(1, Number(params.current) || 1);
      const size = Math.min(200, Math.max(1, Number(params.pageSize) || PAGE_SIZE));
      const qs = buildFilterParams(module);
      qs.set('page', String(pageNum));
      qs.set('page_size', String(size));
      try {
        const res = await adminFetchJson<PaginatedResponse<StatsTableRow>>(
          `/api/admin/stats/${module}?${qs.toString()}`,
        );
        return {
          data: res?.results ?? [],
          success: true,
          total: res?.pagination?.total ?? 0,
        };
      } catch {
        showError(t('toast.loadFailed') as string);
        return { data: [], success: false, total: 0 };
      }
    },
    [tab, buildFilterParams, t],
  );

  const handleExport = async (scope: 'current' | 'all') => {
    setExporting(scope);
    try {
      const qs = new URLSearchParams({
        start_date: dates[0],
        end_date: dates[1],
      });
      if (userType) qs.set('user_type', userType);
      if (event) qs.set('event', event);
      qs.set('app_key', normalizeAppKey(appKey));

      let url: string;
      if (scope === 'all') {
        url = `/api/admin/stats/export-all?${qs.toString()}`;
      } else {
        qs.set('module', tab);
        url = `/api/admin/stats/export?${qs.toString()}`;
      }

      const res = await adminFetch(url);
      if (!res || !res.ok) {
        let msg = t('toast.exportFailed') as string;
        try {
          const err = await res?.json();
          msg = err?.message || err?.error || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = parseFilename(
        res.headers.get('content-disposition'),
        scope === 'all'
          ? `数据统计_全部_${dates[0]}_${dates[1]}.xlsx`
          : `stats_${tab}_${dates[0]}_${dates[1]}.xlsx`,
      );
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);
      showSuccess(t('toast.exportSuccess') as string);
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.exportFailed') as string));
    } finally {
      setExporting(false);
    }
  };

  const cards = useMemo(
    () => [
      {
        key: 'companion_count' as const,
        label: t('stat.companionCount'),
        value: num(overview?.companion_count),
        icon: <UserOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'total_turns' as const,
        label: t('stat.totalTurns'),
        value: num(overview?.total_turns),
        icon: <MessageOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'avg_affection' as const,
        label: t('stat.avgAffection'),
        value: num(overview?.avg_affection),
        precision: 2,
        icon: <HeartOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'knowledge_count' as const,
        label: t('stat.knowledgeEntries'),
        value: num(overview?.knowledge_count),
        icon: <BookOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'user_count' as const,
        label: t('stat.userCount'),
        value: num(overview?.user_count),
        icon: <TeamOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'avg_open_count' as const,
        label: t('stat.avgOpenCount'),
        value: num(overview?.avg_open_count),
        precision: 2,
        icon: <EyeOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'like_user_count' as const,
        label: t('stat.likeUserCount'),
        value: num(overview?.like_user_count),
        icon: <LikeOutlined style={{ fontSize: 24 }} />,
      },
      {
        key: 'message_user_count' as const,
        label: t('stat.messageUserCount'),
        value: num(overview?.message_user_count),
        icon: <CommentOutlined style={{ fontSize: 24 }} />,
      },
    ],
    [overview, t],
  );

  const columns = useMemo((): ProColumns<StatsTableRow>[] => {
    if (tab === 'dau') {
      return [
        { title: t('analytics.dauDate'), dataIndex: 'date', key: 'date', width: 120 },
        {
          title: t('analytics.appKey'),
          dataIndex: 'app_key',
          key: 'app_key',
          width: 120,
          render: (_, r) => {
            const key =
              'app_key' in r
                ? String((r as { app_key?: string }).app_key || '')
                : '';
            return appLabel(appOptions, key || appKey);
          },
        },
        { title: t('analytics.openDevices'), dataIndex: 'open_devices', key: 'open_devices', width: 120 },
        { title: t('analytics.loginUids'), dataIndex: 'login_uids', key: 'login_uids', width: 120 },
        { title: t('analytics.activeUsers'), dataIndex: 'active_users', key: 'active_users', width: 120 },
        { title: t('analytics.newUsers'), dataIndex: 'new_users', key: 'new_users', width: 120 },
      ];
    }
    if (tab === 'retention') {
      return [
        { title: t('analytics.cohortDate'), dataIndex: 'cohort_date', key: 'cohort_date', width: 120, fixed: 'left' },
        { title: t('analytics.newUsers'), dataIndex: 'new_users', key: 'new_users', width: 100 },
        ...RETENTION_DAYS.map((day) => ({
          title: t(`analytics.retentionD${day}`),
          key: `d${day}`,
          width: 140,
          render: (_: unknown, r: StatsTableRow) => retentionValue(r as StatsRetentionItem, day),
        })),
      ];
    }
    if (tab === 'events') {
      return [
        { title: t('analytics.dauDate'), dataIndex: 'date', key: 'date', width: 120 },
        { title: t('analytics.eventNameZh'), dataIndex: 'event_name_zh', key: 'event_name_zh' },
        { title: t('analytics.eventNameEn'), dataIndex: 'event_name_en', key: 'event_name_en' },
        { title: t('analytics.pv'), dataIndex: 'pv', key: 'pv', width: 100 },
        { title: t('analytics.uv'), dataIndex: 'uv', key: 'uv', width: 100 },
      ];
    }
    if (tab === 'funnel') {
      const col = (
        title: string,
        countKey: keyof StatsFunnelItem,
        displayKey: keyof StatsFunnelItem,
        width = 150,
      ): ProColumns<StatsTableRow> => ({
        title,
        dataIndex: countKey,
        key: countKey,
        width,
        sorter: (a, b) => num((a as StatsFunnelItem)[countKey]) - num((b as StatsFunnelItem)[countKey]),
        render: (_, r) => funnelDisplay(r as StatsFunnelItem, displayKey),
      });
      return [
        { title: t('analytics.dauDate'), dataIndex: 'date', key: 'date', width: 120, fixed: 'left' },
        col(t('analytics.loginUsers') as string, 'login_users', 'login_users_display'),
        col(t('analytics.messageUsers') as string, 'message_users', 'message_users_display'),
        col(t('analytics.turn3') as string, 'turn3_users', 'turn3_display'),
        col(t('analytics.turn5') as string, 'turn5_users', 'turn5_display'),
        col(t('analytics.freeExhausted') as string, 'free_exhausted_users', 'free_exhausted_display'),
        col(t('analytics.payPopup') as string, 'pay_popup_users', 'pay_popup_display'),
        col(t('analytics.payClick') as string, 'pay_click_users', 'pay_click_display'),
        col(t('analytics.recharge') as string, 'recharge_users', 'recharge_display'),
        col(t('analytics.surveyFail') as string, 'survey_fail', 'survey_fail_display'),
      ];
    }
    return [
      { title: t('analytics.dauDate'), dataIndex: 'date', key: 'date', width: 120, fixed: 'left' },
      {
        title: t('analytics.totalRevenue'),
        dataIndex: 'total_revenue',
        key: 'total_revenue',
        width: 120,
        render: (_, r) => formatUsd((r as StatsRevenueItem).total_revenue),
      },
      {
        title: t('analytics.allPayRate'),
        dataIndex: 'all_pay_rate',
        key: 'all_pay_rate',
        width: 140,
        render: (_, r) => formatPct((r as StatsRevenueItem).all_pay_rate),
      },
      {
        title: t('analytics.peopleCount'),
        dataIndex: 'all_paying_users',
        key: 'all_paying_users',
        width: 80,
      },
      {
        title: t('analytics.newPayRate'),
        dataIndex: 'new_pay_rate',
        key: 'new_pay_rate',
        width: 130,
        render: (_, r) => formatPct((r as StatsRevenueItem).new_pay_rate),
      },
      {
        title: t('analytics.peopleCount'),
        dataIndex: 'new_paying_users',
        key: 'new_paying_users',
        width: 80,
      },
      {
        title: t('analytics.oldPayRate'),
        dataIndex: 'old_pay_rate',
        key: 'old_pay_rate',
        width: 130,
        render: (_, r) => formatPct((r as StatsRevenueItem).old_pay_rate),
      },
      {
        title: t('analytics.peopleCount'),
        dataIndex: 'old_paying_users',
        key: 'old_paying_users',
        width: 80,
      },
      {
        title: t('analytics.allArppu'),
        dataIndex: 'all_arppu',
        key: 'all_arppu',
        width: 140,
        render: (_, r) => formatUsd((r as StatsRevenueItem).all_arppu),
      },
      {
        title: t('analytics.arpu'),
        dataIndex: 'all_arpu',
        key: 'all_arpu',
        width: 90,
        render: (_, r) => formatUsd((r as StatsRevenueItem).all_arpu),
      },
      {
        title: t('analytics.newArppu'),
        dataIndex: 'new_arppu',
        key: 'new_arppu',
        width: 130,
        render: (_, r) => formatUsd((r as StatsRevenueItem).new_arppu),
      },
      {
        title: t('analytics.arpu'),
        dataIndex: 'new_arpu',
        key: 'new_arpu',
        width: 90,
        render: (_, r) => formatUsd((r as StatsRevenueItem).new_arpu),
      },
      {
        title: t('analytics.oldArppu'),
        dataIndex: 'old_arppu',
        key: 'old_arppu',
        width: 130,
        render: (_, r) => formatUsd((r as StatsRevenueItem).old_arppu),
      },
      {
        title: t('analytics.arpu'),
        dataIndex: 'old_arpu',
        key: 'old_arpu',
        width: 90,
        render: (_, r) => formatUsd((r as StatsRevenueItem).old_arpu),
      },
    ];
  }, [tab, t, appOptions, appKey]);

  const showUserType = tab === 'events' || tab === 'funnel';
  const showEvent = tab === 'events';
  const tableScrollX = tab === 'revenue' ? 1680 : tab === 'funnel' ? 1600 : tab === 'retention' ? 1480 : tab === 'dau' ? 720 : undefined;

  return (
    <div>
      <h2>{t('page.analytics')}</h2>

      <Spin spinning={overviewLoading}>
        <Row gutter={[16, 16]} style={{ marginTop: 16, marginBottom: 24 }}>
          {cards.map((card) => {
            const hint = overview?.definitions?.[card.key];
            return (
              <Col xs={24} sm={12} lg={6} key={card.key}>
                <StatisticCard
                  statistic={{
                    title: (
                      <Tooltip title={hint || t(`stat.hint.${card.key}`)}>
                        <span>
                          {card.label}
                          <QuestionCircleOutlined style={{ marginLeft: 6, color: '#8c8c8c' }} />
                        </span>
                      </Tooltip>
                    ),
                    value: card.value,
                    precision: card.precision,
                    icon: card.icon,
                  }}
                />
              </Col>
            );
          })}
        </Row>
      </Spin>

      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key as StatsModule);
        }}
        items={[
          { key: 'dau', label: t('analytics.tabDau') },
          { key: 'retention', label: t('analytics.tabRetention') },
          { key: 'events', label: t('analytics.tabEvents') },
          { key: 'funnel', label: t('analytics.tabFunnel') },
          { key: 'revenue', label: t('analytics.tabRevenue') },
        ]}
      />

      <Space style={{ marginBottom: 16 }} wrap size={[16, 8]} align="center">
        <Space size={8}>
          <span>{t('table.dateRange')}</span>
          <RangePicker
            allowClear={false}
            value={[dayjs(dates[0]), dayjs(dates[1])]}
            disabledDate={(current: Dayjs, info?: { from?: Dayjs }) => {
              if (!current) return false;
              if (current.format('YYYY-MM-DD') > utcTodayStr()) return true;
              if (info?.from) {
                return Math.abs(current.diff(info.from, 'day')) > MAX_RANGE_DAYS - 1;
              }
              return false;
            }}
            onChange={(vals) => {
              if (vals?.[0] && vals[1]) {
                const start = vals[0].format('YYYY-MM-DD');
                const end = vals[1].format('YYYY-MM-DD');
                if (vals[1].diff(vals[0], 'day') > MAX_RANGE_DAYS - 1) {
                  showError(t('analytics.dateRangeMax') as string);
                  return;
                }
                setDates([start, end]);
              }
            }}
          />
        </Space>
        <Space size={8}>
          <span>{t('analytics.appKey')}</span>
          <Select
            value={normalizeAppKey(appKey)}
            style={{ width: 160 }}
            onChange={(val) => setAppKey(normalizeAppKey(val))}
            options={appOptions}
          />
        </Space>
        {showUserType && (
          <Space size={8}>
            <span>{t('analytics.userType')}</span>
            <Select
              value={userType}
              style={{ width: 140 }}
              onChange={(val) => setUserType(val)}
              options={[
                { label: t('analytics.userTypeAll'), value: 'all' },
                { label: t('analytics.userTypeNew'), value: 'new' },
                { label: t('analytics.userTypeOld'), value: 'old' },
              ]}
            />
          </Space>
        )}
        {showEvent && (
          <Space size={8}>
            <span>{t('analytics.eventFilter')}</span>
            <Input.Search
              allowClear
              placeholder={t('analytics.eventPlaceholder') as string}
              style={{ width: 240 }}
              value={eventInput}
              onChange={(e) => setEventInput(e.target.value)}
              onSearch={(val) => setEvent(val.trim())}
            />
          </Space>
        )}
        <Button
          icon={<DownloadOutlined />}
          loading={exporting === 'current'}
          disabled={Boolean(exporting)}
          onClick={() => void handleExport('current')}
        >
          {t('btn.exportCurrentExcel')}
        </Button>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={exporting === 'all'}
          disabled={Boolean(exporting)}
          onClick={() => void handleExport('all')}
        >
          {t('btn.exportAllExcel')}
        </Button>
      </Space>

      {/* 漏斗图暂时隐藏
      {tab === 'funnel' && (
        <FunnelChart
          rows={funnelRows}
          loading={funnelChartLoading}
          emptyText={t('analytics.noData') as string}
          t={(key) => t(key) as string}
        />
      )}
      */}

      <ProTable<StatsTableRow>
        key={tab}
        rowKey={getRowKey}
        columns={columns}
        request={fetchTable}
        params={{
          module: tab,
          start_date: dates[0],
          end_date: dates[1],
          user_type: userType,
          event,
          app_key: appKey,
        }}
        search={false}
        options={false}
        headerTitle={false}
        toolBarRender={false}
        scroll={tableScrollX ? { x: tableScrollX } : undefined}
        pagination={{
          defaultPageSize: PAGE_SIZE,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total) => t('table.total', { total }),
        }}
      />
    </div>
  );
}
