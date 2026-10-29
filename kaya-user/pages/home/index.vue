<script setup>
/**
 * @file pages/home — 马甲包首页：仅智能体双列卡片
 * @description 品牌名占位 + 通知 + All/Man/Woman 性别筛选；无创建入口（在消息页）
 */
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from "vue";
import { onShow, onBackPress } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppAgentGridCard from "@/components/AppAgentGridCard.vue";
import AppPullRefresh from "@/components/AppPullRefresh.vue";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import AppGenderSelectModal from "@/components/AppGenderSelectModal.vue";
import { requireAuth, hasUserGender } from "@/composables/useAuth";
import { useHomeCompanions } from "@/composables/useHomeCompanions";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import { readSafeArea } from "@/composables/useStatusBar";
import { BRAND_DISPLAY_NAME } from "@/utils/constants";
import { bindAnalyticsTap } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { useTabScrollStore } from "@/stores/tabScroll";
import { useChatStore } from "@/stores/chat";
import { useThemeStore } from "@/stores/theme";
import { isScrollNearBottom } from "@/utils/scrollNearBottom";
import {
  titleBellIconSrc,
  titleFilterIconSrc,
} from "@/utils/themeIcons";
import apiFetch from "@/utils/api";
import { deviceHeaders } from "@/utils/device";
import { getItem } from "@/utils/storage";
import { showToast } from "@/stores/toast";

const TAB_PATH = "/pages/home/index";
const tabScroll = useTabScrollStore();
const { t, locale } = useI18n();
const chat = useChatStore();
const themeStore = useThemeStore();
requireAuth();

/**
 * 缺性别时强制弹窗（不可取消）。
 * 与首页加载并行：不阻塞骨架→内容，选完后再补刷一次空列表。
 */
const showGenderSelect = ref(false);
let genderModalPending = !hasUserGender();
let homePageShownTracked = false;

function tryOpenGenderSelectModal() {
  if (!genderModalPending || hasUserGender()) {
    genderModalPending = false;
    showGenderSelect.value = false;
    return;
  }
  showGenderSelect.value = true;
}

onBackPress(() => {
  if (showGenderSelect.value) return true;
  return false;
});

function onGenderSelectDone() {
  genderModalPending = false;
  showGenderSelect.value = false;
  if (!homeCompanions.value.length) {
    void loadHomeCompanions({ reset: true });
  }
  nextTick(() => {
    setTimeout(() => {
      try {
        void useLimitedOfferStore().onAfterGenderSelect();
      } catch (err) {
        console.warn("[home] limited offer after gender failed", err);
      }
    }, 280);
  });
}

function trackHomePageShowIfReady() {
  if (homePageShownTracked || !initialized) return;
  if (homeCompanionsLoading.value && !displayHomeCompanions.value.length) return;
  homePageShownTracked = true;
  trackProductEvent(PRODUCT_EVENTS.HOME_PAGE_SHOW, { page: "home" });
  if (hasUserGender()) {
    try {
      useLimitedOfferStore().onHomeDisplayReady();
    } catch {
      /* ignore */
    }
  }
}

const brandName = BRAND_DISPLAY_NAME;
const bellIcon = computed(() => titleBellIconSrc(themeStore.isDark));
const filterIcon = computed(() => titleFilterIconSrc(themeStore.isDark));
const tabBarSpacerPx = computed(() => {
  const b = Number(readSafeArea().safeAreaBottom) || 0;
  return b + 72;
});

const {
  homeCompanions,
  homeGenderFilter,
  homeCompanionsLoading,
  homeCompanionsLoadingMore,
  homeCompanionsHasMore,
  displayHomeCompanions,
  loadHomeCompanions,
} = useHomeCompanions({ locale, t });

const refreshing = ref(false);
const hasUnread = computed(() => Number(chat.totalUnread) > 0);
const showFilterMenu = ref(false);
/** 切换性别筛选时的等待态 */
const filterLoading = ref(false);
/** 菜单打开时间戳 */
let filterMenuOpenedAt = 0;
/** 防 App 同一次手势连点两次 */
let filterBtnLock = false;
/** 遮罩防同一次手势穿透 */
const FILTER_MASK_GUARD_MS = 320;
const headerBackOpacity = ref(0);
const scrollTopControl = ref(0);
let lastScrollTop = 0;
let initialized = false;

const genderFilters = computed(() => [
  { value: "", label: "All" },
  { value: "男", label: "Man" },
  { value: "女", label: "Woman" },
]);

/** 筛选项贴在顶栏下方（fixed，避免 App 顶栏高度裁切 absolute） */
const filterMenuTopPx = computed(() => {
  const top = Number(readSafeArea().safeAreaTop) || 0;
  return Math.max(0, top + 52);
});

const loadmoreStatus = computed(() => {
  if (homeCompanionsLoadingMore.value) return "loading";
  if (!homeCompanionsHasMore.value) return "nomore";
  return "loadmore";
});

async function onRefresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await loadHomeCompanions({ reset: true });
  } finally {
    refreshing.value = false;
  }
}

function loadMore() {
  void loadHomeCompanions({ reset: false });
}

function onScroll(e) {
  const detail = e?.detail || {};
  const top = Number(detail.scrollTop) || 0;
  lastScrollTop = top;
  headerBackOpacity.value = Math.min(1, top / 80);
  tabScroll.setScroll(TAB_PATH, top);
  if (isScrollNearBottom(detail, 0, 240)) {
    loadMore();
  }
}

function openFilterMenu() {
  showFilterMenu.value = true;
  filterMenuOpenedAt = Date.now();
}

function closeFilterMenu(reason = "manual") {
  if (!showFilterMenu.value) return;
  const age = Date.now() - filterMenuOpenedAt;
  if (reason === "mask" && age < FILTER_MASK_GUARD_MS) return;
  showFilterMenu.value = false;
}

function onFilterBtnTap() {
  if (filterLoading.value || filterBtnLock) return;
  filterBtnLock = true;
  setTimeout(() => {
    filterBtnLock = false;
  }, 280);
  if (!showFilterMenu.value) {
    openFilterMenu();
    return;
  }
  closeFilterMenu("button");
}

async function selectGenderFilter(value) {
  closeFilterMenu("select");
  if (homeGenderFilter.value === value) return;
  homeGenderFilter.value = value;
  filterLoading.value = true;
  try {
    await loadHomeCompanions({ reset: true });
  } finally {
    filterLoading.value = false;
  }
}

function openCompanion(id) {
  trackProductEvent(
    PRODUCT_EVENTS.AVATAR_PROFILE_CLICK,
    withCompanionId({ page: "home", target_id: String(id ?? "") }, id)
  );
  uni.navigateTo({ url: `/pages-sub/companion/index?id=${id}` });
}

function openChat(id) {
  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
    withCompanionId(
      { page: "home", source: "agent_grid", target_id: String(id ?? "") },
      id
    )
  );
  uni.navigateTo({ url: `/pages/chat/index?id=${id}` });
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** Companions Tab 上正在请求 Say Hi 的 companion id */
const sendingCompanionId = ref("");

/** 本地同步：智能体列表 is_say_hi 置 true */
function markSayHiDone(companionId) {
  const cid = String(companionId || "");
  if (!cid) return;
  homeCompanions.value = homeCompanions.value.map((c) => {
    const id = c?.profile?.id || c?.id;
    return String(id) === cid ? { ...c, is_say_hi: true } : c;
  });
}

/** 今日免费 Say Hi 剩余（接口字段 say_hi_daily_remaining） */
const sayHiDailyRemaining = ref(null);

/** Say Hi 付费拦截弹窗 */
const showSayHiPaywall = ref(false);
const sayHiPaywallTab = ref("vip");
const sayHiPaywallCompanionId = ref("");
const sayHiPaywallExtra = ref({});
const sayHiPaywallVip = ref(false);
const sayHiPaywallPoints = ref(0);
const sayHiPaywallVipName = ref("");
const sayHiPaywallVipExpire = ref("");
const sayHiPaywallVipType = ref("");

function readLocalPaywallUser() {
  try {
    const raw = getItem("user_info");
    const u = raw ? JSON.parse(raw) : {};
    return {
      isVip: Boolean(u?.is_vip),
      points: Number(u?.credits ?? u?.effective_balance ?? 0) || 0,
      vipName: u?.vip_name || "",
      vipExpire: u?.vip_expire_at || "",
      vipType: u?.vip_type || "",
    };
  } catch {
    return { isVip: false, points: 0, vipName: "", vipExpire: "", vipType: "" };
  }
}

function updateSayHiDailyRemaining(res) {
  const n = Number(res?.say_hi_daily_remaining);
  if (!Number.isFinite(n) || n < 0) return;
  sayHiDailyRemaining.value = n;
}

function openSayHiPaywall(companionId, res) {
  const local = readLocalPaywallUser();
  sayHiPaywallCompanionId.value = String(companionId || "");
  sayHiPaywallTab.value = res?.need_vip ? "vip" : "points";
  sayHiPaywallExtra.value = {
    say_hi_daily_remaining: Number(res?.say_hi_daily_remaining) || 0,
    need_paywall: true,
    page: "home",
  };
  sayHiPaywallVip.value = local.isVip;
  sayHiPaywallPoints.value = local.points;
  sayHiPaywallVipName.value = local.vipName;
  sayHiPaywallVipExpire.value = local.vipExpire;
  sayHiPaywallVipType.value = local.vipType;
  showToast(t("home.sayHiNeedPaywall"));
  showSayHiPaywall.value = true;
}

function onSayHiPaywallPurchased(meta = {}) {
  const userData = meta?.userData;
  if (userData) {
    const local = readLocalPaywallUser();
    sayHiPaywallVip.value = Boolean(userData.is_vip ?? local.isVip);
    sayHiPaywallPoints.value =
      Number(userData.credits ?? userData.effective_balance ?? local.points) || 0;
    sayHiPaywallVipName.value = userData.vip_name || local.vipName;
    sayHiPaywallVipExpire.value = userData.vip_expire_at || local.vipExpire;
    sayHiPaywallVipType.value = userData.vip_type || local.vipType;
  }
}

/**
 * 点 Say Hi：POST /api/companions/{id}/say_hi，再进聊天页。
 * 是否付费拦截只看响应 need_paywall（HTTP 200）。
 */
async function requestSayHiAndChat({ companionId, source, busyKey, setBusy }) {
  if (!companionId) return;
  if (busyKey && setBusy) setBusy(busyKey);

  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
    withCompanionId(
      {
        page: "home",
        source,
        target_id: String(companionId),
      },
      companionId
    )
  );

  try {
    const lang = encodeURIComponent(locale.value || "en");
    const path = `/api/companions/${companionId}/say_hi?lang=${lang}`;
    const data = await apiFetch(path, {
      method: "POST",
      header: deviceHeaders(),
    });

    updateSayHiDailyRemaining(data);

    if (data?.need_paywall === true) {
      openSayHiPaywall(data?.companion_id || companionId, data);
      return;
    }

    const cid = data?.companion_id || companionId;
    if (
      Number(data?.say_hi_daily_remaining) === 0 &&
      data?.use_say_hi_daily_free === true
    ) {
      showToast(t("home.sayHiDailyFreeUsedUp"));
    }

    if (data?.message || data?.already || data?.is_say_hi) {
      markSayHiDone(cid);
      uni.navigateTo({ url: `/pages/chat/index?id=${cid}` });
    }
  } catch (sayErr) {
    console.error("[home] say_hi 失败:", sayErr);
    const detail = sayErr?.detail || sayErr?.message || "";
    if (detail && !/网络连接失败|network/i.test(String(detail))) {
      showToast(typeof detail === "string" ? detail : t("common.networkError"));
    } else {
      showToast(t("common.networkError"));
    }
  } finally {
    if (setBusy) setBusy("");
  }
}

/** 网格卡 Hi：未打招呼走 say_hi，已打招呼直接进聊天 */
async function goChatFromCompanion(companionOrId) {
  const companion =
    companionOrId && typeof companionOrId === "object"
      ? companionOrId
      : homeCompanions.value.find(
          (c) => String(c?.profile?.id || c?.id) === String(companionOrId)
        ) || { profile: { id: companionOrId }, id: companionOrId };

  const companionId = String(companion?.profile?.id || companion?.id || "");
  if (!companionId || sendingCompanionId.value === companionId) return;

  if (isTruthyFlag(companion.is_say_hi)) {
    openChat(companionId);
    return;
  }

  await requestSayHiAndChat({
    companionId,
    source: "agent_grid",
    busyKey: companionId,
    setBusy: (v) => {
      sendingCompanionId.value = v;
    },
  });
}

function goNotifications() {
  showFilterMenu.value = false;
  uni.navigateTo({ url: "/pages-sub/notifications/index" });
}

watch(
  () => tabScroll.scrollToTopTick[TAB_PATH],
  () => {
    scrollTopControl.value = lastScrollTop + 1;
    setTimeout(() => {
      scrollTopControl.value = 0;
      lastScrollTop = 0;
      tabScroll.setScroll(TAB_PATH, 0);
    }, 16);
  }
);

onMounted(async () => {
  if (!initialized) {
    initialized = true;
    await loadHomeCompanions({ reset: true });
    trackHomePageShowIfReady();
  }
});

onShow(async () => {
  // 不在 onShow/onHide 里关菜单：App 回前台后生命周期会误触，导致「打开约 1s 又关」
  if (!hasUserGender()) {
    genderModalPending = true;
    tryOpenGenderSelectModal();
  }
  // 限时优惠：已选性别且首页已展示过才刷新（未选性别绝不提前 GET）
  if (homePageShownTracked && hasUserGender()) {
    try {
      useLimitedOfferStore().onTabPageShow();
    } catch {
      /* ignore */
    }
  }
  if (initialized && !homeCompanions.value.length) {
    void loadHomeCompanions({ reset: true });
  }
  if (initialized) trackHomePageShowIfReady();
});

onUnmounted(() => {
  showFilterMenu.value = false;
});
</script>

<template>
  <AppPageShell
    :show-header="false"
    show-tab-bar
    :reserve-tab-bar="false"
    transparent-header
    fill-webview
    :overlay-open="showSayHiPaywall"
  >
    <template #header>
      <view class="header-backdrop" :style="{ opacity: headerBackOpacity }" />
      <view class="home-header">
        <view class="header-row">
          <text class="brand-title">{{ brandName }}</text>
          <view class="header-actions">
            <view
              class="icon-btn"
              @tap="bindAnalyticsTap('home-notification', goNotifications, '通知')"
            >
              <image
                :src="bellIcon"
                class="action-icon"
                mode="aspectFit"
              />
              <view v-if="hasUnread" class="unread-dot" />
            </view>
            <view
              class="icon-btn filter-btn"
              :class="{ 'is-busy': filterLoading, 'is-open': showFilterMenu }"
              @tap.stop="onFilterBtnTap"
            >
              <image
                :src="filterIcon"
                class="action-icon"
                mode="aspectFit"
              />
            </view>
          </view>
        </view>
        <view
          v-show="showFilterMenu"
          class="filter-menu"
          :style="{ top: filterMenuTopPx + 'px' }"
          @tap.stop
        >
          <view
            v-for="opt in genderFilters"
            :key="opt.value || 'all'"
            class="filter-option"
            :class="{ active: homeGenderFilter === opt.value }"
            @tap.stop="selectGenderFilter(opt.value)"
          >
            <text>{{ opt.label }}</text>
          </view>
        </view>
      </view>
    </template>

    <!-- 点空白关闭；z 低于顶栏，不挡筛选按钮 -->
    <view
      v-show="showFilterMenu"
      class="filter-mask"
      @tap="closeFilterMenu('mask')"
      @touchmove.stop.prevent
    />

    <view class="home-page">
      <AppPullRefresh
        class="home-body"
        :refreshing="refreshing"
        :threshold="80"
        :lower-threshold="240"
        :scroll-top="scrollTopControl"
        :show-loadmore="true"
        :loadmore-props="{
          status: loadmoreStatus,
          loadmoreText: ' ',
          loadingText: t('common.loading'),
          nomoreText: t('discover.noCompanions'),
        }"
        @refresh="onRefresh"
        @loadmore="loadMore"
        @scroll="onScroll"
      >
        <template #pull>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner custom-refresh-spinner--idle" />
            <text class="custom-refresh-text">{{ t("common.pullToRefresh") }}</text>
          </view>
        </template>
        <template #release>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner custom-refresh-spinner--idle" />
            <text class="custom-refresh-text">{{ t("common.releaseToRefresh") }}</text>
          </view>
        </template>
        <template #refreshing>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner" />
            <text class="custom-refresh-text">{{ t("common.refreshing") }}</text>
          </view>
        </template>

        <view v-if="homeCompanionsLoading && !displayHomeCompanions.length">
          <AppListSkeleton :rows="6" />
        </view>

        <view v-else-if="!displayHomeCompanions.length && !filterLoading" class="empty text-muted">
          <text>{{ t("home.noCompanions") }}</text>
        </view>

        <view v-else class="agent-grid-wrap">
          <view
            class="agent-grid"
            :class="{ 'is-filter-loading': filterLoading }"
          >
            <view
              v-for="c in displayHomeCompanions"
              :key="c.profile?.id || c.id"
              class="agent-grid-item"
            >
              <AppAgentGridCard
                :companion="c"
                @profile="openCompanion"
                @hi="goChatFromCompanion"
              />
            </view>
          </view>
          <view v-if="filterLoading" class="filter-loading-mask">
            <view class="filter-loading-box">
              <view class="filter-loading-spinner" />
              <text class="filter-loading-text">{{ t("common.loading") }}</text>
            </view>
          </view>
        </view>

        <view class="home-tab-spacer" :style="{ height: tabBarSpacerPx + 'px' }" />
      </AppPullRefresh>
    </view>

    <AppRechargeModal
      v-model:open="showSayHiPaywall"
      :default-tab="sayHiPaywallTab"
      :is-vip="sayHiPaywallVip"
      :vip-name="sayHiPaywallVipName"
      :vip-expire-date="sayHiPaywallVipExpire"
      :vip-type="sayHiPaywallVipType"
      :points="sayHiPaywallPoints"
      :companion-id="sayHiPaywallCompanionId"
      analytics-scene="say_hi"
      :analytics-extra="sayHiPaywallExtra"
      @purchased="onSayHiPaywallPurchased"
    />

    <AppGenderSelectModal
      v-model:open="showGenderSelect"
      @done="onGenderSelectDone"
    />

    <AppLimitedOfferHost show-entry />
  </AppPageShell>
</template>

<style scoped lang="scss">
@import "./index.scss";

/* App 顶栏固定高度会裁切下拉；允许溢出点击 */
:deep(.app-header),
:deep(.app-header-inner) {
  overflow: visible !important;
}

.brand-title {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--fg, #fff);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 28rpx;
}

.filter-btn.is-busy {
  opacity: 0.45;
  pointer-events: none;
}

.action-icon {
  width: 48rpx;
  height: 48rpx;
}

.filter-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 20;
  background: transparent;
}

.filter-menu {
  position: fixed;
  right: 24rpx;
  z-index: 10000;
  min-width: 200rpx;
  padding: 16rpx 0;
  border-radius: 24rpx;
  background: #251f33;
  box-shadow: 0 12rpx 40rpx rgba(0, 0, 0, 0.35);
}

.filter-option {
  padding: 20rpx 40rpx;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
}

.filter-option.active {
  color: #fff;
  font-weight: 600;
}

:global(.theme-light) .filter-menu,
:global(page[data-theme="light"]) .filter-menu {
  background: #ffffff;
  box-shadow: 0 12rpx 40rpx rgba(10, 10, 10, 0.12);
}

:global(.theme-light) .filter-option,
:global(page[data-theme="light"]) .filter-option {
  color: rgba(10, 10, 10, 0.45);
}

:global(.theme-light) .filter-option.active,
:global(page[data-theme="light"]) .filter-option.active {
  color: #0a0a0a;
}

.agent-grid-wrap {
  position: relative;
  min-height: 320rpx;
}

.agent-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 8rpx 16rpx 0;
  box-sizing: border-box;
}

.agent-grid.is-filter-loading {
  opacity: 0.45;
  pointer-events: none;
}

.filter-loading-mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  pointer-events: none;
}

.filter-loading-box {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 32rpx;
  border-radius: 999rpx;
  background: rgba(20, 16, 28, 0.88);
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.2);
}

:global(.theme-light) .filter-loading-box,
:global(page[data-theme="light"]) .filter-loading-box {
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8rpx 24rpx rgba(10, 10, 10, 0.12);
}

.filter-loading-spinner {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 101, 155, 0.25);
  border-top-color: #ff659b;
  animation: home-filter-spin 0.8s linear infinite;
}

.filter-loading-text {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.85);
}

:global(.theme-light) .filter-loading-text,
:global(page[data-theme="light"]) .filter-loading-text {
  color: rgba(10, 10, 10, 0.65);
}

@keyframes home-filter-spin {
  to {
    transform: rotate(360deg);
  }
}

.agent-grid-item {
  width: 50%;
  padding: 8rpx;
  box-sizing: border-box;
}
</style>
