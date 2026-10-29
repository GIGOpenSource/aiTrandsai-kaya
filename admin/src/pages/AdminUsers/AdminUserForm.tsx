import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Form, Input, Radio, Select, Space, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showError, showSuccess } from '../../api/request';
import type { AdminAccount, AdminRole, ContentCompanion, PaginatedResponse } from '../../types';
import { normalizeCompanion } from '../Companions/contentApi';
import { parsePaged, splitIds } from '../MsgStrategy/api';

const COMPANION_PAGE_SIZE = 20;

type SelectOption = { value: string; label: string };

function companionOption(item: Pick<ContentCompanion, 'id' | 'name'>): SelectOption | null {
  if (!item.id) return null;
  return {
    value: item.id,
    label: item.name ? `${item.name} (${item.id})` : item.id,
  };
}

function mergeOptions(prev: SelectOption[], next: SelectOption[]) {
  const map = new Map(prev.map((item) => [item.value, item]));
  next.forEach((item) => map.set(item.value, item));
  return [...map.values()];
}

export default function AdminUserForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [companionOptions, setCompanionOptions] = useState<SelectOption[]>([]);
  const [companionLoading, setCompanionLoading] = useState(false);
  const companionPageRef = useRef(1);
  const companionHasMoreRef = useRef(true);
  const companionKeywordRef = useRef('');
  const companionLoadingRef = useRef(false);
  const companionSearchTimer = useRef<number | null>(null);

  const loadRoles = useCallback(async () => {
    try {
      const res = await adminFetchJson<PaginatedResponse<AdminRole>>('/api/admin/roles?page=1&page_size=200');
      setRoles(res?.results ?? []);
    } catch {
      /* 角色列表失败时仍可手填 role_key */
    }
  }, []);

  const loadCompanions = useCallback(async (page: number, keyword = '', append = false) => {
    if (companionLoadingRef.current) return;
    companionLoadingRef.current = true;
    setCompanionLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(COMPANION_PAGE_SIZE),
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      if (keyword) qs.set('keyword', keyword);
      const res = await adminFetchJson(`/api/admin/content/companions?${qs.toString()}`);
      const { list, total } = parsePaged<ContentCompanion>(res);
      const next = list
        .map(normalizeCompanion)
        .map(companionOption)
        .filter((item): item is SelectOption => Boolean(item));
      const selected = splitIds(form.getFieldValue('companion_ids'));
      setCompanionOptions((prev) => {
        const kept = prev.filter((item) => selected.includes(item.value));
        return mergeOptions(append ? prev : kept, next);
      });
      companionPageRef.current = page;
      companionKeywordRef.current = keyword;
      companionHasMoreRef.current =
        list.length >= COMPANION_PAGE_SIZE &&
        (total > 0 ? page * COMPANION_PAGE_SIZE < total : true);
    } catch {
      companionHasMoreRef.current = false;
    } finally {
      companionLoadingRef.current = false;
      setCompanionLoading(false);
    }
  }, [form]);

  const handleCompanionDropdown = (visible: boolean) => {
    if (!visible) return;
    companionKeywordRef.current = '';
    companionHasMoreRef.current = true;
    void loadCompanions(1, '', false);
  };

  const handleCompanionSearch = (value: string) => {
    if (companionSearchTimer.current) window.clearTimeout(companionSearchTimer.current);
    companionSearchTimer.current = window.setTimeout(() => {
      companionHasMoreRef.current = true;
      void loadCompanions(1, value.trim(), false);
    }, 300);
  };

  const handleCompanionScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    if (target.scrollTop + target.offsetHeight + 32 < target.scrollHeight) return;
    if (!companionHasMoreRef.current || companionLoadingRef.current) return;
    void loadCompanions(companionPageRef.current + 1, companionKeywordRef.current, true);
  };

  const loadData = useCallback(async () => {
    if (!isEdit || !id) return;
    setLoading(true);
    try {
      let item: AdminAccount | null = null;
      try {
        const res = await adminFetchJson<AdminAccount | { results?: AdminAccount }>(`/api/admin/admin-users/${id}`);
        if (res && typeof res === 'object' && 'results' in res && res.results && !Array.isArray(res.results)) {
          item = res.results;
        } else if (res && typeof res === 'object' && 'id' in res) {
          item = res as AdminAccount;
        }
      } catch {
        /* 无详情接口时从列表回退 */
      }
      if (!item) {
        const list = await adminFetchJson<PaginatedResponse<AdminAccount>>(
          '/api/admin/admin-users?page=1&page_size=200',
        );
        item = (list?.results ?? []).find((u) => String(u.id) === String(id)) ?? null;
      }
      if (item) {
        const companionIds = Array.isArray(item.companion_ids)
          ? item.companion_ids.map(String)
          : splitIds(item.companion_ids);
        form.setFieldsValue({
          username: item.username,
          email: item.email || '',
          nickname: item.nickname || '',
          role_key: item.role_key || undefined,
          is_active: item.is_active !== false,
          companion_ids: companionIds,
          remark: item.remark || '',
        });
        // 同步已选智能体到下拉选项；打开下拉时会从接口补全完整信息
        if (companionIds.length) {
          setCompanionOptions((prev) =>
            mergeOptions(
              companionIds.map((id) => ({ value: id, label: id })),
              prev,
            ),
          );
        }
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    } finally {
      setLoading(false);
    }
  }, [form, id, isEdit, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRoles();
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRoles, loadData]);

  useEffect(() => {
    return () => {
      if (companionSearchTimer.current) window.clearTimeout(companionSearchTimer.current);
    };
  }, []);

  async function handleSave() {
    const values = await form.validateFields();
    const body: Record<string, unknown> = {
      nickname: values.nickname || values.remark || values.username,
      role_key: values.role_key,
      email: values.email || '',
      is_active: values.is_active,
      companion_ids: splitIds(values.companion_ids),
      remark: values.remark || '',
    };
    if (!isEdit) {
      body.username = values.username;
      body.password = values.password;
    } else if (values.password) {
      body.password = values.password;
    }
    setSaving(true);
    try {
      const url = isEdit ? `/api/admin/admin-users/${id}` : '/api/admin/admin-users';
      const res = await adminFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        navigate('/admin-users');
      } else {
        let errMsg = '';
        try {
          const err = await res?.json();
          if (err) {
            errMsg =
              (err.message as string) ||
              (err.error as string) ||
              (err.detail as string) ||
              (err.msg as string) ||
              JSON.stringify(err);
          }
        } catch {
          try {
            errMsg = (await res?.text()) || '';
          } catch {
            // ignore
          }
        }
        showError(errMsg || (t('settings.saveFailed') as string));
      }
    } catch (e) {
      const errMsg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : (t('settings.saveFailed') as string);
      showError(errMsg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin-users')}>
          {t('btn.back')}
        </Button>
        <h2 style={{ margin: 0 }}>{isEdit ? t('adminUsers.editTitle') : t('adminUsers.createTitle')}</h2>
      </div>
      <Card loading={loading}>
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          initialValues={{ is_active: true }}
        >
          <Form.Item
            name="username"
            label={t('table.username')}
            extra={t('adminUsers.usernameHint')}
            rules={[{ required: true, message: t('adminUsers.usernameRequired') as string }, { max: 40 }]}
          >
            <Input maxLength={40} disabled={isEdit} />
          </Form.Item>
          <Form.Item name="email" label={t('adminUsers.email')} extra={t('adminUsers.emailHint')}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('adminUsers.setPassword')}
            extra={isEdit ? t('adminUsers.passwordEditHint') : t('adminUsers.passwordHint')}
            rules={isEdit ? [{ max: 40 }] : [{ required: true, message: t('adminUsers.passwordRequired') as string }, { max: 40 }]}
          >
            <Input.Password maxLength={40} placeholder={isEdit ? (t('adminUsers.passwordEditHint') as string) : undefined} />
          </Form.Item>
          <Form.Item
            name="role_key"
            label={t('adminUsers.permission')}
            extra={t('adminUsers.permissionHint')}
            rules={[{ required: true, message: t('adminUsers.roleRequired') as string }]}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('adminUsers.permission')}
              options={roles.map((r) => ({
                value: r.role_key,
                label: `${r.role_name} (${r.role_key})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="is_active" label={t('adminUsers.status')}>
            <Radio.Group>
              <Radio value={true}>{t('adminUsers.statusActive')}</Radio>
              <Radio value={false}>{t('adminUsers.statusInactive')}</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="companion_ids"
            label={t('adminUsers.opsFunctions')}
            extra={t('adminUsers.opsFunctionsHint')}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={false}
              loading={companionLoading}
              options={companionOptions}
              placeholder={t('adminUsers.opsFunctionsPlaceholder') as string}
              notFoundContent={companionLoading ? <Spin size="small" /> : undefined}
              onSearch={handleCompanionSearch}
              onPopupScroll={handleCompanionScroll}
              onOpenChange={handleCompanionDropdown}
              popupRender={(menu) => (
                <>
                  {menu}
                  {companionLoading && (
                    <div style={{ padding: '8px 0', textAlign: 'center' }}>
                      <Spin size="small" />
                      <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
                        {t('loading') as string}
                      </span>
                    </div>
                  )}
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="nickname" label={t('table.nickname')}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="remark" label={t('adminUsers.remark')} extra={t('adminUsers.remarkHint')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item wrapperCol={{ offset: 4 }}>
            <Space>
              <Button onClick={() => navigate('/admin-users')}>{t('btn.cancel')}</Button>
              <Button type="primary" onClick={() => void handleSave()} loading={saving}>
                {t('btn.save')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
