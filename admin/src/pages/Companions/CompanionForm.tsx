import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Form, Input, InputNumber, Select, Button, Space, Card, Tag, Typography, Tabs, Switch, Upload, Spin } from 'antd';
import { ArrowLeftOutlined, LoadingOutlined, UploadOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError, uploadAdminImage } from '../../api/request';
import { CONTENT_LANGS, normalizeCompanion, unwrapResults } from './contentApi';
import type { ContentCompanion } from '../../types';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import StrategyPanel from './StrategyPanel';
import CompanionMomentsPanel from './CompanionMomentsPanel';
import CompanionPrivateAlbumPanel from './CompanionPrivateAlbumPanel';

type TagDef = { key: string; group: string; label_zh: string; enabled: boolean };

const MBTI_OPTIONS = [
  'INFP', 'INFJ', 'INTP', 'INTJ',
  'ISFP', 'ISFJ', 'ISTP', 'ISTJ',
  'ENFP', 'ENFJ', 'ENTP', 'ENTJ',
  'ESFP', 'ESFJ', 'ESTP', 'ESTJ',
].map((value) => ({ value, label: value }));

const PROFILE_FIELDS = [
  'name', 'avatar_url', 'gender', 'age', 'city', 'language', 'tier', 'is_active',
  'moderation_status', 'country', 'region_key', 'region_label',
  'description', 'mbti', 'personality', 'sexual_orientation', 'appearance',
  'background', 'life_story', 'cultural_values', 'gender_perspective',
  'speech_style', 'hobbies', 'values', 'fears', 'love_view', 'daily_routine',
  'favorite_things', 'tags', 'profile_backgrounds',
];

const MAX_PROFILE_BACKGROUNDS = 3;

function normalizeBackgrounds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, MAX_PROFILE_BACKGROUNDS);
}

export default function CompanionForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'profile';
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoTags, setAutoTags] = useState<string[]>([]);
  const [opsOptions, setOpsOptions] = useState<{ value: string; label: string }[]>([]);
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | null>(null);
  const [profileBackgrounds, setProfileBackgrounds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [bgUploading, setBgUploading] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      let autoKeySet = new Set<string>();
      try {
        const list = await adminFetchJson<TagDef[]>('/api/admin/recommend/tag-defs?side=agent');
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : [];
        autoKeySet = new Set(
          rows
            .filter((d) => d.group === 'personality' || d.group === 'gender' || d.group === 'orientation')
            .map((d) => d.key),
        );
        setOpsOptions(
          rows
            .filter((d) => d.group === 'ops' && d.enabled)
            .map((d) => ({ value: d.key, label: `${d.key} (${d.label_zh || d.key})` })),
        );
      } catch {
        /* ignore tag-defs failure */
      }

      if (!isEdit || !id) return;

      setLoading(true);
      try {
        const res = await adminFetchJson(`/api/admin/content/companions/${id}`);
        if (cancelled || !res) return;
        const raw = unwrapResults<ContentCompanion>(res) ?? (res as ContentCompanion);
        const data = normalizeCompanion(raw as ContentCompanion);
        const backgrounds = normalizeBackgrounds(data.profile_backgrounds);
        form.setFieldsValue({
          ...data,
          avatar_url: data.avatar_url || '',
          is_active: data.is_active !== false,
          moderation_status: data.moderation_status || 'published',
          profile_backgrounds: backgrounds,
        });
        setIsDeleted(!!data.is_deleted);
        setPreviewAvatarUrl(data.avatar_url || null);
        setProfileBackgrounds(backgrounds);
        const allTags = (data.tags || []) as string[];
        const autoOnly = allTags.filter((k) => autoKeySet.has(k) || k.startsWith('gender:'));
        setAutoTags(autoOnly);
        form.setFieldValue(
          'tags',
          allTags.filter((k) => !autoOnly.includes(k)),
        );
      } catch {
        if (!cancelled) showError(t('toast.loadFailed') as string);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [form, id, isEdit, t]);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      PROFILE_FIELDS.forEach((key) => {
        if (values[key] !== undefined) payload[key] = values[key];
      });
      if (typeof payload.avatar_url === 'string') payload.avatar = payload.avatar_url;
      payload.profile_backgrounds = normalizeBackgrounds(profileBackgrounds);
      if (values.i18n_profile) payload.i18n_profile = values.i18n_profile;
      // is_deleted 只读，勿写入 profile PUT

      let res: Response | null;
      if (isEdit) {
        res = await adminFetch(`/api/admin/content/companions/${id}/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await adminFetch('/api/admin/companions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            avatar: values.avatar_url,
          }),
        });
      }
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        if (!isEdit) navigate('/companions');
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('settings.saveFailed');
      showError(msg as string);
    } finally {
      setSaving(false);
    }
  }

  const profileForm = (
    <Form form={form} layout="vertical" initialValues={{ moderation_status: 'published', is_active: true }}>
      <Form.Item name="name" label={t('table.name')} rules={[{ required: true }]}>
        <Input maxLength={64} />
      </Form.Item>
      <Form.Item name="avatar_url" hidden>
        <Input />
      </Form.Item>
      <Form.Item label={t('table.avatar')}>
        <Upload
          listType="picture-card"
          accept="image/*"
          maxCount={1}
          disabled={uploading}
          fileList={
            uploading
              ? [{ uid: 'avatar', name: 'avatar', status: 'uploading' }]
              : previewAvatarUrl
                ? [{ uid: 'avatar', name: 'avatar', status: 'done', url: resolveAdminMediaUrl(previewAvatarUrl) }]
                : []
          }
          itemRender={(originNode, file) => {
            if (file.status === 'uploading') {
              return (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#fafafa',
                    borderRadius: 8,
                    gap: 8,
                  }}
                >
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                  <span style={{ fontSize: 12, color: '#999' }}>{t('toast.uploading')}</span>
                </div>
              );
            }
            return originNode;
          }}
          customRequest={({ file, onSuccess, onError }) => {
            setUploading(true);
            void uploadAdminImage(file)
              .then((url) => {
                form.setFieldsValue({ avatar_url: url });
                setPreviewAvatarUrl(url);
                onSuccess?.({}, file);
              })
              .catch((err: Error) => {
                showError(err.message || (t('toast.generateFailed') as string));
                onError?.(err);
              })
              .finally(() => setUploading(false));
          }}
          onRemove={() => {
            if (uploading) return false;
            form.setFieldsValue({ avatar_url: '' });
            setPreviewAvatarUrl(null);
          }}
        >
          {!previewAvatarUrl && !uploading && (
            <div>
              <UploadOutlined />
              <div style={{ marginTop: 8 }}>{t('btn.upload')}</div>
            </div>
          )}
        </Upload>
      </Form.Item>
      <Form.Item
        label={t('companion.profileBackgrounds')}
        extra={t('companion.profileBackgroundsHint')}
      >
        <Upload
          listType="picture-card"
          accept="image/*"
          multiple
          maxCount={MAX_PROFILE_BACKGROUNDS}
          disabled={bgUploading}
          fileList={profileBackgrounds.map((url) => ({
            uid: url,
            name: url,
            status: 'done' as const,
            url: resolveAdminMediaUrl(url),
          }))}
          customRequest={({ file, onSuccess, onError }) => {
            if (profileBackgrounds.length >= MAX_PROFILE_BACKGROUNDS) {
              showError(t('companion.profileBackgroundsMax') as string);
              onError?.(new Error('max'));
              return;
            }
            setBgUploading(true);
            void uploadAdminImage(file)
              .then((url) => {
                setProfileBackgrounds((prev) => {
                  const next = normalizeBackgrounds([...prev, url]);
                  form.setFieldsValue({ profile_backgrounds: next });
                  return next;
                });
                onSuccess?.({}, file);
              })
              .catch((err: Error) => {
                showError(err.message || (t('toast.generateFailed') as string));
                onError?.(err);
              })
              .finally(() => setBgUploading(false));
          }}
          onRemove={(file) => {
            if (bgUploading) return false;
            setProfileBackgrounds((prev) => {
              const next = prev.filter((url) => url !== file.uid);
              form.setFieldsValue({ profile_backgrounds: next });
              return next;
            });
          }}
        >
          {profileBackgrounds.length < MAX_PROFILE_BACKGROUNDS ? (
            <div>
              {bgUploading ? <LoadingOutlined /> : <UploadOutlined />}
              <div style={{ marginTop: 8 }}>{t('btn.upload')}</div>
            </div>
          ) : null}
        </Upload>
      </Form.Item>
      <Form.Item name="gender" label={t('table.gender')} rules={[{ required: true }]}>
        <Select>
          <Select.Option value="女">{t('gender.female')}</Select.Option>
          <Select.Option value="男">{t('gender.male')}</Select.Option>
        </Select>
      </Form.Item>
      <Form.Item name="age" label={t('table.age')} rules={[{ required: true }]}>
        <InputNumber min={18} max={99} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="city" label={t('table.city')} rules={[{ required: true }]}>
        <Input maxLength={64} />
      </Form.Item>
      <Form.Item name="country" label={t('companion.country')}>
        <Input maxLength={16} placeholder="TR / CN / US" />
      </Form.Item>
      <Form.Item name="region_key" label={t('companion.regionKey')}>
        <Input maxLength={64} placeholder="tr_istanbul" />
      </Form.Item>
      <Form.Item name="region_label" label={t('companion.regionLabel')}>
        <Input maxLength={64} placeholder={t('companion.regionLabelPlaceholder') as string} />
      </Form.Item>
      <Form.Item name="language" label={t('table.language')}>
        <Select options={CONTENT_LANGS} />
      </Form.Item>
      <Form.Item name="tier" label={t('table.tier')}>
        <Select
          options={[
            { value: 's', label: t('tier.s') },
            { value: 'featured', label: t('tier.featured') },
            { value: 'candidate', label: t('tier.candidate') },
            { value: 'ad', label: t('tier.ad') },
            { value: 'ops', label: t('tier.ops') },
          ]}
        />
      </Form.Item>
      <Form.Item name="is_active" label={t('content.isActive')} valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="moderation_status" label={t('companion.moderationStatus')}>
        <Select
          options={[
            { value: 'published', label: t('companion.moderation.published') },
            { value: 'under_review', label: t('companion.moderation.underReview') },
            { value: 'removed', label: t('companion.moderation.removed') },
            { value: 'restored', label: t('companion.moderation.restored') },
          ]}
        />
      </Form.Item>
      {isEdit ? (
        <Form.Item label={t('table.isDeleted')}>
          <Tag color={isDeleted ? 'error' : 'success'}>
            {isDeleted ? t('status.deleted') : t('status.active')}
          </Tag>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {t('companion.isDeletedHint')}
          </Typography.Text>
        </Form.Item>
      ) : null}
      <Form.Item name="description" label={t('companion.description')}>
        <Input.TextArea rows={4} maxLength={1500} showCount />
      </Form.Item>
      <Form.Item name="mbti" label={t('companion.mbti')}>
        <Select allowClear showSearch options={MBTI_OPTIONS} placeholder="INFP" />
      </Form.Item>
      <Form.Item name="personality" label={t('companion.personality')}>
        <Input.TextArea rows={3} maxLength={500} />
      </Form.Item>
      <Form.Item name="sexual_orientation" label={t('table.sexualOrientation')}>
        <Select allowClear>
          <Select.Option value="heterosexual">{t('orientation.heterosexual')}</Select.Option>
          <Select.Option value="homosexual">{t('orientation.homosexual')}</Select.Option>
          <Select.Option value="bisexual">{t('orientation.bisexual')}</Select.Option>
          <Select.Option value="pansexual">{t('orientation.pansexual')}</Select.Option>
          <Select.Option value="asexual">{t('orientation.asexual')}</Select.Option>
          <Select.Option value="secret">{t('orientation.secret')}</Select.Option>
        </Select>
      </Form.Item>
      <Form.Item label={t('recommend.autoTags')}>
        <div>
          {autoTags.length
            ? autoTags.map((k) => <Tag key={k}>{k}</Tag>)
            : <Typography.Text type="secondary">-</Typography.Text>}
        </div>
      </Form.Item>
      <Form.Item name="tags" label={t('recommend.opsTags')}>
        <Select mode="multiple" allowClear options={opsOptions} />
      </Form.Item>
      <Form.Item name="appearance" label={t('companion.appearance')}>
        <Input.TextArea rows={3} maxLength={1000} showCount />
      </Form.Item>
      <Form.Item name="background" label={t('companion.background')}>
        <Input.TextArea rows={3} maxLength={1000} />
      </Form.Item>
      <Form.Item name="life_story" label={t('companion.lifeStory')}>
        <Input.TextArea rows={4} maxLength={2000} showCount />
      </Form.Item>
      <Form.Item name="cultural_values" label={t('companion.culturalValues')}>
        <Input.TextArea rows={3} maxLength={1500} showCount />
      </Form.Item>
      <Form.Item name="gender_perspective" label={t('companion.genderPerspective')}>
        <Input.TextArea rows={3} maxLength={1000} showCount />
      </Form.Item>
      <Form.Item name="speech_style" label={t('companion.speechStyle')}>
        <Input.TextArea rows={3} maxLength={500} />
      </Form.Item>
      <Form.Item name="hobbies" label={t('companion.hobbies')}>
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
      <Form.Item name="values" label={t('companion.values')}>
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
      <Form.Item name="fears" label={t('companion.fears')}>
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
      <Form.Item name="love_view" label={t('companion.loveView')}>
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
      <Form.Item name="daily_routine" label={t('companion.dailyRoutine')}>
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
      <Form.Item name="favorite_things" label={t('companion.favoriteThings')}>
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
      <Space>
        <Button type="primary" onClick={handleSave} loading={saving || uploading || bgUploading} disabled={uploading || bgUploading}>
          {t('btn.save')}
        </Button>
        <Button onClick={() => navigate('/companions')}>
          {t('btn.cancel')}
        </Button>
      </Space>
    </Form>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/companions')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>
          {isEdit ? `${t('btn.edit')} ${t('page.companions')}` : `${t('btn.new')} ${t('page.companions')}`}
        </h2>
      </div>

      {isEdit && id ? (
        <Tabs
          activeKey={tab}
          destroyInactiveTabPane
          onChange={(key) => setSearchParams({ tab: key })}
          items={[
            {
              key: 'profile',
              label: t('content.tabProfile'),
              children: <Card loading={loading}>{profileForm}</Card>,
            },
            {
              key: 'strategy',
              label: t('content.tabStrategy'),
              children: tab === 'strategy' ? <StrategyPanel key={id} companionId={id} /> : null,
            },
            {
              key: 'moments',
              label: t('content.tabMoments'),
              children: tab === 'moments' ? <CompanionMomentsPanel key={id} companionId={id} /> : null,
            },
            {
              key: 'private-album',
              label: t('content.tabPrivateAlbum'),
              children: tab === 'private-album' ? <CompanionPrivateAlbumPanel key={id} companionId={id} /> : null,
            },
          ]}
        />
      ) : (
        <Card loading={loading}>{profileForm}</Card>
      )}
    </div>
  );
}
