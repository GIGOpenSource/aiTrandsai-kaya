# iOS 离线打包（Xcode）

结构与 kaya 的 `iosStudio` 对齐：DCloud `HBuilder-Hello` + 精简 `SDK` + CocoaPods `uniapp_subspecs`。

| 项 | 值 |
| --- | --- |
| appid | `__UNI__859C11F` |
| Bundle ID | `com.gig.trandsai` |
| 显示名 | Trands Ai |
| 版本 | 1.2.4 (124) |
| Team | `2B8F5HG6NF`（与 kaya 相同，可在 Xcode 改） |

`www` 编译产物不进 Git，只保留 `Pandora/apps/__UNI__859C11F/www/.gitkeep`。

## 每次发版

1. HBuilderX：发行 → 原生 App-本地打包 → 生成本地打包 App 资源。
2. 同步资源：

```bash
./iosStudio/HBuilder-Hello/scripts/sync-www.sh
```

脚本会按顺序找：

- `unpackage/resources/__UNI__859C11F/www`
- `unpackage/dist/build/app-plus`
- `dist/build/app-plus`

3. 首次必须 `pod install`（`Pods/` 不进 Git，kaya 能打开是因为本机已经装过）。最低系统 **iOS 14**（attribution 插件要求）。

```bash
cd iosStudio/HBuilder-Hello
pod install
open HBuilder-Hello.xcworkspace
```

不要只开 `.xcodeproj`。若 Xcode 里 Pods 仍红，关掉工程后重新打开 **xcworkspace**。

4. 用 **workspace**（不要只开 `.xcodeproj`）选真机或 Archive。Debug/Release 目前都是 Automatic 签名；描述文件请在 Xcode 里绑 `com.gig.trandsai`。

## UTS 插件

`uni_modules/*/utssdk/app-ios` 已拷到 `HBuilder-Hello/UTSPlugins/<插件名>/app-ios`。`pod install` 会扫描该目录。业务插件有改动时，再拷一遍对应文件夹后重新 `pod install`。

## 不要提交

Pods、DerivedData、ipa、以及 `www/**`（`.gitkeep` 除外）。完整官方 SDK 体积很大，保持与 kaya 一样只带启用模块所需的 Libs。
