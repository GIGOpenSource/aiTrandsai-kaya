import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Image, Input, InputNumber, Modal, Popconfirm, Space, Spin, Switch, Tooltip, Upload } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, LoadingOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess, uploadAdminImage } from '../../api/request';
import type { PrivateAlbumPhoto } from '../../types';
import { parsePaged } from './contentApi';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';

const MAX_PHOTOS = 50;
const DEFAULT_UNLOCK_X = 5;

function photoId(row: PrivateAlbumPhoto) {
  return Number(row.photo_id ?? row.id);
}

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const msg = data.message || data.error || data.detail;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch {
    // ignore
  }
  return fallback;
}

export default function CompanionPrivateAlbumPanel({ companionId }: { companionId: string }) {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<PrivateAlbumPhoto | null>(null);
  const [photos, setPhotos] = useState<PrivateAlbumPhoto[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const basePath = `/api/admin/content/companions/${companionId}/private-album`;

  const handleDelete = useCallback(
    async (row: PrivateAlbumPhoto) => {
      try {
        const res = await adminFetch(`${basePath}/${photoId(row)}`, { method: 'DELETE' });
        if (res && res.ok) {
          showSuccess(t('toast.deleteSuccess') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readErrorMessage(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [basePath, t],
  );

  const handleToggle = useCallback(
    async (row: PrivateAlbumPhoto, isEnabled: boolean) => {
      try {
        const res = await adminFetch(`${basePath}/${photoId(row)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: row.image_url,
            unlock_x: row.unlock_x ?? DEFAULT_UNLOCK_X,
            sort_order: row.sort_order ?? 0,
            is_enabled: isEnabled,
          }),
        });
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readErrorMessage(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [basePath, t],
  );

  const handleReorder = useCallback(
    async (from: number, to: number) => {
      if (to < 0 || to >= photos.length) return;
      const next = [...photos];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      try {
        const res = await adminFetch(`${basePath}/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: next.map((item, index) => ({ id: photoId(item), sort_order: index * 10 })),
          }),
        });
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          actionRef.current?.reload();
        } else {
          showError(res ? await readErrorMessage(res, t('toast.loadFailed') as string) : (t('toast.loadFailed') as string));
        }
      } catch {
        showError(t('toast.loadFailed') as string);
      }
    },
    [basePath, photos, t],
  );

  const openEdit = useCallback(
    (row: PrivateAlbumPhoto) => {
      setEditing(row);
      form.setFieldsValue({
        image_url: row.image_url || '',
        unlock_x: row.unlock_x ?? DEFAULT_UNLOCK_X,
        sort_order: row.sort_order ?? 0,
        is_enabled: row.is_enabled !== false,
      });
      setPreviewUrl(row.image_url || null);
      setOpen(true);
    },
    [form],
  );

  const columns: ProColumns<PrivateAlbumPhoto>[] = [
    {
      title: t('content.serialNo'),
      key: 'serial',
      width: 70,
      search: false,
      render: (_: unknown, __: PrivateAlbumPhoto, index: number) => index + 1,
    },
    {
      title: t('privateAlbum.photoId'),
      dataIndex: 'photo_id',
      width: 90,
      search: false,
      render: (_: unknown, row: PrivateAlbumPhoto) => photoId(row),
    },
    {
      title: t('table.image'),
      dataIndex: 'image_url',
      width: 88,
      search: false,
      render: (_: unknown, row: PrivateAlbumPhoto) =>
        row.image_url ? (
          <Image
            src={resolveAdminMediaUrl(row.image_url)}
            width={56}
            height={56}
            style={{ objectFit: 'cover', borderRadius: 4 }}
          />
        ) : (
          <span style={{ color: '#999' }}>—</span>
        ),
    },
    {
      title: t('privateAlbum.unlockX'),
      dataIndex: 'unlock_x',
      width: 140,
      search: false,
      render: (_: unknown, row: PrivateAlbumPhoto) => row.unlock_x ?? DEFAULT_UNLOCK_X,
    },
    {
      title: t('privateAlbum.sortOrder'),
      dataIndex: 'sort_order',
      width: 140,
      search: false,
      render: (_: unknown, row: PrivateAlbumPhoto, index: number) => (
        <Space>
          <span>{row.sort_order ?? index * 10}</span>
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => void handleReorder(index, index - 1)}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === photos.length - 1}
            onClick={() => void handleReorder(index, index + 1)}
          />
        </Space>
      ),
    },
    {
      title: t('table.status'),
      dataIndex: 'is_enabled',
      width: 100,
      search: false,
      render: (_: unknown, row: PrivateAlbumPhoto) => (
        <Switch checked={row.is_enabled !== false} onChange={(checked) => void handleToggle(row, checked)} />
      ),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 160,
      search: false,
      render: (_: unknown, row: PrivateAlbumPhoto) => (
        <Space size={0} wrap={false}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            {t('btn.edit')}
          </Button>
          <Popconfirm
            title={t('privateAlbum.confirmDelete')}
            onConfirm={() => handleDelete(row)}
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
    const values = await form.validateFields();
    const url = String(values.image_url || '').trim();
    if (!url) {
      form.setFields([{ name: 'image_url', errors: [t('privateAlbum.imageRequired') as string] }]);
      return;
    }
    setSaving(true);
    try {
      const body = {
        image_url: url,
        unlock_x: values.unlock_x ?? DEFAULT_UNLOCK_X,
        sort_order: values.sort_order ?? 0,
        is_enabled: values.is_enabled !== false,
      };
      const res = await adminFetch(editing ? `${basePath}/${photoId(editing)}` : basePath, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setOpen(false);
        setEditing(null);
        form.resetFields();
        setPreviewUrl(null);
        actionRef.current?.reload();
      } else {
        showError(res ? await readErrorMessage(res, t('settings.saveFailed') as string) : (t('settings.saveFailed') as string));
      }
    } catch (e) {
      showError((e as Error).message || (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('privateAlbum.hint')}</p>
      <ProTable<PrivateAlbumPhoto>
        actionRef={actionRef}
        rowKey={(row) => String(photoId(row))}
        columns={columns}
        search={false}
        options={false}
        pagination={false}
        request={async () => {
          try {
            const res = await adminFetchJson(basePath);
            const { list } = parsePaged<PrivateAlbumPhoto>(res);
            const sorted = [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
            setPhotos(sorted);
            return { data: sorted, success: true, total: sorted.length };
          } catch {
            showError(t('toast.loadFailed') as string);
            return { data: [], success: false, total: 0 };
          }
        }}
        toolBarRender={() => [
          <Tooltip key="new" title={photos.length >= MAX_PHOTOS ? t('privateAlbum.maxReached') : undefined}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={photos.length >= MAX_PHOTOS}
              onClick={() => {
                setEditing(null);
                form.resetFields();
              form.setFieldsValue({
                image_url: '',
                unlock_x: DEFAULT_UNLOCK_X,
                sort_order: photos.length * 10,
                is_enabled: true,
              });
              setPreviewUrl(null);
              setOpen(true);
              }}
            >
              {t('btn.new')}
            </Button>
          </Tooltip>,
        ]}
      />
      <Modal
        title={editing ? t('btn.edit') : t('btn.new')}
        open={open}
        onCancel={() => {
          if (uploading) return;
          setOpen(false);
          setPreviewUrl(null);
        }}
        onOk={() => void handleSave()}
        confirmLoading={saving || uploading}
        okButtonProps={{ disabled: uploading }}
        cancelButtonProps={{ disabled: uploading }}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="image_url" hidden rules={[{ required: true, message: t('privateAlbum.imageRequired') as string }]}>
            <Input />
          </Form.Item>
          <Form.Item label={t('table.image')} required>
            <Upload
              listType="picture-card"
              accept="image/*"
              maxCount={1}
              disabled={uploading}
              fileList={
                uploading
                  ? [{ uid: 'album', name: 'album', status: 'uploading' }]
                  : previewUrl
                    ? [{ uid: 'album', name: 'album', status: 'done', url: resolveAdminMediaUrl(previewUrl) }]
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
                    form.setFieldsValue({ image_url: url });
                    setPreviewUrl(url);
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
                form.setFieldsValue({ image_url: '' });
                setPreviewUrl(null);
              }}
            >
              {!previewUrl && !uploading && (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>{t('btn.upload')}</div>
                </div>
              )}
            </Upload>
          </Form.Item>
          <Form.Item name="unlock_x" label={t('privateAlbum.unlockX')} extra={t('privateAlbum.unlockXHint')} rules={[{ required: true }]}>
            <InputNumber min={1} max={9999} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sort_order" label={t('privateAlbum.sortOrder')} extra={t('privateAlbum.sortOrderHint')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="is_enabled"
            label={t('privateAlbum.enabled')}
            valuePropName="checked"
            extra={t('privateAlbum.enabledHint')}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
