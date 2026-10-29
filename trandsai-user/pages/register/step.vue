<template>
  <!--
    Figma 836:13180 等 · 画布 375×812
    纵向按 vh%、横向按 375 稿宽百分比（rpx≈稿 px×2）
  -->
  <view
    class="page"
    :class="themeStore.isDark ? 'theme-dark' : 'theme-light'"
    @touchmove="onPageTouchMove"
  >
    <view class="hero shell-login-glow">
      <image class="hero-person" src="/static/register/person.svg" mode="aspectFit" />
    </view>

    <view v-if="!genderOnly" class="skip-btn" @tap="onSkip">{{ t('onboarding.skip') }}</view>

    <view class="sheet">
      <swiper
        class="sheet-swiper"
        :current="currentStep"
        :disable-touch="true"
        :indicator-dots="false"
        :autoplay="false"
        :circular="false"
      >
        <!-- Step 0: 选择性别 -->
        <swiper-item class="swiper-item">
          <view class="step-inner">
            <view class="title-wrap">
              <text class="title">{{ t('onboarding.selectGender') }}</text>
            </view>
            <view class="option-list">
              <view
                v-for="(item, index) in sex"
                :key="index"
                class="option"
                :class="{ active: selectedGender === item.value }"
                @tap="selectedGender = item.value"
              >
                <image class="option-ico" :src="item.img" mode="aspectFit" />
                <text class="option-label">{{ item.name }}</text>
              </view>
            </view>
            <view class="btn" :class="{ disabled: genderOnly && !selectedGender }" @tap="goNext">
              <text>{{ t('onboarding.nextStep') }}</text>
              <image class="btn-arrow" src="/static/register/ico-next-arrow.svg" mode="aspectFit" />
            </view>
          </view>
        </swiper-item>

        <!-- Step 1: 想聊的性别 -->
        <swiper-item v-if="!genderOnly" class="swiper-item">
          <view class="step-inner">
            <view class="title-wrap">
              <text class="title">{{ t('onboarding.genderToDiscuss') }}</text>
            </view>
            <view class="option-list">
              <view
                v-for="(item, index) in sex"
                :key="index"
                class="option"
                :class="{ active: selectedGender2 === item.value }"
                @tap="selectedGender2 = item.value"
              >
                <image class="option-ico" :src="item.img" mode="aspectFit" />
                <text class="option-label">{{ item.name }}</text>
              </view>
            </view>
            <view class="btn" @tap="goNext">
              <text>{{ t('onboarding.nextStep') }}</text>
              <image class="btn-arrow" src="/static/register/ico-next-arrow.svg" mode="aspectFit" />
            </view>
          </view>
        </swiper-item>

        <!-- Step 2: 聊天目的（无 icon） -->
        <swiper-item v-if="!genderOnly" class="swiper-item">
          <view class="step-inner">
            <view class="title-wrap">
              <text class="title">{{ t('onboarding.selectPurpose') }}</text>
            </view>
            <view class="option-list">
              <view
                v-for="(item, index) in feture"
                :key="index"
                class="option"
                :class="{ active: selectedTarget === item.value }"
                @tap="selectedTarget = item.value"
              >
                <text class="option-label">{{ item.name }}</text>
              </view>
            </view>
            <view class="btn" @tap="goNext">
              <text>{{ t('onboarding.nextStep') }}</text>
              <image class="btn-arrow" src="/static/register/ico-next-arrow.svg" mode="aspectFit" />
            </view>
          </view>
        </swiper-item>

        <!-- Step 3: 基本信息 / 页内生日滚轮（Figma 1475:20146） -->
        <swiper-item v-if="!genderOnly" class="swiper-item">
          <view class="step-inner step-inner--birth">
            <view class="title-wrap">
              <text class="title">{{ t('onboarding.basicInfo') }}</text>
            </view>
            <view class="birth-block">
              <text class="input-label">{{ t('onboarding.enterAge') }}</text>
              <view class="birth-picker-row">
                <!-- 高亮层挂在 row 上（不进 scroll-view），三列对齐固定在正中 -->
                <view class="birth-highlight-row">
                  <view class="birth-highlight birth-col-month" />
                  <view class="birth-highlight birth-col-day" />
                  <view class="birth-highlight birth-col-year" />
                </view>
                <!-- Month -->
                <view class="birth-col birth-col-month">
                  <scroll-view
                    class="birth-scroll"
                    scroll-y
                    :style="{ height: VIEW_H + 'px' }"
                    :show-scrollbar="false"
                    :scroll-top="monthScrollTop"
                    :scroll-with-animation="scrollAnimating"
                    @touchstart="onPickerTouchStart"
                    @scroll="onMonthScroll"
                    @touchend="snapMonth"
                    @touchcancel="snapMonth"
                  >
                    <view class="birth-pad" :style="{ height: PAD_Y + 'px' }" />
                    <view
                      v-for="(month, index) in months"
                      :id="'m-' + index"
                      :key="'m' + index"
                      class="birth-slot"
                      :style="{ height: ITEM_STEP + 'px' }"
                    >
                      <view
                        class="birth-pill"
                        :class="{ selected: pickerValue[0] === index }"
                      >{{ month }}</view>
                    </view>
                    <view class="birth-pad" :style="{ height: PAD_Y + 'px' }" />
                  </scroll-view>
                </view>
                <!-- Day -->
                <view class="birth-col birth-col-day">
                  <scroll-view
                    class="birth-scroll"
                    scroll-y
                    :style="{ height: VIEW_H + 'px' }"
                    :show-scrollbar="false"
                    :scroll-top="dayScrollTop"
                    :scroll-with-animation="scrollAnimating"
                    @touchstart="onPickerTouchStart"
                    @scroll="onDayScroll"
                    @touchend="snapDay"
                    @touchcancel="snapDay"
                  >
                    <view class="birth-pad" :style="{ height: PAD_Y + 'px' }" />
                    <view
                      v-for="(day, index) in daysList"
                      :id="'d-' + index"
                      :key="'d' + index"
                      class="birth-slot"
                      :style="{ height: ITEM_STEP + 'px' }"
                    >
                      <view
                        class="birth-pill"
                        :class="{ selected: pickerValue[1] === index }"
                      >{{ day }}</view>
                    </view>
                    <view class="birth-pad" :style="{ height: PAD_Y + 'px' }" />
                  </scroll-view>
                </view>
                <!-- Year -->
                <view class="birth-col birth-col-year">
                  <scroll-view
                    class="birth-scroll"
                    scroll-y
                    :style="{ height: VIEW_H + 'px' }"
                    :show-scrollbar="false"
                    :scroll-top="yearScrollTop"
                    :scroll-with-animation="scrollAnimating"
                    @touchstart="onPickerTouchStart"
                    @scroll="onYearScroll"
                    @touchend="snapYear"
                    @touchcancel="snapYear"
                  >
                    <view class="birth-pad" :style="{ height: PAD_Y + 'px' }" />
                    <view
                      v-for="(year, index) in years"
                      :id="'y-' + index"
                      :key="'y' + index"
                      class="birth-slot"
                      :style="{ height: ITEM_STEP + 'px' }"
                    >
                      <view
                        class="birth-pill"
                        :class="{ selected: pickerValue[2] === index }"
                      >{{ year }}</view>
                    </view>
                    <view class="birth-pad" :style="{ height: PAD_Y + 'px' }" />
                  </scroll-view>
                </view>
              </view>
            </view>
            <view class="btn btn--birth" @tap="handleSubmit">
              <text>{{ t('onboarding.enterHome') }}</text>
            </view>
          </view>
        </swiper-item>
      </swiper>

      <!-- 进度条：稿面 48×4，间距 8，起始 left 80/375 -->
      <view v-if="!genderOnly" class="progress">
        <view
          v-for="i in 4"
          :key="i"
          class="progress-bar"
          :class="{ active: currentStep === i - 1 }"
        />
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad, onBackPress } from '@dcloudio/uni-app'
import { useI18n } from 'vue-i18n'
import apiFetch, { rawFetch, unwrapApiResults } from '@/utils/api'
import { setItem, getItem, removeItem } from '@/utils/storage'
import { goAfterAuth, markGenderSelectUserType } from '@/composables/useAuth'
import { useThemeStore } from '@/stores/theme'
import { trackRegisterSuccess } from '@/utils/firebaseAnalytics'
import { trackAttributionRegister } from '@/utils/growthAttribution'
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from '@/utils/firebaseProductAnalytics'
import { trackRegistrationGuideOutcome, startForegroundDree0Timer } from '@/utils/productAnalyticsHelpers'
import { pushUiLanguageToServer } from '@/utils/userLanguageSync'

const { t, locale } = useI18n()
const themeStore = useThemeStore()
const currentStep = ref(0)
const selectedGender = ref('')
const selectedGender2 = ref('')
const selectedTarget = ref('')
const username = ref('')
const nickname = ref('')
const password = ref('')
const birthday = ref('')
/** 登录/注册后只补性别；其它引导步骤隐藏保留 */
const genderOnly = ref(false)
const genderSaving = ref(false)

function goNext() {
  if (genderOnly.value) {
    handleGenderSubmit()
    return
  }
  if (currentStep.value < 3) {
    currentStep.value++
  }
}

function onSkip() {
  if (genderOnly.value) return
  if (currentStep.value < 3) {
    currentStep.value++
    return
  }
  handleSubmit()
}

async function handleGenderSubmit() {
  if (genderSaving.value) return
  if (!selectedGender.value) {
    uni.showToast({ title: t('onboarding.selectGender'), icon: 'none' })
    return
  }
  genderSaving.value = true
  try {
    const data = await apiFetch('/api/auth/me', {
      method: 'PATCH',
      data: { gender: selectedGender.value },
    })
    try {
      const prev = JSON.parse(getItem('user_info') || '{}') || {}
      setItem(
        'user_info',
        JSON.stringify({
          ...prev,
          gender: data?.gender ?? selectedGender.value,
        })
      )
    } catch {
      /* ignore */
    }
    uni.reLaunch({ url: '/pages/home/index' })
  } catch {
    /* apiFetch 已 toast */
  } finally {
    genderSaving.value = false
  }
}

onBackPress(() => {
  if (genderOnly.value) return true
  return false
})

onLoad((query) => {
  genderOnly.value = String(query?.mode || '') === 'gender'
})

onMounted(() => {
  trackProductEvent(PRODUCT_EVENTS.NEWBIE_GUIDE_SHOW, { page: 'register_step' })
  // #ifdef APP-PLUS
  try {
    const wv = plus.webview.currentWebview()
    wv?.setStyle?.({
      bounce: 'none',
      scalable: false,
      ...(genderOnly.value ? { popGesture: 'none' } : {}),
    })
  } catch {
    /* ignore */
  }
  // #endif

  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]
  const options = currentPage.options || {}

  let draft = null
  try {
    const raw = getItem('register_draft')
    draft = raw ? JSON.parse(raw) : null
  } catch {
    draft = null
  }

  username.value = decodeURIComponent(options.username || '') || (draft?.username || '')
  nickname.value = decodeURIComponent(options.nickname || '') || (draft?.nickname || '')
  password.value = draft?.password || ''
  syncBirthdayFromPicker()
})

// boy.svg = 非二元紫；no.svg = 保密橙（Figma 原稿）
const sex = computed(() => [{
  img: '/static/register/girl.svg',
  name: t('onboarding.female'),
  value: 'female'
}, {
  img: '/static/register/male.svg',
  name: t('onboarding.male'),
  value: 'male'
}, {
  img: '/static/register/boy.svg',
  name: t('onboarding.nonBinary'),
  value: 'non-binary'
}, {
  img: '/static/register/no.svg',
  name: t('onboarding.confidential'),
  value: 'confidential'
}])

const feture = computed(() => [{
  name: t('onboarding.chatting'),
  value: 'chatting'
}, {
  name: t('onboarding.companionship'),
  value: 'companionship'
}, {
  name: t('onboarding.romance'),
  value: 'romance'
}, {
  name: t('onboarding.communication'),
  value: 'communication'
}])

/* 页内自绘滚轮：每行占位 47（含间距），视口 227；高亮与文字对齐行中心 */
const ITEM_STEP = 47
const VIEW_H = 227
const PAD_Y = Math.floor((VIEW_H - ITEM_STEP) / 2) // 90：让选中行中心对齐视口中心

const currentYear = new Date().getFullYear()
const BIRTH_YEAR_MIN = 1920
const years = Array.from({ length: currentYear - BIRTH_YEAR_MIN + 1 }, (_, i) => currentYear - i)

const months = computed(() => {
  if (String(locale.value || '').startsWith('zh')) {
    return ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
  }
  return [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
})

/** picker 顺序与稿面一致：Month | Day | Year */
const defaultYearIdx = Math.max(0, years.indexOf(2000))
const pickerValue = ref([1, 1, defaultYearIdx]) // Feb / 2nd / 2000

const monthScrollTop = ref(pickerValue.value[0] * ITEM_STEP)
const dayScrollTop = ref(pickerValue.value[1] * ITEM_STEP)
const yearScrollTop = ref(pickerValue.value[2] * ITEM_STEP)
const scrollAnimating = ref(true)

let monthTop = monthScrollTop.value
let dayTop = dayScrollTop.value
let yearTop = yearScrollTop.value
let snapTimers = { m: 0, d: 0, y: 0 }
/** 手指在滚轮上时放行 touchmove，避免锁页把列滚动一起禁掉 */
let pickerTouching = false

function onPageTouchMove(e) {
  if (pickerTouching) return
  // 锁住整页橡皮筋；滚轮列靠 pickerTouching 放行
  e?.preventDefault?.()
  e?.stopPropagation?.()
}

const daysInMonth = computed(() => {
  const monthIndex = pickerValue.value[0]
  const year = years[pickerValue.value[2]]
  return new Date(year, monthIndex + 1, 0).getDate()
})

const daysArray = computed(() => {
  return Array.from({ length: daysInMonth.value }, (_, i) => i + 1)
})

const daysList = computed(() => {
  if (String(locale.value || '').startsWith('zh')) {
    return daysArray.value.map(String)
  }
  return daysArray.value.map(d => {
    if (d === 1 || d === 21 || d === 31) return `${d}st`
    if (d === 2 || d === 22) return `${d}nd`
    if (d === 3 || d === 23) return `${d}rd`
    return `${d}th`
  })
})

function clampDayIndex() {
  const maxDay = daysInMonth.value
  if (pickerValue.value[1] >= maxDay) {
    pickerValue.value[1] = maxDay - 1
    dayScrollTop.value = pickerValue.value[1] * ITEM_STEP
    dayTop = dayScrollTop.value
  }
}

function syncBirthdayFromPicker() {
  const monthIndex = pickerValue.value[0]
  const day = pickerValue.value[1] + 1
  const year = years[pickerValue.value[2]]
  birthday.value = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function forceScrollTop(setter, current, next) {
  // uni scroll-view 相同值不触发，微调强制回弹
  setter(next === current ? next + 0.01 : next)
}

function onPickerTouchStart() {
  pickerTouching = true
  scrollAnimating.value = false
}

function endPickerTouch() {
  pickerTouching = false
}

function onMonthScroll(e) {
  monthTop = e.detail.scrollTop || 0
  const max = months.value.length - 1
  const idx = Math.min(max, Math.max(0, Math.round(monthTop / ITEM_STEP)))
  if (pickerValue.value[0] !== idx) pickerValue.value[0] = idx
}
function onDayScroll(e) {
  dayTop = e.detail.scrollTop || 0
  const max = daysList.value.length - 1
  const idx = Math.min(max, Math.max(0, Math.round(dayTop / ITEM_STEP)))
  if (pickerValue.value[1] !== idx) pickerValue.value[1] = idx
}
function onYearScroll(e) {
  yearTop = e.detail.scrollTop || 0
  const max = years.length - 1
  const idx = Math.min(max, Math.max(0, Math.round(yearTop / ITEM_STEP)))
  if (pickerValue.value[2] !== idx) pickerValue.value[2] = idx
}

function snapTo(kind) {
  endPickerTouch()
  scrollAnimating.value = true
  clearTimeout(snapTimers[kind])
  snapTimers[kind] = setTimeout(() => {
    if (kind === 'm') {
      const max = months.value.length - 1
      const idx = Math.min(max, Math.max(0, Math.round(monthTop / ITEM_STEP)))
      pickerValue.value[0] = idx
      forceScrollTop((v) => { monthScrollTop.value = v }, monthScrollTop.value, idx * ITEM_STEP)
      monthTop = idx * ITEM_STEP
      clampDayIndex()
      syncBirthdayFromPicker()
    } else if (kind === 'd') {
      const max = daysList.value.length - 1
      const idx = Math.min(max, Math.max(0, Math.round(dayTop / ITEM_STEP)))
      pickerValue.value[1] = idx
      forceScrollTop((v) => { dayScrollTop.value = v }, dayScrollTop.value, idx * ITEM_STEP)
      dayTop = idx * ITEM_STEP
      syncBirthdayFromPicker()
    } else {
      const max = years.length - 1
      const idx = Math.min(max, Math.max(0, Math.round(yearTop / ITEM_STEP)))
      pickerValue.value[2] = idx
      forceScrollTop((v) => { yearScrollTop.value = v }, yearScrollTop.value, idx * ITEM_STEP)
      yearTop = idx * ITEM_STEP
      clampDayIndex()
      syncBirthdayFromPicker()
    }
  }, 120)
}

function snapMonth() { snapTo('m') }
function snapDay() { snapTo('d') }
function snapYear() { snapTo('y') }

function selectMonth(index) {
  pickerValue.value[0] = index
  forceScrollTop((v) => { monthScrollTop.value = v }, monthScrollTop.value, index * ITEM_STEP)
  monthTop = index * ITEM_STEP
  clampDayIndex()
  syncBirthdayFromPicker()
}
function selectDay(index) {
  pickerValue.value[1] = index
  forceScrollTop((v) => { dayScrollTop.value = v }, dayScrollTop.value, index * ITEM_STEP)
  dayTop = index * ITEM_STEP
  syncBirthdayFromPicker()
}
function selectYear(index) {
  pickerValue.value[2] = index
  forceScrollTop((v) => { yearScrollTop.value = v }, yearScrollTop.value, index * ITEM_STEP)
  yearTop = index * ITEM_STEP
  clampDayIndex()
  syncBirthdayFromPicker()
}

function calcAgeFromBirthday(ymd) {
  if (!ymd || typeof ymd !== 'string') return 0
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0
  const [y, m, d] = parts
  const now = new Date()
  let age = now.getFullYear() - y
  const monthDiff = now.getMonth() + 1 - m
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d)) age--
  return age
}

async function handleSubmit() {
  syncBirthdayFromPicker()
  const age = calcAgeFromBirthday(birthday.value)
  if (age < 18) {
    uni.showToast({ title: t('onboarding.ageRequirement'), icon: 'none', duration: 2500 })
    return
  }
  const payload = {
    username: username.value || '',
    gender: selectedGender.value || '',
    nickname: nickname.value.trim() || '',
    password: password.value || '',
    preferred_gender: selectedGender2.value || '',
    chat_purpose: selectedTarget.value || '',
    birth: birthday.value || ''
  }

  try {
    const res = await rawFetch('/api/auth/register', { method: 'POST', data: payload })
    const body = res.data
    const data = unwrapApiResults(body)

    // 业务失败：HTTP 成功但 code/ok 表示失败
    if (body && typeof body === 'object') {
      if (body.ok === false) {
        const msg = body.message || body.detail || body.error || t('onboarding.submitFailed')
        uni.showToast({ title: msg, icon: 'none', duration: 2500 })
        return
      }
      if (body.code != null && body.code !== 200) {
        const msg = body.message || body.detail || body.error || t('onboarding.submitFailed')
        uni.showToast({ title: msg, icon: 'none', duration: 2500 })
        return
      }
    }

    if (res.ok) {
      const token = data?.token || data?.access_token
      const user = data?.user
      if (token) {
        setItem('user_token', token)
      }
      if (user) {
        setItem('user_info', JSON.stringify(user))
      }
      // 注册成功：把当前 UI 语言写到用户表
      void pushUiLanguageToServer()
      // Firebase：注册成功 → register_success(device, uid, method=email)
      try {
        trackRegisterSuccess({ method: 'email', user })
        void trackAttributionRegister({ method: 'email' })
        trackRegistrationGuideOutcome({
          gender: selectedGender.value,
          preferredGender: selectedGender2.value,
          purpose: selectedTarget.value,
          birthday: birthday.value,
        })
      } catch {
        /* ignore */
      }
      removeItem('register_draft')
      markGenderSelectUserType('new')
      try {
        startForegroundDree0Timer()
      } catch {
        /* ignore */
      }
      uni.showToast({ title: t('onboarding.submitSuccess'), icon: 'none', duration: 1500 })
      setTimeout(() => {
        goAfterAuth(user)
      }, 1500)
    } else {
      const msg =
        (typeof body === 'object' && (body?.message || body?.detail || body?.error)) ||
        t('onboarding.submitFailed')
      uni.showToast({ title: msg, icon: 'none', duration: 2500 })
    }
  } catch (e) {
    console.error('Register error:', e)
    uni.showToast({ title: t('common.networkError'), icon: 'none', duration: 2500 })
  }
}
</script>

<style scoped lang="scss">
/*
 * 画布 375×812（Figma 836:13180）
 * 横向：rpx = 稿 px × 2（311→622rpx）
 * 纵向：vh = 稿 y/h ÷ 812
 */
.page {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg, #0a0a0a);
  overflow: hidden;
  box-sizing: border-box;
}

/* 顶图区 264/812 ≈ 32.51% */
.hero {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 32.51vh;
  overflow: hidden;
  z-index: 0;
}

.hero-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.hero-person {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

/* Skip：稿 px12/py10、圆角 16、字 14 opacity.8、描边 1 */
.skip-btn {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 21rpx);
  right: 32rpx;
  z-index: 20;
  height: 74rpx;
  min-width: 108rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.5);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 32rpx;
  line-height: 1;
}

/* 底片区 548/812 ≈ 67.49%，顶圆角承接稿 Rectangle 182 */
.sheet {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 67.49vh;
  z-index: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg, #0a0a0a);
  border-radius: 48rpx 48rpx 0 0;
  box-sizing: border-box;
  padding-bottom: env(safe-area-inset-bottom);
  overflow: hidden;
}

.sheet-swiper {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.swiper-item {
  height: 100%;
}

.step-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  /* 标题区 85/812 ≈ 10.47vh；进度区约留 4.7vh */
  padding: 0 0 4.7vh;
}

/* 标题块：稿高 85 → 10.47vh，字 20 */
.title-wrap {
  flex-shrink: 0;
  width: 100%;
  height: 10.47vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16%;
  box-sizing: border-box;
}

.title {
  font-size: 40rpx;
  font-weight: 500;
  color: var(--fg, #fafafa);
  text-align: center;
  line-height: 1.25;
}

/* 选项列表：宽 311/375，条高 52→6.4vh，间距 16→1.97vh */
.option-list {
  width: 82.933%;
  display: flex;
  flex-direction: column;
  gap: 1.97vh;
  flex-shrink: 0;
}

.option {
  width: 100%;
  height: 6.4vh;
  min-height: 88rpx;
  max-height: 112rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 0 48rpx;
  background: var(--surface-inset);
  border: 1rpx solid var(--border-soft);
  border-radius: 32rpx;
  transition: border-color 0.2s, color 0.2s;

  &.active {
    border: 2rpx solid var(--brand);
  }
}

.option-ico {
  width: 26rpx;
  height: 26rpx;
  flex-shrink: 0;
}

.option-label {
  font-size: 32rpx;
  font-weight: 500;
  color: var(--fg);
  line-height: 1.2;
}

.option.active .option-label {
  color: var(--brand-text, var(--brand));
}

/* 基本信息：Select age + 三列滚轮（稿 1475:20146） */
.step-inner--birth {
  align-items: stretch;
  overflow: hidden;
}

.birth-block {
  width: 82.4%; /* 309/375 */
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  justify-content: center;
  align-self: center;
}

.input-label {
  font-size: 24rpx; /* 12 */
  font-weight: 500;
  color: var(--fg-muted, rgba(255, 255, 255, 0.4));
  padding: 16rpx 0; /* py 8 */
  line-height: 1.2;
  flex-shrink: 0;
}

/* 滚轮区：高 227；列宽 110/78/89；间距 16；自绘无白线 */
.birth-picker-row {
  position: relative;
  width: 100%;
  height: 227px;
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 16px;
  box-sizing: border-box;
  background: var(--bg, #0a0a0a);
  overflow: hidden;
}

/* 高亮整行固定在 picker 正中，与三列同 flex，绝不进 scroll-view */
.birth-highlight-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 39px;
  margin-top: -19.5px;
  display: flex;
  flex-direction: row;
  gap: 16px;
  z-index: 1;
  pointer-events: none;
  box-sizing: border-box;
}

.birth-highlight {
  height: 100%;
  border-radius: 16px;
  background: var(--surface-inset, rgba(255, 255, 255, 0.05));
}

.birth-col {
  position: relative;
  z-index: 2;
  height: 227px;
  max-height: 227px;
  overflow: hidden;
  background: transparent;
  overscroll-behavior: none;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 18%,
    #000 82%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 18%,
    #000 82%,
    transparent 100%
  );
}

.birth-col-month {
  flex: 110 1 0;
  min-width: 0;
}

.birth-col-day {
  flex: 78 1 0;
  min-width: 0;
}

.birth-col-year {
  flex: 100 1 0;
  min-width: 0;
}

.birth-scroll {
  width: 100%;
  height: 227px !important;
  max-height: 227px;
  background: transparent !important;
  overscroll-behavior: none;
  -webkit-overflow-scrolling: touch;
}

/* H5 scroll-view 内部常默认白底，上滚时露白缝 */
.birth-col :deep(.uni-scroll-view),
.birth-col :deep(.uni-scroll-view-content),
.birth-col :deep(.uni-scroll-view > div),
.birth-col :deep(.uni-scroll-view-content > div) {
  background-color: transparent !important;
  background: transparent !important;
  max-height: 227px;
}

.birth-pad {
  flex-shrink: 0;
  background: transparent;
}

.birth-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background: transparent;
  padding: 0;
}

.birth-pill {
  width: 100%;
  height: 39px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  font-size: 16px;
  font-weight: 400;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  line-height: 39px;
  text-align: center;
  white-space: nowrap;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
  background: transparent;
}

.birth-pill.selected {
  background: transparent;
  font-weight: 500;
  color: var(--fg, #ffffff);
}

/* 按钮区：上间隙 70/812 ≈ 8.62vh；宽 189/375；高 51 */
.btn {
  margin-top: 8.62vh;
  width: 50.4%;
  max-width: 378rpx;
  height: 6.28vh;
  min-height: 88rpx;
  max-height: 110rpx;
  border-radius: 32rpx;
  background: var(--gradient-brand);
  color: var(--fg-on-brand);
  font-size: 32rpx;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  flex-shrink: 0;
}

.btn.disabled {
  opacity: 0.4;
}

/* 生日步：覆盖上面的 8.62vh，贴底防止整页被撑出滚动 */
.btn.btn--birth {
  margin-top: auto;
  align-self: center;
}

.btn-arrow {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

/* 进度：48×4，间距 8；底距约 (812-778)/812 */
.progress {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16rpx;
  padding: 0 0 2.5vh;
}

.progress-bar {
  width: 96rpx;
  height: 8rpx;
  border-radius: 4rpx;
  background: var(--border, rgba(255, 255, 255, 0.1));

  &.active {
    background: var(--brand-text, #f5b36b);
  }
}
</style>

<style>
/* 隐藏滚轮滚动条 + 强制深色底，杜绝 H5 回弹白边 */
.birth-scroll ::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.birth-col .uni-scroll-view,
.birth-col .uni-scroll-view-content {
  background: var(--bg, #0a0a0a) !important;
  background-color: var(--bg, #0a0a0a) !important;
}
.birth-picker-row,
.birth-block,
.step-inner--birth {
  background: var(--bg, #0a0a0a);
}
</style>
