# 增长归因 & 产品埋点 — 后端接口字段说明

> 客户端：`utils/growthAttribution.js`  
> 产品埋点：`utils/firebaseProductAnalytics.js`  
> 投放参数详解见：[attribution-campaign-params.md](./attribution-campaign-params.md)

---

## 1. 接口概览

| 项目 | 说明 |
|------|------|
| **URL** | `POST /api/growth/attribution` |
| **Content-Type** | `application/json` |
| **鉴权** | 已登录时带 `x-token`（`getAuthHeaders()`）；未登录也可上报 `install` |
| **幂等** | `install` 客户端本地幂等（`growth_install_sent`）；其余事件每次触发都会 POST |
| **与 Firebase 关系** | **并行双写**，后端不替代 Firebase / Google Ads 自动归因 |

成功响应（客户端判定）：

- HTTP 2xx
- body `code === 200`（若存在 `code` 字段）
- body `ok !== false`

---

## 2. 请求 Header（与 Body 互补）

除 JSON Body 外，所有请求还会携带全局 Header（`utils/device.js` → `getClientHeaders()`）：

| Header | 说明 |
|--------|------|
| `X-Device-Id` / `x-device-id` | 设备唯一 ID（**必填**，无则客户端不上报） |
| `X-App-Version` | App 版本 |
| `X-OS` | `ios` / `android` / `web` |
| `X-OS-Version` | 系统版本 |
| `X-Device-Model` | 设备型号 |
| `X-Timezone` / `x-timezone` | IANA 时区，如 `Asia/Shanghai` |
| `X-Storefront-Country` | App Store / Play 商店国家（有缓存时） |
| `Accept-Language` | UI 语言 |
| `x-token` | 登录态 Token（有则带） |

---

## 3. Body 公共字段（所有 event_type）

`reportAttribution()` 会自动合并以下环境字段（与 Header 信息一致，Body 内也有一份便于落库）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `device_id` | string | ✅ | 同 `X-Device-Id` |
| `event_type` | string | ✅ | 见第 4 节 |
| `app_version` | string | | App 版本 |
| `os` | string | | `ios` / `android` / `web` |
| `os_version` | string | | 系统版本 |
| `device_model` | string | | 设备型号 |
| `locale` | string | | UI 语言 |
| `timezone` | string | | 时区 |
| `storefront_country` | string | | 商店国家 |
| `network` | string | | `wifi` / `cellular` / `unknown` |
| `app_env` | string | | `prod` / `test`（测试包 Firebase 事件带 `test_` 前缀） |

**空值规则**：客户端会省略 `null`、空字符串字段；后端应按「有值才解析」处理。

---

## 4. event_type 枚举

| event_type | 触发时机 | 客户端入口 |
|------------|----------|------------|
| `install` | 首次冷启动（幂等） | `runGrowthAttributionOnLaunch()` |
| `register` | 邮箱注册成功 | `trackAttributionRegister()` |
| `login` | 社交/邮箱登录成功 | `trackAttributionLogin()` |
| `purchase` | IAP 验单成功 | `trackAttributionPurchase()` |
| **`product`** | **25 个产品行为埋点** | `reportProductAnalytics()` / `trackProductEvent()` |

---

## 5. 投放归因字段（全事件共用）

以下字段在 **install / register / login / purchase / product** 中均可能出现（有缓存才传）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `gclid` | string | Google 点击 ID |
| `utm_source` | string | 来源 |
| `utm_medium` | string | 媒介 |
| `utm_campaign` | string | 活动 |
| `utm_content` | string | 素材 |
| `utm_term` | string | 关键词 |

**落库建议**：

1. **优先读 Body 顶层** `gclid` / `utm_*`
2. 若顶层无 `gclid`，读 `raw_payload.gclid`（客户端双写兜底）
3. 再读 `firebase_event_params.gclid`

数据来源：Android Install Referrer、深链启动参数、本地缓存 `growth_pending_attribution`。

---

## 6. Firebase 参数副本（全事件共用）

客户端在每个事件的 Body 中附带与 GA4 `logEvent` **完全一致** 的参数副本：

| 字段 | 类型 | 说明 |
|------|------|------|
| `firebase_event_name` | string | Firebase 实际事件名（测试环境为 `test_` + 原名） |
| `firebase_event_params` | object | 参数字典，**值均为 string** |

### 6.1 firebase_event_params 常见键

| 键 | 适用事件 | 说明 |
|----|----------|------|
| `device` | 全部 | 如 `ios/iPhone15,2`、`android/Pixel 7` |
| `uid` | 登录后事件 | 用户 ID（本地 `user_info`） |
| `method` | login / register | `google` / `apple` / `email` |
| `product` | purchase | VIP 套餐 key 或积分数 |
| `gclid` + `utm_*` | 全部 | 投放归因 |
| `page` | product | 页面标识，如 `home`、`login`、`discover` |
| `tab` | product | Tab 标识，如 `moments`、`companions` |
| `source` | product | 入口来源，如 `menu`、`strip`、`moments` |
| `scene` | product | 漏斗场景，如 `agent_create`、`free_message` |
| `target_id` | product | 目标 ID（动态 ID、路由 path 等；部分事件历史上也写过伴侣 ID） |
| `companion_id` | product | **智能体/伴侣 ID**（能拿到时必带；与 `target_id` 可同时存在） |
| `launch_type` | product | `app_launch` 专用：`cold` / `hot` |
| `remaining` | product | free 剩余次数（`dree_message_5`=`5`；`dree_message_3`=`0`） |
| `used` | product | 兼容字段；与触发时的 remaining 一致（`5` / `0`） |

---

## 7. 各 event_type 专有字段

### 7.1 install

| 字段 | 类型 | 说明 |
|------|------|------|
| `install_source` | string | `organic` / `ads` / `invite` |
| `attribution_provider` | string | `organic` / `play_referrer` / `manual` / `invite` |
| `ad_id` | string | GAID（Android）或 IDFA（iOS，若可用） |
| `ad_id_type` | string | `gaid` / `idfa` / `none` |
| `idfv` | string | iOS IDFV |
| `android_id` | string | Android ID |
| `invite_code` | string | 邀请码 |
| `referrer_user_id` | number | 邀请人用户 ID |
| `raw_payload` | object | 见下 |
| `firebase_event_name` | string | 固定 `install_attribution` |

`raw_payload` 示例：

```json
{
  "play_referrer": "utm_source=google&utm_medium=cpc&gclid=EAIa...",
  "gclid": "EAIa...",
  "utm_source": "google",
  "utm_medium": "cpc"
}
```

---

### 7.2 register

| 字段 | 类型 | 说明 |
|------|------|------|
| `login_method` | string | 固定 `email`（当前实现） |
| `invite_code` | string | |
| `referrer_user_id` | number | |
| `install_source` | string | |
| `attribution_provider` | string | |
| `firebase_event_name` | string | `register_success` |
| `firebase_event_params` | object | `{ device, uid, method, gclid?, utm_*? }` |

---

### 7.3 login

| 字段 | 类型 | 说明 |
|------|------|------|
| `login_method` | string | `google` / `apple` / `email` |
| `install_source` | string | |
| `attribution_provider` | string | |
| `firebase_event_name` | string | `login` |
| `firebase_event_params` | object | `{ device, uid, method, gclid?, utm_*? }` |

---

### 7.4 purchase

| 字段 | 类型 | 说明 |
|------|------|------|
| `raw_payload` | object | 见下 |
| `firebase_event_name` | string | `purchase_success` |
| `firebase_event_params` | object | `{ device, uid, method, product, gclid?, utm_*? }` |

`raw_payload` 字段：

| 键 | 类型 | 说明 |
|----|------|------|
| `product_id` | string | 商品标识 |
| `purchase_type` | string | `vip` / `points` |
| `revenue_usd` | number | 预留，当前客户端未必传 |
| `store` | string | `apple` / `google` |
| `gclid` + `utm_*` | string | 投放归因（双写） |

`firebase_event_params.method` = `vip` 或 `points`（与 `purchase_type` 对应）。

---

### 7.5 product（新增）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `product_event` | string | ✅ | 产品事件英文名（与 Firebase 事件名相同） |
| `firebase_event_name` | string | ✅ | 同 `product_event` |
| `firebase_event_params` | object | ✅ | 完整事件参数 |
| `gclid` + `utm_*` | string | | 顶层投放字段（有则传） |
| `raw_payload` | object | | 含 `gclid` + `utm_*` 兜底 |

**后端解析建议**：

```text
事件名     = product_event  （或 firebase_event_name）
业务参数   = firebase_event_params
投放归因   = 顶层 gclid/utm_* → raw_payload → firebase_event_params
用户 ID    = firebase_event_params.uid（登录后才有）
设备       = device_id（Body）+ firebase_event_params.device
```

---

## 8. 25 个 product_event 清单

| # | product_event | 中文 | 上报规则 | firebase_event_params 常见字段 |
|---|---------------|------|----------|--------------------------------|
| 1 | `app_launch` | 启动 APP | 每次冷/热启动 | `launch_type`: `cold` / `hot` |
| 2 | `login_page_show` | 登录页展示 | 登录页 onShow | `page`: `login` |
| 3 | `account_login_click` | 账户登录点击 | 点击账号密码登录 | `page`: `login` |
| 4 | `google_login_click` | Google 登录点击 | 点击 Google 登录 | `page`: `login` |
| 5 | `apple_login_click` | Apple 登录点击 | 点击 Apple 登录 | `page`: `login` |
| 6 | `newbie_guide_show` | 新手引导展示 | 引导页展示 | `page`: `onboarding` 或 `register_step` |
| 7 | `home_page_show` | 首页展示成功 | 首页加载成功 | `page`: `home` |
| 8 | `send_message_icon_click` | 发消息 icon 点击 | 点击发消息 | `page`, `source`, `target_id`, `companion_id` |
| 9 | `home_robot_tab_click` | 首页机器人 Tab | 切到机器人 Tab | `page`: `home`, `tab`: `companions` |
| 10 | `moments_comment_click` | 朋友圈评论点击 | 点击评论 | `page`, `target_id`（动态 ID）, `companion_id` |
| 11 | `pull_refresh_report` | 下拉刷新 | 下拉刷新成功 | `page`, `tab` |
| 12 | `pull_up_load_report` | 上滑加载 | 触底加载成功 | `page`, `tab` |
| 13 | `message_page_click` | 消息 Tab 点击 | 底栏进消息 | `page`: `tab_bar`, `target_id`: 路由 |
| 14 | `chat_detail_click` | 进对话详情 | 消息列表点会话 | `page`: `messages`, `target_id` / `companion_id`: 伴侣 ID |
| 15 | `community_page_click` | 社区 Tab 点击 | 底栏进发现 | `page`: `tab_bar`, `target_id`: 路由 |
| 16 | `mine_page_click` | 我的 Tab 点击 | 底栏进我的 | `page`: `tab_bar`, `target_id`: 路由 |
| 17 | `agent_create_click` | 创建智能体入口 | 点击创建入口 | `page`, `source` |
| 18 | `agent_create_pay_popup` | 创建触发付费弹窗 | 创建页弹出充值 | `scene`: `agent_create` |
| 19 | `free_message_pay_popup` | 免费消息用尽弹窗 | 聊天页弹出充值 | `scene`: `free_message`, `companion_id` |
| 20 | `agent_create_button_click` | 创建智能体成功 | 创建接口成功拿到 companion id 后上报（非点击时） | `page`: `create`, `target_id` / `companion_id` |
| 21 | `moments_detail_click` | 朋友圈详情 | 进动态详情 | `page`, `target_id`（动态 ID）, `companion_id` |
| 22 | `avatar_profile_click` | 点头像进 profile | 点头像 | `page`, `target_id`, `companion_id` |
| 23 | `robot_list_click` | 进机器人列表 | 进列表页/Tab | `page`, `tab` |
| 24 | `robot_list_pull_up` | 机器人列表上滑 | 列表触底加载更多成功时上报 | `page`, `tab` |
| 25 | `robot_list_pull_refresh` | 机器人列表下拉刷新 | 列表刷新成功 | `page`, `tab` |
| 26 | `Registration_finish` | 注册引导填全完成 | 注册成功且四项资料齐全；本地最多一次 | `page`: `register_step` |
| 27 | `registration_skip` | 注册引导未填全 | 注册成功但资料缺项；本地最多一次 | `page`: `register_step` |
| 28 | `avatar_upload` | 用户头像上传成功 | 「我的」页上传头像成功 | `page`: `profile` |
| 29 | `profile_displayed_15s` | Profile idle≥15s | 智能体详情 about 页无操作满 15s；每次进入可再报 | `target_id`, `companion_id` |
| 30 | `Moment_15s` | Moment Tab idle≥15s | 切到 moments 后无操作满 15s | `target_id`, `companion_id`, `tab` |
| 31 | `send_message_click_moment` | 朋友圈发消息按钮 | 朋友圈卡片右上角发消息 | `page`, `source`, `target_id`（动态 ID）, `companion_id` |
| 32 | `send_message_click_im` | IM 发消息按钮 | 聊天页发送（同时再打 `send_message_icon_click`） | `page`: `chat`, `companion_id` |
| 33 | `no_data_of_im` | IM 无未读 | 当日首次进消息 Tab 且 totalUnread=0 | `page`: `messages` |
| 34 | `dree_message_5` | free message remaining=5 | ws 下发 `free_turn_used` 时 `remaining === 5`；本地 once key 去重后报一次 | `used`/`remaining`=`5`, `companion_id` |
| 35 | `dree_message_3` | free message remaining=0 | ws 下发 `free_turn_used` 时 `remaining === 0`（免费次数用尽）；本地 once key 去重后报一次 | `used`/`remaining`=`0`, `companion_id` |
| 36 | `dree_message_0` | 在线 180s 未发消息 | **App 前台在线累计**满 180s，且未点过聊天页发送按钮（也未用过 free）；报一次；点发送/用 free 取消；退出登录清零；切后台暂停 | `home_sec` |

### 8.1 page / source / tab 取值参考

| 字段 | 常见值 | 含义 |
|------|--------|------|
| `page` | `home` / `login` / `discover` / `messages` / `create` / `tab_bar` / `my_companions` / `onboarding` / `register_step` | 页面 |
| `tab` | `moments` / `companions` / `posts` | 页内 Tab |
| `source` | `strip` / `menu` / `moments` / `companions_tab` | 点击入口 |
| `scene` | `agent_create` / `free_message` | 付费弹窗漏斗 |
| `target_id` | 伴侣 ID、动态 ID、Tab 路由 path | 业务对象 |
| `companion_id` | 智能体 UUID / 数字 ID | 能拿到智能体时单独带上 |
| `launch_type` | `cold` / `hot` | 启动类型 |

---

## 9. 请求示例

### 9.1 产品事件 — 冷启动

```json
{
  "device_id": "abc-123-def",
  "event_type": "product",
  "product_event": "app_launch",
  "app_version": "1.0.0",
  "os": "android",
  "os_version": "14",
  "device_model": "Pixel 7",
  "locale": "zh",
  "timezone": "Asia/Shanghai",
  "network": "wifi",
  "gclid": "EAIaIQobChMI...",
  "utm_source": "google",
  "utm_medium": "cpc",
  "firebase_event_name": "app_launch",
  "firebase_event_params": {
    "device": "android/Pixel 7",
    "launch_type": "cold",
    "gclid": "EAIaIQobChMI...",
    "utm_source": "google",
    "utm_medium": "cpc"
  },
  "raw_payload": {
    "gclid": "EAIaIQobChMI...",
    "utm_source": "google",
    "utm_medium": "cpc"
  }
}
```

### 9.2 产品事件 — 登录后点击发消息

```json
{
  "device_id": "abc-123-def",
  "event_type": "product",
  "product_event": "send_message_icon_click",
  "firebase_event_name": "send_message_icon_click",
  "firebase_event_params": {
    "device": "ios/iPhone15,2",
    "uid": "10086",
    "page": "home",
    "source": "moments",
    "target_id": "companion_uuid_xxx"
  }
}
```

### 9.3 转化事件 — 登录成功

```json
{
  "device_id": "abc-123-def",
  "event_type": "login",
  "login_method": "google",
  "install_source": "ads",
  "attribution_provider": "play_referrer",
  "gclid": "EAIaIQobChMI...",
  "utm_source": "google",
  "firebase_event_name": "login",
  "firebase_event_params": {
    "device": "android/Pixel 7",
    "uid": "10086",
    "method": "google",
    "gclid": "EAIaIQobChMI...",
    "utm_source": "google"
  },
  "raw_payload": {
    "gclid": "EAIaIQobChMI...",
    "utm_source": "google"
  }
}
```

### 9.4 产品事件 — 创建智能体付费弹窗

```json
{
  "device_id": "abc-123-def",
  "event_type": "product",
  "product_event": "agent_create_pay_popup",
  "firebase_event_name": "agent_create_pay_popup",
  "firebase_event_params": {
    "device": "ios/iPhone15,2",
    "uid": "10086",
    "scene": "agent_create"
  }
}
```

---

## 10. 后端 Schema 建议

### 10.1 最小必收字段

| 层级 | 字段 |
|------|------|
| 主表 | `device_id`, `event_type`, `created_at`（服务端） |
| product 专用 | `product_event` |
| 转化专用 | `login_method` / purchase 相关 |
| 归因 | `gclid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` |
| 镜像 | `firebase_event_name`, `firebase_event_params`（JSON） |

### 10.2 索引建议

- `(device_id, event_type, created_at)`
- `(product_event, created_at)` where `event_type = 'product'`
- `(gclid)` where not null
- `(firebase_event_params->>'uid')` 或单独冗余 `uid` 列

### 10.3 与 Firebase 对账

同一用户行为在 GA4 与后端各有一条记录时：

| 后端 | GA4 |
|------|-----|
| `product_event` | Event name |
| `firebase_event_params` | Event parameters |
| `device_id` | User pseudo ID 无法直接对齐，建议用 `uid` 或 `device_id` 自建映射 |

---

## 11. 调试

客户端成功日志：

```text
[growthAttribution] report ok product { ... }
[trands-firebase-analytics] logEvent ok: app_launch
```

本地缓存 key：`growth_pending_attribution`（投放参数）、`growth_install_sent`（install 是否已发）。

---

## 12. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-24 | 新增 `event_type: product` 及 25 个 `product_event`；全事件携带 `firebase_event_*` 与 `gclid`/utm 双写 |
