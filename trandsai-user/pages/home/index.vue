<script setup>
/**
 * @file pages/home — 首页 Tab（朋友圈）
 * @description
 * - 顶部智能体头像条（横向滚动，含创建入口）
 * - 朋友圈动态：分页、下拉刷新、触底加载
 * - 点赞/评论（乐观更新）；筛选语言/性别/性取向
 * - 图片预览、回顶、未读铃铛；先缓存后刷新
 * @depends homeCache、companionsCache、apiFetch、deviceHeaders
 */
import {
  ref,
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  watch
} from "vue";
import {
  onLoad,
  onShow,
  onHide,
  onUnload,
  onBackPress,
} from "@dcloudio/uni-app";
import {
  useI18n
} from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppCompanionCard from "@/components/AppCompanionCard.vue";
import AppMomentCard from "@/components/AppMomentCard.vue";
import AppPullRefresh from "@/components/AppPullRefresh.vue";
import AppReportCharacterPopup from "@/components/AppReportCharacterPopup.vue";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import { useLimitedOfferStore } from "@/stores/limitedOffer";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import AppGenderSelectModal from "@/components/AppGenderSelectModal.vue";
import {
  requireAuth,
  getCurrentUserId,
  hasUserGender,
} from "@/composables/useAuth";
import { useHomeCompanions } from "@/composables/useHomeCompanions";
import { useListVirtualWindow } from "@/composables/useListVirtualWindow";
import { useCreateCompanionEntry } from "@/composables/useCreateCompanionEntry";
import apiFetch, { unwrapApiResults } from "@/utils/api";
import {
  readHomeMomentsCache,
  writeHomeMomentsCache,
  saveHomeMomentsRuntime,
  readHomeMomentsRuntime,
} from "@/utils/homeCache";
import {
  bindAnalyticsTap,
  bindAnalyticsTapArg
} from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { startForegroundDree0Timer } from "@/utils/productAnalyticsHelpers";
import {
  useTabScrollStore
} from "@/stores/tabScroll";
import {
  uiLangCode,
  formatCompanionName
} from "@/utils/formatCompanion";
import {
  deviceHeaders
} from "@/utils/device";
import {
  parseMomentCommentLimit,
  prepareCommentLimitChat,
} from "@/utils/momentCommentLimit";
import { fillI18n } from "@/utils/createCompanionForm";
import { previewMedia } from "@/utils/media";
import { isScrollNearBottom, isScrollNearRight } from "@/utils/scrollNearBottom";
import {
  getItem,
  setItem,
} from "@/utils/storage";
import {
  showToast
} from "@/stores/toast";
import {
  useChatStore
} from "@/stores/chat";
import {
  computeHomeHasUnread,
  findAiRepliesToUser,
  recordLocalReplyNotif,
} from "@/utils/notifications";
import { readSafeArea } from "@/composables/useStatusBar";

const TAB_PATH = "/pages/home/index";
const tabScroll = useTabScrollStore();
/** home-page 不再使用负 marginTop，渐变光晕改为 fixed 定位覆盖状态栏 */
const homePageStyle = computed(() => ({}));
const tabBarSpacerPx = computed(() => {
  const b = Number(readSafeArea().safeAreaBottom) || 0;
  return b + 56;
});

const PAGE_SIZE = 5;

const commentLimitOpen = ref(false);
const commentLimitCount = ref(1);
const commentLimitCompanionId = ref("");
const commentLimitMomentId = ref("");
const commentLimitDraft = ref("");

function openCommentLimitDialog(data, err, fallbackCompanionId, extra = {}) {
  const meta = parseMomentCommentLimit(data, err);
  if (!meta) return false;
  commentLimitCount.value = meta.count;
  commentLimitCompanionId.value =
    meta.companionId || String(fallbackCompanionId || "");
  commentLimitMomentId.value = String(meta.momentId || extra.momentId || "");
  commentLimitDraft.value = String(extra.draft || "");
  commentLimitOpen.value = true;
  return true;
}

function goCommentLimitChat() {
  void prepareCommentLimitChat({
    companionId: commentLimitCompanionId.value,
    momentId: commentLimitMomentId.value,
    draft: commentLimitDraft.value,
  });
}



const {
  t,
  locale
} = useI18n();
/** App 端 vue-i18n 不替换 {count}，再用 fillI18n 写入次数 */
const commentLimitDesc = computed(() =>
  fillI18n(t("home.commentLimitDesc", { count: commentLimitCount.value }), {
    count: commentLimitCount.value,
  })
);
const chat = useChatStore();
requireAuth();
/**
 * 缺性别时强制弹窗（不可取消）。
 * 与首页加载并行：不阻塞骨架→内容，选完后再补刷一次空列表。
 */
const showGenderSelect = ref(false);
let genderModalPending = !hasUserGender();

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
  // 补性别前若接口失败/空列表，选完后立刻再拉首页
  if (!moments.value.length || momentsLoadError.value) {
    void performFullRefresh(false);
  }
  // 新用户选完性别 → 首次 GET limited-offer；show+剩余时间才弹窗，关闭后悬浮窗
  nextTick(() => {
    setTimeout(() => {
      console.log("[home] gender done → limited-offer first GET");
      try {
        void useLimitedOfferStore().onAfterGenderSelect();
      } catch (err) {
        console.warn("[home] limited offer after gender failed", err);
      }
    }, 280);
  });
}

/** 进入朋友圈详情后，回首页时只同步该条评论/点赞 */
let pendingMomentSyncId = "";
let initialized = false;
let savedScrollToRestore = 0;

// ——— 缓存优先：先用缓存渲染，网络数据到达后替换 ———
const cachedMoments = readHomeMomentsCache();
const moments = ref(cachedMoments ?? []);

const {
  companions,
  homeCompanions,
  homeCompanionFilter,
  homeCompanionsLoading,
  homeCompanionsLoadingMore,
  homeCompanionsHasMore,
  displayHomeCompanions,
  loadCompanionStrip,
  loadMoreCompanionStrip,
  loadHomeCompanions,
  hasStripCache,
} = useHomeCompanions({ locale, t });

const reportOpen = ref(false);
const reportCharacterId = ref("");

const hasHomeCache = Boolean(cachedMoments?.length || hasStripCache);

const uiLang = computed(() => uiLangCode(locale.value));

const loading = ref(!hasHomeCache);
const refreshing = ref(false);
const loadingMore = ref(false);
const hasMore = ref(true);
/** 首屏朋友圈加载失败（与空列表区分，供重试） */
const momentsLoadError = ref(false);

const hasUnread = ref(false);
const showBackToTop = ref(false);
const activeTab = ref("moments");

/** 切换顶部 Tab */
function switchHomeTab(tab) {
  if (tab !== "moments" && tab !== "companions") return;
  if (tab === "companions" && activeTab.value !== "companions") {
    trackProductEvent(PRODUCT_EVENTS.HOME_ROBOT_TAB_CLICK, { page: "home", tab: "companions" });
  }
  activeTab.value = tab;
}

let homePageShownTracked = false;

function trackHomePageShowIfReady() {
  if (homePageShownTracked || !initialized) return;
  if (loading.value && !moments.value.length && !companions.value.length) return;
  if (momentsLoadError.value && !moments.value.length) return;
  homePageShownTracked = true;
  trackProductEvent(PRODUCT_EVENTS.HOME_PAGE_SHOW, { page: "home" });
  // 已有性别：GET 限时接口，有优惠只出悬浮框（新用户弹窗仍走 onGenderSelectDone）
  if (hasUserGender()) {
    try {
      useLimitedOfferStore().onHomeDisplayReady();
    } catch {
      /* ignore */
    }
  }
}

// 图片加载失败记录（加载失败时点击触发后端重新生成）
const imageFailedMap = ref({});
const regeneratingImageId = ref("");
const sendingMomentId = ref("");
/** Companions Tab 上正在请求 Say Hi 的 companion id */
const sendingCompanionId = ref("");

// 分页：/api/bmoments 用 page / page_size
let momentsPage = 0;
let momentsReqSeq = 0;

// scroll-view 控制
const scrollTopControl = ref(0);
let lastScrollTop = 0;
const listScrollTop = ref(0);
const listViewHeight = ref(600);
/** 滚动后 header 显示实色背景遮挡内容 */
const headerScrolled = ref(false);
// 滚动遮罩进度：用于让 header-backdrop（渐变遮罩 + 毛玻璃）随滚动逐渐加深
const headerBackOpacity = ref(0);

const {
  slice: virtualMoments,
  topPad: momentsTopPad,
  bottomPad: momentsBottomPad,
} = useListVirtualWindow({
  rows: moments,
  scrollTop: listScrollTop,
  viewHeight: listViewHeight,
  // 朋友圈卡片含图+评论，远高于默认 280；估矮了会在虚拟列表开启时把滚动吸底，连发分页
  rowHeight: 640,
  threshold: 80,
});

// ───────────────── 筛选条件 ─────────────────
const momentFilterLang = ref("");
const momentFilterGender = ref("");
const momentFilterOrientation = ref("");
const showMomentFilter = ref(false);

// 草稿筛选值：弹窗内修改，点"应用"才生效
const draftFilterLang = ref("");
const draftFilterGender = ref("");
const draftFilterOrientation = ref("");

const filterActive = computed(() =>
  Boolean(momentFilterLang.value || momentFilterGender.value || momentFilterOrientation.value)
);

const langOptions = computed(() => [{
  value: "",
  label: t("home.filterAll")
},
{
  value: "zh",
  label: "中文"
},
{
  value: "en",
  label: "English"
},
{
  value: "ja",
  label: "日本語"
},
{
  value: "ko",
  label: "한국어"
},
{
  value: "pt",
  label: "Português"
},
{
  value: "es",
  label: "Español"
},
{
  value: "id",
  label: "Bahasa Indonesia"
},
{
  value: "ar",
  label: "العربية"
},
{
  value: "fa",
  label: "فارسی"
},
{
  value: "ru",
  label: "Русский"
},
{
  value: "bg",
  label: "Български"
},
{
  value: "tr",
  label: "Türkçe"
},
]);

const genderOptions = computed(() => [{
  value: "",
  label: t("home.filterAll")
},
{
  value: "男",
  label: t("register.male")
},
{
  value: "女",
  label: t("register.female")
},
]);

const orientationOptions = computed(() => [{
  value: "",
  label: t("home.filterAll")
},
{
  value: "heterosexual",
  label: t("register.heterosexual")
},
{
  value: "homosexual",
  label: t("register.homosexual")
},
{
  value: "bisexual",
  label: t("register.bisexual")
},
{
  value: "pansexual",
  label: t("register.pansexual")
},
{
  value: "asexual",
  label: t("register.asexual")
},
{
  value: "secret",
  label: t("register.secret")
},
]);

function optionLabel(
  options,
  value) {
  return options.find((o) => o.value === value)?.label || options[0].label;
}

// ───────────────── 评论输入（每条动态独立草稿） ─────────────────
const commentDrafts = ref({});
const commentBusy = ref({});
/** uni-input 清空 :value 后 DOM 常不刷新，靠 remount 强制同步 */
const commentInputKeys = ref({});
/** 点击 💬 时聚焦对应输入框（对齐朋友圈详情 / 微信朋友圈） */
const focusedCommentId = ref("");
/** 仅点评论图标时一次性拉起键盘；不要绑成「当前聚焦」，否则安卓失焦后又会自己弹回来 */
const commentFocusRequestId = ref("");
function pickMomentsList(body) {
  const data = unwrapApiResults(body) ?? body;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.moments)) return data.moments;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.moments)) return body.moments;
  return [];
}

function pickMomentsPagination(body) {
  if (body?.pagination && typeof body.pagination === "object") {
    return body.pagination;
  }
  const data = unwrapApiResults(body);
  if (data && typeof data === "object" && !Array.isArray(data) && data.pagination) {
    return data.pagination;
  }
  return {};
}

// ====================================================================
// 加载朋友圈动态（分页）
//   isRefresh: true=刷新（page=1, 替换列表）, false=加载更多（追加去重）
//   filters:   可选筛选参数，不传则用当前生效筛选值
// ====================================================================
async function loadMomentsPage(
  isRefresh,
  filters
) {
  const seq = ++momentsReqSeq;
  const page = isRefresh ? 1 : momentsPage + 1;
  const fl = filters?.filter_lang ?? momentFilterLang.value;
  const fg = filters?.gender ?? momentFilterGender.value;
  const fo = filters?.orientation ?? momentFilterOrientation.value;

  // App 端部分 WebView 没有 URLSearchParams，手动拼查询串
  const queryParts = [
    `page=${String(page)}`,
    `page_size=${String(PAGE_SIZE)}`,
    // `lang=${encodeURIComponent(locale.value || "zh")}`,
  ];
  if (fl) queryParts.push(`filter_lang=${encodeURIComponent(fl)}`);
  if (fg) queryParts.push(`gender=${encodeURIComponent(fg)}`);
  if (fo) queryParts.push(`orientation=${encodeURIComponent(fo)}`);

  const momentsRes = await apiFetch(
    `/api/bmoments?${queryParts.join("&")}`, {
    header: deviceHeaders()
  }
  );
  if (seq !== momentsReqSeq) return;

  updateSayHiDailyRemaining(momentsRes);
  const newMoments = pickMomentsList(momentsRes);
  const pagination = pickMomentsPagination(momentsRes);
  const currentPage = Number(pagination.page) || page;
  const reportedTotalPages = Number(pagination.total_pages);

  momentsPage = currentPage;

  let addedCount = newMoments.length;
  if (isRefresh) {
    moments.value = newMoments;
    writeHomeMomentsCache(newMoments);
  } else {
    const existingIds = new Set(moments.value.map((m) => m.id));
    const uniqueNew = newMoments.filter((m) => {
      const id = m?.id;
      if (id == null || existingIds.has(id)) return false;
      existingIds.add(id);
      return true;
    });
    addedCount = uniqueNew.length;
    const merged = [...moments.value, ...uniqueNew];
    moments.value = merged;
    writeHomeMomentsCache(merged);
  }

  const gotFullPage = newMoments.length >= PAGE_SIZE;
  const hasNextPage =
    Number.isFinite(reportedTotalPages) && reportedTotalPages > 0
      ? currentPage < reportedTotalPages
      : gotFullPage;
  hasMore.value = Boolean(addedCount) && gotFullPage && hasNextPage;

  // 检测未读：新动态 / AI 回复评论 / 聊天未读
  if (isRefresh) {
    hasUnread.value = computeHomeHasUnread(newMoments);
  }
  persistMomentsRuntime();
}

// ====================================================================
// 全量刷新：智能体条 + 朋友圈首页
//   isPull=true  → 下拉刷新（refreshing 状态）
//   isPull=false → 首次加载（无缓存时 loading 状态 → 骨架屏）
// ====================================================================
async function performFullRefresh(isPull) {
  const hasCachedUi = companions.value.length > 0 || moments.value.length > 0;
  if (isPull) refreshing.value = true;
  else if (!hasCachedUi) loading.value = true;
  momentsLoadError.value = false;
  let ok = false;
  try {
    await Promise.all([loadCompanionStrip(), loadMomentsPage(true)]);
    ok = true;
  } catch (e) {
    console.error("加载失败:", e);
    if (!moments.value.length) momentsLoadError.value = true;
  } finally {
    if (isPull) refreshing.value = false;
    else loading.value = false;
    if (ok) {
      trackHomePageShowIfReady();
      if (isPull && activeTab.value === "moments") {
        trackProductEvent(PRODUCT_EVENTS.PULL_REFRESH_REPORT, { page: "home", tab: "moments" });
      }
    }
  }
}

// ====================================================================
// 滚动到底部 → 加载下一页
// ====================================================================
async function loadMore() {
  if (loadingMore.value || !hasMore.value || loading.value || refreshing.value) {
    return;
  }
  loadingMore.value = true;
  let ok = false;
  try {
    await loadMomentsPage(false);
    ok = true;
  } catch (e) {
    console.error("加载更多失败:", e);
  } finally {
    loadingMore.value = false;
    if (ok) {
      trackProductEvent(PRODUCT_EVENTS.PULL_UP_LOAD_REPORT, { page: "home", tab: "moments" });
    }
  }
}

function onRefresh() {
  if (refreshing.value) return;
  // iOS 原生 refresher 要求立刻把 triggered 置 true，否则会弹回
  refreshing.value = true;
  void performFullRefresh(true);
}

function onScroll(e) {
  const st = Number(e.detail?.scrollTop) || 0;
  // iOS 弹键盘时常误报 scrollTop=0；聚焦后短时间忽略假 0
  if (
    isIOSHome &&
    focusedCommentId.value &&
    st < 2 &&
    commentFocusScrollTop > 40 &&
    Date.now() - commentFocusAt < 1200
  ) {
    return;
  }
  lastScrollTop = st;
  listScrollTop.value = st;
  showBackToTop.value = st > 200;
  headerScrolled.value = st > 10;
  // 滚动加深顶栏底色；渐变本身是透明→不透明（见 .header-backdrop）
  const p = Math.min(1, Math.max(0, st / 120));
  headerBackOpacity.value = p;
  tabScroll.setScroll(TAB_PATH, st);
  // H5 / App scrolltolower 可能只触发一次，贴底继续滑靠距离补加载
  if (activeTab.value === "companions") {
    if (isScrollNearBottom(e.detail, listViewHeight.value)) {
      loadMoreHomeCompanions();
    }
  } else if (activeTab.value === "moments") {
    if (isScrollNearBottom(e.detail, listViewHeight.value)) {
      void loadMore();
    }
  }
}

watch(
  () => tabScroll.scrollToTopTick[TAB_PATH],
  () => {
    scrollHomeToTop();
  }
);

// 切换到 Companions Tab 时加载完整智能体列表
watch(activeTab, (tab) => {
  if (tab === "companions") {
    void loadHomeCompanions();
  }
});

// 切换 全部/推荐 标签时重新请求对应接口（清空列表以展示加载骨架）
watch(homeCompanionFilter, () => {
  if (activeTab.value === "companions") {
    homeCompanions.value = [];
    void loadHomeCompanions({ reset: true });
  }
});

async function onCompanionsRefresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await loadHomeCompanions({ reset: true });
    trackProductEvent(PRODUCT_EVENTS.ROBOT_LIST_PULL_REFRESH, {
      page: "home",
      tab: homeCompanionFilter.value,
    });
  } finally {
    refreshing.value = false;
  }
}

function loadMoreHomeCompanions() {
  void (async () => {
    if (homeCompanionsLoadingMore.value || !homeCompanionsHasMore.value) return;
    await loadHomeCompanions({ reset: false });
    if (activeTab.value === "companions") {
      trackProductEvent(PRODUCT_EVENTS.ROBOT_LIST_PULL_UP, {
        page: "home",
        tab: homeCompanionFilter.value,
      });
    }
  })();
}

function onCompanionStripScroll(e) {
  if (isScrollNearRight(e.detail)) {
    loadMoreCompanionStrip();
  }
}

function scrollHomeToTop() {
  // :scroll-top 只在值变化时生效，先同步到当前位置再归零
  scrollTopControl.value = lastScrollTop;
  void nextTick(() => {
    scrollTopControl.value = 0;
    listScrollTop.value = 0;
  });
}

function persistMomentsRuntime() {
  saveHomeMomentsRuntime({
    list: moments.value || [],
    page: momentsPage,
    hasMore: hasMore.value,
    filterLang: momentFilterLang.value,
    filterGender: momentFilterGender.value,
    filterOrientation: momentFilterOrientation.value,
    activeTab: activeTab.value,
    scrollTop: lastScrollTop || tabScroll.scrollTops[TAB_PATH] || 0,
  });
}

function restoreMomentsRuntime(session) {
  if (!session?.list?.length) return false;
  moments.value = session.list;
  momentsPage = Number(session.page) || 1;
  hasMore.value = session.hasMore !== false;
  momentFilterLang.value = session.filterLang || "";
  momentFilterGender.value = session.filterGender || "";
  momentFilterOrientation.value = session.filterOrientation || "";
  if (session.activeTab === "companions" || session.activeTab === "moments") {
    activeTab.value = session.activeTab;
  }
  savedScrollToRestore = Number(session.scrollTop) || 0;
  loading.value = false;
  momentsLoadError.value = false;
  return true;
}

function applySavedScroll(top) {
  const y = Math.max(0, Number(top) || 0);
  lastScrollTop = y;
  listScrollTop.value = y;
  tabScroll.setScroll(TAB_PATH, y);
  scrollTopControl.value = y > 0 ? y - 1 : 1;
  void nextTick(() => {
    scrollTopControl.value = y;
  });
}

function scheduleScrollRestore(y) {
  const top = Math.max(0, Number(y) || 0);
  if (top <= 0) return;
  applySavedScroll(top);
  void nextTick(() => applySavedScroll(top));
  setTimeout(() => applySavedScroll(top), 80);
  setTimeout(() => applySavedScroll(top), 280);
}

async function syncMomentAfterDetail(momentId) {
  if (!momentId) return;
  const raw = await apiFetch(`/api/moments/${momentId}`, {
    header: deviceHeaders(),
  });
  const detail = unwrapApiResults(raw);
  if (!detail || typeof detail !== "object") return;
  const exists = moments.value.some((m) => sameMomentId(m.id, momentId));
  if (!exists) return;
  patchMomentComments(momentId, (m) => ({
    ...m,
    liked: detail.liked ?? m.liked,
    likes_count: detail.likes_count ?? m.likes_count,
    comments: Array.isArray(detail.comments) ? detail.comments : m.comments,
    comments_count:
      detail.comments_count ??
      (Array.isArray(detail.comments) ? detail.comments.length : m.comments_count),
  }));
  persistMomentsRuntime();
}

// ====================================================================
// 点赞/取消点赞（乐观更新，后端返回最终状态）
// ====================================================================
function sameMomentId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function pickCommentPayload(body) {
  if (!body || typeof body !== "object") return null;
  if (Number(body.code) === 400 || body.ok === false) return null;
  if (body.error && body.id == null) return null;
  const inner = unwrapApiResults(body);
  if (inner && typeof inner === "object" && inner.id != null) return inner;
  if (inner?.comment && inner.comment.id != null) {
    return { ...inner.comment, ai_reply: inner.ai_reply ?? inner.comment.ai_reply };
  }
  if (body.id != null) return body;
  return null;
}

function draftKey(momentId) {
  return String(momentId);
}

function onCommentInput(momentId, e) {
  const key = draftKey(momentId);
  const value = e?.detail?.value ?? "";
  commentDrafts.value = {
    ...commentDrafts.value,
    [key]: value
  };
}

/**
 * 输入法自带隐藏经常不触发 blur，TabBar 会一直被 focusedCommentId 藏住。
 * 只在「曾经测到键盘弹起」再落到 0 时复位；adjustPan 上高度常年是 0，不能当成收起。
 */
const KEYBOARD_HIDE_PX = 80;
let commentFocusAt = 0;
let commentBlurTimer = null;
let keyboardWasOpen = false;
/** iOS：点评论框时记下滚动位置，并把输入框底边滚到屏幕 50% 高度 */
let commentFocusScrollTop = 0;
let commentMidScrollTimer = 0;
const isIOSHome =
  (() => {
    try {
      return uni.getSystemInfoSync()?.platform === "ios";
    } catch {
      return false;
    }
  })();

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

function restoreTabBarIfKeyboardClosed(uniHeight = 0) {
  const h = Math.max(Number(uniHeight) || 0, readViewportKeyboard());
  if (h >= KEYBOARD_HIDE_PX) {
    keyboardWasOpen = true;
    return;
  }
  if (!keyboardWasOpen || !focusedCommentId.value) return;
  if (Date.now() - commentFocusAt < 600) return;
  keyboardWasOpen = false;
  focusedCommentId.value = "";
}

function applyCommentMidScroll(y) {
  const next = Math.max(0, Number(y) || 0);
  scrollTopControl.value = next > 0 ? next - 0.01 : 0.01;
  void nextTick(() => {
    scrollTopControl.value = next;
    lastScrollTop = next;
    listScrollTop.value = next;
    commentFocusScrollTop = next;
    tabScroll.setScroll(TAB_PATH, next);
  });
}

/** iOS：把该条评论输入框底部对齐到屏幕垂直 50%（安卓不动） */
function scrollCommentInputToScreenMid(momentId) {
  if (!isIOSHome) return;
  const id = draftKey(momentId);
  if (!id || focusedCommentId.value !== id) return;
  const baseTop = Math.max(
    Number(commentFocusScrollTop) || 0,
    Number(lastScrollTop) || 0,
    Number(listScrollTop.value) || 0
  );
  try {
    uni
      .createSelectorQuery()
      // 页面级锚点在卡片评论框下方，底边 ≈ 输入框底边
      .select(`#home-cmt-${id}`)
      .boundingClientRect((rect) => {
        if (!rect || focusedCommentId.value !== id) return;
        let sys = {};
        try {
          sys = uni.getSystemInfoSync() || {};
        } catch {
          /* ignore */
        }
        const viewH = Number(sys.windowHeight) || Number(sys.screenHeight) || 667;
        const targetBottom = viewH * 0.5;
        const delta = Number(rect.bottom) - targetBottom;
        if (Math.abs(delta) < 8) return;
        applyCommentMidScroll(baseTop + delta);
      })
      .exec();
  } catch {
    /* ignore */
  }
}

function onCommentFocus(momentId) {
  if (commentBlurTimer) {
    clearTimeout(commentBlurTimer);
    commentBlurTimer = null;
  }
  const key = draftKey(momentId);
  focusedCommentId.value = key;
  commentFocusAt = Date.now();
  commentFocusScrollTop = Math.max(
    Number(lastScrollTop) || 0,
    Number(listScrollTop.value) || 0,
    Number(tabScroll.scrollTops[TAB_PATH]) || 0
  );
  if (!isIOSHome) return;
  if (commentMidScrollTimer) clearTimeout(commentMidScrollTimer);
  // 必须等手指抬起后再滚：若 touchstart 后立刻滚，touchend 会落到图片上打开大图预览
  commentMidScrollTimer = setTimeout(() => {
    commentMidScrollTimer = 0;
    scrollCommentInputToScreenMid(key);
  }, 320);
}

function onCommentBlur(momentId) {
  const key = draftKey(momentId);
  if (commentFocusRequestId.value === key) {
    commentFocusRequestId.value = "";
  }
  if (commentBlurTimer) clearTimeout(commentBlurTimer);
  commentBlurTimer = setTimeout(() => {
    commentBlurTimer = null;
    if (focusedCommentId.value === key) focusedCommentId.value = "";
  }, 160);
}

function onHomeKeyboardHeightChange(res) {
  const h = Math.max(0, Number(res?.height) || 0);
  restoreTabBarIfKeyboardClosed(h);
}

async function handleLike(momentId) {
  try {
    const data = await apiFetch(
      `/api/moments/${momentId}/like`, {
      method: "POST",
      header: deviceHeaders()
    }
    );
    if (data?.ok) {
      moments.value = moments.value.map((m) =>
        sameMomentId(m.id, momentId) ?
          {
            ...m,
            liked: !!data.liked,
            likes_count: data.likes_count ?? m.likes_count
          } :
          m
      );
      writeHomeMomentsCache(moments.value);
    } else if (data?.error) {
      showToast(String(data.error));
    }
  } catch (e) {
    console.error("点赞失败:", e);
  }
}

function patchMomentComments(momentId, patchFn) {
  moments.value = moments.value.map((m) => {
    if (!sameMomentId(m.id, momentId)) return m;
    return patchFn(m);
  });
  writeHomeMomentsCache(moments.value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 后台 AI 回复就绪后合并进列表（不阻塞输入） */
async function pollMomentAiReply(momentId, userCommentId) {
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    try {
      const raw = await apiFetch(`/api/moments/${momentId}`, {
        header: deviceHeaders(),
      });
      const detail = unwrapApiResults(raw);
      const remote = detail?.comments || [];
      if (!remote.length) continue;

      const aiReady = remote.some(
        (c) =>
          !c.is_user &&
          (userCommentId == null ||
            String(userCommentId).startsWith("tmp-") ||
            sameMomentId(c.parent_id, userCommentId))
      );

      patchMomentComments(momentId, (m) => {
        const prev = m.comments || [];
        const byId = new Map(
          prev
            .filter((c) => !String(c.id).startsWith("tmp-"))
            .map((c) => [String(c.id), c])
        );
        for (const c of remote) {
          byId.set(String(c.id), c);
        }
        const merged = [...byId.values()].sort((a, b) => {
          const ta = new Date(a.created_at || 0).getTime();
          const tb = new Date(b.created_at || 0).getTime();
          return ta - tb;
        });
        return {
          ...m,
          comments: merged,
          comments_count: detail.comments_count ?? Math.max(m.comments_count || 0, merged
            .length),
        };
      });
      if (aiReady) {
        const replies = findAiRepliesToUser(remote).filter(
          (c) =>
            userCommentId == null ||
            String(userCommentId).startsWith("tmp-") ||
            sameMomentId(c.parent_id, userCommentId)
        );
        const momentRow = moments.value.find((m) => sameMomentId(m.id, momentId));
        for (const c of replies) {
          recordLocalReplyNotif({
            replyId: c.id,
            momentId,
            title: c.companion_name ||
              momentRow?.companion_name ||
              t("home.defaultCompanionName"),
            content: c.content || "",
            avatar: momentRow?.companion_avatar || "",
            imageUrl: momentRow?.image_url || "",
            time: c.created_at,
            companionId: c.companion_id || momentRow?.companion_id,
          });
        }
        hasUnread.value = computeHomeHasUnread(moments.value);
        return;
      }
    } catch (e) {
      console.warn("轮询 AI 回复失败:", e);
    }
  }
}

// ====================================================================
// 发送评论：乐观插入立即上屏，失败回滚并恢复输入（对齐朋友圈详情页）
// ====================================================================
async function handleComment(momentId, e) {
  const key = draftKey(momentId);
  const fromEvent = typeof e?.detail?.value === "string" ? e.detail.value : null;
  const content = (fromEvent ?? commentDrafts.value[key] ?? "").trim();
  if (!content || commentBusy.value[key]) return;

  commentBusy.value = {
    ...commentBusy.value,
    [key]: true
  };
  commentDrafts.value = {
    ...commentDrafts.value,
    [key]: ""
  };
  commentInputKeys.value = {
    ...commentInputKeys.value,
    [key]: (commentInputKeys.value[key] || 0) + 1,
  };
  focusedCommentId.value = "";
  commentFocusRequestId.value = "";

  // 乐观插入：点发送后立刻把我的评论放上去
  const tempId = `temp-${Date.now()}`;
  const optimistic = {
    id: tempId,
    content,
    companion_name: t("common.me"),
    created_at: new Date().toISOString(),
    is_me: true,
    _optimistic: true,
  };
  patchMomentComments(momentId, (m) => ({
    ...m,
    comments: [...(m.comments || []), optimistic],
    comments_count: (m.comments_count || 0) + 1,
  }));

  /** 失败回滚：撤掉乐观评论、恢复输入内容；toast=false 时表示 apiFetch 已提示过 */
  const rollback = (msg, { toast = true } = {}) => {
    patchMomentComments(momentId, (m) => ({
      ...m,
      comments: (m.comments || []).filter((c) => c.id !== tempId),
      comments_count: Math.max(0, (m.comments_count || 0) - 1),
    }));
    commentDrafts.value = {
      ...commentDrafts.value,
      [key]: content
    };
    commentInputKeys.value = {
      ...commentInputKeys.value,
      [key]: (commentInputKeys.value[key] || 0) + 1,
    };
    if (toast && msg) showToast(msg);
  };

  try {
    const req = {
      url: `/api/moments/${momentId}/comment`,
      method: "POST",
      data: { content },
      header: {
        ...deviceHeaders(),
        "Content-Type": "application/json",
      },
    };
    console.log("[moments/comment] 请求", {
      ...req,
      locale: uiLang.value,
      contentLength: content.length,
    });
    const data = await apiFetch(req.url, {
      method: req.method,
      header: req.header,
      data: req.data,
      timeout: 20000,
    });

    const momentRow = moments.value.find((m) => sameMomentId(m.id, momentId));
    if (openCommentLimitDialog(data, null, momentRow?.companion_id, { momentId, draft: content })) {
      rollback("", { toast: false });
      return;
    }

    if (Number(data?.code) === 400) {
      rollback(String(data?.message || t("common.networkError")));
      return;
    }

    const comment = pickCommentPayload(data);
    if (comment) {
      patchMomentComments(momentId, (m) => {
        const prev = (m.comments || []).filter((c) => c.id !== tempId);
        const hadReal = prev.some((c) => sameMomentId(c.id, comment.id));
        const newComments = hadReal ? prev : [...prev, comment];
        let countDelta = hadReal ? -1 : 0;

        if (
          comment.ai_reply &&
          !newComments.some((c) => sameMomentId(c.id, comment.ai_reply.id))
        ) {
          newComments.push(comment.ai_reply);
          countDelta += 1;
        }

        return {
          ...m,
          comments_count: Math.max(0, (m.comments_count || 0) + countDelta),
          comments: newComments,
        };
      });

      commentDrafts.value = {
        ...commentDrafts.value,
        [key]: "",
      };
      commentInputKeys.value = {
        ...commentInputKeys.value,
        [key]: (commentInputKeys.value[key] || 0) + 1,
      };

      if (!comment.ai_reply) {
        void pollMomentAiReply(momentId, comment.id);
      } else {
        const momentRow = moments.value.find((m) => sameMomentId(m.id, momentId));
        recordLocalReplyNotif({
          replyId: comment.ai_reply.id,
          momentId,
          title: comment.ai_reply.companion_name ||
            momentRow?.companion_name ||
            t("home.defaultCompanionName"),
          content: comment.ai_reply.content || "",
          avatar: momentRow?.companion_avatar || "",
          imageUrl: momentRow?.image_url || "",
          time: comment.ai_reply.created_at,
          companionId: comment.ai_reply.companion_id || momentRow?.companion_id,
        });
        hasUnread.value = computeHomeHasUnread(moments.value);
      }
    } else {
      rollback(
        String(
          data?.error ||
            data?.detail ||
            data?.message ||
            t("common.networkError")
        )
      );
    }
  } catch (err) {
    console.error("评论失败:", err);
    const momentRow = moments.value.find((m) => sameMomentId(m.id, momentId));
    if (openCommentLimitDialog(null, err, momentRow?.companion_id, { momentId, draft: content })) {
      rollback("", { toast: false });
      return;
    }
    // 展示接口原文，如 { error: "评论内容无效，请修改后重试", status_code: 400 }
    const msg = String(
      (typeof err?.detail === "string" && err.detail) ||
        (typeof err?.message === "string" && err.message) ||
        t("common.networkError")
    );
    // apiFetch 对带 status 的业务/HTTP 错误已 toast，避免再盖成「网络错误」
    const alreadyToasted = typeof err?.status === "number";
    rollback(msg, { toast: !alreadyToasted });
  } finally {
    commentBusy.value = {
      ...commentBusy.value,
      [key]: false
    };
  }
}

function isCommentByMe(comment) {
  if (!comment) return false;
  // 优先用接口返回的 is_me 字段
  if (comment.is_me === true) return true;
  // 兼容 GET 接口未返回 is_me 的情况，回退 user_id 比对
  const uid = getCurrentUserId();
  const userId = comment.user_id;
  return userId != null && uid != null && String(userId) === String(uid);
}

// ───────────────── 筛选弹窗 ─────────────────
function openMomentFilter() {
  draftFilterLang.value = momentFilterLang.value;
  draftFilterGender.value = momentFilterGender.value;
  draftFilterOrientation.value = momentFilterOrientation.value;
  showMomentFilter.value = true;
}

function resetDraftFilter() {
  draftFilterLang.value = "";
  draftFilterGender.value = "";
  draftFilterOrientation.value = "";
  // 重置即应用并重载，避免弹窗关了但无加载态/条件残留（web#47）
  applyMomentFilter();
}

function applyMomentFilter() {
  momentFilterLang.value = draftFilterLang.value;
  momentFilterGender.value = draftFilterGender.value;
  momentFilterOrientation.value = draftFilterOrientation.value;
  momentsPage = 0;
  showMomentFilter.value = false;
  void (async () => {
    loading.value = true;
    try {
      await Promise.all([
        loadCompanionStrip(),
        loadMomentsPage(true, {
          filter_lang: draftFilterLang.value,
          gender: draftFilterGender.value,
          orientation: draftFilterOrientation.value,
        }),
      ]);
    } finally {
      loading.value = false;
    }
  })();
}

function onPickLang(e) {
  draftFilterLang.value = langOptions.value[Number(e.detail.value)]?.value ?? "";
}

function onPickGender(e) {
  draftFilterGender.value = genderOptions.value[Number(e.detail.value)]?.value ?? "";
}

function onPickOrientation(e) {
  draftFilterOrientation.value =
    orientationOptions.value[Number(e.detail.value)]?.value ?? "";
}

// ───────────────── 导航 ─────────────────
function openCompanion(id) {
  trackProductEvent(
    PRODUCT_EVENTS.AVATAR_PROFILE_CLICK,
    withCompanionId({ page: "home", target_id: String(id ?? "") }, id)
  );
  uni.navigateTo({
    url: `/pages-sub/companion/index?id=${id}`
  });
}

function openChat(id) {
  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
    withCompanionId(
      { page: "home", source: "companions_tab", target_id: String(id ?? "") },
      id
    )
  );
  // 只跳转；由 chat 页统一建连，避免与 onMounted 抢连
  uni.navigateTo({
    url: `/pages/chat/index?id=${id}`
  });
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** 本地同步：同一 companion 的朋友圈 / 智能体列表 is_say_hi 置 true */
function markSayHiDone(companionId) {
  const cid = String(companionId || "");
  if (!cid) return;
  moments.value = moments.value.map((m) =>
    String(m.companion_id) === cid ? { ...m, is_say_hi: true } : m
  );
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
  if (res == null || typeof res !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(res, "say_hi_daily_remaining")) return;
  const n = Number(res.say_hi_daily_remaining);
  if (!Number.isFinite(n) || n < 0) return;
  sayHiDailyRemaining.value = n;
}

function isSayHiDailyRemainingZero() {
  const raw = sayHiDailyRemaining.value;
  if (raw == null || raw === "") return false;
  const n = Number(raw);
  return Number.isFinite(n) && n === 0;
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

/** 日额用尽、未打招呼：确认是否用聊天免费次数继续 Say Hi */
const showSayHiDailyConfirm = ref(false);
const pendingSayHi = ref(null);

function openSayHiDailyConfirm(ctx) {
  pendingSayHi.value = ctx;
  showSayHiDailyConfirm.value = true;
}

function goSayHiDirectChat() {
  const ctx = pendingSayHi.value;
  pendingSayHi.value = null;
  const cid = ctx?.companionId;
  if (!cid) return;
  uni.navigateTo({ url: `/pages/chat/index?id=${cid}` });
}

function confirmSayHiUseChatFree() {
  const ctx = pendingSayHi.value;
  pendingSayHi.value = null;
  if (!ctx?.companionId) return;
  void requestSayHiAndChat({ ...ctx, useChatFree: true, skipTrack: true });
}

function sayHiNeedsChatFreeConfirm(data) {
  if (!data || data.need_paywall === true) return false;
  if (data.message || data.already || data.is_say_hi) return false;
  return (
    data.say_hi_daily_exhausted === true ||
    data.need_use_chat_free === true ||
    data.require_use_chat_free === true
  );
}

/**
 * 点 Say Hi：按智能体打招呼（文案写入聊天），再进聊天页。
 * - 机器人 Tab：POST /api/companions/{id}/say_hi（无需朋友圈）
 * - 朋友圈：POST /api/moments/{id}/say_hi（服务端只用来解析 companion_id）
 * - 日额用尽且未打招呼：先确认；继续则 POST .../say_hi?use_chat_free=true
 * - 是否付费拦截只看响应 need_paywall（HTTP 200）
 */
async function requestSayHiAndChat({
  momentId,
  companionId,
  source,
  busyKey,
  setBusy,
  useChatFree = false,
  skipTrack = false,
}) {
  if (!companionId) return;

  if (!skipTrack) {
    trackProductEvent(
      PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
      withCompanionId(
        {
          page: "home",
          source,
          target_id: String(momentId || companionId),
        },
        companionId
      )
    );
    if (source === "moments" || source === "companions_tab") {
      trackProductEvent(
        PRODUCT_EVENTS.SEND_MESSAGE_CLICK_MOMENT,
        withCompanionId(
          {
            page: "home",
            source,
            target_id: String(momentId || companionId),
          },
          companionId
        )
      );
    }
  }

  if (!useChatFree && isSayHiDailyRemainingZero()) {
    openSayHiDailyConfirm({ momentId, companionId, source, busyKey, setBusy });
    return;
  }

  if (busyKey && setBusy) setBusy(busyKey);

  try {
    const lang = encodeURIComponent(locale.value || "en");
    const qs = [`lang=${lang}`];
    if (useChatFree) qs.push("use_chat_free=true");
    const path =
      !useChatFree && source === "moments" && momentId
        ? `/api/moments/${momentId}/say_hi?${qs.join("&")}`
        : `/api/companions/${companionId}/say_hi?${qs.join("&")}`;
    const data = await apiFetch(path, {
      method: "POST",
      header: deviceHeaders(),
    });

    updateSayHiDailyRemaining(data);

    if (data?.need_paywall === true) {
      openSayHiPaywall(data?.companion_id || companionId, data);
      return;
    }

    if (!useChatFree && sayHiNeedsChatFreeConfirm(data)) {
      openSayHiDailyConfirm({ momentId, companionId, source, busyKey, setBusy });
      return;
    }

    const cid = data?.companion_id || companionId;
    if (
      Number(data?.say_hi_daily_remaining) === 0 &&
      data?.use_say_hi_daily_free === true
    ) {
      showToast(t("home.sayHiDailyFreeUsedUp"));
    }

    if (data?.message || data?.already) {
      markSayHiDone(cid);
      uni.navigateTo({
        url: `/pages/chat/index?id=${cid}`,
      });
      return;
    }

    if (data?.is_say_hi) {
      markSayHiDone(cid);
      uni.navigateTo({
        url: `/pages/chat/index?id=${cid}`,
      });
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

/**
 * 朋友圈卡片右上角：Say Hi / Message。
 * 旧破冰 icebreaker 代码保留在下方注释块，当前走 say_hi。
 */
async function goChatFromMoment(moment) {
  const { id, companion_id: companionId } = moment || {};
  if (!id || !companionId || sendingMomentId.value === id) return;

  if (isTruthyFlag(moment.is_say_hi)) {
    trackProductEvent(
      PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
      withCompanionId(
        { page: "home", source: "moments", target_id: String(id) },
        companionId
      )
    );
    uni.navigateTo({ url: `/pages/chat/index?id=${companionId}` });
    return;
  }

  await requestSayHiAndChat({
    momentId: id,
    companionId,
    source: "moments",
    busyKey: id,
    setBusy: (v) => {
      sendingMomentId.value = v;
    },
  });
}

/**
 * Companions Tab：未打招呼走 companion say_hi（无需朋友圈），已打招呼直接进聊天。
 */
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
    source: "companions_tab",
    busyKey: companionId,
    setBusy: (v) => {
      sendingCompanionId.value = v;
    },
  });
}

/*
 * —— 旧破冰入口（保留，勿删）——
 * async function goChatFromMomentIcebreaker(moment) {
 *   const { id, companion_id: companionId } = moment || {};
 *   if (!id || !companionId || sendingMomentId.value === id) return;
 *   sendingMomentId.value = id;
 *   try {
 *     const data = await apiFetch(`/api/moments/${id}/icebreaker?lang=${locale.value}`, {
 *       method: "POST",
 *       header: deviceHeaders(),
 *     });
 *     setJson(`icebreaker:${companionId}`, data || {});
 *     uni.navigateTo({ url: `/pages/chat/index?id=${companionId}` });
 *   } catch (e) { ... }
 *   finally { sendingMomentId.value = ""; }
 * }
 */

/** @param {string|{id?:string,companion_id?:string}} momentOrId */
function resolveMomentIds(momentOrId) {
  if (momentOrId && typeof momentOrId === "object") {
    return {
      momentId: momentOrId.id != null ? String(momentOrId.id) : "",
      companionId:
        momentOrId.companion_id != null ? String(momentOrId.companion_id) : "",
    };
  }
  return {
    momentId: momentOrId != null ? String(momentOrId) : "",
    companionId: "",
  };
}

function openMoment(momentOrId) {
  const { momentId, companionId } = resolveMomentIds(momentOrId);
  trackProductEvent(
    PRODUCT_EVENTS.MOMENTS_DETAIL_CLICK,
    withCompanionId({ page: "home", target_id: momentId }, companionId)
  );
  // 从详情返回后只同步这一条，不整表刷新
  pendingMomentSyncId = momentId || "";
  uni.navigateTo({
    url: `/pages-sub/moment/index?id=${momentId}`
  });
}

/** 点击评论图标：进详情，不在列表里拉键盘（部分安卓会闪） */
function openMomentFromComment(momentOrId) {
  const { momentId, companionId } = resolveMomentIds(momentOrId);
  trackProductEvent(
    PRODUCT_EVENTS.MOMENTS_COMMENT_CLICK,
    withCompanionId({ page: "home", target_id: momentId }, companionId)
  );
  pendingMomentSyncId = momentId || "";
  uni.navigateTo({
    url: `/pages-sub/moment/index?id=${momentId}`
  });
}

/** 不感兴趣 / 屏蔽：写入触达偏好并过滤该 companion 的动态 */
async function setMomentOutreachPreference(companionId, action) {
  if (!companionId) return;
  const run = async () => {
    try {
      await apiFetch(`/companions/${companionId}/outreach-preference`, {
        method: "POST",
        data: { action },
      });
      moments.value = moments.value.filter(
        (m) => String(m.companion_id) !== String(companionId)
      );
      writeHomeMomentsCache(moments.value);
      hasUnread.value = computeHomeHasUnread(moments.value);
      showToast(
        action === "block"
          ? t("companionProfile.outreachBlocked")
          : t("companionProfile.outreachDisliked")
      );
    } catch {
      showToast(t("companionProfile.outreachFailed"));
    }
  };
  if (action === "block") {
    uni.showModal({
      title: t("companionProfile.blockOutreach"),
      content: t("companionProfile.blockOutreachConfirm"),
      confirmText: t("common.confirm"),
      cancelText: t("common.cancel"),
      success: (res) => {
        if (res.confirm) void run();
      },
    });
    return;
  }
  await run();
}

function onMomentDislike(companionId) {
  void setMomentOutreachPreference(companionId, "dislike");
}

function onMomentBlock(companionId) {
  void setMomentOutreachPreference(companionId, "block");
}

function onMomentReport(companionId) {
  if (!companionId) return;
  reportCharacterId.value = String(companionId);
  reportOpen.value = true;
}

const {
  showCreateVipGate,
  createGateVip,
  createGatePoints,
  createGateVipName,
  createGateVipExpire,
  createGateVipType,
  enterCreateCompanion,
  onCreateVipPurchased,
} = useCreateCompanionEntry();

function goCreate() {
  void enterCreateCompanion({ page: "home", source: "strip" });
}

function goNotifications() {
  uni.navigateTo({
    url: "/pages-sub/notifications/index"
  });
}

/** 图片加载失败时记录，点击可重试 */
function onMomentImageError(momentId) {
  imageFailedMap.value = {
    ...imageFailedMap.value,
    [momentId]: true
  };
}

/**
 * 重试加载朋友圈图片：调用用户侧 regenerate-image 接口，并更新对应动态的 image_url。
 */
async function reloadMomentImage(moment) {
  const id = moment?.id;
  if (!id || regeneratingImageId.value === id) return;

  regeneratingImageId.value = id;
  try {
    const data = await apiFetch(`/api/moments/${id}/regenerate-image`, {
      method: "POST",
      header: deviceHeaders(),
    });

    // 接口返回新的图片地址，更新对应动态数据（响应格式可在此处按需调整）
    const target = moments.value.find((m) => m.id === id);
    if (target) {
      if (data?.image_url) target.image_url = data.image_url;
      if (data?.preview_url) target.preview_url = data.preview_url;
    }

    imageFailedMap.value = {
      ...imageFailedMap.value,
      [id]: false
    };
  } catch (e) {
    console.error("[home] 重新生成朋友圈图片失败:", e);
    showToast(t("common.networkError"));
  } finally {
    regeneratingImageId.value = "";
  }
}

/** 点击图片：加载失败则重试，否则系统全屏预览 */
function handleMomentImageClick(moment) {
  if (imageFailedMap.value[moment?.id]) {
    void reloadMomentImage(moment);
  } else if (moment?.image_url || moment?.preview_url) {
    previewMedia(moment.image_url || moment.preview_url);
  }
}

const onLikeTap = bindAnalyticsTapArg(
  "home-moment-like",
  handleLike,
  "首页朋友圈点赞"
);
const onCommentOpenTap = bindAnalyticsTapArg(
  "home-moment-comment",
  openMomentFromComment,
  "首页朋友圈评论"
);
const onMomentDetailTap = bindAnalyticsTapArg(
  "home-moment-detail",
  openMoment,
  "首页朋友圈详情"
);
const onSendCommentTap = bindAnalyticsTapArg(
  "home-send-comment",
  handleComment,
  "首页发送评论"
);
const onCompanionStripTap = bindAnalyticsTapArg(
  (id) => `home-companion-${id}`,
  openCompanion
);

// ───────────────── 展示辅助 ─────────────────
function getCompanionById(id) {
  return companions.value.find((c) => c.id === id);
}

function displayName(m) {
  return formatCompanionName(
    m.companion_name || getCompanionById(m.companion_id)?.name,
    t("home.defaultCompanionName")
  );
}

function displayGender(m) {
  return m.companion_gender ?? getCompanionById(m.companion_id)?.gender ?? "";
}

function displayAvatar(m) {
  return m.companion_avatar || getCompanionById(m.companion_id)?.avatar || "";
}

// ───────────────── 生命周期 ─────────────────
// 自定义 Tab 用 redirectTo，切走会卸页。
// 只有朋友圈整表刷新放 onLoad（切 Tab 回来用内存还原）；
// 顶部头像条仍每次 onShow 拉 /api/bcompanions?special=message。
onLoad(() => {
  try {
    const sys = uni.getSystemInfoSync();
    listViewHeight.value = Math.max(400, (sys.windowHeight || 600) - 160);
  } catch {
    /* keep default */
  }
  const session = readHomeMomentsRuntime();
  if (restoreMomentsRuntime(session)) {
    initialized = true;
    trackHomePageShowIfReady();
    return;
  }
  // 首屏：头像条 + 朋友圈一起拉，不跟性别弹窗互等
  void performFullRefresh(false).finally(() => {
    initialized = true;
    trackHomePageShowIfReady();
  });
});

onMounted(() => {
  if (savedScrollToRestore > 0) {
    scheduleScrollRestore(savedScrollToRestore);
    savedScrollToRestore = 0;
  }
  if (typeof uni.onKeyboardHeightChange === "function") {
    uni.onKeyboardHeightChange(onHomeKeyboardHeightChange);
  }
  // 弹窗与首页加载并行，避免等接口导致只剩骨架
  if (genderModalPending) {
    nextTick(() => tryOpenGenderSelectModal());
  }
});

onUnmounted(() => {
  if (typeof uni.offKeyboardHeightChange === "function") {
    uni.offKeyboardHeightChange(onHomeKeyboardHeightChange);
  }
  if (commentMidScrollTimer) {
    clearTimeout(commentMidScrollTimer);
    commentMidScrollTimer = 0;
  }
  if (commentBlurTimer) {
    clearTimeout(commentBlurTimer);
    commentBlurTimer = null;
  }
});

onHide(() => {
  persistMomentsRuntime();
  focusedCommentId.value = "";
  commentFocusRequestId.value = "";
  if (commentMidScrollTimer) {
    clearTimeout(commentMidScrollTimer);
    commentMidScrollTimer = 0;
  }
});

onUnload(() => {
  persistMomentsRuntime();
});

onShow(() => {
  if (homeNativeHideTimer) {
    clearTimeout(homeNativeHideTimer);
    homeNativeHideTimer = null;
  }
  // 未选性别：与首页加载并行弹窗
  if (!hasUserGender()) {
    genderModalPending = true;
    tryOpenGenderSelectModal();
  }
  // 从聊天返回首页时，部分端 chat onHide 不触发：按路由强制断 /ws/chat
  try {
    chat.syncChatPresenceFromRoute("home-onShow");
  } catch {
    /* ignore */
  }
  // 兜底：登录后进首页时 App.onShow 可能不会再跑，这里补开计时
  startForegroundDree0Timer();
  hasUnread.value = computeHomeHasUnread(moments.value);
  void loadCompanionStrip().catch((e) => console.error(e));
  // 限时优惠：已选性别且首页已展示过才刷新（未选性别绝不提前 GET）
  if (homePageShownTracked && hasUserGender()) {
    try {
      useLimitedOfferStore().onTabPageShow();
    } catch {
      /* ignore */
    }
  }
  if (!initialized) return;
  trackHomePageShowIfReady();
  const momentId = pendingMomentSyncId;
  pendingMomentSyncId = "";
  if (!momentId) return;
  const commenting = Object.values(commentBusy.value).some(Boolean);
  if (commenting) return;
  void syncMomentAfterDetail(momentId).catch((e) => console.error(e));
});
</script>

<template>
  <AppPageShell
    :show-header="false"
    show-tab-bar
    :reserve-tab-bar="false"
    transparent-header
    fill-webview
  >
    <template #header>
      <!-- 滚动时半透明遮罩：覆盖状态栏 + header 区域，透出底层渐变光晕 -->
      <view class="header-backdrop" :style="{ opacity: headerBackOpacity }" />
      <!-- ═════════════ 顶部标题栏 + 筛选/通知（fixed 定位） ═════════════ -->
      <view class="home-header" :class="{ scrolled: headerScrolled }">
        <view class="header-row">
          <view class="header-tabs">
            <text class="tab-item" :class="{ active: activeTab === 'moments' }"
              @tap="switchHomeTab('moments')">{{ t("discover.moments") }}</text>
            <text class="tab-item" :class="{ active: activeTab === 'companions' }"
              @tap="switchHomeTab('companions')">{{
              t("discover.tabCompanions") }}</text>
          </view>
          <!-- 通知铃铛 -->
          <view class="icon-btn" @tap="bindAnalyticsTap('home-notification', goNotifications, '通知')">
            <image src="/static/home/icon-notification.svg" class="notif-icon icon-on-fg" mode="aspectFit" />
            <view v-if="hasUnread" class="unread-dot" />
          </view>
        </view>
      </view>
    </template>
    <!-- 顶部光晕装饰：fixed 定位，铺在状态栏后面 -->
    <view class="home-glow" />
    <view class="home-page" :style="homePageStyle">
      <!-- ═════════════ 主滚动区：下拉刷新在 tab 上方 ═════════════ -->
      <AppPullRefresh v-if="activeTab === 'moments'" class="home-body" :refreshing="refreshing"
        :threshold="80" :lower-threshold="240" :scroll-top="scrollTopControl"
        :show-loadmore="false"
        @refresh="onRefresh" @loadmore="loadMore" @scroll="onScroll">
        <!-- 自定义下拉状态：下拉提示 -->
        <template #pull>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner custom-refresh-spinner--idle" />
            <text class="custom-refresh-text">{{ t('common.pullToRefresh') }}</text>
          </view>
        </template>
        <!-- 自定义释放状态：释放提示 -->
        <template #release>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner custom-refresh-spinner--idle" />
            <text class="custom-refresh-text">{{ t('common.releaseToRefresh') }}</text>
          </view>
        </template>
        <!-- 自定义刷新中动画：品牌双色旋转环 -->
        <template #refreshing>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner" />
            <text class="custom-refresh-text">{{ t('common.refreshing') }}</text>
          </view>
        </template>

        <!-- ═════════════ 首屏骨架（无缓存时） ═════════════ -->
        <view v-if="loading && !companions.length && !moments.length">
          <AppListSkeleton :rows="6" />
        </view>

        <template v-else>
          <!-- ── 智能体头像横滑条（含创建入口） ── -->
          <view class="strip-wrap">
            <scroll-view
              scroll-x
              class="companion-strip"
              show-scrollbar="false"
              :lower-threshold="80"
              @scroll="onCompanionStripScroll"
              @scrolltolower="loadMoreCompanionStrip"
            >
              <view class="strip-row">
                <view class="strip-item" @tap="bindAnalyticsTap('home-create-companion', goCreate, '创建伴侣')">
                  <view class="strip-create">
                    <image src="/static/home/icon-add.svg" class="add-img icon-on-fg" mode="aspectFit" />
                  </view>
                  <text class="strip-name">{{ t("home.create") }}</text>
                </view>
                <view v-for="c in companions" :key="c.id" class="strip-item" @tap="onCompanionStripTap(c.id)">
                  <view class="strip-avatar">
                    <AppAvatarImage :src="c.avatar" :seed="c.id" :generating="c.avatar_generating" />
                  </view>
                  <text class="strip-name">{{ c.name }}</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- ── 朋友圈动态列表 ── -->
          <view v-if="!moments.length" class="empty text-muted">
            <text>{{ momentsLoadError ? t("common.loadFailed") : t("home.noMoments") }}</text>
            <text
              v-if="momentsLoadError"
              class="empty-retry"
              @tap="performFullRefresh(false)"
            >{{ t("common.retry") }}</text>
          </view>

          <view
            v-if="momentsTopPad"
            class="list-virtual-pad"
            :style="{ height: `${momentsTopPad}px` }"
          />
          <view
            v-for="m in virtualMoments"
            :id="'moment-card-' + m.id"
            :key="m.id"
            class="home-moment-card"
          >
            <AppMomentCard :moment="m" :avatar="displayAvatar(m)" :name="displayName(m)" :gender="displayGender(m)"
              :sending="sendingMomentId === m.id" :regenerating="regeneratingImageId === m.id"
              :comment-draft="commentDrafts[String(m.id)] || ''" :comment-busy="!!commentBusy[String(m.id)]"
              :comment-input-key="commentInputKeys[String(m.id)] || 0"
              :comment-focused="commentFocusRequestId === String(m.id)" :is-comment-mine="isCommentByMe"
              @avatar-tap="openCompanion(m.companion_id)" @send="goChatFromMoment(m)"
              @image-click="handleMomentImageClick(m)" @image-error="onMomentImageError(m.id)" @like="onLikeTap(m.id)"
              @comment-tap="onCommentOpenTap(m)" @detail-tap="onMomentDetailTap(m)"
              @comment-input="onCommentInput(m.id, $event)" @comment-confirm="handleComment(m.id, $event)"
              @comment-focus="onCommentFocus(m.id)"
              @comment-blur="onCommentBlur(m.id)" @comment-send="onSendCommentTap(m.id)"
              @dislike="onMomentDislike" @block="onMomentBlock" @report="onMomentReport" />
            <!-- 页面级锚点：评论框在卡片底，供 iOS 弹键盘后 scroll-into-view -->
            <view :id="'home-cmt-' + m.id" class="home-cmt-anchor" />
          </view>
          <view
            v-if="momentsBottomPad"
            class="list-virtual-pad"
            :style="{ height: `${momentsBottomPad}px` }"
          />
          <view v-if="loadingMore" class="home-feed-loadmore">
            <view class="custom-refresh-spinner" />
            <text class="home-feed-loadmore-text">{{ t("common.loading") }}</text>
          </view>
          <view v-else-if="!hasMore && moments.length" class="home-feed-loadmore home-feed-loadmore--nomore">
            <text class="home-feed-loadmore-text">{{ t("home.noMoreMoments") }}</text>
          </view>
          <view class="home-tab-spacer" :style="{ height: tabBarSpacerPx + 'px' }" />
        </template>
      </AppPullRefresh>

      <!-- ═════════════ Companions Tab（下拉刷新 + 上滑加载） ═════════════ -->
      <AppPullRefresh
        v-else
        class="home-body"
        :refreshing="refreshing"
        :threshold="80"
        :lower-threshold="80"
        :scroll-top="scrollTopControl"
        :show-loadmore="false"
        @refresh="onCompanionsRefresh"
        @loadmore="loadMoreHomeCompanions"
        @scroll="onScroll"
      >
        <template #pull>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner custom-refresh-spinner--idle" />
            <text class="custom-refresh-text">{{ t('common.pullToRefresh') }}</text>
          </view>
        </template>
        <template #release>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner custom-refresh-spinner--idle" />
            <text class="custom-refresh-text">{{ t('common.releaseToRefresh') }}</text>
          </view>
        </template>
        <template #refreshing>
          <view class="custom-refresh">
            <view class="custom-refresh-spinner" />
            <text class="custom-refresh-text">{{ t('common.refreshing') }}</text>
          </view>
        </template>

          <!-- 筛选标签 -->
          <view class="companion-filter-row">
            <view class="companion-filter-chip" :class="{ active: homeCompanionFilter === 'all' }"
              @tap="homeCompanionFilter = 'all'">
              <text>{{ t("discover.filterAll") || "All" }}</text>
            </view>
            <view class="companion-filter-chip" :class="{ active: homeCompanionFilter === 'recommended' }"
              @tap="homeCompanionFilter = 'recommended'">
              <text>{{ t("discover.filterRecommended") || "recommend" }}</text>
            </view>
            <view class="companion-filter-chip" :class="{ active: homeCompanionFilter === 'mine' }"
              @tap="homeCompanionFilter = 'mine'">
              <text>{{ t("discover.filterMine") }}</text>
            </view>
          </view>

          <AppListSkeleton v-if="homeCompanionsLoading && !displayHomeCompanions.length" :rows="4" />

          <view v-else-if="!displayHomeCompanions.length" class="empty text-muted">
            {{ t("discover.noCompanions") }}
          </view>

          <view v-else class="companion-list">
            <AppCompanionCard v-for="c in displayHomeCompanions" :key="c.profile?.id" :companion="c" :ui-lang="uiLang"
              :sending="sendingCompanionId === String(c.profile?.id || '')"
              @profile="openCompanion" @send="goChatFromCompanion" />
          </view>
          <view v-if="homeCompanionsLoadingMore" class="home-feed-loadmore">
            <view class="custom-refresh-spinner" />
            <text class="home-feed-loadmore-text">{{ t("common.loading") }}</text>
          </view>
          <view
            v-else-if="!homeCompanionsHasMore && displayHomeCompanions.length"
            class="home-feed-loadmore home-feed-loadmore--nomore"
          >
            <text class="home-feed-loadmore-text">{{ t("home.noMoreMoments") }}</text>
          </view>
          <view class="home-tab-spacer" :style="{ height: tabBarSpacerPx + 'px' }" />
      </AppPullRefresh>

      <!-- ═════════════ 返回顶部悬浮按钮 ═════════════ -->
      <view v-if="showBackToTop" class="back-to-top"
        @tap="bindAnalyticsTap('home-back-to-top', scrollHomeToTop, '返回顶部')">
        <text>↑</text>
      </view>
    </view>

    <!-- ═════════════ 筛选弹窗 ═════════════ -->
    <view v-if="showMomentFilter" class="modal-mask" @tap="showMomentFilter = false">
      <view class="modal-sheet" @tap.stop>
        <view class="modal-header flex-row justify-between items-center">
          <text class="modal-title">{{ t("home.momentFilter") }}</text>
          <text class="modal-close text-muted" @tap="showMomentFilter = false">✕</text>
        </view>

        <view class="modal-body">
          <!-- 语言筛选 -->
          <view class="filter-group">
            <text class="filter-label text-muted">{{ t("home.filterLanguage") }}</text>
            <picker mode="selector" :range="langOptions.map((o) => o.label)" @change="onPickLang">
              <view class="filter-select flex-row justify-between items-center">
                <text>{{ optionLabel(langOptions, draftFilterLang) }}</text>
                <text class="text-muted">›</text>
              </view>
            </picker>
          </view>

          <!-- 性别筛选 -->
          <view class="filter-group">
            <text class="filter-label text-muted">{{ t("home.filterGender") }}</text>
            <picker mode="selector" :range="genderOptions.map((o) => o.label)" @change="onPickGender">
              <view class="filter-select flex-row justify-between items-center">
                <text>{{ optionLabel(genderOptions, draftFilterGender) }}</text>
                <text class="text-muted">›</text>
              </view>
            </picker>
          </view>

          <!-- 性取向筛选 -->
          <view class="filter-group">
            <text class="filter-label text-muted">{{ t("home.filterOrientation") }}</text>
            <picker mode="selector" :range="orientationOptions.map((o) => o.label)" @change="onPickOrientation">
              <view class="filter-select flex-row justify-between items-center">
                <text>{{ optionLabel(orientationOptions, draftFilterOrientation) }}</text>
                <text class="text-muted">›</text>
              </view>
            </picker>
          </view>

          <!-- 重置 / 应用 -->
          <view class="flex-row gap-sm filter-footer">
            <view class="filter-btn reset" @tap="resetDraftFilter">
              <text>{{ t("home.resetFilter") }}</text>
            </view>
            <view class="filter-btn apply" @tap="applyMomentFilter">
              <text>{{ t("home.applyFilter") }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <AppReportCharacterPopup
      v-model:open="reportOpen"
      :character-id="reportCharacterId"
      source="moments"
    />

    <AppRechargeModal
      v-model:open="showCreateVipGate"
      default-tab="vip"
      :is-vip="createGateVip"
      :vip-name="createGateVipName"
      :vip-expire-date="createGateVipExpire"
      :vip-type="createGateVipType"
      :points="createGatePoints"
      analytics-scene="agent_create"
      @purchased="onCreateVipPurchased"
    />

    <AppConfirmDialog
      v-model:open="commentLimitOpen"
      centered
      :title="t('home.commentLimitTitle')"
      :description="commentLimitDesc"
      :confirm-text="t('home.commentLimitGoChat')"
      :cancel-text="t('common.cancel')"
      @confirm="goCommentLimitChat"
    />

    <AppConfirmDialog
      v-model:open="showSayHiDailyConfirm"
      centered
      :description="t('home.sayHiDailyExhaustedDesc')"
      :confirm-text="t('home.sayHiContinue')"
      :cancel-text="t('home.sayHiDirectChat')"
      @confirm="confirmSayHiUseChatFree"
      @cancel="goSayHiDirectChat"
    />

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

    <!-- 限时优惠：首页显示悬浮入口 -->
    <AppLimitedOfferHost show-entry />

  </AppPageShell>
</template>

<style scoped lang="scss" src="./index.scss"></style>
