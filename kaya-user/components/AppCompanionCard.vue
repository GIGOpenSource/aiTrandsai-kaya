<script setup>
/**
 * @file AppCompanionCard.vue
 * @description 智能体卡片（首页 Companions Tab 风格）
 *
 * Props:
 *   - companion: 发现页同款的智能体对象 { profile, state, avatar, avatar_generating }
 *   - uiLang:    当前界面语言，用于性格标签翻译
 *
 * Emits:
 *   - profile(id): 点击卡片主体，进入智能体详情
 *   - send(id):    点击右侧发送按钮，进入聊天
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppAvatarImage from "./AppAvatarImage.vue";
import SvgIcon from "./SvgIcon.vue";
import {
  formatCompanionName,
  formatCompanionAge,
} from "@/utils/formatCompanion";
import { formatAffectionDisplay } from "@/utils/formatAffection";
import { translatePersonalityTag } from "@/utils/personalityTags";

const props = defineProps({
  companion: { type: Object, required: true },
  uiLang: { type: String, default: "zh" },
});

const emit = defineEmits(["profile", "send"]);

const { t } = useI18n();

const profile = computed(() => props.companion?.profile || {});
const state = computed(() => props.companion?.state || {});
const companionId = computed(() => profile.value.id);

const displayName = computed(() =>
  formatCompanionName(profile.value.name, t("home.defaultCompanionName"))
);

const ageCity = computed(() => {
  const age = formatCompanionAge(profile.value.age, t);
  const city = profile.value.city || "";
  if (age && city) return `${age} · ${city}`;
  return age || city || "";
});

const genderIcon = computed(() => {
  const g = String(profile.value.gender || "").trim();
  if (g === "男" || g === "male") return "icon-male";
  if (g === "女" || g === "female") return "icon-female";
  return "";
});

const affection = computed(() => formatAffectionDisplay(state.value.affection));

const personalityTags = computed(() => {
  const raw = String(profile.value.personality || "");
  if (!raw) return [];
  return raw
    .split(/[、,，]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((p) => translatePersonalityTag(p, props.uiLang));
});

function onProfileTap() {
  if (companionId.value) emit("profile", companionId.value);
}

function onSendTap() {
  if (companionId.value) emit("send", companionId.value);
}
</script>

<template>
  <view class="companion-card" @tap="onProfileTap">
    <!-- 头像 -->
    <AppAvatarImage
      class="companion-avatar"
      :src="companion.avatar"
      :seed="companionId"
      :generating="companion.avatar_generating"
      size="md"
    />

    <!-- 名字 + 性别 + 年龄城市 -->
    <view class="companion-info">
      <view class="name-row">
        <text class="companion-name">{{ displayName }}</text>
        <SvgIcon
          v-if="genderIcon"
          class="gender-icon"
          :name="genderIcon"
          size="24rpx"
        />
      </view>
      <text v-if="ageCity" class="companion-age-city">{{ ageCity }}</text>
    </view>

    <!-- 发送按钮 -->
    <view class="send-btn" @tap.stop="onSendTap">
      <SvgIcon class="icon-brand" name="icon-send" size="46rpx" />
    </view>

    <!-- 好感度 + MBTI（提出到头像下方，与头像左对齐） -->
    <view class="badges-row">
      <view class="affection-badge">
        <SvgIcon class="heart-icon" name="icon_sel" size="24rpx" />
        <text>{{ affection }}</text>
      </view>
      <view v-if="profile.mbti" class="mbti-badge">
        {{ profile.mbti }}
      </view>
    </view>

    <!-- 性格标签 -->
    <view v-if="personalityTags.length" class="tags-row">
      <text
        v-for="(tag, idx) in personalityTags"
        :key="idx"
        class="personality-tag"
      >
        {{ tag }}
      </text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.companion-card {
  display: grid;
  grid-template-columns: 104rpx 1fr 104rpx;
  grid-template-rows: auto auto auto;
  align-items: start;
  gap: 24rpx 20rpx;
  padding: 32rpx;
  background: var(--card-bg, rgba(255, 255, 255, 0.05));
  border: none;
  border-radius: 32rpx;
  margin-bottom: 24rpx;
}

.companion-avatar {
  grid-column: 1;
  grid-row: 1;
  width: 104rpx !important;
  height: 104rpx !important;
}

.companion-info {
  grid-column: 2;
  grid-row: 1;
  align-self: center;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12rpx;
}

.send-btn {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.companion-name {
  font-size: 32rpx;
  font-weight: 500;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gender-icon {
  flex-shrink: 0;
}

.companion-age-city {
  font-size: 24rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}

.badges-row {
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16rpx;
}

.affection-badge {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 16rpx;
  border-radius: 32rpx;
  background: rgba(231, 71, 164, 0.2);
  color: var(--fg);
  font-size: 24rpx;
  font-weight: 400;
}

.heart-icon {
  flex-shrink: 0;
}

.mbti-badge {
  display: inline-flex;
  align-items: center;
  padding: 12rpx 16rpx;
  border-radius: 32rpx;
  background: rgba(255, 162, 70, 0.2);
  color: var(--fg);
  font-size: 24rpx;
  font-weight: 400;
}

.tags-row {
  grid-column: 1 / 4;
  grid-row: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 0;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.08));
}

.personality-tag {
  padding: 12rpx 16rpx;
  border-radius: 32rpx;
  background: var(--surface-inset, rgba(255, 255, 255, 0.05));
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  font-size: 24rpx;
}

.send-btn {
  flex-shrink: 0;
  width: 104rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 32rpx;
}
</style>
