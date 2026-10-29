import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Drawer, Form, Input, Modal, Space, Switch, Tag, Tooltip, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showError, showSuccess } from '../../api/request';
import type { AdminMenu, AdminRole, PaginatedResponse } from '../../types';

const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 从列表项 / GET menus / PUT menus 响应里抽出 menu_key 列表 */
function pickMenuKeys(res: unknown): string[] {
  if (!res || typeof res !== 'object') return [];
  const root = res as Record<string, unknown>;
  const payload = asRecord(root.results) ?? root;

  if (Array.isArray(payload.menu_keys)) {
    return payload.menu_keys.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(payload.menus)) {
    return pickMenuKeysFromList(payload.menus);
  }

  const list = Array.isArray(root.results)
    ? root.results
    : Array.isArray(res)
      ? (res as unknown[])
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];
  return pickMenuKeysFromList(list);
}

function pickMenuKeysFromList(items: unknown[]): string[] {
  const keys: string[] = [];
  const walk = (rows: unknown[]) => {
    rows.forEach((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        const key = String(item).trim();
        if (key) keys.push(key);
        return;
      }
      const row = asRecord(item);
      if (!row) return;
      const key = row.menu_key ?? row.key;
      if (key != null && String(key).trim()) keys.push(String(key).trim());
      if (Array.isArray(row.children)) walk(row.children);
    });
  };
  walk(items);
  return [...new Set(keys)];
}

function roleMenuKeys(record: AdminRole): string[] {
  if (Array.isArray(record.menu_keys) && record.menu_keys.length) {
    return record.menu_keys.map(String).filter(Boolean);
  }
  if (Array.isArray(record.menus) && record.menus.length) {
    return pickMenuKeysFromList(record.menus);
  }
  return [];
}

/** 扁平列表按 parent_key 组树（as_tree 失败时的兜底） */
function nestMenus(items: AdminMenu[]): AdminMenu[] {
  if (!items.length) return [];
  if (items.some((item) => item.children?.length)) return items;

  const byKey = new Map<string, AdminMenu>();
  items.forEach((item) => {
    byKey.set(item.menu_key, { ...item, children: [] });
  });
  const roots: AdminMenu[] = [];
  byKey.forEach((item) => {
    const parentKey = item.parent_key || '';
    if (parentKey && byKey.has(parentKey) && parentKey !== item.menu_key) {
      byKey.get(parentKey)!.children!.push(item);
    } else {
      roots.push(item);
    }
  });
  return roots;
}

function buildTreeData(items: AdminMenu[]): DataNode[] {
  return nestMenus(items).map((item) => ({
    key: item.menu_key,
    title: `${item.menu_name} (${item.menu_key}${item.path ? ` · ${item.path}` : ''})`,
    children: item.children?.length ? buildTreeData(item.children) : undefined,
  }));
}

async function readApiError(res: Response | null, fallback: string) {
  try {
    const data = (await res?.json()) as { detail?: string; message?: string; error?: string } | null;
    return data?.detail || data?.message || data?.error || fallback;
  } catch {
    return fallback;
  }
}

/** PUT /roles/{key}/menus，校验响应里的 menu_keys */
async function saveRoleMenus(roleKey: string, menuKeys: string[], failMessage: string) {
  const res = await adminFetch(`/api/admin/roles/${encodeURIComponent(roleKey)}/menus`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_keys: menuKeys }),
  });
  if (!res || !res.ok) {
    throw new Error(await readApiError(res, failMessage));
  }
  try {
    const data = await res.json();
    const saved = pickMenuKeys(data);
    // 空数组清空是合法的；有勾选时回显应非空且与请求交集一致
    if (menuKeys.length > 0 && saved.length === 0) {
      throw new Error(failMessage);
    }
    return saved;
  } catch (e) {
    if (e instanceof Error && e.message === failMessage) throw e;
    // 响应非 JSON 时仍视为成功（HTTP 已 ok）
    return menuKeys;
  }
}

export default function RolesList() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [menus, setMenus] = useState<AdminMenu[]>([]);
  const [selectedMenuKeys, setSelectedMenuKeys] = useState<string[]>([]);

  const isEdit = Boolean(editing);

  const loadMenus = useCallback(async () => {
    try {
      const res = await adminFetchJson<PaginatedResponse<AdminMenu>>(
        '/api/admin/menus?page=1&page_size=200&as_tree=true',
      );
      setMenus(res?.results ?? []);
    } catch {
      setMenus([]);
    }
  }, []);

  async function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setSelectedMenuKeys([]);
    await loadMenus();
    setOpen(true);
  }

  async function openEdit(record: AdminRole) {
    setEditing(record);
    form.setFieldsValue({
      role_key: record.role_key,
      role_name: record.role_name,
      description: record.description || '',
      is_active: record.is_active !== false,
    });
    // 列表里若已带 menu_keys，先展示；再拉专用接口校准
    setSelectedMenuKeys(roleMenuKeys(record));
    setOpen(true);
    await loadMenus();
    try {
      const res = await adminFetchJson(
        `/api/admin/roles/${encodeURIComponent(record.role_key)}/menus?page=1&page_size=200`,
      );
      setSelectedMenuKeys(pickMenuKeys(res));
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    const menuKeys = [...new Set(selectedMenuKeys.map(String).filter(Boolean))];
    const menusFailMsg = t('roles.menusSaveFailed') as string;
    try {
      if (isEdit && editing) {
        // 1) 只改资料（不带 menu_keys，避免误以为资料接口会写权限）
        const res = await adminFetch(`/api/admin/roles/${encodeURIComponent(editing.role_key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role_name: values.role_name,
            description: values.description || '',
            is_active: values.is_active,
          }),
        });
        if (!res || !res.ok) {
          throw new Error(await readApiError(res, t('settings.saveFailed') as string));
        }
        // 2) 专用接口写菜单权限（含空数组 = 清空）
        await saveRoleMenus(editing.role_key, menuKeys, menusFailMsg);
      } else {
        const res = await adminFetch('/api/admin/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role_key: values.role_key,
            role_name: values.role_name,
            description: values.description || '',
            menu_keys: menuKeys,
          }),
        });
        if (!res || !res.ok) {
          throw new Error(await readApiError(res, t('settings.saveFailed') as string));
        }
        // 再走专用接口，保证权限一定落库（空数组也会清空）
        await saveRoleMenus(String(values.role_key), menuKeys, menusFailMsg);
      }
      showSuccess(t('toast.saved') as string);
      setOpen(false);
      actionRef.current?.reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(record: AdminRole) {
    Modal.confirm({
      title: t('adminUsers.reminder'),
      content: t('roles.deleteConfirm', { key: record.role_key }),
      okText: t('btn.confirm'),
      cancelText: t('btn.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await adminFetch(`/api/admin/roles/${encodeURIComponent(record.role_key)}`, { method: 'DELETE' });
        if (res && res.ok) {
          showSuccess(t('toast.deleteSuccess') as string);
          actionRef.current?.reload();
        } else {
          showError(await readApiError(res, t('toast.loadFailed') as string));
        }
      },
    });
  }

  const columns: ProColumns<AdminRole>[] = [
    { title: t('roles.roleKey'), dataIndex: 'role_key', key: 'role_key', width: 140 },
    { title: t('roles.roleName'), dataIndex: 'role_name', key: 'role_name' },
    {
      title: t('roles.description'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (_: unknown, record: AdminRole) => record.description || '——',
    },
    {
      title: t('roles.menuKeys'),
      dataIndex: 'menu_keys',
      key: 'menu_keys',
      width: 200,
      ellipsis: true,
      render: (_: unknown, record: AdminRole) => {
        const keys = roleMenuKeys(record);
        if (!keys.length) return <Tag>{t('roles.menuKeysEmpty')}</Tag>;
        return (
          <Tooltip title={keys.join(', ')}>
            <span>{keys.length} · {keys.slice(0, 3).join(', ')}{keys.length > 3 ? '…' : ''}</span>
          </Tooltip>
        );
      },
    },
    {
      title: t('table.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (_: unknown, record: AdminRole) =>
        record.is_active === false ? (
          <Tag>{t('adminUsers.statusInactive')}</Tag>
        ) : (
          <Tag color="success">{t('adminUsers.statusActive')}</Tag>
        ),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 180,
      render: (_: unknown, record: AdminRole) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => void openEdit(record)}>
            {t('btn.edit')}
          </Button>
          {record.role_key !== 'admin' && (
            <Button type="link" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(record)}>
              {t('btn.delete')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  async function fetchData(params: { current?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 20));
    try {
      const res = await adminFetchJson<PaginatedResponse<AdminRole>>(
        `/api/admin/roles?page=${page}&page_size=${pageSize}`,
      );
      return { data: res?.results ?? [], success: true, total: res?.pagination?.total ?? 0 };
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      return { data: [], success: false, total: 0 };
    }
  }

  return (
    <div>
      <h2>{t('page.roles')}</h2>
      <ProTable<AdminRole>
        actionRef={actionRef}
        columns={columns}
        rowKey="role_key"
        request={fetchData}
        search={false}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>
            {t('btn.new')}
          </Button>,
        ]}
      />
      <Drawer
        title={isEdit ? t('roles.editTitle') : t('roles.createTitle')}
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>{t('btn.cancel')}</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              {t('btn.save')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="role_key"
            label={t('roles.roleKey')}
            extra={t('roles.roleKeyHint')}
            rules={[
              { required: true, message: t('roles.roleKeyRequired') as string },
              { pattern: ROLE_KEY_RE, message: t('roles.roleKeyInvalid') as string },
            ]}
          >
            <Input disabled={isEdit} maxLength={32} />
          </Form.Item>
          <Form.Item name="role_name" label={t('roles.roleName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('roles.description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {isEdit && (
            <Form.Item name="is_active" label={t('table.status')} valuePropName="checked">
              <Switch checkedChildren={t('adminUsers.statusActive')} unCheckedChildren={t('adminUsers.statusInactive')} />
            </Form.Item>
          )}
          <Form.Item label={t('roles.visibleMenus')} extra={t('roles.visibleMenusHint')}>
            <Tree
              checkable
              selectable={false}
              defaultExpandAll
              checkedKeys={selectedMenuKeys}
              onCheck={(checked) => {
                const keys = Array.isArray(checked) ? checked : (checked as { checked: React.Key[] }).checked;
                setSelectedMenuKeys(keys.map(String));
              }}
              treeData={buildTreeData(menus)}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
