# 测试环境与 Firebase 事件名前缀（方案 A）

## 规则

| 项 | 说明 |
|----|------|
| 开关 | **`VITE_APP_ENV=test` 或 `prod`**（决定后端 `app_env` + Firebase `test_` 前缀） |
| API | `VITE_API_BASE_URL` **只**决定请求打到哪台后端，**不**改 `app_env` |
| 代码 | `utils/env.js` → `getAppEnv()` / `isTestEnv()` / `resolveFirebaseEventName()` |
| Firebase | **仅事件名**加 `test_`，业务代码仍写原名 |
| 后端 | `event_type`：`install` 或 `product`；`product_event` **不加**前缀（由 `firebase_event_name` 去掉 `test_`）；Body 带 `app_env`；`firebase_event_name` 与 Firebase 一致（测试带 `test_`） |

改 `.env` 后必须**重新编译/运行**（热更新不够）；打 AAB 也要重新云打包。启动日志：`[env] app_env=test ...`。

示例：

| 业务事件名 | 测试环境 Firebase | 生产 Firebase |
|------------|-------------------|---------------|
| `login` | `test_login` | `login` |
| `app_launch` | `test_app_launch` | `app_launch` |
| `purchase_success` | `test_purchase_success` | `purchase_success` |

## 配置文件

| 文件 | 用途 |
|------|------|
| `.env.example` | 字段说明 |
| `.env.test` | 测试模板（占位 API：`https://test.trandsai.com`） |

## 如何打测试包

1. 将 `.env.test` 复制为 `.env` 或 `.env.local`（HBuilderX 常用直接改 `.env`）
2. **重新编译**（环境变量编译期注入，热更新不够）
3. 启动后日志应有：`[FirebaseAnalytics] test env: event names prefixed with test_`
4. DebugView 事件名为 `test_*`

正式测试域名就绪后：只改 `.env.test` 里的 `VITE_API_BASE_URL` / `VITE_WS_URL` 即可。

## 生产包注意

发布前确认 `VITE_APP_ENV=prod`（或不设置），且 API 指向生产域名，避免测试前缀污染正式转化。
