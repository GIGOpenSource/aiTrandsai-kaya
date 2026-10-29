/**
 * @file useCreateCompanionEntry
 * @description 进入创建伴侣页前的会员拦截：非 VIP 先弹付费窗，开通后再进创建页。
 * VIP 判定优先走 /api/payment/vip-status；失败时回退本地 user_info.is_vip。
 */
import { ref, watch } from "vue";
import { api, unwrapApiResults } from "@/utils/api";
import { getItem, setItem } from "@/utils/storage";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";

const CREATE_URL = "/pages-sub/create/index";

function readLocalVip() {
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
    return {
      isVip: false,
      points: 0,
      vipName: "",
      vipExpire: "",
      vipType: "",
    };
  }
}

function writeLocalVip(patch) {
  try {
    const raw = getItem("user_info");
    const prev = raw ? JSON.parse(raw) : {};
    setItem(
      "user_info",
      JSON.stringify({
        ...prev,
        is_vip: patch.isVip,
        credits: patch.points,
        vip_name: patch.vipName,
        vip_expire_at: patch.vipExpire,
        vip_type: patch.vipType,
      })
    );
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{
 *   showCreateVipGate: import('vue').Ref<boolean>,
 *   createGateVip: import('vue').Ref<boolean>,
 *   createGatePoints: import('vue').Ref<number>,
 *   createGateVipName: import('vue').Ref<string>,
 *   createGateVipExpire: import('vue').Ref<string>,
 *   createGateVipType: import('vue').Ref<string>,
 *   enterCreateCompanion: (opts?: { page?: string, source?: string, url?: string }) => Promise<void>,
 *   onCreateVipPurchased: (meta?: { productType?: string, userData?: object }) => void,
 * }}
 */
export function useCreateCompanionEntry() {
  const local = readLocalVip();
  const showCreateVipGate = ref(false);
  const createGateVip = ref(local.isVip);
  const createGatePoints = ref(local.points);
  const createGateVipName = ref(local.vipName);
  const createGateVipExpire = ref(local.vipExpire);
  const createGateVipType = ref(local.vipType);
  const pendingCreateUrl = ref(CREATE_URL);
  /** 仅「创建入口被拦截」后付费成功才跳转创建页 */
  const awaitingCreateAfterVip = ref(false);
  let checking = false;

  function applyVipState({ isVip, points, vipName, vipExpire, vipType }) {
    createGateVip.value = Boolean(isVip);
    createGatePoints.value = Number(points) || 0;
    createGateVipName.value = vipName || "";
    createGateVipExpire.value = vipExpire || "";
    createGateVipType.value = vipType || "";
    writeLocalVip({
      isVip: createGateVip.value,
      points: createGatePoints.value,
      vipName: createGateVipName.value,
      vipExpire: createGateVipExpire.value,
      vipType: createGateVipType.value,
    });
  }

  async function refreshVipStatus() {
    try {
      const body = await api.get("/api/payment/vip-status");
      const st = unwrapApiResults(body) || {};
      applyVipState({
        isVip: Boolean(st.is_vip),
        points: Number(st.effective_balance ?? st.credits ?? st.balance ?? 0) || 0,
        vipName: st.vip_name || st.vip_type || "",
        vipExpire: st.vip_expire_at || "",
        vipType: st.vip_type || "",
      });
      return createGateVip.value;
    } catch {
      const fallback = readLocalVip();
      applyVipState(fallback);
      return fallback.isVip;
    }
  }

  /**
   * 非会员拦截进创建页；会员（或编辑已有伴侣）直接跳转。
   * @param {{ page?: string, source?: string, url?: string }} [opts]
   */
  async function enterCreateCompanion(opts = {}) {
    if (checking) return;
    const url = opts.url || CREATE_URL;
    const isEdit = /[?&]edit=1(?:&|$)/.test(url);

    if (opts.page) {
      trackProductEvent(PRODUCT_EVENTS.AGENT_CREATE_CLICK, {
        page: opts.page,
        source: opts.source || "entry",
      });
    }

    // 编辑自己的伴侣不拦会员
    if (isEdit) {
      uni.navigateTo({ url });
      return;
    }

    checking = true;
    try {
      const isVip = await refreshVipStatus();
      if (!isVip) {
        pendingCreateUrl.value = url;
        awaitingCreateAfterVip.value = true;
        showCreateVipGate.value = true;
        return;
      }
      uni.navigateTo({ url });
    } finally {
      checking = false;
    }
  }

  function onCreateVipPurchased(meta = {}) {
    if (!awaitingCreateAfterVip.value) return;

    const type = meta?.productType;
    const userData = meta?.userData;
    if (userData) {
      applyVipState({
        isVip: Boolean(userData.is_vip),
        points: Number(userData.credits ?? userData.effective_balance ?? 0) || 0,
        vipName: userData.vip_name || "",
        vipExpire: userData.vip_expire_at || "",
        vipType: userData.vip_type || "",
      });
    } else if (type === "vip") {
      createGateVip.value = true;
      writeLocalVip({
        isVip: true,
        points: createGatePoints.value,
        vipName: createGateVipName.value,
        vipExpire: createGateVipExpire.value,
        vipType: createGateVipType.value,
      });
    }

    if (!createGateVip.value) return;
    awaitingCreateAfterVip.value = false;
    showCreateVipGate.value = false;
    const url = pendingCreateUrl.value || CREATE_URL;
    uni.navigateTo({ url });
  }

  // 关窗且未开通：清掉 pending，避免下次从别处付费误跳
  watch(showCreateVipGate, (open, wasOpen) => {
    if (wasOpen && !open && awaitingCreateAfterVip.value && !createGateVip.value) {
      awaitingCreateAfterVip.value = false;
    }
  });

  return {
    showCreateVipGate,
    createGateVip,
    createGatePoints,
    createGateVipName,
    createGateVipExpire,
    createGateVipType,
    enterCreateCompanion,
    onCreateVipPurchased,
  };
}
