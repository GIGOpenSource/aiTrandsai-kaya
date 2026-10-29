import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Slider } from 'antd';
import {
  PREVIEW_VIEW_H,
  PREVIEW_VIEW_W,
  clampOffset,
  coverLayout,
  posToOffset,
  resolvePreviewPos,
  type CoverLayout,
  type CropOffset,
  type PreviewPos,
} from './cropPreview';

type Props = {
  src: string;
  disabled?: boolean;
  initialPos?: PreviewPos | null;
  onOffsetChange?: (offset: CropOffset, dirty: boolean, layout: CoverLayout | null) => void;
};

export default function MomentCropFrame({ src, disabled, initialPos, onOffsetChange }: Props) {
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });

  const restoringRef = useRef(true);

  useEffect(() => {
    setNatural({ w: 0, h: 0 });
    setOffset({ x: 0, y: 0 });
    restoringRef.current = true;
  }, [src]);

  const layout = natural.w && natural.h ? coverLayout(natural.w, natural.h) : null;
  const appliedPos = resolvePreviewPos(initialPos);
  const posKey = `${appliedPos.x}:${appliedPos.y}`;

  useEffect(() => {
    if (!natural.w || !natural.h) return;
    const nextLayout = coverLayout(natural.w, natural.h);
    const next = posToOffset(appliedPos, nextLayout);
    setOffset(next);
    onOffsetChange?.(next, false, nextLayout);
    restoringRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, natural.w, natural.h, posKey]);

  function applyNatural(w: number, h: number) {
    if (!w || !h) return;
    setNatural({ w, h });
  }

  function commit(next: CropOffset, dirty: boolean) {
    if (!layout) return;
    const clamped = clampOffset(next, layout);
    setOffset(clamped);
    onOffsetChange?.(clamped, dirty && !restoringRef.current, layout);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !layout) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !layout) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    commit({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }, true);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  const canPanY = layout ? layout.minY < 0 : false;
  const canPanX = layout ? layout.minX < 0 : false;

  return (
    <div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: PREVIEW_VIEW_W,
          height: PREVIEW_VIEW_H,
          overflow: 'hidden',
          borderRadius: 8,
          border: '1px solid #d9d9d9',
          background: '#111',
          position: 'relative',
          touchAction: 'none',
          cursor: disabled ? 'default' : 'grab',
          userSelect: 'none',
        }}
      >
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            applyNatural(el.naturalWidth || el.width, el.naturalHeight || el.height);
          }}
          style={
            layout
              ? {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: layout.dw,
                  height: layout.dh,
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                  pointerEvents: 'none',
                }
              : {
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${appliedPos.x * 100}% ${appliedPos.y * 100}%`,
                  display: 'block',
                  pointerEvents: 'none',
                }
          }
        />
      </div>
      {canPanY ? (
        <Slider
          disabled={disabled}
          min={layout?.minY ?? 0}
          max={0}
          step={1}
          value={offset.y}
          onChange={(v) => commit({ x: offset.x, y: Number(v) }, false)}
          onChangeComplete={(v) => commit({ x: offset.x, y: Number(v) }, true)}
          tooltip={{ formatter: null }}
          style={{ marginTop: 8, marginBottom: 0, maxWidth: PREVIEW_VIEW_W }}
        />
      ) : null}
      {canPanX ? (
        <Slider
          disabled={disabled}
          min={layout?.minX ?? 0}
          max={0}
          step={1}
          value={offset.x}
          onChange={(v) => commit({ x: Number(v), y: offset.y }, false)}
          onChangeComplete={(v) => commit({ x: Number(v), y: offset.y }, true)}
          tooltip={{ formatter: null }}
          style={{ marginTop: 8, marginBottom: 0, maxWidth: PREVIEW_VIEW_W }}
        />
      ) : null}
    </div>
  );
}
