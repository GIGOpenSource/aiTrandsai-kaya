<script setup>
/**
 * @file pages-sub/onboarding — 新用户引导页
 * @description 4 步引导：选性别 → 选想聊性别 → 选目的 → 填昵称+生日
 * @depends apiFetch、storage、useAuth
 */
import { ref, computed } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import apiFetch from "@/utils/api";
import { getItem, setItem } from "@/utils/storage";
import { showToast } from "@/stores/toast";
import { useThemeStore } from "@/stores/theme";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";

const { t, locale } = useI18n();
const themeStore = useThemeStore();

const step = ref(0);
const totalSteps = 4;

// ——— 表单数据 ———
const gender = ref("");
const chatGender = ref("");
const purpose = ref("");
const nickname = ref("");
const birthDate = ref({ year: 2000, month: 1, day: 1 });

const submitting = ref(false);

// ——— 选项 ———
const genderOptions = computed(() => [
  { value: "female", label: t("onboarding.female"), icon: "/static/register/girl.svg" },
  { value: "male", label: t("onboarding.male"), icon: "/static/register/male.svg" },
  { value: "nonbinary", label: t("onboarding.nonBinary"), icon: "/static/register/boy.svg" },
  { value: "secret", label: t("onboarding.confidential"), icon: "/static/register/no.svg" },
]);

const purposeOptions = computed(() => [
  { value: "chatting", label: t("onboarding.chatting"), icon: "💬" },
  { value: "companionship", label: t("onboarding.companionship"), icon: "🤝" },
  { value: "romance", label: t("onboarding.romance"), icon: "💕" },
  { value: "communication", label: t("onboarding.communication"), icon: "🗣" },
]);

// ——— 日期选择器 ———
const years = computed(() => {
  const now = new Date().getFullYear();
  const arr = [];
  for (let y = now; y >= 1950; y--) arr.push(y);
  return arr;
});
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const days = computed(() => {
  const d = new Date(birthDate.value.year, birthDate.value.month, 0).getDate();
  return Array.from({ length: d }, (_, i) => i + 1);
});

function onYearChange(e) {
  birthDate.value.year = years.value[Number(e.detail.value)];
}
function onMonthChange(e) {
  birthDate.value.month = months[Number(e.detail.value)];
}
function onDayChange(e) {
  birthDate.value.day = days.value[Number(e.detail.value)];
}

const yearsIndex = computed(() => years.value.indexOf(birthDate.value.year));
const monthsIndex = computed(() => months.indexOf(birthDate.value.month));
const daysIndex = computed(() => days.value.indexOf(birthDate.value.day));

// ——— 计算年龄 ———
function calcAge() {
  const now = new Date();
  let age = now.getFullYear() - birthDate.value.year;
  const m = now.getMonth() + 1 - birthDate.value.month;
  if (m < 0 || (m === 0 && now.getDate() < birthDate.value.day)) age--;
  return age;
}

// ——— 按钮状态 ———
const canNext = computed(() => {
  if (step.value === 0) return !!gender.value;
  if (step.value === 1) return !!chatGender.value;
  if (step.value === 2) return !!purpose.value;
  if (step.value === 3) return nickname.value.trim().length > 0;
  return false;
});

// ——— 提交 ———
async function handleNext() {
  if (step.value < totalSteps - 1) {
    step.value++;
    return;
  }
  // 最后一步：提交数据
  if (!nickname.value.trim()) {
    showToast(t("onboarding.enterNickname"));
    return;
  }
  const age = calcAge();
  if (age < 18) {
    showToast(t("onboarding.ageRequirement"));
    return;
  }

  const genderMap = {
    female: "女",
    male: "男",
    nonbinary: "非二元",
    secret: "保密",
  };

  submitting.value = true;
  try {
    const data = await apiFetch("/api/auth/me", {
      method: "PATCH",
      data: {
        nickname: nickname.value.trim(),
        gender: genderMap[gender.value] || "保密",
        sexual_orientation: "heterosexual",
        age: age,
        preferred_chat_gender: chatGender.value,
        chat_purpose: purpose.value,
      },
    });

    // 更新本地用户信息
    const raw = getItem("user_info");
    if (raw) {
      const info = JSON.parse(raw);
      Object.assign(info, data);
      setItem("user_info", JSON.stringify(info));
    }

    // 标记引导页已完成
    setItem("onboarding_completed", "1");

    uni.reLaunch({ url: "/pages/home/index" });
  } catch (err) {
    console.error("引导页提交失败:", err);
    showToast(t("onboarding.submitFailed"));
  } finally {
    submitting.value = false;
  }
}

function handleSkip() {
  // 可跳过偏好填写，但不可绕过 18+ 年龄门槛（商店合规）
  let ageOk = false;
  try {
    const raw = getItem("user_info");
    const info = raw ? JSON.parse(raw) : null;
    const age = Number(info?.age);
    ageOk = Number.isFinite(age) && age >= 18;
  } catch {
    ageOk = false;
  }
  if (!ageOk) {
    // 已选生日且满 18 也可跳过偏好
    if (step.value === totalSteps - 1 && calcAge() >= 18) {
      ageOk = true;
    } else {
      step.value = totalSteps - 1;
      showToast(t("onboarding.ageRequirement"));
      return;
    }
  }
  setItem("onboarding_completed", "1");
  uni.reLaunch({ url: "/pages/home/index" });
}

function selectGender(val) {
  gender.value = val;
}
function selectChatGender(val) {
  chatGender.value = val;
}
function selectPurpose(val) {
  purpose.value = val;
}

onShow(() => {
  trackProductEvent(PRODUCT_EVENTS.NEWBIE_GUIDE_SHOW, { page: "onboarding" });
});
</script>

<template>
  <view class="onboarding-page" :class="themeStore.isDark ? 'theme-dark' : 'theme-light'">
    <!-- 顶部 -->
    <view class="onboarding-header">
      <view class="skip-btn" @tap="handleSkip">
        <text>{{ t("onboarding.skip") }}</text>
      </view>
    </view>

    <!-- 进度点 -->
    <view class="progress-dots">
      <view
        v-for="i in totalSteps"
        :key="i"
        class="progress-dot"
        :class="{ active: step >= i - 1 }"
      />
    </view>

    <!-- 内容区 -->
    <scroll-view scroll-y class="onboarding-content">

      <!-- 步骤 1: 选择性别 -->
      <view v-if="step === 0" class="step-container">
                <view class="illustration" />
        <text class="step-title">{{ t("onboarding.selectGender") }}</text>
        <view class="option-list">
          <view
            v-for="opt in genderOptions"
            :key="opt.value"
            class="option-item"
            :class="{ selected: gender === opt.value }"
            @tap="selectGender(opt.value)"
          >
                        <image :src="opt.icon" class="option-icon-img" mode="aspectFit" />
            <text class="option-label">{{ opt.label }}</text>
            <view v-if="gender === opt.value" class="check-icon">
              <text class="check-mark">✓</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 步骤 2: 选择想聊的性别 -->
      <view v-if="step === 1" class="step-container">
        <view class="illustration">
          <image src="/static/onboarding/family.svg" mode="aspectFit" class="illustration-img" />
        </view>
        <text class="step-title">{{ t("onboarding.selectChatGender") }}</text>
        <view class="option-list">
          <view
            v-for="opt in genderOptions"
            :key="opt.value"
            class="option-item"
            :class="{ selected: chatGender === opt.value }"
            @tap="selectChatGender(opt.value)"
          >
                        <image :src="opt.icon" class="option-icon-img" mode="aspectFit" />
            <text class="option-label">{{ opt.label }}</text>
            <view v-if="chatGender === opt.value" class="check-icon">
              <text class="check-mark">✓</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 步骤 3: 选择目的 -->
      <view v-if="step === 2" class="step-container">
        <view class="illustration">
          <image src="/static/onboarding/purpose.svg" mode="aspectFit" class="illustration-img" />
        </view>
        <text class="step-title">{{ t("onboarding.selectPurpose") }}</text>
        <view class="option-list">
          <view
            v-for="opt in purposeOptions"
            :key="opt.value"
            class="option-item"
            :class="{ selected: purpose === opt.value }"
            @tap="selectPurpose(opt.value)"
          >
            
            <text class="option-label">{{ opt.label }}</text>
            <view v-if="purpose === opt.value" class="check-icon">
              <text class="check-mark">✓</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 步骤 4: 填昵称 + 生日 -->
      <view v-if="step === 3" class="step-container">
        <view class="illustration">
          <image src="/static/onboarding/info.svg" mode="aspectFit" class="illustration-img" />
        </view>
        <text class="step-title">{{ t("onboarding.basicInfo") }}</text>

        <view class="input-section">
          <text class="input-label">{{ t("onboarding.enterNickname") }}</text>
          <input
            v-model="nickname"
            class="nickname-input"
            :placeholder="t('onboarding.nicknamePlaceholder')"
            placeholder-class="nickname-placeholder"
            maxlength="20"
          />
        </view>

        <view class="input-section">
          <text class="input-label">{{ t("onboarding.selectBirthday") }}</text>
          <view class="date-picker-row">
            <picker
              :range="years"
              :value="yearsIndex"
              @change="onYearChange"
              class="date-picker-item"
            >
              <view class="picker-value">{{ birthDate.year }}</view>
            </picker>
            <picker
              :range="months"
              :value="monthsIndex"
              @change="onMonthChange"
              class="date-picker-item"
            >
              <view class="picker-value">{{ birthDate.month }}</view>
            </picker>
            <picker
              :range="days"
              :value="daysIndex"
              @change="onDayChange"
              class="date-picker-item"
            >
              <view class="picker-value">{{ birthDate.day }}</view>
            </picker>
          </view>
        </view>
      </view>

    </scroll-view>

    <!-- 底部按钮 -->
    <view class="onboarding-footer">
      <button
        class="next-btn"
        :class="{ disabled: !canNext || submitting }"
        :disabled="!canNext || submitting"
        @tap="handleNext"
      >
        <text v-if="submitting" class="btn-loading" />
        <text>{{ step < totalSteps - 1 ? t("onboarding.nextStep") : t("onboarding.enterHome") }}</text>
        <text v-if="step < totalSteps - 1" class="btn-arrow">→</text>
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.onboarding-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg, #0a0a0a);
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

.onboarding-header {
  display: flex;
  justify-content: flex-end;
  padding: 24rpx 32rpx;
  flex-shrink: 0;
}

.skip-btn {
  padding: 12rpx 24rpx;
  border-radius: 32rpx;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.2);
  text {
    font-size: 24rpx;
    color: #fff;
  }
}

.progress-dots {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 12rpx;
  padding: 8rpx 0 32rpx;
  flex-shrink: 0;
}

.progress-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: var(--border, rgba(255, 255, 255, 0.15));
  transition: background 0.3s ease;

  &.active {
    background: linear-gradient(139.53deg, #FF659B 21.98%, #B933E6 113.24%);
  }
}

.onboarding-content {
  flex: 1;
  min-height: 0;
  padding: 0 48rpx;
}

.step-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 40rpx;
}

.illustration {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 48rpx;
}

.illustration-img {
  width: 400rpx;
  height: 300rpx;
}

.step-title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--fg, #fff);
  margin-bottom: 48rpx;
  text-align: center;
}

.option-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.option-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  height: 112rpx;
  border-radius: 28rpx;
  background: var(--bg-input, #1c1c1e);
  border: 2px solid var(--border-soft, transparent);
  padding: 0 32rpx;
  box-sizing: border-box;
  transition: all 0.2s ease;

  &.selected {
    border-color: var(--brand, #FF659B);
    background: rgba(255, 249, 70, 0.06);
  }
}

.option-icon {
  font-size: 40rpx;
  margin-right: 24rpx;
  width: 56rpx;
  text-align: center;
}
.option-icon-img {
  width: 56rpx;
  height: 56rpx;
  margin-right: 24rpx;
  flex-shrink: 0;
}

.option-label {
  flex: 1;
  font-size: 32rpx;
  color: var(--fg, #fff);
}

.check-icon {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: linear-gradient(139.53deg, #FF659B 21.98%, #B933E6 113.24%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.check-mark {
  font-size: 24rpx;
  color: #000;
  font-weight: 700;
}

.input-section {
  width: 100%;
  margin-bottom: 32rpx;
}

.input-label {
  display: block;
  font-size: 28rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  margin-bottom: 16rpx;
}

.nickname-input {
  width: 100%;
  height: 96rpx;
  border-radius: 24rpx;
  background: var(--bg-input, #1e1e24);
  border: 2px solid var(--border-soft, transparent);
  padding: 0 32rpx;
  box-sizing: border-box;
  font-size: 32rpx;
  color: var(--fg, #fff);

  &:focus {
    border-color: rgba(255, 249, 70, 0.3);
  }
}

.nickname-placeholder {
  color: var(--fg-placeholder, rgba(255, 255, 255, 0.3));
}

.date-picker-row {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
}

.date-picker-item {
  flex: 1;
}

.picker-value {
  height: 96rpx;
  border-radius: 24rpx;
  background: var(--bg-input, #1e1e24);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: var(--fg, #fff);
}

.onboarding-footer {
  flex-shrink: 0;
  padding: 24rpx 48rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
}

.next-btn {
  width: 100%;
  height: 96rpx;
  border-radius: 32rpx;
  background: linear-gradient(90deg, #FF659B 0%, #B933E6 100%);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  border: none;
  font-size: 32rpx;
  font-weight: 600;
  color: #000;
  transition: opacity 0.2s ease;

  &.disabled {
    opacity: 0.3;
  }

  &::after {
    border: none;
  }
}

.btn-arrow {
  font-size: 36rpx;
}

.btn-loading {
  width: 32rpx;
  height: 32rpx;
  border: 3px solid rgba(0, 0, 0, 0.2);
  border-top-color: #000;
  border-radius: 50%;
  animation: btn-spin 0.6s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}
</style>
