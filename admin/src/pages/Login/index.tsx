import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Input, Button, Form, Typography, Space } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { setToken, setAdminSession, showError, showSuccess, showWarning } from '../../api/request';
import { useNavigate } from 'react-router-dom';

const { Title } = Typography;

type LoginForm = {
  username?: string;
  password: string;
};

function pickLoginPayload(data: Record<string, unknown>) {
  const results = data.results;
  if (results && typeof results === 'object' && !Array.isArray(results)) {
    return results as Record<string, unknown>;
  }
  return data;
}

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: LoginForm) => {
    if (!values.password) {
      showWarning(t('login.error.empty'));
      return;
    }
    setLoading(true);
    try {
      const username = (values.username || '').trim();
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: values.password }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      const payload = pickLoginPayload(data);
      const token = String(payload.token || payload.access_token || data.token || '');
      const ok = res.ok && token && (data.code === undefined || data.code === 200);
      if (ok) {
        setToken(token);
        setAdminSession({
          username: String(payload.username || username),
          nickname: payload.nickname != null ? String(payload.nickname) : undefined,
          role_key: payload.role_key != null ? String(payload.role_key) : undefined,
          user_id: typeof payload.user_id === 'number' ? payload.user_id : typeof payload.id === 'number' ? payload.id : undefined,
        });
        showSuccess(t('login.success'));
        navigate('/');
      } else {
        const apiError =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.message === 'string' && data.message) ||
          (typeof data.detail === 'string' && data.detail) ||
          t('login.error.wrong');
        showError(apiError);
      }
    } catch {
      showError(t('login.error.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 420, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <Space direction="vertical" style={{ width: '100%' }} align="center">
          <Title level={3}>{t('login.title')}</Title>
        </Space>
        <Form onFinish={handleLogin} style={{ marginTop: 24 }}>
          <Form.Item name="username">
            <Input
              prefix={<UserOutlined />}
              placeholder={t('login.usernamePlaceholder') as string}
              size="large"
              maxLength={40}
              autoComplete="username"
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.error.empty') as string }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('login.placeholder') as string}
              size="large"
              maxLength={40}
              autoComplete="current-password"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              {loading ? t('login.loggingIn') : t('btn.login')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
