<script setup>
/**
 * @file pages/register — 注册页（公开路由，对照 Figma 836:13121）
 * @description 账号注册（邮箱/昵称/密码）；成功后写入草稿并进入下一步。
 * @depends rawFetch、storage、useAuth.redirectIfLoggedIn
 */
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { setItem, removeItem } from "@/utils/storage";
import { bindAnalyticsTap, trackButtonClick } from "@/utils/analytics";
import { openPrivacyPolicy, openUserAgreement } from "@/utils/openPrivacy";
import { readSafeArea } from "@/composables/useStatusBar";
import { useThemeStore } from "@/stores/theme";
import { rawFetch, unwrapApiResults } from "@/utils/api";
import { SKIP_REGISTER_ONBOARDING } from "@/utils/constants";
import { goAfterAuth, markGenderSelectUserType } from "@/composables/useAuth";
import { trackRegisterSuccess } from "@/utils/firebaseAnalytics";
import { trackAttributionRegister } from "@/utils/growthAttribution";
import { startForegroundDree0Timer } from "@/utils/productAnalyticsHelpers";
import { pushUiLanguageToServer } from "@/utils/userLanguageSync";

const { t } = useI18n();
const themeStore = useThemeStore();
const safe = readSafeArea();

const email = ref("");
const nickname = ref("");
const password = ref("");
const confirmPassword = ref("");
const emailError = ref("");
const nicknameError = ref("");
const passwordError = ref("");
const confirmPasswordError = ref("");
const emailTouched = ref(false);
const nicknameTouched = ref(false);
const passwordTouched = ref(false);
const confirmPasswordTouched = ref(false);
const loading = ref(false);
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const canSubmit = computed(
  () =>
    email.value.trim() &&
    EMAIL_REGEX.test(email.value.trim()) &&
    nickname.value.trim() &&
    password.value.length >= 6 &&
    password.value === confirmPassword.value
);

function validateEmail() {
  const trimmedEmail = email.value.trim();
  if (!emailTouched.value) return;
  if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
    emailError.value = t("register.errorEmail");
  } else {
    emailError.value = "";
  }
}

function validateNickname() {
  if (!nicknameTouched.value) return;
  const trimmed = nickname.value.trim();
  if (!trimmed) {
    nicknameError.value = t("register.errorNickname");
  } else if (trimmed.length > 32) {
    nicknameError.value = t("register.errorNickname");
  } else {
    nicknameError.value = "";
  }
}

function validatePassword() {
  if (!passwordTouched.value) return;
  if (!password.value || password.value.length < 6) {
    passwordError.value = t("register.errorPassword");
  } else {
    passwordError.value = "";
  }
  validateConfirmPassword();
}

function validateConfirmPassword() {
  if (!confirmPasswordTouched.value) return;
  if (password.value !== confirmPassword.value) {
    confirmPasswordError.value = t("register.errorConfirm");
  } else {
    confirmPasswordError.value = "";
  }
}

watch(email, validateEmail);
watch(nickname, validateNickname);
watch(password, validatePassword);
watch(confirmPassword, validateConfirmPassword);

/** 跳过引导页时直接注册并进入首页（占位资料满足后端 18+ 校验） */
async function completeRegistrationDirectly(account, trimmedNickname) {
  const payload = {
    username: account,
    gender: "",
    nickname: trimmedNickname,
    password: password.value,
    preferred_gender: "",
    chat_purpose: "",
    birth: "2000-01-01",
  };

  const res = await rawFetch("/api/auth/register", { method: "POST", data: payload });
  const body = res.data;
  const data = unwrapApiResults(body);

  if (body && typeof body === "object") {
    if (body.ok === false) {
      const msg = body.message || body.detail || body.error || t("register.errorFailed");
      uni.showToast({ title: msg, icon: "none", duration: 2500 });
      return false;
    }
    if (body.code != null && body.code !== 200) {
      const msg = body.message || body.detail || body.error || t("register.errorFailed");
      uni.showToast({ title: msg, icon: "none", duration: 2500 });
      return false;
    }
  }

  if (!res.ok) {
    const msg =
      (typeof body === "object" && (body?.message || body?.detail || body?.error)) ||
      t("register.errorFailed");
    uni.showToast({ title: msg, icon: "none", duration: 2500 });
    return false;
  }

  const token = data?.token || data?.access_token;
  const user = data?.user;
  if (token) setItem("user_token", token);
  if (user) setItem("user_info", JSON.stringify(user));

  // 注册成功：把当前 UI 语言写到用户表（覆盖服务端默认 en）
  void pushUiLanguageToServer();

  try {
    trackRegisterSuccess({ method: "email", user });
    void trackAttributionRegister({ method: "email" });
    startForegroundDree0Timer();
  } catch {
    /* ignore */
  }

  removeItem("register_draft");
  markGenderSelectUserType("new");
  uni.showToast({ title: t("onboarding.submitSuccess"), icon: "none", duration: 1500 });
  setTimeout(() => {
    goAfterAuth(user);
  }, 1500);
  return true;
}

async function handleRegister() {
  emailTouched.value = true;
  nicknameTouched.value = true;
  passwordTouched.value = true;
  confirmPasswordTouched.value = true;

  emailError.value = "";
  nicknameError.value = "";
  passwordError.value = "";
  confirmPasswordError.value = "";
  const trimmedEmail = email.value.trim();
  const trimmedNickname = nickname.value.trim();
  let hasError = false;

  if (!trimmedEmail) {
    emailError.value = t("register.errorEmail");
    hasError = true;
  } else if (!EMAIL_REGEX.test(trimmedEmail)) {
    emailError.value = t("register.errorEmail");
    hasError = true;
  }

  if (!trimmedNickname) {
    nicknameError.value = t("register.errorNickname");
    hasError = true;
  }

  if (!password.value || password.value.length < 6) {
    passwordError.value = t("register.errorPassword");
    hasError = true;
  }

  if (password.value !== confirmPassword.value) {
    confirmPasswordError.value = t("register.errorConfirm");
    hasError = true;
  }

  if (hasError) {
    return;
  }

  loading.value = true;
  try {
    const account = EMAIL_REGEX.test(trimmedEmail)
      ? trimmedEmail.toLowerCase()
      : trimmedEmail;

    const res = await uni.standardApi.post("/api/auth/check-username", {
      username: account,
      password: password.value,
    });

    if (res.code === 200) {
      setItem(
        "register_draft",
        JSON.stringify({
          username: account,
          nickname: trimmedNickname,
          password: password.value,
        })
      );
      if (SKIP_REGISTER_ONBOARDING) {
        const ok = await completeRegistrationDirectly(account, trimmedNickname);
        if (!ok) return;
        return;
      }
      // 旧多步引导保留入口；现统一先注册再进性别页
      if (false) {
        uni.navigateTo({
          url: `/pages/register/step?username=${encodeURIComponent(account)}&nickname=${encodeURIComponent(trimmedNickname)}`,
        });
        return;
      }
      const ok = await completeRegistrationDirectly(account, trimmedNickname);
      if (!ok) return;
    }

    const errorMsg =
      res.message || res.detail || res.error || t("register.checkFailed");
    uni.showToast({ title: errorMsg, icon: "none", duration: 2500 });
  } catch (e) {
    if (e && e.message) {
      uni.showToast({ title: e.message, icon: "none", duration: 2500 });
    }
  } finally {
    loading.value = false;
  }
}

function goPrivacy() {
  openPrivacyPolicy();
}

function goTerms() {
  openUserAgreement();
}

function goLogin() {
  uni.navigateTo({
    url: "/pages/login/index",
    fail: () => {
      uni.navigateBack({
        fail: () => uni.reLaunch({ url: "/pages/login/index" }),
      });
    },
  });
}

function onBack() {
  trackButtonClick("register-back", "注册页返回");
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack({
      fail: () => uni.reLaunch({ url: "/pages/login/index" }),
    });
    return;
  }
  uni.reLaunch({ url: "/pages/login/index" });
}

function onSubmitTap() {
  if (!canSubmit.value || loading.value) return;
  bindAnalyticsTap("register-submit", handleRegister, "注册");
}
</script>

<template>
  <!--
    Figma 836:13121（375×812）关键量度：
    状态栏 62 · 顶栏 58 · 输入 16↔343×48 / 间距 16 · 按钮顶距确认底 64、高 47
    左右页边仅 16（32rpx），禁止再用 max-width+内边距叠成 311
  -->
  <view class="reg-page" :class="themeStore.isDark ? 'theme-dark' : 'theme-light'" :style="{ paddingTop: `${safe.safeAreaTop}px` }">
    <view class="reg-nav">
      <view class="reg-back" hover-class="reg-back-hover" @tap="onBack">
        <image
          class="reg-back-ico icon-on-fg"
          src="/static/register/ico-arrow-left.svg"
          mode="aspectFit"
        />
      </view>
      <text class="reg-title">{{ t("register.title") }}</text>
    </view>

    <scroll-view scroll-y class="reg-scroll">
      <view class="reg-inner">
        <view class="reg-field first">
          <input
            v-model="email"
            class="reg-input"
            :placeholder="t('register.email')"
            placeholder-class="reg-ph"
            @focus="emailTouched = true"
          />
          <text v-if="emailError" class="reg-error">*{{ emailError }}</text>
        </view>

        <view class="reg-field">
          <input
            v-model="nickname"
            class="reg-input"
            :maxlength="32"
            :placeholder="t('register.nickname')"
            placeholder-class="reg-ph"
            @focus="nicknameTouched = true"
          />
          <text v-if="nicknameError" class="reg-error">*{{ nicknameError }}</text>
        </view>

        <view class="reg-field">
          <view class="reg-password">
            <input
              v-model="password"
              class="reg-input has-eye"
              :password="!showPassword"
              :placeholder="t('register.password')"
              placeholder-class="reg-ph"
              @focus="passwordTouched = true"
            />
            <view class="reg-eye" @tap="showPassword = !showPassword">
              <image
                class="reg-eye-ico icon-on-fg"
                :src="
                  showPassword
                    ? '/static/register/ico-eye.svg'
                    : '/static/register/ico-eye-no.svg'
                "
                mode="aspectFit"
              />
            </view>
          </view>
          <text v-if="passwordError" class="reg-error">*{{ passwordError }}</text>
        </view>

        <view class="reg-field">
          <view class="reg-password">
            <input
              v-model="confirmPassword"
              class="reg-input has-eye"
              :password="!showConfirmPassword"
              :placeholder="t('register.confirmPassword')"
              placeholder-class="reg-ph"
              @focus="confirmPasswordTouched = true"
            />
            <view class="reg-eye" @tap="showConfirmPassword = !showConfirmPassword">
              <image
                class="reg-eye-ico icon-on-fg"
                :src="
                  showConfirmPassword
                    ? '/static/register/ico-eye.svg'
                    : '/static/register/ico-eye-no.svg'
                "
                mode="aspectFit"
              />
            </view>
          </view>
          <text v-if="confirmPasswordError" class="reg-error"
            >*{{ confirmPasswordError }}</text
          >
        </view>

        <view
          class="reg-cta"
          :class="{ disabled: !canSubmit || loading }"
          @tap="onSubmitTap"
        >
          <text class="reg-cta-text">
            {{ loading ? t("register.registering") : t("register.registerBtn") }}
          </text>
        </view>

        <view class="reg-agree">
          <text class="reg-muted">{{ t("register.agree") }}</text>
          <text class="reg-link" @tap="goPrivacy">{{ t("register.privacy") }}</text>
          <text class="reg-muted">{{ t("register.and") }}</text>
          <text class="reg-link" @tap="goTerms">{{ t("register.terms") }}</text>
        </view>

        <view class="reg-login" @tap="goLogin">
          <text class="reg-muted">{{ t("register.hasAccount") }}</text>
          <text class="reg-link">{{ t("register.goLogin") }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.reg-page {
  min-height: 100vh;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--bg, #0a0a0a);
}

/* Frame 40: h58 · 左 16 · 返回 24 · 标题距左 52(=16+24+12) · 字 20/Medium */
.reg-nav {
  flex-shrink: 0;
  height: 116rpx;
  padding: 0 32rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  box-sizing: border-box;
}

.reg-back {
  flex-shrink: 0;
  width: 48rpx;
  height: 48rpx;
  margin-right: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 32rpx;
}

.reg-back-hover {
  background: rgba(127, 127, 127, 0.18);
}

.reg-back-ico {
  width: 48rpx;
  height: 48rpx;
}

.reg-title {
  color: var(--fg, #fafafa);
  font-size: 40rpx;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.reg-scroll {
  flex: 1;
  min-height: 0;
  height: 0;
}

/* 仅一层左右 16：输入宽 = 375-32 = 343 */
.reg-inner {
  width: 100%;
  padding: 24rpx 32rpx calc(env(safe-area-inset-bottom) + 48rpx);
  box-sizing: border-box;
}

.reg-field {
  margin-top: 32rpx;

  &.first {
    margin-top: 0;
  }
}

.reg-password {
  position: relative;
}

/* 眼标右内距 16（相对输入框）→ 屏坐标 x≈319 */
.reg-eye {
  position: absolute;
  right: 32rpx;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reg-eye-ico {
  width: 48rpx;
  height: 48rpx;
}

.reg-input {
  width: 100%;
  height: 96rpx !important;
  min-height: 96rpx !important;
  line-height: normal;
  background: var(--surface-inset, rgba(255, 255, 255, 0.05)) !important;
  border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.05)) !important;
  border-radius: 32rpx !important;
  padding: 0 32rpx !important;
  font-size: 28rpx !important;
  font-weight: 500 !important;
  color: var(--fg, #fafafa) !important;
  box-sizing: border-box;

  &.has-eye {
    padding-right: 96rpx !important;
  }
}

.reg-input :deep(.uni-input-wrapper),
.reg-input :deep(.uni-input-input) {
  height: 96rpx !important;
  min-height: 96rpx !important;
  line-height: 96rpx !important;
  color: var(--fg, #fafafa) !important;
  font-size: 28rpx !important;
  font-weight: 500 !important;
}

.reg-ph,
.reg-input :deep(.uni-input-placeholder) {
  color: var(--fg-placeholder, rgba(255, 255, 255, 0.3)) !important;
  font-weight: 500;
  font-size: 28rpx;
}

.reg-error {
  color: #ee3639;
  font-size: 22rpx;
  margin-top: 8rpx;
  line-height: 1.4;
}

/* 确认底→按钮顶 64；按钮高 47；禁用底 rgba(255,255,255,0.2) */
.reg-cta {
  width: 100%;
  height: 94rpx;
  margin-top: 128rpx;
  padding: 0 32rpx;
  border-radius: 32rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(172.04deg, #fff946 21.98%, #e747a4 113.24%);

  &.disabled {
    background: var(--surface-disabled, rgba(255, 255, 255, 0.2));
    pointer-events: none;
  }
}

.reg-cta-text {
  font-size: 32rpx;
  font-weight: 500;
  line-height: 1;
  color: var(--fg-on-brand, #0a0a0a);
}

.reg-cta.disabled .reg-cta-text {
  color: var(--fg-disabled, rgba(255, 255, 255, 0.4));
}

/* 按钮底→协议顶 12；两行各高 30、间距 0 */
.reg-agree,
.reg-login {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8rpx;
  height: 60rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 1.4;
  text-align: center;
}

.reg-agree {
  margin-top: 24rpx;
  height: auto;
  min-height: 60rpx;
  flex-wrap: wrap;
}

.reg-login {
  margin-top: 0;
}

.reg-muted {
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}

.reg-link {
  color: #3291f6;
}
</style>
