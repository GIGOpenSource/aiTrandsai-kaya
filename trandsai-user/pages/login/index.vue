<script setup>
import { ref, computed } from "vue";
import { onShow, onUnload } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import { openPrivacyPolicy } from "@/utils/openPrivacy";
import { useThemeStore } from "@/stores/theme";
import { trackLoginSuccess } from "@/utils/firebaseAnalytics"; // Firebase：社交登录成功埋点
import { trackAttributionLogin } from "@/utils/growthAttribution";
import { startForegroundDree0Timer } from "@/utils/productAnalyticsHelpers";
import { trackButtonClick } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import { rawFetch } from "@/utils/api";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import {
  parseAccountDeletionPayload,
  persistAuthSession,
} from "@/utils/accountDeletion";
import { fillI18n } from "@/utils/createCompanionForm";
import { pushUiLanguageToServer } from "@/utils/userLanguageSync";
import { useInboxWsStore } from "@/stores/inboxWs";
import { goAfterAuth, getDeviceId } from "@/composables/useAuth";
import { getAuthHeaders } from "@/utils/authHeaders";

const { t } = useI18n();
const themeStore = useThemeStore();

const loading = ref(false);
const showRestoreConfirm = ref(false);
const restoreDaysLeft = ref(7);
const restoreAccountConfirmText = computed(() =>
  fillI18n(t("login.restoreAccountConfirm", { days: restoreDaysLeft.value }), {
    days: restoreDaysLeft.value,
  })
);
/** 冷静期内：OAuth 原接口或游客 quick-login 再带 restore:true 重试 */
const pendingOAuth = ref(null);
/** 快速登录进行中；离开页面时作废，避免成功/取消各报一次 */
let quickLoginTicket = 0;

const sysInfo = uni.getSystemInfoSync();
const platform = String(sysInfo.platform || "").toLowerCase();
const uniPlatform = String(sysInfo.uniPlatform || "").toLowerCase();

// #ifdef H5
const isH5Env = true;
// #endif
// #ifndef H5
const isH5Env = false;
// #endif

/** H5 只展示账号密码登录；真机仍按系统能力显示社交登录 */
const isH5 = computed(
  () => isH5Env || uniPlatform === "web" || platform === "web"
);
const isIOS = computed(() => {
  const os = String(sysInfo.osName || "").toLowerCase();
  return (
    platform === "ios" ||
    platform === "mac" ||
    os === "ios" ||
    os === "macos" ||
    os === "ipados"
  );
});
const isAndroid = computed(() => platform === "android");

/** 登录页社交钮：H5 不展示；苹果真机不展示 Google */
const showApple = computed(() => !isH5.value && isIOS.value);
const showGoogle = computed(() => !isH5.value && isAndroid.value);

function trackQuickLoginFail(reason) {
  trackProductEvent(PRODUCT_EVENTS.QUICK_LOGIN_FAIL, {
    page: "login",
    reason,
  });
}

function applyDeletionResponse(res, extra = {}) {
  const deletion = parseAccountDeletionPayload(res && res.data);
  if (deletion?.kind === "closed" || (!deletion && extra.treat403AsClosed && res && res.status === 403)) {
    uni.showToast({ title: t("login.accountClosed"), icon: "none" });
    return "closed";
  }
  if (deletion?.kind === "pending") {
    restoreDaysLeft.value = deletion.daysLeft;
    showRestoreConfirm.value = true;
    return "pending";
  }
  return null;
}

/** 游客无密码：冷静期恢复只能 quick-login + restore，禁止 restore-account */
async function postQuickLogin(extra = {}) {
  const device_id = getDeviceId();
  return rawFetch("/api/auth/quick-login", {
    method: "POST",
    header: { "Content-Type": "application/json" },
    data: { device_id, ...extra },
  });
}

async function handleQuickLogin(opts = {}) {
  const restore = opts.restore === true;
  if (loading.value && !restore) return;
  const ticket = ++quickLoginTicket;
  loading.value = true;
  if (!restore) {
    trackProductEvent(PRODUCT_EVENTS.QUICK_LOGIN_CLICK, { page: "login" });
    trackButtonClick("login", "快速登录", "/login");
  }
  uni.showLoading({ title: t("login.loggingIn") });
  try {
    const device_id = getDeviceId();
    const res = await postQuickLogin(
      restore ? { restore: true, cancel_deletion: true } : {}
    );
    if (ticket !== quickLoginTicket) return;
    const deletionKind = applyDeletionResponse(res, { treat403AsClosed: true });
    if (deletionKind === "pending") {
      pendingOAuth.value = {
        kind: "guest",
        url: "/api/auth/quick-login",
        payload: { device_id },
        method: "guest",
      };
      return;
    }
    if (deletionKind === "closed") {
      trackQuickLoginFail("api_error");
      return;
    }
    if (!res.ok) {
      trackQuickLoginFail("api_error");
      uni.showToast({
        title: res.data?.message || (restore ? t("login.restoreFailed") : t("login.loginFailed")),
        icon: "none",
      });
      return;
    }
    const ok = finishOAuthLogin(res.data, "guest");
    if (ticket !== quickLoginTicket) return;
    if (ok) {
      pendingOAuth.value = null;
      trackProductEvent(PRODUCT_EVENTS.QUICK_LOGIN_SUCCESS, { page: "login" });
    } else {
      trackQuickLoginFail("exception");
    }
  } catch {
    if (ticket !== quickLoginTicket) return;
    trackQuickLoginFail("exception");
    uni.showToast({
      title: restore ? t("login.restoreFailed") : t("login.loginFailed"),
      icon: "none",
    });
  } finally {
    if (ticket === quickLoginTicket) {
      uni.hideLoading();
      loading.value = false;
    }
  }
}

/** 账号密码登录：跳转登录表单页 */
function goLogin() {
  trackProductEvent(PRODUCT_EVENTS.ACCOUNT_LOGIN_CLICK, { page: "login" });
  trackButtonClick("login", "登录", "/login");
  uni.navigateTo({ url: "/pages/login/account" });
}

function finishOAuthLogin(payload, method) {
  if (!persistAuthSession(payload)) {
    uni.showToast({ title: t("login.loginFailed"), icon: "none" });
    return false;
  }
  // 登录成功：把当前（首次安装时已识别的）手机/UI 语言写到用户表
  void pushUiLanguageToServer();
  try {
    trackLoginSuccess({
      method,
      user: payload?.user || payload?.results?.user,
    });
    void trackAttributionLogin({ method });
  } catch {
    /* ignore */
  }
  try {
    useInboxWsStore().ensureConnected();
  } catch {
    /* ignore */
  }
  try {
    startForegroundDree0Timer();
  } catch {
    /* ignore */
  }
  uni.showToast({ title: t("login.loginSuccess"), icon: "none" });
  setTimeout(() => {
    goAfterAuth();
  }, 600);
  return true;
}

async function postOAuthLogin(url, payload, method, extra = {}) {
  const res = await rawFetch(url, {
    method: "POST",
    header: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    data: { ...payload, ...extra },
  });
  const deletionKind = applyDeletionResponse(res);
  if (deletionKind === "closed") return;
  if (deletionKind === "pending") {
    pendingOAuth.value = { kind: "oauth", url, payload, method };
    return;
  }
  if (!res.ok) {
    uni.showToast({
      title: res.data?.message || t("login.loginFailed"),
      icon: "none",
    });
    return;
  }
  finishOAuthLogin(res.data, method);
}

async function handleRestoreOAuth() {
  const pending = pendingOAuth.value;
  if (!pending) return;
  if (pending.kind === "guest" || pending.method === "guest") {
    await handleQuickLogin({ restore: true });
    return;
  }
  uni.showLoading({ title: t("login.loggingIn") });
  try {
    await postOAuthLogin(pending.url, pending.payload, pending.method, {
      restore: true,
      cancel_deletion: true,
    });
  } catch {
    uni.showToast({ title: t("login.restoreFailed"), icon: "none" });
  } finally {
    uni.hideLoading();
  }
}

/** Apple 登录 */
function handleAppleLogin() {
  trackProductEvent(PRODUCT_EVENTS.APPLE_LOGIN_CLICK, { page: "login" });
  trackButtonClick("login", "登录", "/login");
  uni.showLoading({ title: t("login.loggingIn") });
  uni.login({
    provider: "apple",
    success: async (success) => {
      try {
        await postOAuthLogin(
          "/api/auth/applelogin",
          {
            id_token: success.appleInfo.identityToken,
            lastName: success.appleInfo.fullName?.familyName,
            firstName: success.appleInfo.fullName?.givenName,
          },
          "apple"
        );
      } catch {
        uni.showToast({ title: t("login.loginFailed"), icon: "none" });
      } finally {
        uni.hideLoading();
      }
    },
    fail: () => {
      uni.showToast({ title: t("login.loginFailed"), icon: "none" });
      uni.hideLoading();
    },
  });
}
/**
 * 调起 uni 端能力（uni.login / uni.getUserInfo）拿到 Google 凭证与用户信息
 * @returns {Promise<{ idToken?: string, accessToken?: string, userInfo?: object | null }>}
 */
const googleOAuthLogin = () => {
  // 第一步：uni.login 拿 authResult（idToken / accessToken）
  const login = () =>
    new Promise((resolve, reject) => {
      uni.login({
        provider: 'google',
        success: (loginRes) => resolve(loginRes.authResult || {}),
        fail: (err) => reject(err),
      })
    })

  // 第二步：uni.getUserInfo 拿 userInfo；失败时降级为 null（idToken 仍可用于登录）
  const getUserInfo = () =>
    new Promise((resolve) => {
      uni.getUserInfo({
        provider: 'google',
        success: (info) => resolve(info.userInfo || null),
        fail: () => resolve(null),
      })
    })

  return (async () => {
    const auth = await login()
    const userInfo = await getUserInfo()
    return userInfo
  })()
}

const handleGoogleLogin = async () => {
  trackProductEvent(PRODUCT_EVENTS.GOOGLE_LOGIN_CLICK, { page: "login" });
  trackButtonClick("login", "登录", "/login");
  uni.showLoading({ title: t('login.loggingIn') })
  try {
    const userInfo = await googleOAuthLogin();
    await postOAuthLogin("/api/auth/googlelogin", userInfo, "google");
  } catch (e) {
    console.error('Google 登录失败:', e)
    uni.showToast({ title: t('login.loginFailed'), icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function goPrivacy() {
  openPrivacyPolicy();
}

function goTerms() {
  const URL = "https://www.trandsai.com/agreement/Trands%20-%20Ai%20User%20Agreement.html";
  // #ifdef APP-PLUS
  plus.runtime.openURL(URL);
  // #endif
  // #ifdef H5
  window.open(URL, "_blank");
  // #endif
}

onShow(() => {
  trackProductEvent(PRODUCT_EVENTS.LOGIN_PAGE_SHOW, { page: "login" });
});

onUnload(() => {
  if (!loading.value) return;
  quickLoginTicket += 1;
  loading.value = false;
  uni.hideLoading();
  trackQuickLoginFail("cancel");
});
</script>

<template>
  <view class="entry-page shell-login-glow" :class="themeStore.isDark ? 'theme-dark' : 'theme-light'">
    <view class="entry-inner">
      <!-- Logo -->
      <view class="logo-wrap">
        <view class="logo-circle">
          <image src="/static/common/logo.svg"></image>
        </view>
        <text class="brand-name">Trands Ai</text>
        <text class="brand-tagline">{{ t("login.subtitle") }}</text>
      </view>

      <!-- 按钮组（对照 Figma 836:12792，避免全局 .btn-primary 覆盖） -->
      <view class="login-btns">
        <view class="login-cta" @tap="goLogin">
          <text class="login-cta-text">{{ t("login.accountPwdLogin") }}</text>
        </view>

        <view class="login-cta" @tap="handleQuickLogin">
          <text class="login-cta-text">{{ t("login.quickLogin") }}</text>
        </view>

        <view v-if="showApple" class="login-social" @tap="handleAppleLogin">
          <image class="login-social-ico icon-on-fg" src="/static/login/ico-apple.svg" mode="aspectFit" />
          <text class="login-social-text">{{ t("login.appleLogin") }}</text>
        </view>

        <view v-if="showGoogle" class="login-social" @tap="handleGoogleLogin">
          <image class="login-social-ico icon-on-fg" src="/static/login/ico-google.svg" mode="aspectFit" />
          <text class="login-social-text">{{ t("login.googleLogin") }}</text>
        </view>
      </view>

      <view class="agree-row">
        <text class="text-muted">{{ t("login.agree") }}</text>
        <text class="text-link" @tap="goPrivacy">{{ t("login.privacy") }}</text>
        <text class="text-muted">{{ t("login.and") }}</text>
        <text class="text-link" @tap="goTerms">{{ t("login.terms") }}</text>
      </view>
    </view>

    <AppConfirmDialog
      :open="showRestoreConfirm"
      :title="t('login.restoreAccountTitle')"
      :description="restoreAccountConfirmText"
      :confirm-text="t('login.restoreAccountConfirmBtn')"
      :cancel-text="t('common.cancel')"
      @update:open="showRestoreConfirm = $event"
      @confirm="handleRestoreOAuth"
    />
  </view>
</template>

<style scoped lang="scss">
.entry-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 稿面内容宽 311，屏 375 → 左右约 32px */
  padding: calc(env(safe-area-inset-top) + 48rpx) 64rpx calc(env(safe-area-inset-bottom) + 96rpx);
  box-sizing: border-box;
  background-color: var(--bg, #0a0a0a);
  /* 顶区柔光：见 .shell-login-glow */
  position: relative;
}

.entry-inner {
  width: 100%;
  max-width: 622rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ——— Logo 区域 ——— */
.logo-wrap {
  text-align: center;
  margin-bottom: 140rpx;
}

.logo-circle {
  width: 240rpx;
  height: 240rpx;
  margin: 0 auto 24rpx;
  border-radius: 58rpx;
  overflow: hidden;

  image {
    width: 100%;
    height: 100%;
  }
}

.brand-name {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: var(--fg, #fafafa);
  margin-bottom: 12rpx;
}

.brand-tagline {
  display: block;
  font-size: 28rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}

/* ——— 按钮组（Figma：311×51、圆角 16、间距 16） ——— */
.login-btns {
  width: 100%;
  max-width: 622rpx;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 32rpx;
  box-sizing: border-box;
}

.login-cta {
  width: 100%;
  height: 102rpx;
  border-radius: 32rpx;
  box-sizing: border-box;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 统一品牌渐变（theme --gradient-brand） */
  background: var(--gradient-brand) !important;
  border: none;
}

.login-cta-text {
  color: var(--fg-on-brand) !important;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 1;
  text-align: center;
}

.login-social {
  width: 100%;
  height: 102rpx;
  border-radius: 32rpx;
  box-sizing: border-box;
  padding: 0 32rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  background: var(--surface-inset, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-soft, rgba(255, 255, 255, 0.05));
}

.login-social-ico {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.login-social-text {
  color: var(--fg, #fafafa);
  font-size: 32rpx;
  font-weight: 500;
  line-height: 1;
}

.agree-row {
  position: absolute;
  left: 40rpx;
  right: 40rpx;
  bottom: calc(env(safe-area-inset-bottom) + 24rpx);
  text-align: center;
  font-size: 18rpx;
  line-height: 1.5;
}

.text-muted {
  color: var(--fg-muted, #8e8e93);
}

.text-link {
  color: #3291f6;
  text-decoration: underline;
  text-underline-offset: 2rpx;
}
</style>
