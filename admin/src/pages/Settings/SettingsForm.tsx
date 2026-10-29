import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Form, Input, InputNumber, Select, Button, Space, Badge, Tag,
  Descriptions, Row, Col, Alert, Switch, Divider,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError, showLoading } from '../../api/request';
import type { ConfigGroup } from '../../types';
import { getAppLanguage } from '../../locales';
import {
  AGENT_PROMPT_LANGS,
  asRecord,
  defaultConfigJson,
  defaultConfigJsonFromSchema,
  fetchConfigGroupOptions,
  fieldLabel,
  fieldPath,
  normalizeConfigTypes,
  omitEmptySecrets,
  resolveFormSchema,
  stripIgnoredPaths,
  suggestedConfigType,
  type ConfigFormField,
  type ConfigFormSchema,
  type ConfigGroupOptions,
} from './configGroupApi';

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const msg = data.message || data.error || data.detail;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch {
    // ignore
  }
  return fallback;
}

function clampNumber(value: unknown, min?: number, max?: number, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  let out = Math.round(n);
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}

export default function SettingsForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const locale = getAppLanguage();
  const [metaForm] = Form.useForm();
  const [group, setGroup] = useState<ConfigGroup | null>(null);
  const [options, setOptions] = useState<ConfigGroupOptions | null>(null);
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const lastCreateKeyRef = useRef('');

  const watchKey = Form.useWatch('key', metaForm) as string | undefined;
  const watchType = Form.useWatch('config_type', metaForm) as string | undefined;

  const schema: ConfigFormSchema = useMemo(() => {
    const key = isEdit ? group?.key || '' : (watchKey || '').trim();
    const configType = isEdit ? group?.config_type || '' : (watchType || '').trim();
    if (!key && !configType) return { layout: 'json', fields: [] };
    return resolveFormSchema({ key, config_type: configType }, options);
  }, [group?.config_type, group?.key, isEdit, options, watchKey, watchType]);

  const configTypes = useMemo(() => normalizeConfigTypes(options?.config_types), [options]);

  const applyConfig = useCallback((config: Record<string, unknown>) => {
    setCfg(config);
    setJsonText(JSON.stringify(config, null, 2));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const opts = await fetchConfigGroupOptions().catch(() => ({} as ConfigGroupOptions));
      setOptions(opts);

      if (!isEdit || !id) {
        metaForm.setFieldsValue({
          key: '',
          name: '',
          description: '',
          config_type: normalizeConfigTypes(opts.config_types)[0]?.value || 'system',
          enabled: true,
          sort_order: 0,
        });
        applyConfig({});
        return;
      }

      const detail = await adminFetchJson<ConfigGroup>(`/api/admin/config-groups/${id}`);
      if (!detail) {
        showError(t('toast.loadFailed') as string);
        return;
      }
      setGroup(detail);
      applyConfig(asRecord(detail.config_json));
      metaForm.setFieldsValue({
        key: detail.key,
        name: detail.name,
        description: detail.description || '',
        config_type: detail.config_type,
        enabled: detail.enabled !== false,
        sort_order: detail.sort_order ?? 0,
      });
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [applyConfig, id, isEdit, metaForm, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // 新建：key / type 变化时切换布局并重置默认 config_json
  useEffect(() => {
    if (isEdit || loading) return;
    const key = (watchKey || '').trim();
    const configType = (watchType || '').trim();
    if (!key && !configType) return;

    const suggested = key ? suggestedConfigType(key, options) : undefined;
    if (suggested && suggested !== configType) {
      metaForm.setFieldsValue({ config_type: suggested });
      return;
    }

    const signature = `${key}::${configType}::${schema.layout}`;
    if (signature === lastCreateKeyRef.current) return;
    lastCreateKeyRef.current = signature;
    applyConfig(defaultConfigJson(key, configType, options));
  }, [applyConfig, isEdit, loading, metaForm, options, schema.layout, watchKey, watchType]);

  const setField = (path: string, value: unknown) => {
    setCfg((prev) => {
      const next = { ...prev, [path]: value };
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const setNested = (root: string, child: string, field: string, value: unknown) => {
    setCfg((prev) => {
      const rootObj = asRecord(prev[root]);
      const childObj = asRecord(rootObj[child]);
      const next = {
        ...prev,
        [root]: {
          ...rootObj,
          [child]: { ...childObj, [field]: value },
        },
      };
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
  };

  async function handleSave() {
    const meta = await metaForm.validateFields();
    let configJson = { ...cfg };
    if (schema.layout === 'json') {
      try {
        configJson = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        showError(t('settings.invalidJson') as string);
        return;
      }
    }
    // 若布局字段有默认但 cfg 为空（用户没动过），补默认
    if (!Object.keys(configJson).length) {
      configJson = defaultConfigJsonFromSchema(schema, meta.key);
    }
    configJson = omitEmptySecrets(stripIgnoredPaths(configJson, schema.ignore_legacy_paths));

    setSaving(true);
    try {
      if (isEdit && group) {
        const res = await adminFetch(`/api/admin/config-groups/${group.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: meta.name,
            description: meta.description || '',
            enabled: !!meta.enabled,
            sort_order: Number(meta.sort_order) || 0,
            config_json: configJson,
          }),
        });
        if (!res || !res.ok) {
          showError(res ? await readErrorMessage(res, t('settings.saveFailed') as string) : (t('settings.saveFailed') as string));
          return;
        }
        const saved = (await res.json()) as ConfigGroup;
        showSuccess(t('toast.saved') as string);
        const nextCfg = asRecord(saved.config_json ?? configJson);
        setGroup({ ...group, ...saved, config_json: nextCfg });
        applyConfig(nextCfg);
        metaForm.setFieldsValue({
          name: saved.name ?? meta.name,
          description: saved.description ?? meta.description,
          enabled: saved.enabled ?? meta.enabled,
          sort_order: saved.sort_order ?? meta.sort_order,
        });
      } else {
        const res = await adminFetch('/api/admin/config-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: String(meta.key).trim(),
            name: meta.name,
            description: meta.description || '',
            config_type: meta.config_type,
            enabled: meta.enabled !== false,
            sort_order: Number(meta.sort_order) || 0,
            config_json: configJson,
          }),
        });
        if (!res || !res.ok) {
          showError(res ? await readErrorMessage(res, t('settings.saveFailed') as string) : (t('settings.saveFailed') as string));
          return;
        }
        const saved = (await res.json()) as ConfigGroup;
        showSuccess(t('toast.saved') as string);
        if (saved?.id != null) navigate(`/settings/${saved.id}/edit`, { replace: true });
        else navigate('/settings');
      }
    } catch (e) {
      showError((e as Error).message || (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!group?.id) {
      showError(t('settings.testNeedSave') as string);
      return;
    }
    showLoading({ content: t('toast.testing'), key: 'test' });
    try {
      const body: Record<string, unknown> = {};
      const provider = (cfg.model_provider as string) || (cfg.provider as string) || undefined;
      if (provider) body.provider = provider;
      for (const key of ['anthropic_key', 'deepseek_key', 'openai_key', 'google_key', 'xai_key', 'api_key'] as const) {
        const v = cfg[key];
        if (typeof v === 'string' && v.trim()) body[key] = v.trim();
      }
      const res = await adminFetchJson<{ ok: boolean; response?: string; error?: string }>(
        `/api/admin/config-groups/${group.id}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (res?.ok) {
        showSuccess({ content: `${t('toast.testSuccess')}: ${res.response || ''}`, key: 'test' });
      } else {
        showError({ content: `${t('toast.testFailed')}: ${res?.error || ''}`, key: 'test' });
      }
    } catch {
      showError({ content: t('toast.testError'), key: 'test' });
    }
  }

  function renderNumberFields(fields: ConfigFormField[]) {
    return fields.map((field) => {
      const path = fieldPath(field);
      if (!path) return null;
      return (
        <Form.Item
          key={path}
          label={
            path === 'free_turns_limit'
              ? (t('settings.freeTurnsField') as string)
              : fieldLabel(field, locale) || path
          }
          extra={
            typeof field.min === 'number' || typeof field.max === 'number'
              ? `(${field.min ?? '-∞'} ~ ${field.max ?? '+∞'})`
              : undefined
          }
        >
          <InputNumber
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={clampNumber(cfg[path], field.min, field.max, Number(field.default) || 0)}
            onChange={(v) => setField(path, clampNumber(v, field.min, field.max, Number(field.default) || 0))}
            style={{ width: '100%' }}
            disabled={field.readonly}
          />
        </Form.Item>
      );
    });
  }

  function renderSingleNumber() {
    const fields = schema.fields?.length
      ? schema.fields
      : [{ path: watchKey || group?.key || 'value', label: group?.name || watchKey, min: 0, max: 9999, default: 0 }];
    return <Form layout="vertical">{renderNumberFields(fields)}</Form>;
  }

  function renderCostGrid() {
    const fields = schema.fields?.length
      ? schema.fields
      : [
          { path: 'chat_cost', label: t('settings.chatCost') as string, min: 0, max: 99999, default: 3 },
          { path: 'create_agent_cost', label: t('settings.createAgentCost') as string, min: 0, max: 99999, default: 50 },
          { path: 'daily_agent_cost', label: t('settings.dailyAgentCost') as string, min: 0, max: 99999, default: 10 },
          { path: 'free_turns_limit', label: t('settings.freeTurnsOptional') as string, min: 0, max: 9999, default: 3 },
        ];
    return <Form layout="vertical">{renderNumberFields(fields)}</Form>;
  }

  function renderVipPlans() {
    const plans = asRecord(cfg.plans);
    const packs = asRecord(cfg.recharge_packages);
    const planKeys = Array.from(
      new Set([...(schema.plan_keys || []), 'weekly', 'monthly', 'yearly', 'lifetime', ...Object.keys(plans)]),
    );
    const packKeys = Array.from(
      new Set([...(schema.package_keys || []), 'pack_250', 'pack_550', 'pack_800', 'pack_1900', ...Object.keys(packs)]),
    );

    return (
      <Form layout="vertical">
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('settings.vipPlansHint')} />
        <Divider orientation="left">{t('settings.vipPlans')}</Divider>
        {planKeys.map((planKey) => {
          const row = asRecord(plans[planKey]);
          return (
            <Card key={planKey} size="small" title={planKey} style={{ marginBottom: 12 }}>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item label={t('settings.dailyCredits')}>
                    <InputNumber
                      min={0}
                      value={Number(row.daily_credits) || 0}
                      onChange={(v) => setNested('plans', planKey, 'daily_credits', Number(v) || 0)}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('settings.maxAgents')}>
                    <InputNumber
                      min={0}
                      value={Number(row.max_agents) || 0}
                      onChange={(v) => setNested('plans', planKey, 'max_agents', Number(v) || 0)}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('settings.durationDays')}>
                    <InputNumber
                      min={0}
                      value={Number(row.duration_days) || 0}
                      onChange={(v) => setNested('plans', planKey, 'duration_days', Number(v) || 0)}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          );
        })}
        <Divider orientation="left">{t('settings.rechargePackages')}</Divider>
        {packKeys.map((packKey) => {
          const row = asRecord(packs[packKey]);
          return (
            <Form.Item key={packKey} label={packKey}>
              <InputNumber
                min={0}
                value={Number(row.credits) || 0}
                onChange={(v) => setNested('recharge_packages', packKey, 'credits', Number(v) || 0)}
                addonBefore={t('settings.credits') as string}
                style={{ width: '100%' }}
              />
            </Form.Item>
          );
        })}
      </Form>
    );
  }

  function renderAgent() {
    return (
      <Form layout="vertical">
        <Form.Item label={t('settings.modelProviderLabel')}>
          <Select
            value={(cfg.model_provider as string) || 'google'}
            onChange={(v) => setField('model_provider', v)}
            options={[
              { value: 'google', label: 'Google' },
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai', label: 'OpenAI' },
              { value: 'xai', label: 'xAI' },
            ]}
          />
        </Form.Item>
        <Form.Item label={t('settings.temperature')}>
          <InputNumber
            min={0}
            max={2}
            step={0.01}
            value={typeof cfg.temperature === 'number' ? cfg.temperature : 0.93}
            onChange={(v) => setField('temperature', typeof v === 'number' ? v : 0.93)}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label={t('settings.maxTokens')}>
          <InputNumber
            min={100}
            max={8192}
            value={typeof cfg.max_tokens === 'number' ? cfg.max_tokens : 2048}
            onChange={(v) => setField('max_tokens', typeof v === 'number' ? v : 2048)}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Divider orientation="left">{t('settings.systemPrompt')}</Divider>
        {AGENT_PROMPT_LANGS.map((lang) => (
          <Form.Item key={lang} label={`${t('settings.systemPrompt')} - ${lang}`}>
            <Input.TextArea
              rows={3}
              value={(cfg[`system_prompt_${lang}`] as string) || ''}
              onChange={(e) => setField(`system_prompt_${lang}`, e.target.value)}
              placeholder={t('settings.emptyUseDefault') as string}
            />
          </Form.Item>
        ))}
      </Form>
    );
  }

  function renderModelService() {
    return (
      <Form layout="vertical">
        <Descriptions bordered column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Google">{cfg.google_ready ? t('settings.configured') : t('settings.notConfigured')}</Descriptions.Item>
          <Descriptions.Item label="DeepSeek">{cfg.deepseek_ready ? t('settings.configured') : t('settings.notConfigured')}</Descriptions.Item>
          <Descriptions.Item label="xAI">{cfg.xai_ready ? t('settings.configured') : t('settings.notConfigured')}</Descriptions.Item>
          <Descriptions.Item label="OpenAI">{cfg.openai_ready ? t('settings.configured') : t('settings.notConfigured')}</Descriptions.Item>
        </Descriptions>
        <Form.Item label={t('settings.modelProviderLabel')}>
          <Select
            value={(cfg.model_provider as string) || 'google'}
            onChange={(v) => setField('model_provider', v)}
            options={[
              { value: 'google', label: 'Google' },
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'xai', label: 'xAI' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Google API Key" extra={t('settings.keyKeepHint')}>
          <Input.Password
            placeholder={t('settings.keyKeepPlaceholder') as string}
            onChange={(e) => setField('google_key', e.target.value)}
          />
        </Form.Item>
        <Form.Item label="DeepSeek API Key" extra={t('settings.keyKeepHint')}>
          <Input.Password
            placeholder={t('settings.keyKeepPlaceholder') as string}
            onChange={(e) => setField('deepseek_key', e.target.value)}
          />
        </Form.Item>
        <Form.Item label="xAI API Key" extra={t('settings.keyKeepHint')}>
          <Input.Password
            placeholder={t('settings.keyKeepPlaceholder') as string}
            onChange={(e) => setField('xai_key', e.target.value)}
          />
        </Form.Item>
      </Form>
    );
  }

  function renderImageGeneration() {
    return (
      <Form layout="vertical">
        <Form.Item label="Provider">
          <Select
            value={(cfg.provider as string) || 'google'}
            onChange={(v) => setField('provider', v)}
            options={[
              { value: 'google', label: 'Google' },
              { value: 'xai', label: 'xAI' },
              { value: 'volcano', label: t('settings.volcanoArk') as string },
            ]}
          />
        </Form.Item>
        <Form.Item label="API Key" extra={t('settings.keyKeepHint')}>
          <Input.Password
            placeholder={t('settings.keyKeepPlaceholder') as string}
            onChange={(e) => setField('api_key', e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t('settings.modelName')}>
          <Input
            value={(cfg.model as string) || ''}
            onChange={(e) => setField('model', e.target.value)}
            placeholder="gemini-2.5-flash-image"
          />
        </Form.Item>
        <Form.Item label="Base URL">
          <Input value={(cfg.base_url as string) || ''} onChange={(e) => setField('base_url', e.target.value)} />
        </Form.Item>
        <Form.Item label={t('settings.timeoutSeconds')}>
          <InputNumber
            min={1}
            max={600}
            value={typeof cfg.timeout_seconds === 'number' ? cfg.timeout_seconds : 120}
            onChange={(v) => setField('timeout_seconds', typeof v === 'number' ? v : 120)}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label={t('settings.defaultWidth')}>
              <InputNumber
                min={64}
                max={4096}
                value={typeof cfg.default_width === 'number' ? cfg.default_width : 1024}
                onChange={(v) => setField('default_width', typeof v === 'number' ? v : 1024)}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label={t('settings.defaultHeight')}>
              <InputNumber
                min={64}
                max={4096}
                value={typeof cfg.default_height === 'number' ? cfg.default_height : 1024}
                onChange={(v) => setField('default_height', typeof v === 'number' ? v : 1024)}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    );
  }

  function renderJson() {
    return (
      <Form layout="vertical">
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('settings.jsonFallbackHint')} />
        <Form.Item label="config_json">
          <Input.TextArea
            rows={16}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
        </Form.Item>
      </Form>
    );
  }

  function renderConfigBody() {
    switch (schema.layout) {
      case 'single_number':
        return renderSingleNumber();
      case 'cost_grid':
        return renderCostGrid();
      case 'vip_plans':
        return renderVipPlans();
      case 'agent':
        return renderAgent();
      case 'model_service':
        return renderModelService();
      case 'image_generation':
        return renderImageGeneration();
      default:
        return renderJson();
    }
  }

  const canTest =
    isEdit &&
    (schema.layout === 'agent' || schema.layout === 'model_service' || schema.layout === 'image_generation');

  function typeColor(type: string) {
    if (type === 'model_service') return 'purple';
    if (type === 'image_generation') return 'orange';
    if (type === 'payment') return 'gold';
    if (type === 'system') return 'magenta';
    return 'cyan';
  }

  const titleKey = isEdit ? 'settings.editConfig' : 'settings.newConfig';
  const knownKeys = Object.keys(options?.form_by_key || {});

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/settings')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>
          {t(titleKey)}
          {isEdit ? ` - ${group?.name || id}` : ''}
        </h2>
      </div>

      <Card loading={loading}>
        {(!isEdit || group) && (
          <>
            <Space style={{ marginBottom: 16 }} wrap>
              {isEdit && group ? (
                <Badge
                  status={group.enabled ? 'success' : 'default'}
                  text={group.enabled ? t('settings.enabled') : t('settings.disabled')}
                />
              ) : null}
              {(watchType || group?.config_type) && (
                <Tag color={typeColor(String(watchType || group?.config_type))}>
                  {String(watchType || group?.config_type)}
                </Tag>
              )}
              <Tag>
                {t('settings.layout')}: {schema.layout || 'json'}
              </Tag>
            </Space>

            <Divider orientation="left">{t('settings.metaFields')}</Divider>
            <Form form={metaForm} layout="vertical">
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="key"
                    label={t('settings.configKey')}
                    rules={[{ required: true }]}
                    extra={!isEdit && knownKeys.length ? `${t('settings.knownKeys')}: ${knownKeys.join(', ')}` : undefined}
                  >
                    {isEdit ? (
                      <Input disabled />
                    ) : (
                      <Input
                        placeholder="e.g. say_hi_daily_free_limit"
                        list="config-group-known-keys"
                      />
                    )}
                  </Form.Item>
                  {!isEdit && knownKeys.length > 0 && (
                    <datalist id="config-group-known-keys">
                      {knownKeys.map((k) => (
                        <option key={k} value={k} />
                      ))}
                    </datalist>
                  )}
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="config_type" label={t('settings.configType')} rules={[{ required: true }]}>
                    {isEdit ? (
                      <Input disabled />
                    ) : (
                      <Select
                        options={configTypes.map((item) => ({
                          value: item.value,
                          label: t(`settings.type.${item.value}`, { defaultValue: item.label }) as string,
                        }))}
                      />
                    )}
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="name" label={t('table.name')} rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name="enabled" label={t('settings.status')} valuePropName="checked">
                    <Switch checkedChildren={t('settings.enabled')} unCheckedChildren={t('settings.disabled')} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name="sort_order" label={t('settings.sortOrder')}>
                    <InputNumber style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="description" label={t('table.summary')}>
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            <Divider orientation="left">{t('settings.configDetail')}</Divider>
            {renderConfigBody()}

            <Space style={{ marginTop: 8 }}>
              <Button type="primary" loading={saving} onClick={() => void handleSave()}>
                {t('settings.saveConfig')}
              </Button>
              {canTest ? (
                <Button onClick={() => void testConnection()}>{t('settings.testConnection')}</Button>
              ) : null}
            </Space>
          </>
        )}
        {isEdit && !loading && !group ? <div>{t('empty.data')}</div> : null}
      </Card>
    </div>
  );
}
