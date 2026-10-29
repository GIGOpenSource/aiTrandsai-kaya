<script setup>
/**
 * @file AppReportCharacterPopup.vue
 * @description 全局复用：举报此角色 / 举报某条聊天消息。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStatusBar } from "@/composables/useStatusBar";
import { showToast } from "@/stores/toast";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import {
  REPORT_REASON_EVENTS,
  REMARK_MAX,
  fetchReportReasons,
  submitCompanionReport,
  reportReasonLabel,
} from "@/utils/characterReport";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";

const props = defineProps({
  open: { type: Boolean, default: false },
  characterId: { type: [String, Number], default: "" },
  source: { type: String, default: "profile" },
  messageId: { type: [String, Number], default: "" },
  messageText: { type: String, default: "" },
  messageSender: { type: String, default: "" },
});

const emit = defineEmits(["update:open", "submitted"]);

const { t, locale } = useI18n();
const safe = useStatusBar();
const safePadPx = computed(() => Math.max(0, Number(safe.value.safeAreaBottom) || 0));

const reasonCode = ref("");
const note = ref("");
const reasons = ref([]);
const reasonsLoading = ref(false);
const submitting = ref(false);
const successOpen = ref(false);

const busy = computed(() => reasonsLoading.value || submitting.value);

const isMessageReport = computed(() => {
  const hasId = props.messageId != null && String(props.messageId) !== "";
  const hasText = Boolean(String(props.messageText || "").trim());
  return hasId || hasText;
});

const sheetTitle = computed(() =>
  isMessageReport.value
    ? t("characterReport.messageTitle")
    : t("characterReport.title")
);

const quotedText = computed(() => {
  const s = String(props.messageText || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
});

const displayReasons = computed(() =>
  (reasons.value || []).map((item) => ({
    id: item.id,
    code: item.reason_code,
    key: item.id != null ? `id:${item.id}` : `code:${item.reason_code}`,
    label: reportReasonLabel(item, locale.value, t),
  }))
);

const selectedReason = computed(
  () => displayReasons.value.find((item) => item.code === reasonCode.value) || null
);

const reportScene = computed(() => (isMessageReport.value ? "chat" : "companion"));

const notePlaceholder = computed(() =>
  reasonCode.value === "other"
    ? t("characterReport.notePlaceholderOther")
    : t("characterReport.notePlaceholder")
);

function close() {
  if (submitting.value) return;
  emit("update:open", false);
}

function resetDraft() {
  reasonCode.value = "";
  note.value = "";
  submitting.value = false;
}

async function loadReasons() {
  reasonsLoading.value = true;
  try {
    reasons.value = await fetchReportReasons();
  } catch {
    reasons.value = [];
  } finally {
    reasonsLoading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetDraft();
      return;
    }
    const id = String(props.characterId || "");
    trackProductEvent(
      PRODUCT_EVENTS.REPORT_CHARACTER_CLICK,
      withCompanionId(
        {
          source: props.source || "profile",
          page: props.source || "profile",
          scene: reportScene.value,
          target_id: id,
        },
        id
      )
    );
    void loadReasons();
  }
);

async function onSubmit() {
  if (busy.value) return;
  const id = String(props.characterId || "");
  if (!id) return;
  if (!reasonCode.value) {
    showToast(t("characterReport.selectReason"));
    return;
  }
  const content = isMessageReport.value
    ? String(props.messageText || "").trim()
    : "";
  const remark = String(note.value || "").trim();
  if (reasonCode.value === "other" && !remark && !content) {
    showToast(t("characterReport.otherRequired"));
    return;
  }
  submitting.value = true;
  try {
    const scene = reportScene.value;
    const reasonId = selectedReason.value?.id;
    const result = await submitCompanionReport({
      characterId: id,
      reasonId,
      reasonCode: reasonCode.value,
      remark,
      content,
      scene,
      source: props.source,
    });
    const trackBase = withCompanionId(
      {
        source: props.source || "profile",
        page: props.source || "profile",
        scene,
        target_id: id,
        reason_code: reasonCode.value,
        reason_id: reasonId ?? "",
      },
      id
    );
    trackProductEvent(PRODUCT_EVENTS.REPORT_CHARACTER_SUBMIT, trackBase);
    trackProductEvent(PRODUCT_EVENTS.REPORT_CHARACTER_SUCCESS, trackBase);
    const reasonEvent = REPORT_REASON_EVENTS[reasonCode.value];
    if (reasonEvent) {
      trackProductEvent(reasonEvent, trackBase);
    }
    emit("submitted", {
      kind: isMessageReport.value ? "message" : "character",
      characterId: id,
      reasonCode: reasonCode.value,
      reasonId,
      scene,
      source: props.source,
      duplicate: Boolean(result?.duplicate),
      messageId: props.messageId,
      content,
    });
    emit("update:open", false);
    successOpen.value = true;
  } catch {
    /* apiFetch 已 toast */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view v-if="open" class="report-mask" @tap="close">
    <view
      class="report-sheet"
      :style="{ paddingBottom: safePadPx + 16 + 'px' }"
      @tap.stop
    >
      <view class="report-handle" />
      <text class="report-title">{{ sheetTitle }}</text>
      <view v-if="quotedText" class="report-quote">
        <view class="report-quote-bar" />
        <text class="report-quote-text">{{ quotedText }}</text>
      </view>

      <view v-if="reasonsLoading" class="report-state">
        <view class="report-spinner">
          <view class="report-spinner-hole" />
        </view>
        <text class="report-state-text">{{ t("common.loading") }}</text>
      </view>
      <view v-else-if="!displayReasons.length" class="report-state">
        <text class="report-state-text">{{ t("common.loadFailed") }}</text>
        <text class="report-retry text-primary" @tap="loadReasons">{{ t("common.retry") }}</text>
      </view>
      <view v-else class="reason-list">
        <view
          v-for="item in displayReasons"
          :key="item.key"
          class="reason-row"
          :class="{ selected: reasonCode === item.code }"
          @tap="reasonCode = item.code"
        >
          <view class="reason-radio" :class="{ on: reasonCode === item.code }">
            <view v-if="reasonCode === item.code" class="reason-radio-dot" />
          </view>
          <text class="reason-label">{{ item.label }}</text>
        </view>
      </view>

      <view class="note-wrap">
        <textarea
          v-model="note"
          class="note-input"
          :maxlength="REMARK_MAX"
          :placeholder="notePlaceholder"
          :disabled="busy"
          :auto-height="false"
          :adjust-position="true"
          :show-confirm-bar="false"
        />
        <text class="note-count">{{ note.length }}/{{ REMARK_MAX }}</text>
      </view>
      <view class="report-actions">
        <view class="report-btn cancel" :class="{ disabled: submitting }" @tap="close">
          <text class="report-btn-text">{{ t("common.cancel") }}</text>
        </view>
        <view
          class="report-btn confirm"
          :class="{ disabled: busy }"
          @tap="onSubmit"
        >
          <view v-if="submitting" class="report-btn-spinner" />
          <text v-else class="report-btn-text">{{ t("characterReport.submit") }}</text>
        </view>
      </view>
    </view>
  </view>
  <AppConfirmDialog
    v-model:open="successOpen"
    :title="t('characterReport.successTitle')"
    :description="t('characterReport.success')"
    :cancel-text="''"
    :close-on-mask="false"
  />
</template>

<style scoped lang="scss">
.report-mask {
  position: fixed;
  inset: 0;
  z-index: 11000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.report-sheet {
  width: 100%;
  max-height: 88vh;
  border-radius: 32rpx 32rpx 0 0;
  padding: 16rpx 32rpx 0;
  box-sizing: border-box;
  overflow-y: auto;
  background: var(--bubble-ai-bg, #1c1c1e);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.16));
  border-bottom: none;
  box-shadow: 0 -16rpx 64rpx rgba(0, 0, 0, 0.5);
}
.report-handle {
  width: 72rpx;
  height: 8rpx;
  border-radius: 8rpx;
  background: var(--border, rgba(255, 255, 255, 0.16));
  margin: 8rpx auto 24rpx;
}
.report-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 24rpx;
}
.report-quote {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  margin: -8rpx 0 24rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  background: var(--bg-input);
  overflow: hidden;
}
.report-quote-bar {
  width: 6rpx;
  border-radius: 6rpx;
  background: var(--gradient-brand-btn);
  flex-shrink: 0;
  margin-right: 16rpx;
  overflow: hidden;
}
.report-quote-text {
  display: block;
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  line-height: 1.45;
  color: var(--fg-muted);
}
.report-state {
  min-height: 240rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-bottom: 24rpx;
  gap: 16rpx;
}
.report-spinner {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: var(--gradient-brand-btn);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: report-spin 0.8s linear infinite;
}
.report-spinner-hole {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: var(--bubble-ai-bg, #1c1c1e);
}
.report-btn-spinner {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(10, 10, 10, 0.2);
  border-top-color: var(--fg-on-brand, #0a0a0a);
  animation: report-spin 0.8s linear infinite;
  box-sizing: border-box;
}
.report-state-text {
  font-size: 26rpx;
  color: var(--fg-muted);
}
.report-retry {
  font-size: 26rpx;
  color: var(--brand-text, var(--brand, #FF659B));
  padding: 8rpx 16rpx;
}
.reason-list {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-bottom: 24rpx;
}
.reason-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 88rpx;
  padding: 0 8rpx;
  border-radius: 16rpx;
}
.reason-row.selected {
  background: var(--bg-input, rgba(255, 255, 255, 0.06));
}
.reason-radio {
  width: 36rpx;
  height: 36rpx;
  border-radius: 36rpx;
  border: 2rpx solid var(--border, rgba(255, 255, 255, 0.28));
  margin-right: 20rpx;
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.reason-radio.on {
  border-color: var(--border, rgba(255, 255, 255, 0.28));
  background: transparent;
}
.reason-radio-dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 18rpx;
  background: var(--gradient-brand-btn);
  flex-shrink: 0;
}
.reason-label {
  font-size: 28rpx;
  color: var(--fg);
  flex: 1;
}
.note-wrap {
  position: relative;
  margin-bottom: 28rpx;
}
.note-input {
  width: 100%;
  min-height: 140rpx;
  padding: 20rpx 24rpx 48rpx;
  box-sizing: border-box;
  border-radius: 20rpx;
  background: var(--bg-input);
  color: var(--fg);
  font-size: 26rpx;
  line-height: 1.45;
  border: 2rpx solid var(--border);
}
.note-count {
  position: absolute;
  right: 20rpx;
  bottom: 12rpx;
  font-size: 22rpx;
  color: var(--fg-faint, rgba(255, 255, 255, 0.35));
}
.report-actions {
  display: flex;
  flex-direction: row;
}
.report-btn {
  flex: 1;
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  &.cancel {
    background: var(--bg-input);
    border: 2rpx solid var(--border);
    margin-right: 20rpx;
    color: var(--fg);
  }
  &.confirm {
    background: var(--gradient-brand-btn);
    color: var(--fg-on-brand, #0a0a0a);
  }
  &.disabled {
    opacity: 0.55;
  }
}
.report-btn-text {
  font-size: 28rpx;
  line-height: 1.2;
  color: inherit;
}
@keyframes report-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
