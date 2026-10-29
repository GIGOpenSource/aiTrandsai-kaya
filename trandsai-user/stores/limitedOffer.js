/**
 * @file limitedOffer.js
 * @description 限时优惠：仅 GET（platform+country）；新用户选完性别后首次 GET，
 * show=true 且有剩余时间 → 弹窗；关闭后出悬浮窗。未选性别前不请求（避免烧掉首次）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  clearActiveOfferCache,
  clearOfferExpiresAt,
  computeComparePriceFromDiscount,
  countdownDigits,
  fetchLimitedOffer,
  formatCountdownMmSs,
  isOfferShowable,
  isSubscribeLimitedProduct,
  peekProductPriceDisplay,
  POLL_INTERVAL_MS,
  readActiveOfferCache,
  readOfferExpiresAt,
  remainingSecFromExpires,
  resolveExpiresAtFromPayload,
  resolveLimitedOfferProductType,
  resolveLocalResumeExpires,
  resolveStorePriceDisplay,
  shouldOpenLimitedOfferForPaywall,
  isUsableOfferPrice,
  writeActiveOfferCache,
  writeOfferExpiresAt,
} from "@/utils/limitedOffer";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import { hasUserGender } from "@/composables/useAuth";
import { getCurrentRoute } from "@/utils/overlayWebview";

/** 最近一次 paywall 场景（埋点用；已无 event 接口） */
let lastEventScene = "chat_quota";
/**
 * 同会话自动弹窗去重：home = 首页选完性别一次；chat = 首次进聊天(first_chat)一次。
 */
const sessionAutoShown = new Set();

export const useLimitedOfferStore = defineStore("limitedOffer", () => {
  const loading = ref(false);
  const available = ref(false);
  const eligible = ref(false);
  /** 服务端 show：是否展示悬浮窗 / 可打开弹窗 */
  const show = ref(false);
  const product = ref(null);
  const durationSec = ref(0);
  const storePrice = ref("");
  const comparePrice = ref("");
  const expiresAt = ref(null);
  const remainingSec = ref(0);
  const modalOpen = ref(false);
  const entryVisible = ref(false);
  /**
   * 首页展示成功（或本地恢复仍有效）后才允许露悬浮入口。
   * 避免冷启动/Tab onShow 抢在首页内容之前出入口。
   */
  const entryAllowed = ref(false);
  const expired = ref(false);
  const paying = ref(false);
  /** 透明宿主页等场景：待打开弹窗 */
  const pendingAutoOpen = ref(false);
  /**
   * 透明宿主页（pages-sub/limited-offer）关弹窗默认 navigateBack。
   * 游客点购买要去登录时置 true，避免 back 与跳登录打架卡死。
   */
  const suppressHostBack = ref(false);
  let dismissTask = Promise.resolve({
    opened: false,
    reason: "idle",
  });
  let tickTimer = null;
  let pollTimer = null;
  let expireCloseTimer = null;
  let entryShowTracked = false;
  let lastProductId = null;
  let tabShowRetryTimer = null;
  let priceRefreshToken = 0;

  const countdownText = computed(() => formatCountdownMmSs(remainingSec.value));
  const digits = computed(() => countdownDigits(remainingSec.value));
  const title = computed(() => String(product.value?.title || "").trim());
  /** point：一次性到账；subscribe 不用这个当「每日赠送」 */
  const creditsAmount = computed(
    () => Number(product.value?.credits_amount) || 0
  );
  /** subscribe：会员期内每日赠送金币 */
  const dailyGiftCredits = computed(
    () => Number(product.value?.daily_gift_credits) || 0
  );
  const productType = computed(() =>
    resolveLimitedOfferProductType(product.value)
  );
  const isSubscribeOffer = computed(() =>
    isSubscribeLimitedProduct(product.value)
  );
  const discountPct = computed(() => {
    const n = Number(product.value?.discount_pct);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  });
  /** 展示条件：服务端 show + 有商品 + 剩余时间（价格缺失不挡弹窗） */
  const isActive = computed(
    () =>
      show.value &&
      Boolean(product.value) &&
      remainingSec.value > 0 &&
      !expired.value
  );

  function applyCompareFromDiscount(p, priceDisplay) {
    const next = computeComparePriceFromDiscount(
      priceDisplay || storePrice.value,
      p?.discount_pct ?? product.value?.discount_pct
    );
    if (next) comparePrice.value = next;
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function syncRemaining() {
    const left = remainingSecFromExpires(expiresAt.value);
    remainingSec.value = left;
    if (left <= 0 && expiresAt.value) {
      onExpired();
    }
  }

  function startTick() {
    stopTick();
    syncRemaining();
    if (remainingSec.value <= 0) return;
    tickTimer = setInterval(syncRemaining, 1000);
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void syncFromServer({ quiet: true });
    }, POLL_INTERVAL_MS);
  }

  function track(eventName, extra = {}) {
    const pid = product.value?.id;
    trackProductEvent(eventName, {
      ...(pid != null ? { product_id: String(pid) } : {}),
      ...extra,
    });
  }

  function hideEntry() {
    entryVisible.value = false;
  }

  function showEntry() {
    if (!entryAllowed.value || !isActive.value || modalOpen.value) {
      hideEntry();
      return;
    }
    entryVisible.value = true;
    if (!entryShowTracked) {
      entryShowTracked = true;
      track(PRODUCT_EVENTS.LIMITED_OFFER_ENTRY_SHOW);
    }
  }

  function allowEntry() {
    entryAllowed.value = true;
  }

  function queuePendingAutoOpen() {
    pendingAutoOpen.value = true;
  }

  function clearOfferState({ clearStorage = false } = {}) {
    stopTick();
    stopPoll();
    if (expireCloseTimer) {
      clearTimeout(expireCloseTimer);
      expireCloseTimer = null;
    }
    if (clearStorage && (product.value?.id || lastProductId)) {
      clearOfferExpiresAt(product.value?.id || lastProductId);
    }
    if (clearStorage) clearActiveOfferCache();
    available.value = false;
    eligible.value = false;
    show.value = false;
    product.value = null;
    durationSec.value = 0;
    storePrice.value = "";
    comparePrice.value = "";
    expiresAt.value = null;
    remainingSec.value = 0;
    expired.value = false;
    modalOpen.value = false;
    entryVisible.value = false;
    // entryAllowed 保持：本会话首页已成功展示过则后续优惠仍可出入口
    pendingAutoOpen.value = false;
    paying.value = false;
    entryShowTracked = false;
  }

  function persistActiveCache() {
    if (!product.value?.id || !expiresAt.value) return;
    writeActiveOfferCache({
      product: product.value,
      expiresAt: expiresAt.value,
      storePrice: storePrice.value,
      comparePrice: comparePrice.value,
      durationSec: durationSec.value,
    });
  }

  /** 后台刷新商店价；不阻塞悬浮窗首屏。同文案 / 无效价不写回，避免 iOS 轮询闪烁 */
  function refreshStorePriceInBackground(p) {
    const token = ++priceRefreshToken;
    void resolveStorePriceDisplay(p)
      .then((store) => {
        if (!isUsableOfferPrice(store) || token !== priceRefreshToken) return;
        if (String(product.value?.id) !== String(p?.id)) return;
        if (String(storePrice.value || "") === String(store)) return;
        storePrice.value = store;
        applyCompareFromDiscount(p, store);
        persistActiveCache();
      })
      .catch(() => {});
  }

  /**
   * 用已解析的到期时间激活展示（悬浮窗 / 倒计时）。
   * @returns {Promise<boolean>}
   */
  async function activateOffer({
    p,
    exp,
    duration = 0,
    compare = "",
    preferStorePrice = "",
  }) {
    if (!p || !exp || exp <= Date.now()) return false;
    // 同商品已有「有效」展示价则复用，避免轮询 price_display ↔ 商店价闪烁；
    // 0.00 等无效价不复用，继续拉商店价。
    const sameProduct =
      product.value && String(product.value.id) === String(p?.id);
    const kept =
      sameProduct && isUsableOfferPrice(storePrice.value)
        ? String(storePrice.value).trim()
        : "";
    const preferred = isUsableOfferPrice(preferStorePrice)
      ? String(preferStorePrice).trim()
      : "";
    const quick =
      kept ||
      preferred ||
      peekProductPriceDisplay(p) ||
      String(p?.price_display || "").trim();
    if (!quick) {
      // 仍尝试商店价；超时也不挡激活（H5 可稍后用 price_display）
      const store = await Promise.race([
        resolveStorePriceDisplay(p),
        new Promise((resolve) => setTimeout(() => resolve(""), 1200)),
      ]);
      storePrice.value = isUsableOfferPrice(store) ? store : "";
      if (!storePrice.value) {
        console.warn("[limitedOffer] activate without price yet", p?.id);
      }
    } else {
      storePrice.value = quick;
      if (!kept) {
        refreshStorePriceInBackground(p);
      }
    }

    lastProductId = p?.id ?? lastProductId;
    product.value = p;
    if (compare) comparePrice.value = compare;
    else applyCompareFromDiscount(p, storePrice.value);
    durationSec.value = Number(duration) || durationSec.value || 0;
    expired.value = false;
    show.value = true;
    expiresAt.value = exp;
    writeOfferExpiresAt(p.id, exp);
    syncRemaining();
    if (remainingSec.value <= 0) {
      onExpired();
      return false;
    }
    startTick();
    startPoll();
    persistActiveCache();
    if (!modalOpen.value) showEntry();
    return true;
  }

  /** 杀进程后：本地倒计时未结束则恢复；允许入口（否则只能等首页成功） */
  async function restoreFromLocalCache() {
    const cached = readActiveOfferCache();
    if (!cached) return false;
    console.log("[limitedOffer] restore from local cache", {
      productId: cached.product?.id,
      left: remainingSecFromExpires(cached.expiresAt),
    });
    entryAllowed.value = true;
    return activateOffer({
      p: cached.product,
      exp: cached.expiresAt,
      duration: cached.durationSec,
      compare: cached.comparePrice,
      preferStorePrice: cached.storePrice,
    });
  }

  function onExpired() {
    if (expired.value) return;
    expired.value = true;
    remainingSec.value = 0;
    show.value = false;
    stopTick();
    stopPoll();
    track(PRODUCT_EVENTS.LIMITED_OFFER_EXPIRE);
    hideEntry();
    if (product.value?.id) clearOfferExpiresAt(product.value.id);
    clearActiveOfferCache();
    if (modalOpen.value) {
      if (expireCloseTimer) clearTimeout(expireCloseTimer);
      expireCloseTimer = setTimeout(() => {
        modalOpen.value = false;
        clearOfferState();
      }, 1000);
    } else {
      clearOfferState();
    }
  }

  /**
   * 应用 GET / event 响应；需要展示时补齐商店价。
   * @returns {Promise<boolean>} 当前是否可展示（isActive）
   */
  async function applyServerPayload(raw, { quiet = false } = {}) {
    if (!raw || typeof raw !== "object") {
      if (!quiet) clearOfferState({ clearStorage: false });
      return false;
    }

    available.value = Boolean(raw.available);
    eligible.value = Boolean(raw.eligible);
    durationSec.value =
      Number(raw.duration_sec) ||
      Number(raw.product?.limited_duration_sec) ||
      0;

    if (!isOfferShowable(raw)) {
      // 已买 / 过期 → 清展示与本地缓存
      if (raw.reason === "already_paid" || raw.reason === "expired") {
        clearOfferState({ clearStorage: true });
        return false;
      }

      // 已在展示：继续（避免轮询偶发 not_started 冲掉）
      if (isActive.value) {
        persistActiveCache();
        startTick();
        startPoll();
        if (!modalOpen.value) showEntry();
        return true;
      }

      // 杀进程后再进：服务端 show=false，但本地 expires 仍有效 → 用响应里的 product 恢复
      const resumeExp = resolveLocalResumeExpires(raw);
      if (resumeExp && raw.product) {
        console.log("[limitedOffer] resume by local expires", {
          productId: raw.product?.id,
          reason: raw.reason,
          left: remainingSecFromExpires(resumeExp),
        });
        return activateOffer({
          p: raw.product,
          exp: resumeExp,
          duration:
            Number(raw.duration_sec) ||
            Number(raw.product?.limited_duration_sec) ||
            0,
        });
      }

      // 再退一步：完整本地快照
      const restored = await restoreFromLocalCache();
      if (restored) return true;

      if (show.value || product.value) {
        stopTick();
        stopPoll();
        show.value = false;
        remainingSec.value = 0;
        expiresAt.value = null;
        hideEntry();
        if (modalOpen.value) modalOpen.value = false;
        product.value = null;
        storePrice.value = "";
        comparePrice.value = "";
      }
      if (!quiet) {
        console.log("[limitedOffer] not showable", {
          show: raw.show,
          reason: raw.reason,
          remaining_sec: raw.remaining_sec,
        });
      }
      return false;
    }

    const p = raw.product;
    // 服务端 remaining / expires 优先；没有则用本地未过期 expires
    let exp = resolveExpiresAtFromPayload(raw);
    if (!exp || exp <= Date.now()) {
      const localExp = p?.id ? readOfferExpiresAt(p.id) : null;
      if (localExp && localExp > Date.now()) exp = localExp;
    }
    if (!exp || exp <= Date.now()) {
      const restored = await restoreFromLocalCache();
      if (restored) return true;
      onExpired();
      return false;
    }
    return activateOffer({
      p,
      exp,
      duration:
        Number(raw.duration_sec) ||
        Number(p?.limited_duration_sec) ||
        0,
    });
  }

  /**
   * 短轮询 / Tab 拉状态。
   * 未选性别时不请求：后端「新用户首次 GET」必须留给选完性别之后。
   */
  async function syncFromServer({ force = false, quiet = false } = {}) {
    if (!hasUserGender()) {
      if (!quiet) {
        console.log("[limitedOffer] skip GET until gender selected");
      }
      return false;
    }
    if (loading.value && !force) return isActive.value;
    loading.value = true;
    try {
      const raw = await fetchLimitedOffer();
      if (!quiet) {
        console.log("[limitedOffer] GET /api/benefits/limited-offer", raw);
      }
      if (!raw) {
        if (!isActive.value) {
          const restored = await restoreFromLocalCache();
          if (restored) return true;
        }
        return isActive.value;
      }
      return await applyServerPayload(raw, { quiet });
    } finally {
      loading.value = false;
    }
  }

  /** @deprecated 兼容旧名 → syncFromServer */
  async function loadOffer(opts = {}) {
    return syncFromServer({ force: opts.force === true, quiet: false });
  }

  /**
   * 触发付费墙：只 GET 状态（已无 event）；按商品类型 + 场景决定是否打开限时弹窗。
   * @param {string} scene
   * @param {{ defaultTab?: string, forceNormal?: boolean }} [opts]
   * @returns {Promise<boolean>} 是否已打开限时弹窗
   */
  async function onPaywallShown(scene = "", opts = {}) {
    lastEventScene = String(scene || "").trim() || lastEventScene;
    const forceNormal = opts.forceNormal === true;
    const defaultTab = String(opts.defaultTab || "").trim();
    if (forceNormal) return false;
    try {
      const ok = await syncFromServer({ force: true });
      if (!ok || !isActive.value) return false;
      entryAllowed.value = true;
      const preferLimited = shouldOpenLimitedOfferForPaywall({
        forceNormal: false,
        scene,
        defaultTab,
        product: product.value,
      });
      if (!preferLimited) {
        if (!modalOpen.value) showEntry();
        console.log("[limitedOffer] paywall keep normal recharge", {
          scene,
          defaultTab,
          productType: productType.value,
        });
        return false;
      }
      return openModal({ source: "paywall" });
    } catch (err) {
      console.warn("[limitedOffer] onPaywallShown", err);
      return false;
    }
  }

  /**
   * 关闭付费墙未买：已无 event，GET 校准后只维护悬浮入口。
   * @param {string} scene
   */
  function onPaywallDismissed(scene = "") {
    const key = String(scene || "default").trim() || "default";
    lastEventScene = key;
    const task = (async () => {
      try {
        const ok = await syncFromServer({ force: true, quiet: true });
        if (!ok || !isActive.value) {
          return { opened: false, reason: "not_showable" };
        }
        if (!modalOpen.value) showEntry();
        return { opened: false, reason: "entry_only" };
      } catch (err) {
        console.warn("[limitedOffer] onPaywallDismissed", err);
        return { opened: false, reason: "error" };
      }
    })();
    dismissTask = task;
    return task;
  }

  /** 商店支付失败/取消：已无 event，保持倒计时与入口 */
  function onPayFailed(scene = "") {
    lastEventScene = String(scene || "").trim() || lastEventScene;
    if (isActive.value && !modalOpen.value) showEntry();
    return Promise.resolve({ opened: false, reason: "pay_failed_local" });
  }

  function awaitDismissTask() {
    return dismissTask;
  }

  function openModal({ source = "auto" } = {}) {
    if (!isActive.value) return false;
    // 倒计时由 GET remaining_sec / expires_at 给出，此处只展示
    syncRemaining();
    if (remainingSec.value <= 0) {
      onExpired();
      return false;
    }
    startTick();
    startPoll();
    modalOpen.value = true;
    pendingAutoOpen.value = false;
    hideEntry();
    track(PRODUCT_EVENTS.LIMITED_OFFER_POPUP_SHOW, { source });
    return true;
  }

  function closeModal({ fromUser = false, suppressHostBack: suppress = false } = {}) {
    if (fromUser) {
      track(PRODUCT_EVENTS.LIMITED_OFFER_CLOSE_CLICK);
    }
    if (suppress) suppressHostBack.value = true;
    modalOpen.value = false;
    if (suppress) {
      hideEntry();
      return;
    }
    if (isActive.value) showEntry();
    else hideEntry();
  }

  /** 宿主页 consume：true 则本次不要 navigateBack */
  function consumeSuppressHostBack() {
    if (!suppressHostBack.value) return false;
    suppressHostBack.value = false;
    return true;
  }

  /** 游客不可支付：关弹窗（不 back）并 reLaunch 登录（含 Google） */
  function redirectGuestToLogin() {
    suppressHostBack.value = true;
    modalOpen.value = false;
    hideEntry();
    uni.reLaunch({
      url: "/pages/login/index",
      fail: () => {
        uni.redirectTo({
          url: "/pages/login/index",
          fail: () => {
            uni.navigateTo({ url: "/pages/login/index" });
          },
        });
      },
    });
  }

  function openFromEntry() {
    track(PRODUCT_EVENTS.LIMITED_OFFER_ENTRY_CLICK);
    openModal({ source: "entry" });
  }

  /** 页面 Host 消化 pending；成功返回 true */
  function flushPendingAutoOpen() {
    if (!pendingAutoOpen.value) return false;
    return openModal({ source: "auto" });
  }

  /**
   * 验单真正入账后：先拉 limited-offer；仅当 show!==true 才撤弹窗/悬浮窗。
   * 不要在商店 SDK purchased 时调用。
   * @returns {Promise<boolean>} 是否已撤窗（show!==true）
   */
  async function markPurchasedSuccess() {
    track(PRODUCT_EVENTS.LIMITED_OFFER_PURCHASE_SUCCESS);
    await syncFromServer({ force: true, quiet: false });
    // 撤窗条件只有：服务端 show !== true
    if (show.value !== true) {
      clearOfferState({ clearStorage: true });
      return true;
    }
    // 仍 show：保持倒计时与入口（罕见竞态）
    if (!modalOpen.value) showEntry();
    return false;
  }

  function markPurchaseFail(reason = "fail") {
    track(PRODUCT_EVENTS.LIMITED_OFFER_PURCHASE_FAIL, {
      reason,
      scene: lastEventScene,
    });
    // 已无 event：失败不撤窗，倒计时与悬浮窗保持
    if (isActive.value && !modalOpen.value) showEntry();
  }

  function markBuyClick() {
    track(PRODUCT_EVENTS.LIMITED_OFFER_BUY_CLICK);
  }

  /**
   * 同会话每个 key 最多自动尝试 1 次（有无货都占坑，避免多处连弹）。
   * 未打开时由调用方决定是否 showEntry。
   */
  function tryAutoOpenOnce(key, source) {
    const k = String(key || "").trim();
    if (!k || sessionAutoShown.has(k)) return false;
    sessionAutoShown.add(k);
    if (!isActive.value || modalOpen.value) return false;
    return openModal({ source: source || "auto" });
  }

  /** 当前页是否已挂 AppLimitedOfferHost（可直接画弹窗） */
  function routeHasLimitedOfferHost(route = "") {
    const r = String(route || "");
    return (
      r.includes("pages/home/") ||
      r.includes("pages/messages/") ||
      r.includes("pages/chat/") ||
      r.includes("pages/profile/") ||
      r.includes("pages-sub/create/") ||
      r.includes("pages-sub/companion/") ||
      r.includes("pages-sub/recharge/") ||
      r.includes("pages-sub/limited-offer/")
    );
  }

  /**
   * App nvue 仍在聊天页时才叠透明限时页。
   * 若用户已退出聊天：不要再 navigateTo，否则透明页叠在首页上易卡死；改由当前页 Host 画弹窗。
   */
  function presentLimitedOfferHostPage() {
    // #ifdef APP-PLUS
    try {
      const route = getCurrentRoute();
      if (route.includes("pages-sub/limited-offer/")) return;
      const stillOnChat = route.includes("pages/chat/");
      if (!stillOnChat && routeHasLimitedOfferHost(route)) {
        console.log(
          "[limitedOffer] left chat → use current Host, skip overlay page",
          route
        );
        return;
      }
      uni.navigateTo({
        url: "/pages-sub/limited-offer/index",
        fail: (e) =>
          console.warn("[limitedOffer] open host page fail", e),
      });
    } catch (err) {
      console.warn("[limitedOffer] open host page", err);
    }
    // #endif
  }

  /**
   * 拉状态后：优先按 key 自动弹一次；否则露悬浮入口。
   * @returns {Promise<boolean>} 是否打开了弹窗
   */
  function syncThenMaybeAutoOpen(key, source) {
    entryAllowed.value = true;
    if (tabShowRetryTimer) {
      clearTimeout(tabShowRetryTimer);
      tabShowRetryTimer = null;
    }
    return new Promise((resolve) => {
      const run = (attempt) => {
        console.log("[limitedOffer] syncThenMaybeAutoOpen", {
          key,
          source,
          attempt,
        });
        void syncFromServer({ force: true }).then((ok) => {
          if (ok) {
            startPoll();
            if (modalOpen.value) {
              resolve(true);
              return;
            }
            if (tryAutoOpenOnce(key, source)) {
              console.log("[limitedOffer] auto modal opened", { key, source });
              resolve(true);
              return;
            }
            showEntry();
            resolve(false);
            return;
          }
          console.log("[limitedOffer] not showable yet", {
            key,
            attempt,
            show: show.value,
            reasonHint: "需 GET show===true 且 remaining_sec>0",
          });
          if (attempt >= 2) {
            if (!modalOpen.value) showEntry();
            resolve(false);
            return;
          }
          tabShowRetryTimer = setTimeout(() => {
            tabShowRetryTimer = null;
            run(attempt + 1);
          }, attempt === 0 ? 1500 : 3500);
        });
      };
      run(0);
    });
  }

  /**
   * 首页 / 消息 / App 回前台：已有性别则 GET 校准。
   * 有优惠只出悬浮框，不自动弹大窗。
   */
  function onTabPageShow() {
    if (tabShowRetryTimer) {
      clearTimeout(tabShowRetryTimer);
      tabShowRetryTimer = null;
    }
    const run = (attempt) => {
      void syncFromServer({ force: true }).then((ok) => {
        if (ok) {
          entryAllowed.value = true;
          startPoll();
          if (!modalOpen.value) showEntry();
          return;
        }
        if (attempt >= 2) return;
        tabShowRetryTimer = setTimeout(() => {
          tabShowRetryTimer = null;
          run(attempt + 1);
        }, attempt === 0 ? 1500 : 3500);
      });
    };
    run(0);
  }

  /**
   * 已有性别用户进首页：GET 判断是否有优惠；只出悬浮框，不自动弹大窗。
   */
  function onHomeDisplayReady() {
    entryAllowed.value = true;
    void syncFromServer({ force: true }).then((ok) => {
      if (ok) {
        startPoll();
        if (!modalOpen.value) showEntry();
      }
    });
  }

  /**
   * 新用户选完性别后调用：GET limited-offer（platform+country）。
   * show===true 且剩余时间>0 → 弹付费限时窗；关闭后出悬浮窗。
   * @returns {Promise<boolean>} 是否打开了弹窗
   */
  async function onAfterGenderSelect() {
    entryAllowed.value = true;
    if (sessionAutoShown.has("home")) {
      const ok = await syncFromServer({ force: true });
      if (ok) {
        startPoll();
        if (!modalOpen.value) showEntry();
      }
      return false;
    }
    console.log("[limitedOffer] after gender → GET (first chance for new user)");
    const ok = await syncFromServer({ force: true });
    sessionAutoShown.add("home");
    if (!ok || !isActive.value) {
      console.log("[limitedOffer] after gender: no modal", {
        show: show.value,
        remainingSec: remainingSec.value,
        hasProduct: Boolean(product.value),
      });
      return false;
    }
    startPoll();
    const opened = openModal({ source: "home_gender" });
    if (!opened) showEntry();
    return opened;
  }

  /**
   * WS hello.first_chat===true：本会话自动弹 1 次（关闭后悬浮入口）。
   * 仍在聊天页（App nvue）才叠 limited-offer；已退出则只靠当前页 Host，避免透明页卡死。
   * @returns {Promise<boolean>}
   */
  async function onFirstChatEnter() {
    if (!hasUserGender()) return false;
    const opened = await syncThenMaybeAutoOpen("chat", "chat_first");
    if (!opened) return false;
    presentLimitedOfferHostPage();
    return true;
  }

  return {
    loading,
    available,
    eligible,
    show,
    product,
    durationSec,
    storePrice,
    comparePrice,
    expiresAt,
    remainingSec,
    countdownText,
    digits,
    title,
    creditsAmount,
    dailyGiftCredits,
    productType,
    isSubscribeOffer,
    discountPct,
    modalOpen,
    entryVisible,
    entryAllowed,
    expired,
    paying,
    pendingAutoOpen,
    suppressHostBack,
    isActive,
    loadOffer,
    syncFromServer,
    openModal,
    closeModal,
    consumeSuppressHostBack,
    redirectGuestToLogin,
    openFromEntry,
    onPaywallShown,
    onPaywallDismissed,
    onPayFailed,
    awaitDismissTask,
    flushPendingAutoOpen,
    queuePendingAutoOpen,
    showEntry,
    hideEntry,
    allowEntry,
    markPurchasedSuccess,
    markPurchaseFail,
    markBuyClick,
    clearOfferState,
    syncRemaining,
    onTabPageShow,
    onHomeDisplayReady,
    onAfterGenderSelect,
    onFirstChatEnter,
    tryAutoOpenOnce,
    startPoll,
    stopPoll,
  };
});
