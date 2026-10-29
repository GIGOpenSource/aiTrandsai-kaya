import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Image, Radio, Space, Spin, Typography, Upload } from 'antd';
import { EyeOutlined, LoadingOutlined, RobotOutlined, UploadOutlined } from '@ant-design/icons';
import { generateMomentImage, showError, showSuccess, uploadAdminImage } from '../../api/request';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import MomentCropFrame from './MomentCropFrame';
import {
  blobFromSrc,
  coverLayout,
  cropCoverBlob,
  offsetToPos,
  resolvePreviewPos,
  type CropOffset,
  type PreviewPos,
} from './cropPreview';

export type MomentImageAssets = {
  image_url?: string | null;
  preview_url?: string | null;
  preview_pos?: PreviewPos | null;
};

export type MomentImagePickerHandle = {
  resolveImageUrl: () => Promise<string>;
  resolveAssets: (isEdit: boolean) => Promise<MomentImageAssets>;
};

type ImageSource = 'upload' | 'ai';

type Props = {
  companionId?: string;
  caption?: string;
  value?: string | null;
  hasPreview?: boolean;
  previewPos?: PreviewPos | null;
  onChange?: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

/** 4:3 预览旁的完整原图。需要时改为 true。 */
const SHOW_ORIGINAL_SIDE = false;

function blobToFile(blob: Blob, name: string): File {
  const type = blob.type || 'image/jpeg';
  return new File([blob], name, { type });
}

const MomentImagePicker = forwardRef<MomentImagePickerHandle, Props>(function MomentImagePicker(
  { companionId, caption, value, hasPreview, previewPos, onChange, onBusyChange },
  ref,
) {
  const { t } = useTranslation();
  const [source, setSource] = useState<ImageSource>('upload');
  const [action, setAction] = useState<'idle' | 'generate' | 'upload'>('idle');
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const busy = action !== 'idle';
  const pendingBlobRef = useRef<Blob | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  const hasPreviewRef = useRef(!!hasPreview);
  const onChangeRef = useRef(onChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const cropOffsetRef = useRef<CropOffset>({ x: 0, y: 0 });
  const cropLayoutRef = useRef<ReturnType<typeof coverLayout> | null>(null);
  const cropDirtyRef = useRef(false);
  const originalChangedRef = useRef(false);
  const restoredPos = originalChangedRef.current ? null : previewPos;
  valueRef.current = value;
  hasPreviewRef.current = !!hasPreview;
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;

  const setActionState = useCallback((next: 'idle' | 'generate' | 'upload') => {
    setAction(next);
    onBusyChangeRef.current?.(next !== 'idle');
  }, []);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const clearPending = useCallback(() => {
    pendingBlobRef.current = null;
    revokeObjectUrl();
    setLocalPreview(null);
  }, [revokeObjectUrl]);

  useEffect(() => () => revokeObjectUrl(), [revokeObjectUrl]);

  useEffect(() => {
    if (pendingBlobRef.current) return;
    setLocalPreview(null);
    originalChangedRef.current = false;
    cropDirtyRef.current = false;
  }, [value]);

  const displayUrl = localPreview || value || null;

  async function uploadOriginal(blob: Blob) {
    return uploadAdminImage(blobToFile(blob, 'moment.jpg'), { folder: 'moments' });
  }

  async function uploadPreview(blob: Blob) {
    return uploadAdminImage(blobToFile(blob, 'preview.jpg'), {
      quality: 50,
      folder: 'moments/preview',
      max_edge: 1080,
      filename: 'preview.jpg',
    });
  }

  useImperativeHandle(ref, () => {
    const resolveAssets = async (isEdit: boolean): Promise<MomentImageAssets> => {
      const pending = pendingBlobRef.current;
      let imageUrl = (pending ? '' : valueRef.current) || '';
      if (pending) {
        setActionState('upload');
        try {
          imageUrl = await uploadOriginal(pending);
          onChangeRef.current?.(imageUrl);
        } catch (e) {
          setActionState('idle');
          throw e;
        }
      }
      if (!imageUrl) {
        setActionState('idle');
        return isEdit
          ? { image_url: null, preview_url: '', preview_pos: null }
          : {};
      }
      const imageChanged = !!pending || originalChangedRef.current;
      const cropChanged = cropDirtyRef.current;
      if (isEdit && !imageChanged && !cropChanged) {
        setActionState('idle');
        return {};
      }
      setActionState('upload');
      try {
        const src = objectUrlRef.current
          || (imageUrl.startsWith('blob:') ? imageUrl : resolveAdminMediaUrl(imageUrl));
        const sourceBlob = await blobFromSrc(src, pending);
        const cropped = await cropCoverBlob(sourceBlob, cropOffsetRef.current);
        const previewUrl = await uploadPreview(cropped);
        const layout = cropLayoutRef.current;
        const pos = resolvePreviewPos(layout ? offsetToPos(cropOffsetRef.current, layout) : null);
        pendingBlobRef.current = null;
        originalChangedRef.current = false;
        cropDirtyRef.current = false;
        const out: MomentImageAssets = {
          preview_url: previewUrl,
          preview_pos: pos,
        };
        if (!isEdit || imageChanged) out.image_url = imageUrl;
        return out;
      } finally {
        setActionState('idle');
      }
    };
    return {
      resolveImageUrl: async () => {
        const assets = await resolveAssets(false);
        return assets.image_url || '';
      },
      resolveAssets,
    };
  }, [setActionState]);

  function setPendingBlob(blob: Blob) {
    revokeObjectUrl();
    const objUrl = URL.createObjectURL(blob);
    objectUrlRef.current = objUrl;
    pendingBlobRef.current = blob;
    originalChangedRef.current = true;
    cropDirtyRef.current = true;
    setLocalPreview(objUrl);
  }

  async function handleGenerate() {
    const cid = (companionId || '').trim();
    const text = (caption || '').trim();
    if (!cid) {
      showError(t('moment.generateNeedCompanion') as string);
      return;
    }
    if (!text) {
      showError(t('moment.generateNeedCaption') as string);
      return;
    }
    setActionState('generate');
    try {
      const blob = await generateMomentImage(cid, text);
      setPendingBlob(blob);
      showSuccess(t('toast.generated') as string);
    } catch (e) {
      showError((e as Error).message || (t('toast.generateFailed') as string));
    } finally {
      setActionState('idle');
    }
  }

  function handleRemove() {
    if (busy) return false;
    clearPending();
    originalChangedRef.current = true;
    cropDirtyRef.current = false;
    setPreviewOpen(false);
    onChange?.('');
    return true;
  }

  const previewSrc = displayUrl
    ? (displayUrl.startsWith('blob:') ? displayUrl : resolveAdminMediaUrl(displayUrl))
    : '';

  return (
    <div>
      {previewSrc ? (
        <Image
          src={previewSrc}
          style={{ display: 'none' }}
          preview={{
            visible: previewOpen,
            src: previewSrc,
            zIndex: 1200,
            onVisibleChange: (open) => setPreviewOpen(open),
          }}
        />
      ) : null}
      <Radio.Group
        value={source}
        disabled={busy}
        onChange={(e) => setSource(e.target.value as ImageSource)}
        style={{ marginBottom: 12 }}
      >
        <Radio.Button value="upload">{t('moment.imageSourceUpload')}</Radio.Button>
        <Radio.Button value="ai">{t('moment.imageSourceAi')}</Radio.Button>
      </Radio.Group>

      {source === 'upload' ? (
        <Upload
          accept="image/*"
          maxCount={1}
          showUploadList={false}
          disabled={busy}
          beforeUpload={(file) => {
            setPendingBlob(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} disabled={busy}>
            {displayUrl ? t('btn.upload') : t('btn.upload')}
          </Button>
        </Upload>
      ) : (
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {t('moment.generateImageHint')}
          </Typography.Text>
          <Space>
            <Button icon={<RobotOutlined />} loading={busy} disabled={busy} onClick={() => void handleGenerate()}>
              {previewSrc ? t('btn.regenerate') : t('moment.generateImage')}
            </Button>
          </Space>
        </div>
      )}

      {busy ? (
        <div style={{ marginTop: 12 }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
          <span style={{ marginLeft: 8, color: '#999' }}>
            {action === 'generate' ? t('moment.generatingImage') : t('toast.uploading')}
          </span>
        </div>
      ) : null}

      {previewSrc && !busy ? (
        <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {SHOW_ORIGINAL_SIDE ? (
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('moment.originalImage')}
            </Typography.Text>
            <div
              style={{
                width: 120,
                maxHeight: 220,
                overflow: 'auto',
                borderRadius: 8,
                border: '1px solid #d9d9d9',
                background: '#f5f5f5',
              }}
            >
              <img src={previewSrc} alt="" style={{ width: '100%', display: 'block' }} />
            </div>
          </div>
          ) : null}
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('moment.previewCrop')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {t('moment.previewCropHint')}
            </Typography.Text>
            <MomentCropFrame
              src={previewSrc}
              disabled={busy}
              initialPos={resolvePreviewPos(restoredPos)}
              onOffsetChange={(offset, dirty, layout) => {
                cropOffsetRef.current = offset;
                if (layout) cropLayoutRef.current = layout;
                if (dirty) cropDirtyRef.current = true;
              }}
            />
          </div>
        </div>
      ) : null}
      {previewSrc && !busy ? (
          <Space style={{ marginTop: 12 }}>
            <Button icon={<EyeOutlined />} disabled={busy} onClick={() => setPreviewOpen(true)}>
              {t('btn.view')}
            </Button>
            <Button disabled={busy} onClick={() => handleRemove()}>
              {t('btn.delete')}
            </Button>
          </Space>
      ) : null}
    </div>
  );
});

MomentImagePicker.displayName = 'MomentImagePicker';

export default MomentImagePicker;
