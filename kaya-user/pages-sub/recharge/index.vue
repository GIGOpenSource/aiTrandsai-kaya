<script setup>
/**
 * @file pages-sub/recharge — 充值弹窗宿主页
 * @description App 聊天 nvue 无法挂 Vue 弹窗；积分不足时 navigateTo 本页打开 AppRechargeModal。
 * 页背景必须透明，才能透过遮罩看到下层聊天。
 * 触发付费墙若有限时优惠：关掉充值墙，由本页 Host 展示限时弹窗；关闭后再回聊天。
 */
import { ref, nextTick, onUnmounted, watch } from "vue";
import { onLoad, onShow, onReady } from "@dcloudio/uni-app";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import { getItem, setItem } from "@/utils/storage";
import { useChatStore } from "@/stores/chat";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import { readRecentOurMomentsTip } from "@/utils/ourMoments";
import { enableTransparentOverlayWebview } from "@/utils/overlayWebview";

function loadCachedUser() {
  try {
    const raw = getItem("user_info");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const cached = loadCachedUser();
const chatStore = useChatStore();
const limitedOffer = useLimitedOfferStore();
/** 初始必须 false：Modal 只在 open 变为 true 时拉 /api/benefits */
const open = ref(false);
const defaultTab = ref("points");
const insufficient = ref(true);
const companionId = ref("");
const isVip = ref(Boolean(cached?.is_vip));
const points = ref(Number(cached?.credits) || 0);
const vipName = ref(cached?.vip_name || "");
const vipExpireDate = ref(cached?.vip_expire_at || "");
const vipType = ref(cached?.vip_type || "");

/** 传给弹窗的 tip（含迟到补写） */
const momentsTip = ref("");
let lateTipPollTimer = null;
let lateTipPollLeft = 0;

function applyTip(text) {
  const next = String(text || "").trim();
  if (!next) return;
  momentsTip.value = next;
}

function resolveTipFromQuery(query) {
  const raw = query?.momentsTip;
  if (raw == null || raw === "") return "";
  const s = String(raw);
  try {
    if (/%[0-9A-Fa-f]{2}/.test(s)) return decodeURIComponent(s).trim();
  } catch {
    /* ignore */
  }
  return s.trim();
}

function resolveTipText(queryTip) {
  if (queryTip) return queryTip;
  try {
    const live = String(chatStore.ourMomentsTip?.text || "").trim();
    if (live) return live;
    const snap = String(chatStore.paywallMomentsTip || "").trim();
    if (snap) return snap;
  } catch {
    /* ignore */
  }
  return readRecentOurMomentsTip();
}

function onLateTipEvent(text) {
  applyTip(text);
}

function startLateTipPoll() {
  lateTipPollLeft = 8;
  if (lateTipPollTimer) clearInterval(lateTipPollTimer);
  lateTipPollTimer = setInterval(() => {
    lateTipPollLeft -= 1;
    if (lateTipPollLeft <= 0) {
      clearInterval(lateTipPollTimer);
      lateTipPollTimer = null;
      return;
    }
    if (momentsTip.value) return;
    const tip = resolveTipText("");
    if (tip) applyTip(tip);
  }, 400);
}

let closing = false;
let purchasedThisVisit = false;

function goBack() {
  if (closing) return;
  closing = true;
  uni.navigateBack({
    fail: () => {
      uni.reLaunch({ url: "/pages/messages/index" });
    },
  });
}

function onOpenChange(v) {
  open.value = v;
  if (!v) {
    if (purchasedThisVisit) {
      goBack();
      return;
    }
    // 已切到限时弹窗：留在本页由 Host 展示，关限时窗后再 back
    if (limitedOffer.modalOpen) return;
    goBack();
  }
}

function onPurchased({ userData } = {}) {
  purchasedThisVisit = true;
  if (!userData) return;
  isVip.value = Boolean(userData.is_vip);
  points.value = Number(userData.credits) || 0;
  vipName.value = userData.vip_name || "";
  vipExpireDate.value = userData.vip_expire_at || "";
  vipType.value = userData.vip_type || "";
  try {
    const prev = loadCachedUser() || {};
    setItem("user_info", JSON.stringify({ ...prev, ...userData }));
  } catch {
    /* ignore */
  }
}

onLoad((query) => {
  enableTransparentOverlayWebview();
  const tab = String(query?.tab || "points");
  defaultTab.value = tab === "vip" ? "vip" : "points";
  insufficient.value = String(query?.insufficient || "") === "1";
  companionId.value = String(query?.companionId || "");

  applyTip(resolveTipText(resolveTipFromQuery(query)));

  try {
    if (typeof uni.$on === "function") {
      uni.$on("our-moments-tip", onLateTipEvent);
    }
  } catch {
    /* ignore */
  }

  nextTick(() => {
    enableTransparentOverlayWebview();
    open.value = true;
    if (!momentsTip.value) startLateTipPoll();
  });
});

onReady(() => {
  enableTransparentOverlayWebview();
});

onShow(() => {
  // 主题同步可能又刷成黑底，每次 show 强制透明
  enableTransparentOverlayWebview();
});

watch(
  () => [
    chatStore.paywallMomentsTip,
    chatStore.ourMomentsTip && chatStore.ourMomentsTip.text,
  ],
  () => {
    if (momentsTip.value) return;
    const tip = resolveTipText("");
    if (tip) applyTip(tip);
  }
);

// 限时弹窗从本页打开后关闭 → 回聊天
watch(
  () => limitedOffer.modalOpen,
  (isOpen, wasOpen) => {
    if (wasOpen && !isOpen && !open.value && !purchasedThisVisit) {
      goBack();
    }
  }
);

onUnmounted(() => {
  if (lateTipPollTimer) {
    clearInterval(lateTipPollTimer);
    lateTipPollTimer = null;
  }
  try {
    if (typeof uni.$off === "function") {
      uni.$off("our-moments-tip", onLateTipEvent);
    }
  } catch {
    /* ignore */
  }
});
</script>

<template>
  <view class="recharge-host">
    <AppRechargeModal
      :open="open"
      :default-tab="defaultTab"
      :insufficient="insufficient"
      :is-vip="isVip"
      :vip-name="vipName"
      :vip-expire-date="vipExpireDate"
      :vip-type="vipType"
      :points="points"
      :companion-id="companionId"
      :moments-tip="momentsTip"
      analytics-scene="free_message"
      @update:open="onOpenChange"
      @purchased="onPurchased"
    />
    <AppLimitedOfferHost />
  </view>
</template>

<style scoped>
.recharge-host {
  min-height: 100vh;
  width: 100%;
  background-color: transparent;
}
</style>
