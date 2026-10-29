import { useCallback, useEffect, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Spin } from 'antd';
import { adminFetchJson, showError } from '../../api/request';
import type { ContentCompanion } from '../../types';
import { normalizeCompanion, unwrapResults } from '../Companions/contentApi';

type Option = { value: string; label: string; language?: string };

type Props = {
  value?: string | string[];
  onChange?: (value: string | string[] | undefined) => void;
  /** 单选时回调，带上智能体语种（列表项里有的话） */
  onCompanionSelect?: (companion: { id: string; language?: string } | null) => void;
  mode?: 'multiple';
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  extraOptions?: Option[];
};

function mergeOptions(prev: Option[], next: Option[]) {
  const map = new Map(prev.map((item) => [item.value, item]));
  next.forEach((item) => map.set(item.value, item));
  return [...map.values()];
}

export default function CompanionSearchSelect({
  value,
  onChange,
  onCompanionSelect,
  mode,
  disabled,
  allowClear = true,
  placeholder,
  style,
  extraOptions,
}: Props) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const keywordRef = useRef('');
  const loadingRef = useRef(false);
  const searchTimer = useRef<number | null>(null);
  const reqIdRef = useRef(0);
  const valueRef = useRef(value);
  const langMapRef = useRef<Map<string, string>>(new Map());
  valueRef.current = value;

  const load = useCallback(async (page: number, keyword = '', append = false) => {
    if (loadingRef.current && append) return;
    const reqId = ++reqIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: '20',
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      if (keyword) qs.set('keyword', keyword);
      const res = await adminFetchJson(`/api/admin/content/companions?${qs.toString()}`);
      if (reqId !== reqIdRef.current) return;
      const list = (unwrapResults<ContentCompanion[]>(res) ?? []).map(normalizeCompanion);
      const next = list.map((c) => {
        const language = (c.language || '').trim();
        if (language) langMapRef.current.set(c.id, language);
        return {
          value: c.id,
          label: `${c.name || c.id} (${c.id})`,
          language: language || undefined,
        };
      });
      const selected = Array.isArray(valueRef.current)
        ? valueRef.current
        : valueRef.current
          ? [valueRef.current]
          : [];
      setOptions((prev) => {
        const kept = prev.filter((item) => selected.includes(item.value));
        return mergeOptions(append ? prev : kept, next);
      });
      pageRef.current = page;
      keywordRef.current = keyword;
      const total = (res as { pagination?: { total?: number } } | null)?.pagination?.total ?? 0;
      hasMoreRef.current =
        list.length >= 20 && (total > 0 ? page * 20 < total : true);
    } catch {
      if (reqId !== reqIdRef.current) return;
      hasMoreRef.current = false;
      showError(t('toast.loadFailed') as string);
    } finally {
      if (reqId === reqIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void load(1, '', false);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!extraOptions?.length) return;
    setOptions((prev) => mergeOptions(prev, extraOptions));
  }, [extraOptions]);

  const handleSearch = (kw: string) => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      hasMoreRef.current = true;
      void load(1, kw.trim(), false);
    }, 300);
  };

  const handlePopupScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    if (target.scrollTop + target.offsetHeight + 32 < target.scrollHeight) return;
    if (!hasMoreRef.current || loadingRef.current) return;
    void load(pageRef.current + 1, keywordRef.current, true);
  };

  return (
    <Select
      mode={mode}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        if (mode === 'multiple') return;
        const id = typeof next === 'string' ? next : undefined;
        if (!id) {
          onCompanionSelect?.(null);
          return;
        }
        const fromOpt = options.find((item) => item.value === id)?.language;
        const language = fromOpt || langMapRef.current.get(id);
        onCompanionSelect?.({ id, language });
      }}
      disabled={disabled}
      allowClear={allowClear}
      showSearch
      filterOption={false}
      loading={loading}
      placeholder={placeholder ?? (t('moment.companionSearchPlaceholder') as string)}
      options={options}
      className="companion-search-select"
      style={{ width: '100%', maxWidth: '100%', minWidth: 0, ...style }}
      maxTagCount={mode === 'multiple' ? 'responsive' : undefined}
      maxTagTextLength={mode === 'multiple' ? 12 : undefined}
      notFoundContent={loading ? <Spin size="small" /> : undefined}
      onSearch={handleSearch}
      onPopupScroll={handlePopupScroll}
      onOpenChange={(open) => {
        if (!open) return;
        keywordRef.current = '';
        hasMoreRef.current = true;
        void load(1, '', false);
      }}
      popupRender={(menu) => (
        <>
          {menu}
          {loading && (
            <div style={{ padding: '8px 0', textAlign: 'center' }}>
              <Spin size="small" />
              <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>{t('loading') as string}</span>
            </div>
          )}
        </>
      )}
    />
  );
}
