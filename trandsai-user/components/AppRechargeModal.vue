<script setup>
/**
 * @file AppRechargeModal.vue
 * @description 会员订阅 / 积分充值弹窗（profile 页点击会员卡或积分卡打开）
 */
import { ref, computed, watch, toRefs } from "vue";
import { useI18n } from "vue-i18n";
import { api, unwrapApiResults } from "@/utils/api";
import { getItem, setItem } from "@/utils/storage";
import { showToast } from "@/stores/toast";
import { devLog, devWarn } from "@/utils/devLog";
import { interpolateN, getPayPlatform } from "@/utils/rechargeCatalog";
import { useRechargeCatalog } from "@/composables/useRechargeCatalog";
import {
  trackBenefitsPageView,
  trackButtonClick,
} from "@/utils/analytics";
// Android 支付 / 声明：勿在 iOS 包打进商店名相关字符串与插件
// #ifdef APP-PLUS
// #ifndef APP-IOS
import { startGooglePay as runGooglePay } from "@/utils/googlePay";
import { getAndroidRechargeDisclaimer } from "@/utils/rechargeDisclaimerAndroid";
// #endif
import { trackPurchaseSuccess } from "@/utils/firebaseAnalytics";
import { trackAttributionPurchase } from "@/utils/growthAttribution";
// #endif
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { useThemeStore } from "@/stores/theme";
import { useChatStore } from "@/stores/chat";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import { canUserPay } from "@/composables/useAuth";
import {
  openPrivacyPolicy,
  openAppleStandardEula,
} from "@/utils/openPrivacy";
import {
  OUR_MOMENTS_TIP_MS,
  readRecentOurMomentsTip,
} from "@/utils/ourMoments";
import {
  verifyReceiptUntilSettled,
  pickBalanceFromVerifyResults,
  pickCreditsAddedFromVerifyResults,
} from "@/utils/paymentVerify";

const { t, locale } = useI18n();
const themeStore = useThemeStore();
const chatStore = useChatStore();

const props = defineProps({
  open: { type: Boolean, default: false },
  defaultTab: { type: String, default: "vip" }, // 'vip' | 'points'
  isVip: { type: Boolean, default: false },
  vipPlan: { type: String, default: "Weekly" },
  vipExpireDate: { type: String, default: "" },
  vipType: { type: String, default: "" },
  points: { type: Number, default: 0 },
  vipName: { type: String, default: "" },
  /** 兼容旧调用；积分提示已改为按余额是否为 0 展示 */
  insufficient: { type: Boolean, default: false },
  /** 付费弹窗场景：agent_create | free_message | say_hi，用于漏斗埋点 */
  analyticsScene: { type: String, default: "" },
  /** 关联智能体 id（如聊天页免费消息弹窗） */
  companionId: { type: [String, Number], default: "" },
  /** say_hi 场景附加参数（弹窗打开时写入埋点） */
  analyticsExtra: { type: Object, default: () => ({}) },
  /** 从路由带入的 Our Moments tip（App nvue → 充值页） */
  momentsTip: { type: String, default: "" },
  /**
   * 强制普通充值墙（不切限时弹窗）。
   * 我的页会员/积分入口必须为 true。
   */
  skipLimitedOffer: { type: Boolean, default: false },
});

/** 弹窗内本地展示文案（不依赖外层 fixed tip 层级） */
const displayMomentsTip = ref("");
let displayMomentsTipTimer = null;

function showDisplayMomentsTip(text) {
  const next = String(text || "").trim();
  if (!next) return;
  displayMomentsTip.value = next;
  if (displayMomentsTipTimer) clearTimeout(displayMomentsTipTimer);
  displayMomentsTipTimer = setTimeout(() => {
    displayMomentsTip.value = "";
    displayMomentsTipTimer = null;
  }, OUR_MOMENTS_TIP_MS);
}

function syncMomentsTipFromSources() {
  const fromProp = String(props.momentsTip || "").trim();
  const fromPaywall = String(chatStore.paywallMomentsTip || "").trim();
  const fromLive = String(chatStore.ourMomentsTip?.text || "").trim();
  const fromStorage = readRecentOurMomentsTip();
  showDisplayMomentsTip(fromProp || fromPaywall || fromLive || fromStorage);
}

const { vipExpireDate } = toRefs(props);

const emit = defineEmits(["update:open", "purchased", "dismiss"]);

const tab = ref(props.defaultTab);
const paying = ref(false);
/** 点击支付时锁定本次购买类型，避免验单回调时 tab/选中项已变化 */
const pendingPurchase = ref(null);
/** 本次打开是否已成功付费 */
const purchasedThisOpen = ref(false);
/** 已切到限时弹窗：关充值墙时不再重复拉 limited-offer */
const switchedToLimitedOffer = ref(false);
/**
 * 真正画出普通充值墙之前先判限时：未就绪时不渲染，避免「先闪充值再切限时」。
 */
const surfaceVisible = ref(false);
/** 打开序号：异步判限时返回后若已关闭/重开则丢弃 */
let openSeq = 0;

function close() {
  paying.value = false;
  pendingPurchase.value = null;
  const purchased = purchasedThisOpen.value;
  const scene = String(props.analyticsScene || "").trim();
  const skipped = switchedToLimitedOffer.value;
  switchedToLimitedOffer.value = false;
  // 关掉未买：GET 校准限时状态（已无 event 接口）
  if (!purchased && !skipped) {
    try {
      useLimitedOfferStore().onPaywallDismissed(scene || "default");
    } catch (err) {
      console.warn("[recharge] limited offer sync failed", err);
    }
  }
  emit("update:open", false);
  emit("dismiss", { purchased, scene, switchedToLimitedOffer: skipped });
}

/** 商店支付失败/取消：保持限时倒计时（已无 event） */
function reportLimitedOfferPayFailed() {
  try {
    const scene = String(props.analyticsScene || "").trim() || "default";
    useLimitedOfferStore().onPayFailed(scene);
  } catch (err) {
    console.warn("[recharge] limited offer pay_failed", err);
  }
}

function setPendingPurchase(type, details = {}) {
  pendingPurchase.value = { type, ...details };
}

function buildPurchaseAnalyticsParams() {
  const ctx = pendingPurchase.value;
  if (ctx?.type === "vip") {
    return { type: "vip", product: String(ctx.planKey ?? "") };
  }
  if (ctx?.type === "points") {
    return { type: "points", product: String(ctx.points ?? "") };
  }
  if (tab.value === "vip") {
    return { type: "vip", product: String(selectedVipPlan.value ?? "") };
  }
  return { type: "points", product: String(selectedPoints.value ?? "") };
}

function notifyPurchased(meta = {}) {
  // Firebase：purchase_success(device, uid, method, product)
  try {
    const analyticsParams = buildPurchaseAnalyticsParams();
    trackPurchaseSuccess(analyticsParams);
    void trackAttributionPurchase(analyticsParams);
  } catch {
    /* ignore */
  }
  pendingPurchase.value = null;
  purchasedThisOpen.value = true;
  emit("purchased", meta);
}

function switchTab(next) {
  tab.value = next;
}

function selectVipPlan(key) {
  selectedVipPlan.value = String(key ?? "");
}

function selectPointsPack(pkg) {
  if (!pkg) return;
  selectedPackageKey.value = String(pkg.packageKey || pkg.id || "");
  selectedPoints.value = Number(pkg.points) || 0;
}

function isPointsPackActive(pkg) {
  if (!pkg) return false;
  const key = String(pkg.packageKey || pkg.id || "");
  if (selectedPackageKey.value) {
    return key === String(selectedPackageKey.value);
  }
  return Number(pkg.points) === Number(selectedPoints.value);
}

const {
  selectedVipPlan,
  selectedPackageKey,
  selectedPoints,
  vipPlans,
  pointPackages,
  benefitsLoading,
  catalogDebug,
  creditExplain,
  creditExplainReady,
  loadCatalog,
} = useRechargeCatalog(t);

const creditExplainLines = computed(() => {
  if (!creditExplainReady.value) return [];
  const chat = creditExplain.value.chat;
  const create = creditExplain.value.create_companion;
  const maintain = creditExplain.value.maintain_companion;
  return [
    interpolateN(t("recharge.pointsChat", { n: chat }), chat),
    interpolateN(t("recharge.pointsCreateAgent", { n: create }), create),
    interpolateN(t("recharge.pointsMaintenance", { n: maintain }), maintain),
  ];
});

/** 积分 Tab：仅控制「积分不足」提示是否展示；余额卡始终显示 */
const hasPoints = computed(() => Number(props.points) > 0);

/** 商店价格回来之前先转圈，出来时就是当前店面的价格 */
const catalogWaiting = computed(() => benefitsLoading.value);

const catalogReady = computed(() =>
  tab.value === "vip" ? vipPlans.value.length > 0 : pointPackages.value.length > 0
);

// ——— VIP 特权列表（i18n） ———
const vipBenefits = computed(() => [
  t("recharge.vipBenefit1"),
  t("recharge.vipBenefit2"),
  t("recharge.vipBenefit3"),
]);

watch(
  () => props.open,
  async (v) => {
    if (v) {
      const seq = ++openSeq;
      purchasedThisOpen.value = false;
      switchedToLimitedOffer.value = false;
      // 先不画充值墙，等限时判断结束
      surfaceVisible.value = false;
      tab.value = props.defaultTab;
      // 打开瞬间快照 tip，画在弹窗内部（不被 sheet 挡住）
      try {
        chatStore.captureMomentsTipForPaywall();
      } catch {
        /* ignore */
      }
      syncMomentsTipFromSources();
      trackBenefitsPageView();
      const scene = String(props.analyticsScene || "").trim();
      if (scene === "agent_create") {
        trackProductEvent(
          PRODUCT_EVENTS.AGENT_CREATE_PAY_POPUP,
          withCompanionId({ scene }, props.companionId)
        );
      } else if (scene === "free_message") {
        trackProductEvent(
          PRODUCT_EVENTS.FREE_MESSAGE_PAY_POPUP,
          withCompanionId({ scene }, props.companionId)
        );
      } else if (scene === "say_hi") {
        const extra =
          props.analyticsExtra && typeof props.analyticsExtra === "object"
            ? props.analyticsExtra
            : {};
        trackProductEvent(
          PRODUCT_EVENTS.SAY_HI_PAY_POPUP,
          withCompanionId({ scene, ...extra }, props.companionId)
        );
      }
      // 先判限时：能出则直接限时窗，不闪普通充值墙
      let openedLimited = false;
      if (!props.skipLimitedOffer) {
        try {
          openedLimited = await useLimitedOfferStore().onPaywallShown(
            scene || "default",
            { defaultTab: props.defaultTab }
          );
        } catch (err) {
          console.warn("[recharge] limited offer onPaywallShown", err);
        }
      }
      if (seq !== openSeq || !props.open) return;
      if (openedLimited) {
        switchedToLimitedOffer.value = true;
        surfaceVisible.value = false;
        emit("update:open", false);
        emit("dismiss", {
          purchased: false,
          scene,
          switchedToLimitedOffer: true,
        });
        return;
      }
      surfaceVisible.value = true;
      await loadCatalog();
    } else {
      openSeq += 1;
      surfaceVisible.value = false;
      displayMomentsTip.value = "";
      if (displayMomentsTipTimer) {
        clearTimeout(displayMomentsTipTimer);
        displayMomentsTipTimer = null;
      }
    }
  }
);

// 弹窗已打开时，后到的 our_moments 也能显示
watch(
  () => [
    chatStore.paywallMomentsTip,
    chatStore.ourMomentsTip && chatStore.ourMomentsTip.text,
    props.momentsTip,
  ],
  () => {
    if (!props.open) return;
    syncMomentsTipFromSources();
  }
);


const vipExpireText = computed(() => {
  if (!vipExpireDate.value) return "";
  const d = new Date(vipExpireDate.value);
  if (Number.isNaN(d.getTime())) return vipExpireDate.value;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return t("recharge.dateYmd", { y, m, d: day })
    .replace(/\{y\}/g, String(y))
    .replace(/\{m\}/g, String(m))
    .replace(/\{d\}/g, String(day));
});

const vipExpiresText = computed(() => {
  // 终身与订阅身份等价；仅展示不同：无到期日 / vip_type=lifetime → 永久有效
  if (props.isVip && (props.vipType === "lifetime" || !vipExpireDate.value)) {
    return t("recharge.vipLifetime");
  }
  const dateText = vipExpireText.value;
  if (!dateText) return "";
  return t("recharge.vipExpires", { date: dateText }).replace(/\{date\}/g, dateText);
});

/** 会员卡底栏日期：稿面只显示日期/终身，不加「到期」后缀 */
const vipCardDateText = computed(() => {
  if (props.isVip && (props.vipType === "lifetime" || !vipExpireDate.value)) {
    return t("recharge.vipLifetime");
  }
  return vipExpireText.value || "";
});

// ——— 底部按钮文案（i18n） ———
const actionBtnText = computed(() =>
  tab.value === "vip" ? t("recharge.subscribeNow") : t("recharge.topUpNow")
);

function getUsername() {
  try {
    const user = JSON.parse(getItem("user_info") || "{}");
    return user.username || String(user.id || "");
  } catch {
    return "";
  }
}

function isApplePlatform() {
  return getPayPlatform() === "apple";
}

function isAndroidPlatform() {
  return getPayPlatform() === "google";
}

/** iOS 审核：付费弹窗需可点的隐私协议 + 使用条款（Apple 标准 EULA） */
const showIosLegalLinks = computed(() => isApplePlatform());

function goPrivacy() {
  openPrivacyPolicy();
}

function goTerms() {
  openAppleStandardEula();
}

/** iOS 仅展示 App Store 声明；Android 专用声明在条件编译文件中 */
const rechargeDisclaimer = computed(() => {
  // #ifdef APP-PLUS
  // #ifndef APP-IOS
  if (isAndroidPlatform()) {
    return getAndroidRechargeDisclaimer(locale.value);
  }
  // #endif
  // #endif
  return t("recharge.disclaimer");
});

/** 支付成功后拉取最新用户信息并更新本地缓存，返回合并后的用户数据 */
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
        credits: data.credits ?? data.balance ?? prev.credits,
        vip_name: data.vip_name ?? prev.vip_name,
        vip_expire_at: data.vip_expire_at ?? prev.vip_expire_at,
        vip_type: data.vip_type ?? prev.vip_type,
      };
      setItem("user_info", JSON.stringify(merged));
      devLog("[AppRechargeModal] 用户信息已刷新:", merged);
    }
    // 等待 1 秒后拉取用户统计信息
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statsData = await api.get("/api/users/stats");
    devLog("[AppRechargeModal] /api/users/stats 返回:", JSON.stringify(statsData));
  } catch (err) {
    devWarn("[AppRechargeModal] 刷新用户信息失败:", err);
  }
  return merged;
}

// ═══════════════════════════════════════════
//  Apple IAP 支付
// ═══════════════════════════════════════════

function startApplePay(productId) {
  devLog("[ApplePay] 开始支付，productId:", productId);
  const username = getUsername();
  if (!username) {
    paying.value = false;
    showToast(t("recharge.needLogin"));
    return;
  }

  // #ifdef APP-PLUS
  plus.payment.getChannels(
    (channels) => {
      const iapChannel = channels.find((c) => c.id === "appleiap");
      if (!iapChannel) {
        paying.value = false;
        showToast(t("recharge.appleChannelMissing"));
        return;
      }

      iapChannel.requestProduct(
        [productId],
        (products) => {
          devLog("[ApplePay] requestProduct 成功:", JSON.stringify(products));
          const list = Array.isArray(products) ? products : [];
          const product =
            list.find((item) => String(item?.productid || item?.productId || "") === String(productId)) ||
            null;
          if (!product) {
            paying.value = false;
            showToast(t("recharge.productInfoFailed"));
            return;
          }
          // 苹果支付弹窗即将弹出，关闭等待标识
          paying.value = false;
          // 勿传 paymentDiscount：非促销优惠时传字符串（如 "否"）会触发
          // SKInternalErrorDomain Code=11 / SKErrorDomain Code=2
          uni.requestPayment({
            provider: "appleiap",
            orderInfo: {
              productid: product.productid,
              quantity: 1,
              username,
              manualFinishTransaction: false,
            },
            success: (e) => {
              void verifyAppleReceipt(e);
            },
            fail: (err) => {
              console.error("[ApplePay] payment failed:", err);
              const msg = String(err?.errMsg || err?.message || "");
              const cancelled =
                /SKErrorDomain Code=2/i.test(msg) ||
                /user cancel|取消/i.test(msg);
              reportLimitedOfferPayFailed();
              showToast(
                cancelled
                  ? t("recharge.paymentCancelled")
                  : t("recharge.paymentFailed")
              );
            },
          });
        },
        (err) => {
          console.error("[ApplePay] request product failed:", JSON.stringify(err));
          paying.value = false;
          showToast(t("recharge.productInfoFailed"));
        }
      );
    },
    (e) => {
      console.error("[ApplePay] get channels failed:", e);
      paying.value = false;
      showToast(t("recharge.channelFailed"));
    }
  );
  // #endif
}

async function verifyAppleReceipt(paymentResult) {
  devLog("[ApplePay] 验单参数:", paymentResult);
  paying.value = true;
  try {
    const payload = {
      transaction_identifier:
        paymentResult?.transactionIdentifier ||
        paymentResult?.transaction_identifier ||
        "",
    };
    devLog("[ApplePay] 后端校验传值:", payload);
    // 延迟 2 秒调用，等待后端处理
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settled = await verifyReceiptUntilSettled(
      () => api.post("/api/payment/verify-apple-receipt", payload),
      { maxAttempts: 4, delayMs: 2000 }
    );
    // 必须以 processed===true && status==="completed"；HTTP 200 不够
    if (!settled.paidOk) {
      const msg =
        String(settled.results?.message || "").trim() ||
        t("recharge.verifyFailed");
      console.warn("[ApplePay] verify not completed", settled.results);
      reportLimitedOfferPayFailed();
      showToast(msg);
      return;
    }
    let userData = null;
    const balance = pickBalanceFromVerifyResults(settled.results);
    userData = await refreshUserInfoAfterPurchase();
    // 总余额用 effective_balance/balance；不要把 credits_added 当余额
    if (balance != null) {
      if (userData && typeof userData === "object") {
        userData = { ...userData, credits: balance };
      } else {
        userData = { credits: balance };
      }
    }
    // 有本次增加额时显示「+N」；否则普通支付成功
    const added = pickCreditsAddedFromVerifyResults(settled.results);
    if (added > 0) {
      showToast(
        interpolateN(t("limitedOffer.purchaseSuccess", { n: added }), added).replace(
          /\{n\}/g,
          String(added)
        )
      );
    } else {
      showToast(t("recharge.paymentSuccess"));
    }
    notifyPurchased({ userData, verifyResults: settled.results });
    close();
  } catch (err) {
    console.error("[ApplePay] verify receipt failed:", err);
    reportLimitedOfferPayFailed();
    showToast(t("recharge.verifyFailed"));
  } finally {
    paying.value = false;
  }
}

// ═══════════════════════════════════════════
//  Android IAP（仅非 iOS 打包引入支付模块）
// ═══════════════════════════════════════════

function getAndroidPayContext() {
  return {
    paying,
    t,
    showToast,
    api,
    refreshUserInfoAfterPurchase,
    notifyPurchased,
    close,
    onPayFailed: reportLimitedOfferPayFailed,
  };
}

function startAndroidPay(productId, productType = "inapp") {
  // #ifdef APP-PLUS
  // #ifndef APP-IOS
  void runGooglePay(getAndroidPayContext(), productId, productType);
  return;
  // #endif
  // #endif
  paying.value = false;
  showToast(t("recharge.iapNotSupported"));
}

// ═══════════════════════════════════════════
//  支付入口
// ═══════════════════════════════════════════

function onAction() {
  if (paying.value || catalogWaiting.value || !catalogReady.value) return;
  if (!canUserPay()) {
    // 充值透明宿主页上 close() 会 navigateBack，和跳登录打架；统一 reLaunch
    showToast(t("login.guestCannotPay"));
    uni.reLaunch({
      url: "/pages/login/index",
      fail: () => {
        uni.redirectTo({ url: "/pages/login/index" });
      },
    });
    return;
  }
  const payMethod = tab.value === "vip" ? "vip" : "points";
  const scene = String(props.analyticsScene || "").trim();
  const product =
    payMethod === "vip"
      ? String(selectedVipPlan.value || "")
      : String(selectedPoints.value || "");
  trackProductEvent(
    PRODUCT_EVENTS.PAID_CLICK,
    withCompanionId(
      {
        method: payMethod,
        ...(scene ? { scene } : {}),
        ...(product ? { product } : {}),
      },
      props.companionId
    )
  );
  if (tab.value === "vip") {
    trackButtonClick("open_vip", "开通会员", "/benefits");
    paying.value = true;
    const plan = vipPlans.value.find(
      (p) => String(p.key) === String(selectedVipPlan.value)
    );
    devLog("[Pay] 选中VIP套餐:", JSON.stringify(plan));
    const appleId = plan?.appleProductId;
    const googleId = plan?.storeProductId;
    if (isApplePlatform() && !appleId) {
      paying.value = false;
      showToast(t("recharge.productIdMissing"));
      return;
    }
    if (isAndroidPlatform() && !googleId) {
      paying.value = false;
      showToast(t("recharge.productIdMissing"));
      return;
    }
    setPendingPurchase("vip", { planKey: selectedVipPlan.value });
    if (isApplePlatform()) {
      startApplePay(appleId);
    } else if (isAndroidPlatform()) {
      void startAndroidPay(googleId, "subs");
    } else {
      paying.value = false;
      showToast(t("recharge.iapNotSupported"));
    }
  } else {
    trackButtonClick("buy_credits", "购买积分", "/benefits");
    paying.value = true;
    const pkg =
      pointPackages.value.find(
        (p) => String(p.packageKey || p.id) === String(selectedPackageKey.value)
      ) ||
      pointPackages.value.find(
        (p) => Number(p.points) === Number(selectedPoints.value)
      );
    devLog("[Pay] 选中积分套餐:", JSON.stringify(pkg));
    const appleId = pkg?.appleProductId;
    const googleId = pkg?.storeProductId;
    if (isApplePlatform() && !appleId) {
      paying.value = false;
      showToast(t("recharge.productIdMissing"));
      return;
    }
    if (isAndroidPlatform() && !googleId) {
      paying.value = false;
      showToast(t("recharge.productIdMissing"));
      return;
    }
    setPendingPurchase("points", { points: selectedPoints.value });
    if (isApplePlatform()) {
      startApplePay(appleId);
    } else if (isAndroidPlatform()) {
      void startAndroidPay(googleId, "inapp");
    } else {
      paying.value = false;
      showToast(t("recharge.iapNotSupported"));
    }
  }
}

function goBills() {
  close();
  uni.navigateTo({ url: "/pages-sub/bills/index" });
}
</script>

<template>
  <view v-if="open && surfaceVisible" class="recharge-modal-mask" @tap="close">
    <view
      class="recharge-modal-sheet"
      :class="themeStore.isDark ? 'theme-dark' : 'theme-light'"
      @tap.stop
    >
      <!-- 关闭 -->
      <view class="recharge-modal-close" @tap="close">
        <text class="recharge-modal-close-text">✕</text>
      </view>

      <!-- 查价调试黄条：先隐藏，需要时把 false 改回 catalogDebug -->
      <view v-if="false && catalogDebug" class="recharge-debug">
        <text class="recharge-debug-text" selectable>{{ catalogDebug }}</text>
      </view>

      <!-- 顶部 Tab -->
      <view class="recharge-tabs">
        <view class="recharge-tab" :class="{ active: tab === 'vip' }" @tap="switchTab('vip')">
          <text class="recharge-tab-text">{{ t('recharge.subscribeVip') }}</text>
          <view v-if="tab === 'vip'" class="recharge-tab-line" />
        </view>
        <view class="recharge-tab" :class="{ active: tab === 'points' }" @tap="switchTab('points')">
          <text class="recharge-tab-text">{{ t('recharge.pointsTopUp') }}</text>
          <view v-if="tab === 'points'" class="recharge-tab-line" />
        </view>
      </view>

      <view class="recharge-modal-body-wrap">
        <scroll-view scroll-y class="recharge-modal-body">
          <!-- VIP Tab -->
          <template v-if="tab === 'vip'">
            <!-- 未开通：提示 + 特权卡 -->
            <template v-if="!isVip">
              <view class="vip-tip-bar">
                <image class="vip-tip-icon" src="/static/recharge/warning.svg" mode="aspectFit" />
                <text class="vip-tip-text">{{ t('recharge.needVip') }}</text>
              </view>

              <view class="privilege-card no-vip">
                <image
                  class="privilege-bg-img"
                  src="/static/recharge/vip-privilege-bg.svg"
                  mode="scaleToFill"
                />
                <image class="privilege-diamond" src="/static/recharge/vip-diamond-model.webp" mode="aspectFit" />
                <view class="privilege-content">
                  <text class="privilege-title">{{ t('recharge.vipPrivileges') }}</text>
                  <view class="privilege-list">
                    <view v-for="(item, idx) in vipBenefits" :key="idx" class="privilege-row">
                      <view class="privilege-check">✓</view>
                      <text class="privilege-text">{{ item }}</text>
                    </view>
                  </view>
                </view>
              </view>
            </template>

            <!-- 已开通：当前会员卡（布局对齐稿：标题顶右、底栏左日期续费 / 右账单） -->
            <view v-else class="current-vip-card">
              <view class="current-vip-bg" />
              <image class="current-vip-diamond" src="/static/recharge/vip-diamond-model.webp" mode="aspectFit" />
              <view class="current-vip-info">
                <text class="current-vip-plan">{{ vipName }}</text>
                <view class="current-vip-footer">
                  <view class="current-vip-left">
                    <text class="current-vip-date">{{ vipCardDateText }}</text>
                    <view class="current-vip-action">
                      <text class="current-vip-action-text">{{ isVip ? t('recharge.renew') : t('recharge.activate') }} ›</text>
                    </view>
                  </view>
                  <view class="current-vip-bills" @tap.stop="goBills">
                    <text>{{ t('recharge.bills') }}</text>
                    <image class="bills-icon" src="/static/recharge/arrow-white.svg" mode="aspectFit" />
                  </view>
                </view>
              </view>
            </view>

            <!-- 会员套餐 -->
            <view v-if="catalogWaiting" class="plan-loading">
              <view class="recharge-spinner recharge-spinner--light" />
              <text class="plan-loading-text">{{ t("recharge.loadingCatalog") }}</text>
            </view>
            <view v-else class="plan-grid">
              <view
                v-for="(plan, idx) in vipPlans"
                :key="`vip-${plan.key}-${idx}`"
                class="plan-card"
                hover-class="none"
                :class="{
                  active: String(selectedVipPlan) === String(plan.key),
                  save: Boolean(plan.save),
                }"
                @tap.stop="selectVipPlan(plan.key)"
              >
                <view
                  v-if="String(selectedVipPlan) === String(plan.key) && plan.save"
                  class="plan-save-badge"
                >
                  <text class="plan-save-badge-text">{{ plan.save }}</text>
                </view>
                <image
                  class="plan-watermark"
                  :src="String(selectedVipPlan) === String(plan.key) ? '/static/recharge/vip-text.svg' : '/static/recharge/vip-text-no.svg'"
                  mode="aspectFit"
                />
                <text class="plan-name">{{ plan.name }}</text>
                <view class="plan-price-row">
                  <text v-if="plan.showDollarPrefix" class="plan-currency">$</text>
                  <text class="plan-price">{{ plan.price }}</text>
                </view>
                <text v-if="plan.daily" class="plan-daily">{{ plan.daily }}</text>
                <text v-else class="plan-daily plan-daily-placeholder"> </text>
                <view class="plan-footer">
                  <text v-if="plan.points" class="plan-points">{{ plan.points }}</text>
                  <text v-if="plan.agents" class="plan-agents">{{ plan.agents }}</text>
                </view>
              </view>
            </view>
          </template>

          <!-- Points Tab -->
          <template v-else>
            <!-- 无积分时显示充值提示 -->
            <view v-if="!hasPoints" class="recharge-error-bar">
              <image class="recharge-error-icon" src="/static/recharge/warning.svg" mode="aspectFit" />
              <text class="recharge-error-text">{{ t('recharge.insufficientPoints') }}</text>
            </view>

            <!-- 积分余额卡始终展示 -->
            <view class="points-balance-card">
              <view class="points-balance-bg" />
              <image
                class="points-balance-icon"
                src="/static/recharge/points-icon.webp"
                mode="aspectFit"
              />
              <view class="points-balance-info">
                <view class="points-balance-footer">
                  <view class="points-balance-left">
                    <text class="points-balance-num">{{ points }}</text>
                    <text class="points-balance-label">{{ t('recharge.points') }}</text>
                  </view>
                  <view class="points-balance-bills" @tap.stop="goBills">
                    <text>{{ t('recharge.bills') }}</text>
                    <image class="bills-icon" src="/static/recharge/arrow-white.svg" mode="aspectFit" />
                  </view>
                </view>
              </view>
            </view>

            <!-- 积分套餐 -->
            <view v-if="catalogWaiting" class="plan-loading">
              <view class="recharge-spinner recharge-spinner--light" />
              <text class="plan-loading-text">{{ t("recharge.loadingCatalog") }}</text>
            </view>
            <view v-else class="plan-grid plan-grid--after-card">
              <view
                v-for="(pkg, idx) in pointPackages"
                :key="`pts-${pkg.packageKey || pkg.id}-${idx}`"
                class="plan-card points-plan"
                hover-class="none"
                :class="{ active: isPointsPackActive(pkg) }"
                @tap.stop="selectPointsPack(pkg)"
              >
                <view
                  class="points-plan-check"
                  :class="{ active: isPointsPackActive(pkg) }"
                >
                  <image class="points-plan-check-icon" src="/static/recharge/points-star.svg" mode="aspectFit" />
                </view>
                <text class="plan-name">{{ pkg.points }} {{ t('recharge.points') }}</text>
                <view class="plan-price-row">
                  <text v-if="pkg.showDollarPrefix" class="plan-currency">$</text>
                  <text class="plan-price">{{ pkg.price }}</text>
                </view>
                <text class="plan-daily">{{ pkg.discount }}</text>
                <text class="plan-daily plan-daily-placeholder"> </text>
              </view>
            </view>
          </template>

          <!-- 积分说明：与套餐同属 loadCatalog，共用上方 loading，就绪后再展示 -->
          <view v-if="creditExplainReady && !catalogWaiting" class="usage-section">
            <text class="usage-title">{{ t('recharge.pointsInfo') }}</text>
            <text
              v-for="(line, idx) in creditExplainLines"
              :key="idx"
              class="usage-line"
            >{{ line }}</text>
          </view>
        </scroll-view>
      </view>

      <!-- 底部固定按钮 -->
      <view class="recharge-modal-footer">
        <button
          class="recharge-action-btn"
          :disabled="paying || catalogWaiting || !catalogReady"
          @tap="onAction"
        >
          <view v-if="paying" class="recharge-btn-loading">
            <view class="recharge-spinner" />
            <text class="recharge-btn-loading-text">{{ t("recharge.processing") }}</text>
          </view>
          <view v-else-if="catalogWaiting" class="recharge-btn-loading">
            <view class="recharge-spinner" />
            <text class="recharge-btn-loading-text">{{ t("recharge.loadingCatalog") }}</text>
          </view>
          <template v-else>{{ actionBtnText }}</template>
        </button>
        <text class="recharge-disclaimer">
          {{ rechargeDisclaimer }}
        </text>
        <!-- iOS 审核：与登录页同款可点链接；条款走 Apple 标准 EULA -->
        <view v-if="showIosLegalLinks" class="recharge-legal-row">
          <text class="recharge-legal-link" @tap.stop="goPrivacy">{{ t("login.privacy") }}</text>
          <text class="recharge-legal-muted">{{ t("login.and") }}</text>
          <text class="recharge-legal-link" @tap.stop="goTerms">{{ t("login.terms") }}</text>
        </view>
      </view>
    </view>
    <!-- tip：fixed 盖在付费弹窗之上；约屏幕上方 1/4 -->
    <view
      v-if="displayMomentsTip"
      class="our-moments-on-paywall"
      :class="themeStore.isDark ? 'theme-dark' : 'theme-light'"
      @tap.stop
    >
      <text class="our-moments-on-paywall-text">{{ displayMomentsTip }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss" src="./AppRechargeModal.scss"></style>
