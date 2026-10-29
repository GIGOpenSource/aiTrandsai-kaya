import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import { getToken, setMessageApi } from './api/request';
import BasicLayout from './components/BasicLayout';
import { ImUnreadProvider } from './pages/ChatSessions/ImUnreadContext';
import { ImLeaveGuardProvider } from './pages/ChatSessions/ImLeaveGuardContext';

const LoginPage = lazy(() => import('./pages/Login'));
const SettingsList = lazy(() => import('./pages/Settings/SettingsList'));
const SettingsForm = lazy(() => import('./pages/Settings/SettingsForm'));
const ImageGen = lazy(() => import('./pages/ImageGen'));
const Analytics = lazy(() => import('./pages/Analytics'));
const CompanionsList = lazy(() => import('./pages/Companions/CompanionsList'));
const CompanionForm = lazy(() => import('./pages/Companions/CompanionForm'));
const MomentsList = lazy(() => import('./pages/Moments/MomentsList'));
const MomentForm = lazy(() => import('./pages/Moments/MomentForm'));
const PostsList = lazy(() => import('./pages/Posts/PostsList'));
const PostForm = lazy(() => import('./pages/Posts/PostForm'));
const UsersList = lazy(() => import('./pages/Users/UsersList'));
const UserForm = lazy(() => import('./pages/Users/UserForm'));
const FeedbackList = lazy(() => import('./pages/Feedback/FeedbackList'));
const FeedbackForm = lazy(() => import('./pages/Feedback/FeedbackForm'));
const NotificationsList = lazy(() => import('./pages/Notifications/NotificationsList'));
const NotificationForm = lazy(() => import('./pages/Notifications/NotificationForm'));
const KnowledgeList = lazy(() => import('./pages/Knowledge/KnowledgeList'));
const KnowledgeForm = lazy(() => import('./pages/Knowledge/KnowledgeForm'));
const ChatSessionsList = lazy(() => import('./pages/ChatSessions/ChatSessionsList'));
const ContentAuditList = lazy(() => import('./pages/Audit/ContentAuditList'));
const ReportAuditList = lazy(() => import('./pages/Audit/ReportAuditList'));
const ProductsList = lazy(() => import('./pages/Products/ProductsList'));
const TemplatesList = lazy(() => import('./pages/Products/TemplatesList'));
const PendingOrdersList = lazy(() => import('./pages/PendingOrders/PendingOrdersList'));
const RecommendPage = lazy(() => import('./pages/Recommend'));
const AttributionPage = lazy(() => import('./pages/Attribution'));
const AdminUsersList = lazy(() => import('./pages/AdminUsers/AdminUsersList'));
const AdminUserForm = lazy(() => import('./pages/AdminUsers/AdminUserForm'));
const RolesList = lazy(() => import('./pages/Roles/RolesList'));
const MenusList = lazy(() => import('./pages/Menus/MenusList'));
const ApiLogsPage = lazy(() => import('./pages/ApiLogs'));
const StrategyCenterPage = lazy(() => import('./pages/StrategyCenter'));
const MsgStrategyGlobalsList = lazy(() => import('./pages/MsgStrategy/GlobalsList'));
const MsgStrategyRulesList = lazy(() => import('./pages/MsgStrategy/RulesList'));
const MsgStrategyLibraryList = lazy(() => import('./pages/MsgStrategy/LibraryList'));
const CompanionStrategiesList = lazy(() => import('./pages/CompanionStrategies'));
const QuickReplyPage = lazy(() => import('./pages/QuickReply'));
const SayHiCopiesList = lazy(() => import('./pages/SayHi/CopiesList'));
const ChatVersionPromptsList = lazy(() => import('./pages/ChatVersionPrompts/List'));

function AntdAppBridge() {
  const { message } = AntdApp.useApp();
  setMessageApi(message);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'en' ? enUS : zhCN;

  return (
    <ConfigProvider locale={locale}>
      <AntdApp>
        <AntdAppBridge />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
              <Route
                path="/*"
                element={
                  <RequireAuth>
                    <ImUnreadProvider>
                      <ImLeaveGuardProvider>
                        <BasicLayout />
                      </ImLeaveGuardProvider>
                    </ImUnreadProvider>
                  </RequireAuth>
                }
              >
              <Route index element={<Navigate to="/analytics" replace />} />
              <Route path="settings" element={<SettingsList />}>
                <Route path="new" element={<SettingsForm />} />
                <Route path=":id/edit" element={<SettingsForm />} />
              </Route>
              <Route path="chat-version-prompts" element={<ChatVersionPromptsList />} />

              <Route path="companions" element={<CompanionsList />}>
                <Route path="new" element={<CompanionForm />} />
                <Route path=":id/edit" element={<CompanionForm />} />
              </Route>

              <Route path="moments" element={<MomentsList />}>
                <Route path="new" element={<MomentForm />} />
                <Route path=":id/edit" element={<MomentForm />} />
              </Route>

              <Route path="posts" element={<PostsList />}>
                <Route path="new" element={<PostForm />} />
                <Route path=":id/edit" element={<PostForm />} />
              </Route>
              <Route path="say-hi" element={<SayHiCopiesList />} />

              <Route path="users" element={<UsersList />}>
                <Route path="new" element={<UserForm />} />
                <Route path=":id/edit" element={<UserForm />} />
              </Route>

              <Route path="feedback" element={<FeedbackList />}>
                <Route path=":id/edit" element={<FeedbackForm />} />
              </Route>

              <Route path="chat-sessions" element={<ChatSessionsList />} />

              <Route path="notifications" element={<NotificationsList />}>
                <Route path="new" element={<NotificationForm />} />
              </Route>

              <Route path="knowledge" element={<KnowledgeList />}>
                <Route path="new" element={<KnowledgeForm />} />
                <Route path=":id/edit" element={<KnowledgeForm />} />
              </Route>

              <Route path="image-gen" element={<ImageGen />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="audit" element={<Navigate to="/audit/content" replace />} />
              <Route path="audit/content" element={<ContentAuditList />} />
              <Route path="audit/reports" element={<ReportAuditList />} />

              <Route path="products" element={<ProductsList />} />
              <Route path="templates" element={<TemplatesList />} />
              <Route path="pending-orders" element={<PendingOrdersList />} />
              <Route path="recommend" element={<RecommendPage />} />
              <Route path="attribution" element={<AttributionPage />} />

              <Route path="admin-users" element={<AdminUsersList />}>
                <Route path="new" element={<AdminUserForm />} />
                <Route path=":id/edit" element={<AdminUserForm />} />
              </Route>
              <Route path="roles" element={<RolesList />} />
              <Route path="menus" element={<MenusList />} />
              <Route path="api-logs" element={<ApiLogsPage />} />
              <Route path="msg-strategy" element={<Navigate to="/msg-strategy/globals" replace />} />
              <Route path="msg-strategy/center" element={<StrategyCenterPage />} />
              <Route path="strategy-center" element={<StrategyCenterPage />} />
              <Route path="msg-strategy/globals" element={<MsgStrategyGlobalsList />} />
              <Route path="msg-strategy/rules" element={<MsgStrategyRulesList />} />
              <Route path="msg-strategy/library" element={<MsgStrategyLibraryList />} />
              <Route path="companion-strategies" element={<CompanionStrategiesList />} />
              <Route path="quick-reply" element={<QuickReplyPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
