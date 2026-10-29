<script setup>
/**
 * @file pages-sub/feedback — Feedback 官方客服聊天
 * @description Messages 置顶入口进入；GET/POST /api/feedback/messages + since_id 轮询，无 WebSocket。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { onHide, onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import { requireAuth, isLoggedIn } from "@/composables/useAuth";
import apiFetch from "@/utils/api";
import { showToast } from "@/stores/toast";
import { useRelativeTime } from "@/composables/useRelativeTime";

const MESSAGES_URL = "/pages/messages/index";
const POLL_MS = 4000;
const LOGO = "/static/common/logo1.svg";

const { t } = useI18n();
const { format: formatRelativeTime } = useRelativeTime("messages");
requireAuth();

const loading = ref(true);
const sending = ref(false);
const input = ref("");
const messages = ref([]);
const threadId = ref(null);
const scrollIntoView = ref("");
let pollTimer = null;
let lastMsgId = 0;

const title = computed(() => t("feedback.title"));
const canSend = computed(() => Boolean(input.value.trim()) && !sending.value);

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

async function scrollToBottom(force = false) {
  await nextTick();
  const list = messages.value;
  if (!list.length) return;
  const last = list[list.length - 1];
  const key = `fb-msg-${last.id}`;
  if (!force && scrollIntoView.value === key) {
    scrollIntoView.value = "";
    await nextTick();
  }
  scrollIntoView.value = key;
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
  const list = Array.isArray(data?.messages) ? data.messages : [];
  if (sinceId != null && Number(sinceId) > 0) {
    if (list.length) {
      mergeMessages(list);
      await scrollToBottom();
    }
  } else {
    mergeMessages(list, { replace: true });
    await scrollToBottom(true);
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
    await scrollToBottom(true);
  } catch (e) {
    showToast(e?.detail || e?.message || t("feedback.sendFailed"));
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  void bootstrap().then(() => startPoll());
});

onShow(() => {
  if (!loading.value) {
    void loadMessages({ markRead: true }).catch(() => {});
    startPoll();
  }
});

onHide(() => stopPoll());
onUnmounted(() => stopPoll());
</script>

<template>
  <AppPageShell
    :title="title"
    :show-back="true"
    fill-webview
    back-analytics-id="feedback-back"
    back-analytics-name="反馈聊天返回"
    :back-fallback-url="MESSAGES_URL"
  >
    <view class="fb-page">
      <scroll-view
        class="fb-scroll"
        scroll-y
        :scroll-into-view="scrollIntoView"
        :scroll-with-animation="true"
        :show-scrollbar="false"
      >
        <view v-if="loading && !messages.length" class="fb-empty">
          <text class="text-muted">{{ t("feedback.loading") }}</text>
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
              <view
                class="fb-bubble"
                :class="m.sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'"
              >
                <text class="fb-text">{{ m.content }}</text>
              </view>
              <text v-if="m.created_at" class="fb-time">{{ formatRelativeTime(m.created_at) }}</text>
            </view>
          </view>
        </view>
        <view class="fb-anchor" />
      </scroll-view>

      <view class="composer-bar composer-bar--inset-bottom">
        <view class="composer-field-wrap">
          <textarea
            v-model="input"
            class="composer-textarea"
            :placeholder="t('feedback.placeholder')"
            confirm-type="send"
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
    </view>
  </AppPageShell>
</template>

<style scoped lang="scss">
.fb-page {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
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
}

.fb-anchor {
  height: 8rpx;
}

.composer-bar {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 16rpx;
  padding: 16rpx var(--page-gutter, 32rpx);
  box-sizing: border-box;
  background: var(--bg, #0a0a0a);
  border-top: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.06));
}

.composer-bar--inset-bottom {
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
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
