import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Form, Input, Select, Button, Space, Card, Table, InputNumber, Typography, Divider, Tag, Descriptions, Modal } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { UserItem, UserCompanionStatItem, CompanionItem } from '../../types';
import { getAppLanguage } from '../../locales';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import {
  applyUaShortcut,
  getRemainingFreeMessages,
  getRemainingPoints,
  getUserStatus,
  inferUaShortcut,
  isVipUser,
  sameTagList,
  uniqueTags,
  unwrapUser,
  UA_SOURCE_ADS,
} from './userFields';
import { unwrapResults } from '../Companions/contentApi';

export default function UserForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const locale = getAppLanguage();

  const [statsLoading, setStatsLoading] = useState(false);
  const [companionStats, setCompanionStats] = useState<UserCompanionStatItem[]>([]);
  const [allCompanions, setAllCompanions] = useState<CompanionItem[]>([]);
  const [affectionDraft, setAffectionDraft] = useState<Record<string, number>>({});
  const [addCompanionId, setAddCompanionId] = useState<string | undefined>();
  const [addAffection, setAddAffection] = useState<number>(0);
  const [uaTags, setUaTags] = useState<string[]>([]);
  const [originalUaTags, setOriginalUaTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<{ value: string; label: string }[]>([]);
  const [uaOptions, setUaOptions] = useState<{ value: string; label: string }[]>([]);
  const [userItem, setUserItem] = useState<UserItem | null>(null);

  const loadCompanionStats = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isEdit || !id) return;
    setStatsLoading(true);
    try {
      const res = await adminFetchJson<{ items: UserCompanionStatItem[] }>(
        `/api/admin/users/${id}/companion-stats`,
      );
      const items = res?.items ?? [];
      setCompanionStats(items);
      const drafts: Record<string, number> = {};
      items.forEach((row) => {
        drafts[row.companion_id] = row.affection;
      });
      setAffectionDraft(drafts);
    } catch {
      if (!opts?.silent) {
        showError(t('toast.loadFailed') as string);
      }
    } finally {
      setStatsLoading(false);
    }
  }, [id, isEdit, t]);

  const loadTagDefs = useCallback(async () => {
    try {
      const res = await adminFetchJson(
        '/api/admin/recommend/tag-defs?side=user',
      );
      const rows =
        (unwrapResults<{ key: string; group: string; label_zh?: string; label_en?: string; enabled?: boolean }[]>(res) ??
          (Array.isArray(res) ? res : [])) as Array<{
          key: string;
          group: string;
          label_zh?: string;
          label_en?: string;
          enabled?: boolean;
        }>;
      setTagOptions(
        rows
          .filter((d) => d.group !== 'ua' && d.enabled !== false)
          .map((d) => ({
            value: d.key,
            label: `${d.key} (${locale === 'en' ? d.label_en || d.label_zh : d.label_zh || d.label_en || d.key})`,
          })),
      );
      setUaOptions(
        rows
          .filter((d) => d.group === 'ua' && d.enabled !== false && d.key)
          .map((d) => ({
            value: d.key,
            label: (locale === 'en' ? d.label_en : d.label_zh) || d.label_zh || d.label_en || d.key,
          })),
      );
    } catch {
      /* 字典失败时仍可保存其它字段 */
    }
  }, [locale]);

  const loadCompanionsForSelect = useCallback(async () => {
    if (!isEdit) return;
    try {
      const res = await adminFetchJson<{ results?: CompanionItem[] } | CompanionItem[]>(
        '/api/admin/companions?page=1&page_size=500&sort_by=created_at&sort_order=desc',
      );
      const list = Array.isArray(res) ? res : (res?.results ?? []);
      setAllCompanions(list);
    } catch {
      /* 下拉可选失败时仍可编辑已有行 */
    }
  }, [isEdit]);

  const loadData = useCallback(async () => {
    if (!isEdit || !id) return;
    setLoading(true);
    try {
      const raw = await adminFetchJson<UserItem | { results?: UserItem }>(`/api/admin/users/${id}`);
      const item = unwrapUser(raw);
      if (item) {
        setUserItem(item);
        form.setFieldsValue({
          username: item.username,
          nickname: item.nickname || '',
          gender: item.gender || '',
          sexual_orientation: item.sexual_orientation || '',
          age: item.age ?? undefined,
          region: item.region || '',
          occupation: item.occupation || '',
          preferred_gender: item.preferred_gender || '',
          chat_purpose: item.chat_purpose || '',
          tags: item.tags || [],
          ua_tags: item.ua_tags || [],
        });
        const nextUa = item.ua_tags || [];
        setUaTags(nextUa);
        setOriginalUaTags(nextUa);
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    } finally {
      setLoading(false);
    }
  }, [form, id, isEdit, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
      void loadCompanionStats();
      void loadCompanionsForSelect();
      void loadTagDefs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData, loadCompanionStats, loadCompanionsForSelect, loadTagDefs]);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const { password, ua_tags: formUaTags, ...rest } = values as Record<string, unknown> & {
        password?: string;
        ua_tags?: string[];
      };
      const payload: Record<string, unknown> = { ...rest };
      if (password) payload.password = password;
      const nextUa = uniqueTags(formUaTags || uaTags);
      if (isEdit && !sameTagList(nextUa, originalUaTags)) {
        payload.ua_tags = nextUa;
      }
      let res: Response | null;
      if (isEdit) {
        res = await adminFetch(`/api/admin/users/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await adminFetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        navigate('/users', { state: isEdit ? undefined : { usersCreated: true } });
      } else {
        let err = await res?.text();
        try {
          const json = err ? (JSON.parse(err) as { message?: string }) : null;
          if (json?.message) err = json.message;
        } catch {
          /* keep text */
        }
        showError(err || (t('settings.saveFailed') as string));
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    } finally {
      setSaving(false);
    }
  }

  async function saveAffectionRow(companionId: string) {
    if (!id) return;
    const affection = affectionDraft[companionId];
    if (affection === undefined || Number.isNaN(affection)) {
      showError(t('users.affectionRequired') as string);
      return;
    }
    try {
      const res = await adminFetch(
        `/api/admin/users/${id}/companion-stats/${encodeURIComponent(companionId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ affection }),
        },
      );
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        await loadCompanionStats({ silent: true });
      } else {
        const err = await res?.text();
        showError(err || (t('settings.saveFailed') as string));
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    }
  }

  async function handleAddCompanionStat() {
    if (!id || !addCompanionId) {
      showError(t('users.pickCompanion') as string);
      return;
    }
    try {
      const res = await adminFetch(
        `/api/admin/users/${id}/companion-stats/${encodeURIComponent(addCompanionId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ affection: addAffection }),
        },
      );
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setAddCompanionId(undefined);
        setAddAffection(0);
        await loadCompanionStats({ silent: true });
      } else {
        const err = await res?.text();
        showError(err || (t('settings.saveFailed') as string));
      }
    } catch {
      showError(t('settings.saveFailed') as string);
    }
  }

  const uaSelectOptions = useMemo(() => {
    const map = new Map(uaOptions.map((item) => [item.value, item]));
    uaTags.forEach((key) => {
      if (!map.has(key)) map.set(key, { value: key, label: key });
    });
    return [...map.values()];
  }, [uaOptions, uaTags]);

  const uaShortcut = inferUaShortcut(uaTags);

  function applyShortcut(kind: 'none' | 'ads' | 'attributed') {
    if (kind === 'none') {
      if (!uaTags.length) {
        form.setFieldsValue({ ua_tags: [] });
        return;
      }
      Modal.confirm({
        title: t('users.clearUaConfirm') as string,
        okText: t('btn.confirm') as string,
        cancelText: t('btn.cancel') as string,
        onOk: () => {
          setUaTags([]);
          form.setFieldsValue({ ua_tags: [] });
        },
      });
      return;
    }
    const next = applyUaShortcut(kind, uaTags);
    setUaTags(next);
    form.setFieldsValue({ ua_tags: next });
  }

  const addOptions = useMemo(() => {
    const existing = new Set(companionStats.map((r) => r.companion_id));
    return allCompanions
      .filter((c) => !existing.has(c.profile.id))
      .map((c) => ({
        value: c.profile.id,
        label: `${c.profile.name} (${c.profile.id})`,
      }));
  }, [allCompanions, companionStats]);

  const statsColumns = [
    {
      title: t('table.avatar'),
      key: 'avatar',
      width: 72,
      render: (_: unknown, row: UserCompanionStatItem) => {
        const src =
          resolveAdminMediaUrl(row.avatar_url) ||
          `https://api.dicebear.com/7.x/avataaars/svg?seed=${row.companion_id}`;
        return (
          <img src={src} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        );
      },
    },
    {
      title: t('users.companionCol'),
      key: 'name',
      render: (_: unknown, row: UserCompanionStatItem) => (
        <div>
          <div>{row.companion_name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.companion_id}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('table.affection'),
      key: 'affection',
      width: 160,
      render: (_: unknown, row: UserCompanionStatItem) => (
        <InputNumber
          min={0}
          max={100}
          step={0.01}
          style={{ width: '100%' }}
          value={affectionDraft[row.companion_id]}
          onChange={(v) =>
            setAffectionDraft((d) => ({
              ...d,
              [row.companion_id]: typeof v === 'number' ? v : 0,
            }))
          }
        />
      ),
    },
    {
      title: t('users.turnsCol'),
      dataIndex: 'turns',
      key: 'turns',
      width: 88,
    },
    {
      title: t('table.updatedAt'),
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 168,
      render: (iso: string | null) => <FormatDate value={iso} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 100,
      render: (_: unknown, row: UserCompanionStatItem) => (
        <Button type="link" size="small" onClick={() => void saveAffectionRow(row.companion_id)}>
          {t('btn.save')}
        </Button>
      ),
    },
  ];

  const accountStatus = userItem ? getUserStatus(userItem) : 'normal';
  const accountStatusColor =
    accountStatus === 'banned' ? 'error' : accountStatus === 'cancelled' ? 'default' : 'success';
  const accountStatusLabel =
    accountStatus === 'banned'
      ? 'users.statusBanned'
      : accountStatus === 'cancelled'
        ? 'users.statusCancelled'
        : 'users.statusNormal';

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/users')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>
          {isEdit ? t('btn.viewDetail') : t('btn.new') + ' ' + t('page.users')}
        </h2>
      </div>

      {isEdit && userItem && (
        <Card title={t('users.accountInfo')} style={{ marginBottom: 16 }} loading={loading}>
          <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
            <Descriptions.Item label={t('table.vip')}>
              {isVipUser(userItem) ? t('yes') : t('no')}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.vipExpireAt')}>
              {!isVipUser(userItem)
                ? '——'
                : userItem.vip_type === 'lifetime' || !userItem.vip_expire_at
                  ? (t('users.vipLifetime') as string)
                  : <FormatDate value={userItem.vip_expire_at} locale={locale} />}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.remainingPoints')}>
              {getRemainingPoints(userItem) ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.remainingFreeMessages')}>
              {getRemainingFreeMessages(userItem) ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.status')}>
              <Tag color={accountStatusColor}>{t(accountStatusLabel)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('users.acquisition')}>
              {userItem.acquisition_label || t('users.acquisitionNone')}
            </Descriptions.Item>
            <Descriptions.Item label={t('table.createdAt')}>
              <FormatDate value={userItem.created_at} locale={locale} />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Card loading={loading}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="username"
            label={t('table.username')}
            rules={[{ required: !isEdit, message: t('user.usernameMin3') as string }, { min: 3 }]}
          >
            <Input disabled={isEdit} />
          </Form.Item>
          <Form.Item name="nickname" label={t('table.nickname')}>
            <Input />
          </Form.Item>
          <Form.Item name="age" label={t('table.age')}>
            <InputNumber min={0} max={150} style={{ width: '100%' }} placeholder="-" />
          </Form.Item>
          <Form.Item name="region" label={t('table.region')}>
            <Input allowClear maxLength={120} placeholder="-" />
          </Form.Item>
          <Form.Item name="gender" label={t('table.gender')}>
            <Select allowClear placeholder="-">
              <Select.Option value="male">{t('gender.male')}</Select.Option>
              <Select.Option value="female">{t('gender.female')}</Select.Option>
              <Select.Option value="non-binary">{t('gender.nonBinary')}</Select.Option>
              <Select.Option value="confidential">{t('gender.confidential')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="occupation" label={t('table.occupation')}>
            <Input allowClear maxLength={100} placeholder="-" />
          </Form.Item>
          <Form.Item name="sexual_orientation" label={t('table.sexualOrientation')}>
            <Select allowClear placeholder="-">
              <Select.Option value="heterosexual">{t('orientation.heterosexual')}</Select.Option>
              <Select.Option value="homosexual">{t('orientation.homosexual')}</Select.Option>
              <Select.Option value="bisexual">{t('orientation.bisexual')}</Select.Option>
              <Select.Option value="pansexual">{t('orientation.pansexual')}</Select.Option>
              <Select.Option value="asexual">{t('orientation.asexual')}</Select.Option>
              <Select.Option value="secret">{t('orientation.secret')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="preferred_gender" label={t('users.preferredGender')}>
            <Select allowClear placeholder="-">
              <Select.Option value="male">{t('users.prefMale')}</Select.Option>
              <Select.Option value="female">{t('users.prefFemale')}</Select.Option>
              <Select.Option value="non-binary">{t('users.prefNonBinary')}</Select.Option>
              <Select.Option value="confidential">{t('users.prefConfidential')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="chat_purpose" label={t('users.chatPurpose')}>
            <Select allowClear placeholder="-">
              <Select.Option value="chatting">{t('users.purposeChatting')}</Select.Option>
              <Select.Option value="companionship">{t('users.purposeCompanionship')}</Select.Option>
              <Select.Option value="romance">{t('users.purposeRomance')}</Select.Option>
              <Select.Option value="communication">{t('users.purposeCommunication')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="tags" label={t('recommend.opsTags')}>
            <Select mode="multiple" allowClear options={tagOptions} placeholder={t('recommend.opsTags') as string} />
          </Form.Item>
          {isEdit && (
            <>
              <Form.Item label={t('users.uaShortcut')}>
                <Space wrap>
                  <Button onClick={() => applyShortcut('none')}>{t('users.acquisitionNone')}</Button>
                  <Button onClick={() => applyShortcut('ads')}>{t('users.acquisitionAds')}</Button>
                  <Button onClick={() => applyShortcut('attributed')}>{t('users.acquisitionAttributed')}</Button>
                  <Tag>{userItem?.acquisition_label || t(`users.acquisition${uaShortcut === 'none' ? 'None' : uaShortcut === 'ads' ? 'Ads' : 'Attributed'}`)}</Tag>
                </Space>
              </Form.Item>
              <Form.Item
                name="ua_tags"
                label={t('recommend.uaTags')}
                extra={
                  <>
                    {userItem?.acquisition_label
                      ? `${t('users.acquisition')}: ${userItem.acquisition_label}`
                      : null}
                    <div>{t('users.uaTagsHint') as string}</div>
                  </>
                }
              >
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={uaSelectOptions}
                  placeholder={t('recommend.uaTags') as string}
                  onChange={(vals) => {
                    let next = uniqueTags(vals as string[]);
                    if (next.some((tag) => tag !== UA_SOURCE_ADS) && !next.includes(UA_SOURCE_ADS)) {
                      next = uniqueTags([UA_SOURCE_ADS, ...next]);
                    }
                    setUaTags(next);
                    form.setFieldsValue({ ua_tags: next });
                  }}
                />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="password"
            label={t('adminUsers.password')}
            rules={isEdit ? [] : [{ required: true, message: t('user.passwordMin6') as string }, { min: 6 }]}
          >
            <Input.Password placeholder={isEdit ? (t('user.passwordPlaceholderEdit') as string) : (t('user.passwordPlaceholderNew') as string)} />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={handleSave} loading={saving}>
              {t('btn.save')}
            </Button>
            <Button onClick={() => navigate('/users')}>{t('btn.cancel')}</Button>
          </Space>
        </Form>
      </Card>

      {isEdit && id && (
        <Card
          title={t('users.companionIntimacySection')}
          style={{ marginTop: 16 }}
          loading={statsLoading}
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {t('users.companionIntimacyHint')}
          </Typography.Paragraph>
          <Table
            rowKey="companion_id"
            size="small"
            pagination={false}
            columns={statsColumns}
            dataSource={companionStats}
            locale={{ emptyText: t('users.noCompanionStats') }}
          />

          <Divider orientation="left" plain>
            {t('users.addCompanionLink')}
          </Divider>
          <Space wrap>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('users.pickCompanion')}
              style={{ minWidth: 260 }}
              value={addCompanionId}
              onChange={(v) => setAddCompanionId(v)}
              options={addOptions}
              allowClear
            />
            <span>{t('table.affection')}</span>
            <InputNumber min={0} max={100} step={0.01} value={addAffection} onChange={(v) => setAddAffection(typeof v === 'number' ? v : 0)} />
            <Button type="default" onClick={() => void handleAddCompanionStat()}>
              {t('users.addLink')}
            </Button>
          </Space>
        </Card>
      )}
    </div>
  );
}
