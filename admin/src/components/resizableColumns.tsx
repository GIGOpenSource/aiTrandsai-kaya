import { useCallback, useMemo, useState, type ThHTMLAttributes } from 'react';
import type { ProColumns } from '@ant-design/pro-table';

type ResizeCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  width?: number;
  minWidth?: number;
  onResize?: (width: number) => void;
};

function columnKey<T>(col: ProColumns<T>, index: number) {
  if (col.key != null) return String(col.key);
  if (Array.isArray(col.dataIndex)) return col.dataIndex.map(String).join('.');
  if (col.dataIndex != null) return String(col.dataIndex);
  return String(index);
}

function readStoredWidths(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function ResizableTitle({ onResize, width, minWidth = 64, children, style, ...rest }: ResizeCellProps) {
  if (!onResize || width == null) {
    return (
      <th {...rest} style={style}>
        {children}
      </th>
    );
  }

  return (
    <th {...rest} style={{ ...style, position: 'relative', width }}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        className="im-col-resize-handle"
        style={{
          position: 'absolute',
          top: 0,
          right: -4,
          zIndex: 2,
          width: 10,
          height: '100%',
          cursor: 'col-resize',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const handle = e.currentTarget;
          handle.setPointerCapture(e.pointerId);
          const startX = e.clientX;
          const startW = width;
          const onMove = (ev: PointerEvent) => {
            onResize(Math.max(minWidth, Math.round(startW + ev.clientX - startX)));
          };
          const onUp = (ev: PointerEvent) => {
            handle.releasePointerCapture(ev.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          handle.addEventListener('pointermove', onMove);
          handle.addEventListener('pointerup', onUp);
          handle.addEventListener('pointercancel', onUp);
        }}
      />
    </th>
  );
}

export function useResizableColumns<T>(columns: ProColumns<T>[], storageKey: string, minWidth = 64) {
  const [widths, setWidths] = useState<Record<string, number>>(() => readStoredWidths(storageKey));

  const resizeColumn = useCallback((key: string, next: number) => {
    setWidths((prev) => {
      const width = Math.max(minWidth, next);
      if (prev[key] === width) return prev;
      const updated = { ...prev, [key]: width };
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        /* ignore quota / private mode */
      }
      return updated;
    });
  }, [minWidth, storageKey]);

  const resizableColumns = useMemo(
    () =>
      columns.map((col, index) => {
        if (col.hideInTable) return col;
        const key = columnKey(col, index);
        const width = widths[key] ?? (typeof col.width === 'number' ? col.width : 140);
        return {
          ...col,
          width,
          onHeaderCell: () => ({
            width,
            minWidth,
            onResize: (next: number) => resizeColumn(key, next),
          }),
        };
      }) as ProColumns<T>[],
    [columns, minWidth, resizeColumn, widths],
  );

  const scrollX = useMemo(
    () =>
      resizableColumns.reduce((sum, col) => {
        if (col.hideInTable) return sum;
        return sum + (typeof col.width === 'number' ? col.width : 140);
      }, 0),
    [resizableColumns],
  );

  return {
    columns: resizableColumns,
    scrollX,
    components: { header: { cell: ResizableTitle } },
  };
}
