import { useTranslation } from 'react-i18next';
import { HeartFilled, HeartOutlined } from '@ant-design/icons';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';

export type ImMomentPayload = {
  momentId: string;
  caption: string;
  imageUrl: string;
  previewUrl: string;
  imageGenerating: boolean;
  liked: boolean;
  likesCount: number | null;
};

function pickCount(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = data[key];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return null;
}

export function parseImMomentContent(content: string | null | undefined): ImMomentPayload | null {
  const text = String(content || '').trim();
  if (!text.startsWith('{')) return null;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;
    const caption = typeof data.caption === 'string' ? data.caption.trim() : '';
    const imageUrl = typeof data.image_url === 'string' ? data.image_url.trim() : '';
    const previewUrl = typeof data.preview_url === 'string' ? data.preview_url.trim() : '';
    const momentId = data.moment_id == null ? '' : String(data.moment_id);
    if (!caption && !imageUrl && !previewUrl && !momentId) return null;
    return {
      momentId,
      caption,
      imageUrl,
      previewUrl,
      imageGenerating: data.image_generating === true,
      liked: data.liked === true || data.is_liked === true,
      likesCount: pickCount(data, ['likes_count', 'like_count', 'likes']),
    };
  } catch {
    return null;
  }
}

export function ImMomentCard({ content }: { content: string }) {
  const { t } = useTranslation();
  const moment = parseImMomentContent(content);
  if (!moment) {
    return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>;
  }
  const thumb = resolveAdminMediaUrl(moment.previewUrl || moment.imageUrl);
  const full = resolveAdminMediaUrl(moment.imageUrl || moment.previewUrl);
  const likeMark = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: moment.liked ? '#ff4d6a' : 'inherit',
        fontSize: 13,
        lineHeight: 1,
      }}
    >
      {moment.liked ? <HeartFilled /> : <HeartOutlined />}
      {moment.likesCount != null ? <span>{moment.likesCount}</span> : null}
    </span>
  );
  return (
    <div style={{ width: 280, maxWidth: '100%' }}>
      {moment.caption ? (
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, marginBottom: thumb || moment.imageGenerating ? 8 : 0 }}>
          {moment.caption}
        </div>
      ) : null}
      {moment.imageGenerating && !thumb ? (
        <>
          <div
            style={{
              height: 160,
              borderRadius: 12,
              background: '#f5f5f5',
              color: '#8c8c8c',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {t('im.momentGenerating')}
          </div>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', color: '#8c8c8c' }}>{likeMark}</div>
        </>
      ) : thumb ? (
        <a href={full || thumb} target="_blank" rel="noreferrer" style={{ display: 'block', position: 'relative' }}>
          <img
            src={thumb}
            alt={moment.caption || t('im.moment')}
            style={{
              width: '100%',
              maxHeight: 360,
              objectFit: 'cover',
              borderRadius: 12,
              display: 'block',
              background: '#f0f0f0',
            }}
          />
          <span
            style={{
              position: 'absolute',
              right: 10,
              bottom: 8,
              color: '#fff',
              textShadow: '0 1px 2px rgba(0,0,0,0.65)',
            }}
          >
            {likeMark}
          </span>
        </a>
      ) : (
        <div style={{ marginTop: 8, color: '#8c8c8c' }}>{likeMark}</div>
      )}
    </div>
  );
}
