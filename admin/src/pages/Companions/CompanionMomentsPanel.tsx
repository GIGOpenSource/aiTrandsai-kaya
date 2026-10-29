import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, DatePicker, Form, Image, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ContentCompanion, ContentMoment } from '../../types';
import { CONTENT_LANGS, normalizeCompanion, parsePaged, unwrapResults } from './contentApi';
import { getAppLanguage } from '../../locales';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { momentListThumbUrl, parsePreviewPos, type PreviewPos } from '../Moments/cropPreview';
import MomentImagePicker, { type MomentImagePickerHandle } from '../Moments/MomentImagePicker';

const SCHEDULE_FMT = 'YYYY-MM-DD HH:mm:ss';

/** 朋友圈 id：支持多选，中文逗号等转英文逗号后再拆 */
function parseMomentIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((item) => parseMomentIds(item));
  if (raw == null || raw === '') return [];
  return String(raw)
    .replace(/[，、；;/\s]+/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const msg = data.message || data.error || data.detail;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch {
    // ignore
  }
  return fallback;
}

export default function CompanionMomentsPanel({ companionId }: { companionId: string }) {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const actionRef = useRef<ActionType | null>(null);
  const imagePickerRef = useRef<MomentImagePickerHandle>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ContentMoment | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [hasPreview, setHasPreview] = useState(false);
  const [previewPos, setPreviewPos] = useState<PreviewPos | null>(null);
  const [companionLang, setCompanionLang] = useState<string>('');
  const caption = Form.useWatch('caption', form) as string | undefined;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetchJson(`/api/admin/content/companions/${companionId}`);
        const raw = unwrapResults<ContentCompanion>(res) ?? (res as ContentCompanion | null);
        const lang = raw ? (normalizeCompanion(raw).language || '').trim() : '';
        if (!cancelled) setCompanionLang(lang);
      } catch {
        if (!cancelled) setCompanionLang('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionId]);

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        const res = await adminFetch(`/api/admin/content/moments/${id}`, { method: 'DELETE' });
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

  const columns: ProColumns<ContentMoment>[] = [
    {
      title: t('moment.momentId'),
      dataIndex: 'id',
      width: 100,
      search: false,
    },
    {
      title: t('moment.momentId'),
      dataIndex: 'moment_id',
      hideInTable: true,
      fieldProps: {
        placeholder: t('moment.momentIdFilterPlaceholder'),
        allowClear: true,
      },
      renderFormItem: () => (
        <Input allowClear placeholder={t('moment.momentIdFilterPlaceholder') as string} />
      ),
    },
    {
      title: t('table.image'),
      dataIndex: 'image_url',
      width: 108,
      search: false,
      render: (_: unknown, record: ContentMoment) => {
        const thumb = momentListThumbUrl(record);
        const original = (record.image_url || '').trim();
        return thumb ? (
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
              src={resolveAdminMediaUrl(thumb)}
              preview={{ src: resolveAdminMediaUrl(original || thumb) }}
              wrapperStyle={{ width: '100%', height: '100%', display: 'block' }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
              }}
            />
          </div>
        ) : (
          <span style={{ color: '#999' }}>—</span>
        );
      },
    },
    { title: t('table.caption'), dataIndex: 'caption', ellipsis: true, search: false },
    {
      title: t('content.viewCount'),
      dataIndex: 'view_count',
      width: 130,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.view_count ?? 0} / ${r.view_users ?? 0}`,
    },
    {
      title: t('content.detailClickCount'),
      dataIndex: 'detail_click_count',
      width: 160,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.detail_click_count ?? 0} / ${r.detail_click_users ?? 0}`,
    },
    {
      title: t('content.likesCount'),
      key: 'likes_count',
      width: 120,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.likes_count ?? 0} / ${r.likes_users ?? 0}`,
    },
    {
      title: t('content.commentsCount'),
      key: 'comments_count',
      width: 120,
      search: false,
      render: (_: unknown, r: ContentMoment) => `${r.comments_count ?? 0} / ${r.comments_users ?? 0}`,
    },
    {
      title: t('content.msgClickCount'),
      key: 'msg_click_count',
      width: 160,
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
      width: 200,
      search: false,
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
      title: t('table.action'),
      key: 'action',
      width: 160,
      search: false,
      render: (_: unknown, record: ContentMoment) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(record);
              form.setFieldsValue({ caption: record.caption, image_url: record.image_url || '' });
              setHasPreview(!!record.has_preview);
              setPreviewPos(parsePreviewPos(record));
              setImageBusy(false);
              setOpen(true);
            }}
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

  async function handleSave() {
    if (imageBusy) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const assets = await imagePickerRef.current?.resolveAssets(!!editing) ?? {};
      let body: Record<string, unknown>;
      if (editing) {
        body = { caption: values.caption, ...assets };
      } else {
        body = { companion_id: companionId, caption: values.caption, ...assets };
        if (values.schedule_at) {
          body.schedule_at = dayjs(values.schedule_at).format(SCHEDULE_FMT);
          if (values.schedule_lang) body.schedule_lang = values.schedule_lang;
        }
      }
      const res = await adminFetch(
        editing ? `/api/admin/content/moments/${editing.id}` : '/api/admin/content/moments',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setOpen(false);
        setEditing(null);
        form.resetFields();
        setImageBusy(false);
        actionRef.current?.reload();
      } else if (res) {
        showError(await readErrorMessage(res, t('settings.saveFailed') as string));
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch (e) {
      showError((e as Error).message || (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p style={{ color: '#cf1322', marginBottom: 12 }}>{t('content.momentsEditHint')}</p>
      <ProTable<ContentMoment>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        options={false}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        request={async (params) => {
          const page = Math.max(1, Number(params.current) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
          const qs = new URLSearchParams({
            page: String(page),
            page_size: String(pageSize),
          });
          const momentIds = parseMomentIds(params.moment_id);
          if (momentIds.length) qs.set('moment_id', momentIds.join(','));
          try {
            const res = await adminFetchJson(`/api/admin/content/companions/${companionId}/moments?${qs.toString()}`);
            const { list, total } = parsePaged<ContentMoment>(res);
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
              if (companionLang) form.setFieldsValue({ schedule_lang: companionLang });
              setHasPreview(false);
              setPreviewPos(null);
              setImageBusy(false);
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
        onCancel={() => {
          if (imageBusy) return;
          setOpen(false);
        }}
        onOk={() => {
          if (imageBusy) return;
          void handleSave();
        }}
        confirmLoading={saving || imageBusy}
        okButtonProps={{ disabled: imageBusy }}
        cancelButtonProps={{ disabled: imageBusy }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="caption" label={t('table.caption')} rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="image_url" label={t('table.image')}>
            <MomentImagePicker
              ref={imagePickerRef}
              companionId={companionId}
              caption={caption}
              hasPreview={hasPreview}
              previewPos={previewPos}
              onBusyChange={setImageBusy}
            />
          </Form.Item>
          {!editing && (
            <>
              <Form.Item
                name="schedule_at"
                label={t('moment.scheduleAt')}
                extra={t('moment.scheduleAtHint')}
              >
                <DatePicker showTime format={SCHEDULE_FMT} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="schedule_lang"
                label={t('moment.scheduleLang')}
                dependencies={['schedule_at']}
                extra={t('moment.scheduleLangHint')}
                rules={[
                  ({ getFieldValue }) => ({
                    validator: async (_, value) => {
                      if (getFieldValue('schedule_at') && !value) {
                        throw new Error(t('moment.scheduleLangRequired') as string);
                      }
                    },
                  }),
                ]}
              >
                <Select
                  allowClear
                  options={CONTENT_LANGS}
                  placeholder={t('moment.scheduleLangPlaceholder') as string}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
