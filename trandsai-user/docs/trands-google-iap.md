# trands-google-iap

自研 Google Play Billing 9 UTS 插件，与收费加密插件 `tt-google-iap` **并存**，通过环境变量切换。

## 架构

```
utils/googlePayAndroid.js
  ├─ VITE_USE_TRANDS_IAP=0（默认）→ tt-google-iap（云打包 / 自定义基座）
  └─ VITE_USE_TRANDS_IAP=1/true/yes → utils/trandsGoogleIapFacade.js
         └─ uni_modules/trands-google-iap（top-level UTS exports）
                ├─ app-android：BillingClient 9.1
                └─ app-ios：stub（fail）
```

离线 AS：`HBuilder-Integrate-AS/trands-google-iap`（Kotlin 源码编译，`uts.sdk.modules.trandsGoogleIap.IndexKt.*ByJs`）。

## JSON bridge（ByJs）

原生与 JS 之间**不**把 `success`/`fail` 嵌在 options 对象里（UTS ByJs 下嵌套 UniCallback 到不了 JS）。

| 层 | 约定 |
| --- | --- |
| Native `*ByJs` | 顶层回调参数 + 结果为 **JSON 字符串**（`org.json`） |
| UTS export | 同签名：`connect(optionsJson, success, fail)` 等 |
| `trandsGoogleIapFacade.js` | `JSON.stringify` 入参，`JSON.parse` 后再调业务 `options.success/fail` |

成功例：`{"products":[...],"unfetchedProducts":[...]}`、`{"countryCode":"HK"}`。  
失败例：`{"errCode":9011009,"billingResponseCode":...,"debugMessage":...}`。

## API（与 googlePayAndroid 对齐）

业务侧仍用 options 对象；facade 负责桥接：

| 方法 | 说明 |
| --- | --- |
| `connect({ enableAutoServiceReconnection, enablePrepaidPlans, success, fail })` | 连接 Billing |
| `isReady()` | 是否已就绪 |
| `getBillingConfig({ success, fail })` | `success({ countryCode })` |
| `queryProductDetails({ products, success, fail })` | 缓存 `ProductDetails`；offers 含 `offerToken` |
| `launchBillingFlow({ productType, items, success, fail })` | 拉起支付 UI |
| `onPurchasesUpdated(cb)` | `cb({ responseCode, debugMessage, purchases })` |

Purchase：`purchaseState` 为 `"purchased"` / `"pending"` / `"unspecified"`；`PURCHASED → purchased`。

原生 Logcat tag：**`TrandsIAP`**（可见 `invokeCb class=... json=...`）。JS 成功时应有 `[TrandsIAP facade] query success`。

## 开关

`.env` / `.env.example`：

```bash
VITE_USE_TRANDS_IAP=0   # 默认 tt，勿在生产误开
```

离线测支付时设为 `1`，重新导出 www 并覆盖 assets。

## 测试清单

1. 默认 `VITE_USE_TRANDS_IAP=0`：云打包 / 自定义基座仍走 tt，行为不变。
2. 离线：`VITE_USE_TRANDS_IAP=1` → 重建 www → 拷贝 assets → AS Run。
3. Logcat：`tag:TrandsIAP` 可见 `connect` / `queryProductDetails` / `launchBillingFlow` / `onPurchasesUpdated`。
4. Play：License testers + 内测/封闭轨道安装（不要只侧载 debug APK 验真支付）。
5. 成功购买后后端 `/api/payment/verify-google-receipt` 验单。
6. 勿与 manifest 里的 **Google Pay Web** 混淆；本模块是 **Play Billing IAP**。
