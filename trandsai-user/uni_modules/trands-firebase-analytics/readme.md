# trands-firebase-analytics

## 结论（按这个来，别来回换实现）

| 场景 | 做法 |
|------|------|
| **云打包 / 制作自定义基座** | 用当前 **直接 import Firebase** 的 `index.uts`（已验证可打包、可上报） |
| **本地运行到手机** | 可能报「找不到名称 firebase」→ **忽略**，不要因此改代码 |
| **埋点调试** | 只改 `utils/firebaseAnalytics.js`、页面调用，**不要动 `.uts`** |

反射版会导致 **云打包 Kotlin 编译失败**，已废弃，勿再改回。

## 若改了 `.uts` 或换了基座

必须重新 **云端制作自定义调试基座** 一次。

## 事件

- `login` — 登录成功（method）
- `home_tab_click` — 首页顶栏 Tab（tab）
