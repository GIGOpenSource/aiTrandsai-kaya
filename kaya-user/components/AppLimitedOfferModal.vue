<script setup>
/**
 * @file AppLimitedOfferModal.vue
 * @description 限时优惠弹窗：标题/金币/价格/倒计时/购买；支付走现有 Apple/Google 验单。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, unwrapApiResults } from "@/utils/api";
import { getItem, setItem } from "@/utils/storage";
import { showToast } from "@/stores/toast";
import {
  formatGiftPoints,
  getPayPlatform,
  interpolateN,
} from "@/utils/rechargeCatalog";
import { canUserPay } from "@/composables/useAuth";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import {
  verifyReceiptUntilSettled,
  pickCreditsAddedFromVerifyResults,
  pickBalanceFromVerifyResults,
} from "@/utils/paymentVerify";

// #ifdef APP-PLUS
// #ifndef APP-IOS
import { startGooglePay as runGooglePay } from "@/utils/googlePay";
// #endif
import { trackPurchaseSuccess } from "@/utils/firebaseAnalytics";
import { trackAttributionPurchase } from "@/utils/growthAttribution";
// #endif

const { t } = useI18n();
const offer = useLimitedOfferStore();

/** 本组件内支付中态（与 store.paying 同步，避免双点） */
const localPaying = ref(false);

/** 样式预览：product.id === 'preview' 时不可真买 */
const isPreview = computed(() => String(offer.product?.id || "") === "preview");

/** 展示文案：原价 / 特惠标签+金额分开展示（字号不同）/ 可得金币 */
const originalPriceText = computed(() => {
  const price = offer.comparePrice;
  if (!price) return "";
  return interpolateN(
    t("limitedOffer.originalPrice", { price }),
    price
  ).replace(/\{price\}/g, price);
});

/** 「Sale Price」标签（去掉 {price}，金额另起 text） */
const salePriceLabel = computed(() =>
  t("limitedOffer.salePrice", { price: "" })
    .replace(/\{price\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
);

const salePriceAmount = computed(() => offer.storePrice || "");

/** discount_pct > 0 才出角标；复用充值文案「省 n%」 */
const discountBadgeText = computed(() => {
  const n = Number(offer.discountPct) || 0;
  if (n <= 0) return "";
  return interpolateN(t("recharge.savePct", { n }), n).replace(
    /\{n\}/g,
    String(n)
  );
});

const earnText = computed(() => {
  // subscribe → daily_gift_credits + Points/day；point → credits_amount
  if (offer.isSubscribeOffer) {
    const daily = formatGiftPoints(t, offer.dailyGiftCredits);
    if (daily) return daily;
  }
  const n = offer.creditsAmount;
  if (!(n > 0)) return "";
  return interpolateN(t("limitedOffer.earnCredits", { n }), n).replace(
    /\{n\}/g,
    String(n)
  );
});

/** 预览 / 支付中 / 已过期 → 禁用购买按钮 */
const buyDisabled = computed(
  () =>
    isPreview.value ||
    localPaying.value ||
    offer.paying ||
    offer.expired ||
    offer.remainingSec <= 0
);

/** 关闭弹窗（支付中不允许关） */
function close() {
  if (localPaying.value) return;
  offer.closeModal({ fromUser: true });
}

function isApplePlatform() {
  return getPayPlatform() === "apple";
}

function isAndroidPlatform() {
  return getPayPlatform() === "google";
}

/** 购后拉 /api/auth/me，合并本地 user_info */
async function refreshUserInfoAfterPurchase() {
  let merged = null;
  try {
    const data = unwrapApiResults(await api.get("/api/auth/me")) || {};
    if (data && typeof data === "object") {
      const raw = getItem("user_info");
      const prev = raw ? JSON.parse(raw) : {};
      merged = {
        ...prev,
        ...data,
        is_vip: data.is_vip ?? prev.is_vip,
        credits: data.credits ?? prev.credits,
      };
      setItem("user_info", JSON.stringify(merged));
    }
  } catch (err) {
    console.warn("[limitedOffer] refresh user failed", err);
  }
  return merged;
}

/**
 * 验单真正入账后的收口：刷新余额 → GET limited-offer → show!==true 才撤窗 → Toast。
 * Toast 用 credits_added（本次增加）；本地余额用 effective_balance/balance。
 */
async function settleLimitedOfferPaid(verifyResults) {
  const added = pickCreditsAddedFromVerifyResults(verifyResults);
  const balance = pickBalanceFromVerifyResults(verifyResults);
  let userData = await refreshUserInfoAfterPurchase();
  if (balance != null) {
    try {
      const raw = getItem("user_info");
      const prev = raw ? JSON.parse(raw) : {};
      const merged = {
        ...(userData && typeof userData === "object" ? userData : prev),
        credits: balance,
      };
      setItem("user_info", JSON.stringify(merged));
      userData = merged;
    } catch {
      /* ignore */
    }
  }
  try {
    const payType = offer.isSubscribeOffer ? "vip" : "points";
    const productKey = offer.isSubscribeOffer
      ? String(offer.product?.id || "limited_offer_vip")
      : String(added || offer.creditsAmount || "limited_offer");
    trackPurchaseSuccess({ type: payType, product: productKey });
    void trackAttributionPurchase({ type: payType, product: productKey });
  } catch {
    /* ignore */
  }
  // 仅当服务端 show!==true 才撤弹窗/悬浮窗
  await offer.markPurchasedSuccess();
  // Toast：本次增加额 = credits_added ?? credits，不要用 balance / 商品 credits_amount
  const n = added;
  showToast(
    interpolateN(t("limitedOffer.purchaseSuccess", { n }), n).replace(
      /\{n\}/g,
      String(n)
    )
  );
  return userData;
}

/** Apple：SDK purchased 后只 loading → 验单 processed+completed → 再结算 */
async function verifyApple(paymentResult) {
  localPaying.value = true;
  offer.paying = true;
  try {
    const payload = {
      transaction_identifier:
        paymentResult?.transactionIdentifier ||
        paymentResult?.transaction_identifier ||
        "",
    };
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settled = await verifyReceiptUntilSettled(
      () => api.post("/api/payment/verify-apple-receipt", payload),
      { maxAttempts: 4, delayMs: 2000 }
    );
    if (!settled.paidOk) {
      const msg =
        String(settled.results?.message || "").trim() ||
        t("recharge.verifyFailed");
      console.warn("[limitedOffer] apple verify not completed", settled.results);
      showToast(msg);
      offer.markPurchaseFail("verify_fail");
      return null;
    }
    return await settleLimitedOfferPaid(settled.results);
  } catch (err) {
    console.error("[limitedOffer] apple verify failed", err);
    showToast(t("recharge.verifyFailed"));
    offer.markPurchaseFail("verify_fail");
  } finally {
    localPaying.value = false;
    offer.paying = false;
  }
}

/** Apple IAP：取渠道 → 拉商品 → uni.requestPayment */
function startApplePay(productId) {
  // #ifdef APP-PLUS
  try {
    let username = "";
    try {
      const user = JSON.parse(getItem("user_info") || "{}");
      username = user.username || String(user.id || "");
    } catch {
      username = "";
    }
    if (!username) {
      localPaying.value = false;
      offer.paying = false;
      showToast(t("recharge.needLogin"));
      return;
    }
    plus.payment.getChannels(
      (channels) => {
        const list = Array.isArray(channels) ? channels : [];
        const iap = list.find((c) => c && c.id === "appleiap");
        if (!iap) {
          localPaying.value = false;
          offer.paying = false;
          showToast(t("recharge.appleChannelMissing"));
          offer.markPurchaseFail("no_channel");
          return;
        }
        iap.requestProduct(
          [productId],
          (products) => {
            const rows = Array.isArray(products) ? products : [];
            const product =
              rows.find(
                (item) =>
                  String(item?.productid || item?.productId || "") ===
                  String(productId)
              ) || null;
            if (!product) {
              localPaying.value = false;
              offer.paying = false;
              showToast(t("recharge.productInfoFailed"));
              offer.markPurchaseFail("product_info");
              return;
            }
            localPaying.value = false;
            offer.paying = false;
            uni.requestPayment({
              provider: "appleiap",
              orderInfo: {
                productid: product.productid,
                quantity: 1,
                username,
                manualFinishTransaction: false,
              },
              success: (e) => {
                // SDK purchased：只转圈验单，不要 Toast 成功
                localPaying.value = true;
                offer.paying = true;
                void verifyApple(e);
              },
              fail: (err) => {
                const msg = String(err?.errMsg || err?.message || "");
                const cancelled =
                  /SKErrorDomain Code=2/i.test(msg) ||
                  /user cancel|取消/i.test(msg);
                offer.markPurchaseFail(cancelled ? "cancel" : "fail");
                showToast(
                  cancelled
                    ? t("recharge.paymentCancelled")
                    : t("limitedOffer.purchaseFail")
                );
              },
            });
          },
          () => {
            localPaying.value = false;
            offer.paying = false;
            showToast(t("recharge.productInfoFailed"));
            offer.markPurchaseFail("product_info");
          }
        );
      },
      () => {
        localPaying.value = false;
        offer.paying = false;
        showToast(t("recharge.channelFailed"));
        offer.markPurchaseFail("channel_fail");
      }
    );
  } catch (err) {
    localPaying.value = false;
    offer.paying = false;
    showToast(t("recharge.iapNotSupported"));
    offer.markPurchaseFail("unsupported");
    console.warn("[limitedOffer] apple pay", err);
  }
  // #endif
  // #ifndef APP-PLUS
  localPaying.value = false;
  offer.paying = false;
  showToast(t("recharge.iapNotSupported"));
  offer.markPurchaseFail("unsupported");
  // #endif
}

/** Google Pay 回调上下文：验单已在 googlePayAndroid 按 processed+completed 判定 */
function getAndroidPayContext() {
  return {
    paying: localPaying,
    t,
    showToast,
    api,
    refreshUserInfoAfterPurchase,
    /** 跳过 googlePay 内置成功 Toast，由 settle 统一 Toast */
    skipSuccessToast: true,
    notifyPurchased: ({ verifyResults } = {}) => {
      localPaying.value = true;
      offer.paying = true;
      void settleLimitedOfferPaid(verifyResults).finally(() => {
        localPaying.value = false;
        offer.paying = false;
      });
    },
    close: () => {
      /* 成功时 store 按 show 撤窗；失败保持弹窗与倒计时 */
    },
    onPayFailed: () => {
      offer.markPurchaseFail("verify_fail");
    },
    onPayFail: () => {
      offer.markPurchaseFail("fail");
      showToast(t("limitedOffer.purchaseFail"));
    },
    onPayCancel: () => {
      offer.markPurchaseFail("cancel");
    },
  };
}

/** 限时商品 → Play Billing productType（订阅必须用 subs，否则 query 报 product not found） */
function googleProductTypeOf(product) {
  const raw = String(
    product?.product_type || product?.productType || product?.type || ""
  )
    .trim()
    .toLowerCase();
  if (
    raw === "subscribe" ||
    raw === "subscription" ||
    raw === "subs" ||
    raw === "vip"
  ) {
    return "subs";
  }
  return "inapp";
}

/** Android：走 utils/googlePay */
function startAndroidPay(productId, productType = "inapp") {
  // #ifdef APP-PLUS
  // #ifndef APP-IOS
  void runGooglePay(getAndroidPayContext(), productId, productType);
  return;
  // #endif
  // #endif
  localPaying.value = false;
  offer.paying = false;
  showToast(t("recharge.iapNotSupported"));
  offer.markPurchaseFail("unsupported");
}

/**
 * 点击「立即抢购」：
 * - preview 直接 return
 * - 校验登录/可支付 → 按平台走 Apple / Google
 */
function onBuy() {
  if (buyDisabled.value) return;
  if (isPreview.value) return;
  if (offer.expired || offer.remainingSec <= 0) {
    showToast(t("limitedOffer.expired"));
    return;
  }
  if (!canUserPay()) {
    // 聊天 nvue 上叠的透明宿主页：不能 close+navigateTo，宿主会 navigateBack 打架卡死
    showToast(t("login.guestCannotPay"));
    offer.redirectGuestToLogin();
    return;
  }
  const p = offer.product;
  if (!p) return;
  offer.markBuyClick();
  localPaying.value = true;
  offer.paying = true;
  const appleId = String(p.apple_product_id || "").trim();
  const googleId = String(p.store_product_id || "").trim();
  if (isApplePlatform()) {
    if (!appleId) {
      localPaying.value = false;
      offer.paying = false;
      showToast(t("recharge.productIdMissing"));
      return;
    }
    startApplePay(appleId);
  } else if (isAndroidPlatform()) {
    if (!googleId) {
      localPaying.value = false;
      offer.paying = false;
      showToast(t("recharge.productIdMissing"));
      return;
    }
    startAndroidPay(googleId, googleProductTypeOf(p));
  } else {
    localPaying.value = false;
    offer.paying = false;
    showToast(t("recharge.iapNotSupported"));
    offer.markPurchaseFail("unsupported");
  }
}

/** 弹窗关闭时复位支付态，避免下次打开卡住 */
watch(
  () => offer.modalOpen,
  (open) => {
    if (!open) {
      localPaying.value = false;
      offer.paying = false;
    }
  }
);
</script>

<template>
  <!-- 半透明遮罩：点空白关闭；z-index 见样式 -->
  <view
    v-if="offer.modalOpen"
    class="lo-mask"
    @tap="close"
  >
    <!-- 卡片 + 底部关闭按钮，阻止冒泡到 mask -->
    <view class="lo-card-wrap" @tap.stop>
      <!-- 主卡片：圆角白底 + 顶部金币溢出可见 -->
      <view class="lo-card">
        <!-- 卡片背景（粉白渐变 SVG） -->
        <image
          class="lo-card-bg"
          src="/static/discount/modal-bg.svg"
          mode="scaleToFill"
        />
        <!-- 顶部金币/% 装饰图，绝对定位叠在卡片上沿外 -->
        <image
          class="lo-header-coins"
          src="/static/discount/modal-header-coins.svg"
          mode="aspectFit"
        />
        <!-- 折扣角标：仅 discount_pct > 0 -->
        <view v-if="discountBadgeText" class="lo-discount-badge">
          <text class="lo-discount-badge-text">{{ discountBadgeText }}</text>
        </view>

        <!-- 正文区：标题 → 价格盒 → Ends in → 倒计时 → CTA → 脚注 -->
        <view class="lo-body">
          <!-- 主标题（原型斜体） -->
          <text class="lo-title">{{
            offer.title || t("limitedOffer.fallbackTitle")
          }}</text>

          <!-- 价格区：划线原价(折扣反推) / 现价 / Earn -->
          <view class="lo-price-box">
            <text v-if="originalPriceText" class="lo-original">{{
              originalPriceText
            }}</text>
            <view class="lo-sale-row">
              <text class="lo-sale-label">{{ salePriceLabel }}</text>
              <text class="lo-sale-amount">{{ salePriceAmount }}</text>
              <image
                class="lo-price-down"
                src="/static/discount/icon-price-down.svg"
                mode="aspectFit"
              />
            </view>
            <view v-if="earnText" class="lo-earn">
              <text class="lo-earn-text">{{ earnText }}</text>
              <image
                class="lo-earn-coin"
                src="/static/discount/icon-coin.svg"
                mode="aspectFit"
              />
            </view>
          </view>

          <!--
            「Ends in」：文案居中；两侧同一张 ends-ornament-side.svg
            只镜像图片本身（不要 scale 整个 side），保证左右对称
          -->
          <view class="lo-ends">
            <view class="lo-ends-side lo-ends-side--left">
              <image
                class="lo-ends-ornament"
                src="/static/discount/ends-ornament-side.svg"
                mode="aspectFit"
              />
            </view>
            <text class="lo-ends-label">{{
              offer.expired ? t("limitedOffer.expired") : t("limitedOffer.endsIn")
            }}</text>
            <view class="lo-ends-side lo-ends-side--right">
              <image
                class="lo-ends-ornament lo-ends-ornament--flip"
                src="/static/discount/ends-ornament-side.svg"
                mode="aspectFit"
              />
            </view>
          </view>

          <!-- 倒计时：mm:ss 四位数字格（store.digits） -->
          <view class="lo-countdown">
            <view class="lo-digit">
              <text class="lo-digit-text">{{ offer.digits.m0 }}</text>
            </view>
            <view class="lo-digit">
              <text class="lo-digit-text">{{ offer.digits.m1 }}</text>
            </view>
            <text class="lo-colon">:</text>
            <view class="lo-digit">
              <text class="lo-digit-text">{{ offer.digits.s0 }}</text>
            </view>
            <view class="lo-digit">
              <text class="lo-digit-text">{{ offer.digits.s1 }}</text>
            </view>
          </view>

          <!-- 购买 CTA；支付中显示转圈 -->
          <view
            class="lo-buy"
            :class="{ 'is-disabled': buyDisabled }"
            @tap="onBuy"
          >
            <view v-if="localPaying || offer.paying" class="lo-buy-loading" />
            <text v-else class="lo-buy-text">{{ t("limitedOffer.buyNow") }}</text>
          </view>

          <!-- 底部说明：Just for New User -->
          <text class="lo-footer">{{ t("limitedOffer.footer") }}</text>
        </view>
      </view>

      <!-- 卡片下方圆形关闭 -->
      <view class="lo-close" @tap="close">
        <image
          class="lo-close-img"
          src="/static/discount/icon-close.svg"
          mode="aspectFit"
        />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 字号分开调，不要共用一个值 */
$lo-title-size: 48rpx;
$lo-original-size: 28rpx;
$lo-sale-label-size: 40rpx;
$lo-sale-amount-size: 52rpx;
$lo-earn-size: 28rpx;

/* ========== 遮罩 / 外层 ========== */
/* 全屏半透明；内容垂直水平居中 */
.lo-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1300;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32rpx 64rpx 48rpx;
  box-sizing: border-box;
}

/* 卡片列容器：限宽 + 关闭按钮跟在下方 */
.lo-card-wrap {
  width: 100%;
  max-width: 560rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ========== 主卡片 ========== */
/* overflow:visible 让顶部金币能探出圆角外 */
.lo-card {
  position: relative;
  width: 100%;
  border-radius: 48rpx;
  overflow: visible;
  padding-top: 56rpx; /* 给金币下沉留一点顶空 */
}

/* 卡片背景图铺满 */
.lo-card-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  border-radius: 48rpx;
  z-index: 0;
}

/* 顶部金币装饰：叠在卡片上沿外；top 越负越靠上 */
.lo-header-coins {
  position: absolute;
  left: 50%;
  top: -132rpx;
  width: 340rpx;
  height: 200rpx;
  transform: translateX(-50%);
  z-index: 2;
  pointer-events: none;
}

/* 折扣角标：右上，仅配置了 discount_pct 时显示 */
.lo-discount-badge {
  position: absolute;
  right: 20rpx;
  top: 20rpx;
  z-index: 3;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: #ff2d55;
}

.lo-discount-badge-text {
  color: #ffffff;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.2;
}

/* ========== 正文区 ========== */
/* padding-top 控制标题相对金币的距离（不改金币 top） */
.lo-body {
  position: relative;
  z-index: 1;
  padding: 16rpx 32rpx 28rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 主标题：深红斜体；字号用 $lo-title-size；加重描边补粗 */
.lo-title {
  color: #8b0018;
  font-size: $lo-title-size;
  font-weight: 900;
  font-style: italic;
  text-align: center;
  line-height: 1.2;
  padding: 0 8rpx;
  -webkit-text-stroke: 0.6rpx #8b0018;
  word-break: break-word;
  max-width: 100%;
}

/* ========== 价格盒（加高 padding） ========== */
.lo-price-box {
  /* 相对弹窗外缘左右留空（勿过大） */
  margin: 20rpx 32rpx 0;
  align-self: stretch;
  background: #ffe8e8;
  border-radius: 28rpx;
  padding: 22rpx 24rpx 20rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 第1行原价：size 28 + 删除线 */
.lo-original {
  color: #c49a9f;
  font-size: $lo-original-size;
  font-style: normal;
  font-weight: 500;
  text-decoration: line-through;
  line-height: 1.2;
  text-align: center;
  word-break: break-word;
}

/* 第2行：Sale Price 标签 + 金额 + 下跌图标 */
.lo-sale-row {
  margin-top: 10rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
}

/* Sale Price 文案 size 40 / weight 510 */
.lo-sale-label {
  color: #8b0018;
  font-size: $lo-sale-label-size;
  font-weight: 510;
  font-style: normal;
  line-height: 1.1;
  margin-right: 8rpx;
  word-break: break-word;
}

/* 金额 size 52 / weight 700 */
.lo-sale-amount {
  color: #8b0018;
  font-size: $lo-sale-amount-size;
  font-weight: 700;
  font-style: normal;
  line-height: 1.1;
}

.lo-price-down {
  width: 32rpx;
  height: 32rpx;
  margin-left: 8rpx;
  align-self: center;
}

/*
 * 第3行 Earn 胶囊（对齐原型）：
 * 浅粉底 + 细描边胶囊；文案 28；金币约等于字高
 */
.lo-earn {
  margin-top: 14rpx;
  /* 文字/图标相对外框内边距 */
  padding: 12rpx 36rpx;
  border-radius: 999rpx;
  background: rgba(51, 0, 9, 0.03);
  border: 2rpx solid rgba(51, 0, 9, 0.05);
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.lo-earn-text {
  color: #e85a4a;
  font-size: $lo-earn-size;
  font-weight: 500;
  font-style: normal;
  line-height: 1;
}

.lo-earn-coin {
  width: 28rpx;
  height: 28rpx;
  margin-left: 6rpx;
  flex-shrink: 0;
}

/* ========== Ends in 分割行 ========== */
.lo-ends {
  margin-top: 24rpx;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

/* 左右侧对称：左贴右对齐、右贴左对齐，内边距相同 */
.lo-ends-side {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex: 1;
}

.lo-ends-side--left {
  justify-content: flex-end;
  padding-right: 10rpx;
}

.lo-ends-side--right {
  justify-content: flex-start;
  padding-left: 10rpx;
}

/* 单侧装饰；右侧只翻图片 */
.lo-ends-ornament {
  width: 128rpx;
  height: 24rpx;
  flex-shrink: 0;
}

.lo-ends-ornament--flip {
  transform: scaleX(-1);
}

.lo-ends-label {
  color: #b08a90;
  font-size: 28rpx;
  font-style: normal;
  font-weight: 500;
  flex-shrink: 1;
  max-width: 46%;
  line-height: 1.2;
  text-align: center;
  word-break: break-word;
}

/* ========== 倒计时四格 ========== */
.lo-countdown {
  margin-top: 16rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

/* 单格：红橙纵向渐变圆角方块 */
.lo-digit {
  width: 56rpx;
  height: 56rpx;
  margin: 0 6rpx;
  border-radius: 14rpx;
  background: linear-gradient(180deg, #f98e84 0%, #e84232 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lo-digit-text {
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 700;
  font-style: normal;
  line-height: 1;
}

.lo-colon {
  color: #e84232;
  font-size: 34rpx;
  font-weight: 700;
  font-style: normal;
  margin: 0 4rpx;
  line-height: 1;
}

/* ========== 购买按钮（主题色 + 与价格盒同左右空隙） ========== */
.lo-buy {
  margin: 24rpx 32rpx 0;
  align-self: stretch;
  height: 92rpx;
  border-radius: 999rpx;
  background: var(--gradient-brand-btn);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lo-buy.is-disabled {
  opacity: 0.45;
}

.lo-buy-text {
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 600;
  font-style: normal;
  padding: 0 24rpx;
  text-align: center;
  word-break: break-word;
}

/* 支付中转圈 */
.lo-buy-loading {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  animation: lo-spin 0.8s linear infinite;
}

@keyframes lo-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ========== 脚注 / 关闭 ========== */
.lo-footer {
  margin-top: 16rpx;
  color: rgba(165, 124, 113, 1);
  font-size: 22rpx;
  font-style: normal;
  text-align: center;
  padding: 0 16rpx;
  word-break: break-word;
}

.lo-close {
  margin-top: 32rpx;
  width: 72rpx;
  height: 72rpx;
}

.lo-close-img {
  width: 72rpx;
  height: 72rpx;
}
</style>
