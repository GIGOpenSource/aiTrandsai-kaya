import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showError, showSuccess } from '../../api/request';
import type { AdminMenu, PaginatedResponse } from '../../types';

const MENU_ERROR_KEYS: Record<string, string> = {
  menu_key_required: 'menus.errMenuKeyRequired',
  menu_exists: 'menus.errMenuExists',
  path_exists: 'menus.errPathExists',
  parent_not_found: 'menus.errParentNotFound',
  parent_cannot_be_self: 'menus.errParentCannotBeSelf',
  parent_must_be_top_level: 'menus.errParentMustBeTopLevel',
  menu_has_children_cannot_nest: 'menus.errHasChildrenCannotNest',
  menu_has_children: 'menus.errMenuHasChildren',
  menu_not_found: 'menus.errMenuNotFound',
};

function annotateParentKey(nodes: AdminMenu[], parentKey = ''): AdminMenu[] {
  return nodes.map((node) => ({
    ...node,
    parent_key: node.parent_key || parentKey || '',
    children: node.children?.length ? annotateParentKey(node.children, node.menu_key) : node.children,
  }));
}

export default function MenusList() {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AdminMenu | null>(null);
  // 顶层菜单（树形结果），用于「父菜单」下拉选项
  const [topMenus, setTopMenus] = useState<AdminMenu[]>([]);
  const isEdit = Boolean(editing);
  // 编辑中的菜单是否已有子菜单：有子菜单的一级不能再挂到别人下面
  const editingHasChildren = Boolean(editing?.children?.length);

  function menuErrorMessage(detail: unknown) {
    if (typeof detail === 'string' && MENU_ERROR_KEYS[detail]) {
      return t(MENU_ERROR_KEYS[detail]) as string;
    }
    return (typeof detail === 'string' && detail) || (t('settings.saveFailed') as string);
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true, sort_order: 10, parent_key: '', path: '' });
    setOpen(true);
  }

  function openEdit(record: AdminMenu) {
    setEditing(record);
    // 目录型菜单（path 形如 #xxx）在表单中展示为空，留空即目录
    const rawPath = record.path || '';
    const formPath = rawPath && rawPath.startsWith('#') ? '' : rawPath;
    form.setFieldsValue({
      menu_key: record.menu_key,
      menu_name: record.menu_name,
      path: formPath,
      parent_key: record.parent_key || '',
      sort_order: record.sort_order ?? 10,
      is_active: record.is_active !== false,
    });
    setOpen(true);
  }

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        menu_name: values.menu_name,
        path: values.path || '',
        parent_key: values.parent_key || '',
        sort_order: values.sort_order ?? 10,
        is_active: values.is_active !== false,
      };
      let res: Response | null = null;
      if (isEdit && editing) {
        res = await adminFetch(`/api/admin/menus/${encodeURIComponent(editing.menu_key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        body.menu_key = values.menu_key;
        res = await adminFetch('/api/admin/menus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (!res || !res.ok) {
        const err = await res?.json().catch(() => null);
        throw new Error(menuErrorMessage(err?.detail || err?.message));
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

  // 删除：无子菜单直接删；有子菜单走 reparent_children=true（子菜单升为一级）
  async function doDelete(record: AdminMenu, reparent = false) {
    const base = `/api/admin/menus/${encodeURIComponent(record.menu_key)}`;
    const url = reparent ? `${base}?reparent_children=true` : base;
    const res = await adminFetch(url, { method: 'DELETE' });
    if (res && res.ok) {
      showSuccess(t('toast.deleteSuccess') as string);
      actionRef.current?.reload();
      return;
    }
    const err = await res?.json().catch(() => null);
    const detail = err?.detail || err?.message;
    // 兜底：服务端返回有子菜单但前端未识别时，二次确认是否 reparent
    if (detail === 'menu_has_children' && !reparent) {
      Modal.confirm({
        title: t('adminUsers.reminder'),
        content: t('menus.deleteWithChildrenConfirm', { key: record.menu_key }),
        okText: t('menus.reparentAndDelete'),
        cancelText: t('btn.cancel'),
        okButtonProps: { danger: true },
        onOk: () => doDelete(record, true),
      });
      return;
    }
    showError(menuErrorMessage(detail));
  }

  function confirmDelete(record: AdminMenu) {
    if (record.children?.length) {
      // 已知有子菜单：直接走「子菜单升为一级」确认
      Modal.confirm({
        title: t('adminUsers.reminder'),
        content: t('menus.deleteWithChildrenConfirm', { key: record.menu_key }),
        okText: t('menus.reparentAndDelete'),
        cancelText: t('btn.cancel'),
        okButtonProps: { danger: true },
        onOk: () => doDelete(record, true),
      });
      return;
    }
    Modal.confirm({
      title: t('adminUsers.reminder'),
      content: t('menus.deleteConfirm', { key: record.menu_key }),
      okText: t('btn.confirm'),
      cancelText: t('btn.cancel'),
      okButtonProps: { danger: true },
      onOk: () => doDelete(record, false),
    });
  }

  // 父菜单选项 = 所有一级菜单，排除自身（不能挂到自己名下）
  const parentOptions = useMemo(() => {
    return topMenus
      .filter((m) => !editing || m.menu_key !== editing.menu_key)
      .map((m) => ({
        value: m.menu_key,
        label: m.menu_name ? `${m.menu_name} (${m.menu_key})` : m.menu_key,
      }));
  }, [topMenus, editing]);

  const columns: ProColumns<AdminMenu>[] = [
    { title: t('menus.menuKey'), dataIndex: 'menu_key', key: 'menu_key', width: 160 },
    {
      title: t('menus.parentKeyCol'),
      dataIndex: 'parent_key',
      key: 'parent_key',
      width: 160,
      render: (_: unknown, record: AdminMenu) => record.parent_key || '—',
    },
    { title: t('menus.menuName'), dataIndex: 'menu_name', key: 'menu_name', width: 180 },
    {
      title: t('menus.type'),
      key: 'type',
      width: 90,
      render: (_: unknown, record: AdminMenu) => {
        const isDir = !record.path || record.path.startsWith('#');
        return isDir ? (
          <Tag>{t('menus.typeDirectory')}</Tag>
        ) : (
          <Tag>{t('menus.typeRoute')}</Tag>
        );
      },
    },
    {
      title: t('menus.path'),
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (_: unknown, record: AdminMenu) => record.path || '—',
    },
    { title: t('menus.sortOrder'), dataIndex: 'sort_order', key: 'sort_order', width: 88 },
    {
      title: t('table.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (_: unknown, record: AdminMenu) =>
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
      render: (_: unknown, record: AdminMenu) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            {t('btn.edit')}
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(record)}>
            {t('btn.delete')}
          </Button>
        </Space>
      ),
    },
  ];

  async function fetchData(params: { current?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(params.pageSize) || 200));
    try {
      const res = await adminFetchJson<PaginatedResponse<AdminMenu>>(
        `/api/admin/menus?page=${page}&page_size=${pageSize}&as_tree=true`,
      );
      const tree = annotateParentKey(res?.results ?? []);
      setTopMenus(tree);
      return { data: tree, success: true, total: res?.pagination?.total ?? tree.length };
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
      return { data: [], success: false, total: 0 };
    }
  }

  return (
    <div>
      <h2>{t('page.menus')}</h2>
      <ProTable<AdminMenu>
        actionRef={actionRef}
        columns={columns}
        rowKey="menu_key"
        request={fetchData}
        search={false}
        expandable={{ defaultExpandAllRows: true, childrenColumnName: 'children' }}
        pagination={{ defaultPageSize: 200, showSizeChanger: true, showTotal: (total) => t('table.total', { total }) }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('btn.new')}
          </Button>,
        ]}
      />
      <Drawer
        title={isEdit ? t('menus.editTitle') : t('menus.createTitle')}
        open={open}
        onClose={() => setOpen(false)}
        width={480}
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
          <Form.Item name="menu_key" label={t('menus.menuKey')} rules={[{ required: true }]}>
            <Input disabled={isEdit} />
          </Form.Item>
          <Form.Item name="menu_name" label={t('menus.menuName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="path" label={t('menus.path')} extra={t('menus.pathHint')}>
            <Input placeholder="/users" />
          </Form.Item>
          <Form.Item
            name="parent_key"
            label={t('menus.parentKey')}
            extra={editingHasChildren ? (t('menus.parentLockedHint') as string) : (t('menus.parentKeyHint') as string)}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('menus.parentKeyPlaceholder') as string}
              options={parentOptions}
              disabled={editingHasChildren}
            />
          </Form.Item>
          <Form.Item name="sort_order" label={t('menus.sortOrder')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('table.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
