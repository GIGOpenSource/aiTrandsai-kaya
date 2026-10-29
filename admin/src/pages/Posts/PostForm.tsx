import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Form, Input, InputNumber, Select, Space, Upload } from 'antd';
import { ArrowLeftOutlined, LoadingOutlined, UploadOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess, uploadAdminImage } from '../../api/request';
import type { ContentPost } from '../../types';
import { CONTENT_LANGS, unwrapResults } from '../Companions/contentApi';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import PostCommentsPanel from './PostCommentsPanel';

export default function PostForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    if (!isEdit || !id) return;
    setLoading(true);
    try {
      const res = await adminFetchJson(`/api/admin/content/posts/${id}`);
      const item = unwrapResults<ContentPost>(res) ?? (res as ContentPost | undefined);
      if (item) {
        form.setFieldsValue({
          title: item.title,
          content: item.content,
          category: item.category || '',
          language: item.language || 'zh',
          user_id: item.user_id ?? undefined,
          user_name: item.user_name || '',
        });
        setImages(Array.isArray(item.images) ? item.images.filter(Boolean) : []);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    } finally {
      setLoading(false);
    }
  }, [form, id, isEdit, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: values.title,
        content: values.content,
        images,
        category: values.category || '',
        language: values.language || 'zh',
      };
      if (!isEdit) {
        if (values.user_id) payload.user_id = values.user_id;
        if (values.user_name) payload.user_name = values.user_name;
      }
      let res: Response | null;
      if (isEdit) {
        res = await adminFetch(`/api/admin/content/posts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await adminFetch('/api/admin/content/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        if (!isEdit) {
          const body = await res.json().catch(() => null);
          const created = unwrapResults<{ id?: number }>(body) ?? body;
          const newId = created && typeof created === 'object' ? (created as { id?: number }).id : undefined;
          if (newId) navigate(`/posts/${newId}/edit`, { replace: true });
          else navigate('/posts');
        }
      } else {
        const err = await res?.text();
        showError(err || (t('settings.saveFailed') as string));
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/posts')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>
          {isEdit ? `${t('btn.edit')} ${t('page.posts')}` : `${t('btn.new')} ${t('page.posts')}`}
        </h2>
      </div>

      <Card loading={loading} style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={{ language: 'zh' }}>
          <Form.Item name="title" label={t('table.title')} rules={[{ required: true }]}>
            <Input maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="content" label={t('audit.content')} rules={[{ required: true }]}>
            <Input.TextArea rows={6} maxLength={5000} showCount style={{ marginBottom: 24 }} />
          </Form.Item>
          <Form.Item label={t('post.images')}>
            <Upload
              listType="picture-card"
              accept="image/*"
              multiple
              disabled={uploading}
              fileList={images.map((url) => ({
                uid: url,
                name: url,
                status: 'done' as const,
                url: resolveAdminMediaUrl(url),
              }))}
              customRequest={({ file, onSuccess, onError }) => {
                setUploading(true);
                void uploadAdminImage(file)
                  .then((url) => {
                    setImages((prev) => [...prev, url]);
                    onSuccess?.({}, file);
                  })
                  .catch((err: Error) => {
                    showError(err.message || (t('toast.generateFailed') as string));
                    onError?.(err);
                  })
                  .finally(() => setUploading(false));
              }}
              onRemove={(file) => {
                if (uploading) return false;
                setImages((prev) => prev.filter((url) => url !== file.uid));
              }}
            >
              <div>
                {uploading ? <LoadingOutlined /> : <UploadOutlined />}
                <div style={{ marginTop: 8 }}>{t('btn.upload')}</div>
              </div>
            </Upload>
          </Form.Item>
          <Form.Item name="category" label={t('table.category')}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="language" label={t('table.language')}>
            <Select options={CONTENT_LANGS} />
          </Form.Item>
          {!isEdit && (
            <>
              <Form.Item name="user_id" label={t('table.userId')}>
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="user_name" label={t('post.authorName')} extra={t('post.authorNameHint')}>
                <Input maxLength={50} />
              </Form.Item>
            </>
          )}
          <Space>
            <Button type="primary" onClick={() => void handleSave()} loading={saving || uploading} disabled={uploading}>
              {t('btn.save')}
            </Button>
            <Button onClick={() => navigate('/posts')}>{t('btn.cancel')}</Button>
          </Space>
        </Form>
      </Card>

      {isEdit && id ? (
        <Card>
          <PostCommentsPanel postId={id} />
        </Card>
      ) : null}
    </div>
  );
}
