<script setup>
import { ref, computed } from "vue";
import { onShow, onUnload } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import { useThemeStore } from "@/stores/theme";
import { trackLoginSuccess } from "@/utils/firebaseAnalytics"; // Firebase：社交登录成功埋点
import { trackAttributionLogin } from "@/utils/growthAttribution";
import { startForegroundDree0Timer } from "@/utils/productAnalyticsHelpers";
import { trackButtonClick } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import { rawFetch, getApiBase } from "@/utils/api";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import {
  parseAccountDeletionPayload,
  persistAuthSession,
} from "@/utils/accountDeletion";
import { fillI18n } from "@/utils/createCompanionForm";
import { LOGIN_BRAND_NAME } from "@/utils/constants";
import { goAfterAuth, getDeviceId } from "@/composables/useAuth";
import { pushUiLanguageToServer } from "@/utils/userLanguageSync";
import { useInboxWsStore } from "@/stores/inboxWs";
import { getAuthHeaders } from "@/utils/authHeaders";

const loginBrandName = LOGIN_BRAND_NAME;

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
  if (
    deletion?.kind === "closed" ||
    (!deletion && extra.treat403AsClosed && res && res.status === 403)
  ) {
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
        title:
          res.data?.message ||
          (restore ? t("login.restoreFailed") : t("login.loginFailed")),
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
    startForegroundDree0Timer();
  } catch {
    /* ignore */
  }
  try {
    useInboxWsStore().ensureConnected();
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
    const body = res.data && typeof res.data === "object" ? res.data : {};
    const msg =
      body.message ||
      body.detail ||
      body.error ||
      (typeof res.data === "string" ? res.data : "") ||
      t("login.loginFailed");
    console.error("[OAuth] 后端拒绝", url, res.status, body);
    uni.showToast({
      title: String(msg).slice(0, 40),
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

function pickAppleIdentityToken(loginRes) {
  const info = loginRes?.appleInfo || {};
  const auth = loginRes?.authResult || {};
  const token =
    info.identityToken ||
    info.identity_token ||
    auth.identityToken ||
    auth.identity_token ||
    auth.id_token ||
    loginRes?.identityToken ||
    "";
  return String(token || "").trim();
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
        const idToken = pickAppleIdentityToken(success);
        const fullName = success?.appleInfo?.fullName || {};
        console.log(
          "[AppleLogin] api=",
          getApiBase(),
          "hasIdToken=",
          !!idToken,
          "keys=",
          success ? Object.keys(success) : []
        );
        if (!idToken) {
          uni.showToast({ title: t("login.loginFailed"), icon: "none" });
          return;
        }
        await postOAuthLogin(
          "/api/auth/applelogin",
          {
            id_token: idToken,
            lastName: fullName.familyName,
            firstName: fullName.givenName,
          },
          "apple"
        );
      } catch (e) {
        console.error("[AppleLogin] 失败", e);
        uni.showToast({ title: t("login.loginFailed"), icon: "none" });
      } finally {
        uni.hideLoading();
      }
    },
    fail: (err) => {
      console.error("[AppleLogin] uni.login fail", err);
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
        <image class="logo-mark" src="/static/vest/login/logo.svg" mode="aspectFit" />
        <text class="brand-name">{{ loginBrandName }}</text>
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
  justify-content: flex-start;
  /* 对照 273-2623 / 273-1992：Logo 约 y=216pt，首按钮约 y=520pt，底留白 */
  padding: calc(env(safe-area-inset-top) + 340rpx) 64rpx calc(env(safe-area-inset-bottom) + 80rpx);
  box-sizing: border-box;
  background-color: var(--bg, #0c0813);
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
  margin-bottom: 288rpx;
}

.logo-mark {
  width: 200rpx;
  height: 200rpx;
  display: block;
  margin: 0 auto 32rpx;
}

.brand-name {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: var(--fg, #fafafa);
  margin-bottom: 16rpx;
}

.brand-tagline {
  display: block;
  font-size: 28rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}

/* ——— 按钮组（Figma：全圆角胶囊 51pt、间距 16） ——— */
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
  border-radius: 9999px;
  box-sizing: border-box;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-brand) !important;
  border: none;
}

.login-cta-text {
  color: var(--fg-on-brand, #ffffff) !important;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 1;
  text-align: center;
}

.login-social {
  width: 100%;
  height: 102rpx;
  border-radius: 9999px;
  box-sizing: border-box;
  padding: 0 32rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.theme-light .login-social {
  background: #ffffff;
  border: 1px solid rgba(10, 10, 10, 0.1);
  box-shadow: 0 4rpx 16rpx rgba(10, 10, 10, 0.04);
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

.theme-light .login-social-text {
  color: #0a0a0a;
}
</style>
