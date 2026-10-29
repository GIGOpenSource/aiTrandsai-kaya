# Trands Uni 插件复用手册（给其他项目）

> 目标仓库：`https://gitee.com/text-xr/trands-uni-plugins.git`  
> 参考实现工程：`aiGrilFriend_new`（本手册**不要求**改参考工程；其它新项目按本文接入）  
> 适用：uni-app Vue3 + App（Android / iOS），云打包或离线 Android Studio 打包

本文说明：**共享仓库里放什么、新项目怎么拉、复制哪些文件、每条命令干什么、控制台要配什么**。  
登录 / Apple 支付本身是 DCloud 官方能力，**不是 UTS 插件**，但也一并写清，避免漏配。

---

## 0. 先弄清：哪些是「插件」，哪些是「业务胶水」

| 能力 | 形态 | 能不能放进 `trands-uni-plugins` | 新项目怎么用 |
|------|------|----------------------------------|--------------|
| Firebase 埋点 | UTS：`trands-firebase-analytics` | ✅ 放进仓库 | 拷/子模块进 `uni_modules` + 复制 JS 封装 |
| 增长归因（GAID/IDFA/Referrer） | UTS：`trands-attribution` | ✅ | 同上 |
| Android Play 自研支付 | UTS：`trands-google-iap` | ✅ | 同上；离线 AS 还要 Kotlin 模块 |
| 商店国家等 | UTS：`trands-storefront`（可选） | ✅ | 按需 |
| `tt-google-iap`（收费加密） | 插件市场购买 | ❌ **不要提交到 Gitee**（授权绑定 AppID） | 新项目自己买、绑定自己的 `appid` |
| Google / Apple **登录** | `manifest` OAuth + `uni.login` / 原生 Sign-In | ❌ 无独立 UTS；可放 **示例 JS** | 配 manifest + 复制示例登录代码 |
| iOS **Apple IAP** | `manifest` Payment.`appleiap` + `uni.requestPayment` | ❌ 官方模块 | 配 manifest + 复制支付流程代码 |
| 后端验单 / 登录接口 | 你们服务端 | ❌ | 新项目对接同一套 API 或自建 |

**原则：**  
- **可复用核心** = `uni_modules/trands-*` +（可选）`js-sdk/` 示例封装。  
- **每个 App 必须自己改** = `appid`、包名、签名、OAuth Client ID、Firebase 项目、商品 ID、`.env`。

---

## 1. 建议的 Gitee 仓库目录结构

在空仓库里建成如下结构（名称可微调，但建议固定，方便文档命令复制）：

```text
trands-uni-plugins/
├── README.md                          # 可把本手册精简版放这里
├── docs/
│   └── reuse-guide.md                 # 本手册全文
├── uni_modules/
│   ├── trands-firebase-analytics/     # 从参考工程完整拷贝
│   ├── trands-attribution/
│   ├── trands-google-iap/
│   └── trands-storefront/             # 可选
├── js-sdk/                            # 「示例胶水」，不是必须原样使用
│   ├── firebaseAnalytics.example.js
│   ├── attributionNative.example.js
│   ├── growthAttribution.example.js
│   ├── trandsGoogleIapFacade.example.js
│   ├── googlePayAndroid.example.js
│   ├── googleAuth.example.js
│   ├── googleAuthConfig.example.js
│   ├── appleLogin.example.js          # 片段：uni.login provider apple
│   └── applePay.example.js            # 片段：requestProduct + requestPayment
├── offline-android/                   # 离线 AS 用的原生模块（可选同步）
│   └── trands-google-iap/             # Kotlin 源码模块（与 UTS 逻辑对应）
└── templates/
    ├── manifest.snippets.json         # oauth / payment / permissions 片段
    └── .env.example
```

### 1.1 从参考工程第一次推到 Gitee（在参考机上执行）

> 下面命令在**参考工程根目录**或单独工作区执行均可。  
> 目的：把 UTS 模块推进共享仓；**不要**把业务页、`.env` 密钥、`tt-google-iap` 加密插件推进去。

```bash
# 1）克隆空仓库到本地（干啥：拿到可推送的本地目录）
git clone https://gitee.com/text-xr/trands-uni-plugins.git
cd trands-uni-plugins

# 2）建目录（干啥：按约定结构放插件）
mkdir -p uni_modules js-sdk docs offline-android templates

# 3）从参考工程复制 UTS 插件（干啥：这是真正可复用的原生能力）
#    把 REF 换成 aiGrilFriend_new 的绝对路径
REF="/Users/ww/project/aiGrilFriend_new"

cp -R "$REF/uni_modules/trands-firebase-analytics" ./uni_modules/
cp -R "$REF/uni_modules/trands-attribution" ./uni_modules/
cp -R "$REF/uni_modules/trands-google-iap" ./uni_modules/
cp -R "$REF/uni_modules/trands-storefront" ./uni_modules/

# 4）（可选）复制离线 AS 的 Kotlin IAP 模块
#    路径按你们 HBuilder-Integrate-AS 实际位置改
AS="/Users/ww/workSdk/Android-SDK@5.15.82650_20260710/HBuilder-Integrate-AS"
cp -R "$AS/trands-google-iap" ./offline-android/

# 5）提交推送（干啥：让其他项目能拉到）
git add .
git status
git commit -m "chore: init trands UTS plugins for reuse"
git push -u origin master
# 若默认分支是 main：
# git push -u origin main
```

**不要提交：**

- `uni_modules/tt-google-iap`（市场加密插件，和购买账号/AppID 绑定）
- 含真实 Client ID / API Key 的配置（示例里用占位符）
- 整个业务 App 源码

---

## 2. 新项目接入总览（两条路）

### 路线 A：Git Submodule（推荐，可升级）

**干啥：** 新项目把共享仓挂成子目录，升级时 `git submodule update`。

```bash
# 进入新项目根目录
cd /path/to/your-new-uni-app

# 添加子模块（干啥：把远程仓挂到 uni_modules/_trands 或 plugins）
git submodule add https://gitee.com/text-xr/trands-uni-plugins.git packages/trands-uni-plugins

# 初始化（别人克隆新项目后必须跑）
git submodule update --init --recursive
```

然后把插件**链接或拷贝**到 `uni_modules/`（uni-app 只认项目根下的 `uni_modules/<id>`）：

```bash
# 方式 1：拷贝（简单，升级要再拷）
cp -R packages/trands-uni-plugins/uni_modules/trands-firebase-analytics ./uni_modules/
cp -R packages/trands-uni-plugins/uni_modules/trands-attribution ./uni_modules/
cp -R packages/trands-uni-plugins/uni_modules/trands-google-iap ./uni_modules/
cp -R packages/trands-uni-plugins/uni_modules/trands-storefront ./uni_modules/

# 方式 2：符号链接（升级 submodule 后立刻生效；Windows 注意权限）
ln -s ../packages/trands-uni-plugins/uni_modules/trands-firebase-analytics uni_modules/trands-firebase-analytics
ln -s ../packages/trands-uni-plugins/uni_modules/trands-attribution uni_modules/trands-attribution
ln -s ../packages/trands-uni-plugins/uni_modules/trands-google-iap uni_modules/trands-google-iap
ln -s ../packages/trands-uni-plugins/uni_modules/trands-storefront uni_modules/trands-storefront
```

### 路线 B：直接拷贝（最快）

```bash
git clone https://gitee.com/text-xr/trands-uni-plugins.git /tmp/trands-uni-plugins
cp -R /tmp/trands-uni-plugins/uni_modules/trands-* /path/to/your-new-uni-app/uni_modules/
```

**干啥：** 不依赖 submodule；缺点是共享仓更新后要人工再拷一遍。

---

## 3. 新项目 `manifest.json` 必配片段

在 HBuilderX 可视化配置，或直接改 `manifest.json` 的 `app-plus`。

### 3.1 模块开关（干啥：打开原生 OAuth / 支付能力）

```json
"modules": {
  "OAuth": {},
  "Payment": {}
}
```

- `OAuth`：Google / Apple 登录依赖  
- `Payment`：Apple IAP（`appleiap`）依赖  

### 3.2 Android 权限（干啥：网络、Billing、广告 ID）

```json
"android": {
  "permissions": [
    "<uses-permission android:name=\"android.permission.INTERNET\"/>",
    "<uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\"/>",
    "<uses-permission android:name=\"com.android.vending.BILLING\" />",
    "<uses-permission android:name=\"com.google.android.gms.permission.AD_ID\"/>"
  ],
  "minSdkVersion": 24,
  "targetSdkVersion": 36
}
```

### 3.3 OAuth / 支付 SDK（干啥：告诉打包机编进哪些原生 SDK）

```json
"sdkConfigs": {
  "oauth": {
    "apple": {},
    "google": {
      "clientid": "【填你们的 Web 或 iOS 用 Client ID，见第 7 节】"
    }
  },
  "payment": {
    "appleiap": {}
  }
}
```

### 3.4 iOS 隐私文案（按业务增减）

登录 / 归因若用 ATT，还需在原生侧配置追踪说明（`trands-attribution` 会调 ATT）。云打包时在 iOS 隐私描述里补齐；离线则改 Xcode `Info.plist`。

**每换一个新 App：** 必须换 `manifest` 顶层的 `appid`（`__UNI__XXXX`），并在 DCloud 开发者中心创建应用。

---

## 4. Firebase 埋点复用

### 4.1 拷贝什么

| 路径 | 作用 |
|------|------|
| `uni_modules/trands-firebase-analytics/` | 原生 `configure` / `logEvent` / `setUserId` … |
| 参考：`utils/firebaseAnalytics.js` | 业务封装：初始化、登录/注册/支付事件、test_ 前缀 |
| 参考：`utils/firebaseProductAnalytics.js` | 产品事件名常量与统一上报 |
| 参考：`utils/analyticsEventParams.js` | 事件公共参数（uid、utm、gclid…） |
| 参考：`utils/env.js` 里与 `VITE_APP_ENV` / `resolveFirebaseEventName` 相关部分 | test 环境事件名前缀 |

**复制这些 JS 是干啥的：** UTS 只提供「打到 Firebase」的能力；业务事件名、双写后端、用户 ID，都在 JS 层。

### 4.2 分工：谁干什么

| 工具 | 干什么 |
|------|--------|
| **Firebase Console** | 建项目/App，下载配置文件 |
| **HBuilderX** | 放 `uni_modules`、写 JS、改 `.env`、云打包 / 导出 www / 打自定义基座 |
| **Android Studio** | 只在**离线打包**时：接入原生模块、放 `google-services.json`、Sync、Run/打 AAB |
| **Xcode** | 只在**本地打 iOS**时：放 `GoogleService-Info.plist`（云打包则交给 HX） |

---

### 4.3 Firebase Console：下载两个文件

1. 打开 [Firebase Console](https://console.firebase.google.com/) → 选项目（或新建）  
2. **添加 Android 应用**  
   - Android 包名 = 你们打包用的 `applicationId`（例如参考工程是 `com.gig.trandsai`）  
   - 下载 **`google-services.json`**  
3. **添加 iOS 应用**  
   - Bundle ID = iOS 包名  
   - 下载 **`GoogleService-Info.plist`**  

这两个文件的作用：告诉 Firebase SDK「上报到哪个项目、哪个 App」。  
**包名必须和最终安装包一致**，否则初始化会失败或数据进错应用。

---

### 4.4 下载完放哪里？（云打包 vs 离线）

#### A. 云打包 / 自定义基座（主要在 HBuilderX 工程里放）

参考工程用法（推荐照抄目录名）：

| 文件 | 放到新项目里的路径 | 干什么 |
|------|-------------------|--------|
| `google-services.json` | `nativeResources/android/google-services.json` | 云打包时打进 Android 原生包 |
| `GoogleService-Info.plist` | `nativeResources/ios/Resources/GoogleService-Info.plist` | 云打包时打进 iOS 原生包 |
| （可选）字符串资源 | `nativeResources/android/res/values/config.xml` | 部分基座不用 gradle 插件时，用 string 资源初始化 Firebase |

操作：

1. 在 uni 工程根目录建目录（没有就建）：  
   `nativeResources/android/`、`nativeResources/ios/Resources/`  
2. 把下载的文件**改名/放到上表路径**（文件名必须标准，不要乱改）  
3. HBuilderX：**发行 → 原生 App-云打包**，或先 **制作自定义调试基座**（含 UTS 时必须自定义基座才能真机调试）

> 只改 JS 热更新**不够**；换了 `google-services.json` / 加了 UTS，必须重打基座或重云打包。

#### B. 离线 Android Studio（主要在 AS 工程里放）

假设离线工程根目录叫 `$AS`（参考：`HBuilder-Integrate-AS`），主模块叫 `simpleDemo`：

| 文件/配置 | 放哪里 | 干什么 |
|-----------|--------|--------|
| `google-services.json` | **`$AS/simpleDemo/google-services.json`**（与 `simpleDemo/build.gradle` 同级） | 给 `google-services` Gradle 插件读，生成 Firebase 资源 |
| 或手写资源 | `$AS/simpleDemo/src/main/res/values/firebase_config.xml` | 没有插件时的兜底；字段从 json 里抄 `project_number` / `mobilesdk_app_id` / `api_key` / `project_id` 等 |
| 前端 www | `$AS/simpleDemo/src/main/assets/apps/__UNI__XXXX/www/` | 业务 JS；**不含** google-services（那是原生配置） |

**推荐离线同时做两件事：**

1. 把 `google-services.json` 放到 `simpleDemo/` 根目录  
2. `build.gradle` 末尾加插件（见下一节）

不要只把 json 丢进 `www/`——**www 里放了也不会生效**。

---

### 4.5 离线 Android Studio：那三行到底在干嘛、怎么改

参考工程 `simpleDemo/build.gradle` 实际是：

```gradle
// 1）依赖：把 UTS 原生模块编进 APK（干啥：JS 才能调到 configure/logEvent）
implementation project(':trands-firebase-analytics')

// 2）Firebase SDK（干啥：真正往 Google 发事件）
implementation platform('com.google.firebase:firebase-bom:33.7.0')
implementation 'com.google.firebase:firebase-analytics'

// 3）文件最后一行：启用 Google Services 插件（干啥：读取 google-services.json 并生成资源）
apply plugin: 'com.google.gms.google-services'
```

以及根工程 `$AS/build.gradle` 的 classpath（干啥：让上面的 plugin 能被找到）：

```gradle
classpath 'com.google.gms:google-services:4.4.2'
```

以及 `$AS/settings.gradle`（干啥：让 Gradle 认识这个模块目录）：

```gradle
include ':trands-firebase-analytics'
```

**你在 Android Studio 里要做的步骤：**

1. 从共享仓拷模块到离线工程旁：  
   `trands-uni-plugins/offline-android/trands-firebase-analytics` → `$AS/trands-firebase-analytics`  
2. 编辑 `settings.gradle`：加上 `include ':trands-firebase-analytics'`  
3. 编辑 `simpleDemo/build.gradle`：  
   - `dependencies { implementation project(':trands-firebase-analytics') ... }`  
   - 文件末尾 `apply plugin: 'com.google.gms.google-services'`  
4. 把 **`google-services.json` 放到 `simpleDemo/google-services.json`**  
5. 顶部 **Sync Project with Gradle Files**  
6. Run 到真机，或 Build → Generate App Bundle  

**若 Sync 报找不到 plugin：** 检查根 `build.gradle` 是否有 `classpath 'com.google.gms:google-services:…'`。  
**若运行无事件：** Logcat 搜 `tag:TrandsFA`；常见是 json 包名和 `applicationId` 不一致。

---

### 4.6 HBuilderX 侧（前端 + 云）逐步做

1. **拷 UTS**  
   ```bash
   cp -R trands-uni-plugins/uni_modules/trands-firebase-analytics 你的项目/uni_modules/
   ```  
   干啥：编译期把插件编进 App / 基座。

2. **拷 JS 胶水**（从共享仓 `js-sdk/*.example.js` 去掉 `.example` 放进 `utils/`）  
   - `firebaseAnalytics.js`  
   - `firebaseProductAnalytics.js`  
   - `analyticsEventParams.js`  
   - 以及 `env.js` 里 `VITE_APP_ENV` / `resolveFirebaseEventName`  
   干啥：业务只调 JS；UTS 负责原生上报。

3. **`App.vue` `onLaunch`**  
   ```js
   import { configureFirebaseAnalytics } from "@/utils/firebaseAnalytics";
   // onLaunch 里：
   configureFirebaseAnalytics();
   ```  
   干啥：冷启动初始化 Firebase。

4. **放配置文件**（见 4.4-A 的 `nativeResources/...`）

5. **改 `.env`**  
   ```bash
   VITE_APP_ENV=test   # DebugView 搜 test_login / test_app_launch
   # 正式：VITE_APP_ENV=prod
   ```  
   改完必须重新运行/重新导出 www，**热更新不生效**。

6. **运行方式**  
   - 有 UTS：必须 **运行 → 制作自定义调试基座** → 再用该基座运行  
   - 正式：云打包勾选对应模块  

---

### 4.7 环境变量与验收

```bash
# .env
VITE_APP_ENV=test
```

```bash
# 打开 DebugView（干啥：Console 几乎实时看到事件）
adb shell setprop debug.firebase.analytics.app 你的包名

# Android Studio Logcat 过滤：
# tag:TrandsFA
```

正常冷启动应看到：`configure => true`、`logEvent ok: test_app_launch`（正式环境无 `test_` 前缀）。

---

## 5. 归因复用（GAID / IDFA / Install Referrer）— 逐步

### 5.1 拷贝什么

| 路径 | 作用 |
|------|------|
| `uni_modules/trands-attribution/` | 原生读 GAID / IDFA / Referrer / ATT |
| `js-sdk/attributionNative.example.js` → `utils/attributionNative.js` | 包装 UTS |
| `js-sdk/growthAttribution.example.js` → `utils/growthAttribution.js` | 首次 install 上报、重试、拼 gclid/utm |
| `docs/growth-attribution-backend-api.md` | 后端接口约定 |

**复制这些是干啥的：** 原生只「读设备信号」；何时上报、幂等、和广告参数合并，在 JS + 后端。

### 5.2 HBuilderX 要做什么

1. 拷 `uni_modules/trands-attribution`  
2. 拷上述两个 JS 到 `utils/`，按项目改 `api` 路径  
3. `App.vue` `onLaunch` 调用：  
   ```js
   import { runGrowthAttributionOnLaunch } from "@/utils/growthAttribution";
   runGrowthAttributionOnLaunch();
   ```  
4. `manifest` Android 权限加：  
   `com.google.android.gms.permission.AD_ID`  
5. **重新打自定义基座 / 云打包**（UTS 变更必须）

### 5.3 离线 Android Studio 要做什么

1. 拷 `offline-android/trands-attribution` → `$AS/trands-attribution`  
2. `settings.gradle`：`include ':trands-attribution'`  
3. `simpleDemo/build.gradle` dependencies：  
   ```gradle
   implementation project(':trands-attribution')
   implementation 'com.google.android.gms:play-services-ads-identifier:18.1.0'
   implementation 'com.android.installreferrer:installreferrer:2.2'
   ```  
   - 第一行：链上 UTS 模块  
   - 后两行：读 GAID、读 Play Install Referrer 的官方库  
4. Sync → Run  

### 5.4 注意

- 真机 + Google Play 服务更稳  
- **侧载 debug APK 通常没有真实 Install Referrer**；完整归因要商店安装链路  
- iOS 会弹 ATT；拒绝后 IDFA 可能为空（封装里会降级）

---

## 6. Android Google Play 支付复用 — 逐步

### 6.1 两套后端（务必读懂）

| 后端 | 场景 | 怎么来 |
|------|------|--------|
| **`tt-google-iap`** | 云打包 / 自定义基座正式路径 | 插件市场购买，绑定**新项目** `appid` |
| **`trands-google-iap`** | 离线 AS 可编译；也可云打 | 从 `trands-uni-plugins` 拷 UTS |

```bash
VITE_USE_TRANDS_IAP=0   # 默认 tt（云）
VITE_USE_TRANDS_IAP=1   # 离线测自研；改完必须重新导出 www
```

### 6.2 拷贝什么（自研路径）

| 路径 | 作用 |
|------|------|
| `uni_modules/trands-google-iap/` | Billing 9 UTS |
| `utils/trandsGoogleIapFacade.js` | **必拷**：JSON 字符串 + 顶层回调 ↔ 业务 options |
| `utils/googlePayAndroid.js` | 连接、查商品、拉起支付、验单 |
| `utils/googlePay.js` | 条件编译入口，避免 iOS 编进 Android 插件 |

漏 Facade 会出现：原生 Logcat 成功，但 JS 收不到回调。

### 6.3 HBuilderX 要做什么

1. 拷 `trands-google-iap`（云正式还可另购 `tt-google-iap`）  
2. 拷 Facade + `googlePay*.js`  
3. 充值页调用：  
   ```js
   import { startGooglePay } from "@/utils/googlePay";
   await startGooglePay(ctx, productId, "subs" /* 或 inapp */);
   ```  
4. `.env` 设好 `VITE_USE_TRANDS_IAP`  
5. **云路径：** 自定义基座含对应插件 → 运行 / 云打包  
6. **离线路径：**  
   - 菜单：**发行 → 原生 App-本地打包 → 生成本地打包 App 资源**  
   - 干啥：生成 `unpackage/resources/__UNI__XXXX/www`  
   - 然后用终端覆盖 AS assets（下一节）

### 6.4 离线 Android Studio 要做什么

```bash
# HBuilderX 导出 www 之后执行（干啥：把最新前端塞进离线壳）
AS="/path/to/HBuilder-Integrate-AS"
APPID="__UNI__你的ID"
rm -rf "$AS/simpleDemo/src/main/assets/apps/$APPID/www"
cp -R /path/to/new-app/unpackage/resources/$APPID/www \
  "$AS/simpleDemo/src/main/assets/apps/$APPID/www"
```

在 AS：

1. 拷 `offline-android/trands-google-iap` → `$AS/trands-google-iap`  
2. `settings.gradle`：`include ':trands-google-iap'`  
3. `simpleDemo/build.gradle`：  
   ```gradle
   implementation project(':trands-google-iap')
   implementation "com.android.billingclient:billing:9.1.0"
   ```  
4. Sync → Run  
5. Logcat：`tag:TrandsIAP`  

应看到：`connect` → `queryProductDetails` → `launchBillingFlow`；用户取消一般为 `responseCode: 1`。

### 6.5 Play Console（每个新 App）

1. 包名 = `applicationId`  
2. 上传**同一签名**的 AAB  
3. 创建商品，**Product ID 与前端一致**（订阅还要 base plan）  
4. License testers  
5. 从**内测/封闭测试**轨道安装再测支付（侧载 debug 往往验不了真支付）

后端验单参考：`POST /api/payment/verify-google-receipt`（`order_id`、`purchase_token`）。

---

## 7. Google 登录复用 — 逐步

### 7.1 这不是 UTS；依赖三块

1. `manifest`：`modules.OAuth` + `sdkConfigs.oauth.google`  
2. Google Cloud Console 客户端  
3. 业务登录代码（建议 Android 用 `googleAuth.js` 拿 `id_token`）

### 7.2 Google Cloud 要建什么

1. **Android 客户端**：包名 + **SHA-1**（debug / release 证书都要加）  
   ```bash
   # 查 keystore 的 SHA-1（干啥：填到 Google Cloud，否则登录会失败）
   keytool -list -v -keystore your.keystore
   ```  
2. **Web 应用客户端**：给 `requestIdToken` 用（**必须是 Web 类型**，不能用 Android 类型）  
3. （可选）**iOS 客户端**：Bundle ID  

把 Web Client ID 填到：

- `manifest.json` → `sdkConfigs.oauth.google.clientid`（云打包 Google 登录 SDK）  
- `utils/googleAuthConfig.js` → `GOOGLE_WEB_CLIENT_ID`（Android 原生拿 id_token）

### 7.3 HBuilderX 要做什么

1. 打开 `manifest.json` → App 模块权限 → 勾选 **OAuth(登录鉴权)**  
2. SDK 配置里填 Google clientid  
3. 拷 `googleAuth.js` + `googleAuthConfig.js`，登录页调用后 `POST /api/auth/googlelogin`  
4. **制作自定义调试基座**（改 OAuth 配置后必须重打）  
5. 用自定义基座运行，点 Google 登录验收  

### 7.4 离线 Android Studio 要做什么

1. `simpleDemo/libs/` 需有 Google 登录相关 aar（参考工程：`oauth-google-release.aar`）  
2. `implementation 'com.google.android.gms:play-services-auth:21.0.0'`  
3. 包名 / 签名 SHA-1 与 Google Cloud 一致  
4. 前端 www 覆盖后 Run  

iOS 可用 `uni.login({ provider: 'google' })`；Android 若只有 openid 没有 id_token，改用 `googleAuth.js`。

### 7.5 退出登录清缓存（可选）

`plus.oauth.getServices` → 对应 service 的 `logout()`，避免下次直接复用旧账号。

---

## 8. Apple 登录复用 — 逐步（仅 iOS）

### 8.1 Apple Developer / App Store Connect

1. Identifiers → App ID → 勾选 **Sign In with Apple**  
2. 证书 / Profile 重新拉一次（能力变更后常要）  

### 8.2 HBuilderX 要做什么

1. `manifest` → 勾选 OAuth，启用 Apple 登录：`"apple": {}`  
2. 登录页：  
   ```js
   uni.login({
     provider: "apple",
     success: async (success) => {
       await api.post("/api/auth/applelogin", {
         id_token: success.appleInfo.identityToken,
         lastName: success.appleInfo.fullName?.familyName,
         firstName: success.appleInfo.fullName?.givenName,
       });
     },
   });
   ```  
3. **真机**云打包或自定义基座测试（模拟器能力不完整）  
4. Android 不要展示 Apple 按钮  

**复制这段是干啥的：** 系统返回 `identityToken`，后端验签建用户；无需自研 UTS。

---

## 9. iOS Apple 支付（IAP）— 逐步

### 9.1 App Store Connect

1. 创建 App → 功能 → App 内购买项目  
2. 建商品，**Product ID 与前端字符串完全一致**  
3. 协议 / 税务 / 银行信息填完（否则 `requestProduct` 经常空）  
4. 准备沙盒测试账号  

### 9.2 HBuilderX 要做什么

1. `manifest` → 勾选 **Payment**，SDK 配置：`"appleiap": {}`  
2. 充值逻辑参考 `AppRechargeModal.vue`：  
   ```text
   plus.payment.getChannels
     → 找到 id === "appleiap"
     → requestProduct([productId])
     → uni.requestPayment({ provider: "appleiap", orderInfo: { productid, quantity, username } })
     → success → POST /api/payment/verify-apple-receipt
   ```  
3. **不要乱传 `paymentDiscount`**（非促销易 SKError）  
4. 用户取消不要当失败狂 toast  
5. 云打包勾选支付模块 → 用沙盒账号真机测  

### 9.3 Xcode（仅本地打 iOS 时）

1. Signing & Capabilities 确认 In-App Purchase  
2. 若本地集成 Firebase，把 `GoogleService-Info.plist` 拖进工程（云打包则靠 `nativeResources`）  

### 9.4 与 Android 分支

```text
if (ios) startApplePay(productId)
else startGooglePay(ctx, productId, type)
```

---

### 附：云打包 vs 离线打包，一句话对照

| 事项 | HBuilderX 云打包 | 离线 Android Studio |
|------|------------------|---------------------|
| UTS 源码 | 放 `uni_modules/trands-*` | 还要 `$AS` 里 `include` + `implementation project` |
| Firebase 配置 | `nativeResources/android/google-services.json` 等 | `simpleDemo/google-services.json` + `apply plugin` |
| 前端代码 | 云打包自动打进包 | 先「生成本地打包资源」，再 `cp` 覆盖 `assets/.../www` |
| 改 `.env` / JS | 重新运行或重新云打包 | 重新导出 www 并覆盖 assets 后再 Run |
| Google/Apple 登录支付 | manifest 勾选 + 重打基座/云包 | AS 还要对应 aar/依赖/包名签名一致 |

---

## 10. 新项目完整 Checklist（按顺序做）

### A. 工程骨架

- [ ] 新建 uni-app（Vue3），拿到新的 `__UNI__xxxxxx`  
- [ ] `git submodule add` 或 `cp` 四个 `trands-*` 到 `uni_modules`  
- [ ] （云）如需 tt 支付：市场购买 `tt-google-iap` 并绑定**新** appid  

### B. 配置

- [ ] 改 `manifest`：OAuth、Payment、权限、包名相关  
- [ ] `.env`：`VITE_API_BASE_URL`、`VITE_APP_ENV`、`VITE_USE_TRANDS_IAP`  
- [ ] Google：Android SHA-1、Web Client ID  
- [ ] Apple：Sign in with Apple、IAP 商品  
- [ ] Firebase：双端配置文件  
- [ ] Play / App Store 商品 ID  

### C. 业务胶水

- [ ] 复制并改写：`firebaseAnalytics` / `attribution` / `googlePay*` / `googleAuth*` / 充值与登录页调用  
- [ ] 后端：登录、验 Google 单、验 Apple 单、归因 install（可共用原后端或新部署）  

### D. 打包

| 目标 | 做什么 |
|------|--------|
| Android 云打包 | HX 制作自定义基座 → 运行；正式云打包勾选模块 |
| Android 离线 | 导出 www → 覆盖 assets → AS 接入 UTS/Kotlin → Run/AAB |
| iOS | 云打包或本地 Xcode；配置证书、能力、Firebase plist |

### E. 验收

- [ ] Google 登录拿到 token，后端成功  
- [ ] Apple 登录（真机）成功  
- [ ] Firebase DebugView 有事件  
- [ ] 归因字段在 install 上报里能看到（商店包）  
- [ ] Android：能拉起 Play 支付窗；取消为 code=1 不误报失败  
- [ ] iOS：能拉起 Apple 支付；沙盒验单成功  

---

## 11. 常用命令速查（命令 → 干什么）

```bash
# 克隆共享插件仓
git clone https://gitee.com/text-xr/trands-uni-plugins.git
# → 下载可复用 UTS / 文档 / 示例

# 新项目挂子模块
git submodule add https://gitee.com/text-xr/trands-uni-plugins.git packages/trands-uni-plugins
# → 版本化依赖共享仓

# 别人克隆后拉子模块
git submodule update --init --recursive
# → 真正下载子模块内容（漏跑会空目录）

# 更新子模块到远程最新
cd packages/trands-uni-plugins && git pull && cd -
# → 升级插件版本后再 cp/ln 到 uni_modules

# 拷贝单个插件进业务工程
cp -R packages/trands-uni-plugins/uni_modules/trands-google-iap ./uni_modules/
# → uni-app 编译期能找到 @/uni_modules/xxx

# 覆盖离线 www
rm -rf "$AS/simpleDemo/src/main/assets/apps/__UNI__XXX/www"
cp -R ./unpackage/resources/__UNI__XXX/www "$AS/simpleDemo/src/main/assets/apps/__UNI__XXX/www"
# → 离线壳加载最新前端；改 .env / JS 后必做

# 打 Release AAB
cd "$AS" && ./gradlew :simpleDemo:bundleRelease
# → 生成上架用 AAB

# Firebase 调试
adb shell setprop debug.firebase.analytics.app com.xxx.yyy
# → 打开该包名的 Analytics 调试模式
```

---

## 12. 明确「当前参考项目」不用改什么

本手册面向**其它新项目**。参考工程 `aiGrilFriend_new` 已跑通的路径保持现状即可：

- 云：`VITE_USE_TRANDS_IAP=0` + `tt-google-iap`  
- 离线测支付：临时 `=1` + `trands-google-iap`  
- 登录 / Apple 支付 / 埋点 / 归因：已在工程内  

新项目不要直接复制参考工程的：

- `__UNI__859C11F`  
- 包名 `com.gig.trandsai`  
- Google Client ID / Firebase 工程（除非有意共用）  
- Play / App Store 商品 ID  

---

## 13. 推荐：共享仓 README 一句话

> 本仓库提供 Trands 系 uni-app UTS：`trands-firebase-analytics`、`trands-attribution`、`trands-google-iap`（及可选 `trands-storefront`）。  
> Google/Apple 登录与 Apple IAP 使用 DCloud 官方 OAuth/Payment，示例代码见 `js-sdk/`。  
> `tt-google-iap` 请自行在插件市场购买，勿提交本仓。  
> 完整步骤见 `docs/reuse-guide.md`（即本文）。

---

## 14. 出问题先查哪

| 现象 | 优先查 |
|------|--------|
| UTS 方法不存在 / 调用无响应 | 是否打进**自定义基座**或离线 module；包名反射是否 `uts.sdk.modules.*` |
| Google 登录无 id_token | 是否用了 **Web** Client ID + `googleAuth.js` |
| Play 能查商品但付不了 | 是否商店轨道安装、账号是否 License tester、签名是否一致 |
| Apple 查不到商品 | 商品状态、沙盒号、协议税务、Product ID |
| Firebase 后端有、Console 无 | `VITE_APP_ENV=test` 时搜 `test_` 前缀；用 DebugView + `tag:TrandsFA` |
| 取消支付仍 toast 失败 | 购买回调 `responseCode === 1` 应当取消处理 |

---

**维护建议：** 插件 API 变更时，先改 `trands-uni-plugins`，打 tag（如 `v1.1.0`），新项目再升级 submodule；业务工程只跟 tag，避免 silently 漂版本。
