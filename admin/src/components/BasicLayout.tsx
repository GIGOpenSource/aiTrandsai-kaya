import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProLayout } from '@ant-design/pro-layout';
import {
  UserOutlined,
  CameraOutlined,
  FileTextOutlined,
  TeamOutlined,
  MessageOutlined,
  NotificationOutlined,
  BookOutlined,
  SettingOutlined,
  LogoutOutlined,
  PictureOutlined,
  BarChartOutlined,
  CommentOutlined,
  AuditOutlined,
  ShoppingOutlined,
  FilterOutlined,
  SafetyOutlined,
  KeyOutlined,
  MenuOutlined,
  AppstoreOutlined,
  SendOutlined,
  PayCircleOutlined,
  AudioMutedOutlined,
  SoundOutlined,
  UnorderedListOutlined,
  SmileOutlined,
  WarningOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { Button, Badge, Empty, Form, Input, Modal, Space, Spin, Tooltip, Typography } from 'antd';
import {
  adminFetch,
  adminFetchJson,
  clearToken,
  getAdminSession,
  getToken,
  showError,
  showSuccess,
} from '../api/request';
import { setAppLanguage, getAppLanguage } from '../locales';
import type { PaginatedResponse, VisibleMenuItem } from '../types';
import { useImUnread, SHOW_IM_MESSAGE_ALERTS } from '../pages/ChatSessions/ImUnreadContext';
import { useImLeaveGuard } from '../pages/ChatSessions/ImLeaveGuardContext';

type MenuDef = {
  path: string;
  key: string;
  icon?: ReactNode;
  label: string;
  children?: MenuDef[];
  sortOrder?: number;
};

type MenuNode = VisibleMenuItem & { children: MenuNode[] };

function normalizePath(path: string) {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

const PERMISSION_KEYS = new Set(['admin-users', 'roles', 'menus', 'api-logs']);
const PERMISSION_PATHS = new Set(['/admin-users', '/roles', '/menus', '/api-logs']);
const CONTENT_KEYS = new Set(['companions', 'moments', 'posts', 'say-hi']);
const CONTENT_PATHS = new Set(['/companions', '/moments', '/posts', '/say-hi']);
const AUDIT_KEYS = new Set(['audit-content', 'audit-reports']);
const AUDIT_PATHS = new Set(['/audit/content', '/audit/reports']);
const MSG_STRATEGY_KEYS = new Set([
  'msg-strategy-globals',
  'msg-strategy-rules',
  'msg-strategy-library',
  'companion-strategies',
  'strategy-center',
]);
const MSG_STRATEGY_PATHS = new Set([
  '/msg-strategy/globals',
  '/msg-strategy/rules',
  '/msg-strategy/library',
  '/companion-strategies',
  '/msg-strategy/center',
  '/strategy-center',
]);
const PAYMENT_KEYS = new Set(['products', 'templates', 'pending-orders']);
const PAYMENT_PATHS = new Set(['/products', '/templates', '/pending-orders']);
const GROUP_MENU_KEYS = new Set([
  'permission',
  'user-permissions',
  'content',
  'content-management',
  'audit',
  'content-audit',
  'msg-strategy',
  'message-strategy',
  'payment',
  'payment-management',
]);
const GROUP_MENU_PATHS = new Set([
  '/permission',
  '/user-permissions',
  '/content',
  '/content-management',
  '/audit',
  '/content-audit',
  '/msg-strategy',
  '/message-strategy',
  '/payment',
  '/payment-management',
]);
const PERMISSION_GROUP_KEYS = ['permission', 'user-permissions'];
const CONTENT_GROUP_KEYS = ['content', 'content-management'];
const AUDIT_GROUP_KEYS = ['audit', 'content-audit'];
const MSG_STRATEGY_GROUP_KEYS = ['msg-strategy', 'message-strategy'];
const PAYMENT_GROUP_KEYS = ['payment', 'payment-management'];

function isPermissionItem(item: { menu_key?: string; path?: string }) {
  const key = item.menu_key || '';
  const path = normalizePath(item.path || '');
  return PERMISSION_KEYS.has(key) || PERMISSION_PATHS.has(path);
}

function isContentItem(item: { menu_key?: string; path?: string }) {
  const key = item.menu_key || '';
  const path = normalizePath(item.path || '');
  return CONTENT_KEYS.has(key) || CONTENT_PATHS.has(path);
}

function isAuditItem(item: { menu_key?: string; path?: string }) {
  const key = item.menu_key || '';
  const path = normalizePath(item.path || '');
  return AUDIT_KEYS.has(key) || AUDIT_PATHS.has(path);
}

function isMsgStrategyItem(item: { menu_key?: string; path?: string }) {
  const key = item.menu_key || '';
  const path = normalizePath(item.path || '');
  return MSG_STRATEGY_KEYS.has(key) || MSG_STRATEGY_PATHS.has(path);
}

function isPaymentItem(item: { menu_key?: string; path?: string }) {
  const key = item.menu_key || '';
  const path = normalizePath(item.path || '');
  return PAYMENT_KEYS.has(key) || PAYMENT_PATHS.has(path);
}

function sortMenus<T extends { sort_order?: number; sortOrder?: number }>(a: T, b: T) {
  return (a.sort_order ?? a.sortOrder ?? 0) - (b.sort_order ?? b.sortOrder ?? 0);
}

function walkMenuItems(items: VisibleMenuItem[], visit: (item: VisibleMenuItem) => void) {
  items.forEach((item) => {
    visit(item);
    if (item.children?.length) walkMenuItems(item.children, visit);
  });
}

function buildMenuTree(items: VisibleMenuItem[]): MenuNode[] {
  const byKey = new Map<string, MenuNode>();
  const byId = new Map<string, MenuNode>();
  walkMenuItems(items, (item) => {
    if (!item.menu_key || byKey.has(item.menu_key)) return;
    const node: MenuNode = { ...item, children: [] };
    byKey.set(item.menu_key, node);
    if (item.id != null) byId.set(String(item.id), node);
  });

  const attached = new Set<string>();
  const attach = (childKey: string, parentKey: string) => {
    if (!childKey || !parentKey || childKey === parentKey || attached.has(childKey)) return;
    const child = byKey.get(childKey);
    const parent = byKey.get(parentKey) || byId.get(parentKey);
    if (!child || !parent) return;
    parent.children.push(child);
    attached.add(childKey);
  };

  walkMenuItems(items, (item) => {
    (item.children || []).forEach((child) => attach(child.menu_key, item.menu_key));
    const parentKey = String(item.parent_key ?? '').trim();
    if (parentKey) attach(item.menu_key, parentKey);
  });

  const roots = [...byKey.values()].filter((node) => !attached.has(node.menu_key));
  const sortTree = (nodes: MenuNode[]) => {
    nodes.sort(sortMenus);
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

function pullIntoParent(
  roots: MenuNode[],
  isChild: (item: { menu_key?: string; path?: string }) => boolean,
  parent: {
    key: string;
    label: string;
    aliases: string[];
    path: string;
    sortOrder: number;
    sortMode: 'min' | 'max';
  },
): MenuNode[] {
  const pulled: MenuNode[] = [];

  const takeChildren = (nodes: MenuNode[]): MenuNode[] => {
    const kept: MenuNode[] = [];
    nodes.forEach((node) => {
      if (isChild(node)) {
        pulled.push({ ...node, children: [] });
        return;
      }
      kept.push({ ...node, children: takeChildren(node.children) });
    });
    return kept;
  };

  const rest = takeChildren(roots);
  const usable = rest.filter((n) => n.children.length > 0 || Boolean(normalizePath(n.path || '')));
  if (!pulled.length) return usable;

  const existingParent = usable.find(
    (n) =>
      n.menu_key === parent.key ||
      parent.aliases.includes(n.menu_key) ||
      n.menu_name === parent.label ||
      parent.aliases.includes(n.menu_name || ''),
  );
  if (existingParent) {
    const seen = new Set(existingParent.children.map((child) => child.menu_key));
    pulled.forEach((child) => {
      if (seen.has(child.menu_key)) return;
      existingParent.children.push(child);
      seen.add(child.menu_key);
    });
    existingParent.children.sort(sortMenus);
    existingParent.menu_name = parent.label;
    return usable;
  }

  const childOrders = pulled.map((p) => p.sort_order ?? parent.sortOrder);
  const sortOrder =
    parent.sortMode === 'max' ? Math.max(...childOrders, parent.sortOrder) : Math.min(...childOrders, parent.sortOrder);

  usable.push({
    menu_key: parent.key,
    menu_name: parent.label,
    path: parent.path,
    parent_key: '',
    sort_order: sortOrder,
    children: pulled.sort(sortMenus),
  });
  return usable.sort(sortMenus);
}

function toProRoute(item: MenuDef): Record<string, unknown> {
  const hasChildren = Boolean(item.children?.length);
  const nested = item.children?.map(toProRoute);
  return {
    path: hasChildren ? item.path || `/${item.key}` : item.path,
    name: item.label,
    icon: item.icon,
    locale: false,
    hideInBreadcrumb: hasChildren,
    children: nested,
    routes: nested,
  };
}

function collectLeafPaths(items: MenuDef[]): string[] {
  const paths: string[] = [];
  items.forEach((item) => {
    if (item.children?.length) {
      paths.push(...collectLeafPaths(item.children));
      return;
    }
    const path = normalizePath(item.path || '');
    if (path && path !== '/' && !GROUP_MENU_KEYS.has(item.key)) paths.push(path);
  });
  return paths;
}

function isPathAllowed(pathname: string, allowed: string[]) {
  return allowed.some(
    (path) =>
      pathname === path ||
      pathname.startsWith(`${path}/`) ||
      path.startsWith(`${pathname}/`),
  );
}

export default function BasicLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [lang, setLang] = useState<'zh' | 'en'>(getAppLanguage());
  const session = getAdminSession();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdForm] = Form.useForm();
  const [apiMenus, setApiMenus] = useState<VisibleMenuItem[] | null>(null);
  const [menusReady, setMenusReady] = useState(false);
  const { summary, muted, setMuted } = useImUnread();
  const { confirmNavigation } = useImLeaveGuard();
  const unreadTotal = summary.total_unread;

  const safeNavigate = useCallback(
    async (path: string) => {
      const ok = await confirmNavigation(path);
      if (ok) navigate(path);
    },
    [confirmNavigation, navigate],
  );

  useEffect(() => {
    if (!getToken()) {
      navigate('/login');
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetchJson<PaginatedResponse<VisibleMenuItem>>(
          '/api/admin/me/menus?page=1&page_size=200',
        );
        if (cancelled) return;
        const items = res?.results ?? [];
        if (session?.role_key === 'admin' && items.length === 0) {
          setApiMenus(null);
        } else {
          setApiMenus(items);
        }
      } catch {
        if (cancelled) return;
        setApiMenus(session?.role_key === 'admin' ? null : []);
      } finally {
        if (!cancelled) setMenusReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.role_key, lang]);

  const handleLangChange = (l: 'zh' | 'en') => {
    setLang(l);
    setAppLanguage(l);
  };

  const catalog = useMemo(() => {
    const items: MenuDef[] = [
      { path: '/companions', key: 'companions', icon: <UserOutlined />, label: t('nav.companions') },
      { path: '/moments', key: 'moments', icon: <CameraOutlined />, label: t('nav.moments') },
      { path: '/posts', key: 'posts', icon: <FileTextOutlined />, label: t('nav.posts') },
      { path: '/say-hi', key: 'say-hi', icon: <SmileOutlined />, label: t('nav.sayHi') },
      { path: '/users', key: 'users', icon: <TeamOutlined />, label: t('nav.users') },
      { path: '/chat-sessions', key: 'chat-sessions', icon: <CommentOutlined />, label: t('nav.chatSessions') },
      { path: '/feedback', key: 'feedback', icon: <MessageOutlined />, label: t('nav.feedback') },
      { path: '/notifications', key: 'notifications', icon: <NotificationOutlined />, label: t('nav.notifications') },
      { path: '/knowledge', key: 'knowledge', icon: <BookOutlined />, label: t('nav.knowledge') },
      { path: '/image-gen', key: 'image-gen', icon: <PictureOutlined />, label: t('nav.imageGen') },
      { path: '/analytics', key: 'analytics', icon: <BarChartOutlined />, label: t('nav.analytics') },
      { path: '/audit/content', key: 'audit-content', icon: <AuditOutlined />, label: t('nav.auditContent') },
      { path: '/audit/reports', key: 'audit-reports', icon: <WarningOutlined />, label: t('nav.auditReports') },
      { path: '/settings', key: 'settings', icon: <SettingOutlined />, label: t('nav.settings') },
      { path: '/chat-version-prompts', key: 'chat-version-prompts', icon: <TagOutlined />, label: t('nav.chatVersionPrompts') },
      { path: '/products', key: 'products', icon: <ShoppingOutlined />, label: t('nav.products') },
      { path: '/templates', key: 'templates', icon: <ShoppingOutlined />, label: t('nav.templates') },
      { path: '/pending-orders', key: 'pending-orders', icon: <PayCircleOutlined />, label: t('nav.pendingOrders') },
      { path: '/recommend', key: 'recommend', icon: <FilterOutlined />, label: t('nav.recommend') },
      { path: '/attribution', key: 'attribution', icon: <BarChartOutlined />, label: t('nav.attribution') || 'Attribution' },
      { path: '/admin-users', key: 'admin-users', icon: <SafetyOutlined />, label: t('nav.adminUsers') },
      { path: '/roles', key: 'roles', icon: <SafetyOutlined />, label: t('nav.roles') },
      { path: '/menus', key: 'menus', icon: <MenuOutlined />, label: t('nav.menus') },
      { path: '/api-logs', key: 'api-logs', icon: <UnorderedListOutlined />, label: t('nav.apiLogs') },
      { path: '/msg-strategy/center', key: 'strategy-center', icon: <SendOutlined />, label: t('nav.msgStrategyCenter') },
      { path: '/msg-strategy/globals', key: 'msg-strategy-globals', icon: <SendOutlined />, label: t('nav.msgStrategyGlobals') },
      { path: '/msg-strategy/rules', key: 'msg-strategy-rules', icon: <SendOutlined />, label: t('nav.msgStrategyRules') },
      { path: '/msg-strategy/library', key: 'msg-strategy-library', icon: <SendOutlined />, label: t('nav.msgStrategyLibrary') },
      { path: '/companion-strategies', key: 'companion-strategies', icon: <SendOutlined />, label: t('nav.companionStrategies') },
      { path: '/quick-reply', key: 'quick-reply', icon: <MessageOutlined />, label: t('nav.quickReply') },
    ];
    const byKey = new Map(items.map((item) => [item.key, item]));
    const byPath = new Map(items.map((item) => [normalizePath(item.path), item]));
    return { items, byKey, byPath };
  }, [t]);

  const contentChildren: MenuDef[] = useMemo(
    () => [
      { path: '/companions', key: 'companions', icon: <UserOutlined />, label: t('nav.companions') },
      { path: '/moments', key: 'moments', icon: <CameraOutlined />, label: t('nav.moments') },
      { path: '/posts', key: 'posts', icon: <FileTextOutlined />, label: t('nav.posts') },
      { path: '/say-hi', key: 'say-hi', icon: <SmileOutlined />, label: t('nav.sayHi') },
    ],
    [t],
  );

  const auditChildren: MenuDef[] = useMemo(
    () => [
      { path: '/audit/content', key: 'audit-content', icon: <AuditOutlined />, label: t('nav.auditContent') },
      { path: '/audit/reports', key: 'audit-reports', icon: <WarningOutlined />, label: t('nav.auditReports') },
    ],
    [t],
  );

  const permissionChildren: MenuDef[] = useMemo(
    () => [
      { path: '/admin-users', key: 'admin-users', icon: <SafetyOutlined />, label: t('nav.adminUsers') },
      { path: '/roles', key: 'roles', icon: <SafetyOutlined />, label: t('nav.roles') },
      { path: '/menus', key: 'menus', icon: <MenuOutlined />, label: t('nav.menus') },
      { path: '/api-logs', key: 'api-logs', icon: <UnorderedListOutlined />, label: t('nav.apiLogs') },
    ],
    [t],
  );

  const msgStrategyChildren: MenuDef[] = useMemo(
    () => [
      { path: '/msg-strategy/center', key: 'strategy-center', icon: <SendOutlined />, label: t('nav.msgStrategyCenter') },
      { path: '/msg-strategy/globals', key: 'msg-strategy-globals', icon: <SendOutlined />, label: t('nav.msgStrategyGlobals') },
      { path: '/msg-strategy/rules', key: 'msg-strategy-rules', icon: <SendOutlined />, label: t('nav.msgStrategyRules') },
      { path: '/msg-strategy/library', key: 'msg-strategy-library', icon: <SendOutlined />, label: t('nav.msgStrategyLibrary') },
      { path: '/companion-strategies', key: 'companion-strategies', icon: <SendOutlined />, label: t('nav.companionStrategies') },
    ],
    [t],
  );

  const paymentChildren: MenuDef[] = useMemo(
    () => [
      { path: '/products', key: 'products', icon: <ShoppingOutlined />, label: t('nav.products') },
      { path: '/templates', key: 'templates', icon: <ShoppingOutlined />, label: t('nav.templates') },
      { path: '/pending-orders', key: 'pending-orders', icon: <PayCircleOutlined />, label: t('nav.pendingOrders') },
    ],
    [t],
  );

  const defaultMenuItems: MenuDef[] = useMemo(() => {
    const leaves = catalog.items.filter(
      (item) =>
        !PERMISSION_KEYS.has(item.key) &&
        !CONTENT_KEYS.has(item.key) &&
        !AUDIT_KEYS.has(item.key) &&
        !MSG_STRATEGY_KEYS.has(item.key) &&
        !PAYMENT_KEYS.has(item.key),
    );
    return [
      {
        path: '/content',
        key: 'content',
        icon: <AppstoreOutlined />,
        label: t('nav.content'),
        children: contentChildren,
        sortOrder: 0,
      },
      {
        path: '/audit',
        key: 'audit',
        icon: <AuditOutlined />,
        label: t('nav.audit'),
        children: auditChildren,
        sortOrder: 5,
      },
      {
        path: '/msg-strategy',
        key: 'msg-strategy',
        icon: <SendOutlined />,
        label: t('nav.msgStrategy'),
        children: msgStrategyChildren,
        sortOrder: 10,
      },
      {
        path: '/payment',
        key: 'payment',
        icon: <PayCircleOutlined />,
        label: t('nav.payment'),
        children: paymentChildren,
        sortOrder: 20,
      },
      ...leaves,
      {
        path: '/permission',
        key: 'permission',
        icon: <SafetyOutlined />,
        label: t('nav.permission'),
        children: permissionChildren,
        sortOrder: 900,
      },
    ];
  }, [auditChildren, catalog.items, contentChildren, msgStrategyChildren, paymentChildren, permissionChildren, t]);

  const menuItems = useMemo(() => {
    if (!menusReady) return [];
    if (!apiMenus) return defaultMenuItems;
    if (apiMenus.length === 0) return [];

    const matchDef = (node: MenuNode): MenuDef | undefined =>
      catalog.byKey.get(node.menu_key) || catalog.byPath.get(normalizePath(node.path || ''));

    const toDef = (node: MenuNode): MenuDef => {
      const matched = matchDef(node);
      const children = node.children.map(toDef);
      const groupIcon =
        PERMISSION_GROUP_KEYS.includes(node.menu_key) ? <SafetyOutlined /> :
        CONTENT_GROUP_KEYS.includes(node.menu_key) ? <AppstoreOutlined /> :
        AUDIT_GROUP_KEYS.includes(node.menu_key) ? <AuditOutlined /> :
        MSG_STRATEGY_GROUP_KEYS.includes(node.menu_key) ? <SendOutlined /> :
        PAYMENT_GROUP_KEYS.includes(node.menu_key) ? <PayCircleOutlined /> :
        children.length ? <AppstoreOutlined /> :
        undefined;
      return {
        path: normalizePath(node.path || matched?.path || ''),
        key: matched?.key || node.menu_key || normalizePath(node.path || ''),
        icon: matched?.icon || groupIcon,
        label:
          ['chat-sessions', 'knowledge'].includes(matched?.key || '')
            ? matched?.label || node.menu_name || node.menu_key
            : node.menu_name || matched?.label || node.menu_key,
        children: children.length ? children : undefined,
        sortOrder: node.sort_order,
      };
    };

    const isKnown = (item: MenuDef) =>
      GROUP_MENU_KEYS.has(item.key) ||
      catalog.byKey.has(item.key) ||
      catalog.byPath.has(normalizePath(item.path));

    const prune = (items: MenuDef[]): MenuDef[] =>
      items
        .map((item) => {
          const children = item.children ? prune(item.children) : undefined;
          if (children?.length) {
            return { ...item, children, path: item.path || `/${item.key}` };
          }
          const path = item.path || catalog.byKey.get(item.key)?.path || '';
          if (isKnown(item) && path) return { ...item, path, children: undefined };
          return null;
        })
        .filter((item): item is MenuDef => Boolean(item));

    const grouped = pullIntoParent(
      pullIntoParent(
        pullIntoParent(
          pullIntoParent(
            pullIntoParent(buildMenuTree(apiMenus), isPermissionItem, {
              key: 'permission',
              label: t('nav.permission') as string,
              aliases: ['用户权限', '用户与权限', 'user-permissions'],
              path: '/permission',
              sortOrder: 900,
              sortMode: 'max',
            }),
            isContentItem,
            {
              key: 'content',
              label: t('nav.content') as string,
              aliases: ['内容管理', 'content-management'],
              path: '/content',
              sortOrder: 0,
              sortMode: 'min',
            },
          ),
          isAuditItem,
          {
            key: 'audit',
            label: t('nav.audit') as string,
            aliases: ['内容审核', 'content-audit'],
            path: '/audit',
            sortOrder: 5,
            sortMode: 'min',
          },
        ),
        isMsgStrategyItem,
        {
          key: 'msg-strategy',
          label: t('nav.msgStrategy') as string,
          aliases: ['消息策略', 'message-strategy'],
          path: '/msg-strategy',
          sortOrder: 10,
          sortMode: 'min',
        },
      ),
      isPaymentItem,
      {
        key: 'payment',
        label: t('nav.payment') as string,
        aliases: ['支付管理', 'payment-management'],
        path: '/payment',
        sortOrder: 20,
        sortMode: 'min',
      },
    );
    const converted = prune(grouped.map(toDef));

    const presentKeys = new Set<string>();
    const walkKeys = (items: MenuDef[]) => {
      items.forEach((item) => {
        presentKeys.add(item.key);
        if (item.children) walkKeys(item.children);
      });
    };
    walkKeys(converted);

    const attachMissing = (
      groupKeys: string[],
      children: MenuDef[],
      group: Omit<MenuDef, 'children'> & { children?: MenuDef[] },
    ) => {
      const missing = children.filter((item) => !presentKeys.has(item.key));
      if (!missing.length) return;
      const existing = converted.find((item) => groupKeys.includes(item.key));
      if (existing) {
        existing.children = [...(existing.children || []), ...missing];
      } else {
        converted.push({ ...group, children: missing });
      }
      missing.forEach((item) => presentKeys.add(item.key));
    };

    if (session?.role_key === 'admin') {
      attachMissing(CONTENT_GROUP_KEYS, contentChildren, {
        path: '/content',
        key: 'content',
        icon: <AppstoreOutlined />,
        label: t('nav.content'),
      });
      attachMissing(AUDIT_GROUP_KEYS, auditChildren, {
        path: '/audit',
        key: 'audit',
        icon: <AuditOutlined />,
        label: t('nav.audit'),
      });
      attachMissing(MSG_STRATEGY_GROUP_KEYS, msgStrategyChildren, {
        path: '/msg-strategy',
        key: 'msg-strategy',
        icon: <SendOutlined />,
        label: t('nav.msgStrategy'),
      });
      attachMissing(PERMISSION_GROUP_KEYS, permissionChildren, {
        path: '/permission',
        key: 'permission',
        icon: <SafetyOutlined />,
        label: t('nav.permission'),
      });
      attachMissing(PAYMENT_GROUP_KEYS, paymentChildren, {
        path: '/payment',
        key: 'payment',
        icon: <PayCircleOutlined />,
        label: t('nav.payment'),
      });
      const versionPrompt = catalog.byKey.get('chat-version-prompts');
      if (versionPrompt && !presentKeys.has('chat-version-prompts')) {
        converted.push(versionPrompt);
        presentKeys.add('chat-version-prompts');
      }
    } else {
      const apiKeys = new Set<string>();
      walkMenuItems(apiMenus, (item) => {
        if (item.menu_key) apiKeys.add(item.menu_key);
      });
      // 旧菜单只有 audit 时，仍挂上两个子页
      const auditAllowed =
        apiKeys.has('audit') ||
        apiKeys.has('content-audit') ||
        [...AUDIT_KEYS].some((k) => apiKeys.has(k));
      attachMissing(
        CONTENT_GROUP_KEYS,
        contentChildren.filter((item) => apiKeys.has(item.key)),
        {
          path: '/content',
          key: 'content',
          icon: <AppstoreOutlined />,
          label: t('nav.content'),
        },
      );
      attachMissing(
        AUDIT_GROUP_KEYS,
        auditAllowed ? auditChildren : auditChildren.filter((item) => apiKeys.has(item.key)),
        {
          path: '/audit',
          key: 'audit',
          icon: <AuditOutlined />,
          label: t('nav.audit'),
        },
      );
      attachMissing(
        PAYMENT_GROUP_KEYS,
        paymentChildren.filter((item) => apiKeys.has(item.key)),
        {
          path: '/payment',
          key: 'payment',
          icon: <PayCircleOutlined />,
          label: t('nav.payment'),
        },
      );
    }

    // 旧的单页 audit 叶子菜单收进分组，避免与分组同名重复
    const auditGroup = converted.find((item) => AUDIT_GROUP_KEYS.includes(item.key));
    if (auditGroup?.children?.length) {
      const orphanIdx = converted.findIndex(
        (item) => item.key === 'audit' && item !== auditGroup && !item.children?.length,
      );
      if (orphanIdx >= 0) converted.splice(orphanIdx, 1);
    }

    return converted;
  }, [apiMenus, auditChildren, catalog.byKey, catalog.byPath, contentChildren, defaultMenuItems, menusReady, msgStrategyChildren, paymentChildren, permissionChildren, session?.role_key, t]);

  const selectedKey = useMemo(() => {
    const flat: MenuDef[] = [];
    const walk = (items: MenuDef[]) => {
      items.forEach((item) => {
        if (item.children?.length) walk(item.children);
        else flat.push(item);
      });
    };
    walk(menuItems);
    const hit = flat.find(
      (item) =>
        item.path &&
        item.path !== '/' &&
        (location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)),
    );
    if (hit?.path) return hit.path;
    if (location.pathname === '/') return '/';
    return location.pathname;
  }, [location.pathname, menuItems]);

  const allowedPaths = useMemo(() => collectLeafPaths(menuItems), [menuItems]);
  const noPermission = menusReady && allowedPaths.length === 0;
  const homePath = allowedPaths.includes('/analytics') ? '/analytics' : allowedPaths[0] || '/';

  let pageContent: ReactNode;
  if (!menusReady) {
    pageContent = (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  } else if (noPermission) {
    pageContent = (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <Empty description={t('empty.noPermission')} />
      </div>
    );
  } else if (location.pathname === '/' || !isPathAllowed(location.pathname, allowedPaths)) {
    pageContent = <Navigate to={homePath} replace />;
  } else {
    pageContent = <Outlet />;
  }

  async function handleChangePassword() {
    const values = await pwdForm.validateFields();
    if (values.new_password !== values.confirm_password) {
      showError(t('password.mismatch') as string);
      return;
    }
    setPwdSaving(true);
    try {
      const res = await adminFetch('/api/admin/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_password: values.old_password,
          new_password: values.new_password,
        }),
      });
      const data = await res?.json().catch(() => null);
      if (res && res.ok && (data?.code === undefined || data.code === 200)) {
        showSuccess(t('password.success') as string);
        setPwdOpen(false);
        pwdForm.resetFields();
      } else {
        const msg = String(data?.message || '');
        if (/old|original|原密码/i.test(msg)) showError(t('password.wrongOld') as string);
        else if (/format|格式/i.test(msg)) showError(t('password.format') as string);
        else showError(msg || (t('password.failed') as string));
      }
    } catch {
      showError(t('password.failed') as string);
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <ProLayout
      title="trandsai"
      logo={false}
      layout="mix"
      fixSiderbar
      fixedHeader
      route={{
        path: '/',
        routes: menuItems.map(toProRoute),
      }}
      location={{ pathname: location.pathname }}
      menuItemRender={(item, dom) => {
        const hasChildren = Boolean(
          item.children?.length || (item as { routes?: unknown[] }).routes?.length,
        );
        const isGroup =
          hasChildren ||
          GROUP_MENU_KEYS.has(String(item.key || '')) ||
          GROUP_MENU_PATHS.has(item.path || '');
        if (isGroup) return <span>{dom}</span>;
        const isIm = item.path === '/chat-sessions' || item.key === 'chat-sessions';
        const node = isIm && SHOW_IM_MESSAGE_ALERTS ? (
          <Badge count={unreadTotal} size="small" offset={[6, 0]} overflowCount={99}>
            {dom}
          </Badge>
        ) : (
          dom
        );
        return (
          <a
            onClick={(e) => {
              e.preventDefault();
              void safeNavigate(item.path || '/');
            }}
          >
            {node}
          </a>
        );
      }}
      selectedKeys={[selectedKey]}
      actionsRender={() => [
        <Space key="actions">
          {SHOW_IM_MESSAGE_ALERTS ? (
          <Tooltip title={t('nav.chatSessions')}>
            <span
              role="button"
              tabIndex={0}
              style={{
                display: 'inline-flex',
                cursor: 'pointer',
                marginRight: unreadTotal > 99 ? 14 : unreadTotal > 9 ? 10 : unreadTotal > 0 ? 6 : 0,
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate('/chat-sessions');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate('/chat-sessions');
                }
              }}
            >
              <Badge count={unreadTotal} size="small" overflowCount={99} offset={[-6, 0]}>
                <Button size="small" icon={<CommentOutlined />} />
              </Badge>
            </span>
          </Tooltip>
          ) : null}
          {SHOW_IM_MESSAGE_ALERTS ? (
          <Tooltip title={muted ? t('im.alertOff') : t('im.alertOn')}>
            <Button
              size="small"
              icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (!next) showSuccess(t('im.alertPreview'));
              }}
            />
          </Tooltip>
          ) : null}
          <Typography.Text>{session?.nickname || session?.username || ''}</Typography.Text>
          <Button
            type={lang === 'zh' ? 'primary' : 'default'}
            size="small"
            onClick={() => handleLangChange('zh')}
          >
            中
          </Button>
          <Button
            type={lang === 'en' ? 'primary' : 'default'}
            size="small"
            onClick={() => handleLangChange('en')}
          >
            En
          </Button>
          <Button icon={<KeyOutlined />} size="small" onClick={() => setPwdOpen(true)}>
            {t('password.change')}
          </Button>
          <Button
            icon={<LogoutOutlined />}
            size="small"
            danger
            onClick={() => {
              clearToken();
              void safeNavigate('/login');
            }}
          >
            {t('logout')}
          </Button>
        </Space>,
      ]}
    >
      {pageContent}
      <Modal
        title={t('password.change')}
        open={pwdOpen}
        onCancel={() => setPwdOpen(false)}
        onOk={() => void handleChangePassword()}
        confirmLoading={pwdSaving}
        okText={t('btn.save')}
        cancelText={t('btn.cancel')}
        destroyOnHidden
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item
            name="old_password"
            label={t('password.old')}
            rules={[{ required: true, message: t('password.oldRequired') as string }]}
          >
            <Input.Password maxLength={40} />
          </Form.Item>
          <Form.Item
            name="new_password"
            label={t('password.new')}
            rules={[{ required: true, message: t('password.newRequired') as string }, { max: 40 }]}
          >
            <Input.Password maxLength={40} />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label={t('password.confirm')}
            rules={[{ required: true, message: t('password.confirmRequired') as string }]}
          >
            <Input.Password maxLength={40} />
          </Form.Item>
        </Form>
      </Modal>
    </ProLayout>
  );
}
