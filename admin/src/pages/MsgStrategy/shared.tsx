import { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Popover, Select, Space, Tag, Typography } from 'antd';
import type { FormInstance, SelectProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { MsgStrategyScopeOption, MsgStrategyScopeOptions, MsgStrategyScopeType } from '../../types';
import {
  EMPTY_SCOPE_OPTIONS,
  isCompanionSenderMode,
  joinScopeValue,
  loadScopeOptions,
  parseScopeValue,
  type LibraryTypeSelectOption,
} from './api';

const { Text } = Typography;

export function SenderModeTag({ mode }: { mode?: string | null }) {
  const { t } = useTranslation();
  if (isCompanionSenderMode(mode)) {
    return <Tag color="processing">{t('msgStrategy.senderModeCompanion')}</Tag>;
  }
  if (mode === 'broadcast') {
    return <Tag>{t('msgStrategy.senderModeBroadcast')}</Tag>;
  }
  return null;
}

type TypeKeySelectProps = Omit<SelectProps, 'options' | 'optionRender'> & {
  options: LibraryTypeSelectOption[];
};

/** 类型下拉：名称（type_key）+ companion 角标 */
export function TypeKeySelect({ options, ...rest }: TypeKeySelectProps) {
  return (
    <Select
      showSearch
      optionFilterProp="label"
      options={options}
      optionRender={(option) => (
        <Space size={6} wrap>
          <span>{option.label}</span>
          <SenderModeTag mode={(option.data as LibraryTypeSelectOption | undefined)?.sender_mode} />
        </Space>
      )}
      labelRender={(props) => {
        const hit = options.find((item) => item.value === props.value);
        return (
          <Space size={6}>
            <span>{props.label}</span>
            {hit ? <SenderModeTag mode={hit.sender_mode} /> : null}
          </Space>
        );
      }}
      {...rest}
    />
  );
}

export function senderModeExtra(mode: string | undefined, t: (key: string) => unknown) {
  if (isCompanionSenderMode(mode)) {
    return <Text type="secondary">{t('msgStrategy.senderModeCompanionHint') as string}</Text>;
  }
  if (mode === 'broadcast') {
    return <Text type="secondary">{t('msgStrategy.senderModeBroadcastHint') as string}</Text>;
  }
  return null;
}

export function ActiveTag({ active }: { active?: boolean }) {
  const { t } = useTranslation();
  return active === false ? (
    <Tag>{t('content.inactive')}</Tag>
  ) : (
    <Tag color="success">{t('content.active')}</Tag>
  );
}

export function scopeTypeLabel(type: string | undefined, t: (key: string) => unknown) {
  const scope = type || 'all';
  if (scope === 'all') return t('msgStrategy.scopeAll') as string;
  if (scope === 'ads') return t('msgStrategy.scopeAds') as string;
  if (scope === 'attr') return t('msgStrategy.scopeAttr') as string;
  return scope;
}

function tagLabelMap(options: MsgStrategyScopeOption[]) {
  const map = new Map<string, string>();
  options.forEach((item) => map.set(item.value, item.label || item.value));
  return map;
}

const TAG_LINE_PX = 22;
const TAG_GAP_PX = 4;
const TAGS_MAX_LINES = 2;
const TAGS_MAX_HEIGHT = TAGS_MAX_LINES * TAG_LINE_PX + (TAGS_MAX_LINES - 1) * TAG_GAP_PX;

function ScopeTag({ label, wrap }: { label: string; wrap?: boolean }) {
  return (
    <Tag
      style={{
        marginInlineEnd: 0,
        maxWidth: '100%',
        overflow: wrap ? 'visible' : 'hidden',
        textOverflow: wrap ? undefined : 'ellipsis',
        whiteSpace: wrap ? 'normal' : 'nowrap',
        wordBreak: wrap ? 'break-all' : undefined,
      }}
    >
      {label}
    </Tag>
  );
}

export function UserScopeTagsCell({
  type,
  value,
  ads,
  attr,
}: {
  type?: MsgStrategyScopeType;
  value?: string | string[] | null;
  ads: MsgStrategyScopeOption[];
  attr: MsgStrategyScopeOption[];
}) {
  if (!type || type === 'all') return '—';
  const values = parseScopeValue(value);
  if (!values.length) return '—';
  const labels = tagLabelMap(type === 'ads' ? ads : type === 'attr' ? attr : []);
  const items = values.map((item) => ({ value: item, label: labels.get(item) || item }));

  const tags = (wrap?: boolean) => (
    <Space size={[TAG_GAP_PX, TAG_GAP_PX]} wrap>
      {items.map((item) => (
        <ScopeTag key={item.value} label={item.label} wrap={wrap} />
      ))}
    </Space>
  );

  return (
    <Popover placement="topLeft" content={<div style={{ maxWidth: 360 }}>{tags(true)}</div>}>
      <div
        style={{
          maxHeight: TAGS_MAX_HEIGHT,
          overflow: 'hidden',
          cursor: 'default',
        }}
      >
        {tags()}
      </div>
    </Popover>
  );
}

function mergeSelectOptions(options: MsgStrategyScopeOption[], selected: string[]) {
  const map = new Map(options.map((item) => [item.value, item]));
  selected.forEach((value) => {
    if (!map.has(value)) map.set(value, { value, label: value });
  });
  return [...map.values()].map((item) => ({
    value: item.value,
    label: item.label || item.value,
    count: item.count,
    kind: item.kind,
    group: item.group,
  }));
}

export function useScopeOptions() {
  const [options, setOptions] = useState<MsgStrategyScopeOptions>(EMPTY_SCOPE_OPTIONS);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadScopeOptions();
      setOptions(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { options, loading, reload };
}

export function serializeUserScope(type: unknown, value: unknown) {
  const scopeType = String(type || 'all');
  return {
    user_scope_type: scopeType,
    user_scope_value: scopeType === 'all' ? '' : joinScopeValue(value),
  };
}

export function UserScopeFormItems({
  form,
  ads,
  attr,
  loading,
}: {
  form: FormInstance;
  ads: MsgStrategyScopeOption[];
  attr: MsgStrategyScopeOption[];
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const scopeType = Form.useWatch('user_scope_type', form) as string | undefined;
  const selected = parseScopeValue(Form.useWatch('user_scope_value', form));
  const tagOptions = useMemo(() => {
    if (scopeType === 'ads') return mergeSelectOptions(ads, selected);
    if (scopeType === 'attr') return mergeSelectOptions(attr, selected);
    return [];
  }, [ads, attr, scopeType, selected]);

  const extra =
    scopeType === 'ads'
      ? (t('msgStrategy.userScopeAdsHint') as string)
      : scopeType === 'attr'
        ? (t('msgStrategy.userScopeAttrHint') as string)
        : undefined;

  return (
    <>
      <Form.Item name="user_scope_type" label={t('msgStrategy.userScope')} rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'all', label: t('msgStrategy.scopeAll') },
            { value: 'ads', label: t('msgStrategy.scopeAds') },
            { value: 'attr', label: t('msgStrategy.scopeAttr') },
          ]}
          onChange={() => form.setFieldValue('user_scope_value', [])}
        />
      </Form.Item>
      {scopeType && scopeType !== 'all' && (
        <Form.Item name="user_scope_value" label={t('msgStrategy.userScopeValue')} extra={extra}>
          <Select
            mode="multiple"
            allowClear
            showSearch
            loading={loading}
            optionFilterProp="label"
            options={tagOptions}
            placeholder={t('msgStrategy.userScopeValuePlaceholder') as string}
            optionRender={(option) => {
              const count = option.data.count as number | undefined;
              return (
                <Space>
                  <span>{option.label}</span>
                  {count != null && <span style={{ color: '#999' }}>{count}</span>}
                </Space>
              );
            }}
          />
        </Form.Item>
      )}
    </>
  );
}
