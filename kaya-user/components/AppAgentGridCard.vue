<script setup>
/**
 * @file AppAgentGridCard.vue
 * @description 首页双列智能体卡：封面全铺 + 底部渐变叠字（对照 Figma 模版）
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  formatCompanionName,
  formatCompanionAge,
} from "@/utils/formatCompanion";
import { normalizeMediaUrl } from "@/utils/media";

const props = defineProps({
  companion: { type: Object, required: true },
});

const emit = defineEmits(["profile", "hi"]);

const { t } = useI18n();

const profile = computed(() => props.companion?.profile || {});
const companionId = computed(() => profile.value.id);

const isSayHiDone = computed(() => {
  const v = props.companion?.is_say_hi;
  return v === true || v === 1 || v === "1" || v === "true";
});

const displayName = computed(() =>
  formatCompanionName(profile.value.name, t("home.defaultCompanionName"))
);

const coverSrc = computed(() => {
  const raw =
    props.companion?.avatar ||
    profile.value.avatar ||
    profile.value.cover ||
    "";
  return normalizeMediaUrl(raw) || "";
});

const quote = computed(() => {
  const bio =
    profile.value.bio ||
    profile.value.introduction ||
    profile.value.backstory ||
    profile.value.tagline ||
    "";
  const text = String(bio).trim();
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return t("home.agentDefaultQuote");
});

const metaLine = computed(() => {
  const age = formatCompanionAge(profile.value.age, t);
  const mbti = profile.value.mbti || "";
  const city = profile.value.city || "";
  return [age, mbti, city].filter(Boolean).join(" · ");
});

function onCardTap() {
  if (companionId.value) emit("profile", companionId.value);
}

function onHiTap() {
  if (companionId.value) emit("hi", companionId.value);
}
</script>

<template>
  <view class="agent-card" @tap="onCardTap">
    <image
      v-if="coverSrc"
      class="agent-cover"
      :src="coverSrc"
      mode="aspectFill"
    />
    <view v-else class="agent-cover agent-cover--placeholder" />
    <view class="agent-fade" />
    <view class="agent-overlay">
      <text class="agent-quote">{{ quote }}</text>
      <view class="agent-name-row">
        <text class="agent-name">{{ displayName }}</text>
        <image
          class="hi-btn-img"
          :class="{ 'hi-btn-img--done': isSayHiDone }"
          src="/static/vest/home/hi.png"
          mode="aspectFit"
          @tap.stop="onHiTap"
        />
      </view>
      <text v-if="metaLine" class="agent-meta">{{ metaLine }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 稿：270px 高、圆角 8、底渐变叠字 */
.agent-card {
  position: relative;
  width: 100%;
  height: 540rpx;
  border-radius: 16rpx;
  overflow: hidden;
  background: #1a1627;
}

.agent-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.agent-cover--placeholder {
  background: rgba(255, 255, 255, 0.08);
}

.agent-fade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0) 50%,
    rgba(0, 0, 0, 0.8) 73.89%
  );
}

.agent-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 16rpx;
  padding: 32rpx 24rpx;
  box-sizing: border-box;
}

.agent-quote {
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.92);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.agent-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.agent-name {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hi-btn-img {
  flex-shrink: 0;
  width: 72rpx;
  height: 44rpx;
}

.hi-btn-img--done {
  opacity: 0.72;
}

.agent-meta {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.7);
}
</style>
