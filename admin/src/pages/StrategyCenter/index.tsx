import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import {
  Avatar,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Popover,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { showError, showSuccess, adminFetchJson } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import { getAppLanguage } from '../../locales';
import type { StrategyCenterRow, StrategyCenterTab } from '../../types';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { loadAdminOptions } from '../ChatSessions/imApi';
import { CONTENT_LANGS, eventLabel, normalizeLangOptions, normalizeProductEvents } from '../Companions/contentApi';
import {
  loadMsgStrategyMeta,
  toLibraryTypeSelectOptions,
  type LibraryTypeSelectOption,
} from '../MsgStrategy/api';
import { SenderModeTag, TypeKeySelect } from '../MsgStrategy/shared';
import { StrategyImageThumb } from '../MsgStrategy/StrategyImageField';
import StrategyFormModal from './StrategyFormModal';
import {
  createStrategyCenter,
  deleteStrategyCenter,
  fetchStrategyCenterList,
  patchStrategyCenterActive,
  rowKeyOf,
  typeTagColor,
  updateStrategyCenter,
} from './api';

const { Text } = Typography;

type Filters = {
  companion?: string;
  companion_language?: string;
  language?: string;
  ops_admin_id?: number[];
  type_key?: string;
  gender?: string;
  tier?: string;
  is_active?: string;
};

const EMPTY_FILTERS: Filters = {};

function isTab(value: string | null): value is StrategyCenterTab {
  return value === 'independent' || value === 'msg-library' || value === 'quick-reply';
}

export default function StrategyCenterPage() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: StrategyCenterTab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as StrategyCenterTab) : 'independent';
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm<Filters>();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [total, setTotal] = useState(0);
  const [adminOptions, setAdminOptions] = useState<{ value: number; label: string }[]>([]);
  const [langOptions, setLangOptions] = useState(CONTENT_LANGS);
  const [typeOptions, setTypeOptions] = useState<LibraryTypeSelectOption[]>([]);
  const [typeModeMap, setTypeModeMap] = useState<Record<string, string | undefined>>({});
  const [modal, setModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit' | 'view';
    row?: StrategyCenterRow | null;
    presetCompanionIds?: string[];
  }>({ open: false, mode: 'create' });
  const [saving, setSaving] = useState(false);

  const reloadTypeOptions = useCallback(async () => {
    try {
      const [meta, evRes] = await Promise.all([
        loadMsgStrategyMeta(),
        adminFetchJson('/api/admin/content/strategy-types').catch(() => null),
      ]);
      const fromMeta = toLibraryTypeSelectOptions(meta.library_types || []);
      const fromEvents = normalizeProductEvents(evRes).map((ev) => ({
        value: ev.event_key,
        label:
          eventLabel(ev) === ev.event_key
            ? ev.event_key
            : `${eventLabel(ev)}（${ev.event_key}）`,
        sender_mode: ev.sender_mode,
      }));
      // meta 优先（含 sender_mode / say_hi_pay_popup 等最新种子）
      const map = new Map<string, LibraryTypeSelectOption>();
      fromEvents.forEach((item) => {
        if (item.value) map.set(item.value, item);
      });
      fromMeta.forEach((item) => {
        if (item.value) map.set(item.value, item);
      });
      const next = [...map.values()];
      setTypeOptions(next);
      const modes: Record<string, string | undefined> = {};
      next.forEach((item) => {
        modes[item.value] = item.sender_mode;
      });
      (meta.library_types || []).forEach((item) => {
        modes[item.type_key] = item.sender_mode ?? modes[item.type_key];
      });
      setTypeModeMap(modes);
      return next;
    } catch {
      return [] as LibraryTypeSelectOption[];
    }
  }, []);

  useEffect(() => {
    void loadAdminOptions().then(setAdminOptions);
    void (async () => {
      try {
        const langRes = await adminFetchJson('/api/admin/content/languages');
        setLangOptions(normalizeLangOptions(langRes));
      } catch {
        /* keep CONTENT_LANGS */
      }
      await reloadTypeOptions();
    })();
    // 仅挂载时拉一次；打开弹窗/下拉时再刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const languageLabel = useCallback(
    (code?: string) => {
      if (!code) return '—';
      const key = `lang.${code}`;
      const translated = t(key);
      if (translated !== key) return translated as string;
      return langOptions.find((item) => item.value === code)?.label || code;
    },
    [langOptions, t],
  );

  const applyFilters = () => {
    setFilters({ ...form.getFieldsValue() });
  };

  const resetFilters = () => {
    form.resetFields();
    setFilters(EMPTY_FILTERS);
  };

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const handleToggle = useCallback(
    async (row: StrategyCenterRow, isActive: boolean) => {
      try {
        await patchStrategyCenterActive(tab, row, isActive);
        showSuccess(t('toast.saved') as string);
        actionRef.current?.reload();
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
      }
    },
    [t, tab],
  );

  const handleDelete = useCallback(
    async (row: StrategyCenterRow) => {
      try {
        await deleteStrategyCenter(tab, row);
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      } catch (e) {
        showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      }
    },
    [t, tab],
  );

  async function handleSave(values: Record<string, unknown>) {
    setSaving(true);
    try {
      const companionIds = Array.isArray(values.companion_ids)
        ? (values.companion_ids as string[]).map(String)
        : [];
      if (modal.mode === 'create') {
        const body: Record<string, unknown> = {
          companion_ids: companionIds,
          content: values.content,
          language: values.language,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active !== false,
        };
        if (tab === 'quick-reply') {
          body.trigger_keyword = String(values.trigger_keyword || '');
        } else {
          body.type_key = values.type_key;
          body.image_url = String(values.image_url || '');
        }
        await createStrategyCenter(tab, body);
      } else if (modal.row) {
        const body: Record<string, unknown> = {
          content: values.content,
          language: values.language,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active !== false,
        };
        if (tab === 'quick-reply') {
          body.trigger_keyword = String(values.trigger_keyword || '');
        } else {
          body.type_key = values.type_key;
          body.image_url = String(values.image_url || '');
        }
        await updateStrategyCenter(tab, modal.row, body);
      }
      showSuccess(t('toast.saved') as string);
      setModal({ open: false, mode: 'create' });
      actionRef.current?.reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  const isQuick = tab === 'quick-reply';

  const columns: ProColumns<StrategyCenterRow>[] = useMemo(() => {
    const companionCol: ProColumns<StrategyCenterRow> = {
      title: isQuick ? t('strategyCenter.colCompanionQr') : t('strategyCenter.colCompanion'),
      dataIndex: 'companion_id',
      width: 180,
      render: (_: unknown, row: StrategyCenterRow) => {
        const name = row.companion_name || row.companion_id || '—';
        const avatar = row.companion_avatar ? resolveAdminMediaUrl(row.companion_avatar) : undefined;
        return (
          <Space>
            <Avatar size={28} src={avatar}>
              {(row.companion_name || row.companion_id || '?').slice(0, 1)}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <div>{name}</div>
              {row.companion_id ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {row.companion_id}
                </Text>
              ) : null}
            </div>
          </Space>
        );
      },
    };

    const contentCol: ProColumns<StrategyCenterRow> = {
      title: isQuick ? t('strategyCenter.colContentQr') : t('strategyCenter.colContent'),
      dataIndex: 'content',
      ellipsis: { showTitle: false },
      render: (_: unknown, row: StrategyCenterRow) => (
        <Tooltip placement="topLeft" title={row.content}>
          {row.content || '—'}
        </Tooltip>
      ),
    };

    const imageCol: ProColumns<StrategyCenterRow> = {
      title: t('table.image'),
      dataIndex: 'image_url',
      width: 80,
      render: (_: unknown, row: StrategyCenterRow) => <StrategyImageThumb url={row.image_url} />,
    };

    const typeCol: ProColumns<StrategyCenterRow> = {
      title: t('strategyCenter.colType'),
      dataIndex: 'type_key',
      width: 200,
      ellipsis: true,
      render: (_: unknown, row: StrategyCenterRow) => {
        const key = row.type_key || row.trigger_event || '';
        const name = row.type_name || row.trigger_event_name || key;
        if (!name) return '—';
        return (
          <Space size={6} wrap>
            <Tooltip title={name}>
              <Tag
                color={typeTagColor(key || name)}
                style={{
                  marginInlineEnd: 0,
                  maxWidth: '100%',
                  height: 'auto',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  lineHeight: 1.45,
                }}
              >
                {name}
              </Tag>
            </Tooltip>
            <SenderModeTag mode={typeModeMap[key]} />
          </Space>
        );
      },
    };

    const countCol: ProColumns<StrategyCenterRow> = {
      title: t('strategyCenter.colConfigCount'),
      dataIndex: 'config_count',
      width: 100,
      render: (_: unknown, row: StrategyCenterRow) => {
        const count = row.config_count ?? 0;
        const types = row.config_types || [];
        const node = <span>{count}</span>;
        if (!types.length) return node;
        return (
          <Popover
            title={t('strategyCenter.colConfigCount')}
            content={
              <Space direction="vertical" size={4}>
                {types.map((item) => (
                  <span key={item.type_key}>
                    {item.type_name || item.type_key} × {item.count ?? 0}
                  </span>
                ))}
              </Space>
            }
          >
            {node}
          </Popover>
        );
      },
    };

    const keywordCol: ProColumns<StrategyCenterRow> = {
      title: t('strategyCenter.colKeyword'),
      dataIndex: 'trigger_keyword',
      width: 140,
      ellipsis: true,
      render: (_: unknown, row: StrategyCenterRow) => {
        const keyword = (row.trigger_keyword || '').trim();
        const label = !keyword || row.is_fallback ? (t('quickReply.fallback') as string) : keyword;
        return (
          <Tooltip title={label}>
            <Tag
              style={{
                marginInlineEnd: 0,
                maxWidth: '100%',
                height: 'auto',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                lineHeight: 1.45,
              }}
            >
              {label}
            </Tag>
          </Tooltip>
        );
      },
    };

    const base: ProColumns<StrategyCenterRow>[] = isQuick
      ? [companionCol, contentCol, keywordCol]
      : [companionCol, contentCol, imageCol, typeCol, countCol];

    return [
      ...base,
      {
        title: t('strategyCenter.colLanguage'),
        dataIndex: 'language',
        width: 90,
        render: (_: unknown, row: StrategyCenterRow) => languageLabel(row.language),
      },
      {
        title: isQuick ? t('strategyCenter.colSortOrder') : t('strategyCenter.colPriority'),
        dataIndex: 'sort_order',
        width: 80,
        render: (_: unknown, row: StrategyCenterRow) => row.sort_order ?? 0,
      },
      {
        title: t('strategyCenter.colActive'),
        dataIndex: 'is_active',
        width: 100,
        render: (_: unknown, row: StrategyCenterRow) => (
          <Switch checked={row.is_active !== false} onChange={(checked) => void handleToggle(row, checked)} />
        ),
      },
      {
        title: t('table.updatedAt'),
        dataIndex: 'updated_at',
        width: 160,
        render: (_: unknown, row: StrategyCenterRow) => <FormatDate value={row.updated_at} locale={locale} />,
      },
      {
        title: t('table.action'),
        key: 'action',
        width: 220,
        fixed: 'right',
        render: (_: unknown, row: StrategyCenterRow) => (
          <Space size={0} wrap={false}>
            <Button
              type="link"
              size="small"
              onClick={() =>
                setModal({
                  open: true,
                  mode: 'create',
                  presetCompanionIds: row.companion_id ? [row.companion_id] : [],
                })
              }
            >
              {t('strategyCenter.createRow')}
            </Button>
            <Button type="link" size="small" onClick={() => setModal({ open: true, mode: 'edit', row })}>
              {t('btn.edit')}
            </Button>
            <Button type="link" size="small" onClick={() => setModal({ open: true, mode: 'view', row })}>
              {t('strategyCenter.view')}
            </Button>
            <Popconfirm
              title={t('strategyCenter.confirmDelete')}
              onConfirm={() => void handleDelete(row)}
              okText={t('btn.delete')}
              cancelText={t('btn.cancel')}
            >
              <Button type="link" size="small" danger>
                {t('btn.delete')}
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ];
  }, [handleDelete, handleToggle, isQuick, languageLabel, locale, t, typeModeMap]);

  const typeFilterDisabled = tab === 'quick-reply';

  return (
    <div>
      <h2>{t('page.strategyCenter')}</h2>
      <p style={{ color: '#666', marginBottom: 16 }}>{t('strategyCenter.hint')}</p>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            <Form.Item name="companion" label={t('strategyCenter.filterCompanion')} style={{ marginBottom: 8 }}>
              <Input allowClear placeholder={t('strategyCenter.filterCompanionPlaceholder') as string} />
            </Form.Item>
            <Form.Item name="companion_language" label={t('strategyCenter.filterCompanionLang')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                options={langOptions.map((item) => ({ ...item, label: languageLabel(item.value) }))}
                placeholder={t('strategyCenter.filterCompanionLangAll') as string}
              />
            </Form.Item>
            <Form.Item name="language" label={t('strategyCenter.filterUserLang')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                options={langOptions.map((item) => ({ ...item, label: languageLabel(item.value) }))}
                placeholder={t('strategyCenter.filterUserLangAll') as string}
              />
            </Form.Item>
            <Form.Item name="ops_admin_id" label={t('strategyCenter.filterOps')} style={{ marginBottom: 8 }}>
              <Select
                mode="multiple"
                allowClear
                options={adminOptions}
                placeholder={t('strategyCenter.filterOpsAll') as string}
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              name="type_key"
              label={t('strategyCenter.filterType')}
              style={{ marginBottom: 8 }}
              extra={typeFilterDisabled ? t('strategyCenter.filterTypeDisabled') : undefined}
            >
              <TypeKeySelect
                allowClear
                disabled={typeFilterDisabled}
                options={typeOptions}
                placeholder={t('strategyCenter.filterTypeAll') as string}
                onDropdownVisibleChange={(visible) => {
                  if (visible) void reloadTypeOptions();
                }}
              />
            </Form.Item>
            <Form.Item name="gender" label={t('strategyCenter.filterGender')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                placeholder={t('strategyCenter.filterGenderAll') as string}
                options={[
                  { value: '女', label: t('gender.female') as string },
                  { value: '男', label: t('gender.male') as string },
                ]}
              />
            </Form.Item>
            <Form.Item name="tier" label={t('strategyCenter.filterTier')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                placeholder={t('strategyCenter.filterTierAll') as string}
                options={[
                  { value: 's', label: t('tier.s') as string },
                  { value: 'featured', label: t('tier.featured') as string },
                  { value: 'candidate', label: t('tier.candidate') as string },
                  { value: 'ops', label: t('tier.ops') as string },
                ]}
              />
            </Form.Item>
            <Form.Item name="is_active" label={t('strategyCenter.filterStatus')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                placeholder={t('strategyCenter.filterStatusAll') as string}
                options={[
                  { value: 'true', label: t('content.active') as string },
                  { value: 'false', label: t('content.inactive') as string },
                ]}
              />
            </Form.Item>
          </div>
          <Space>
            <Button onClick={resetFilters}>{t('strategyCenter.reset')}</Button>
            <Button type="primary" onClick={applyFilters}>
              {t('strategyCenter.search')}
            </Button>
          </Space>
        </Form>
      </Card>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'independent', label: t('strategyCenter.tabIndependent') },
          { key: 'msg-library', label: t('strategyCenter.tabMsgLibrary') },
          { key: 'quick-reply', label: t('strategyCenter.tabQuickReply') },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text type="secondary">{t('strategyCenter.currentTotal', { total })}</Text>
        {tab !== 'independent' ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              void reloadTypeOptions();
              setModal({ open: true, mode: 'create', presetCompanionIds: [] });
            }}
          >
            {t('btn.new')}
          </Button>
        ) : null}
      </div>
      {tab === 'quick-reply' ? (
        <p style={{ color: '#888', marginBottom: 8 }}>{t('strategyCenter.quickReplyConfigHint')}</p>
      ) : null}

      <ProTable<StrategyCenterRow>
        actionRef={actionRef}
        rowKey={(row) => rowKeyOf(row)}
        columns={columns}
        search={false}
        options={false}
        params={{ tab, ...filters }}
        scroll={{ x: isQuick ? 1280 : 1480 }}
        tableLayout="fixed"
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (n) => t('table.total', { total: n }) }}
        locale={{ emptyText: t('strategyCenter.empty') as string }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set('page', String(params.current || 1));
          qs.set('page_size', String(params.pageSize || 10));
          if (filters.companion) qs.set('companion', filters.companion);
          if (filters.companion_language) qs.set('companion_language', filters.companion_language);
          if (filters.language) qs.set('language', filters.language);
          if (filters.ops_admin_id?.length) qs.set('ops_admin_id', filters.ops_admin_id.join(','));
          if (tab !== 'quick-reply' && filters.type_key) qs.set('type_key', filters.type_key);
          if (filters.gender) qs.set('gender', filters.gender);
          if (filters.tier) qs.set('tier', filters.tier);
          if (filters.is_active === 'true' || filters.is_active === 'false') qs.set('is_active', filters.is_active);
          try {
            const { list, total: nextTotal } = await fetchStrategyCenterList(tab, qs);
            setTotal(nextTotal);
            return { data: list, success: true, total: nextTotal };
          } catch (e) {
            showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
            setTotal(0);
            return { data: [], success: false, total: 0 };
          }
        }}
      />

      <StrategyFormModal
        open={modal.open}
        mode={modal.mode}
        tab={tab}
        saving={saving}
        row={modal.row}
        presetCompanionIds={modal.presetCompanionIds}
        langOptions={langOptions.map((item) => ({ ...item, label: languageLabel(item.value) }))}
        typeOptions={typeOptions}
        onRefreshTypes={reloadTypeOptions}
        onCancel={() => setModal({ open: false, mode: 'create' })}
        onOk={(values) => void handleSave(values)}
      />
    </div>
  );
}
