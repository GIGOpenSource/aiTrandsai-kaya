import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { TranslationOutlined } from '@ant-design/icons';
import { showError } from '../../api/request';
import { translateImText } from '../ChatSessions/imApi';

const TRANSLATE_MAX_LEN = 6000;

export function isTranslatableText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.length > 0 && text.length <= TRANSLATE_MAX_LEN && !/^https?:\/\//i.test(text);
}

export type TranslateField = { key: string; text: string };

export function useAuditTranslate() {
  const { t } = useTranslation();
  const [byKey, setByKey] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;

  const reset = useCallback(() => {
    byKeyRef.current = {};
    setByKey({});
    setLoading(false);
    setLoadingKey(null);
  }, []);

  const applyResult = useCallback((key: string, original: string, data: { translated?: string | null; skipped?: boolean } | null) => {
    const translated = data?.translated;
    const next = translated != null ? translated : data?.skipped ? original : null;
    if (next == null) return false;
    setByKey((prev) => {
      const merged = { ...prev, [key]: next };
      byKeyRef.current = merged;
      return merged;
    });
    return true;
  }, []);

  const translateOne = useCallback(async (key: string, text: string) => {
    if (!isTranslatableText(text) || byKeyRef.current[key] != null) return;
    setLoadingKey(key);
    try {
      const data = await translateImText(text.trim());
      if (!applyResult(key, text.trim(), data)) {
        showError(t('im.translateFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
    } finally {
      setLoadingKey(null);
    }
  }, [applyResult, t]);

  const translateMany = useCallback(async (items: TranslateField[]) => {
    const pending = items.filter((item) => isTranslatableText(item.text) && byKeyRef.current[item.key] == null);
    if (pending.length === 0) return;
    setLoading(true);
    try {
      const results = await Promise.allSettled(
        pending.map(async (item) => {
          const original = item.text.trim();
          const data = await translateImText(original);
          return { key: item.key, original, data };
        }),
      );
      let failed = 0;
      for (const result of results) {
        if (result.status !== 'fulfilled') {
          failed += 1;
          continue;
        }
        if (!applyResult(result.value.key, result.value.original, result.value.data)) failed += 1;
      }
      if (failed > 0) showError(t('im.translateFailed') as string);
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('im.translateFailed') as string));
    } finally {
      setLoading(false);
    }
  }, [applyResult, t]);

  return { byKey, loading, loadingKey, translateOne, translateMany, reset };
}

export function TranslatedValue({
  original,
  translated,
  multiline,
}: {
  original: string;
  translated?: string;
  multiline?: boolean;
}) {
  const { t } = useTranslation();
  const showTranslated = translated != null && translated !== '';
  const display = showTranslated ? translated : original;
  const showOriginal = showTranslated && translated !== original;
  return (
    <div>
      <div style={{ whiteSpace: multiline ? 'pre-wrap' : undefined, wordBreak: 'break-word' }}>
        {display || '-'}
      </div>
      {showOriginal ? (
        <div
          style={{
            fontSize: 12,
            color: '#8c8c8c',
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px dashed #d9d9d9',
            whiteSpace: multiline ? 'pre-wrap' : undefined,
            wordBreak: 'break-word',
          }}
        >
          {t('im.original')} · {original}
        </div>
      ) : null}
    </div>
  );
}

export function TranslateButton({
  loading,
  disabled,
  onClick,
}: {
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="link"
      size="small"
      icon={<TranslationOutlined />}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      style={{ padding: 0, height: 'auto', marginTop: 4 }}
    >
      {loading ? t('im.translating') : t('im.translate')}
    </Button>
  );
}
