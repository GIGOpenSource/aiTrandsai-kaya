import { useTranslation } from 'react-i18next';
import ProTable from '@ant-design/pro-table';
import { KeepAliveOutlet, useKeepAliveList, useTablePagination } from '../../hooks/useKeepAliveList';
import { Button, Popconfirm, Space } from 'antd';
import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { adminFetchJson, adminFetch, showSuccess, showError } from '../../api/request';
import type { KnowledgeEntry } from '../../types';
import { parsePaged, unwrapResults } from '../Companions/contentApi';

export default function KnowledgeList() {
  const { t } = useTranslation();
  const { isListPage, listWrapRef, dataSource, setDataSource, actionRef, goToChild } =
    useKeepAliveList<KnowledgeEntry>({
      listPath: '/knowledge',
      getRowId: (row) => row.id,
      fetchRow: async (id) => {
        try {
          const one = await adminFetchJson(`/api/admin/knowledge/${id}`);
          const item = unwrapResults<KnowledgeEntry>(one) ?? (one as KnowledgeEntry | undefined);
          if (item && typeof item === 'object' && 'id' in item) return item;
        } catch {
          /* 无详情接口时从分页列表回退 */
        }
        const res = await adminFetchJson('/api/admin/knowledge?page=1&page_size=200');
        return parsePaged<KnowledgeEntry>(res).list.find((item) => String(item.id) === String(id));
      },
    });
  const pagination = useTablePagination(10);

  const columns = [
    { title: t('table.id'), dataIndex: 'id', key: 'id', width: 100 },
    { title: t('table.title'), dataIndex: 'title', key: 'title' },
    { title: t('table.category'), dataIndex: 'category', key: 'category' },
    { title: t('table.language'), dataIndex: 'language', key: 'language' },
    {
      title: t('table.summary'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      render: (_: unknown, record: KnowledgeEntry) => (record.content?.length > 80 ? record.content.slice(0, 80) + '...' : record.content || ''),
    },
    {
      title: t('table.action'),
      key: 'action',
      width: 180,
      render: (_: unknown, record: KnowledgeEntry) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => goToChild(`/knowledge/${record.id}/edit`)}
          >
            {t('btn.edit')}
          </Button>
          <Popconfirm
            title={t('confirm.deleteMoment')}
            onConfirm={() => handleDelete(record.id)}
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

  async function fetchData(params: { current?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.current) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      const res = await adminFetchJson(`/api/admin/knowledge?${qs.toString()}`);
      const { list, total } = parsePaged<KnowledgeEntry>(res);
      return { data: list, success: true, total };
    } catch {
      showError(t('toast.loadFailed') as string);
      return { data: [], success: false, total: 0 };
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await adminFetch(`/api/admin/knowledge/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        showSuccess(t('toast.deleteSuccess') as string);
        actionRef.current?.reload();
      }
    } catch {
      showError(t('toast.loadFailed') as string);
    }
  }

  return (
    <div>
      <div ref={listWrapRef} style={{ display: isListPage ? undefined : 'none' }}>
      <h2>{t('page.knowledge')}</h2>
      <ProTable
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        request={fetchData}
        search={false}
        pagination={{
          ...pagination,
          showTotal: (total) => t('table.total', { total }),
        }}
        toolBarRender={() => [
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => goToChild('/knowledge/new')}>
            {t('btn.new')}
          </Button>,
        ]}
      />
      </div>
      <KeepAliveOutlet />
    </div>
  );
}
