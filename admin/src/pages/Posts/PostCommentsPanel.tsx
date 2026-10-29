import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import type { ContentPostComment } from '../../types';
import { unwrapResults } from '../Companions/contentApi';
import { getAppLanguage } from '../../locales';

export default function PostCommentsPanel({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const actionRef = useRef<ActionType | null>(null);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ContentPostComment | null>(null);

  const columns: ProColumns<ContentPostComment>[] = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 80, search: false },
    {
      title: t('table.user'),
      key: 'user',
      width: 160,
      search: false,
      render: (_, record) => record.user_name || (record.user_id != null ? `#${record.user_id}` : '-'),
    },
    { title: t('table.userId'), dataIndex: 'user_id', key: 'user_id', width: 100, hideInTable: true },
    {
      title: t('table.keyword'),
      dataIndex: 'keyword',
      key: 'keyword',
      hideInTable: true,
    },
    {
      title: t('audit.content'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      search: false,
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 168,
      search: false,
      render: (_, record) => <FormatDate value={record.created_at} locale={locale} />,
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 160,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(record);
              form.setFieldsValue({ content: record.content });
              setOpen(true);
            }}
          >
            {t('btn.edit')}
          </Button>
          <Popconfirm
            title={t('confirm.deleteComment')}
            onConfirm={() => void handleDelete(record.id)}
            okText={t('btn.delete')}
            cancelText={t('btn.cancel')}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              {t('btn.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  async function handleDelete(id: number) {
    try {
      const res = await adminFetch(`/api/admin/content/posts/${postId}/comments/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      } else {
        showError(t('toast.loadFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
    }
  }

  const handleSave = useCallback(async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      let res: Response | null;
      if (editing) {
        res = await adminFetch(`/api/admin/content/posts/${postId}/comments/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: values.content }),
        });
      } else {
        const body: Record<string, unknown> = { content: values.content };
        if (values.user_id) body.user_id = values.user_id;
        if (values.user_name) body.user_name = values.user_name;
        res = await adminFetch(`/api/admin/content/posts/${postId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (res && res.ok) {
        showSuccess(t('toast.saved') as string);
        setOpen(false);
        form.resetFields();
        setEditing(null);
        actionRef.current?.reload();
      } else {
        showError(t('settings.saveFailed') as string);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : (t('settings.saveFailed') as string));
    } finally {
      setSaving(false);
    }
  }, [editing, form, postId, t]);

  return (
    <>
      <ProTable<ContentPostComment>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        search={{ labelWidth: 'auto', defaultCollapsed: true }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle={t('post.comments')}
        toolBarRender={() => [
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            {t('post.newComment')}
          </Button>,
        ]}
        request={async (params) => {
          const page = Math.max(1, Number(params.current) || 1);
          const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 20));
          const qs = new URLSearchParams({
            page: String(page),
            page_size: String(pageSize),
            sort_order: 'asc',
          });
          if (params.keyword) qs.set('keyword', String(params.keyword));
          if (params.user_id) qs.set('user_id', String(params.user_id));
          try {
            const res = await adminFetchJson<{
              results?: ContentPostComment[];
              pagination?: { total?: number };
            }>(`/api/admin/content/posts/${postId}/comments?${qs.toString()}`);
            const rows = unwrapResults<ContentPostComment[]>(res) ?? [];
            const list = Array.isArray(rows) ? rows : [];
            return { data: list, success: true, total: res?.pagination?.total ?? list.length };
          } catch (e) {
            showError(e instanceof Error ? e.message : (t('toast.loadFailed') as string));
            return { data: [], success: false, total: 0 };
          }
        }}
      />
      <Modal
        title={editing ? t('post.editComment') : t('post.newComment')}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={t('btn.save')}
        cancelText={t('btn.cancel')}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item name="user_id" label={t('table.userId')}>
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="user_name" label={t('post.authorName')} extra={t('post.commentAuthorHint')}>
                <Input maxLength={50} />
              </Form.Item>
            </>
          )}
          <Form.Item name="content" label={t('audit.content')} rules={[{ required: true, message: t('toast.enterContent') }]}>
            <Input.TextArea rows={4} maxLength={500} showCount style={{ marginBottom: 16 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
