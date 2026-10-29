import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InputNumber, Radio, Space, Spin, Typography } from 'antd';
import { getAppLanguage } from '../../locales';
import type { ImReplyModeSettings } from '../../types';
import { showError, showSuccess } from '../../api/request';
import { fetchImReplyMode, readApiError, saveImReplyMode } from './imApi';

const { Text } = Typography;

const DEFAULT_MODES = [
  { value: 'human_first', label_zh: '优先人工', label_en: 'Human first' },
  { value: 'ai', label_zh: 'AI回复', label_en: 'AI reply' },
];

export default function ImReplyModeBar() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ImReplyModeSettings | null>(null);
  const [replyMode, setReplyMode] = useState('ai');
  const [waitSeconds, setWaitSeconds] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchImReplyMode();
      if (!data) {
        showError(t('toast.loadFailed') as string);
        return;
      }
      setSettings(data);
      setReplyMode(data.reply_mode || 'ai');
      setWaitSeconds(
        Number(data.wait_seconds) ||
          Number(data.wait_seconds_default) ||
          30,
      );
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const modes = useMemo(() => {
    const list = settings?.modes?.length ? settings.modes : DEFAULT_MODES;
    return list.map((item) => ({
      value: item.value,
      label:
        locale === 'en'
          ? item.label_en || item.label_zh || item.value
          : item.label_zh || item.label_en || item.value,
    }));
  }, [locale, settings?.modes]);

  const minWait = settings?.wait_seconds_min ?? 5;
  const maxWait = settings?.wait_seconds_max ?? 600;

  async function persist(nextMode: string, nextWait: number) {
    setSaving(true);
    try {
      const body: { reply_mode: string; wait_seconds?: number } = {
        reply_mode: nextMode,
      };
      if (nextMode === 'human_first') {
        body.wait_seconds = Math.min(maxWait, Math.max(minWait, nextWait));
      }
      const res = await saveImReplyMode(body);
      if (res && res.ok) {
        showSuccess(t('im.replyModeSaved') as string);
        const data = await fetchImReplyMode();
        if (data) {
          setSettings(data);
          setReplyMode(data.reply_mode || nextMode);
          setWaitSeconds(Number(data.wait_seconds) || nextWait);
        }
      } else if (res) {
        showError(await readApiError(res, t('im.replyModeSaveFailed') as string));
      } else {
        showError(t('im.replyModeSaveFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('im.replyModeSaveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <div style={{ marginBottom: 12 }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '12px 16px',
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
      }}
    >
      <Space wrap align="center" size={[16, 8]}>
        <Text strong>{t('im.replyMode')}</Text>
        <Radio.Group
          value={replyMode}
          disabled={saving}
          options={modes}
          optionType="button"
          buttonStyle="solid"
          onChange={(e) => {
            const next = String(e.target.value);
            setReplyMode(next);
            void persist(next, waitSeconds);
          }}
        />
        {replyMode === 'human_first' && (
          <Space size={8}>
            <Text type="secondary">{t('im.replyModeWaitSeconds')}</Text>
            <InputNumber
              min={minWait}
              max={maxWait}
              value={waitSeconds}
              disabled={saving}
              style={{ width: 100 }}
              onChange={(value) => {
                if (value == null) return;
                setWaitSeconds(Number(value));
              }}
              onBlur={() => {
                const next = Math.min(maxWait, Math.max(minWait, Number(waitSeconds) || minWait));
                setWaitSeconds(next);
                void persist(replyMode, next);
              }}
              onPressEnter={(e) => {
                (e.target as HTMLInputElement).blur();
              }}
            />
          </Space>
        )}
        {saving ? <Spin size="small" /> : null}
      </Space>
      <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>{t('im.replyModeHint')}</div>
    </div>
  );
}
