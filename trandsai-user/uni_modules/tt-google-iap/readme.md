# Google Play 谷歌内购支付（uni-app x / Billing 9）

插件 ID：`tt-google-iap`

面向 **uni-app x Android App** 的 Google Play 应用内购买插件，基于 Google Play Billing Library 9.1。

- 支持一次性商品、订阅、base plan 和 offer。
- 支持多商品购买、订阅替换、待处理购买和暂停订阅。
- 支持购买确认、消耗、恢复购买和进程中断后的补单。
- 支持 Billing 国家配置、应用内订阅消息和订阅管理入口。
- 提供 UTS 类型定义和可运行的 uni-app x 示例项目。

> 安全提示：购买回调不能作为发放权益的唯一依据。生产环境必须把 `purchaseToken` 发送到可信服务端，通过 Google Play Developer API 验证并幂等发放权益，再确认或消耗订单。

> **首发共建优惠：普通授权 9.9 元，源码授权 59.9 元。** 当前版本采用低价首发，希望尽早覆盖更多真实项目、设备和 Google Play 商品配置。欢迎反馈可复现的问题和改进建议，请勿公开完整 `purchaseToken` 或其他敏感信息。

## 目录

- [平台与环境要求](#平台与环境要求)
- [授权与首发优惠](#授权与首发优惠)
- [安装与打包](#安装与打包)
- [Play Console 配置](#play-console-配置)
- [快速开始](#快速开始)
- [购买流程说明](#购买流程说明)
- [一次性商品与订阅](#一次性商品与订阅)
- [订阅替换](#订阅替换)
- [恢复确认与消耗](#恢复确认与消耗)
- [核心 API](#核心-api)
- [数据结构](#数据结构)
- [错误码](#错误码)
- [常见问题](#常见问题)
- [服务端验证](#服务端验证)
- [示例项目](#示例项目)

## 平台与环境要求

| 项目 | 要求 |
| --- | --- |
| 应用框架 | uni-app x |
| 运行平台 | Android App |
| Android 版本 | Android 6.0（API 23）及以上 |
| Billing SDK | Google Play Billing Library 9.1.0 |
| 调试方式 | 自定义调试基座或云打包 |
| 设备环境 | 已安装可用的 Google Play Store，并登录 Google 账号 |

Web、iOS、小程序和鸿蒙平台不支持。标准调试基座不包含插件的原生依赖，不能用于测试本插件。

应用包名、签名和 Play Console 中的应用必须一致。测试账号还需要加入 License Testing，并从内部测试或封闭测试等 Play 测试轨道安装应用。

## 授权与首发优惠

当前首发价格：

| 授权类型 | 首发价 | 适合场景 |
| --- | ---: | --- |
| 普通授权 | 9.9 元 | 直接在项目中集成使用，不需要查看或修改插件实现 |
| 源码授权 | 59.9 元 | 需要审查、调试、定制或自行维护 Android UTS 实现 |

为了在早期尽快获得真实项目反馈，计划按插件稳定度和累计用户量逐步调整价格：

| 阶段 | 参考条件 | 普通授权 | 源码授权 |
| --- | --- | ---: | ---: |
| 首发共建期 | 前 30 位付费用户 | 9.9 元 | 59.9 元 |
| 功能验证期 | 31～100 位付费用户 | 19.9 元 | 99 元 |
| 稳定维护期 | 超过 100 位付费用户 | 39.9 元 | 199 元 |

价格梯队是当前计划，不代表插件市场会自动调价。阶段切换会结合用户反馈、问题修复情况和版本稳定度人工执行，实际价格及授权条款以插件市场下单页面为准。

早期用户反馈问题时，建议提供插件版本、HBuilderX 版本、Android 版本、Play Store 版本、商品类型、`errCode`、`billingResponseCode`、`subResponseCode` 和 `debugMessage`。请对账号标识、订单号和 purchase token 做脱敏处理。

## 安装与打包

1. 从插件市场将插件导入项目，确认目录为 `uni_modules/tt-google-iap`。
2. 插件会引入 Billing 9.1.0 原生依赖，通常不需要手动添加 Gradle 依赖或 Billing 权限，也不需要配置 API Key。
3. 在 HBuilderX 中制作自定义调试基座，或使用云打包生成 Android 安装包。
4. 使用与 Play Console 一致的包名和签名上传 AAB 到测试轨道。
5. 使用测试账号通过 Google Play 测试链接安装应用，不要直接侧载 APK 验证支付流程。

更新插件版本后，应重新制作自定义调试基座，否则运行的仍可能是旧版原生代码。

## Play Console 配置

1. 创建应用，确保包名与项目 `manifest.json` 一致。
2. 上传至少一个包含 Billing 能力的 AAB 到内部测试或封闭测试轨道。
3. 在“获利”中创建并启用一次性商品或订阅商品。
4. 订阅商品需要创建并启用 base plan，可按需创建 offer。
5. 在 License Testing 中添加测试 Google 账号。
6. 将测试账号加入测试轨道，并通过 Google Play 提供的测试链接安装应用。

商品、base plan 或 offer 发布后可能需要一段时间才能生效。

## 快速开始

下面示例演示连接、查询一个一次性商品、发起购买、监听最终结果以及应用恢复时补单。将 `coins_100` 替换为 Play Console 中已经启用的商品 ID。

```vue
<template>
  <button @tap="buyFirstProduct">购买 coins_100</button>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import * as googleIap from '@/uni_modules/tt-google-iap'

const iap = googleIap.getTTGoogleIAP()
const products = ref<googleIap.TTGoogleIAPProductDetails[]>([])

const purchaseListener: googleIap.TTGoogleIAPPurchasesUpdatedCallback = (result) => {
  console.log('purchase response:', result.responseCode, result.debugMessage)
  if (result.responseCode != 0) return
  const purchases = result.purchases
  if (purchases == null) return
  for (let i = 0; i < purchases.length; i++) {
    const purchase = purchases[i]
    if (purchase.purchaseState == 'pending') {
      console.log('订单待付款，暂不发放权益:', purchase.products)
      continue
    }
    if (purchase.purchaseState != 'purchased' || purchase.isSuspended) continue

    // 生产环境：把 purchase.purchaseToken、期望商品 ID 和业务用户 ID
    // 发送到服务端验证。服务端幂等发放权益后再确认或消耗订单。
    console.log('请发送到服务端验证:', purchase.purchaseToken)
  }
}

function queryProduct(): void {
  iap.queryProductDetails({
    products: [{ productId: 'coins_100', productType: 'inapp' }],
    success: (result) => {
      products.value = result.products
      if (result.unfetchedProducts.length > 0) {
        console.log('未获取商品:', result.unfetchedProducts)
      }
    },
    fail: (error) => {
      console.log('查询失败:', error.errCode, error.billingResponseCode, error.errMsg)
    }
  } as googleIap.TTGoogleIAPQueryProductDetailsOptions)
}

function buyFirstProduct(): void {
  if (products.value.length == 0) {
    console.log('请先查询商品')
    return
  }

  const product = products.value[0]
  const item: googleIap.TTGoogleIAPBillingFlowItem = {
    productId: product.productId
  }

  // Billing 9 的一次性商品 offer 可能带 token；旧式标准商品的 token 可能为空。
  if (product.oneTimePurchaseOffers.length > 0) {
    const token = product.oneTimePurchaseOffers[0].offerToken
    if (token != null) item.offerToken = token
  }

  iap.launchBillingFlow({
    productType: 'inapp',
    items: [item],
    success: (_) => {
      // 只表示购买界面已打开，最终结果由 purchaseListener 返回。
    },
    fail: (error) => {
      console.log('启动购买失败:', error.errCode, error.billingResponseCode, error.errMsg)
    }
  } as googleIap.TTGoogleIAPLaunchBillingFlowOptions)
}

function restoreCurrentPurchases(): void {
  if (!iap.isReady()) return
  iap.restorePurchases({
    includeSuspendedSubscriptions: true,
    success: (result) => {
      // 将两类查询返回的 purchaseToken 交给服务端重新验证和恢复权益。
      console.log('inapp:', result.inApp.purchases)
      console.log('subscriptions:', result.subscriptions.purchases)
    }
  } as googleIap.TTGoogleIAPRestorePurchasesOptions)
}

onLoad(() => {
  // 必须在发起购买前注册监听，并保存 callback 引用以便准确移除。
  iap.onPurchasesUpdated(purchaseListener)
  iap.connect({
    enableAutoServiceReconnection: true,
    enablePrepaidPlans: true,
    success: (_) => {
      queryProduct()
      restoreCurrentPurchases()
    },
    fail: (error) => {
      console.log('连接失败:', error.errCode, error.billingResponseCode, error.errMsg)
    }
  } as googleIap.TTGoogleIAPConnectOptions)
})

onShow(() => {
  // 补偿应用在支付期间进入后台或进程被终止时遗漏的购买回调。
  restoreCurrentPurchases()
})

onUnload(() => {
  iap.offPurchasesUpdated(purchaseListener)
})
</script>
```

`getTTGoogleIAP()` 返回进程级共享实例。页面销毁时应移除该页面注册的监听器；通常不需要在每次页面销毁时调用 `disconnect()`。

## 购买流程说明

```text
注册购买监听
  -> connect
  -> queryProductDetails
  -> 选择 Play 返回的商品和 offer token
  -> launchBillingFlow
  -> onPurchasesUpdated
  -> 将 purchaseToken 发送到业务服务端验证
  -> 服务端幂等发放权益
  -> acknowledgePurchase 或 consumePurchase
```

必须注意：

- `launchBillingFlow.success` 只表示 Google Play 购买界面成功启动，不代表支付完成。
- 最终结果由 `onPurchasesUpdated` 返回。
- `pending` 订单不能发放权益。
- 应用启动和从后台恢复时应调用 `queryPurchases` 或 `restorePurchases` 补单。
- 商品信息和 offer token 必须来自最近一次 `queryProductDetails` 查询，不要自行构造或长期保存 token。

## 一次性商品与订阅

### 查询商品

```uts
iap.queryProductDetails({
  products: [
    { productId: 'coins_100', productType: 'inapp' },
    { productId: 'premium_monthly', productType: 'subs' }
  ],
  success: (result) => {
    console.log(result.products)
    console.log(result.unfetchedProducts)
  }
} as googleIap.TTGoogleIAPQueryProductDetailsOptions)
```

`productType` 取值：

- `inapp`：一次性商品，包括消耗型和非消耗型。是否可消耗由业务定义。
- `subs`：订阅。

Billing 9 会将单个商品的查询失败放在 `unfetchedProducts` 中。因此请求整体成功不代表每个商品都查询成功。

### 购买一次性商品

一次性商品可能返回多个购买选项或 offer。若所选 `offerToken` 不为空，必须将它传入购买项；旧式标准商品的 token 可能为空。

```uts
if (product.oneTimePurchaseOffers.length == 0) return
const offer = product.oneTimePurchaseOffers[0]
const item: googleIap.TTGoogleIAPBillingFlowItem = { productId: product.productId }
if (offer.offerToken != null) item.offerToken = offer.offerToken

iap.launchBillingFlow({
  productType: 'inapp',
  items: [item],
  obfuscatedAccountId: '服务端生成的非 PII 用户哈希'
} as googleIap.TTGoogleIAPLaunchBillingFlowOptions)
```

符合 Google Play 条件时，`items` 可以包含多个一次性商品。预购和租赁 offer 不可放入多商品购买。

### 购买订阅

订阅必须从 `subscriptionOffers` 中选择一个 offer，并传递其 `offerToken`。

```uts
if (product.subscriptionOffers.length == 0) return
const offer = product.subscriptionOffers[0]

iap.launchBillingFlow({
  productType: 'subs',
  items: [{
    productId: product.productId,
    offerToken: offer.offerToken
  }]
} as googleIap.TTGoogleIAPLaunchBillingFlowOptions)
```

`pricingPhases` 只用于展示价格阶段。不要使用客户端价格判断实际扣款或权益，最终价格和购买资格以 Google Play 与服务端查询结果为准。

## 订阅替换

先通过 `queryPurchases` 查询用户当前订阅并取得旧 `purchaseToken`，再查询新订阅商品及 offer。`oldPurchaseToken` 和 `replacements` 必须同时传入。

```uts
iap.launchBillingFlow({
  productType: 'subs',
  items: [{ productId: 'premium_yearly', offerToken: newOfferToken }],
  oldPurchaseToken: oldPurchaseToken,
  replacements: [{
    newProductId: 'premium_yearly',
    oldProductId: 'premium_monthly',
    replacementMode: 'withTimeProration'
  }]
} as googleIap.TTGoogleIAPLaunchBillingFlowOptions)
```

`replacementMode` 支持以下值：

| 值 | 说明 |
| --- | --- |
| `withTimeProration` | 立即替换，按剩余时间折算 |
| `chargeProratedPrice` | 立即替换并收取剩余周期差价 |
| `withoutProration` | 立即替换，下个续订日按新价格收费 |
| `deferred` | 旧方案到期后替换 |
| `chargeFullPrice` | 立即替换并收取新方案全价 |
| `keepExisting` | 保持现有订阅方案 |

不同替换场景允许的模式受 Google Play 规则约束。

## 恢复确认与消耗

### 查询与恢复

查询一种商品类型：

```uts
iap.queryPurchases({
  productType: 'subs',
  includeSuspendedSubscriptions: true,
  success: (result) => {
    // 将每个 purchaseToken 交给服务端重新验证和恢复权益。
  }
} as googleIap.TTGoogleIAPQueryPurchasesOptions)
```

同时查询一次性商品和订阅：

```uts
iap.restorePurchases({
  includeSuspendedSubscriptions: true,
  success: (result) => {
    // inApp 和 subscriptions 分别报告 success、purchases、error。
    // 一类查询失败时，另一类仍可能成功。
  }
} as googleIap.TTGoogleIAPRestorePurchasesOptions)
```

消耗型商品成功消耗后不会再由 `queryPurchases` 返回。恢复接口返回当前有效购买，不是完整购买历史。

### 确认与消耗

确认或消耗前，必须完成服务端验单和幂等权益交付。

```uts
// 非消耗型一次性商品或订阅
iap.acknowledgePurchase({
  purchaseToken: verifiedPurchaseToken
} as googleIap.TTGoogleIAPAcknowledgePurchaseOptions)

// 可重复购买的消耗型一次性商品；consume 同时完成 acknowledge
iap.consumePurchase({
  purchaseToken: verifiedPurchaseToken
} as googleIap.TTGoogleIAPConsumePurchaseOptions)
```

- 非消耗型一次性商品和订阅使用 `acknowledgePurchase`。
- 消耗型一次性商品使用 `consumePurchase`。
- 不要对同一订单同时调用两者。
- 新购买应在 Google Play 要求的期限内完成确认，否则可能自动退款。

## 核心 API

所有异步 options 的 `success`、`fail` 和 `complete` 都是可选回调。`complete` 在 `success` 或 `fail` 后调用，参数为对应结果或错误。

### `connect(options)`

创建 BillingClient 并连接 Google Play。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `enablePrepaidPlans` | `boolean` | 否 | `false` | 支持订阅预付方案的待处理交易 |
| `enableAutoServiceReconnection` | `boolean` | 否 | `true` | 允许 Billing 服务自动重连 |
| `success` | callback | 否 | - | 返回 `connectionState: "connected"` |
| `fail` | callback | 否 | - | 返回 `TTGoogleIAPBillingFail` |
| `complete` | callback | 否 | - | 完成回调 |

首次创建 BillingClient 时的连接选项会保持到 `disconnect()`。连接中的并发 `connect()` 会共用同一次连接，第一次调用的配置生效。

### `queryProductDetails(options)`

查询商品详情并将原生 `ProductDetails` 缓存在当前进程中。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `products` | `TTGoogleIAPProductQuery[]` | 是 | 商品 ID 与 `inapp`/`subs` 类型列表 |
| `success` | callback | 否 | 返回 `products` 和 `unfetchedProducts` |
| `fail` | callback | 否 | 整体请求失败 |
| `complete` | callback | 否 | 完成回调 |

### `launchBillingFlow(options)`

启动 Google Play 购买界面。调用前必须完成商品查询并注册购买监听。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `productType` | `string` | 是 | `inapp` 或 `subs` |
| `items` | `TTGoogleIAPBillingFlowItem[]` | 是 | 已查询商品及对应 offer token |
| `oldPurchaseToken` | `string` | 替换订阅时 | 旧订阅购买 token |
| `replacements` | `TTGoogleIAPSubscriptionReplacement[]` | 替换订阅时 | 商品级替换配置 |
| `obfuscatedAccountId` | `string` | 否 | 1 到 64 字符的非 PII 账号标识 |
| `obfuscatedProfileId` | `string` | 否 | 1 到 64 字符的非 PII 资料标识 |
| `isOfferPersonalized` | `boolean` | 否 | 是否为个性化价格 |

`success` 返回即时 BillingResult，只表示购买界面已启动。

### `onPurchasesUpdated(callback)`

注册最终购买结果监听。重复注册同一个 callback 引用会被忽略。

| 返回字段 | 类型 | 说明 |
| --- | --- | --- |
| `responseCode` | `number` | Google Play BillingResponseCode |
| `subResponseCode` | `number` | 购买失败细分原因 |
| `debugMessage` | `string` | Google Play 诊断信息 |
| `purchases` | `TTGoogleIAPPurchase[] \| null` | 购买记录，取消或失败时可能为 null |

使用 `offPurchasesUpdated(callback)` 移除指定监听；省略 callback 会移除全部购买监听。

### `queryPurchases(options)` / `restorePurchases(options)`

| API | 说明 |
| --- | --- |
| `queryPurchases` | 查询 `inapp` 或 `subs` 一种类型的当前购买 |
| `restorePurchases` | 分别查询两种类型，并独立报告每部分成功或失败 |

`includeSuspendedSubscriptions` 只影响订阅查询，默认为 `false`。

### `acknowledgePurchase(options)` / `consumePurchase(options)`

两个方法都要求传入非空 `purchaseToken`。成功结果返回已处理的 `purchaseToken`。

### 其他 API

| API | 用途 |
| --- | --- |
| `disconnect()` | 关闭客户端并清空商品缓存；公开监听器仍保留 |
| `getConnectionState()` / `isReady()` | 读取当前连接状态 |
| `onConnectionStateChanged(callback)` | 监听连接状态 |
| `offConnectionStateChanged(callback?)` | 移除指定或全部连接监听 |
| `getCachedProductDetails(product)` | 读取一个序列化商品缓存，未命中返回 null |
| `clearProductDetailsCache(product?)` | 清除指定或全部商品缓存 |
| `showInAppMessages(options)` | 显示事务性订阅消息 |
| `getBillingConfig(options)` | 查询 Google Play 判定的 ISO 国家代码 |
| `openSubscriptionCenter(options)` | 打开指定订阅或 Play 订阅列表 |
| `isFeatureSupported(options)` | 查询当前 Play Store 是否支持某项 Billing 能力 |

`isFeatureSupported.feature` 支持：`subscriptions`、`subscriptionsUpdate`、`productDetails`、`inAppMessaging`、`includeSuspendedSubscriptions`、`billingConfig`。

## 数据结构

### `TTGoogleIAPProductDetails`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `productId` | `string` | Play Console 商品 ID |
| `productType` | `string` | `inapp` 或 `subs` |
| `title` / `name` / `description` | `string` | Google Play 本地化商品信息 |
| `queriedAt` | `number` | 插件取得商品信息的时间 |
| `oneTimePurchaseOffers` | array | 一次性商品购买选项与 offer |
| `subscriptionOffers` | array | 订阅 base plan 与 offer |

### `TTGoogleIAPPurchase`

| 字段 | 说明 |
| --- | --- |
| `purchaseToken` | 服务端验单和幂等处理的唯一键 |
| `products` | 本次购买关联的商品 ID |
| `purchaseState` | `purchased`、`pending` 或 `unspecified` |
| `quantity` | 商品数量 |
| `isAcknowledged` | 是否已经确认 |
| `isAutoRenewing` | 订阅是否自动续订 |
| `isSuspended` | 订阅是否处于暂停状态 |
| `orderId` | 仅用于展示或诊断，不能替代 purchaseToken |
| `originalJson` / `signature` | 本地诊断数据，不能替代服务端验证 |

状态处理规则：

| 状态 | 处理方式 |
| --- | --- |
| `purchaseState == "purchased"` | 服务端验证成功后才可授予权益 |
| `purchaseState == "pending"` | 不授予权益，后续监听或补单 |
| `purchaseState == "unspecified"` | 不授予权益 |
| `isSuspended == true` | 暂停订阅权益 |
| `isAcknowledged == false` | 验单和交付后确认；消耗型调用 consume |

### `TTGoogleIAPBillingFail`

| 字段 | 说明 |
| --- | --- |
| `errCode` | 插件稳定错误码 |
| `errMsg` | 插件错误说明 |
| `billingResponseCode` | Google Play 原始 BillingResponseCode，本地错误时为 null |
| `subResponseCode` | 购买失败细分原因，没有时为 null |
| `debugMessage` | Google Play 诊断信息，没有时为 null |

## 错误码

### 插件错误码

| errCode | 含义 |
| --- | --- |
| `9011001` | 参数无效或参数组合不合法 |
| `9011002` | BillingClient 尚未初始化 |
| `9011003` | Billing 服务未连接或连接已断开 |
| `9011004` | 商品未缓存，需先查询商品 |
| `9011005` | 当前 Android Activity 不可用 |
| `9011006` | 已有购买流程进行中 |
| `9011007` | Google Play Billing 请求失败 |
| `9011008` | 当前 Play Store 不支持该能力 |
| `9011009` | offer token 不存在于已缓存商品中 |
| `9011099` | 插件内部错误 |

### 常见 BillingResponseCode

| 值 | 名称 | 常见含义 |
| --- | --- | --- |
| `0` | `OK` | 请求成功 |
| `1` | `USER_CANCELED` | 用户取消购买 |
| `2` | `SERVICE_UNAVAILABLE` | Billing 服务暂时不可用 |
| `3` | `BILLING_UNAVAILABLE` | 设备、账号或 Play Store 不支持 Billing |
| `4` | `ITEM_UNAVAILABLE` | 商品对当前应用或账号不可用 |
| `5` | `DEVELOPER_ERROR` | 包名、签名、参数或后台配置错误 |
| `6` | `ERROR` | Google Play 内部错误 |
| `7` | `ITEM_ALREADY_OWNED` | 当前账号已拥有该未消耗商品 |
| `8` | `ITEM_NOT_OWNED` | 要确认或消耗的商品不属于当前账号 |
| `-1` | `SERVICE_DISCONNECTED` | Billing 服务连接断开 |
| `-2` | `FEATURE_NOT_SUPPORTED` | 当前 Play Store 不支持该能力 |
| `-3` | `SERVICE_TIMEOUT` | Billing 服务超时 |
| `12` | `NETWORK_ERROR` | 网络错误 |

## 常见问题

### 查询不到商品或返回 `ITEM_UNAVAILABLE`

依次检查：

1. 商品 ID 和 `productType` 是否正确。
2. 商品、base plan 和 offer 是否已经启用。
3. 包名与 Play Console 应用是否一致。
4. 当前安装包是否来自正确的 Play 测试轨道。
5. 当前 Google 账号是否加入测试轨道和 License Testing。
6. 后台配置是否仍在同步中。

### 返回 `DEVELOPER_ERROR`

通常是包名、签名、商品类型、offer token 或订阅替换参数不匹配。不要复用旧查询结果中的 offer token，重新查询商品后再发起购买。

### 返回 `ITEM_ALREADY_OWNED`

非消耗型商品已经购买，或消耗型商品尚未消费。调用 `queryPurchases` 找回购买记录，服务端验证后恢复权益；消耗型商品完成交付后再调用 `consumePurchase`。

### 测试支付方式不显示

确认账号已加入 License Testing，并从 Google Play 测试链接安装应用。直接安装本地 APK 通常无法获得正确的测试支付环境。

### 订单一直是 `pending`

待处理订单不能发放权益。保留监听，并在应用启动和 `onShow` 时调用 `queryPurchases` 或 `restorePurchases`。状态变为 `purchased` 后再走服务端验单和交付流程。

### 自定义基座中找不到插件或原生依赖

确认插件位于 `uni_modules/tt-google-iap`，然后重新制作并选择自定义调试基座。标准基座不支持本插件，更新插件后旧基座也不会自动包含新版原生代码。

## 服务端验证

生产应用不能只校验客户端返回的 `originalJson` 和 `signature`。推荐流程：

1. 客户端将 `purchaseToken`、预期商品 ID 和业务用户 ID 发送给业务服务端。
2. 服务端使用 Google Play Developer API 查询购买状态。
3. 校验包名、商品、购买状态、数量和用户绑定关系。
4. 以 `purchaseToken` 为幂等键发放或更新权益。
5. 成功交付后，由可信服务端或客户端调用 acknowledge/consume。
6. 接入 Real-time Developer Notifications，处理续订、到期、退款、撤销、暂停和恢复等生命周期事件。

`obfuscatedAccountId` 和 `obfuscatedProfileId` 必须是散列或不可逆的非 PII 标识，长度为 1 到 64 个字符。

插件客户端不包含以下能力：

- Google Play Developer API 服务端验单。
- Real-time Developer Notifications、退款、撤销和订阅到期处理。
- 业务权益存储、幂等交付、跨设备同步和风控。
- Billing Choice、Alternative Billing 和 External Offers。

## 测试检查表

- 测试账号通过 Play 测试轨道安装应用，包名和签名正确。
- 能查询到预期商品、货币、价格、base plan 和 offer。
- 完成、取消、网络失败、商品已拥有等结果均正确处理。
- Pending 购买不会提前发放权益，完成后能够补单。
- 支付期间终止进程后，重新启动能恢复购买。
- 服务端验单、幂等交付、acknowledge/consume 顺序正确。
- 订阅续订、到期、退款、撤销、暂停和恢复由服务端通知正确更新。

## 示例项目

插件附带的示例工程提供连接、商品查询、offer 选择、购买、恢复、确认、消耗和诊断操作。

1. 从插件市场选择“导入示例项目”，或直接运行当前插件示例工程。
2. 打开项目中的 `pages/index/index.uvue`。
3. 在页面输入框中填写 Play Console 中已启用的商品 ID。
4. 使用自定义调试基座或云打包运行 Android App。

示例页面中的“确认订单”和“消耗订单”按钮只用于测试。生产代码必须在服务端验证并成功交付权益后调用对应 API。

## 更新日志与支持

- 版本变更见插件目录中的 `changelog.md`。
- 反馈问题时请提供插件版本、HBuilderX 版本、Android 版本、`errCode`、`billingResponseCode` 和 `debugMessage`，不要公开完整 `purchaseToken`。

## 官方文档

- [集成 Google Play Billing](https://developer.android.com/google/play/billing/integrate)
- [保护 Billing 集成](https://developer.android.com/google/play/billing/security)
- [测试 Google Play Billing](https://developer.android.com/google/play/billing/test)
- [订阅生命周期](https://developer.android.com/google/play/billing/lifecycle/subscriptions)
- [Billing Library 迁移指南](https://developer.android.com/google/play/billing/migrate-pbl-latest)
