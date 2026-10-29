# Android 离线打包说明（支付后补）

工程路径：`/Users/ww/workSdk/Android-SDK@5.15.82650_20260710/HBuilder-Integrate-AS`

## 本阶段已接入

- 业务 www 资源（`simpleDemo/src/main/assets/apps/__UNI__859C11F/www`）
- Google 登录（`oauth-google-release.aar`）
- UTS：`trands-attribution`、`trands-firebase-analytics`、**`trands-google-iap`**
- Firebase 字符串资源：`simpleDemo/src/main/res/values/firebase_config.xml`
- `utsplugin-release.aar`
- Release：`minifyEnabled true` + `proguard-rules.pro`
- `billing:9.1.0`（simpleDemo + `trands-google-iap` 模块）

## 支付双后端（重要）

| 后端 | 用途 | 开关 |
| --- | --- | --- |
| **`tt-google-iap`（默认）** | 云打包 / 自定义基座正式路径 | `VITE_USE_TRANDS_IAP=0`（或不设） |
| **`trands-google-iap`（自研）** | 离线 AS 明文模块，可编进 SDK | `VITE_USE_TRANDS_IAP=1` / `true` / `yes` |

- **默认不要开** trands 开关，避免影响云端 tt 路径。
- 加密插件 `tt-google-iap` 仍**无法**解编进离线 SDK；离线测支付请用 trands。
- 勿与 `manifest` 里的 **Google Pay Web** 混淆；这里是 **Google Play Billing IAP**。

详见 [`docs/trands-google-iap.md`](./trands-google-iap.md)。

## 离线启用 trands IAP

1. 在项目 `.env`（或导出前环境）设置：
   ```bash
   VITE_USE_TRANDS_IAP=1
   ```
2. HBuilderX：发行 → 原生 App-本地打包 → 生成本地打包 App 资源（或你们现有 www 导出流程）。
3. 覆盖 assets：
   ```bash
   rm -rf HBuilder-Integrate-AS/simpleDemo/src/main/assets/apps/__UNI__859C11F/www
   cp -R aiGrilFriend_new/unpackage/resources/__UNI__859C11F/www \
     HBuilder-Integrate-AS/simpleDemo/src/main/assets/apps/__UNI__859C11F/www
   ```
4. Android Studio：`simpleDemo` → Run（或 `./gradlew :simpleDemo:assembleDebug`）。
5. Logcat 过滤：`tag:TrandsIAP`；JS 日志应出现 `[GooglePay] IAP backend: trands-google-iap`。

测完后把 `VITE_USE_TRANDS_IAP` 改回 `0`，避免误打包进云端。

### Play 测试注意

- 包名 / 签名须与 Play Console 一致。
- 账号加入 **License testers**，并从 **内测/封闭测试** 轨道安装（侧载 debug APK 往往无法完整验支付）。
- 商品 ID 已启用；订阅需 base plan。

## 日常更新前端资源

1. HBuilderX：发行 → 原生 App-本地打包 → 生成本地打包 App 资源  
2. 覆盖：
   ```bash
   rm -rf HBuilder-Integrate-AS/simpleDemo/src/main/assets/apps/__UNI__859C11F/www
   cp -R aiGrilFriend_new/unpackage/resources/__UNI__859C11F/www \
     HBuilder-Integrate-AS/simpleDemo/src/main/assets/apps/__UNI__859C11F/www
   ```
3. 若 UTS 源码有改，同步（firebase / attribution 仍用 HX 预编译 jar；IAP 为 Kotlin 源码模块）：
   ```bash
   cp unpackage/resources/uni_modules/trands-attribution/utssdk/app-android/src/index.kt \
     HBuilder-Integrate-AS/trands-attribution/src/main/java/index.kt
   cp unpackage/resources/uni_modules/trands-firebase-analytics/utssdk/app-android/src/index.kt \
     HBuilder-Integrate-AS/trands-firebase-analytics/src/main/java/index.kt
   # trands-google-iap：直接改 HBuilder-Integrate-AS/trands-google-iap/src/main/java/index.kt
   ```

## 工具链

- Gradle：`8.14.3`
- AGP：`8.12.0`
- Kotlin stdlib force：`2.2.0`（对齐 `utsplugin-release.aar`）
- UTS：`trands-attribution` / `trands-firebase-analytics` 用 HX 预编译 `index.jar`；**`trands-google-iap` 用 kotlin-android 编译源码**
- Fresco：`3.6.0`（含 `nativeimagetranscoder` / `nativeimagefilters`；替代 2.5.0，原生库满足 Android 16KB 页对齐；`packaging.jniLibs.useLegacyPackaging = false`）

## 打 AAB

Android Studio → `simpleDemo` → Build → Generate App Bundles / APKs → Android App Bundle → release  
或：

```bash
cd HBuilder-Integrate-AS
./gradlew :simpleDemo:bundleRelease
```

产物：
- Debug APK：`simpleDemo/build/outputs/apk/debug/simpleDemo-debug.apk`
- Release AAB：`simpleDemo/build/outputs/bundle/release/simpleDemo-release.aab`
- R8 mapping：`simpleDemo/build/outputs/mapping/release/mapping.txt`

## 验收

1. 启动、Google 登录、进首页  
2. Firebase DebugView 能看到事件  
3. 归因能读 GAID / Install Referrer  
4. **支付**：`VITE_USE_TRANDS_IAP=1` 的 www + `trands-google-iap` 模块可连 Billing；默认 tt www 在离线包上仍会失败但不崩溃  
5. 上传 Play 后看混淆/优化/缩减百分比  

## Firebase 事件「后端有、Console 没有」排查

产品埋点走 `trackProductEvent`：**Firebase + 后端双写**。后端入库 ≠ Firebase 已上报。

### 先看 Logcat（必查）

原生 UTS 已用 `android.util.Log`，tag 为 **`TrandsFA`**（`console.log` 在 Android Studio 按包名过滤时经常看不到）。

操作步骤：

1. **清空** Logcat 搜索框（不要残留旧 query）
2. 查询（二选一或 OR）：
   ```text
   tag:TrandsFA
   ```
   或同时看 Firebase SDK 自身：
   ```text
   tag:TrandsFA | tag:FA
   ```
3. Level 选 **Verbose**（否则 `FA` 的 `Logging event` 可能被滤掉）
4. **不要**用下面这种带方括号的 query（`[]` 会破坏 Logcat 查询语法）：
   ```text
   trands-firebase|[FirebaseAnalytics]|[env]
   ```
5. 验收前：**Force-stop** App → Clear logcat → **冷启动**（不要只热恢复）

正常冷启动应看到（tag=`TrandsFA`）：

- `configure => true`
- `logEvent ok: test_app_launch`（或正式名；`VITE_APP_ENV=test` 时事件名带 `test_`）
- `tag:FA` + Verbose 下可能还有 `Logging event: ...`

若出现 `ready=false` / `skip logEvent` / `native configure missing` / `logEvent skipped, analytics null`：原生 UTS 未链上或初始化失败，**后端仍会成功**。

### 常见原因（按优先级）

1. **事件名搜错**：当前 www 若以 `VITE_APP_ENV=test` 打包，实际上报是 `test_login` / `test_app_launch`，不是 `login`。在 DebugView / 实时报表搜带 `test_` 的名字。  
2. **装的是旧包**：`simpleDemo/release/` 里 8 月的 APK **不含** UTS；必须用接入 `trands-firebase-analytics` 后新打的 debug/release。  
3. **看错报表**：标准「事件」报表可延迟数小时～24h；请用 **DebugView**（设备开 `adb shell setprop debug.firebase.analytics.app com.gig.trandsai`）。  
4. **项目/包名**：Console 项目应为 `zeas-trandsai`，应用包名 `com.gig.trandsai`（与 `google-services.json` / `firebase_config.xml` 一致）。  

### UTS 注册说明（勿误改）

- API 型 UTS（`configure` / `logEvent`）由 JS `initUTSProxyFunction` 按包名 `uts.sdk.modules.trandsFirebaseAnalytics.IndexKt` 反射调用。  
- IAP：`uts.sdk.modules.trandsGoogleIap.IndexKt`（`connectByJs` / `isReadyByJs` / …）。  
- `assets/dcloud_uniplugins.json` 里 `nativePlugins: []` **正常**（该文件主要给组件 / 传统 UniModule）。  
- 不要把 `IndexKt` 配成 `type: module` 的 uniplugin（它不是 `UniModule` 子类）。  
- 离线模块：firebase/attribution 用 `api files('libs/index.jar')`；IAP 用 kotlin 源码 + `implementation project(':trands-google-iap')`；`simpleDemo` 需 `apply plugin: 'com.google.gms.google-services'`。
