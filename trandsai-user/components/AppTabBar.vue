<script setup>
/**
 * @file AppTabBar.vue
 * @description 自定义底部 TabBar（替代 pages.json 原生 tabBar）。
 * - 四个主 Tab：首页 / 消息 / 发现 / 我的
 * - 消息角标：chat.totalUnread
 * - 当前 Tab 再点：若已滚动则触发回顶（tabScroll）
 * - 键盘弹起：隐藏底栏（避免错误 translateY 把整栏移出屏），收起后复位
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
  /** 父级要求隐藏（如评论聚焦）；用样式藏，不要卸载，避免安卓键盘失焦循环 */
  hidden: { type: Boolean, default: false },
});

const { t } = useI18n();
const chat = useChatStore();
const tabScroll = useTabScrollStore();
const safe = computed(() => readSafeArea());

/** 本地响应式状态，点击时立即更新，提供即时视觉反馈 */
const activePath = ref("");

/**
 * 键盘弹起时隐藏底栏。
 * 不要轮询 getWindowVisibleDisplayFrame：adjustPan / 全面屏上经常抖 0↔N，
 * 底栏闪一下会带着重排，个别安卓键盘就会收起再自己弹出来。
 */
const KEYBOARD_MIN_PX = 80;
const keyboardHeight = ref(0);
let uniKeyboardHeight = 0;
let keyboardWasOpen = false;
/** H5 软键盘只压缩视口，不该藏自定义 TabBar */
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
  // 父级已经藏底栏时不要再改 keyboardHeight，避免首页评论弹键盘时多余重渲染把输入焦点打掉
  if (props.hidden) return;
  const next = Math.max(0, Number(h) || 0);
  if (next >= KEYBOARD_MIN_PX) {
    keyboardWasOpen = true;
    keyboardHeight.value = next;
    return;
  }
  // 没观察到弹起过就当 0，避免导航条高度被当成键盘
  if (!keyboardWasOpen) {
    keyboardHeight.value = 0;
    return;
  }
  keyboardWasOpen = false;
  keyboardHeight.value = 0;
}

function onKeyboardHeightChange(res) {
  uniKeyboardHeight = Math.max(0, Number(res?.height) || 0);
  applyKeyboardHeight(uniKeyboardHeight);
}

/** Tab 配置；badge 仅消息页展示未读。未选中白描边 + icon-on-fg；选中品牌渐变 + icon-brand（浅色压深） */
const tabs = computed(() => [
  { path: "/pages/home/index", currentIcon: "/static/tarbar/home-current.svg", icon: "/static/tarbar/home.svg", label: t("nav.home") },
  { path: "/pages/messages/index", currentIcon: "/static/tarbar/message-current.svg", icon: "/static/tarbar/message.svg", label: t("nav.messages"), badge: true },
  { path: "/pages/discover/index", currentIcon: "/static/tarbar/discover-current.svg", icon: "/static/tarbar/discover.svg", label: t("nav.discover") },
  { path: "/pages/profile/index", currentIcon: "/static/tarbar/my-current.svg", icon: "/static/tarbar/my.svg", label: t("nav.profile") },
]);

const totalUnread = computed(() => chat.totalUnread);

/** 获取当前页面路径 */
function getCurrentPagePath() {
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1];
  if (!cur) return "";
  return "/" + cur.route;
}

/** 初始化/同步当前选中状态 */
function syncActivePath() {
  activePath.value = getCurrentPagePath();
}

/** 判断是否为当前选中 Tab */
function isActive(path) {
  return activePath.value === path;
}

onMounted(() => {
  syncActivePath();
  if (isH5Env) return;
  if (typeof uni.onKeyboardHeightChange === "function") {
    uni.onKeyboardHeightChange(onKeyboardHeightChange);
  }
});

onShow(() => {
  syncActivePath();
  applyKeyboardHeight(uniKeyboardHeight);
});

onUnmounted(() => {
  if (typeof uni.offKeyboardHeightChange === "function") {
    uni.offKeyboardHeightChange(onKeyboardHeightChange);
  }
});

function onTabTap(path) {
  // 先判断是否已经是当前页面
  const alreadyActive = isActive(path);
  
  // 立即更新选中状态，提供即时视觉反馈
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
    class="tab-bar"
    :class="{ 'is-kb-hidden': tabBarHidden }"
    :style="{ paddingBottom: safe.safeAreaBottom + 'px' }"
  >
    <view class="tab-bar-inner">
      <view
        v-for="tab in tabs"
        :key="tab.path"
        class="tab-item"
        :class="{ active: isActive(tab.path) }"
        @tap="onTabTap(tab.path)"
      >
        <view class="tab-icon-wrapper">
          <!-- 未选中：白描边，浅色靠 icon-on-fg 反黑 -->
          <image
            class="tab-icon tab-icon-inactive icon-on-fg"
            :src="tab.icon"
            mode="aspectFit"
          />
          <!-- 选中：品牌渐变；浅色靠 icon-brand 压成深色 -->
          <image
            class="tab-icon tab-icon-active icon-brand"
            :src="tab.currentIcon"
            mode="aspectFit"
          />
          <view
            v-if="tab.badge && totalUnread > 0"
            class="tab-badge"
          >{{ totalUnread > 99 ? "99+" : totalUnread }}</view>
        </view>
        <text
          class="tab-label"
          :class="{ active: isActive(tab.path), muted: !isActive(tab.path) }"
        >{{ tab.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.tab-icon-wrapper {
  position: relative;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 扩大热区，图标视觉不变 */
  &::before {
    content: "";
    position: absolute;
    inset: -20rpx;
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
  /* 保持现有红点观感；与全局 brand 角标区分 */
  background: #ff0000;
  color: #fff;
  font-size: 20rpx;
  font-weight: 500;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-bar.is-kb-hidden {
  /* 只藏视觉，不要改 height：部分安卓 WebView 底栏塌缩会丢掉 input 焦点、键盘自己收 */
  opacity: 0;
  pointer-events: none;
}

.tab-label {
  font-size: 20rpx;
  line-height: 1.2;

  &.active {
    /* 深色选中品牌黄；浅色由 theme.scss 覆写为 --fg */
    color: var(--brand, #fff946);
  }
  &.muted {
    color: var(--fg);
    opacity: 0.6;
  }
}
</style>
