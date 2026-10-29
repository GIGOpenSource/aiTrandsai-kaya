/**
 * Moments（动态）列表页
 *
 * 功能概览：
 *  1. 以 ProTable 展示所有动态条目，字段包含：
 *     - ID、所属 Companion（头像 + 名称）、配图缩略图、文字内容（caption）
 *     - 点赞数、评论数、发布时间
 *  2. 工具栏操作：新建、批量生成（AI）、清空全部（带二次确认）
 *  3. 行内操作：编辑、重新生成配图（AI）、删除（带二次确认）
 *  4. 图片生成中（image_generating=true）时，列表自动每 3s 轮询刷新
 *     直到后端完成生图，避免缩略图一直显示 loading
 *  5. 点击缩略图可全屏预览大图 + caption
 *  6. 批量生成弹窗：可设置每个 Companion 生成几条，以及是否先清空已有数据
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable from '@ant-design/pro-table';
import type { ProFormInstance } from '@ant-design/pro-components';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Popconfirm, Image, Space, Modal, Form, Input, InputNumber, Switch, Typography, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined, EditOutlined, RobotOutlined, ClearOutlined, DownloadOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError, showLoading } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ContentMoment } from '../../types';
import { getAppLanguage } from '../../locales';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { momentListThumbUrl } from './cropPreview';
import { CONTENT_LANGS, unwrapResults } from '../Companions/contentApi';
import { isHasOpsAdminValue, loadAdminOptions, opsAdminLabel, parseOpsAdminIds } from '../ChatSessions/imApi';
import CompanionSearchSelect from './CompanionSearchSelect';

const { Text } = Typography;

function parseCompanionIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** 朋友圈 id：支持多选，中文逗号/顿号等转英文逗号后再拆 */
function parseMomentIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => parseMomentIds(item));
  }
  if (raw == null || raw === '') return [];
  return String(raw)
    .replace(/[，、；;/\s]+/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function appendMomentIds(qs: URLSearchParams, raw: unknown) {
  const ids = parseMomentIds(raw);
  qs.delete('moment_id');
  if (ids.length) qs.set('moment_id', ids.join(','));
}

function toDay(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && value && 'format' in value) {
    return (value as { format: (s: string) => string }).format('YYYY-MM-DD');
  }
  return String(value).slice(0, 10);
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

function appendPublishedRange(qs: URLSearchParams, params: Record<string, unknown>) {
  const range = params.published_range ?? params.published_at;
  if (!Array.isArray(range)) return;
  const from = toDay(range[0]);
  const to = toDay(range[1]);
  if (from) qs.set('published_from', from);
  if (to) qs.set('published_to', to);
}

export default function MomentsList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<ContentMoment>({
      listPath: '/moments',
      getRowId: (row) => row.id,
      fetchRow: async (id) => {
        const res = await adminFetchJson(`/api/admin/content/moments/${id}`);
        return unwrapResults<ContentMoment>(res) ?? (res as ContentMoment | undefined);
      },
    });
  const pagination = useTablePagination(10);
  const companionIdsRef = useRef<string[]>([]);
  const searchFormRef = useRef<ProFormInstance>(undefined);
  const [adminOptions, setAdminOptions] = useState<{ value: number; label: string }[]>([]);
  const [opsFilterLock, setOpsFilterLock] = useState({ hasOpsAdmin: false, opsAdmin: false });
  const [preview, setPreview] = useState<{ url: string; caption: string } | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [batchForm] = Form.useForm();
  const locale = getAppLanguage();
  const lastExportQsRef = useRef('');

  useEffect(() => {
    void loadAdminOptions().then(setAdminOptions);
  }, []);

  /**
   * ProTable 列定义
   * - companion：展示头像 + 名称，无头像时 fallback 到默认头像
   * - image_url：生图中显示 loading 动画，有图可点击预览，无图显示 "—"
   * - created_at：根据当前语言格式化日期
   * - action：固定在右侧，包含编辑 / 重新生图 / 删除三个按钮
   */
  const columns = [
    {
      title: t('moment.momentId'),
      dataIndex: 'id',
      key: 'id',
      width: 100,
      search: false,
      render: (_: unknown, record: ContentMoment) => record.id,
    },
    {
      title: t('moment.companionColumn'),
      dataIndex: 'companion_id',
      key: 'companion_id',
      width: 180,
      search: false,
      render: (_: unknown, record: ContentMoment) => (
        <span>
          {record.companion_name
            ? `${record.companion_name} (${record.companion_id})`
            : record.companion_id}
        </span>
      ),
    },
    {
      title: t('table.avatar'),
      key: 'companion_avatar',
      width: 80,
      search: false,
      render: (_: unknown, record: ContentMoment) =>
        record.companion_avatar ? (
          <Image
            src={resolveAdminMediaUrl(record.companion_avatar)}
            width={32}
            height={32}
            style={{ borderRadius: '50%', objectFit: 'cover' }}
            preview={false}
            fallback="https://api.dicebear.com/7.x/avataaars/svg?seed=fallback"
          />
        ) : (
          '—'
        ),
    },
    {
      title: t('content.authorId'),
      dataIndex: 'author_id',
      key: 'author_id',
      width: 100,
      search: false,
      render: (_: unknown, record: ContentMoment) => record.author_id ?? '—',
    },
    {
      title: t('table.image'),
      dataIndex: 'image_url',
      key: 'image_url',
      width: 108,
      search: false,
      render: (_: unknown, record: ContentMoment) => {
        const thumb = momentListThumbUrl(record);
        const original = (record.image_url || '').trim();
        if (record.image_generating) {
          return (
            <div
              style={{
                width: 80,
                height: 60,
                background: '#f0f0f0',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                className="animate-spin"
                style={{
                  width: 16,
                  height: 16,
                  border: '2px solid #f0f0f0',
                  borderTopColor: '#ff69b4',
                  borderRadius: '50%',
                }}
              />
            </div>
          );
        }
        if (!thumb && !original) {
          return <span style={{ color: '#999' }}>—</span>;
        }
        return (
          <div
            style={{
              width: 80,
              height: 60,
              overflow: 'hidden',
              borderRadius: 4,
              background: '#f5f5f5',
            }}
          >
            <Image
              src={resolveAdminMediaUrl(thumb || original)}
              preview={false}
              wrapperStyle={{ width: '100%', height: '100%', display: 'block' }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                cursor: 'pointer',
                display: 'block',
              }}
              onClick={() =>
                setPreview({ url: resolveAdminMediaUrl(original || thumb), caption: record.caption })
              }
              fallback="https://via.placeholder.com/80x60?text=无图"
            />
          </div>
        );
      },
    },
    {
      title: t('table.caption'),
      dataIndex: 'caption',
      key: 'caption',
      width: 220,
      ellipsis: true,
      search: false,
    },
    {
      title: t('content.viewCount'),
      key: 'view_count',
      width: 140,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.view_count ?? 0} / ${r.view_users ?? 0}`,
    },
    {
      title: t('content.detailClickCount'),
      key: 'detail_click_count',
      width: 170,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.detail_click_count ?? 0} / ${r.detail_click_users ?? 0}`,
    },
    { title: t('content.likesCount'), key: 'likes_count', width: 120, search: false,
      render: (_: unknown, r: ContentMoment) => `${r.likes_count ?? 0} / ${r.likes_users ?? 0}` },
    { title: t('content.commentsCount'), key: 'comments_count', width: 120, search: false,
      render: (_: unknown, r: ContentMoment) => `${r.comments_count ?? 0} / ${r.comments_users ?? 0}` },
    {
      title: t('content.msgClickCount'),
      key: 'msg_click_count',
      width: 170,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.msg_click_count ?? 0} / ${r.msg_click_users ?? 0}`,
    },
    {
      title: t('moment.publishStatus'),
      key: 'publish_status',
      width: 100,
      search: false,
      render: (_: unknown, record: ContentMoment) =>
        record.is_scheduled ? (
          <Tag color="orange">{t('moment.scheduled')}</Tag>
        ) : (
          <Tag color="green">{t('moment.published')}</Tag>
        ),
    },
    {
      title: t('table.publishedAt'),
      dataIndex: 'published_at',
      key: 'published_at',
      width: 200,
      search: false,
      sorter: true,
      render: (_: unknown, record: ContentMoment) => {
        if (record.is_scheduled && record.schedule_at) {
          return (
            <span>
              {record.schedule_at}
              {record.schedule_lang ? ` (${record.schedule_lang})` : ''}
            </span>
          );
        }
        return (
          <FormatDate
            value={record.published_at || record.publish_at || record.created_at}
            locale={locale}
          />
        );
      },
    },
    {
      title: t('moment.momentId'),
      dataIndex: 'moment_id',
      key: 'moment_id',
      hideInTable: true,
      order: 20,
      fieldProps: {
        placeholder: t('moment.momentIdFilterPlaceholder'),
        allowClear: true,
      },
      renderFormItem: () => (
        <Input allowClear placeholder={t('moment.momentIdFilterPlaceholder') as string} />
      ),
    },
    {
      title: t('table.publishedAt'),
      dataIndex: 'published_range',
      key: 'published_range',
      hideInTable: true,
      order: 25,
      valueType: 'dateRange' as const,
    },
    {
      title: t('moment.companionColumn'),
      dataIndex: 'companion_ids',
      key: 'companion_ids',
      hideInTable: true,
      order: 50,
      formItemProps: {
        className: 'moment-companion-filter-item',
      },
      renderFormItem: (_: unknown, { value, onChange }: { value?: unknown; onChange?: (v: unknown) => void }) => (
        <CompanionSearchSelect
          mode="multiple"
          value={Array.isArray(value) ? value.map(String) : undefined}
          onChange={(next) => {
            companionIdsRef.current = parseCompanionIds(next);
            onChange?.(next);
          }}
        />
      ),
    },
    {
      title: t('table.language'),
      dataIndex: 'language',
      key: 'language',
      hideInTable: true,
      order: 20,
      valueType: 'select' as const,
      valueEnum: Object.fromEntries(CONTENT_LANGS.map((item) => [item.value, { text: item.label }])),
    },
    {
      title: t('content.hasImage'),
      dataIndex: 'has_image',
      key: 'has_image',
      hideInTable: true,
      order: 10,
      valueType: 'select' as const,
      valueEnum: {
        true: { text: t('content.hasImageYes') },
        false: { text: t('content.hasImageNo') },
      },
    },
    {
      title: t('content.hasOpsAdmin'),
      dataIndex: 'has_ops_admin',
      key: 'has_ops_admin',
      hideInTable: true,
      hideInSearch: false,
      order: 40,
      valueType: 'select' as const,
      valueEnum: {
        true: { text: t('content.hasOpsAdminYes') },
        false: { text: t('content.hasOpsAdminNo') },
      },
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
      hideInSearch: false,
      order: 30,
      valueType: 'select' as const,
      fieldProps: {
        mode: 'multiple',
        options: adminOptions,
        allowClear: true,
        showSearch: true,
        optionFilterProp: 'label',
        disabled: opsFilterLock.hasOpsAdmin,
      },
      render: (_: unknown, record: ContentMoment) => {
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
      title: t('table.action'),
      key: 'action',
      width: 180,
      fixed: 'right' as const,
      search: false,
      render: (_: unknown, record: ContentMoment) => (
        <Space size={0} wrap={false} style={{ whiteSpace: 'nowrap' }}>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => goToChild(`/moments/${record.id}/edit`)}
          >
            {t('btn.edit')}
          </Button>
          <Popconfirm
            title={t('confirm.deleteMoment')}
            onConfirm={() => handleDelete(record.id)}
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
  ];

  /**
   * 拉取 moments
   * GET /api/admin/content/moments?page=&page_size=
   * ProTable 的 request 回调，返回 { data, success, total }
   */
  async function fetchData(params: Record<string, unknown>, sort: Record<string, 'ascend' | 'descend' | null | undefined>) {
    try {
      const page = Math.max(1, Number(params.current) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      const companionIds = 'companion_ids' in params
        ? parseCompanionIds(params.companion_ids)
        : companionIdsRef.current;
      companionIdsRef.current = companionIds;
      if (companionIds.length > 0) {
        qs.set('companion_ids', companionIds.join(','));
      }
      appendMomentIds(qs, params.moment_id);
      if (typeof params.language === 'string' && params.language) qs.set('language', params.language);
      if (params.has_image === true || params.has_image === false || typeof params.has_image === 'string') {
        qs.set('has_image', String(params.has_image));
      }
      const opsAdminIds = parseOpsAdminIds(params.ops_admin_id);
      const hasOpsAdminRaw = params.has_ops_admin;
      const hasOpsAdmin =
        !opsAdminIds.length && isHasOpsAdminValue(hasOpsAdminRaw) ? String(hasOpsAdminRaw) : undefined;
      if (opsAdminIds.length) qs.set('ops_admin_id', opsAdminIds.join(','));
      else if (hasOpsAdmin) qs.set('has_ops_admin', hasOpsAdmin);
      appendPublishedRange(qs, params);
      const publishedSort = sort?.published_at ?? sort?.created_at;
      qs.set('sort_order', publishedSort === 'ascend' ? 'asc' : 'desc');

      const exportQs = new URLSearchParams(qs);
      exportQs.delete('page');
      exportQs.delete('page_size');
      lastExportQsRef.current = exportQs.toString();

      const res = await adminFetchJson<{
        results?: ContentMoment[];
        pagination?: { total?: number; page?: number; page_size?: number; total_pages?: number };
      }>(`/api/admin/content/moments?${qs.toString()}`);
      const rows = unwrapResults<ContentMoment[]>(res) ?? [];
      const list = Array.isArray(rows) ? rows : [];
      return { data: list, success: true, total: res?.pagination?.total ?? 0 };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  /**
   * 删除单条 moment
   * DELETE /api/admin/moments/:id
   * 成功后刷新列表
   */
  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/content/moments/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const formValues = (searchFormRef.current?.getFieldsValue?.() ?? {}) as Record<string, unknown>;
      const qs = new URLSearchParams(lastExportQsRef.current);
      // 以当前筛区为准再拼一遍，避免未点查询就导出时参数过旧
      const companionIds = parseCompanionIds(formValues.companion_ids ?? companionIdsRef.current);
      if (companionIds.length) qs.set('companion_ids', companionIds.join(','));
      else qs.delete('companion_ids');
      appendMomentIds(qs, formValues.moment_id);
      if (typeof formValues.language === 'string' && formValues.language) qs.set('language', formValues.language);
      else qs.delete('language');
      if (
        formValues.has_image === true ||
        formValues.has_image === false ||
        typeof formValues.has_image === 'string'
      ) {
        qs.set('has_image', String(formValues.has_image));
      } else {
        qs.delete('has_image');
      }
      const opsAdminIds = parseOpsAdminIds(formValues.ops_admin_id);
      const hasOpsAdminRaw = formValues.has_ops_admin;
      const hasOpsAdmin =
        !opsAdminIds.length && isHasOpsAdminValue(hasOpsAdminRaw) ? String(hasOpsAdminRaw) : undefined;
      qs.delete('ops_admin_id');
      qs.delete('has_ops_admin');
      if (opsAdminIds.length) qs.set('ops_admin_id', opsAdminIds.join(','));
      else if (hasOpsAdmin) qs.set('has_ops_admin', hasOpsAdmin);
      qs.delete('published_from');
      qs.delete('published_to');
      appendPublishedRange(qs, formValues);
      qs.delete('page');
      qs.delete('page_size');

      const res = await adminFetch(`/api/admin/content/moments/export?${qs.toString()}`);
      if (!res || !res.ok) {
        let msg = t('toast.exportFailed') as string;
        try {
          const err = await res?.json();
          msg = err?.detail || err?.message || err?.error || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = parseFilename(res.headers.get('content-disposition'), `moments_export.xlsx`);
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
  }

  /**
   * 清空所有 moments（危险操作，由 Popconfirm 二次确认触发）
   * DELETE /api/admin/moments（无 id，删除全部）
   */
  async function handleClearAll() {
    try {
      const res = await adminFetch('/api/admin/moments', { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.clearSuccess') as string);
        actionRef.current?.reload();
      } else {
        showError(t('toast.clearFailed') as string);
      }
    } catch {
      showError(t('toast.clearFailed') as string);
    }
  }

  /**
   * 批量生成 moments
   * POST /api/admin/moments/batch-generate
   * @param values.moments_per_companion - 每个 Companion 生成几条（1~10）
   * @param values.clear_existing        - 是否先清空已有 moments 再生成
   */
  async function handleBatchGenerate(values: Record<string, unknown>) {
    setBatchLoading(true);
    try {
      showLoading({ content: t('toast.generating'), key: 'batch' });
      const res = await adminFetchJson<{ ok: boolean; created: number; mode: string }>('/api/admin/moments/batch-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clear_existing: values.clear_existing,
          moments_per_companion: values.moments_per_companion,
        }),
      });
      if (res && res.ok) {
        showSuccess({ content: `${t('toast.batchGenerateSuccess') as string} ${res.created} ${t('toast.items') as string}`, key: 'batch' });
        setBatchModalOpen(false);
        batchForm.resetFields();
        actionRef.current?.reload();
      } else {
        showError({ content: t('toast.batchGenerateFailed'), key: 'batch' });
      }
    } catch (e) {
      showError({ content: (e as Error).message || (t('toast.batchGenerateFailed') as string), key: 'batch' });
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
      <h2>{t('page.moments')}</h2>
      {/* ==================== 主表格 ==================== */}
      <ProTable
        actionRef={actionRef}
        columns={columns as any}
        rowKey="id"
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        request={fetchData}
        formRef={searchFormRef}
        search={{
          labelWidth: 'auto',
          defaultCollapsed: false,
          span: 8,
        }}
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
            companionIdsRef.current = parseCompanionIds(next.companion_ids);
          },
        }}
        onReset={() => {
          companionIdsRef.current = [];
          setOpsFilterLock({ hasOpsAdmin: false, opsAdmin: false });
        }}
        scroll={{ x: 2200 }}
        polling={(dataSource) => {
          const list = (dataSource as ContentMoment[]) || [];
          return list.some((m) => m.image_generating) ? 3000 : 0;
        }}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/moments/new')}>
            {t('btn.new')}
          </Button>,
          <Button
            key="export"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => void handleExport()}
          >
            {t('btn.exportExcel')}
          </Button>,
          <Button key="batch" icon={<RobotOutlined />} onClick={() => setBatchModalOpen(true)}>
            {t('btn.batchGenerate')}
          </Button>,
          <Popconfirm
            key="clear"
            title={t('confirm.clearAllMoments')}
            onConfirm={handleClearAll}
            okText={t('btn.delete')}
            cancelText={t('btn.cancel')}
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<ClearOutlined />}>
              {t('btn.clearAll')}
            </Button>
          </Popconfirm>,
        ]}
      />
      {/* ==================== 图片全屏预览遮罩 ==================== */}
      {/* 点击遮罩背景关闭，内部阻止冒泡防止误关 */}
      {preview && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPreview(null)}>
          <div style={{ background: '#fff', padding: 16, borderRadius: 8, maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <Image 
              src={preview.url} 
              style={{ maxWidth: '100%' }} 
              fallback="https://via.placeholder.com/600x400?text=图片加载失败"
            />
            <p style={{ marginTop: 12, color: '#666' }}>{preview.caption}</p>
          </div>
        </div>
      )}

      {/* ==================== 批量生成弹窗 ==================== */}
      {/* 表单字段：每个 Companion 生成数量（1~10）、是否先清空已有 */}
      <Modal
        title={t('modal.batchGenerateTitle')}
        open={batchModalOpen}
        onCancel={() => { setBatchModalOpen(false); batchForm.resetFields(); }}
        onOk={() => batchForm.submit()}
        confirmLoading={batchLoading}
        okText={t('btn.generate')}
        cancelText={t('btn.cancel')}
      >
        <Form
          form={batchForm}
          layout="vertical"
          onFinish={handleBatchGenerate}
          initialValues={{ clear_existing: false, moments_per_companion: 3 }}
        >
          <Form.Item
            label={t('batchGenerate.count')}
            name="moments_per_companion"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('batchGenerate.clearExisting')} name="clear_existing" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Text type="secondary">{t('batchGenerate.hint')}</Text>
        </Form>
      </Modal>
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
