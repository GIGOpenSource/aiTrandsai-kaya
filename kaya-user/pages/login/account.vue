<script setup>
/**
 * @file pages/login/account — 账号密码登录（对照 Figma 836:12846）
 * @description 邮箱/用户名 + 密码登录；使用 rawFetch 避免 401 跳转死循环。
 * @depends rawFetch、storage
 */
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { rawFetch } from "@/utils/api";
import { useChatStore } from "@/stores/chat";
import { bindAnalyticsTap } from "@/utils/analytics";
import { readSafeArea } from "@/composables/useStatusBar";
import { useThemeStore } from "@/stores/theme";
import { setupPushIfLoggedIn } from "@/utils/push";
import { trackLoginSuccess } from "@/utils/firebaseAnalytics"; // Firebase：账号密码登录成功埋点
import { trackAttributionLogin } from "@/utils/growthAttribution";
import { startForegroundDree0Timer } from "@/utils/productAnalyticsHelpers";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import {
  parseAccountDeletionPayload,
  persistAuthSession,
} from "@/utils/accountDeletion";
import { fillI18n } from "@/utils/createCompanionForm";
import { LOGIN_BRAND_NAME } from "@/utils/constants";
import { goAfterAuth } from "@/composables/useAuth";
import { pushUiLanguageToServer } from "@/utils/userLanguageSync";
import { useInboxWsStore } from "@/stores/inboxWs";

const { t } = useI18n();
const themeStore = useThemeStore();
const loginBrandName = LOGIN_BRAND_NAME;
const safe = readSafeArea();

const email = ref("");
const password = ref("");
const showPassword = ref(false);
const emailError = ref("");
const passwordError = ref("");
const emailTouched = ref(false);
const passwordTouched = ref(false);
const loading = ref(false);
const showRestoreConfirm = ref(false);
const restoreDaysLeft = ref(7);
const restoreAccountConfirmText = computed(() =>
  fillI18n(t("login.restoreAccountConfirm", { days: restoreDaysLeft.value }), {
    days: restoreDaysLeft.value,
  })
);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[A-Za-z0-9_\u4e00-\u9fa5.-]{2,64}$/;

const canSubmit = computed(
  () =>
    !!email.value.trim() &&
    !!password.value &&
    !emailError.value &&
    !passwordError.value
);

function isValidAccount(value) {
  const v = (value || "").trim();
  if (!v) return false;
  return EMAIL_REGEX.test(v) || USERNAME_REGEX.test(v);
}

function validateEmail() {
  const trimEmail = email.value.trim();
  if (!emailTouched.value) return;
  if (!trimEmail) {
    emailError.value = t("login.errorEmailEmpty");
  } else if (!isValidAccount(trimEmail)) {
    emailError.value = t("login.errorEmailFormat");
  } else {
    emailError.value = "";
  }
}

function validatePassword() {
  if (!passwordTouched.value) return;
  if (!password.value) {
    passwordError.value = t("login.errorPwdEmpty");
  } else {
    passwordError.value = "";
  }
}

watch(email, validateEmail);
watch(password, validatePassword);

function currentAccount() {
  const trimEmail = email.value.trim();
  return EMAIL_REGEX.test(trimEmail) ? trimEmail.toLowerCase() : trimEmail;
}

function finishLoggedIn(payload, method = "email") {
  if (!persistAuthSession(payload)) return false;
  void pushUiLanguageToServer();
  try {
    trackLoginSuccess({ method, user: payload?.user || payload?.results?.user });
    void trackAttributionLogin({ method });
  } catch {
    /* ignore */
  }
  try {
    useChatStore().reloadForCurrentUser();
  } catch {
    /* ignore */
  }
  try {
    useInboxWsStore().ensureConnected();
  } catch {
    /* ignore */
  }
  try {
    setupPushIfLoggedIn();
  } catch {
    /* ignore */
  }
  try {
    startForegroundDree0Timer();
  } catch {
    /* ignore */
  }
  goAfterAuth();
  return true;
}

async function handleRestoreAccount() {
  loading.value = true;
  try {
    const res = await rawFetch("/api/auth/restore-account", {
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: { username: currentAccount(), password: password.value },
    });
    if (!res.ok || parseAccountDeletionPayload(res.data)?.kind === "closed") {
      uni.showToast({
        title:
          parseAccountDeletionPayload(res.data)?.kind === "closed"
            ? t("login.accountClosed")
            : res.data?.message || t("login.restoreFailed"),
        icon: "none",
      });
      return;
    }
    if (!finishLoggedIn(res.data)) {
      uni.showToast({ title: t("login.restoreFailed"), icon: "none" });
    }
  } catch {
    uni.showToast({ title: t("common.networkError"), icon: "none" });
  } finally {
    loading.value = false;
  }
}

async function handleLogin() {
  emailTouched.value = true;
  passwordTouched.value = true;

  emailError.value = "";
  passwordError.value = "";
  const trimEmail = email.value.trim();
  let hasError = false;

  if (!trimEmail) {
    emailError.value = t("login.errorEmailEmpty");
    hasError = true;
  } else if (!isValidAccount(trimEmail)) {
    emailError.value = t("login.errorEmailFormat");
    hasError = true;
  }

  if (!password.value) {
    passwordError.value = t("login.errorPwdEmpty");
    hasError = true;
  }

  if (hasError) {
    return;
  }
  loading.value = true;
  try {
    const account = currentAccount();
    const res = await rawFetch("/api/auth/login", {
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: { username: account, password: password.value },
    });
    const deletion = parseAccountDeletionPayload(res.data);
    if (deletion?.kind === "closed") {
      uni.showToast({ title: t("login.accountClosed"), icon: "none" });
      return;
    }
    if (deletion?.kind === "pending") {
      restoreDaysLeft.value = deletion.daysLeft;
      showRestoreConfirm.value = true;
      return;
    }
    if (!res.ok) {
      const raw = String(
        res.data?.error || res.data?.detail || res.data?.message || ""
      );
      const detail = raw.toLowerCase();
      // 仅「账号未找到」才跳注册；密码错误单独提示，勿误报未注册
      const notRegistered =
        detail === "account_not_found" ||
        detail === "账号不存在" ||
        detail.includes("account_not_found") ||
        detail.includes("not registered") ||
        (detail.includes("账号") && detail.includes("不存在"));
      const wrongPassword =
        detail === "wrong_password" ||
        detail === "密码错误" ||
        detail.includes("wrong_password") ||
        detail.includes("password");

      if (notRegistered) {
        uni.showToast({
          title: t("login.errorAccountNotRegistered"),
          icon: "none",
          duration: 1500,
        });
        setTimeout(() => {
          uni.navigateTo({ url: "/pages/register/index" });
        }, 1500);
      } else if (wrongPassword) {
        uni.showToast({
          title: t("login.errorWrongPassword"),
          icon: "none",
        });
      } else {
        uni.showToast({
          title: raw || t("login.errorFailed"),
          icon: "none",
        });
      }
      return;
    }
    if (!finishLoggedIn(res.data)) {
      uni.showToast({ title: t("login.errorFailed"), icon: "none" });
    }
  } catch {
    passwordError.value = t("common.networkError");
  } finally {
    loading.value = false;
  }
}

function goRegister() {
  uni.navigateTo({ url: "/pages/register/index" });
}

function onSubmitTap() {
  if (loading.value) return;
  bindAnalyticsTap("login-submit", handleLogin, "登录");
}
</script>

<template>
  <!-- 输入组件尺寸贴稿；纵向对照 273-2648 靠上排布 -->
  <view class="acct-page shell-login-glow" :class="themeStore.isDark ? 'theme-dark' : 'theme-light'" :style="{ paddingTop: `${safe.safeAreaTop}px` }">
    <view class="acct-stage">
      <view class="acct-inner">
        <view class="acct-logo-wrap">
          <image class="acct-logo" src="/static/vest/login/logo.png" mode="aspectFit" />
          <text class="acct-brand">{{ loginBrandName }}</text>
          <text class="acct-tagline">{{ t("login.subtitle") }}</text>
        </view>

        <view class="acct-form">
          <view class="acct-field first">
            <input
              v-model="email"
              class="acct-input"
              :placeholder="t('login.emailPlaceholder')"
              placeholder-class="acct-ph"
              @focus="emailTouched = true"
            />
            <text v-if="emailError" class="acct-error">*{{ emailError }}</text>
          </view>

          <view class="acct-field">
            <view class="acct-password">
              <input
                v-model="password"
                class="acct-input has-eye"
                :password="!showPassword"
                :placeholder="t('login.passwordPlaceholder')"
                placeholder-class="acct-ph"
                @focus="passwordTouched = true"
              />
              <view class="acct-eye" @tap="showPassword = !showPassword">
                <image
                  class="acct-eye-ico icon-on-fg"
                  :src="
                    showPassword
                      ? '/static/register/ico-eye.svg'
                      : '/static/register/ico-eye-no.svg'
                  "
                  mode="aspectFit"
                />
              </view>
            </view>
            <text v-if="passwordError" class="acct-error">*{{ passwordError }}</text>
          </view>

          <view
            class="acct-cta"
            :class="{ disabled: !canSubmit || loading }"
            @tap="onSubmitTap"
          >
            <text class="acct-cta-text">
              {{ loading ? t("login.loggingIn") : t("login.login") }}
            </text>
          </view>

          <view
            class="acct-register"
            @tap="bindAnalyticsTap('login-to-register', goRegister, '去注册')"
          >
            <text class="acct-muted">{{ t("login.noAccount") }}</text>
            <text class="acct-link">{{ t("login.registerBtn") }}</text>
          </view>
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
      @confirm="handleRestoreAccount"
    />
  </view>
</template>

<style scoped lang="scss">
/*
 * 宽向：按 375 稿 rpx（左右 32、输入 311×52）
 * 纵向：flex + vh 比例居中，随屏高伸缩，不锁 Figma 绝对坐标
 */
.acct-page {
  position: relative;
  min-height: 100vh;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background-color: var(--bg, #0c0813);
}

.acct-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  /* 对照 273-2648：Logo 约 y=160pt，内容整体靠上 */
  padding: 226rpx 0 calc(env(safe-area-inset-bottom) + 80rpx);
  box-sizing: border-box;
}

.acct-inner {
  width: 100%;
  padding: 0 64rpx;
  box-sizing: border-box;
}

.acct-logo-wrap {
  text-align: center;
  margin-bottom: clamp(40rpx, 5.5vh, 96rpx);
}

.acct-logo {
  width: 200rpx;
  height: 148rpx;
  display: block;
  margin: 0 auto 32rpx;
}

.acct-brand {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: var(--fg, #fafafa);
  line-height: 1.2;
}

.acct-tagline {
  display: block;
  margin-top: 16rpx;
  font-size: 28rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  line-height: 1.3;
}

.acct-form {
  width: 100%;
}

.acct-field {
  margin-top: 32rpx;

  &.first {
    margin-top: 0;
  }
}

.acct-password {
  position: relative;
}

.acct-eye {
  position: absolute;
  right: 24rpx;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.acct-eye-ico {
  width: 48rpx;
  height: 48rpx;
}

.acct-input {
  width: 100%;
  height: 104rpx !important;
  min-height: 104rpx !important;
  line-height: normal;
  background: transparent !important;
  border: 1rpx solid rgba(255, 255, 255, 0.2) !important;
  border-radius: 9999px !important;
  padding: 0 24rpx !important;
  font-size: 28rpx !important;
  font-weight: 500 !important;
  color: var(--fg, #fafafa) !important;
  box-sizing: border-box;

  &.has-eye {
    padding-right: 88rpx !important;
  }
}

.theme-light .acct-input {
  background: #ffffff !important;
  border-color: rgba(10, 10, 10, 0.12) !important;
}

.acct-input :deep(.uni-input-wrapper),
.acct-input :deep(.uni-input-input) {
  height: 104rpx !important;
  min-height: 104rpx !important;
  line-height: 104rpx !important;
  color: var(--fg, #fafafa) !important;
  font-size: 28rpx !important;
  font-weight: 500 !important;
}

.acct-ph,
.acct-input :deep(.uni-input-placeholder) {
  color: var(--fg-placeholder, rgba(255, 255, 255, 0.3)) !important;
  font-weight: 500;
  font-size: 28rpx;
}

.acct-error {
  color: #ee3639;
  font-size: 24rpx;
  margin-top: 16rpx;
  line-height: 1.4;
}

.acct-cta {
  width: 100%;
  height: 102rpx;
  margin-top: clamp(64rpx, 8vh, 128rpx);
  padding: 0 32rpx;
  border-radius: 9999px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-brand);

  &.disabled {
    background: #4a4a4e;
  }
}

.theme-light .acct-cta.disabled {
  background: #d5d5d5;
}

.theme-light .acct-cta.disabled .acct-cta-text {
  color: rgba(10, 10, 10, 0.45);
}

.acct-cta-text {
  font-size: 32rpx;
  font-weight: 500;
  line-height: 1;
  color: var(--fg-on-brand, #ffffff);
}

.acct-cta.disabled .acct-cta-text {
  color: var(--fg-disabled, rgba(255, 255, 255, 0.4));
}

.acct-register {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  margin-top: 24rpx;
  padding: 16rpx 20rpx;
  font-size: 24rpx;
  line-height: 1.4;
}

.acct-muted {
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}

.acct-link {
  color: #3291f6;
}
</style>
