# 投放归因参数说明（gclid / UTM）

> 完整后端接口字段（含 `event_type: product` 与 25 个产品埋点）见：[growth-attribution-backend-api.md](./growth-attribution-backend-api.md)

## 问题 1：gclid 发给后端 vs 前端直接上报

| 通道 | 能否前端直接做 | 作用 |
|------|----------------|------|
| **Firebase Analytics** | ✅ 可以 | `logEvent` 事件参数带 `gclid` + `utm_*`，供 GA4 / 与 Google Ads 关联后的自动归因 |
| **Google Ads 自动归因** | ✅ 主要依赖 Firebase + Play Install Referrer + Firebase↔Ads 关联 | **不是**把 gclid POST 给你们后端就能让 Ads 看到 |
| **后端 `/api/growth/attribution`** | ✅ 并行上报 | 自建归因、对账、兜底；与 Firebase 互不替代 |

**结论（你们选 Google Ads / Firebase 自动归因）：**

- **前端必须**把来源字段打进 **Firebase 事件**（本次已补）。
- **后端**仍建议接收相同字段，便于自建报表；后端暂时不改也能跑，但 install 后转化事件以前会丢参，现已补齐。
- gclid **不需要**后端再“代上报给 Google”；Google 侧看的是 Firebase SDK + 官方关联。

---

## 数据来源

| 字段 | Android 来源 | iOS 来源 |
|------|--------------|----------|
| `gclid` | Play Install Referrer 原始串 query | 深链 / 启动参数（若有） |
| `utm_*` | 同上 + 深链 `captureLaunchAttribution()` | 同上 |
| 持久化 key | `growth_pending_attribution`（localStorage） | 同左 |

Android：`getInstallReferrer()` → `parseReferrerParams()` → `savePendingAttribution()`  
iOS：Install Referrer 无；深链/Universal Link query 可写入 pending。

---

## 参数定义

| 参数 | 类型 | 说明 |
|------|------|------|
| `gclid` | string | Google 点击 ID；**后端需在 schema / 落库中显式收录此字段** |
| `utm_source` | string | 来源，如 `google` |
| `utm_medium` | string | 媒介，如 `cpc` |
| `utm_campaign` | string | 活动/系列名称 |
| `utm_content` | string | 素材/创意区分 |
| `utm_term` | string | 关键词（搜索广告） |

空值不传（JS `normalizeEventParams` / 后端 payload 均省略空串）。

---

## 代码落点

### 采集与缓存

- `utils/attributionNative.js` → `collectNativeAttributionSignals().play_referrer`
- `utils/growthAttribution.js`
  - `captureLaunchAttribution()` — 深链 gclid/utm
  - `runGrowthAttributionOnLaunch()` — 解析 referrer 并 **`savePendingAttribution`**
  - `getPendingCampaignAttribution()` — 供 Firebase 读取

### Firebase 事件（Google Ads / GA4）

- `utils/firebaseAnalytics.js`
  - `login` / `register_success` / `purchase_success` 均附带 `gclid` + `utm_*`
- `uni_modules/trands-firebase-analytics/utssdk/app-ios/index.uts` — `PARAM_KEYS` 已扩展
- Android `.uts` — 使用 `JSONObject` 解析，**无需改白名单**

### 后端归因

- `POST /api/growth/attribution`
- 事件类型：`install` | **`product`**（注册/登录/支付/产品行为都是 `product`；统计看 `product_event`）
- 以下事件均在 body 顶层携带（有值才传）：

```json
{
  "event_type": "product",
  "product_event": "register_success",
  "gclid": "EAIa...",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "brand_android",
  "utm_content": "creative_a",
  "utm_term": "ai chat",
  "device_id": "...",
  "login_method": "email"
}
```

`install` 额外字段：`play_referrer` 仍在 `raw_payload.play_referrer` 作原始串兜底。

各事件另带 **Firebase 参数副本**（与 GA4 `logEvent` 一致）：

| 字段 | 说明 |
|------|------|
| `firebase_event_name` | `register_success` / `login` / `purchase_success`；install 为 `install_attribution` |
| `firebase_event_params` | 与 Firebase 相同的参数字典（device、uid、method、product、gclid、utm_* 等） |

---

## Google Ads / Firebase 控制台侧（非代码）

1. Firebase 项目 ↔ Google Ads **已关联**
2. GA4 中将 `register_success`（及需要的 `purchase_success`）标记为 **转化**
3. Android 应用安装类广告依赖 **Play Store 安装 + Install Referrer**；侧载/测试包可能无 gclid
4. 自然安装 / 非广告点击安装：`gclid` 为空属正常

---

## 验证

1. 冷启动后查 storage：`growth_pending_attribution` 是否含 `gclid`/`utm_*`
2. 注册/支付日志：`logEvent ok: register_success` 且 GA4 Realtime 事件参数可见
3. 后端：`[growthAttribution] report ok register` 且 body 含 `gclid`

```bash
# Android DebugView（可选）
~/Library/Android/sdk/platform-tools/adb shell setprop debug.firebase.analytics.app com.gig.trandsai
```
