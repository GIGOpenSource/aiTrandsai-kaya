import { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ProColumns } from '@ant-design/pro-table';
import type { ProFormInstance } from '@ant-design/pro-components';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Popconfirm, Space, Modal, Form, InputNumber, Select, Image, Progress, Typography, Radio, Upload, Switch, Tag } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  UploadOutlined,
  FileExcelOutlined,
} from '@ant-design/icons';
import { adminFetchJson, adminFetch, getToken, showSuccess, showError, showWarning } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ContentCompanion } from '../../types';
import { getAppLanguage } from '../../locales';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { CONTENT_LANGS, normalizeCompanion, unwrapResults } from './contentApi';
import { isHasOpsAdminValue, loadAdminOptions, opsAdminLabel, parseOpsAdminIds } from '../ChatSessions/imApi';
import { formatOrientation } from '../Users/userFields';

type ImportApiBody = {
  code?: number;
  message?: string;
  results?: {
    total?: number;
    created?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
    errors?: Array<{ row?: number; id?: string; name?: string; reason?: string }>;
  };
};

type SortMap = Record<string, 'ascend' | 'descend' | null | undefined>;

function resolveCompanionSort(
  sort?: SortMap,
  creditSort?: string,
): {
  sortBy: 'age' | 'created_at' | 'total_credit_revenue' | 'month_credit_revenue';
  sortOrder: 'asc' | 'desc';
} {
  if (creditSort === 'total_desc') return { sortBy: 'total_credit_revenue', sortOrder: 'desc' };
  if (creditSort === 'total_asc') return { sortBy: 'total_credit_revenue', sortOrder: 'asc' };
  if (creditSort === 'month_desc') return { sortBy: 'month_credit_revenue', sortOrder: 'desc' };
  if (creditSort === 'month_asc') return { sortBy: 'month_credit_revenue', sortOrder: 'asc' };

  const entry = Object.entries(sort || {}).find(
    ([, order]) => order === 'ascend' || order === 'descend',
  );
  if (!entry) {
    return { sortBy: 'created_at', sortOrder: 'desc' };
  }
  const [field, order] = entry;
  const normalized = String(field).toLowerCase();
  let sortBy: 'age' | 'created_at' | 'total_credit_revenue' | 'month_credit_revenue' = 'created_at';
  if (normalized.includes('month_credit_revenue')) sortBy = 'month_credit_revenue';
  else if (normalized.includes('total_credit_revenue')) sortBy = 'total_credit_revenue';
  else if (/(^|[,.[\]])age($|[,.\]])/.test(normalized)) sortBy = 'age';
  return {
    sortBy,
    sortOrder: order === 'ascend' ? 'asc' : 'desc',
  };
}

async function downloadXlsx(url: string, fallbackName: string) {
  const res = await adminFetch(url);
  if (!res || !res.ok) throw new Error('download failed');
  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download =
    res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function parseTagKeys(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,，]/);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const key = String(item).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** URLSearchParams 会把中文编成 %E4..；这里还原成 tags=中东24，只保留 & = ? # 等分隔符编码。 */
function toRequestQuery(qs: URLSearchParams) {
  const raw = qs.toString();
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function CompanionsList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<ContentCompanion>({
      listPath: '/companions',
      getRowId: (row) => row.id,
      fetchRow: async (id) => {
        const res = await adminFetchJson(`/api/admin/content/companions/${id}`);
        const raw = unwrapResults<ContentCompanion>(res) ?? (res as ContentCompanion | undefined);
        return raw ? normalizeCompanion(raw) : undefined;
      },
    });
  const pagination = useTablePagination(20);
  const locale = getAppLanguage();
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchStatus, setBatchStatus] = useState('');
  const [excelLoading, setExcelLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [adminOptions, setAdminOptions] = useState<{ value: number; label: string }[]>([]);
  const [opsTagOptions, setOpsTagOptions] = useState<{ value: string; label: string }[]>([]);
  const [opsTagLabelMap, setOpsTagLabelMap] = useState<Record<string, string>>({});
  const [listFilters, setListFilters] = useState<{
    language?: string;
    tier?: string;
    gender?: string;
    is_active?: string;
    companion_id?: string;
    created_by?: string;
    has_ops_admin?: string;
    ops_admin_id?: string;
    tags?: string[];
    sort_by?: string;
    sort_order?: string;
  }>({});
  const [form] = Form.useForm();
  const searchFormRef = useRef<ProFormInstance>(undefined);
  const [opsFilterLock, setOpsFilterLock] = useState({ hasOpsAdmin: false, opsAdmin: false });
  const batchMode = (Form.useWatch('mode', form) as 'single' | 'all' | undefined) ?? 'single';

  useEffect(() => {
    void loadAdminOptions().then(setAdminOptions);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetchJson('/api/admin/recommend/tag-defs?side=agent');
        const rows = (unwrapResults<{ key: string; group: string; label_zh?: string; label_en?: string; enabled?: boolean }[]>(res) ??
          (Array.isArray(res) ? res : [])) as Array<{
          key: string;
          group: string;
          label_zh?: string;
          label_en?: string;
          enabled?: boolean;
        }>;
        const opsRows = rows.filter((d) => d.group === 'ops' && d.key);
        const labels: Record<string, string> = {};
        setOpsTagOptions(
          opsRows.map((d) => {
            const name = (locale === 'en' ? d.label_en : d.label_zh) || '';
            labels[d.key] = name || d.key;
            return {
              value: d.key,
              label: name && name !== d.key ? `${name} (${d.key})` : d.key,
            };
          }),
        );
        setOpsTagLabelMap(labels);
      } catch {
        /* ignore */
      }
    })();
  }, [locale]);

  const languageValueEnum = useMemo(
    () => Object.fromEntries(CONTENT_LANGS.map((item) => [item.value, { text: t(`lang.${item.value}`) }])),
    [t],
  );

  const tierValueEnum = useMemo(
    () => ({
      s: { text: t('tier.s') },
      featured: { text: t('tier.featured') },
      candidate: { text: t('tier.candidate') },
      ad: { text: t('tier.ad') },
      ops: { text: t('tier.ops') },
    }),
    [t],
  );

  const genderValueEnum = useMemo(
    () => ({
      女: { text: t('gender.female') },
      男: { text: t('gender.male') },
    }),
    [t],
  );

  const activeValueEnum = useMemo(
    () => ({
      true: { text: t('content.active') },
      false: { text: t('content.inactive') },
    }),
    [t],
  );

  const creditSortValueEnum = useMemo(
    () => ({
      total_desc: { text: t('content.creditSortTotalDesc') },
      total_asc: { text: t('content.creditSortTotalAsc') },
      month_desc: { text: t('content.creditSortMonthDesc') },
      month_asc: { text: t('content.creditSortMonthAsc') },
    }),
    [t],
  );

  const hasOpsAdminValueEnum = useMemo(
    () => ({
      true: { text: t('content.hasOpsAdminYes') },
      false: { text: t('content.hasOpsAdminNo') },
    }),
    [t],
  );

  const handleToggleActive = useCallback(
    async (id: string, isActive: boolean) => {
      try {
        const res = await adminFetch(`/api/admin/content/companions/${id}/active`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: isActive }),
        });
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
    [actionRef, t],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await adminFetch(`/api/admin/companions/${id}`, { method: 'DELETE' });
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
    [actionRef, t],
  );

  const columns: ProColumns<ContentCompanion>[] = useMemo(
    () => [
      {
        title: t('table.avatar'),
        key: 'avatar',
        width: 70,
        search: false,
        render: (_: unknown, record: ContentCompanion) => (
          record.avatar_generating ? (
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="animate-spin" style={{ width: 20, height: 20, border: '2px solid #f0f0f0', borderTopColor: '#ff69b4', borderRadius: '50%' }}></div>
            </div>
          ) : (
            <Image
              src={resolveAdminMediaUrl(record.avatar_url || record.avatar) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${record.id}`}
              alt={record.name}
              width={48}
              height={48}
              style={{
                borderRadius: '50%',
                objectFit: 'cover',
                opacity: record.is_active === false ? 0.45 : 1,
              }}
              preview={false}
              fallback="https://api.dicebear.com/7.x/avataaars/svg?seed=fallback"
            />
          )
        ),
      },
      { title: t('table.id'), dataIndex: 'id', key: 'id', width: 100, hideInSearch: true },
      {
        title: t('table.id'),
        dataIndex: 'companion_id',
        key: 'companion_id',
        hideInTable: true,
        order: 1,
      },
      { title: t('table.name'), dataIndex: 'name', key: 'name', search: false },
      {
        title: t('table.gender'),
        dataIndex: 'gender',
        key: 'gender',
        width: 80,
        valueType: 'select',
        valueEnum: genderValueEnum,
        order: 2,
      },
      {
        title: t('table.sexualOrientation'),
        dataIndex: 'sexual_orientation',
        key: 'sexual_orientation',
        width: 110,
        search: false,
        render: (_: unknown, record: ContentCompanion) =>
          formatOrientation(record.sexual_orientation, t),
      },
      {
        title: t('table.age'),
        dataIndex: 'age',
        key: 'age',
        width: 80,
        search: false,
        sorter: true,
      },
      { title: t('table.city'), dataIndex: 'city', key: 'city', search: false },
      {
        title: t('table.language'),
        dataIndex: 'language',
        key: 'language',
        width: 100,
        valueType: 'select',
        valueEnum: languageValueEnum,
        order: 3,
      },
      {
        title: t('table.tier'),
        dataIndex: 'tier',
        key: 'tier',
        width: 100,
        hideInSearch: true,
        render: (_: unknown, record: ContentCompanion) => {
          const tier = (record.tier || 'featured').toLowerCase();
          const key = `tier.${tier}`;
          const label = t(key);
          return label === key ? tier : label;
        },
      },
      {
        title: t('content.filterType'),
        dataIndex: 'type',
        key: 'type',
        hideInTable: true,
        valueType: 'select',
        valueEnum: tierValueEnum,
        order: 4,
        search: {
          transform: (value: string) => ({ type: value, tier: value }),
        },
      },
      {
        title: t('table.status'),
        dataIndex: 'is_active',
        key: 'is_active',
        width: 100,
        valueType: 'select',
        valueEnum: activeValueEnum,
        order: 5,
        search: {
          transform: (value: string | boolean) => ({ is_active: String(value) }),
        },
        render: (_: unknown, record: ContentCompanion) =>
          record.is_active === false ? (
            <Tag>{t('content.inactive')}</Tag>
          ) : (
            <Tag color="success">{t('content.active')}</Tag>
          ),
      },
      {
        title: t('content.creditSort'),
        dataIndex: 'credit_sort',
        key: 'credit_sort',
        hideInTable: true,
        valueType: 'select',
        valueEnum: creditSortValueEnum,
        order: 6,
        search: {
          transform: (value: string) => ({ credit_sort: value }),
        },
      },
      {
        title: t('content.totalCreditRevenue'),
        dataIndex: 'total_credit_revenue',
        key: 'total_credit_revenue',
        width: 130,
        search: false,
        sorter: true,
      },
      {
        title: t('content.monthCreditRevenue'),
        dataIndex: 'month_credit_revenue',
        key: 'month_credit_revenue',
        width: 130,
        search: false,
        sorter: true,
      },
      {
        title: t('table.createdAt'),
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        ellipsis: true,
        valueType: 'dateRange',
        sorter: true,
        defaultSortOrder: 'descend',
        render: (_: unknown, record: ContentCompanion) => (
          <FormatDate value={record.created_at} locale={locale} />
        ),
        search: {
          transform: (value: [string, string]) => ({
            created_from: value?.[0],
            created_to: value?.[1],
          }),
        },
        order: 8,
      },
      {
        title: t('content.createdBy'),
        dataIndex: 'created_by',
        key: 'created_by',
        width: 120,
        order: 7,
      },
      {
        title: t('content.hasOpsAdmin'),
        dataIndex: 'has_ops_admin',
        key: 'has_ops_admin',
        hideInTable: true,
        valueType: 'select',
        valueEnum: hasOpsAdminValueEnum,
        order: 9,
        fieldProps: {
          allowClear: true,
          disabled: opsFilterLock.opsAdmin,
        },
        search: {
          transform: (value: string | boolean) => ({ has_ops_admin: String(value) }),
        },
      },
      {
        title: t('content.opsAdmin'),
        dataIndex: 'ops_admin_id',
        key: 'ops_admin_id',
        width: 160,
        order: 10,
        valueType: 'select',
        fieldProps: {
          mode: 'multiple',
          options: adminOptions,
          allowClear: true,
          showSearch: true,
          optionFilterProp: 'label',
          disabled: opsFilterLock.hasOpsAdmin,
        },
        render: (_: unknown, record: ContentCompanion) => {
          const label = opsAdminLabel(record.ops_admin);
          if (label) return label;
          if (record.ops_admin_id != null) {
            const hit = adminOptions.find((item) => item.value === Number(record.ops_admin_id));
            return hit?.label ?? `#${record.ops_admin_id}`;
          }
          return '—';
        },
      },
      {
        title: t('recommend.opsTags'),
        dataIndex: 'tags',
        key: 'tags',
        width: 220,
        ellipsis: true,
        order: 11,
        valueType: 'select',
        fieldProps: {
          mode: 'multiple',
          options: opsTagOptions,
          allowClear: true,
          showSearch: true,
          optionFilterProp: 'label',
          placeholder: t('recommend.opsTags'),
          filterOption: (input: string, option?: { label?: string; value?: string }) => {
            const q = input.trim().toLowerCase();
            if (!q) return true;
            return (
              String(option?.label || '').toLowerCase().includes(q) ||
              String(option?.value || '').toLowerCase().includes(q)
            );
          },
        },
        render: (_: unknown, record: ContentCompanion) => {
          const keys = (record.tags || []).filter((key) => Object.prototype.hasOwnProperty.call(opsTagLabelMap, key));
          if (!keys.length) return '—';
          return (
            <Space size={[4, 4]} wrap>
              {keys.map((key) => (
                <Tag key={key}>{opsTagLabelMap[key] || key}</Tag>
              ))}
            </Space>
          );
        },
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        search: false,
        render: (_: unknown, record: ContentCompanion) => (
          <Space>
            <Switch
              checked={record.is_active !== false}
              onChange={(checked) => void handleToggleActive(record.id, checked)}
            />
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => goToChild(`/companions/${record.id}/edit`)}
            >
              {t('btn.edit')}
            </Button>
            {!record.is_deleted && (
              <Popconfirm
                title={t('confirm.deleteCompanion')}
                onConfirm={() => handleDelete(record.id)}
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
    [t, locale, goToChild, handleDelete, handleToggleActive, languageValueEnum, tierValueEnum, genderValueEnum, activeValueEnum, creditSortValueEnum, hasOpsAdminValueEnum, adminOptions, opsTagOptions, opsTagLabelMap, opsFilterLock],
  );

  const fetchData = useCallback(
    async (params: Record<string, unknown>, sort: SortMap) => {
      const pickStr = (...keys: string[]) => {
        for (const key of keys) {
          const value = params[key];
          if (typeof value === 'string' && value) return value;
        }
        return undefined;
      };
      const language = pickStr('language');
      const tier = pickStr('type', 'tier', 'filter_type');
      const gender = pickStr('gender');
      const isActiveRaw = params.is_active ?? params.status;
      const isActive =
        isActiveRaw === true || isActiveRaw === false || typeof isActiveRaw === 'string'
          ? String(isActiveRaw)
          : undefined;
      const companionId = pickStr('companion_id');
      const createdBy = params.created_by != null && params.created_by !== '' ? String(params.created_by) : undefined;
      const createdFrom = pickStr('created_from');
      const createdTo = pickStr('created_to');
      const creditSort = pickStr('credit_sort');
      const opsAdminIds = parseOpsAdminIds(params.ops_admin_id);
      const tagKeys = parseTagKeys(params.tags);
      const hasOpsAdminRaw = params.has_ops_admin;
      const hasOpsAdmin =
        !opsAdminIds.length && (hasOpsAdminRaw === true || hasOpsAdminRaw === false || hasOpsAdminRaw === 'true' || hasOpsAdminRaw === 'false')
          ? String(hasOpsAdminRaw)
          : undefined;

      const page = Math.max(1, Number(params.current) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
      const { sortBy, sortOrder } = resolveCompanionSort(sort, creditSort);
      setListFilters({
        language,
        tier,
        gender,
        is_active: isActive,
        companion_id: companionId,
        created_by: createdBy,
        has_ops_admin: hasOpsAdmin,
        ops_admin_id: opsAdminIds.length ? opsAdminIds.join(',') : undefined,
        tags: tagKeys.length ? tagKeys : undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
      });

      try {
        const qs = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
          sort_by: sortBy,
          sort_order: sortOrder,
        });
        if (language) qs.set('language', language);
        if (tier) qs.set('tier', tier);
        if (gender) qs.set('gender', gender);
        if (isActive === 'true' || isActive === 'false') qs.set('is_active', isActive);
        if (companionId) qs.set('companion_id', companionId);
        if (createdBy) qs.set('created_by', createdBy);
        if (opsAdminIds.length) qs.set('ops_admin_id', opsAdminIds.join(','));
        else if (hasOpsAdmin === 'true' || hasOpsAdmin === 'false') qs.set('has_ops_admin', hasOpsAdmin);
        tagKeys.forEach((key) => qs.append('tags', key));
        if (createdFrom) qs.set('created_from', createdFrom.slice(0, 10));
        if (createdTo) qs.set('created_to', createdTo.slice(0, 10));

        const res = await adminFetchJson<{
          code?: number;
          results?: ContentCompanion[];
          pagination?: { total?: number; page?: number; page_size?: number; total_pages?: number };
        }>(`/api/admin/content/companions?${toRequestQuery(qs)}`);
        const rows = (unwrapResults<ContentCompanion[]>(res) ?? res?.results ?? []).map(normalizeCompanion);

        return {
          data: rows,
          success: true,
          total: res?.pagination?.total ?? 0,
        };
      } catch {
        showError(t('toast.loadFailed') as string);
        return { data: [], success: false, total: 0 };
      }
    },
    [t],
  );

  async function handleExportExcel() {
    setExcelLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRowKeys.length > 0) {
        params.set('ids', selectedRowKeys.map(String).join(','));
      } else {
        if (listFilters.language) params.set('language', listFilters.language);
        if (listFilters.tier) params.set('tier', listFilters.tier);
        if (listFilters.gender) params.set('gender', listFilters.gender);
        if (listFilters.is_active === 'true' || listFilters.is_active === 'false') {
          params.set('is_active', listFilters.is_active);
        }
        if (listFilters.companion_id) params.set('companion_id', listFilters.companion_id);
        if (listFilters.created_by) params.set('created_by', listFilters.created_by);
        if (listFilters.ops_admin_id) params.set('ops_admin_id', listFilters.ops_admin_id);
        else if (listFilters.has_ops_admin === 'true' || listFilters.has_ops_admin === 'false') {
          params.set('has_ops_admin', listFilters.has_ops_admin);
        }
        (listFilters.tags || []).forEach((key) => params.append('tags', key));
        if (listFilters.sort_by) params.set('sort_by', listFilters.sort_by);
        if (listFilters.sort_order) params.set('sort_order', listFilters.sort_order);
      }
      const qs = toRequestQuery(params);
      const url = qs ? `/api/admin/companions/export?${qs}` : '/api/admin/companions/export';
      await downloadXlsx(url, 'companions.xlsx');
      showSuccess(t('toast.exportSuccess') as string);
    } catch {
      showError(t('toast.exportFailed') as string);
    } finally {
      setExcelLoading(false);
    }
  }

  async function handleDownloadTemplate() {
    setExcelLoading(true);
    try {
      await downloadXlsx('/api/admin/companions/template', 'companions_import_template.xlsx');
      showSuccess(t('toast.templateDownloadSuccess') as string);
    } catch {
      showError(t('toast.templateDownloadFailed') as string);
    } finally {
      setExcelLoading(false);
    }
  }

  async function handleImportExcel(file: File) {
    setExcelLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await adminFetch('/api/admin/companions/import', {
        method: 'POST',
        body: formData,
      });
      if (!res) return false;
      const body = (await res.json()) as ImportApiBody;
      if (body.code !== 200) {
        showError((body.message || t('toast.importFailed')) as string);
        return false;
      }
      const r = body.results || {};
      if ((r.failed || 0) > 0) {
        showWarning(
          t('toast.importPartial', {
            created: r.created || 0,
            updated: r.updated || 0,
            failed: r.failed || 0,
          }) as string,
        );
        console.warn('companion import errors', r.errors);
      } else {
        showSuccess(
          t('toast.importSuccess', {
            created: r.created || 0,
            updated: r.updated || 0,
          }) as string,
        );
      }
      actionRef.current?.reload();
    } catch (e) {
      showError(((e as Error).message || t('toast.importFailed')) as string);
    } finally {
      setExcelLoading(false);
    }
    return false;
  }

  async function handleBatchGenerate() {
    const values = await form.validateFields();
    setBatchLoading(true);
    setBatchProgress(0);
    setBatchStatus(t('batchGenerateCompanions.statusPreparing') as string);

    try {
      const isAllLangs = values.mode === 'all';
      const token = getToken();
      const payload: Record<string, unknown> = {};
      if (values.gender) payload.gender = values.gender;
      if (values.sexual_orientation) payload.sexual_orientation = values.sexual_orientation;

      let endpoint = '/api/admin/companions/batch-generate-stream';
      if (isAllLangs) {
        endpoint = '/api/admin/companions/batch-generate-all-langs-stream';
        payload.count_per_lang = values.count;
      } else {
        payload.count = values.count;
        payload.lang = values.lang;
      }

      const savedLang = localStorage.getItem('admin_lang') || 'zh';
      const langMap: Record<string, string> = { zh: 'zh-CN', en: 'en-US' };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-token': token || '',
          'Accept-Language': langMap[savedLang] || savedLang,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error('Network response was not ok');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let created = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'progress') {
              const percent = isAllLangs
                ? Math.round((event.created_all / event.total_all) * 100)
                : Math.round((event.current / event.total) * 100);
              setBatchProgress(percent);
              if (isAllLangs) {
                setBatchStatus(
                  `${t('lang.' + event.lang)}: ${event.current_lang}/${event.total_lang} | ` +
                  `${t('batchGenerateCompanions.totalProgress')}: ${event.created_all}/${event.total_all}`
                );
                created = event.created_all;
              } else {
                setBatchStatus(
                  t('batchGenerateCompanions.statusProgress', {
                    current: event.current,
                    total: event.total,
                    batch: event.batch,
                    totalBatches: event.total_batches,
                  }) as string
                );
                created = event.current;
              }
            } else if (event.type === 'error') {
              showError(
                t('batchGenerateCompanions.batchError', {
                  batch: event.batch,
                  message: event.message,
                }) as string
              );
            } else if (event.type === 'complete') {
              created = isAllLangs ? event.created_all : event.created;
            }
          } catch {
            // ignore parse error
          }
        }
      }

      showSuccess(t('toast.batchGenerateSuccess', { count: created }) as string);
      setBatchModalVisible(false);
      form.setFieldsValue({ count: 5, lang: 'zh', mode: 'single' });
      actionRef.current?.reload();
    } catch {
      showError(t('toast.batchGenerateFailed') as string);
    } finally {
      setBatchLoading(false);
      setBatchProgress(0);
      setBatchStatus('');
    }
  }

  return (
    <div>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
      <h2>{t('page.companions')}</h2>
      <ProTable
        actionRef={actionRef}
        columns={columns}
        rowKey={(record) => record.id}
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        request={fetchData}
        formRef={searchFormRef}
        form={{
          onValuesChange: (changed, all) => {
            const searchForm = searchFormRef.current;
            if (searchForm) {
              if ('has_ops_admin' in changed && isHasOpsAdminValue(changed.has_ops_admin)) {
                searchForm.setFieldsValue({ ops_admin_id: undefined });
              }
              if ('ops_admin_id' in changed && parseOpsAdminIds(changed.ops_admin_id).length > 0) {
                searchForm.setFieldsValue({ has_ops_admin: undefined });
              }
            }
            const next = searchForm?.getFieldsValue() ?? all;
            setOpsFilterLock({
              hasOpsAdmin: isHasOpsAdminValue(next.has_ops_admin),
              opsAdmin: parseOpsAdminIds(next.ops_admin_id).length > 0,
            });
          },
        }}
        search={{
          labelWidth: 'auto',
          defaultCollapsed: false,
        }}
        onReset={() => setOpsFilterLock({ hasOpsAdmin: false, opsAdmin: false })}
        scroll={{ x: 2100 }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          preserveSelectedRowKeys: true,
        }}
        tableAlertRender={false}
        polling={(dataSource) => {
          const list = (dataSource as ContentCompanion[]) || [];
          return list.some((r) => r.avatar_generating) ? 3000 : 0;
        }}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        toolBarRender={() => [
          <Button
            key="template"
            icon={<FileExcelOutlined />}
            loading={excelLoading}
            onClick={handleDownloadTemplate}
          >
            {t('btn.downloadTemplate')}
          </Button>,
          <Button
            key="export"
            icon={<DownloadOutlined />}
            loading={excelLoading}
            onClick={handleExportExcel}
          >
            {selectedRowKeys.length > 0
              ? t('btn.exportSelected', { count: selectedRowKeys.length })
              : listFilters.language || listFilters.tier || listFilters.gender || listFilters.is_active || listFilters.companion_id || listFilters.created_by || listFilters.has_ops_admin || listFilters.ops_admin_id || (listFilters.tags && listFilters.tags.length)
                ? t('btn.exportFiltered')
                : t('btn.exportExcel')}
          </Button>,
          <Upload
            key="import"
            accept=".xlsx,.xlsm"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleImportExcel(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={excelLoading}>
              {t('btn.importExcel')}
            </Button>
          </Upload>,
          <Button
            key="batch"
            icon={<ThunderboltOutlined />}
            onClick={() => {
              form.setFieldsValue({ count: 5, lang: 'zh', mode: 'single' });
              setBatchModalVisible(true);
            }}
          >
            {t('btn.batchGenerateCompanions')}
          </Button>,
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/companions/new')}>
            {t('btn.new')}
          </Button>,
        ]}
      />

      <Modal
        title={t('modal.batchGenerateCompanions')}
        open={batchModalVisible}
        onCancel={() => {
          if (!batchLoading) {
            setBatchModalVisible(false);
            setBatchProgress(0);
            setBatchStatus('');
            form.setFieldsValue({ count: 5, lang: 'zh', mode: 'single' });
          }
        }}
        onOk={handleBatchGenerate}
        confirmLoading={batchLoading}
        okText={batchLoading ? t('batchGenerateCompanions.generating') : t('btn.generate')}
        cancelText={t('btn.cancel')}
        closable={!batchLoading}
        maskClosable={!batchLoading}
        keyboard={!batchLoading}
      >
        <Form form={form} layout="vertical" initialValues={{ count: 5, lang: 'zh', mode: 'single' }}>
          {/* 外层无 name，label 不生成 for，避免 for 指到 Radio.Group/Select 的非 labelable 的 div#id（Chrome 校验报错）*/}
          <Form.Item label={t('batchGenerateCompanions.mode')}>
            <Form.Item name="mode" noStyle rules={[{ required: true }]}>
              <Radio.Group disabled={batchLoading}>
                <Radio value="single">{t('batchGenerateCompanions.singleLang')}</Radio>
                <Radio value="all">{t('batchGenerateCompanions.allLangs')}</Radio>
              </Radio.Group>
            </Form.Item>
          </Form.Item>

          <Form.Item
            name="count"
            label={batchMode === 'all' ? t('batchGenerateCompanions.countPerLang') : t('batchGenerateCompanions.count')}
            rules={[{ required: true, type: 'number', min: 1, max: 20 }]}
          >
            <InputNumber min={1} max={20} style={{ width: '100%' }} disabled={batchLoading} />
          </Form.Item>

          {batchMode === 'single' && (
            <Form.Item label={t('batchGenerateCompanions.lang')}>
              <Form.Item name="lang" noStyle rules={[{ required: true }]}>
                <Select disabled={batchLoading} options={CONTENT_LANGS} />
              </Form.Item>
            </Form.Item>
          )}

          <Form.Item label={t('batchGenerateCompanions.gender')}>
            <Form.Item name="gender" noStyle>
              <Select allowClear placeholder={t('batchGenerateCompanions.random')} disabled={batchLoading}>
                <Select.Option value="女">{t('gender.female')}</Select.Option>
                <Select.Option value="男">{t('gender.male')}</Select.Option>
              </Select>
            </Form.Item>
          </Form.Item>
          <Form.Item label={t('batchGenerateCompanions.sexualOrientation')}>
            <Form.Item name="sexual_orientation" noStyle>
              <Select allowClear placeholder={t('batchGenerateCompanions.random')} disabled={batchLoading}>
                <Select.Option value="heterosexual">{t('orientation.heterosexual')}</Select.Option>
                <Select.Option value="homosexual">{t('orientation.homosexual')}</Select.Option>
                <Select.Option value="bisexual">{t('orientation.bisexual')}</Select.Option>
                <Select.Option value="pansexual">{t('orientation.pansexual')}</Select.Option>
                <Select.Option value="asexual">{t('orientation.asexual')}</Select.Option>
                <Select.Option value="secret">{t('orientation.secret')}</Select.Option>
              </Select>
            </Form.Item>
          </Form.Item>
          <div style={{ color: '#999', fontSize: 12, marginTop: -8, marginBottom: 16 }}>
            {batchMode === 'all'
              ? t('batchGenerateCompanions.hintAll')
              : t('batchGenerateCompanions.hint')}
          </div>

          {batchLoading && (
            <div style={{ marginTop: 16 }}>
              <Progress percent={batchProgress} status="active" />
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, textAlign: 'center' }}>
                {batchStatus}
              </Typography.Text>
            </div>
          )}
        </Form>
      </Modal>
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
