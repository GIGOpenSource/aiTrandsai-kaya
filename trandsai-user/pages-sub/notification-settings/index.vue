<script setup>
/**
 * @file pages-sub/notification-settings — 通知设置
 * @description 朋友圈/消息/系统/声音开关；本地 storage 持久化。
 */
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import { requireAuth } from "@/composables/useAuth";
import { getItem, setItem } from "@/utils/storage";

const { t } = useI18n();
requireAuth();

const STORAGE_KEY = "notification_prefs";

const defaults = {
  moments: true,
  messages: true,
  system: true,
  sound: true,
};

const prefs = ref({ ...defaults });

const toggles = [
  { key: "moments", label: "notification.moments", desc: "notification.momentsDesc" },
  { key: "messages", label: "notification.messages", desc: "notification.messagesDesc" },
  { key: "system", label: "notification.system", desc: "notification.systemDesc" },
  { key: "sound", label: "notification.sound", desc: "notification.soundDesc" },
];

function loadPrefs() {
  try {
    const raw = getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    prefs.value = { ...defaults, ...parsed };
  } catch {
    prefs.value = { ...defaults };
  }
}

function persist() {
  setItem(STORAGE_KEY, JSON.stringify(prefs.value));
}

function toggle(key) {
  prefs.value = { ...prefs.value, [key]: !prefs.value[key] };
  persist();
}

onMounted(loadPrefs);
</script>

<template>
  <AppPageShell
    :title="t('profile.notificationSettings')"
    :show-back="true"
    back-analytics-id="notification-settings-back"
    back-analytics-name="通知设置页返回"
  >
    <view class="notif-settings">
      <text class="tip">{{ t("notification.tip") }}</text>
      <view class="menu-group">
        <view
          v-for="item in toggles"
          :key="item.key"
          class="menu-item"
          hover-class="menu-item-hover"
          :hover-stay-time="200"
          @tap="toggle(item.key)"
        >
          <view class="menu-text">
            <text class="menu-label">{{ t(item.label) }}</text>
            <text class="menu-desc">{{ t(item.desc) }}</text>
          </view>
          <view class="switch" :class="{ on: prefs[item.key] }">
            <view class="knob" />
          </view>
        </view>
      </view>
    </view>
  </AppPageShell>
</template>

<style scoped lang="scss">
.notif-settings {
  padding: 24rpx 32rpx 48rpx;
  box-sizing: border-box;
}

.tip {
  display: block;
  font-size: 24rpx;
  color: var(--fg-muted);
  margin-bottom: 20rpx;
  padding: 0 8rpx;
}

.menu-group {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-radius: 24rpx;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 28rpx 24rpx;
  border-bottom: 1px solid var(--border);

  &:last-child {
    border-bottom: none;
  }
}

.menu-item-hover {
  background: var(--bg-secondary);
}

.menu-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.menu-label {
  font-size: 28rpx;
  color: var(--fg);
}

.menu-desc {
  font-size: 22rpx;
  color: var(--fg-muted);
  line-height: 1.4;
}

.switch {
  width: 100rpx;
  height: 56rpx;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--bg-input);
  border: 1px solid var(--border);
  position: relative;
  transition: background-color 0.3s ease;

  &.on {
    background: var(--brand);
    border-color: var(--brand);
  }
}

.knob {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.2);
  background: #fff;
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  transition: transform 0.3s ease;
  .on & {
    transform: translateX(44rpx);
  }
}
</style>
