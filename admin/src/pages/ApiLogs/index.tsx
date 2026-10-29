import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProTable from '@ant-design/pro-table';
import { Button, Popconfirm, Space, Switch, Tag, Typography } from 'antd';
import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { adminFetch, adminFetchJson, showError, showSuccess } from '../../api/request';
import { FormatDate } from '../../components/FormatDate';
import { unwrapResults } from '../Companions/contentApi';
import { getAppLanguage } from '../../locales';

type LogFile = {
  name: string;
  size: number;
  mtime: string;
  current?: boolean;
};

type LogsResult = {
  enabled?: boolean;
  env_forced_off?: boolean;
  dir?: string;
  current?: string;
  max_mb?: number;
  backup_count?: number;
  files?: LogFile[];
  deleted?: number;
};

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function asLogsResult(res: unknown): LogsResult {
  const raw = unwrapResults<LogsResult>(res) ?? (res as LogsResult | undefined);
  return raw && typeof raw === 'object' ? raw : {};
}

export default function ApiLogsPage() {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [data, setData] = useState<LogsResult>({});

  const apply = useCallback((next: LogsResult) => {
    setData({
      ...next,
      files: Array.isArray(next.files) ? next.files : [],
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetchJson('/api/admin/logs');
      apply(asLogsResult(res));
    } catch (e) {
      showError((e as Error).message || (t('toast.loadFailed') as string));
    } finally {
      setLoading(false);
    }
  }, [apply, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setEnabled(enabled: boolean) {
    setToggling(true);
    try {
      const res = await adminFetchJson('/api/admin/logs/enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      apply(asLogsResult(res));
      showSuccess(t('toast.saved') as string);
    } catch (e) {
      showError((e as Error).message || (t('settings.saveFailed') as string));
    } finally {
      setToggling(false);
    }
  }

  async function downloadFile(name: string) {
    try {
      const qs = name ? `?name=${encodeURIComponent(name)}` : '';
      const res = await adminFetch(`/api/admin/logs/file${qs}`);
      if (!res) return;
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const err = await res.json();
          msg = err.error || err.detail || err.message || msg;
        } catch {
          try {
            msg = (await res.text()) || msg;
          } catch {
            /* keep */
          }
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'api.log';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showError((e as Error).message || (t('logs.downloadFailed') as string));
    }
  }

  async function deleteFile(name: string) {
    try {
      const res = await adminFetchJson(`/api/admin/logs/file?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      apply(asLogsResult(res));
      showSuccess(t('toast.deleteSuccess') as string);
    } catch (e) {
      showError((e as Error).message || (t('toast.loadFailed') as string));
    }
  }

  async function deleteAll() {
    try {
      const res = await adminFetchJson('/api/admin/logs', { method: 'DELETE' });
      apply(asLogsResult(res));
      showSuccess(t('toast.deleteSuccess') as string);
    } catch (e) {
      showError((e as Error).message || (t('toast.loadFailed') as string));
    }
  }

  const files = data.files ?? [];
  const envForcedOff = !!data.env_forced_off;

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>{t('page.apiLogs')}</h2>
      <Space wrap align="center" style={{ marginBottom: 12 }}>
        <Typography.Text>{t('logs.enabledLabel')}</Typography.Text>
        <Switch
          checked={!!data.enabled}
          disabled={envForcedOff || toggling}
          loading={toggling}
          onChange={(v) => void setEnabled(v)}
        />
        {envForcedOff ? (
          <Typography.Text type="secondary">{t('logs.envForcedOff')}</Typography.Text>
        ) : null}
      </Space>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {t('logs.limitHint', { max: data.max_mb ?? 20, count: data.backup_count ?? 20 })}
        {data.dir ? ` · ${data.dir}` : ''}
      </Typography.Text>
      <ProTable<LogFile>
        rowKey="name"
        search={false}
        options={false}
        loading={loading}
        dataSource={files}
        pagination={false}
        locale={{ emptyText: t('logs.empty') as string }}
        toolBarRender={() => [
          <Popconfirm
            key="clear"
            title={t('logs.deleteAllConfirm')}
            onConfirm={() => void deleteAll()}
            okText={t('btn.delete')}
            cancelText={t('btn.cancel')}
            disabled={!files.length}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!files.length}>
              {t('logs.deleteAll')}
            </Button>
          </Popconfirm>,
        ]}
        columns={[
          {
            title: t('logs.fileName'),
            dataIndex: 'name',
            ellipsis: true,
            render: (_: unknown, record: LogFile) => (
              <Space>
                <span>{record.name}</span>
                {record.current ? <Tag color="blue">{t('logs.current')}</Tag> : null}
              </Space>
            ),
          },
          {
            title: t('logs.fileSize'),
            dataIndex: 'size',
            width: 140,
            render: (_: unknown, record: LogFile) => formatBytes(record.size),
          },
          {
            title: t('logs.mtime'),
            dataIndex: 'mtime',
            width: 200,
            render: (_: unknown, record: LogFile) => <FormatDate value={record.mtime} locale={locale} />,
          },
          {
            title: t('table.action'),
            key: 'action',
            width: 180,
            render: (_: unknown, record: LogFile) => (
              <Space>
                <Button type="link" icon={<DownloadOutlined />} onClick={() => void downloadFile(record.name)}>
                  {t('logs.download')}
                </Button>
                <Popconfirm
                  title={t('logs.deleteConfirm')}
                  onConfirm={() => void deleteFile(record.name)}
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
        ]}
      />
    </div>
  );
}
