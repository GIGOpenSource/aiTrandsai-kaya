
> 本文说明：**基础配置总表**（启动页、版本号、图标、包名、签名…）+ HX 导出流程 + Gradle/16KB/R8 细节。  
> 路径一律写完整绝对路径模板，换机时只改前缀即可。  
> **日常先翻「基础配置总表」**；后文是同一批项的展开说明。

下文根目录缩写：

```text
AS_ROOT=/Users/ww/workSdk/Android-SDK@5.15.82650_20260710/HBuilder-Integrate-AS
APP     =$AS_ROOT/simpleDemo
UNI     =/Users/ww/project/aiGrilFriend_new
```

---

## 基础配置总表（启动页 / 版本号 / 图标 / 包名…全部在这）

> 这是「改外观和身份」最常用的一张表。详细原理见后文各节。

### A. 应用身份与版本

| 要改什么 | 完整路径 | 改哪里 / 怎么改 | 干什么 |
|----------|----------|-----------------|--------|
| **应用包名** | `$APP/build.gradle` | `defaultConfig.applicationId`、`namespace` | 安装包唯一 ID；须与 Play / Firebase / Google 登录 SHA 配置一致 |
| **版本号（数字）** | `$APP/build.gradle` | `defaultConfig.versionCode`（如 `155`） | 每次上架必须 **递增**；系统用它判断升级 |
| **版本名（展示）** | `$APP/build.gradle` | `defaultConfig.versionName`（如 `"1.5.5"`） | 用户看到的版本，如设置页/商店 |
| **最低/目标 SDK** | `$APP/build.gradle` | `minSdkVersion` / `targetSdkVersion` / `compileSdkVersion` | 兼容范围与上架要求（你们参考：24 / 36 / 36） |
| **CPU 架构** | `$APP/build.gradle` | `ndk.abiFilters` | 打进包的 so 架构，如 `'armeabi-v7a', 'arm64-v8a'` |
| **桌面显示名** | `$APP/src/main/AndroidManifest.xml` | `android:label="Trands Ai"`（application 与 activity 上） | 桌面图标下方名字 |
| **strings 里的 app_name** | `$APP/src/main/res/values/strings.xml` | `<string name="app_name">...</string>` | 部分系统/库读这个；建议与 label 一致（参考工程里可能仍是 `HBuilder-SimpleDemo-AS`，应改成正式名） |
| **DCloud 离线 appkey** | `$APP/src/main/AndroidManifest.xml` | `<meta-data android:name="dcloud_appkey" android:value="..."/>` | 离线打包校验；错了弹「未配置appkey」 |
| **uni AppID 目录** | `$APP/src/main/assets/apps/__UNI__859C11F/` | 文件夹名必须等于 HX 的 `manifest.appid` | 壳从这里加载 www |
| **深链 scheme** | `$APP/src/main/AndroidManifest.xml` | `<data android:scheme="trandsai" />` | `trandsai://...` 打开 App |

**注意版本号双源：**

| 位置 | 路径 | 说明 |
|------|------|------|
| **真正上架生效（离线 AS）** | `$APP/build.gradle` 的 `versionCode` / `versionName` | Play / 安装包以这个为准 |
| HX 工程 manifest | `$UNI/manifest.json` → `versionName` / `versionCode` | 云打包用；离线时 **不会自动同步**到 AS，两边建议改成一致以免混乱 |

---

### B. 图标 / 启动图 / 推送图

| 要改什么 | 完整路径 | 怎么改 | 干什么 |
|----------|----------|--------|--------|
| **桌面图标** | `$APP/src/main/res/mipmap/ic_launcher.png` | 替换 png；Manifest 已写 `@mipmap/ic_launcher` | 手机桌面看到的图标 |
| **桌面图标引用** | `$APP/src/main/AndroidManifest.xml` | `android:icon` / `android:roundIcon` | 指向 mipmap 资源 |
| **原生启动闪屏** | `$APP/src/main/res/drawable-nodpi/splash.9.png` | 用 `/Users/ww/Tools/make_splash_9patch.py` 生成后安装 | 点图标后立刻全屏图（**必须 nodpi**，放 `drawable/` 会巨大） |
| **旧启动图（勿再用）** | `$APP/src/main/res/drawable/splash.png` 或 `splash.9.png` | 应移走或删掉，避免和 nodpi 冲突/放大 | 普通 drawable 会按 mdpi 放大 |
| **推送通知小图标** | `$APP/src/main/res/drawable/push.png` | 换简单白剪影+透明底 | 通知栏左边小图标 |
| **drawable/icon.png** | `$APP/src/main/res/drawable/icon.png` | 可选；**不是**桌面主图标 | DCloud 遗留/备用 |
| **业务启动页大图（Skip 那页）** | 前端 `$UNI/static/splash/hero.png` → 重新导出 www 覆盖 assets | 原生闪屏关掉后的 Vue 页 | 与 `splash.9.png` 不是同一张 |

启动图一键安装示例：

```bash
python3 /Users/ww/Tools/make_splash_9patch.py \
  --input ~/Desktop/启动图.png \
  --install-as \
  "/Users/ww/workSdk/Android-SDK@5.15.82650_20260710/HBuilder-Integrate-AS/simpleDemo"
```

说明文档：`/Users/ww/Tools/make_splash_9patch.md`

---

### C. 签名与密钥

| 要改什么 | 完整路径 | 怎么改 | 干什么 |
|----------|----------|--------|--------|
| **签名文件** | `$APP/app.keystore` | 换成你们正式 keystore | 包签名；内购/登录依赖一致 |
| **签名配置** | `$APP/build.gradle` → `signingConfigs.config` | `storeFile` / `keyAlias` / 两个 password | debug/release 用哪套签名 |
| **debug/release 是否签名** | `$APP/build.gradle` → `buildTypes.*.signingConfig` | 指向 `signingConfigs.config` | 不配则 debug 可能是临时签名 |

查 SHA-1（配 Google 登录）：

```bash
keytool -list -v -keystore \
  "/Users/ww/workSdk/Android-SDK@5.15.82650_20260710/HBuilder-Integrate-AS/simpleDemo/app.keystore"
```

---

### D. 前端资源与环境

| 要改什么 | 完整路径 | 怎么改 | 干什么 |
|----------|----------|--------|--------|
| **业务 www** | `$APP/src/main/assets/apps/__UNI__859C11F/www/` | HX 导出后整目录覆盖 | 页面、逻辑、静态资源 |
| **API / 环境变量** | `$UNI/.env` | 改 `VITE_*` 后 **必须重新导出 www** | 编译期写入前端；只改 AS 无效 |
| **支付后端开关** | `$UNI/.env` → `VITE_USE_TRANDS_IAP` | `0`=tt，`1`=自研 trands | 离线测支付用 1 |
| **HX 模块/OAuth/支付勾选** | `$UNI/manifest.json` | `modules` / `sdkConfigs` | 云打包/基座用；离线还要 AS 侧 aar/依赖 |

覆盖 www 命令见第 1.2 节。

---

### E. Firebase / Google / 支付相关文件

| 要改什么 | 完整路径 | 怎么改 | 干什么 |
|----------|----------|--------|--------|
| **Firebase json** | `$APP/google-services.json` | 从 Firebase Console 下载，包名一致 | 埋点初始化 |
| **google-services 插件** | `$APP/build.gradle` 末尾 `apply plugin: 'com.google.gms.google-services'` | 不要删 | 读取上面的 json |
| **插件 classpath** | `$AS_ROOT/build.gradle` | `classpath 'com.google.gms:google-services:…'` | 提供插件本身 |
| **Firebase 字符串兜底** | `$APP/src/main/res/values/firebase_config.xml` | 可选；与 json 一致 | 无插件时兜底 |
| **Google 登录 aar** | `$APP/libs/oauth-google-release.aar`（文件名以目录为准） | 放入 libs | 离线 Google 登录 |
| **Play Billing** | `$APP/build.gradle` → `billing:9.1.0` + `:trands-google-iap` | 依赖 | 应用内购买 |
| **Billing 权限** | `$APP/src/main/AndroidManifest.xml` | `com.android.vending.BILLING` | 允许 IAP |
| **广告 ID 权限** | 同上 | `com.google.android.gms.permission.AD_ID` | 归因 GAID |

---

### F. 构建行为（R8 / 16KB / 仓库）

| 要改什么 | 完整路径 | 怎么改 | 干什么 |
|----------|----------|--------|--------|
| **打开/关闭混淆** | `$APP/build.gradle` → `release.minifyEnabled` | `true`/`false` | R8 压缩混淆 |
| **资源缩减** | 同上 → `shrinkResources` | 通常与 minify 一起 true | 删未用资源 |
| **混淆 keep 规则** | `$APP/proguard-rules.pro` | 加 `-keep` | 防止 DCloud/UTS/支付被打挂 |
| **额外 ignore** | `$APP/proguard-ignore.pro` | 按需 | 抑制告警等 |
| **mapping 文件** | `$APP/build/outputs/mapping/release/mapping.txt` | 打 release 后生成 | 崩溃还原 |
| **16KB 对齐** | `$APP/build.gradle` → `packaging.jniLibs.useLegacyPackaging` | 上架建议 **`false`** | Play 16KB 页要求 |
| **Fresco 版本（16KB）** | `$APP/build.gradle` dependencies + force | `3.6.0` | 旧 so 不对齐 |
| **模块列表** | `$AS_ROOT/settings.gradle` | `include ':trands-…'` | 注册 UTS 模块 |
| **AndroidX** | `$AS_ROOT/gradle.properties` | `android.useAndroidX=true` | 使用 AndroidX |

---

### G. 权限与窗口（Manifest 其它）

**文件：** `$APP/src/main/AndroidManifest.xml`

| 项 | 干什么 |
|----|--------|
| `INTERNET` | 访问网络 |
| `ACCESS_NETWORK_STATE` | 读网络状态 |
| `VIBRATE` | 震动 |
| `android:largeHeap` | 更大堆（图片多时） |
| `android:extractNativeLibs` | 是否解压 so；与 DCloud 壳兼容常为 true |
| `windowSoftInputMode` | 键盘顶起方式（`adjustResize` 等） |
| `screenOrientation` | 横竖屏 |
| `exported` | 是否可被外部拉起（Launcher 必须 true） |

---

### H. 主题 / 样式

| 文件 | 完整路径 | 干什么 |
|------|----------|--------|
| `styles.xml` | `$APP/src/main/res/values/styles.xml` | `DCloudTheme` / `TranslucentTheme` 等启动主题 |
| 启动主题引用 | Manifest 里 activity 的 `android:theme` | 闪屏阶段窗口样式；深色主题可能导致透明启动图透出黑底 |

---

### I. 一张「改完检查」小清单

发版前至少确认：

- [ ] `versionCode` 已 +1，`versionName` 已改  
- [ ] `applicationId` / Firebase json / Play 包名一致  
- [ ] `dcloud_appkey` 正确  
- [ ] `ic_launcher`、`drawable-nodpi/splash.9.png`、`push.png` 已换成新图  
- [ ] `label` / `strings.xml` 的名字正确  
- [ ] www 已用最新 HX 导出覆盖  
- [ ] release：`minifyEnabled true`，mapping 已保存  
- [ ] 上架：`useLegacyPackaging false` + Fresco 3.6  