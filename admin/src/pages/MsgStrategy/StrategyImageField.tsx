import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Image, Space, Spin, Upload } from 'antd';
import { DeleteOutlined, LoadingOutlined, UploadOutlined } from '@ant-design/icons';
import { showError, uploadAdminImage } from '../../api/request';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';

type Props = {
  value?: string | null;
  onChange?: (url: string) => void;
  disabled?: boolean;
};

function asUrl(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function StrategyImageThumb({ url }: { url?: string | null }) {
  const { t } = useTranslation();
  const src = asUrl(url);
  if (!src) return <span style={{ color: '#999' }}>{t('strategy.noImage')}</span>;
  return (
    <Image
      src={resolveAdminMediaUrl(src)}
      width={40}
      height={40}
      style={{ objectFit: 'cover', borderRadius: 4 }}
    />
  );
}

export default function StrategyImageField({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const url = asUrl(value);

  return (
    <Space align="start" wrap>
      <Upload
        listType="picture-card"
        accept="image/*"
        maxCount={1}
        disabled={disabled || uploading}
        showUploadList={false}
        customRequest={({ file, onSuccess, onError }) => {
          setUploading(true);
          void uploadAdminImage(file)
            .then((next) => {
              onChange?.(next);
              onSuccess?.({}, file);
            })
            .catch((err: Error) => {
              showError(err.message || (t('toast.generateFailed') as string));
              onError?.(err);
            })
            .finally(() => setUploading(false));
        }}
      >
        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 22 }} spin />} />
          </div>
        ) : url ? (
          <img src={resolveAdminMediaUrl(url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div>
            <UploadOutlined />
            <div style={{ marginTop: 8 }}>{t('btn.upload')}</div>
          </div>
        )}
      </Upload>
      {url ? (
        <Button danger icon={<DeleteOutlined />} disabled={disabled || uploading} onClick={() => onChange?.('')}>
          {t('strategy.clearImage')}
        </Button>
      ) : null}
    </Space>
  );
}
