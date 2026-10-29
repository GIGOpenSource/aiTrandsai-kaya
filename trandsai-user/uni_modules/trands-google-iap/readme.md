# trands-google-iap

自研 Google Play Billing 9 UTS 插件，与 `tt-google-iap` 并存。

- Android：真实 BillingClient 实现
- iOS：空实现（优雅失败）
- JS 开关：`VITE_USE_TRANDS_IAP=1` 时走本插件，默认仍用 `tt-google-iap`

详见 `docs/trands-google-iap.md`。
