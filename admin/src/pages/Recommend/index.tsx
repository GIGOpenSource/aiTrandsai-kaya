import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import TagDictionaryTab from './TagDictionaryTab';

type Strategy = {
  id: number;
  name: string;
  enabled: boolean;
  priority: number;
  apply_to: string;
  user_tags: string[];
  agent_tags: string[];
  user_match: string;
  agent_match: string;
  created_by: string;
  updated_at: string | null;
};

type TagDef = {
  key: string;
  side: 'user' | 'agent';
  group: string;
  label_zh: string;
  label_en: string;
  enabled: boolean;
  source: string;
};

type AdGroupOption = {
  id: string;
  label: string;
  kind: string;
  user_tag: string;
  source: string;
  count: number;
  hint?: string;
};

type AdGroupPayload = {
  specific?: AdGroupOption[];
  generic?: AdGroupOption;
};

const GENERIC_AD_TAG = 'ua:source:ads';
/** 与后端一致：精准广告仅 campaign(gad_campaignid) + gclid；其余前缀仅兼容旧策略展示 */
const SPECIFIC_AD_PREFIXES = ['ua:campaign:', 'ua:gclid:', 'ua:adgroup:', 'audience:', 'ua:term:'];

function splitStrategyAdTags(tags: string[]) {
  const specific: string[] = [];
  let generic = false;
  (tags || []).forEach((tag) => {
    if (tag === GENERIC_AD_TAG) generic = true;
    else if (SPECIFIC_AD_PREFIXES.some((p) => tag.startsWith(p))) specific.push(tag);
  });
  return { specific, generic };
}

function mergeAdTags(specific: string[], generic: boolean) {
  const out = [...specific];
  if (generic && !out.includes(GENERIC_AD_TAG)) out.push(GENERIC_AD_TAG);
  return out;
}

function adGroupLabel(opt: AdGroupOption, locale: string) {
  if (opt.kind === 'generic') {
    return locale === 'en'
      ? `Any ad user (${opt.count})`
      : `任意广告来源用户 (${opt.count})`;
  }
  const kind = locale === 'en'
    ? ({
        campaign: 'Campaign ID',
        gclid: 'GCLID',
        adgroup: 'Ad group',
        channel: 'Channel',
        audience: 'Audience',
      } as Record<string, string>)[opt.kind] || opt.kind
    : ({
        campaign: '广告系列 ID',
        gclid: 'GCLID',
        adgroup: '广告组',
        channel: '渠道',
        audience: '人群包',
      } as Record<string, string>)[opt.kind] || opt.kind;
  const short =
    opt.kind === 'gclid' && opt.label.length > 24
      ? `${opt.label.slice(0, 24)}…`
      : opt.label;
  return `${kind}: ${short} (${opt.count})`;
}

const ALL = '__all__';
const GROUP_ORDER = ['gender', 'orientation', 'pref_gender', 'purpose', 'lang', 'ua', 'personality', 'ops'];

function groupLabel(group: string, t: (k: string) => string) {
  const key = `recommend.group.${group}`;
  const label = t(key);
  return label === key ? group : label;
}

function groupDefs(defs: TagDef[], side: 'user' | 'agent', locale: string, keepKeys: string[] = []) {
  const keep = new Set(keepKeys);
  const map = new Map<string, TagDef[]>();
  defs
    .filter((d) => d.side === side && (d.enabled || keep.has(d.key)))
    .forEach((d) => {
      const list = map.get(d.group) || [];
      list.push(d);
      map.set(d.group, list);
    });
  return [...map.entries()]
    .sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a[0]);
      const ib = GROUP_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([group, items]) => ({
      group,
      options: [
        { value: ALL, label: locale === 'en' ? 'All' : '全部' },
        ...items.map((d) => ({
          value: d.key,
          label: (locale === 'en' ? d.label_en : d.label_zh) || d.key,
        })),
      ],
    }));
}

function tagsToGroupValues(tags: string[], defs: TagDef[], side: 'user' | 'agent') {
  const byGroup = new Map<string, string[]>();
  defs.filter((d) => d.side === side).forEach((d) => {
    if (!byGroup.has(d.group)) byGroup.set(d.group, []);
  });
  tags.forEach((key) => {
    const def = defs.find((d) => d.key === key && d.side === side);
    const g = def?.group || 'ops';
    const list = byGroup.get(g) || [];
    list.push(key);
    byGroup.set(g, list);
  });
  const out: Record<string, string[]> = {};
  byGroup.forEach((vals, g) => {
    out[g] = vals.length ? vals : [ALL];
  });
  return out;
}

function flatten(groupValues: Record<string, string[]>) {
  const out: string[] = [];
  Object.values(groupValues).forEach((vals) => {
    if (!vals?.length || vals.includes(ALL)) return;
    vals.forEach((v) => {
      if (v && !out.includes(v)) out.push(v);
    });
  });
  return out;
}

export default function RecommendPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'zh';
  const [tab, setTab] = useState('strategies');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [defs, setDefs] = useState<TagDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [form] = Form.useForm();
  const [userGroups, setUserGroups] = useState<Record<string, string[]>>({});
  const [agentGroups, setAgentGroups] = useState<Record<string, string[]>>({});
  const [selectedSpecificAdTags, setSelectedSpecificAdTags] = useState<string[]>([]);
  const [genericAdEnabled, setGenericAdEnabled] = useState(false);
  const [noAdSource, setNoAdSource] = useState(false);
  const [specificAdOptions, setSpecificAdOptions] = useState<AdGroupOption[]>([]);
  const [genericAdOption, setGenericAdOption] = useState<AdGroupOption | null>(null);
  const [saving, setSaving] = useState(false);

  const [previewUserId, setPreviewUserId] = useState<number | null>(null);
  const [previewSurface, setPreviewSurface] = useState<'companions_all' | 'companions_recommend' | 'moments'>('companions_recommend');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, adRes] = await Promise.all([
        adminFetchJson<Strategy[] | { results?: Strategy[] }>('/api/admin/recommend/strategies'),
        adminFetchJson<TagDef[] | { results?: TagDef[] }>('/api/admin/recommend/tag-defs'),
        adminFetchJson<{ code?: number; results?: AdGroupPayload } & AdGroupPayload>(
          '/api/admin/recommend/ad-groups',
        ),
      ]);
      const strategiesList = Array.isArray(s)
        ? s
        : Array.isArray((s as any)?.results)
          ? (s as any).results
          : [];
      const defsList = Array.isArray(d)
        ? d
        : Array.isArray((d as any)?.results)
          ? (d as any).results
          : [];
      setStrategies(strategiesList);
      setDefs(defsList);

      const raw = adRes as any;
      // 标准：{ code, message, results: { specific, generic } }
      let adPayload: AdGroupPayload | null = null;
      if (raw?.results && (Array.isArray(raw.results.specific) || raw.results.generic)) {
        adPayload = raw.results as AdGroupPayload;
      } else if (Array.isArray(raw?.specific) || raw?.generic) {
        adPayload = raw as AdGroupPayload;
      }
      const specific = Array.isArray(adPayload?.specific) ? adPayload!.specific! : [];
      const generic =
        adPayload?.generic ||
        ({
          id: 'ads',
          label: locale === 'en' ? 'Any ad user' : '任意广告来源用户',
          kind: 'generic',
          user_tag: GENERIC_AD_TAG,
          source: 'attribution',
          count: 0,
        } as AdGroupOption);
      setSpecificAdOptions(specific);
      setGenericAdOption(generic);
      if (typeof console !== 'undefined') {
        console.debug('[recommend] ad-groups', {
          specific: specific.length,
          genericCount: generic.count,
          sample: specific.slice(0, 3),
        });
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const userGrouped = useMemo(() => {
    const keep = Object.values(userGroups).flat().filter((k) => k && k !== ALL);
    return groupDefs(defs, 'user', locale, keep);
  }, [defs, locale, userGroups]);
  const agentGrouped = useMemo(() => {
    const keep = Object.values(agentGroups).flat().filter((k) => k && k !== ALL);
    return groupDefs(defs, 'agent', locale, keep);
  }, [defs, locale, agentGroups]);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue({ name: '', priority: 0, apply_to: 'companions_recommend', enabled: true });
    const ug: Record<string, string[]> = {};
    const ag: Record<string, string[]> = {};
    userGrouped.forEach((g) => { ug[g.group] = [ALL]; });
    agentGrouped.forEach((g) => { ag[g.group] = [ALL]; });
    setUserGroups(ug);
    setAgentGroups(ag);
    setSelectedSpecificAdTags([]);
    setGenericAdEnabled(false);
    setNoAdSource(false);
    setModalOpen(true);
  }

  function openEdit(row: Strategy) {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      priority: row.priority,
      apply_to: row.apply_to,
      enabled: row.enabled,
    });
    const { specific, generic } = splitStrategyAdTags(row.user_tags || []);
    const rest = (row.user_tags || []).filter(
      (tag) => tag !== GENERIC_AD_TAG && !SPECIFIC_AD_PREFIXES.some((p) => tag.startsWith(p)),
    );
    setSelectedSpecificAdTags(specific);
    setGenericAdEnabled(generic);
    setNoAdSource(specific.length === 0 && !generic);
    setUserGroups(tagsToGroupValues(rest, defs, 'user'));
    setAgentGroups(tagsToGroupValues(row.agent_tags || [], defs, 'agent'));
    setModalOpen(true);
  }

  function onGroupChange(
    setter: (v: Record<string, string[]>) => void,
    current: Record<string, string[]>,
    group: string,
    vals: string[],
  ) {
    let next = vals;
    if (vals.includes(ALL) && vals[vals.length - 1] === ALL) next = [ALL];
    else next = vals.filter((v) => v !== ALL);
    setter({ ...current, [group]: next.length ? next : [ALL] });
  }

  async function handleSave() {
    let values: { name: string; enabled: boolean; priority: number; apply_to: string };
    try {
      values = await form.validateFields();
    } catch {
      // 校验失败时 Form 已标红，避免 Uncaught (in promise) { errorFields }
      return;
    }
    const user_tags = [
      ...new Set([
        ...flatten(userGroups),
        ...(noAdSource ? [] : mergeAdTags(selectedSpecificAdTags, genericAdEnabled)),
      ]),
    ];
    const agent_tags = flatten(agentGroups);
    if (!noAdSource && !selectedSpecificAdTags.length && !genericAdEnabled) {
      showError(t('recommend.adAudienceRequired') as string);
      return;
    }
    if (!user_tags.length && !agent_tags.length) {
      showError(t('recommend.bothEmpty') as string);
      return;
    }
    const payload = {
      name: values.name,
      enabled: values.enabled,
      priority: values.priority,
      apply_to: values.apply_to,
      user_tags,
      agent_tags,
    };
    const doSave = async () => {
      setSaving(true);
      try {
        const url = editing
          ? `/api/admin/recommend/strategies/${editing.id}`
          : '/api/admin/recommend/strategies';
        const res = await adminFetch(url, {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res && res.ok) {
          showSuccess(t('toast.saved') as string);
          setModalOpen(false);
          await load();
        } else {
          const err = await res?.text();
          showError(err || (t('settings.saveFailed') as string));
        }
      } catch (e: unknown) {
        showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
      } finally {
        setSaving(false);
      }
    };
    if (!user_tags.length && agent_tags.length) {
      Modal.confirm({
        title: t('recommend.globalConfirm') as string,
        onOk: doSave,
      });
      return;
    }
    await doSave();
  }

  async function toggleEnabled(row: Strategy, enabled: boolean) {
    try {
      const res = await adminFetch(`/api/admin/recommend/strategies/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res && res.ok) {
        setStrategies((prev) => prev.map((s) => (s.id === row.id ? { ...s, enabled } : s)));
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/recommend/strategies/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        setStrategies((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    }
  }

  async function runPreview() {
    if (!previewUserId) {
      showError(t('recommend.needUserId') as string);
      return;
    }
    setPreviewing(true);
    try {
      const res = await adminFetchJson<Record<string, unknown>>('/api/admin/recommend/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: previewUserId, surface: previewSurface, lang: locale }),
      });
      setPreview(res);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    } finally {
      setPreviewing(false);
    }
  }

  const strategyCols = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: t('recommend.name'), dataIndex: 'name' },
    { title: t('recommend.priority'), dataIndex: 'priority', width: 88 },
    { title: t('recommend.applyTo'), dataIndex: 'apply_to', width: 200, render: (v: string) => t(`recommend.scene.${v}`) === `recommend.scene.${v}` ? v : t(`recommend.scene.${v}`) },
    {
      title: t('recommend.userTags'),
      dataIndex: 'user_tags',
      render: (tags: string[]) => (tags?.length ? tags.join(', ') : t('recommend.allUsers')),
    },
    {
      title: t('recommend.agentTags'),
      dataIndex: 'agent_tags',
      render: (tags: string[]) => (tags?.length ? tags.join(', ') : t('recommend.allAgents')),
    },
    {
      title: t('recommend.enabled'),
      dataIndex: 'enabled',
      width: 88,
      render: (_: boolean, row: Strategy) => (
        <Switch checked={row.enabled} onChange={(v) => void toggleEnabled(row, v)} />
      ),
    },
    {
      title: t('table.action'),
      width: 160,
      render: (_: unknown, row: Strategy) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(row)}>{t('btn.edit')}</Button>
          <Button type="link" size="small" danger onClick={() => void handleDelete(row.id)}>{t('btn.delete')}</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h2>{t('page.recommend')}</h2>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'strategies',
            label: t('recommend.strategiesTab'),
            children: (
              <Card loading={loading}>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ marginBottom: 12 }}>
                  {t('btn.new')}
                </Button>
                <Table rowKey="id" columns={strategyCols} dataSource={strategies} pagination={false} />
              </Card>
            ),
          },
          {
            key: 'defs',
            label: t('recommend.defsTab'),
            children: <TagDictionaryTab onChanged={() => void load()} />,
          },
          {
            key: 'preview',
            label: t('recommend.previewTab'),
            children: (
              <Card>
                <Space wrap style={{ marginBottom: 12 }}>
                  <InputNumber min={1} placeholder={t('recommend.userIdPlaceholder')} value={previewUserId ?? undefined} onChange={(v) => setPreviewUserId(typeof v === 'number' ? v : null)} />
                  <Select value={previewSurface} onChange={setPreviewSurface} style={{ width: 220 }}
                    options={[
                      { value: 'companions_recommend', label: t('recommend.scene.companions_recommend') as string },
                      { value: 'companions_all', label: t('recommend.scene.companions_all') as string },
                      { value: 'moments', label: t('recommend.scene.moments') as string },
                    ]} />
                  <Button type="primary" loading={previewing} onClick={() => void runPreview()}>{t('recommend.runPreview')}</Button>
                </Space>
                {preview && (
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview, null, 2)}</pre>
                )}
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={modalOpen}
        title={editing ? t('btn.edit') : t('btn.new')}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('recommend.name')} rules={[{ required: true, message: t('recommend.nameRequired') as string }]}>
            <Input />
          </Form.Item>
          <Form.Item name="priority" label={t('recommend.priority')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="apply_to" label={t('recommend.applyTo')}>
            <Select options={[
              { value: 'companions_recommend', label: t('recommend.scene.companions_recommend') as string },
              { value: 'companions_all', label: t('recommend.scene.companions_all') as string },
              { value: 'moments', label: t('recommend.scene.moments') as string },
              { value: 'both', label: t('recommend.scene.both') as string },
              { value: 'companions', label: t('recommend.scene.companions') as string },
            ]} />
          </Form.Item>
          <Form.Item name="enabled" label={t('recommend.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="noAdSource"
            label={t('recommend.noAdSource')}
            valuePropName="checked"
            tooltip={t('recommend.noAdSourceHint') as string}
            style={{ marginBottom: 8 }}
          >
            <Switch
              checked={noAdSource}
              onChange={(checked) => {
                setNoAdSource(checked);
                if (checked) {
                  setSelectedSpecificAdTags([]);
                  setGenericAdEnabled(false);
                }
              }}
            />
          </Form.Item>
        </Form>
        {!noAdSource && (
          <>
            <Typography.Paragraph strong>{t('recommend.adSpecific')}</Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              {t('recommend.adSpecificHint')}
            </Typography.Paragraph>
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: '100%', marginBottom: 12 }}
              placeholder={t('recommend.adSpecificPlaceholder') as string}
              value={selectedSpecificAdTags}
              onChange={setSelectedSpecificAdTags}
              options={specificAdOptions.map((opt) => ({
                value: opt.user_tag,
                label: adGroupLabel(opt, locale),
              }))}
            />
            <Typography.Paragraph strong>{t('recommend.adGeneric')}</Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              {genericAdOption?.hint || t('recommend.adGenericHint')}
            </Typography.Paragraph>
            <Select
              style={{ width: '100%', marginBottom: 12 }}
              value={genericAdEnabled ? GENERIC_AD_TAG : undefined}
              allowClear
              placeholder={t('recommend.adGenericPlaceholder') as string}
              onChange={(v) => setGenericAdEnabled(v === GENERIC_AD_TAG)}
              options={[
                {
                  value: GENERIC_AD_TAG,
                  label: genericAdOption
                    ? adGroupLabel(genericAdOption, locale)
                    : (t('recommend.adGenericOption') as string),
                },
              ]}
            />
          </>
        )}
        <Typography.Paragraph strong>{t('recommend.userTags')}</Typography.Paragraph>
        {userGrouped.map((g) => (
          <div key={`u-${g.group}`} style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 4 }}>{groupLabel(g.group, t)}</div>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              options={g.options}
              value={userGroups[g.group] || [ALL]}
              onChange={(vals) => onGroupChange(setUserGroups, userGroups, g.group, vals)}
            />
          </div>
        ))}
        <Typography.Paragraph strong style={{ marginTop: 12 }}>{t('recommend.agentTags')}</Typography.Paragraph>
        {agentGrouped.map((g) => (
          <div key={`a-${g.group}`} style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 4 }}>{groupLabel(g.group, t)}</div>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              options={g.options}
              value={agentGroups[g.group] || [ALL]}
              onChange={(vals) => onGroupChange(setAgentGroups, agentGroups, g.group, vals)}
            />
          </div>
        ))}
        <div style={{ marginTop: 8 }}>
          {(flatten(userGroups).length === 0 && selectedSpecificAdTags.length === 0 && !genericAdEnabled) && (
            <Tag>{t('recommend.allUsers')}</Tag>
          )}
          {(flatten(agentGroups).length === 0) && <Tag>{t('recommend.allAgents')}</Tag>}
        </div>
      </Modal>
    </div>
  );
}
