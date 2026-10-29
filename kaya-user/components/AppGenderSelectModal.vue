<script setup>
/**
 * @file AppGenderSelectModal.vue
 * @description 首页强制选择性别弹窗：不可点遮罩关闭，选中并提交成功后才关闭。
 * 提交逻辑与 pages/register/step?mode=gender 一致（PATCH /api/auth/me）。
 */
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeStore } from "@/stores/theme";
import { rawFetch, unwrapApiResults } from "@/utils/api";
import { getAuthHeaders } from "@/utils/authHeaders";
import { getItem, setItem, removeItem } from "@/utils/storage";
import { showToast } from "@/stores/toast";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import {
  peekGenderSelectUserType,
  clearGenderSelectUserType,
} from "@/composables/useAuth";

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(["update:open", "done"]);

const { t } = useI18n();
const themeStore = useThemeStore();

const selected = ref("");
const saving = ref(false);
/** 提交失败后短暂置灰，可重新点选 */
const failed = ref(false);

const options = computed(() => [
  {
    value: "male",
    label: t("onboarding.male"),
    icon: "/static/home/gender-male.svg",
  },
  {
    value: "female",
    label: t("onboarding.female"),
    icon: "/static/home/gender-female.svg",
  },
  {
    value: "non-binary",
    label: t("onboarding.other"),
    icon: "/static/home/gender-other.svg",
  },
]);

function pickErrorCode(res, body) {
  if (body && typeof body === "object") {
    if (body.code != null && body.code !== "") return String(body.code);
    if (body.status_code != null && body.status_code !== "") {
      return String(body.status_code);
    }
    if (body.error_code != null && body.error_code !== "") {
      return String(body.error_code);
    }
  }
  if (res?.status) return String(res.status);
  return "network";
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      selected.value = "";
      saving.value = false;
      failed.value = false;
      trackProductEvent(PRODUCT_EVENTS.GENDER_PAGE_SHOW, {
        page: "home",
        user_type: peekGenderSelectUserType(),
      });
    }
  }
);

async function onSelect(value) {
  if (saving.value || !value) return;
  selected.value = value;
  saving.value = true;
  failed.value = false;
  trackProductEvent(PRODUCT_EVENTS.GENDER_OPTION_CLICK, {
    page: "home",
    gender: value,
  });
  try {
    const res = await rawFetch("/api/auth/me", {
      method: "PATCH",
      data: { gender: value },
      header: getAuthHeaders(),
    });
    if (res.status === 401) {
      trackProductEvent(PRODUCT_EVENTS.GENDER_SUBMIT_FAIL, {
        page: "home",
        gender: value,
        error_code: "401",
      });
      try {
        removeItem("user_token");
        removeItem("user_info");
      } catch {
        /* ignore */
      }
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    const body = res.data;
    const bizFail =
      !res.ok ||
      (body &&
        typeof body === "object" &&
        body.ok === false) ||
      (body &&
        typeof body === "object" &&
        body.code != null &&
        Number(body.code) !== 200);
    if (bizFail) {
      trackProductEvent(PRODUCT_EVENTS.GENDER_SUBMIT_FAIL, {
        page: "home",
        gender: value,
        error_code: pickErrorCode(res, body),
      });
      showToast(t("onboarding.genderSubmitRetry"));
      failed.value = true;
      selected.value = "";
      return;
    }
    const data = unwrapApiResults(body) || body || {};
    const gender = data?.gender ?? value;
    try {
      const prev = JSON.parse(getItem("user_info") || "{}") || {};
      setItem(
        "user_info",
        JSON.stringify({
          ...prev,
          gender,
        })
      );
    } catch {
      /* ignore */
    }
    trackProductEvent(PRODUCT_EVENTS.GENDER_SUBMIT_SUCCESS, {
      page: "home",
      gender,
    });
    clearGenderSelectUserType();
    emit("update:open", false);
    emit("done", gender);
  } catch {
    trackProductEvent(PRODUCT_EVENTS.GENDER_SUBMIT_FAIL, {
      page: "home",
      gender: value,
      error_code: "network",
    });
    showToast(t("onboarding.genderSubmitRetry"));
    failed.value = true;
    selected.value = "";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <view
    v-if="open"
    class="gender-mask"
    :class="themeStore.isDark ? 'theme-dark' : 'theme-light'"
    @touchmove.prevent
  >
    <view class="gender-sheet" @tap.stop>
      <text class="gender-title">{{ t("onboarding.selectGender") }}</text>
      <text class="gender-hint">{{ t("onboarding.selectGenderHint") }}</text>
      <view class="gender-options" :class="{ saving, failed }">
        <view
          v-for="opt in options"
          :key="opt.value"
          class="gender-option"
          :class="{
            active: selected === opt.value,
            dimmed: saving && selected !== opt.value,
          }"
          @tap="onSelect(opt.value)"
        >
          <view class="gender-circle" :class="{ active: selected === opt.value }">
            <image
              v-if="!(saving && selected === opt.value)"
              class="gender-icon"
              :src="opt.icon"
              mode="aspectFit"
            />
            <view
              v-else
              class="gender-spinner"
            />
            <image
              v-if="selected === opt.value && !saving"
              class="gender-check"
              src="/static/home/gender-check.svg"
              mode="aspectFit"
            />
          </view>
          <text class="gender-label" :class="{ active: selected === opt.value }">
            {{ opt.label }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.gender-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 13000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
  pointer-events: auto;
}

.gender-sheet {
  width: 86%;
  max-width: 640rpx;
  padding: 64rpx 48rpx 72rpx;
  border-radius: 80rpx;
  background: #2c2c2c;
  box-sizing: border-box;
}

.gender-title {
  display: block;
  text-align: center;
  font-size: 36rpx;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.3;
  margin-bottom: 16rpx;
}

/* 与未选中选项文案同级次要色，对齐设计稿 */
.gender-hint {
  display: block;
  text-align: center;
  font-size: 26rpx;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
  margin-bottom: 56rpx;
  padding: 0 12rpx;
}

.gender-options {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;

  &.failed .gender-option {
    opacity: 0.85;
  }
}

.gender-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;

  &.dimmed {
    opacity: 0.35;
    pointer-events: none;
  }
}

.gender-circle {
  position: relative;
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 4rpx solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;

  &.active {
    border-color: rgba(255, 249, 70, 1);
  }
}

.gender-label {
  font-size: 28rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.2;
  text-align: center;

  &.active {
    color: rgba(255, 249, 70, 1);
  }
}

/* 浅色模式：白底卡片 + 深色标题/副标题 */
.theme-light {
  .gender-sheet {
    background: #ffffff;
  }

  .gender-title {
    color: #0a0a0a;
  }

  .gender-hint {
    color: rgba(10, 10, 10, 0.4);
  }

  .gender-circle {
    background: rgba(10, 10, 10, 0.06);
  }

  .gender-label {
    color: rgba(10, 10, 10, 0.4);

    &.active {
      color: #dfab52;
    }
  }

  .gender-circle.active {
    border-color: rgba(255, 249, 70, 1);
  }
}

.gender-icon {
  width: 56rpx;
  height: 56rpx;
}

.gender-spinner {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 249, 70, 0.25);
  border-top-color: rgba(255, 249, 70, 1);
  animation: gender-spin 0.8s linear infinite;
}

@keyframes gender-spin {
  to {
    transform: rotate(360deg);
  }
}

.gender-check {
  position: absolute;
  right: -2rpx;
  bottom: -2rpx;
  width: 44rpx;
  height: 44rpx;
}
</style>
