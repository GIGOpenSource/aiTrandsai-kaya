<script setup>
/**
 * @file pages-sub/feedback — Feedback 官方客服聊天
 * @description Messages 置顶入口进入；GET/POST /api/feedback/messages + since_id 轮询；
 * 清空 POST /api/feedback/clear-messages → 聊天页空态，列表入口仍在、时间消失。
 */
import { computed, getCurrentInstance, onMounted, onUnmounted, ref, watch } from "vue";
import {
  onHide,
  onLoad,
  onNavigationBarButtonTap,
  onReady,
  onShow,
} from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import { requireAuth, isLoggedIn } from "@/composables/useAuth";
import apiFetch from "@/utils/api";
import { showToast } from "@/stores/toast";
import { formatBubbleFootTime } from "@/utils/chatTime";
import { lockAndroidAdjustNothing } from "@/utils/androidSoftInput";
import { bindAnalyticsTap } from "@/utils/analytics";

const MESSAGES_URL = "/pages/messages/index";
const POLL_MS = 4000;
const LOGO = "/static/common/logo.svg";

const { t, locale } = useI18n();
const pageVm = getCurrentInstance();
requireAuth();

const keyboardOpen = ref(false);
/** iOS softinput=nothing 时 WebView 不被压矮，需用 spacer 把输入栏顶到键盘上方；安卓勿垫，沿用现有 ime-gap */
const isIOS = uni.getSystemInfoSync()?.platform === "ios";
const keyboardHeight = ref(0);
let keyboardCb = null;

function formatFeedbackTime(iso) {
  return iso ? formatBubbleFootTime(iso, locale.value) : "";
}

const loading = ref(true);
const sending = ref(false);
const clearing = ref(false);
const showClearConfirm = ref(false);
const showMenu = ref(false);
const input = ref("");
const messages = ref([]);
const threadId = ref(null);
/** 是否有过聊天；首条发送后 true，清空后 false */
const hasChat = ref(false);
const scrollIntoView = ref("");
const scrollTop = ref(0);
let scrollIntoTimer = 0;
let keyboardScrollTimers = [];
let pollTimer = null;
let lastMsgId = 0;

const title = computed(() => t("messages.feedback"));

watch(
  title,
  (text) => {
    try {
      uni.setNavigationBarTitle({ title: text || "反馈" });
    } catch {
      /* ignore */
    }
  },
  { immediate: true }
);
const canSend = computed(() => Boolean(input.value.trim()) && !sending.value);
const canClear = computed(
  () => hasChat.value || messages.value.length > 0
);

function maxMsgId(list) {
  let max = 0;
  for (const m of list || []) {
    const id = Number(m?.id) || 0;
    if (id > max) max = id;
  }
  return max;
}

function normalizeMsg(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = Number(raw.id) || 0;
  const sender = String(raw.sender || "").toLowerCase();
  const content = String(raw.content || "").trim();
  if (!content && !id) return null;
  return {
    id,
    sender: sender === "user" ? "user" : sender === "admin" ? "admin" : "system",
    content,
    created_at: raw.created_at || "",
  };
}

function mergeMessages(incoming, { replace = false } = {}) {
  const next = replace ? [] : messages.value.slice();
  const byId = new Map(next.map((m) => [m.id, m]));
  for (const raw of incoming || []) {
    const m = normalizeMsg(raw);
    if (!m || !m.id) continue;
    byId.set(m.id, m);
  }
  const sorted = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  messages.value = sorted;
  lastMsgId = maxMsgId(sorted);
}

function clearKeyboardScrollTimers() {
  for (const id of keyboardScrollTimers) clearTimeout(id);
  keyboardScrollTimers = [];
  if (scrollIntoTimer) {
    clearTimeout(scrollIntoTimer);
    scrollIntoTimer = 0;
  }
}

function pinScrollViewToBottom() {
  try {
    let q = uni.createSelectorQuery();
    if (pageVm?.proxy) q = q.in(pageVm.proxy);
    q.select("#fb-scroll").boundingClientRect();
    q.select("#fb-scroll").scrollOffset();
    q.exec((res) => {
      const rect = res?.[0] || {};
      const offset = res?.[1] || {};
      const vh = Number(rect.height) || 0;
      const sh = Number(offset.scrollHeight) || 0;
      const next = Math.max(0, sh - vh + 12);
      scrollTop.value = next > 0 ? next - 0.01 : 0.01;
      setTimeout(() => {
        scrollTop.value = next;
      }, 16);
    });
  } catch {
    /* ignore */
  }
}

/** 换锚点 + 写 scroll-top：同一 id 赋回去 scroll-view 不会动 */
function scrollToBottom() {
  pinScrollViewToBottom();
  const next =
    scrollIntoView.value === "fb-bottom-a" ? "fb-bottom-b" : "fb-bottom-a";
  scrollIntoView.value = "";
  if (scrollIntoTimer) clearTimeout(scrollIntoTimer);
  scrollIntoTimer = setTimeout(() => {
    scrollIntoTimer = 0;
    scrollIntoView.value = next;
    pinScrollViewToBottom();
  }, 32);
}

function scheduleScrollToLatest(delays = [60, 180, 360, 560]) {
  clearKeyboardScrollTimers();
  for (const ms of delays) {
    keyboardScrollTimers.push(
      setTimeout(() => {
        scrollToBottom();
      }, ms)
    );
  }
}

async function loadMessages({ sinceId = null, markRead = true } = {}) {
  const qs = [];
  if (sinceId != null && Number(sinceId) > 0) {
    qs.push(`since_id=${Number(sinceId)}`);
  }
  if (!markRead) qs.push("mark_read=false");
  const path =
    qs.length > 0
      ? `/api/feedback/messages?${qs.join("&")}`
      : "/api/feedback/messages";
  const data = await apiFetch(path);
  if (data?.thread_id != null) threadId.value = data.thread_id;
  else if (data && Object.prototype.hasOwnProperty.call(data, "thread_id")) {
    threadId.value = null;
  }
  if (typeof data?.has_chat === "boolean") {
    hasChat.value = data.has_chat;
  }
  const list = Array.isArray(data?.messages) ? data.messages : [];
  if (sinceId != null && Number(sinceId) > 0) {
    if (list.length) {
      mergeMessages(list);
      hasChat.value = true;
      scheduleScrollToLatest([32, 120]);
    }
  } else {
    mergeMessages(list, { replace: true });
    if (!list.length && data?.has_chat !== true) {
      hasChat.value = false;
    }
    scheduleScrollToLatest([32, 160, 320]);
  }
  return data;
}

async function bootstrap() {
  if (!isLoggedIn()) {
    showToast(t("feedback.loginRequired"));
    uni.reLaunch({ url: "/pages/login/index" });
    return;
  }
  loading.value = true;
  try {
    await loadMessages({ markRead: true });
  } catch (e) {
    showToast(e?.detail || e?.message || t("feedback.sendFailed"));
  } finally {
    loading.value = false;
  }
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);
}

async function pollOnce() {
  if (sending.value || loading.value) return;
  try {
    await loadMessages({ sinceId: lastMsgId || null, markRead: false });
  } catch {
    /* 轮询失败静默，下次再试 */
  }
}

async function handleSend() {
  if (!canSend.value) return;
  const text = input.value.trim();
  if (!text) return;
  sending.value = true;
  try {
    const data = await apiFetch("/api/feedback/messages", {
      method: "POST",
      data: { content: text },
    });
    input.value = "";
    const sent = normalizeMsg(data);
    if (sent) {
      mergeMessages([sent]);
    } else {
      await loadMessages({ sinceId: lastMsgId || null, markRead: false });
    }
    // 首条发出后 has_chat=true，列表开始显示 last_message_at
    hasChat.value = true;
    scheduleScrollToLatest([32, 160, 320]);
  } catch (e) {
    showToast(e?.detail || e?.message || t("feedback.sendFailed"));
  } finally {
    sending.value = false;
  }
}

function openClearConfirm() {
  showMenu.value = false;
  if (!canClear.value || clearing.value) return;
  showClearConfirm.value = true;
}

function openMenu() {
  if (!canClear.value) return;
  showMenu.value = true;
}

function closeMenu() {
  showMenu.value = false;
}

async function handleClearMessages() {
  if (clearing.value) return;
  clearing.value = true;
  try {
    await apiFetch("/api/feedback/clear-messages", { method: "POST" });
    messages.value = [];
    lastMsgId = 0;
    threadId.value = null;
    hasChat.value = false;
    showToast(t("chat.clearSuccess"));
  } catch (e) {
    showToast(e?.detail || e?.message || t("feedback.sendFailed"));
  } finally {
    clearing.value = false;
  }
}

onNavigationBarButtonTap(() => {
  openMenu();
});

onLoad(() => {
  lockAndroidAdjustNothing();
});

onReady(() => {
  lockAndroidAdjustNothing();
});

onMounted(() => {
  lockAndroidAdjustNothing();
  keyboardCb = (res) => {
    const h = Math.max(0, Number(res?.height) || 0);
    const open = h >= 80;
    keyboardOpen.value = open;
    if (isIOS) {
      keyboardHeight.value = open ? h : 0;
    }
    if (open) scheduleScrollToLatest([80, 240, 480]);
    else clearKeyboardScrollTimers();
  };
  try {
    uni.onKeyboardHeightChange(keyboardCb);
  } catch {
    /* ignore */
  }
  void bootstrap().then(() => startPoll());
});

onShow(() => {
  if (!loading.value) {
    void loadMessages({ markRead: true }).catch(() => {});
    startPoll();
  }
});

onHide(() => stopPoll());
onUnmounted(() => {
  stopPoll();
  clearKeyboardScrollTimers();
  keyboardHeight.value = 0;
  keyboardOpen.value = false;
  if (keyboardCb) {
    try {
      uni.offKeyboardHeightChange(keyboardCb);
    } catch {
      /* ignore */
    }
    keyboardCb = null;
  }
});

</script>

<template>
  <AppPageShell
    :show-header="false"
    :reserve-header="false"
    fill-webview
    :pad-safe-bottom="false"
    back-analytics-id="feedback-back"
    back-analytics-name="反馈聊天返回"
    :back-fallback-url="MESSAGES_URL"
  >
    <view v-if="showMenu" class="fb-menu-mask" @tap="closeMenu" />
    <view v-if="showMenu" class="fb-header-menu">
      <text
        class="fb-menu-item fb-menu-item--danger"
        @tap="bindAnalyticsTap('feedback-clear-messages', openClearConfirm, '清空客服记录')"
      >{{ t("chat.clearMessages") }}</text>
    </view>

    <view class="fb-page">
      <!-- #ifndef APP-PLUS -->
      <view
        v-if="canClear"
        class="fb-overflow-btn"
        @tap="openMenu"
      >···</view>
      <!-- #endif -->
      <scroll-view
        id="fb-scroll"
        class="fb-scroll"
        scroll-y
        :scroll-into-view="scrollIntoView"
        :scroll-top="scrollTop"
        :scroll-with-animation="false"
        :show-scrollbar="false"
      >
        <view v-if="loading && !messages.length" class="fb-empty">
          <text class="text-muted">{{ t("feedback.loading") }}</text>
        </view>
        <view v-else-if="!messages.length" class="fb-empty">
          <text class="text-muted">{{ t("feedback.noMessages") }}</text>
        </view>
        <view v-else class="fb-list">
          <view
            v-for="m in messages"
            :id="`fb-msg-${m.id}`"
            :key="m.id"
            class="fb-row"
            :class="m.sender === 'user' ? 'fb-row--user' : 'fb-row--official'"
          >
            <image
              v-if="m.sender !== 'user'"
              class="fb-avatar"
              :src="LOGO"
              mode="aspectFit"
            />
            <view class="fb-col" :class="m.sender === 'user' ? 'fb-col--user' : ''">
              <text
                v-if="m.sender !== 'user'"
                class="fb-official-name"
              >{{ t("messages.feedback") }}</text>
              <text
                v-if="m.created_at"
                class="fb-time"
                :class="m.sender === 'user' ? 'fb-time--user' : ''"
              >{{ formatFeedbackTime(m.created_at) }}</text>
              <view
                class="fb-bubble"
                :class="m.sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'"
              >
                <text class="fb-text">{{ m.content }}</text>
              </view>
            </view>
          </view>
        </view>
        <view id="fb-bottom-a" class="fb-anchor" />
        <view id="fb-bottom-b" class="fb-anchor" />
        <view class="fb-list-end-pad" />
      </scroll-view>

      <view
        class="composer-bar"
        :class="{ 'composer-bar--ime-gap': keyboardHeight <= 0 }"
      >
        <view class="composer-field-wrap">
          <textarea
            v-model="input"
            class="composer-textarea"
            :placeholder="t('feedback.placeholder')"
            confirm-type="send"
            :adjust-position="false"
            :auto-height="true"
            :show-confirm-bar="false"
            :maxlength="2000"
            @confirm="handleSend"
          />
        </view>
        <view
          class="composer-action composer-action--asset composer-action--send"
          :class="{ 'is-idle': !canSend }"
          hover-class="none"
          @tap="handleSend"
        >
          <image
            class="composer-action-ico"
            src="/static/message/send.png"
            mode="aspectFill"
          />
        </view>
      </view>
      <!-- iOS：softinput nothing 时用键盘高把输入栏顶上去；安卓 keyboardHeight 恒为 0 -->
      <view
        v-if="keyboardHeight > 0"
        class="fb-keyboard-spacer"
        :style="{ height: keyboardHeight + 'px' }"
      />
    </view>

    <AppConfirmDialog
      v-model:open="showClearConfirm"
      :title="t('chat.clearMessages')"
      :description="t('chat.confirmClearMessages')"
      destructive
      @confirm="handleClearMessages"
    />
  </AppPageShell>
</template>

<style scoped lang="scss">
.fb-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 12010;
  background: transparent;
}

.fb-header-menu {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 88rpx);
  right: 24rpx;
  z-index: 12020;
  min-width: 280rpx;
  padding: 12rpx 0;
  border-radius: 16rpx;
  background: var(--modal-bg, #fff);
  border: 1rpx solid var(--border-soft, rgba(0, 0, 0, 0.08));
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
}

.fb-menu-item {
  display: block;
  padding: 24rpx 32rpx;
  font-size: 28rpx;
  color: var(--fg, #111);
}

.fb-menu-item--danger {
  color: var(--destructive, #ef4444);
}

.fb-page {
  position: relative;
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--bg, #f5f5f5);
}

.fb-overflow-btn {
  position: absolute;
  top: 8rpx;
  right: 16rpx;
  z-index: 5;
  width: 72rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  line-height: 1;
  color: var(--fg, #111);
}

.fb-scroll {
  flex: 1;
  min-height: 0;
  height: 0;
  width: 100%;
}

.fb-empty {
  padding: 80rpx 32rpx;
  text-align: center;
}

.fb-list {
  padding: 24rpx var(--page-gutter, 32rpx) 16rpx;
  box-sizing: border-box;
}

.fb-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-bottom: 28rpx;
}

.fb-row--user {
  justify-content: flex-end;
}

.fb-row--official {
  justify-content: flex-start;
}

.fb-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 32rpx;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.06);
}

.fb-col {
  max-width: 75%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.fb-col--user {
  align-items: flex-end;
}

.fb-official-name {
  font-size: 22rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.55));
  padding-left: 8rpx;
}

.fb-bubble {
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
}

.fb-text {
  font-size: 32rpx;
  line-height: 1.4;
  font-weight: 500;
  color: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

.fb-time {
  font-size: 22rpx;
  color: var(--fg-muted);
  opacity: 0.6;
  margin-bottom: 12rpx;
}

.fb-time--user {
  text-align: right;
}

.fb-anchor {
  height: 24rpx;
  width: 100%;
}

.fb-list-end-pad {
  width: 100%;
  height: 16rpx;
  flex-shrink: 0;
}

.composer-bar {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 16rpx;
  padding: 16rpx var(--page-gutter, 32rpx);
  box-sizing: border-box;
  background: var(--bg, #f5f5f5);
  border-top: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.06));
}

/* 安卓 / 无键盘：固定底垫。iOS 弹键盘时改用 fb-keyboard-spacer，避免叠两格。 */
.composer-bar--ime-gap {
  padding-bottom: calc(
    16rpx + 14px + min(env(safe-area-inset-bottom, 0px), 48px)
  );
}

.fb-keyboard-spacer {
  flex-shrink: 0;
  width: 100%;
  background: var(--bg, #f5f5f5);
}

.composer-field-wrap {
  flex: 1;
  min-width: 0;
  min-height: var(--composer-h, 82rpx);
  padding: 20rpx 28rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: var(--surface-inset, rgba(255, 255, 255, 0.06));
  display: flex;
  align-items: center;
}

.composer-textarea {
  width: 100%;
  max-height: 160rpx;
  font-size: 28rpx;
  line-height: 42rpx;
  color: var(--fg);
  background: transparent;
}

.composer-action {
  width: var(--composer-btn-w, 104rpx);
  height: var(--composer-h, 82rpx);
  border-radius: 32rpx;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.composer-action--send.is-idle {
  opacity: 0.45;
  pointer-events: none;
}

.composer-action-ico {
  width: 100%;
  height: 100%;
}
</style>

