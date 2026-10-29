# 产品埋点触发说明

本文对照前端 `PRODUCT_EVENTS`（`utils/firebaseProductAnalytics.js`）。  
上报方式：`trackProductEvent` **双写** Firebase Analytics + 后端 `/api/growth/attribution`（`event_type=product`，统计字段 `product_event`）。

仓库里 **没有** `chat_seed` 产品事件。

---

## 1. 易混：发消息相关

| 事件 | 会不会在「进聊天页」打 | 会不会在「聊天页点发送」打 |
|------|------------------------|----------------------------|
| `send_message_icon_click` | **会**（多个入口） | **否** |
| `send_message_click_moment` | 首页朋友圈 / 机器人 Tab **Say Hi** | 否 |
| `send_message_click_im` | 否 | **会** |

聊天页点发送时只打 `send_message_click_im`。  
没积分也会打：埋点在真正发消息 / 弹充值窗 **之前**，只要点了发送且输入框有内容。

---

## 2. 按事件：在哪一页、点什么

### `app_launch` — 启动 App

- **冷启动**：`App.vue` `onLaunch`，`launch_type=cold`。
- **热启动**：App 进过后台再回前台，且后台停留 **≥ 3 秒**，`launch_type=hot`，带 `bg_ms`。

不是某个按钮。

---

### `login_page_show` — 登录页（login）展示

- **页面**：`pages/login/index`（登录首页，选登录方式）。
- **时机**：每次 `onShow`（含从账号密码页返回）。

---

### `account_login_click` — 账号密码登录入口

- **页面**：登录首页 `pages/login/index`。
- **按钮**：账号密码登录（跳转 `pages/login/account`）。
- **说明**：点一下就报，**不管后面有没有登录成功**。账号密码表单页本身不再打这条。

---

### `google_login_click` — Google 登录

- **页面**：登录首页。
- **按钮**：Google 登录（仅非 H5、Android 展示）。
- **时机**：点击时立刻报，不看登录成败。

---

### `apple_login_click` — Apple 登录

- **页面**：登录首页。
- **按钮**：Apple 登录（仅非 H5、iOS 展示）。
- **时机**：点击时立刻报，不看登录成败。

---

### `quick_login_click` / `quick_login_success` / `quick_login_fail` — 快速登录

- **页面**：登录首页 `pages/login/index`。
- **按钮**：快速登录（`login.quickLogin`）。
- 和全局 `login` 埋点分开：成功时仍会打全局 `login`（`method=guest`），另外再打 `quick_login_success`。

| 事件 | 时机 |
|------|------|
| `quick_login_click` | 点按钮立刻报，不看后续成败 |
| `quick_login_success` | `POST /api/auth/quick-login` 成功且本地会话写入完成 |
| `quick_login_fail` | 接口非成功 `reason=api_error`；请求异常或会话写入失败 `reason=exception`；请求未结束就离开登录页 `reason=cancel` |

参数：`page=login`；失败另带 `reason`。

---

### `newbie_guide_show` — 新手引导展示

两处都会打（参数 `page` 不同）：

| 页面 | 路由 | 时机 |
|------|------|------|
| 引导页 | `pages-sub/onboarding/index` | 每次 `onShow`，`page=onboarding` |
| 注册资料步 | `pages/register/step` | `onMounted`，`page=register_step` |

不是点某个按钮。

---

### `home_page_show` — 首页（home）展示成功

- **页面**：首页 `pages/home/index`（底栏第一个 Tab）。
- **时机**：首页数据就绪后打 **一次**（本次进入进程内 `homePageShownTracked`）。
- **条件**：已初始化；不是「还在 loading 且朋友圈/伴侣都空」；不是「朋友圈加载失败且列表空」。
- 会在 `onShow` 里再尝试一次（兜底）。

---

### `home_robot_tab_click` — 首页切到「机器人」Tab

- **页面**：首页 `pages/home/index`。
- **按钮**：顶栏第二个 Tab（文案 `discover.tabCompanions`，内部值 `companions`）。
- **条件**：从「朋友圈 moments」切到「机器人 companions」时打；**再点当前 Tab 不打**。切回朋友圈 **没有** 对应产品事件。

---

### `send_message_icon_click` — 发消息 / 进聊天（汇总）

同一事件名，多入口：

| 页面 | 用户操作 | `page` | `source` | `target_id` |
|------|----------|--------|----------|-------------|
| 首页 · 朋友圈 Tab | 动态卡片 **Say Hi / Message**（旧小飞机已隐藏） | `home` | `moments` | **动态 ID** |
| 首页 · 机器人 Tab | 伴侣卡片 **Say Hi / Message** | `home` | `companions_tab` | 伴侣 ID |
| 智能体详情 | 底栏 **发消息**；以及统计区「对话轮数」也会进聊天 | `companion` | `profile` | 伴侣 ID |
| 我的伴侣列表 | 列表行右侧 **💬 进聊天** | `my_companions` | `list` | 伴侣 ID |

聊天页输入栏发送 **不打** 这条（那边是 `send_message_click_im`）。

---

### `send_message_click_moment` — 首页 Say Hi（未打过招呼时）

- **页面**：首页 · 朋友圈 Tab / 机器人 Tab。
- **按钮**：动态卡片或机器人卡片 **Say Hi**（已打过招呼变 Message 后点 Message **不打**本事件，只打 `send_message_icon_click`）。
- **同时再打**：`send_message_icon_click`。
- 参数：`page=home`；朋友圈 `source=moments`、`target_id`=动态 ID；机器人 Tab `source=companions_tab`、`target_id`=伴侣 ID；另有 `companion_id`。
- 接口：机器人 Tab `POST /api/companions/{id}/say_hi`；朋友圈可 `POST /api/moments/{id}/say_hi`（文案由后台配置，写入聊天记录后进聊天页）。
- 响应以 HTTP 200 业务字段为准：`need_paywall=true` 时 Toast + 弹充值窗（`say_hi_pay_popup`），不进聊天。
- 日额用尽且未打招呼：弹确认「继续 Say Hi 将扣免费对话次数」。直接聊天不调接口进 IM；继续则 `POST /api/companions/{id}/say_hi?use_chat_free=true`。
- `say_hi_daily_remaining` 用于刷新今日免费剩余。

---

### `send_message_click_im` — 仅聊天页发送

- **页面**：聊天页 `pages/chat/index`。
- **按钮**：底部输入栏发送（纸飞机）；键盘 `@confirm` 同一套 `handleSend`。
- **不报**：输入为空、正在发送、伴侣已删、加载失败/无权限；也不再打 `send_message_icon_click`。
- **会报**：没积分 / 免费次数用尽（随后弹充值，另打 `free_message_pay_popup`）。

---

### `moments_comment_click` — 发送朋友圈评论

- **页面**：首页朋友圈卡片输入栏；动态详情页底部输入栏。
- **时机**：用户点发送 / 键盘确认，且文案非空、未在发送中。接口成败都报。
- **不报**：点评论图标进详情（那是 `moments_detail_click`）。
- 参数：`page`=`home` 或 `moment`，`target_id`=动态 ID，`companion_id`。

---

### `moments_detail_click` — 进动态详情

| 页面 | 操作 | `page` | `target_id` |
|------|------|--------|-------------|
| 首页朋友圈 | 点卡片正文/详情区域 | `home` | 动态 ID |
| 首页朋友圈 | 点卡片底部 **评论图标**（进详情，不发评） | `home` | 动态 ID |
| 智能体详情 · 朋友圈 Tab | 点该智能体的一条动态 | `companion` | 动态 ID |

进详情页 `pages-sub/moment/index`。同一入口只报一次（`openMoment`）。

---

### `avatar_profile_click` — 点头像进智能体资料

| 页面 | 操作 | `page` |
|------|------|--------|
| 首页朋友圈 | 动态卡片头像；顶部横滑条点某个伴侣头像 | `home` |
| 发现页 · 机器人 Tab | 点智能体进资料 | `discover` |
| 动态详情 | 顶栏头像/名称进资料 | `moment` |

进 `pages-sub/companion/index`。`target_id` 多为伴侣 ID；动态详情里 `target_id` 是 **动态 ID**，伴侣在 `companion_id`。

---

### `pull_refresh_report` — 下拉刷新（朋友圈 / 帖子）

刷新 **成功** 后打：

| 页面 | Tab | `page` / `tab` |
|------|-----|----------------|
| 首页 | 朋友圈 | `home` / `moments` |
| 发现页 | 帖子 | `discover` / `posts` |

首页机器人 Tab、发现页机器人 Tab 的下拉刷新走 **`robot_list_pull_refresh`**，不是这条。

---

### `pull_up_load_report` — 上滑加载更多（朋友圈 / 帖子）

触底加载 **成功** 后打：

| 页面 | Tab | `page` / `tab` |
|------|-----|----------------|
| 首页 | 朋友圈 | `home` / `moments` |
| 发现页 | 帖子 | `discover` / `posts` |

机器人列表上滑走 **`robot_list_pull_up`**。

---

### 底栏 Tab：`message_page_click` / `community_page_click` / `mine_page_click`

组件：自定义底栏 `components/AppTabBar.vue`。四个 Tab：首页 / 消息 / 发现 / 我的。

| 事件 | 按钮 | 目标页 | `page` | `target_id` |
|------|------|--------|--------|-------------|
| `message_page_click` | 底栏 **消息** | `pages/messages/index` | `tab_bar` | `/pages/messages/index` |
| `community_page_click` | 底栏 **发现** | `pages/discover/index` | `tab_bar` | `/pages/discover/index` |
| `mine_page_click` | 底栏 **我的** | `pages/profile/index` | `tab_bar` | `/pages/profile/index` |

- **从别的 Tab 点过去才打**；已经在当前 Tab 再点（回顶）**不打**。
- **点底栏「首页」没有对应 product 事件。**

---

### `chat_page_view` — IM 对话页展示

- **页面**：聊天页 `pages/chat/index`（App 为 nvue，H5 为 vue）。
- **时机**：进入后资料与历史加载成功，并且页面渲染完成（nvue 进页遮罩揭开；H5 在首屏 `nextTick`）打 **一次**。
- **不报**：无权限、资料加载失败。
- 参数：`page=chat`，`companion_id`。
- 从资料页返回不再打；重新进入聊天页会再打。

---

### Our Moments 私密相册

| 事件 | 触发时机 | 参数 |
|------|----------|------|
| `our_moments_entry_click` | 详情页点 Our Moments Tab/入口 | `page=companion`，`agent_id`，`companion_id` |
| `our_moments_view` | 相册 Tab 成功展示（已有缓存立刻打；首次等接口成功） | `page=companion`，`agent_id`，`companion_id`，`photo_count` |
| `our_moments_photo_unlock` | 聊天 WS `toast=unlocked`，每张照片首次解锁成功一次 | `page=chat`，`agent_id`，`companion_id`，`photo_id`，`photo_count` |
| `our_moments_photo_preview` | 点已解锁照片，大图预览成功打开 | `page=companion`，`agent_id`，`companion_id`，`photo_id`，`photo_count` |

- **不报**：接口失败未展示；锁定照片点击；关闭大图。

---

### `chat_detail_click` — 消息页点会话进聊天

- **页面**：消息页 `pages/messages/index`（底栏「消息」）。
- **操作**：会话列表里点某一条对话，进 `pages/chat/index`。
- 参数：`page=messages`，`target_id` / `companion_id` = 伴侣 ID。
- **不打** `send_message_icon_click`。

---

### `no_data_of_im` — 消息页当天首次且无未读

- **页面**：消息页 `pages/messages/index`。
- **时机**：`onShow` 拉完会话后；`chat.totalUnread === 0`；本地按自然日只报 **一次**。
- 不是按钮。

---

### `robot_list_click` — 进「机器人列表」

| 页面 | 操作 | 参数 |
|------|------|------|
| 消息页 | 右上角菜单 → **查看我的伴侣**（进 `pages-sub/my-companions`） | `page=messages`，`source=menu` |
| 发现页 | ~~顶栏切到机器人 Tab~~ **当前没有入口** | 见下 |

发现页 `pages/discover/index` 里帖子 / 机器人双 Tab 的切换 UI **已注释掉**，用户无法再点到「机器人 Tab」，因此 **`page=discover` 这条实际上打不出来**。  
`switchToCompanionsTab` 和埋点代码还在，只是模板里没有按钮。默认停留在帖子 Tab。

首页切机器人 Tab 用的是 `home_robot_tab_click`，不是这条。

---

### `robot_list_pull_up` — 机器人列表上滑加载成功

| 页面 | 列表 |
|------|------|
| 首页 · 机器人 Tab | 伴侣卡片列表 |
| 发现页 · 机器人 Tab | 智能体列表 |
| 我的伴侣页 | `pages-sub/my-companions/index` 列表触底 |

---

### `robot_list_pull_refresh` — 机器人列表下拉刷新成功

| 页面 |
|------|
| 首页 · 机器人 Tab |
| 发现页 · 机器人 Tab |

我的伴侣页 **没有** 这条刷新埋点。

---

### `agent_create_click` — 点「创建智能体」入口

点入口立刻报（会员拦截弹窗 **之前**），`enterCreateCompanion`：

| 页面 | 按钮 | `page` | `source` |
|------|------|--------|----------|
| 首页 · 朋友圈 | 顶部头像横滑条 **最左侧「创建」**（加号） | `home` | `strip` |
| 消息页 | 菜单 → **创建伴侣** | `messages` | `menu` |
| 我的（profile） | 菜单第一项 **创建伴侣** | `profile` | `menu` |
| 智能体详情 | **克隆** | `companion` | `clone` |

非会员会接着弹 VIP/充值（见下条）。编辑已有伴侣进创建页也会打（若传了 `page`）。

---

### `agent_create_pay_popup` — 创建场景弹出充值/会员窗

- **组件**：`AppRechargeModal` 打开，且 `analytics-scene=agent_create`。
- **出现位置**：
  - 首页 / 消息页 / 我的：非会员点创建后的 **会员拦截弹窗**
  - 智能体详情：克隆被拦时的同一弹窗
  - 创建页 `pages-sub/create/index`：积分不足 / 名额限制等 `openPayGate` 打开的充值窗
- 参数：`scene=agent_create`。
- **不是**聊天页没积分弹窗（那是 `free_message_pay_popup`）。

---

### `free_message_pay_popup` — 聊天发消息触发充值窗

- **页面**：聊天页。
- **时机**：充值弹窗打开，`analytics-scene=free_message`（WS `need_recharge` / `need_vip`）。
- 免费次数或积分用尽、或需要 VIP，都会弹窗；本事件在弹窗 **打开** 时打。

---

### `say_hi_pay_popup` — 首页 Say Hi 付费拦截窗

- **页面**：首页 · 朋友圈 Tab / 机器人 Tab。
- **时机**：`POST .../say_hi` 返回 HTTP 200 且 **`need_paywall === true`** 时打开 `AppRechargeModal`（`analytics-scene=say_hi`）。
- **不要**用 `say_hi_daily_remaining === 0` 或 HTTP 402/403 判断是否弹窗；日免费用完但仍可用聊天免费轮次/积分成功时，`need_paywall=false`，不弹。
- 打开前先 Toast 提示；弹窗打开时打本事件。
- 参数：`scene=say_hi`，`say_hi_daily_remaining`（今日剩余免费 Say Hi），`need_paywall=true`，`page=home`，`companion_id`。

---

### `paid_click` — 充值弹窗支付按钮点击

- **组件**：`AppRechargeModal` 底部「立即订阅 / 立即充值」。
- **时机**：点一下就报，**不看成败**（取消支付、缺商品 ID 也会打，只要按钮当时可点）。
- **不报**：加载商品中、支付进行中、按钮 disabled。
- 参数：`method`=`vip`|`points`；有场景时带 `scene`（`agent_create` / `free_message`）；`product` 为 VIP 套餐 key 或积分数。

---

### `agent_create_button_click` — 创建智能体 **成功**

- **页面**：创建页 `pages-sub/create/index`。
- **时机**：`POST /companions` 成功拿到 companion id **之后**（不是点提交那一瞬间）。
- 编辑模式不走这条上报逻辑（代码注释：非编辑创建成功）。
- 参数：`page=create`，`target_id` / `companion_id`。

---

### `Registration_finish` / `registration_skip` — 注册资料结果

- **页面**：注册资料步 `pages/register/step`（提交注册成功后）。
- **规则**：性别、想聊性别、目的、生日 **四项都有** → `Registration_finish`；缺任一项 → `registration_skip`。
- 各事件本地 **最多一次**（按用户 id 存标记）。
- 点「跳过」若已是最后一步，会走提交，仍按资料是否齐全分流，不是单独事件。

---

### `avatar_upload` — 用户头像上传成功

- **页面**：我的 `pages/profile/index`。
- **操作**：点自己头像选图，`PATCH /api/auth/me` 成功后。
- 失败不报。`page=profile`。

---

### `profile_displayed_15s` — 智能体资料 About 停留 15s

- **页面**：智能体详情 `pages-sub/companion/index`，Tab **About**。
- **时机**：无操作满 15 秒（滚动不算操作；点击、切 Tab 会重置）。每次进入可再报。

---

### `Moment_15s` — 智能体详情「朋友圈 Tab」停留 15s

- **页面**：智能体详情，切到 **moments** Tab 后 idle ≥ 15s。
- **不是**首页顶栏「朋友圈」Tab（首页没有这条）。
- 参数：`page=companion`，`tab=moments`。

---

### `dree_message_5` / `dree_message_3` — 免费消息剩余次数

- **不是按钮**。聊天 WS 下发 `free_turn_used`（进房快照 / 每次扣免费次数）。
- 用 `free_turns_limit`（总额）与 `free_turns_used`（已用）判断；剩余 = `max(0, limit - used)`。旧字段 `remaining` 仅兼容。
- `limit - used === 5` → `dree_message_5`（每用户本地一次）。
- `report_free_quota_reached === true` → `dree_message_3`（本轮刚打满配置的免费次数就报，不按账号只报一次）。进房快照 / 再次进入该字段为 false，不上报。

---

### `dree_message_0` — 在线 180 秒未发过聊天

- **不是按钮**。App **前台累计**满 180 秒，且从未用过免费消息、也未点过聊天页发送。
- 聊天页点发送或用过 free 会 **取消**；退出登录清零；切后台暂停。
- 参数：`home_sec`（累计秒数）。本地按用户一次。

---

### 举报：`Report_character_*`

弹窗：`AppReportCharacterPopup`。打开来源：

| 入口 | `source` | 操作 |
|------|----------|------|
| 智能体详情菜单举报 | `profile` | 打开弹窗 |
| 聊天：长按消息举报 / 菜单举报 | `chat` | 打开弹窗 |
| 首页朋友圈卡片举报 | `moments` | 打开弹窗 |
| 动态详情举报 | `moments` | 打开弹窗 |

| 事件 | 时机 |
|------|------|
| `Report_character_Click` | **弹窗打开**（不是点原因） |
| `Report_character_submit` | 点确认，接口成功 |
| `Report_character_success` | 与 submit **同时**再打一条 |
| `Report_character_reason_minor_Click` | 提交成功且原因为 `minor_safety` |
| `Report_character_reason_sensitive_Click` | 原因 `sensitive` |
| `Report_character_reason_disturbing_Click` | 原因 `disturbing` |
| `Report_character_reason_copyright_Click` | 原因 `copyright` |
| `Report_character_reason_other_Click` | 原因 `other` |

选中原因但未提交，**不会**打 reason 事件。

---

### 意见反馈：`feedback_entry_click`

- **入口**：Messages 列表置顶 Feedback 行（`pages/messages/index`）。
- **页面**：点击后进入 `pages-sub/feedback/index` 官方客服聊天。
- 公共参数：`uid` 等由公共参数补齐；另带 `page: messages`。

| 事件 | 时机 |
|------|------|
| `feedback_entry_click` | 用户点击 Feedback 入口进入聊天界面 |

旧表单页的 `feedback_page_view` / `feedback_submit_*` 已下线，不再上报。

---

## 3. 按页面速查

### 登录首页（login）`pages/login/index`

`login_page_show` · `account_login_click` · `google_login_click` · `apple_login_click` · `quick_login_click` · `quick_login_success` · `quick_login_fail`

### 注册资料（register_step）`pages/register/step`

`newbie_guide_show` · `Registration_finish` · `registration_skip`

### 引导（onboarding）`pages-sub/onboarding/index`

`newbie_guide_show`

### 首页（home）`pages/home/index`

- 展示：`home_page_show`
- 顶栏朋友圈 / 机器人：`home_robot_tab_click`（仅切到机器人）
- 横滑创建：`agent_create_click`（可能再 `agent_create_pay_popup`）
- 朋友圈卡片：Say Hi `send_message_click_moment` + `send_message_icon_click`；评论图标/点进详情 `moments_detail_click`；发出评论 `moments_comment_click`；头像 `avatar_profile_click`；下拉/上滑 `pull_refresh_report` / `pull_up_load_report`
- 机器人 Tab 卡片 Say Hi：`send_message_click_moment` + `send_message_icon_click`；已打招呼点 Message 只打 `send_message_icon_click`；列表刷新/加载 `robot_list_pull_refresh` / `robot_list_pull_up`
- 强制性别选择弹窗（`AppGenderSelectModal`，无确认按钮故不打 `gender_confirm_click`）：
  - 曝光：`gender_page_show`（`user_type=new|existing`；注册成功写 `new`，其余默认 `existing`）
  - 点选项：`gender_option_click`（`gender`）
  - 提交成功：`gender_submit_success`（`gender`）
  - 提交失败：`gender_submit_fail`（`error_code`）

### 消息页（messages）`pages/messages/index`

- 底栏点进来：`message_page_click`（在 TabBar，不在本页）
- 点会话：`chat_detail_click`
- 点置顶 Feedback 进客服聊天：`feedback_entry_click`
- 当天无未读：`no_data_of_im`
- 菜单创建：`agent_create_click`（可能 `agent_create_pay_popup`）
- 菜单我的伴侣：`robot_list_click`

### 聊天页（chat）`pages/chat/index`

- 进入并渲染完成：`chat_page_view`
- 发送：`send_message_click_im` + `send_message_icon_click`
- 付费窗：`free_message_pay_popup`
- 举报弹窗：`Report_character_*`
- WS：`dree_message_5` / `dree_message_3`
- Our Moments 解锁：`our_moments_photo_unlock`（每张首次）

### 发现页（discover）`pages/discover/index`

- 底栏点进来：`community_page_click`
- 帖子 Tab 下拉/上滑：`pull_refresh_report` / `pull_up_load_report`
- 顶栏机器人 Tab **已下线（UI 注释）**：`robot_list_click` / `robot_list_pull_refresh` / `robot_list_pull_up` / `avatar_profile_click`（discover）目前用户点不到
- 点帖子头像进智能体资料：当前发现页帖子卡头像 **没有** 绑 `avatar_profile_click`（该事件在发现页只挂在机器人列表上）

### 我的（profile）`pages/profile/index`

- 底栏点进来：`mine_page_click`
- 菜单创建伴侣：`agent_create_click`（可能 `agent_create_pay_popup`）
- 头像上传成功：`avatar_upload`
- 编辑资料保存且性别变化：`profile_gender_change`（`from_gender`、`to_gender`）

### 智能体详情（companion）`pages-sub/companion/index`

- 发消息：`send_message_icon_click`
- 克隆：`agent_create_click`
- 点动态：`moments_detail_click`
- Our Moments：`our_moments_entry_click` / `our_moments_view` / `our_moments_photo_preview`
- idle：`profile_displayed_15s` / `Moment_15s`
- 举报：`Report_character_*`

### 动态详情（moment）`pages-sub/moment/index`

- 发出评论：`moments_comment_click`
- 顶栏进资料：`avatar_profile_click`
- 举报：`Report_character_*`

### 创建智能体（create）`pages-sub/create/index`

- 创建成功：`agent_create_button_click`
- 付费窗：`agent_create_pay_popup`

### 我的伴侣列表（my_companions）`pages-sub/my-companions/index`

- 💬 进聊天：`send_message_icon_click`
- 上滑：`robot_list_pull_up`

### 意见反馈（feedback）Messages 置顶入口 → `pages-sub/feedback/index`

`feedback_entry_click`

### 全局

- `app_launch`、`dree_message_0`
- 充值弹窗底部支付：`paid_click`（`AppRechargeModal`）

---

## 4. 代码入口

| 定义 | `utils/firebaseProductAnalytics.js` |
| 辅助（once / idle / free / IM 空） | `utils/productAnalyticsHelpers.js` |
| 后端字段约定 | `docs/growth-attribution-backend-api.md` |
