/**
 * Moment 新建 / 编辑表单
 *
 * 路由：
 *  - 新建：/moments/new
 *  - 编辑：/moments/:id/edit
 *
 * 逻辑：
 *  1. 通过 useParams 获取 id，有 id 为编辑模式，否则为新建
 *  2. 编辑模式下，调用 GET /api/admin/content/moments/:id 拉取详情并填充表单
 *  3. 保存时：
 *     - 编辑：PUT /api/admin/content/moments/:id（不可改定时字段）
 *     - 新建：POST /api/admin/content/moments（可选 schedule_at + schedule_lang）
 *  4. 保存成功后跳转回列表页
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Form, Input, Button, Space, Card, DatePicker, Select, Descriptions, Tag } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminFetch, adminFetchJson, showSuccess, showError } from '../../api/request';
import type { ContentCompanion, ContentMoment } from '../../types';
import { CONTENT_LANGS, normalizeCompanion, unwrapResults } from '../Companions/contentApi';
import CompanionSearchSelect from './CompanionSearchSelect';
import MomentImagePicker, { type MomentImagePickerHandle } from './MomentImagePicker';
import { parsePreviewPos, type PreviewPos } from './cropPreview';

const SCHEDULE_FMT = 'YYYY-MM-DD HH:mm:ss';

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

export default function MomentForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [editCompanion, setEditCompanion] = useState<{ id: string; name?: string } | null>(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [previewPos, setPreviewPos] = useState<PreviewPos | null>(null);
  const [scheduleMeta, setScheduleMeta] = useState<Pick<
    ContentMoment,
    'schedule_at' | 'schedule_lang' | 'publish_at' | 'timezone' | 'is_scheduled' | 'is_published'
  > | null>(null);
  const imagePickerRef = useRef<MomentImagePickerHandle>(null);
  const companionId = Form.useWatch('companion_id', form) as string | undefined;
  const caption = Form.useWatch('caption', form) as string | undefined;

  const loadData = useCallback(async () => {
    if (!isEdit || !id) return;
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/content/moments/${id}`);
      if (!res || !res.ok) {
        showError(t('toast.loadFailed') as string);
        return;
      }
      const raw = await res.json();
      const item = unwrapResults<ContentMoment>(raw) ?? (raw as ContentMoment | undefined);
      if (item) {
        form.setFieldsValue({
          companion_id: item.companion_id,
          caption: item.caption,
          image_url: item.image_url || '',
        });
        if (item.companion_id) {
          setEditCompanion({ id: item.companion_id, name: item.companion_name });
        }
        setHasPreview(!!item.has_preview);
        setPreviewPos(parsePreviewPos(item));
        setScheduleMeta({
          schedule_at: item.schedule_at,
          schedule_lang: item.schedule_lang,
          publish_at: item.publish_at,
          timezone: item.timezone,
          is_scheduled: item.is_scheduled,
          is_published: item.is_published,
        });
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [form, id, isEdit, t]);

  const extraCompanionOptions = useMemo(() => {
    if (!editCompanion) return undefined;
    return [{
      value: editCompanion.id,
      label: `${editCompanion.name || editCompanion.id} (${editCompanion.id})`,
    }];
  }, [editCompanion]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function handleSave() {
    if (imageBusy) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const assets = await imagePickerRef.current?.resolveAssets(isEdit) ?? {};
      let res: Response | null;
      if (isEdit) {
        res = await adminFetch(`/api/admin/content/moments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caption: values.caption,
            ...assets,
          }),
        });
      } else {
        const body: Record<string, unknown> = {
          companion_id: values.companion_id,
          caption: values.caption,
          caption_lang: values.caption_lang,
          ...assets,
        };
        if (values.schedule_at) {
          body.schedule_at = dayjs(values.schedule_at).format(SCHEDULE_FMT);
          if (values.schedule_lang) body.schedule_lang = values.schedule_lang;
        }
        res = await adminFetch('/api/admin/content/moments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        navigate('/moments');
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

  const showScheduleReadonly =
    isEdit &&
    !!(scheduleMeta?.schedule_at || scheduleMeta?.publish_at || scheduleMeta?.is_scheduled);

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/moments')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>{isEdit ? t('btn.edit') + ' ' + t('page.moments') : t('btn.new') + ' ' + t('page.moments')}</h2>
      </div>

      <Card loading={loading}>
        <Form form={form} layout="vertical">
          <Form.Item name="companion_id" label={t('table.companion')} rules={[{ required: true, message: t('moment.selectCompanion') }]}>
            <CompanionSearchSelect
              disabled={isEdit}
              placeholder={t('moment.selectCompanion') as string}
              extraOptions={extraCompanionOptions}
              style={{ width: '100%' }}
              onCompanionSelect={(companion) => {
                if (isEdit || !companion) return;
                const applyLang = (lang?: string) => {
                  const next = (lang || '').trim();
                  if (!next) return;
                  form.setFieldsValue({ schedule_lang: next });
                };
                if (companion.language) {
                  applyLang(companion.language);
                  return;
                }
                void adminFetchJson(`/api/admin/content/companions/${companion.id}`)
                  .then((res) => {
                    const raw = unwrapResults<ContentCompanion>(res) ?? (res as ContentCompanion | null);
                    applyLang(raw ? normalizeCompanion(raw).language : undefined);
                  })
                  .catch(() => undefined);
              }}
            />
          </Form.Item>
          {isEdit && (
            <p style={{ color: '#cf1322', marginTop: -8 }}>{t('content.momentsEditHint')}</p>
          )}
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

          {!isEdit && (
            <>
              <Form.Item
                name="schedule_at"
                label={t('moment.scheduleAt')}
                extra={t('moment.scheduleAtHint')}
              >
                <DatePicker
                  showTime
                  format={SCHEDULE_FMT}
                  style={{ width: '100%' }}
                  placeholder={SCHEDULE_FMT}
                />
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

          {showScheduleReadonly && scheduleMeta && (
            <Descriptions
              size="small"
              column={1}
              bordered
              style={{ marginBottom: 16 }}
              title={
                <Space>
                  {t('moment.publishStatus')}
                  {scheduleMeta.is_scheduled ? (
                    <Tag color="orange">{t('moment.scheduled')}</Tag>
                  ) : (
                    <Tag color="green">{t('moment.published')}</Tag>
                  )}
                </Space>
              }
            >
              {scheduleMeta.schedule_at ? (
                <Descriptions.Item label={t('moment.localScheduleAt')}>
                  {scheduleMeta.schedule_at}
                  {scheduleMeta.schedule_lang ? ` (${scheduleMeta.schedule_lang})` : ''}
                </Descriptions.Item>
              ) : null}
              {scheduleMeta.timezone ? (
                <Descriptions.Item label={t('moment.timezone')}>{scheduleMeta.timezone}</Descriptions.Item>
              ) : null}
              {scheduleMeta.publish_at ? (
                <Descriptions.Item label={t('moment.utcPublishAt')}>{scheduleMeta.publish_at}</Descriptions.Item>
              ) : null}
            </Descriptions>
          )}

          <Space>
            <Button type="primary" onClick={handleSave} loading={saving || imageBusy} disabled={imageBusy}>
              {t('btn.save')}
            </Button>
            <Button onClick={() => navigate('/moments')}>
              {t('btn.cancel')}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
