import { adminFetch } from '../../api/request';

export const PREVIEW_RATIO = 4 / 3;
export const PREVIEW_VIEW_W = 320;
export const PREVIEW_VIEW_H = Math.round(PREVIEW_VIEW_W / PREVIEW_RATIO);

export type CropOffset = { x: number; y: number };
export type PreviewPos = { x: number; y: number };

export type CoverLayout = {
  scale: number;
  dw: number;
  dh: number;
  minX: number;
  minY: number;
};

export function coverLayout(nw: number, nh: number, vw = PREVIEW_VIEW_W, vh = PREVIEW_VIEW_H): CoverLayout {
  const scale = Math.max(vw / Math.max(nw, 1), vh / Math.max(nh, 1));
  const dw = nw * scale;
  const dh = nh * scale;
  return {
    scale,
    dw,
    dh,
    minX: Math.min(0, vw - dw),
    minY: Math.min(0, vh - dh),
  };
}

export function centerOffset(layout: CoverLayout): CropOffset {
  return { x: layout.minX / 2, y: layout.minY / 2 };
}

export function clampOffset(offset: CropOffset, layout: CoverLayout): CropOffset {
  return {
    x: Math.min(0, Math.max(layout.minX, offset.x)),
    y: Math.min(0, Math.max(layout.minY, offset.y)),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** 可滑动范围内的位置：0 顶/左，1 底/右。正好铺满时记 0.5。 */
export function offsetToPos(offset: CropOffset, layout: CoverLayout): PreviewPos {
  return {
    x: Number((layout.minX >= 0 ? 0.5 : clamp01(offset.x / layout.minX)).toFixed(4)),
    y: Number((layout.minY >= 0 ? 0.5 : clamp01(offset.y / layout.minY)).toFixed(4)),
  };
}

export function posToOffset(pos: PreviewPos | null | undefined, layout: CoverLayout): CropOffset {
  const x = layout.minX >= 0 ? 0 : layout.minX * clamp01(pos?.x ?? 0.5);
  const y = layout.minY >= 0 ? 0 : layout.minY * clamp01(pos?.y ?? 0.5);
  return clampOffset({ x, y }, layout);
}

export function parsePreviewPos(raw: unknown): PreviewPos | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const pos = (
    row.preview_pos && typeof row.preview_pos === 'object' && !Array.isArray(row.preview_pos)
      ? row.preview_pos
      : row
  ) as Record<string, unknown>;
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  return { x: clamp01(pos.x), y: clamp01(pos.y) };
}

export const DEFAULT_PREVIEW_POS: PreviewPos = { x: 0.5, y: 0.5 };

export function resolvePreviewPos(pos: PreviewPos | null | undefined): PreviewPos {
  return pos ?? DEFAULT_PREVIEW_POS;
}

export function loadImageElement(src: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors && !src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

export function momentListThumbUrl(record: {
  image_url?: string | null;
  preview_url?: string | null;
  has_preview?: boolean;
}): string {
  const preview = (record.preview_url || '').trim();
  if (record.has_preview && preview) return preview;
  return (record.image_url || '').trim();
}

/**
 * 裁切 / canvas 读像素用。
 * - blob: / data:：本地直读
 * - 远程 http(s)（GCS/COS）：走管理端同源代理，避免浏览器 CORS
 * - 列表/详情展示仍用接口返回的原始 URL，不要把代理地址写入库
 */
export async function blobFromSrc(src: string, pending?: Blob | null): Promise<Blob> {
  if (pending) return pending;
  if (!src) throw new Error('image fetch failed: empty src');

  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`);
    return res.blob();
  }

  const fetchUrl =
    src.startsWith('http://') || src.startsWith('https://')
      ? `/api/admin/media/proxy?url=${encodeURIComponent(src)}`
      : src;

  const res = await adminFetch(fetchUrl);
  if (!res) throw new Error('Unauthorized');
  if (!res.ok) throw new Error(`proxy_failed_${res.status}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('proxy_failed_empty');
  return blob;
}

export async function cropCoverBlob(
  source: Blob,
  offset: CropOffset,
  vw = PREVIEW_VIEW_W,
  vh = PREVIEW_VIEW_H,
  maxEdge = 1080,
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImageElement(objectUrl);
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    const layout = coverLayout(nw, nh, vw, vh);
    const pos = clampOffset(offset, layout);
    const sx = -pos.x / layout.scale;
    const sy = -pos.y / layout.scale;
    const sw = vw / layout.scale;
    const sh = vh / layout.scale;
    const outScale = Math.min(1, maxEdge / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * outScale));
    const outH = Math.max(1, Math.round(sh * outScale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('crop failed'))),
        'image/jpeg',
        0.92,
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
