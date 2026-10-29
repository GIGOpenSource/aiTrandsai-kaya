<script setup>
/**
 * @file pages-sub/create-post — 全屏发帖（对照 Figma 深色/发帖）
 */
import { ref, computed, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import { requireAuth } from "@/composables/useAuth";
import apiFetch from "@/utils/api";
import {
  deviceHeaders,
  chooseLocalImages,
  uploadImage,
  isChooseImageCancel,
} from "@/utils/device";
import { normalizeMediaUrl } from "@/utils/media";
import { showToast } from "@/stores/toast";
import { bindAnalyticsTap } from "@/utils/analytics";
import { goMainTab } from "@/utils/navigation";

const { t } = useI18n();
requireAuth();

const POST_CATEGORIES = [
  { key: "dating", label: "discover.catDating" },
  { key: "psychology", label: "discover.catPsychology" },
  { key: "tips", label: "discover.catTips" },
  { key: "story", label: "discover.catStory" },
  { key: "offtopic", label: "discover.catOfftopic" },
];

const IMAGE_FALLBACK =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTJlOGYwIi8+PC9zdmc+";

const newTitle = ref("");
const newContent = ref("");
const newCategory = ref("");
const newImages = ref([]);
const uploadingImages = ref(false);
const creating = ref(false);
const createAttempted = ref(false);
const noticeOpen = ref(false);
const noticeText = ref("");
const failedImages = ref(new Set());

const createErrorText = computed(() => {
  if (!createAttempted.value) return "";
  if (!newContent.value.trim()) return t("discover.contentRequired");
  if (!newTitle.value.trim()) return t("discover.titleRequired");
  return "";
});

async function handleCreatePost() {
  createAttempted.value = true;
  const title = newTitle.value.trim();
  const content = newContent.value.trim();
  if (!title || !content) return;
  creating.value = true;
  try {
    await apiFetch("/api/posts", {
      method: "POST",
      header: deviceHeaders(),
      data: {
        title,
        content,
        category: newCategory.value,
        images: newImages.value,
      },
    });
    noticeText.value = t("discover.pendingReview");
    noticeOpen.value = true;
  } catch {
    /* apiFetch handles errors */
  } finally {
    creating.value = false;
  }
}

function onNoticeClose() {
  noticeOpen.value = false;
  uni.navigateBack({ fail: () => goMainTab("/pages/discover/index") });
}

async function handleAddImages() {
  if (uploadingImages.value) return;
  if (newImages.value.length >= 9) {
    showToast(t("discover.maxImages"));
    return;
  }
  const remaining = 9 - newImages.value.length;
  let picked = [];
  try {
    picked = await chooseLocalImages(remaining, {
      sizeType: ["compressed", "original"],
      // Photo Picker 拷贝前就转圈，避免选完半天没反馈
      onPreparing: () => {
        uploadingImages.value = true;
      },
    });
  } catch (err) {
    uploadingImages.value = false;
    if (isChooseImageCancel(err)) return;
    console.error("[create-post] choose image failed", err);
    const detail = String(err?.errMsg || err?.message || err || "").slice(0, 60);
    showToast(detail || t("discover.imageUploadFailed"));
    return;
  }
  if (!picked.length) {
    uploadingImages.value = false;
    return;
  }

  uploadingImages.value = true;
  await nextTick();
  try {
    const urls = [];
    for (const path of picked.slice(0, remaining)) {
      const data = await uploadImage(path);
      if (data?.url) urls.push(data.url);
    }
    if (urls.length) {
      newImages.value = [...newImages.value, ...urls];
    } else {
      console.error("[create-post] upload returned empty", picked);
      showToast(t("discover.imageUploadFailed"));
    }
  } catch (err) {
    console.error("[create-post] upload failed", err);
    const detail = String(err?.errMsg || err?.message || err || "").slice(0, 60);
    showToast(detail || t("discover.imageUploadFailed"));
  } finally {
    uploadingImages.value = false;
  }
}

function handleRemoveImage(index) {
  newImages.value = newImages.value.filter((_, i) => i !== index);
}
</script>

<template>
  <AppPageShell
    :title="t('discover.createPost')"
    :show-back="true"
    title-align="start"
    back-analytics-id="create-post-back"
    back-analytics-name="发帖页返回"
  >
    <view class="create-page">
      <scroll-view scroll-y class="create-body">
        <view class="field">
          <input
            v-model="newTitle"
            class="input-field"
            :placeholder="t('discover.titlePlaceholder')"
            maxlength="80"
          />
        </view>

        <view class="field">
          <textarea
            v-model="newContent"
            class="input-field textarea tall"
            :placeholder="t('discover.contentPlaceholder')"
            maxlength="5000"
            :auto-height="false"
          />
        </view>

        <view class="field">
          <view class="upload-grid">
            <view v-for="(img, idx) in newImages" :key="idx" class="upload-thumb">
              <image
                class="upload-img"
                :src="failedImages.has(idx) ? IMAGE_FALLBACK : (normalizeMediaUrl(img) || IMAGE_FALLBACK)"
                mode="aspectFill"
                @error="failedImages.add(idx)"
              />
              <view class="remove-btn" @tap="handleRemoveImage(idx)">✕</view>
            </view>
            <view
              v-if="newImages.length < 9"
              class="upload-add"
              :class="{ 'is-loading': uploadingImages }"
              @tap="!uploadingImages && handleAddImages()"
            >
              <template v-if="uploadingImages">
                <view class="upload-spinner" />
                <text class="add-label loading-label">{{ t("common.loading") }}</text>
              </template>
              <template v-else>
                <image class="add-ico icon-on-fg" src="/static/discover/ico-upload-image.svg" mode="aspectFit" />
                <text class="add-label">{{ t("discover.addImage") }}</text>
              </template>
            </view>
          </view>
        </view>

        <view class="field">
          <text class="field-label">{{ t("discover.postCategory") }}</text>
          <view class="chip-wrap">
            <view
              v-for="cat in POST_CATEGORIES"
              :key="cat.key"
              class="tag-btn"
              :class="{ active: newCategory === cat.key }"
              @tap="newCategory = cat.key"
            >
              <text>{{ t(cat.label) }}</text>
            </view>
          </view>
        </view>

        <text v-if="createErrorText" class="error-text create-error">{{ createErrorText }}</text>
      </scroll-view>

      <view class="create-footer">
        <button
          class="submit-btn"
          :class="{ ready: !creating && !!newTitle.trim() && !!newContent.trim() }"
          :disabled="creating || !newTitle.trim() || !newContent.trim()"
          @tap="bindAnalyticsTap('create-post-publish', handleCreatePost, '发布帖子')"
        >
          {{ creating ? t("discover.publishing") : t("discover.publish") }}
        </button>
      </view>
    </view>

    <AppConfirmDialog
      :open="noticeOpen"
      :description="noticeText"
      :confirm-text="t('common.confirm')"
      cancel-text=""
      @update:open="(v) => { if (!v) onNoticeClose() }"
      @confirm="onNoticeClose"
    />
  </AppPageShell>
</template>

<style scoped lang="scss">
.create-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  box-sizing: border-box;
}

.create-body {
  flex: 1;
  height: 0;
  box-sizing: border-box;
}

/* 本页仅保留上传区 / 分类换行等特例；输入框走全局 .input-field */
.upload-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
}

.upload-thumb,
.upload-add {
  width: 168rpx;
  height: 168rpx;
  border-radius: 32rpx;
  position: relative;
  overflow: hidden;
  background: var(--surface-inset, rgba(255, 255, 255, 0.05));
  border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.05));
  box-sizing: border-box;
}

.upload-img {
  width: 100%;
  height: 100%;
}

.remove-btn {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 16rpx 8rpx;

  &.is-loading {
    pointer-events: none;
    opacity: 0.85;
  }
}

.upload-spinner {
  width: 48rpx;
  height: 48rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: upload-spin 0.8s linear infinite;
  box-sizing: border-box;
}

.loading-label {
  opacity: 0.6;
}

@keyframes upload-spin {
  to {
    transform: rotate(360deg);
  }
}

.add-ico {
  width: 64rpx;
  height: 64rpx;
}

.add-label {
  font-size: 22rpx;
  color: var(--fg);
  text-align: center;
  line-height: 1.2;
}

.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.create-error {
  display: block;
  text-align: center;
  margin: 8rpx var(--page-gutter, 32rpx) 16rpx;
}
</style>
