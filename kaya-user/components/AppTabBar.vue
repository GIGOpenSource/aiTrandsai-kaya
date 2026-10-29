<script setup>
/**
 * @file AppTabBar.vue
 * @description 马甲包底部 TabBar：悬浮胶囊 + 粉紫选中图标
 */
import { computed, ref, onMounted, onUnmounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import { useChatStore } from "@/stores/chat";
import { useTabScrollStore } from "@/stores/tabScroll";
import { readSafeArea } from "@/composables/useStatusBar";
import { goMainTab } from "@/utils/navigation";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";

const TAB_ANALYTICS = {
  "/pages/messages/index": PRODUCT_EVENTS.MESSAGE_PAGE_CLICK,
  "/pages/discover/index": PRODUCT_EVENTS.COMMUNITY_PAGE_CLICK,
  "/pages/profile/index": PRODUCT_EVENTS.MINE_PAGE_CLICK,
};

const props = defineProps({
  hidden: { type: Boolean, default: false },
});

const { t } = useI18n();
const chat = useChatStore();
const tabScroll = useTabScrollStore();
const safe = computed(() => readSafeArea());

const activePath = ref("");

const KEYBOARD_MIN_PX = 80;
const keyboardHeight = ref(0);
let uniKeyboardHeight = 0;
let keyboardWasOpen = false;
let isH5Env = false;
// #ifdef H5
isH5Env = true;
// #endif
const tabBarHidden = computed(
  () => props.hidden || (!isH5Env && keyboardHeight.value >= KEYBOARD_MIN_PX)
);

function applyKeyboardHeight(h) {
  if (isH5Env) {
    keyboardHeight.value = 0;
    return;
  }
  const next = Math.max(0, Number(h) || 0);
  if (next >= KEYBOARD_MIN_PX) {
    keyboardWasOpen = true;
    keyboardHeight.value = next;
    return;
  }
  if (!keyboardWasOpen) {
    keyboardHeight.value = 0;
    return;
  }
  keyboardWasOpen = false;
  keyboardHeight.value = 0;
}

function onKeyboardHeightChange(res) {
  uniKeyboardHeight = Math.max(0, Number(res?.height) || 0);
  applyKeyboardHeight(Math.max(uniKeyboardHeight, readViewportKeyboard()));
}

function readViewportKeyboard() {
  try {
    if (typeof window === "undefined") return 0;
    const vv = window.visualViewport;
    if (vv && vv.height > 0) {
      return Math.max(0, Math.round(window.innerHeight - vv.height));
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function onViewportChange() {
  applyKeyboardHeight(Math.max(uniKeyboardHeight, readViewportKeyboard()));
}

/** 马甲包 Tab 切图（选中带粉紫渐变，未选中灰描边） */
const tabs = computed(() => [
  {
    path: "/pages/home/index",
    currentIcon: "/static/vest/tabbar/home.png",
    icon: "/static/vest/tabbar/home-off.png",
    label: t("nav.home"),
  },
  {
    path: "/pages/messages/index",
    currentIcon: "/static/vest/tabbar/message.png",
    icon: "/static/vest/tabbar/message-off.png",
    label: t("nav.messages"),
    badge: true,
  },
  {
    path: "/pages/discover/index",
    currentIcon: "/static/vest/tabbar/discover.png",
    icon: "/static/vest/tabbar/discover-off.png",
    label: t("nav.discover"),
  },
  {
    path: "/pages/profile/index",
    currentIcon: "/static/vest/tabbar/profile.png",
    icon: "/static/vest/tabbar/profile-off.png",
    label: t("nav.profile"),
  },
]);

const totalUnread = computed(() => chat.totalUnread);

function getCurrentPagePath() {
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1];
  if (!cur) return "";
  return "/" + cur.route;
}

function syncActivePath() {
  activePath.value = getCurrentPagePath();
}

function isActive(path) {
  return activePath.value === path;
}

onMounted(() => {
  syncActivePath();
  if (isH5Env) return;
  if (typeof uni.onKeyboardHeightChange === "function") {
    uni.onKeyboardHeightChange(onKeyboardHeightChange);
  }
  try {
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
  } catch {
    /* ignore */
  }
});

onShow(() => {
  syncActivePath();
  applyKeyboardHeight(Math.max(uniKeyboardHeight, readViewportKeyboard()));
});

onUnmounted(() => {
  if (typeof uni.offKeyboardHeightChange === "function") {
    uni.offKeyboardHeightChange(onKeyboardHeightChange);
  }
  try {
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("scroll", onViewportChange);
  } catch {
    /* ignore */
  }
});

function onTabTap(path) {
  const alreadyActive = isActive(path);
  activePath.value = path;

  const tabEvent = TAB_ANALYTICS[path];
  if (tabEvent && !alreadyActive) {
    trackProductEvent(tabEvent, { page: "tab_bar", target_id: path });
  }

  if (alreadyActive) {
    if (tabScroll.isScrolled(path)) {
      tabScroll.requestScrollToTop(path);
    }
    return;
  }
  goMainTab(path);
}
</script>

<template>
  <view
    class="tab-bar tab-bar--vest"
    :class="{ 'is-kb-hidden': tabBarHidden }"
    :style="{ paddingBottom: (Math.max(8, Number(safe.safeAreaBottom) || 0) + 12) + 'px' }"
  >
    <view class="tab-bar-pill">
      <view class="tab-bar-inner">
        <view
          v-for="tab in tabs"
          :key="tab.path"
          class="tab-item"
          :class="{ active: isActive(tab.path) }"
          @tap="onTabTap(tab.path)"
        >
          <view class="tab-icon-wrapper">
            <image
              class="tab-icon tab-icon-inactive"
              :src="tab.icon"
              mode="aspectFit"
            />
            <image
              class="tab-icon tab-icon-active"
              :src="tab.currentIcon"
              mode="aspectFit"
            />
            <view
              v-if="tab.badge && totalUnread > 0"
              class="tab-badge"
            >{{ totalUnread > 99 ? "99+" : totalUnread }}</view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.tab-bar--vest {
  position: fixed !important;
  left: 50% !important;
  right: auto !important;
  bottom: 0 !important;
  top: auto !important;
  transform: translateX(-50%);
  width: 100%;
  max-width: 672px;
  z-index: 1000;
  background: transparent !important;
  border-top: none !important;
  padding-left: 40rpx;
  padding-right: 40rpx;
  padding-top: 0;
  box-sizing: border-box;
  pointer-events: none;
}

.tab-bar-pill {
  pointer-events: auto;
  width: 100%;
  max-width: 670rpx;
  margin: 0 auto;
  height: 96rpx;
  border-radius: 999rpx;
  background: rgba(20, 16, 28, 0.88);
  border: 1rpx solid rgba(255, 255, 255, 0.08);
  /* #ifdef H5 */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  /* #endif */
  box-shadow: 0 12rpx 40rpx rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.tab-bar-inner {
  height: 96rpx;
  padding: 0 12rpx;
}

.tab-icon-wrapper {
  position: relative;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  &::before {
    content: "";
    position: absolute;
    inset: -24rpx;
  }
}

.tab-icon {
  position: absolute;
  width: 48rpx;
  height: 48rpx;
}

.tab-icon-inactive {
  opacity: 1;
  transition: opacity 0.15s ease;
}

.tab-icon-active {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tab-item.active .tab-icon-inactive {
  opacity: 0;
}

.tab-item.active .tab-icon-active {
  opacity: 1;
}

.tab-badge {
  position: absolute;
  top: -8rpx;
  right: -12rpx;
  min-width: 20rpx;
  height: 32rpx;
  padding: 0 8rpx;
  background: #ee3639;
  color: #fff;
  font-size: 20rpx;
  font-weight: 500;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-bar.is-kb-hidden {
  transform: translate(-50%, 100vh) !important;
  bottom: -100vh !important;
  height: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  background: transparent !important;
}
</style>
