<script setup>
/**
 * @file AppChatEmojiPicker.vue
 * @description 聊天表情面板：分类来自 chatEmojis，emit pick(emoji)。
 */
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { CHAT_EMOJI_CATEGORIES } from "@/utils/chatEmojis";

const emit = defineEmits(["pick"]);
const { t } = useI18n();
const activeCategory = ref(CHAT_EMOJI_CATEGORIES[0]?.key ?? "smile");

const currentCategory = computed(
  () =>
    CHAT_EMOJI_CATEGORIES.find((c) => c.key === activeCategory.value) ??
    CHAT_EMOJI_CATEGORIES[0]
);

function selectCategory(key) {
  activeCategory.value = key;
}

function onPick(emoji) {
  emit("pick", emoji);
}
</script>

<template>
  <view class="emoji-picker" @tap.stop>
    <scroll-view scroll-x class="cat-row" :show-scrollbar="false">
      <view class="cat-row-inner">
        <view
          v-for="cat in CHAT_EMOJI_CATEGORIES"
          :key="cat.key"
          class="cat-chip"
          :class="{ active: cat.key === activeCategory }"
          @tap.stop="selectCategory(cat.key)"
        >
          <text class="cat-chip-text">{{ t(cat.labelKey) }}</text>
        </view>
      </view>
    </scroll-view>
    <view class="emoji-grid">
      <view
        v-for="emoji in currentCategory.emojis"
        :key="emoji"
        class="emoji-item"
        @tap.stop="onPick(emoji)"
      >
        <text class="emoji-item-text">{{ emoji }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.emoji-picker {
  width: 520rpx;
  max-width: 70vw;
}

.cat-row {
  width: 100%;
  white-space: nowrap;
  margin-bottom: 16rpx;
  padding-bottom: 8rpx;
  border-bottom: 1px solid var(--border);
}

.cat-row-inner {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  padding-right: 8rpx;
}

.cat-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 16rpx;
  font-size: 22rpx;
  border-radius: 999px;
  color: var(--fg-muted);
  flex-shrink: 0;

  &.active {
    background: rgba(236, 72, 153, 0.15);
    color: var(--brand-end);
  }
}

.cat-chip-text {
  font-size: 22rpx;
  color: inherit;
  line-height: 1.2;
}

.emoji-grid {
  display: flex;
  flex-wrap: wrap;
  max-height: 320rpx;
  overflow-y: auto;
}

.emoji-item {
  width: 12.5%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 0;
  box-sizing: border-box;
}

.emoji-item-text {
  font-size: 40rpx;
  line-height: 1.2;
}
</style>
