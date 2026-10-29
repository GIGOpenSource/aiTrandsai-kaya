<script setup>
/**
 * @file pages-sub/companion — 伴侣资料页
 * @description 查看伴侣档案与动态；创建者可清空消息/删除伴侣。
 * @depends apiFetch、AppConfirmDialog、stores/chat
 */
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { onLoad, onShow, onHide, onUnload } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import AppMarqueeText from "@/components/AppMarqueeText.vue";
import AppReportCharacterPopup from "@/components/AppReportCharacterPopup.vue";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import SvgIcon from "@/components/SvgIcon.vue";
import { requireAuth } from "@/composables/useAuth";
import { useStatusBar, HEADER_CONTENT_PX, safeTopCss } from "@/composables/useStatusBar";
import { useCreateCompanionEntry } from "@/composables/useCreateCompanionEntry";
import { previewMedia } from "@/utils/media";
import { getItem, setItem } from "@/utils/storage";
import { useChatStore } from "@/stores/chat";
import { useThemeStore } from "@/stores/theme";
import { useRelativeTime } from "@/composables/useRelativeTime";
import { likeIconSrc, commentIconSrc, likeActiveIconSrc } from "@/utils/themeIcons";
import { showToast } from "@/stores/toast";
import apiFetch, { unwrapApiResults } from "@/utils/api";
import { chooseAndUploadImages, isChooseImageCancel } from "@/utils/device";
import { getCachedCompanions, invalidateCompanionsCache } from "@/utils/companionsCache";
import { formatAffectionDisplay } from "@/utils/formatAffection";
import {
  formatCompanionMeta,
  formatCompanionName,
  uiLangCode,
} from "@/utils/formatCompanion";
import {
  findRegionByKey,
  regionLabel,
} from "@/data/createCompanion/regionCatalog";
import { bindAnalyticsTap } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import { createIdleTimer } from "@/utils/productAnalyticsHelpers";
import {
  fetchOurMoments,
  trackOurMomentsEntryClick,
  trackOurMomentsView,
  trackOurMomentsPreview,
} from "@/utils/ourMoments";

let companionId = "";
const { t, locale } = useI18n();
const chat = useChatStore();
const themeStore = useThemeStore();
const { format: formatRelativeTime } = useRelativeTime("home");
const likeIcon = computed(() => likeIconSrc(themeStore.isDark));
const commentIcon = computed(() => commentIconSrc(themeStore.isDark));
requireAuth();

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

const uiLang = computed(() => uiLangCode(locale.value));

// 顶部装饰底淡入（CSS 壳层，无 PNG）
const topBgLoaded = ref(false);
watch(
  () => themeStore.isDark,
  () => {
    topBgLoaded.value = false;
    nextTick(() => {
      topBgLoaded.value = true;
    });
  }
);

// ——— 加载资料 ———

/** 兼容 { profile, state } / { results: { profile } } / 扁平 profile */
function normalizeCompanionDetail(raw) {
  const data = unwrapApiResults(raw) ?? raw;
  if (!data || typeof data !== "object") return null;
  if (data.profile && typeof data.profile === "object") return data;
  if (data.results?.profile && typeof data.results.profile === "object") {
    return data.results;
  }
  // 个别接口直接回 profile 字段集
  if (data.id && (data.name != null || data.personality != null)) {
    return {
      profile: data,
      state: data.state || {},
      avatar: data.avatar || data.avatar_url || "",
      avatar_generating: data.avatar_generating === true,
    };
  }
  return data;
}

function findCachedCompanion(id) {
  const want = String(id || "");
  if (!want) return null;
  const lists = [
    getCachedCompanions() ?? [],
    getCachedCompanions({ special: "message" }) ?? [],
    getCachedCompanions({ special: "recommend" }) ?? [],
  ];
  for (const list of lists) {
    const hit = list.find((c) => String(c.profile?.id || c.id || "") === want);
    if (hit) return hit;
  }
  return null;
}

const companion = ref(null);
const moments = ref([]);
/** Our Moments 私密相册 */
const ourMoments = ref(null);
const ourMomentsLoading = ref(false);
const ourMomentsLoaded = ref(false);
const ourMomentsError = ref("");
/** 从朋友圈详情返回后重拉列表，同步点赞/评论数 */
let pendingMomentSync = false;
/** 详情页刚点过赞时，避免列表接口旧数据把高亮冲掉 */
const momentStatOverrides = new Map();
/** 统计区：GET /companions/:id/stats */
const statsTurns = ref(0);
const momentsCount = ref(0);
const daysTogether = ref(0);
const loading = ref(true);
const error = ref("");
const activeTab = ref("about");
const showMenu = ref(false);
const bgUploading = ref(false);
const showMorePersona = ref(false);
const outreachPref = ref(null); // null | "block" | "dislike"
const confirmOpen = ref(false);
const reportOpen = ref(false);

/** Profile / Moment idle≥15s（滚动不算操作；点击/切 Tab 等会重置） */
const profileIdle = createIdleTimer({
  label: "profile_displayed_15s",
  thresholdMs: 15000,
  onFire: () => {
    trackProductEvent(
      PRODUCT_EVENTS.PROFILE_DISPLAYED_15S,
      withCompanionId(
        { page: "companion", target_id: String(companionId || "") },
        companionId
      )
    );
  },
});
const momentIdle = createIdleTimer({
  label: "Moment_15s",
  thresholdMs: 15000,
  onFire: () => {
    trackProductEvent(
      PRODUCT_EVENTS.MOMENT_15S,
      withCompanionId(
        {
          page: "companion",
          tab: "moments",
          target_id: String(companionId || ""),
        },
        companionId
      )
    );
  },
});

function bumpProfileIdle(reason = "") {
  if (activeTab.value === "about") profileIdle.bump(reason);
  else if (activeTab.value === "moments") momentIdle.bump(reason);
  else if (activeTab.value === "ourMoments") profileIdle.bump(reason);
}

function startTabIdleTimers() {
  if (activeTab.value === "moments") {
    profileIdle.stop("switch_tab");
    momentIdle.start();
  } else {
    momentIdle.stop("switch_tab");
    profileIdle.start();
  }
}

/** 短暂 hide/show 续计，避免永远卡在 0~1s */
function resumeTabIdleTimers() {
  if (activeTab.value === "moments") {
    profileIdle.stop("switch_tab");
    momentIdle.resume();
  } else {
    momentIdle.stop("switch_tab");
    profileIdle.resume();
  }
}

function pauseAllIdleTimers() {
  profileIdle.pause();
  momentIdle.pause();
}

function stopAllIdleTimers(reason = "") {
  profileIdle.stop(reason);
  momentIdle.stop(reason);
}
const confirmTitle = ref("");
const confirmDesc = ref("");
const confirmDestructive = ref(false);
const momentsAnchorId = "companion-moments-section";
const ourMomentsAnchorId = "companion-our-moments-section";
let confirmAction = null;
/** 创建跳转而来：头像可能仍在 AI 生成中 */
let preferAwaitAvatar = false;
let avatarPollTimer = null;

onLoad((q) => {
  companionId = String(q?.id || "");
  preferAwaitAvatar = q?.awaitAvatar === "1" || q?.awaitAvatar === "true";
  const tab = String(q?.tab || "").trim();
  if (tab === "ourMoments" || tab === "our-moments") {
    activeTab.value = "ourMoments";
  }
  const cached = findCachedCompanion(companionId);
  if (cached) {
    companion.value = cached;
    loading.value = false;
  }
});

async function refreshCompanionProfile() {
  if (!companionId) return;
  try {
    const raw = await apiFetch(`/companions/${companionId}`);
    const data = normalizeCompanionDetail(raw);
    if (data) companion.value = data;
  } catch {
    if (!companion.value) {
      error.value = t("companionProfile.loadingError");
    }
  } finally {
    loading.value = false;
  }
}

function onCompanionUpdated(payload) {
  if (String(payload?.id || "") !== String(companionId)) return;
  if (payload?.data) {
    companion.value = payload.data;
    loading.value = false;
    return;
  }
  if (payload?.personality != null && companion.value?.profile) {
    companion.value = {
      ...companion.value,
      profile: { ...companion.value.profile, personality: payload.personality },
    };
  }
}

function onMomentStatsUpdated(payload) {
  if (!payload?.id) return;
  momentStatOverrides.set(String(payload.id), {
    liked: payload.liked,
    likes_count: payload.likes_count,
    comments_count: payload.comments_count,
    exp: Date.now() + 8000,
  });
  moments.value = moments.value.map((m) => {
    if (String(m.id) !== String(payload.id)) return m;
    const likes = payload.likes_count ?? m.likes_count;
    return {
      ...m,
      likes_count: likes,
      comments_count: payload.comments_count ?? m.comments_count,
      liked: isMomentLiked({
        ...m,
        liked: payload.liked,
        likes_count: likes,
      }),
    };
  });
}

uni.$on("companion-updated", onCompanionUpdated);
uni.$on("moment-stats-updated", onMomentStatsUpdated);

/** 从编辑页 / 朋友圈详情返回时页面仍在栈里，onLoad/onMounted 不会再跑 */
const pageBehind = ref(false);
onShow(() => {
  pageBehind.value = false;
  if (!companionId) return;
  void refreshCompanionProfile();
  if (pendingMomentSync) {
    pendingMomentSync = false;
    void loadMoments().catch(() => {});
  }
  // 从聊天返回后进度可能已变，私密相册 Tab 可见时重拉
  if (activeTab.value === "ourMoments") {
    void loadOurMoments({ trackView: false });
  }
  resumeTabIdleTimers();
});

onHide(() => {
  pauseAllIdleTimers();
});

function isAvatarGenerating(data) {
  if (!data) return false;
  const avatar = String(data.avatar || data.profile?.avatar_url || "");
  return (
    data.avatar_generating === true ||
    avatar.includes("__GENERATING__") ||
    !avatar
  );
}

/** AI 生图完成前占位；完成后替换头像并刷缓存 */
async function pollAvatarUntilReady({ times = 36, intervalMs = 2500 } = {}) {
  if (!companionId) return;
  if (avatarPollTimer) {
    clearTimeout(avatarPollTimer);
    avatarPollTimer = null;
  }
  for (let i = 0; i < times; i++) {
    if (!isAvatarGenerating(companion.value) && companion.value?.avatar) {
      return;
    }
    await new Promise((r) => {
      avatarPollTimer = setTimeout(r, intervalMs);
    });
    try {
      const data = await apiFetch(`/companions/${companionId}`);
      const normalized = normalizeCompanionDetail(data);
      if (normalized) {
        companion.value = normalized;
        if (!isAvatarGenerating(normalized) && normalized.avatar) {
          invalidateCompanionsCache();
          return;
        }
      }
    } catch {
      /* ignore */
    }
  }
}
// 顶栏透明/实色：停在顶部时透出光晕；下滑后铺主题底色挡住滚过的内容
const headerSolid = ref(false);
function onCompanionScroll(e) {
  headerSolid.value = Number(e?.detail?.scrollTop || 0) > 72;
}

const showProfileBody = computed(
  () => loading.value || (!error.value && !!companion.value)
);

function openConfirm(title, desc, action, destructive = false) {
  confirmTitle.value = title;
  confirmDesc.value = desc;
  confirmAction = action;
  confirmDestructive.value = destructive;
  confirmOpen.value = true;
}

// ——— 创建者操作 ———

function getCreatorKeys() {
  const keys = [];
  try {
    const raw = getItem("user_info");
    if (raw) {
      const u = JSON.parse(raw);
      if (u.id != null) keys.push(String(u.id));
      if (u.user_id != null) keys.push(String(u.user_id));
      if (u.nickname) keys.push(String(u.nickname).trim());
      if (u.username) keys.push(String(u.username).trim());
      if (u.name) keys.push(String(u.name).trim());
    }
  } catch { /* ignore */ }
  const did = getItem("device_id");
  if (did) keys.push(did);
  return [...new Set(keys.filter(Boolean))];
}

/** 兼容 created_by 为字符串或 { id, name } */
function resolveCreatedBy(raw) {
  if (raw == null || raw === "") {
    return { id: "", name: "" };
  }
  if (typeof raw === "object") {
    return {
      id: String(raw.id ?? raw.user_id ?? "").trim(),
      name: String(raw.name ?? raw.nickname ?? raw.username ?? "").trim(),
    };
  }
  return { id: String(raw).trim(), name: String(raw).trim() };
}

const isCreator = () => {
  const { id, name } = resolveCreatedBy(companion.value?.profile?.created_by);
  if (!id && !name) return false;
  const keys = getCreatorKeys();
  const candidates = [id, name].filter(Boolean);
  if (candidates.some((c) => keys.includes(c))) return true;
  // 兼容数字 id 与字符串 id
  return keys.some((k) =>
    candidates.some((c) => String(k) === String(c) || Number(k) === Number(c))
  );
};

async function loadCompanionStats() {
  if (!companionId) return;
  try {
    const body = await apiFetch(`/companions/${companionId}/stats`);
    const stats = unwrapApiResults(body) || {};
    statsTurns.value = Number(stats.turns) || 0;
    momentsCount.value = Number(stats.moments_count) || 0;
    daysTogether.value = Number(stats.days_together) || 0;
  } catch {
    /* 统计失败时保留旧值 / 默认 0 */
  }
}

function isMomentLiked(m) {
  if (Number(m?.likes_count || 0) <= 0) return false;
  const v = m?.liked ?? m?.is_liked;
  return v === true || v === 1 || v === "1" || v === "true";
}

function pickMomentsList(body) {
  const data = unwrapApiResults(body) ?? body;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.moments)) return data.moments;
  if (Array.isArray(data?.moment)) return data.moment;
  return [];
}

function momentImageList(m) {
  const raw = m?.images || m?.image_urls || [];
  const urls = (Array.isArray(raw) ? raw : [])
    .map((item) => (typeof item === "string" ? item : item?.url || item?.image_url || ""))
    .filter(Boolean);
  if (!urls.length && m?.image_url) urls.push(m.image_url);
  return urls.slice(0, 2);
}

function momentCategory(m) {
  return String(m?.category || m?.tag || m?.topic || "").trim();
}

function mapMoments(list) {
  return (list || []).map((m) => {
    const likes = Number(m?.likes_count || 0);
    const comments = Number(
      m?.comments_count ?? (Array.isArray(m?.comments) ? m.comments.length : 0)
    );
    const base = {
      ...m,
      likes_count: likes,
      comments_count: comments,
      liked: isMomentLiked({ ...m, likes_count: likes }),
    };
    const ov = momentStatOverrides.get(String(m.id));
    if (!ov || ov.exp <= Date.now()) return base;
    const nextLikes = ov.likes_count ?? base.likes_count;
    return {
      ...base,
      likes_count: nextLikes,
      comments_count: ov.comments_count ?? base.comments_count,
      liked: isMomentLiked({
        ...base,
        liked: ov.liked,
        likes_count: nextLikes,
      }),
    };
  });
}

async function loadMoments() {
  if (!companionId) return;
  const mData = await apiFetch(`/api/companions/${companionId}/moments`);
  moments.value = mapMoments(pickMomentsList(mData));
}

async function loadOurMoments({ trackView = false } = {}) {
  if (!companionId) return;
  ourMomentsLoading.value = true;
  ourMomentsError.value = "";
  try {
    const data = await fetchOurMoments(companionId);
    ourMoments.value = data && typeof data === "object" ? data : null;
    ourMomentsLoaded.value = true;
    if (trackView) {
      trackOurMomentsView(
        companionId,
        Number(data?.photo_count) ||
          (Array.isArray(data?.photos) ? data.photos.length : 0)
      );
    }
  } catch (e) {
    ourMomentsError.value =
      e?.detail || e?.message || t("companionProfile.loadingError");
    if (!ourMoments.value) ourMoments.value = null;
  } finally {
    ourMomentsLoading.value = false;
  }
}

const ourMomentsPhotos = computed(() => {
  const list = ourMoments.value?.photos;
  return Array.isArray(list) ? list : [];
});

const ourMomentsIsEmpty = computed(() => {
  if (!ourMoments.value) return false;
  if (ourMoments.value.empty === true) return true;
  return ourMomentsPhotos.value.length === 0;
});

const ourMomentsEmptyHint = computed(() =>
  t("companionProfile.ourMomentsEmpty")
);

/** 锁定态封面图：后端仍会下发图地址，前端模糊展示 */
function photoCoverUrl(photo) {
  if (!photo || typeof photo !== "object") return "";
  return String(
    photo.image_url ||
      photo.preview_url ||
      photo.cover_url ||
      photo.blur_url ||
      photo.thumbnail_url ||
      ""
  ).trim();
}

/**
 * 锁定卡片「还差几条」：优先用每张图后端下发的 remaining_messages，
 * 没有再回退相册级 remaining_messages。
 */
function photoRemainingMessages(photo) {
  if (!photo || photo.unlocked) return null;
  const fromPhoto = Number(
    photo.remaining_messages ?? photo.remainingMessages ?? photo.remaining
  );
  if (Number.isFinite(fromPhoto) && fromPhoto >= 0) return fromPhoto;
  const fromAlbum = Number(ourMoments.value?.remaining_messages);
  if (Number.isFinite(fromAlbum) && fromAlbum >= 0) return fromAlbum;
  return null;
}

/** 解锁文案拆成「数字加粗 + 前后文」 */
function ourMomentsUnlockHintParts(photo) {
  const n = photoRemainingMessages(photo);
  if (n == null) return null;
  const raw = String(t("companionProfile.ourMomentsUnlockHint", { n }) || "");
  const marked = raw.replace(/\{n\}/g, "\u0001");
  const [before = "", after = ""] = marked.split("\u0001");
  return { n: String(n), before, after };
}

function previewOurMomentPhoto(photo) {
  if (!photo?.unlocked || !photo?.image_url) return;
  const urls = ourMomentsPhotos.value
    .filter((p) => p?.unlocked && p?.image_url)
    .map((p) => p.image_url);
  previewMedia(urls, photo.image_url);
  trackOurMomentsPreview(
    companionId,
    photo.photo_id,
    Number(ourMoments.value?.photo_count) || ourMomentsPhotos.value.length
  );
}

onMounted(async () => {
  topBgLoaded.value = true;
  try {
    await loadCompanionStats();
    await loadMoments();
    if (activeTab.value === "ourMoments") {
      void loadOurMoments({ trackView: true });
    }
    try {
      const pref = await apiFetch(
        `/companions/${companionId}/outreach-preference`
      );
      outreachPref.value = pref?.action || null;
    } catch {
      outreachPref.value = null;
    }
    if (preferAwaitAvatar || isAvatarGenerating(companion.value)) {
      void pollAvatarUntilReady();
    }
  } catch {
    if (!companion.value) {
      error.value = t("companionProfile.loadingError");
    }
  } finally {
    loading.value = false;
  }
});

onUnload(() => {
  stopAllIdleTimers("page_unload");
  uni.$off("companion-updated", onCompanionUpdated);
  uni.$off("moment-stats-updated", onMomentStatsUpdated);
  if (avatarPollTimer) {
    clearTimeout(avatarPollTimer);
    avatarPollTimer = null;
  }
});

function openChat() {
  bumpProfileIdle("open_chat");
  trackProductEvent(
    PRODUCT_EVENTS.SEND_MESSAGE_ICON_CLICK,
    withCompanionId(
      {
        page: "companion",
        source: "profile",
        target_id: String(companionId || ""),
      },
      companionId
    )
  );
  uni.navigateTo({ url: `/pages/chat/index?id=${companionId}` });
}

function previewAvatar() {
  const src = companion.value?.avatar;
  if (!src || companion.value?.avatar_generating) return;
  previewMedia(src);
}

function previewMomentImage(url) {
  if (!url) return;
  previewMedia(url);
}

function editCompanion() {
  showMenu.value = false;
  if (!companionId) return;
  uni.navigateTo({ url: `/pages-sub/create/index?edit=1&id=${companionId}` });
}

function profileBackgrounds() {
  const raw = companion.value?.profile?.profile_backgrounds;
  if (!Array.isArray(raw)) return [];
  return raw.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 3);
}

async function saveProfileBackgrounds(urls) {
  const list = Array.isArray(urls)
    ? urls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  const raw = await apiFetch(`/companions/${companionId}`, {
    method: "PUT",
    data: { profile_backgrounds: list },
  });
  const normalized = normalizeCompanionDetail(raw);
  if (normalized) {
    companion.value = normalized;
  } else if (companion.value?.profile) {
    companion.value = {
      ...companion.value,
      profile: {
        ...companion.value.profile,
        profile_backgrounds: list,
      },
    };
  }
  showToast(t("common.success"));
}

async function pickAndSaveBackgrounds() {
  if (!companionId || bgUploading.value) return;
  bgUploading.value = true;
  try {
    uni.showLoading({ title: t("common.loading"), mask: true });
    const urls = await chooseAndUploadImages(3, 0);
    if (!urls.length) return;
    await saveProfileBackgrounds(urls);
  } catch (e) {
    if (isChooseImageCancel(e)) return;
    showToast(e?.message || t("companionProfile.backgroundSaveFailed"));
  } finally {
    try {
      uni.hideLoading();
    } catch {
      /* ignore */
    }
    bgUploading.value = false;
  }
}

function editProfileBackgrounds() {
  if (!isCreator() || !companionId || bgUploading.value) return;
  showMenu.value = false;
  bumpProfileIdle("bg");
  const existing = profileBackgrounds();
  if (!existing.length) {
    void pickAndSaveBackgrounds();
    return;
  }
  uni.showActionSheet({
    itemList: [
      t("companionProfile.changeBackgrounds"),
      t("companionProfile.clearBackgrounds"),
    ],
    success: (res) => {
      if (res.tapIndex === 0) void pickAndSaveBackgrounds();
      else if (res.tapIndex === 1) {
        void (async () => {
          if (bgUploading.value) return;
          bgUploading.value = true;
          try {
            uni.showLoading({ title: t("common.loading"), mask: true });
            await saveProfileBackgrounds([]);
          } catch (e) {
            showToast(e?.message || t("companionProfile.backgroundSaveFailed"));
          } finally {
            try {
              uni.hideLoading();
            } catch {
              /* ignore */
            }
            bgUploading.value = false;
          }
        })();
      }
    },
  });
}

function cloneCompanion() {
  if (!companion.value) return;
  showMenu.value = false;
  const p = companion.value.profile;
  setItem("clone_companion_data", JSON.stringify({
    name: p.name,
    age: p.age,
    gender: p.gender === "男" ? "male" : "female",
    city: p.city,
    personality: p.personality,
    appearance: p.appearance,
    background: p.background,
    speech_style: p.speech_style,
    personality_details: p.personality_details || "",
    hobbies: p.hobbies,
    values: p.values,
    fears: p.fears,
    love_view: p.love_view,
    daily_routine: p.daily_routine,
    favorite_things: p.favorite_things,
    mbti: p.mbti,
    sexual_orientation: p.sexual_orientation,
    life_story: p.life_story || "",
    cultural_values: p.cultural_values || "",
    gender_perspective: p.gender_perspective || "",
    description: p.description || "",
    country: p.country || "",
    region_key: p.region_key || "",
    region_label: p.region_label || "",
    persona_axes: p.persona_axes || "",
  }));
  void enterCreateCompanion({
    page: "companion",
    source: "clone",
    url: "/pages-sub/create/index?clone=1",
  });
}

function clearMessages() {
  showMenu.value = false;
  openConfirm(
    t("chat.clearMessages"),
    t("chat.confirmClearMessages"),
    async () => {
      try {
        await apiFetch(`/companions/${companionId}/clear-messages`, { method: "POST" });
        chat.clearMessages(companionId);
        if (companion.value?.state) companion.value.state.affection = 0;
        void loadCompanionStats();
        showToast(t("chat.clearSuccess"));
      } catch {
        showToast(t("chat.clearFailed"));
      }
    },
    true
  );
}

function deleteCompanion() {
  showMenu.value = false;
  openConfirm(
    t("companionProfile.deleteCompanion"),
    t("companionProfile.deleteConfirm"),
    async () => {
      try {
        await apiFetch(`/companions/${companionId}`, { method: "DELETE" });
        invalidateCompanionsCache();
        chat.clearCompanionMeta?.(companionId);
        chat.clearMessages?.(companionId);
        uni.reLaunch({ url: "/pages/messages/index" });
      } catch {
        showToast(t("companionProfile.deleteFailed"));
      }
    },
    true
  );
}

async function setOutreachPreference(action) {
  showMenu.value = false;
  const run = async () => {
    try {
      const res = await apiFetch(
        `/companions/${companionId}/outreach-preference`,
        {
          method: "POST",
          data: { action },
        }
      );
      outreachPref.value = res?.current ?? (action === "clear" ? null : action);
      showToast(
        action === "clear"
          ? t("companionProfile.outreachCleared")
          : action === "block"
            ? t("companionProfile.outreachBlocked")
            : t("companionProfile.outreachDisliked")
      );
    } catch {
      showToast(t("companionProfile.outreachFailed"));
    }
  };
  if (action === "block") {
    openConfirm(
      t("companionProfile.blockOutreach"),
      t("companionProfile.blockOutreachConfirm"),
      run,
      true
    );
    return;
  }
  await run();
}

let openingMoment = false;

function openMoment(id) {
  if (!id || openingMoment) return;
  const pages = getCurrentPages();
  const route = String(pages[pages.length - 1]?.route || "");
  // 详情已在栈顶时不再推一层（H5 点穿会重复打开同一条）
  if (route.endsWith("moment/index")) return;
  openingMoment = true;
  bumpProfileIdle("open_moment");
  trackProductEvent(
    PRODUCT_EVENTS.MOMENTS_DETAIL_CLICK,
    withCompanionId(
      { page: "companion", target_id: String(id) },
      companionId
    )
  );
  pendingMomentSync = true;
  uni.navigateTo({
    url: `/pages-sub/moment/index?id=${id}`,
    success: () => {
      pageBehind.value = true;
    },
    complete: () => {
      setTimeout(() => {
        openingMoment = false;
      }, 300);
    },
  });
}

function toggleMenu() {
  bumpProfileIdle("menu");
  showMenu.value = !showMenu.value;
}

function openReportCharacter() {
  showMenu.value = false;
  if (!companionId || isCreator()) return;
  reportOpen.value = true;
}

function setAboutTab() {
  if (activeTab.value !== "about") {
    activeTab.value = "about";
    startTabIdleTimers();
  } else {
    bumpProfileIdle("tab_about");
  }
}

function setMomentsTab() {
  if (activeTab.value !== "moments") {
    activeTab.value = "moments";
    startTabIdleTimers();
  } else {
    bumpProfileIdle("tab_moments");
  }
  // 切到动态后滚到内容区，避免「点了没变化」的体感
  setTimeout(() => {
    uni.pageScrollTo({
      selector: `#${momentsAnchorId}`,
      duration: 240,
    });
  }, 50);
}

function setOurMomentsTab() {
  trackOurMomentsEntryClick(companionId);
  const switching = activeTab.value !== "ourMoments";
  if (switching) {
    activeTab.value = "ourMoments";
    startTabIdleTimers();
  } else {
    bumpProfileIdle("tab_our_moments");
  }
  if (ourMomentsLoaded.value) {
    trackOurMomentsView(
      companionId,
      Number(ourMoments.value?.photo_count) || ourMomentsPhotos.value.length
    );
    void loadOurMoments({ trackView: false });
  } else {
    void loadOurMoments({ trackView: true });
  }
  setTimeout(() => {
    uni.pageScrollTo({
      selector: `#${ourMomentsAnchorId}`,
      duration: 240,
    });
  }, 50);
}

const profile = () => {
  const c = companion.value;
  if (!c || typeof c !== "object") return {};
  if (c.profile && typeof c.profile === "object") return c.profile;
  if (c.results?.profile && typeof c.results.profile === "object") {
    return c.results.profile;
  }
  return {};
};

function profileText(...keys) {
  const p = profile();
  for (const key of keys) {
    const v = p?.[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

const state = () => {
  const c = companion.value;
  if (c?.state && typeof c.state === "object") return c.state;
  if (c?.results?.state && typeof c.results.state === "object") {
    return c.results.state;
  }
  return {};
};
const personalities = () =>
  String(profile().personality || "")
    .split(/[、,，|/]/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 18 && !/[.。!！?？]/.test(s));

const displayName = computed(() =>
  formatCompanionName(profile().name, t("home.defaultCompanionName"))
);
const isCompanionDeleted = computed(() => {
  const p = profile();
  const c = companion.value || {};
  return (
    p.is_deleted === true ||
    p.is_deleted === 1 ||
    c.is_deleted === true ||
    c.is_deleted === 1
  );
});
const displayMeta = computed(() => {
  const meta = formatCompanionMeta(profile(), t);
  const mood = state().mood;
  if (mood) {
    return meta ? `${meta} · ${mood}` : mood;
  }
  return meta;
});

function sexualOrientationLabel(value) {
  if (!value) return "";
  const key = `companionProfile.sexualOrientation.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

function formatMeetDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 国家/地区展示：优先 region_label，其次目录本地化，最后才用 country 明文 */
function countryDisplay(p) {
  const label = String(p?.region_label || "").trim();
  if (label) return label;
  const reg = p?.region_key ? findRegionByKey(p.region_key) : null;
  if (reg) return regionLabel(reg, uiLang.value);
  const country = String(p?.country || "").trim();
  // 过滤 CN/US 这类机器码
  if (country && country.length > 2) return country;
  return "";
}

const aboutCards = computed(() => {
  const p = profile();
  const core = [
    { key: "description", title: t("companionProfile.description"), content: p.description },
    { key: "appearance", title: t("companionProfile.appearance"), content: p.appearance },
    { key: "background", title: t("companionProfile.background"), content: p.background },
    { key: "speech", title: t("companionProfile.speechStyle"), content: p.speech_style },
    { key: "mbti", title: t("companionProfile.mbti"), content: p.mbti },
    {
      key: "orientation",
      title: t("companionProfile.sexualOrientationLabel"),
      content: sexualOrientationLabel(p.sexual_orientation),
    },
    { key: "city", title: t("companionProfile.city"), content: p.city },
    { key: "country", title: t("companionProfile.country"), content: countryDisplay(p) },
    {
      key: "creator",
      title: t("companionProfile.creator"),
      content: resolveCreatedBy(p.created_by).name || resolveCreatedBy(p.created_by).id,
    },
  ].filter((c) => Boolean(c.content));

  const deep = [
    {
      key: "personality_details",
      title: t("createCompanion.personalityDetails"),
      content: profileText("personality_details", "personalityDetails"),
    },
    { key: "hobbies", title: t("companionProfile.hobbies"), content: profileText("hobbies") },
    { key: "values", title: t("companionProfile.values"), content: profileText("values") },
    { key: "fears", title: t("companionProfile.fears"), content: profileText("fears") },
    { key: "love", title: t("companionProfile.loveView"), content: profileText("love_view", "loveView") },
    {
      key: "routine",
      title: t("companionProfile.dailyRoutine"),
      content: profileText("daily_routine", "dailyRoutine"),
    },
    {
      key: "favorites",
      title: t("companionProfile.favoriteThings"),
      content: profileText("favorite_things", "favoriteThings"),
    },
    {
      key: "life_story",
      title: t("createCompanion.lifeStory"),
      content: profileText("life_story", "lifeStory"),
    },
    {
      key: "cultural_values",
      title: t("createCompanion.culturalValues"),
      content: profileText("cultural_values", "culturalValues"),
    },
    {
      key: "gender_perspective",
      title: t("createCompanion.genderPerspective"),
      content: profileText("gender_perspective", "genderPerspective"),
    },
  ].filter((c) => Boolean(c.content));

  return { core, deep };
});

const safe = useStatusBar();

// 顶部背景：scroll-view 铺到屏幕顶，光晕从 y=0 画起，人物仍从标题栏下开始
const headerLift = computed(
  () => `calc(${safeTopCss(safe.value.safeAreaTop)} + ${HEADER_CONTENT_PX}px)`
);
const topBgStyle = computed(() => ({
  top: "0px",
  height: `calc(${headerLift.value} + 520rpx)`,
}));
const heroClipStyle = computed(() => ({
  top: headerLift.value,
}));

// 固定底栏：JS 读安全区（App 端 env() 可能取不到），无安全区时也垫 16px 兜底
const bottomBarStyle = computed(() => ({
  paddingBottom: `${Math.max(safe.value.safeAreaBottom, 16) + 8}px`,
}));
</script>

<template>
  <AppPageShell
    :show-back="true"
    header-right
    fill-webview
    vest-backdrop
    title-align="start"
    :title="headerSolid ? displayName : ''"
    :transparent-header="true"
    :class="{ 'is-page-behind': pageBehind }"
    back-analytics-id="companion-profile-back"
    back-analytics-name="伴侣详情页返回"
  >
    <!-- 顶栏右侧：笔=背景图（仅创建者） / 三条杠=菜单 -->
    <template #header-right>
      <view class="header-actions">
        <view
          v-if="isCreator()"
          class="edit-btn"
          @tap.stop="bindAnalyticsTap('companion-profile-bg', editProfileBackgrounds, '资料背景')"
        >
          <image class="edit-icon icon-on-fg" src="/static/companion/icon_edit.svg" mode="aspectFit" />
        </view>
        <view class="edit-btn" @tap.stop="bindAnalyticsTap('companion-profile-menu', toggleMenu, '伴侣菜单')">
          <image class="edit-icon icon-on-fg" src="/static/companion/icon_menu.svg" mode="aspectFit" />
        </view>
      </view>
    </template>

    <scroll-view
      scroll-y
      class="page-scroll"
      :enhanced="true"
      :bounces="false"
      @scroll="onCompanionScroll"
    >
    <view v-if="!showProfileBody" class="center text-muted">
      {{ error || t("companionProfile.notFound") }}
    </view>

    <view v-else class="page-content px-md">
      <!-- 顶部装饰底：有资料背景图则展示，否则 CSS 光晕 -->
      <view
        v-if="!profileBackgrounds().length"
        class="top-bg shell-header-glow"
        :class="[
          themeStore.isDark ? 'shell-header-glow--dark' : 'shell-header-glow--light',
          { loaded: topBgLoaded },
        ]"
        :style="topBgStyle"
      />
      <swiper
        v-else
        class="top-bg top-bg-photos"
        :class="{ loaded: topBgLoaded }"
        :style="topBgStyle"
        :circular="profileBackgrounds().length > 1"
        :autoplay="profileBackgrounds().length > 1"
        :interval="4000"
        :indicator-dots="profileBackgrounds().length > 1"
        indicator-color="rgba(255,255,255,0.35)"
        indicator-active-color="#fff"
      >
        <swiper-item v-for="(url, idx) in profileBackgrounds()" :key="`${url}-${idx}`">
          <image class="top-bg-photo" :src="url" mode="aspectFill" />
        </swiper-item>
      </swiper>
      <!-- 背景图底部渐隐，过渡到页面背景色 -->
      <view class="top-bg-fade" :class="{ loaded: topBgLoaded }" :style="topBgStyle" />
      <!-- 顶部人物图：在资料卡后方，露出高度 70%（下 30% 被裁在卡顶以下） -->
      <view v-if="!profileBackgrounds().length" class="top-hero-clip" :style="heroClipStyle">
        <image class="top-hero" src="/static/companion/icon_heise.webp" mode="aspectFit" />
      </view>

      <!-- 主内容抬高层级，避免被顶图 z-index:0 盖住 -->
      <view class="page-main">
      <!-- 骨架 -->
      <view v-if="loading && !companion" class="profile-card mt-lg">
        <view class="avatar-holder">
          <view class="hero-avatar-skeleton skeleton" />
        </view>
        <view class="skeleton hero-name-skeleton" />
        <view class="skeleton hero-meta-skeleton" />
      </view>

      <!-- 资料卡 -->
      <view v-else class="profile-card mt-lg">
        <view class="avatar-holder" @tap="previewAvatar">
          <AppAvatarImage size="lg" :src="companion.avatar" :seed="companionId" :generating="companion.avatar_generating" />
        </view>
        <view class="affection-pill">
          <SvgIcon name="icon_sel" size="32rpx" />
          <text>{{ formatAffectionDisplay(state().affection) }}</text>
        </view>
        <view class="identity-block">
          <view class="name-line">
            <AppMarqueeText class="hero-name" :text="displayName" :threshold="8" />
            <text v-if="isCompanionDeleted" class="deleted-chip">{{ t("common.deleted") }}</text>
            <text v-if="profile().mbti" class="mbti-chip">{{ profile().mbti }}</text>
            <text v-if="profile().sexual_orientation" class="orientation-chip">
              {{ sexualOrientationLabel(profile().sexual_orientation) }}
            </text>
          </view>
          <text class="hero-meta">{{ displayMeta }}</text>
        </view>
        <view v-if="personalities().length" class="dashed-divider" />
        <view v-if="personalities().length" class="tags-row">
          <text v-for="p in personalities()" :key="p" class="tag">{{ p }}</text>
        </view>
      </view>

      <!-- 数据统计（可点切换） -->
      <view class="stats-card flex-row mt-md">
        <view class="stat" @tap="bindAnalyticsTap('companion-profile-stat-chat', openChat, '对话轮数')">
          <text v-if="loading && !companion" class="num skeleton stat-skeleton" />
          <text v-else class="num">{{ statsTurns }}</text>
          <text class="stat-label text-muted">{{ t("companionProfile.chatTurns") }}</text>
        </view>
        <view class="stat" @tap="bindAnalyticsTap('companion-profile-stat-moments', setMomentsTab, '朋友圈数')">
          <text v-if="loading && !companion" class="num skeleton stat-skeleton" />
          <text v-else class="num">{{ momentsCount }}</text>
          <text class="stat-label text-muted">{{ t("companionProfile.moments") }}</text>
        </view>
        <view class="stat" @tap="bindAnalyticsTap('companion-profile-stat-days', setAboutTab, '陪伴天数')">
          <text v-if="loading && !companion" class="num skeleton stat-skeleton" />
          <text v-else class="num">{{ daysTogether }}</text>
          <text class="stat-label text-muted">{{ t("companionProfile.daysTogether") }}</text>
        </view>
      </view>

      <!-- Tabs -->
      <view class="tabs flex-row mt-md">
        <text :class="{ active: activeTab === 'about' }" @tap="bindAnalyticsTap('companion-profile-tab-about', setAboutTab, '关于 Tab')">{{ t("companionProfile.about") }}</text>
        <text :class="{ active: activeTab === 'moments' }" @tap="bindAnalyticsTap('companion-profile-tab-moments', setMomentsTab, '动态 Tab')">{{ t("companionProfile.momentsTab") }}</text>
        <text :class="{ active: activeTab === 'ourMoments' }" @tap="bindAnalyticsTap('companion-profile-tab-our-moments', setOurMomentsTab, '私密相册 Tab')">{{ t("companionProfile.ourMomentsTab") }}</text>
      </view>

      <AppListSkeleton v-if="loading && !companion" :rows="3" class="mt-md" />

      <!-- About Tab -->
      <view v-else-if="activeTab === 'about'" class="about-list">
        <view v-for="card in aboutCards.core" :key="card.key" class="info-card">
          <text class="info-title">{{ card.title }}</text>
          <text v-if="card.key === 'mbti'" class="mbti-chip info-chip">{{ card.content }}</text>
          <view v-else class="info-content">{{ card.content }}</view>
        </view>
        <view v-if="aboutCards.deep.length" class="more-persona">
          <view class="more-persona-toggle" @tap="showMorePersona = !showMorePersona">
            <text>{{ t("companionProfile.morePersona") }}</text>
            <text class="more-persona-arrow">{{ showMorePersona ? "▴" : "▾" }}</text>
          </view>
          <template v-if="showMorePersona">
            <view v-for="card in aboutCards.deep" :key="card.key" class="info-card">
              <text class="info-title">{{ card.title }}</text>
              <view class="info-content">{{ card.content }}</view>
            </view>
          </template>
        </view>
        <view v-if="profile().created_at" class="info-card">
          <text class="info-title">{{ t("companionProfile.meetTime") }}</text>
          <view class="info-content">{{ formatMeetDate(profile().created_at) }}</view>
        </view>
      </view>

      <!-- Moments Tab（马甲精简卡片） -->
      <view v-else-if="activeTab === 'moments'" :id="momentsAnchorId" class="moments-list">
        <view v-if="!moments.length" class="center text-muted py-lg">{{ t("companionProfile.noMoments") }}</view>
        <view
          v-for="m in moments"
          :key="m.id"
          class="kaya-moment"
          @tap="openMoment(m.id)"
        >
          <view
            v-if="momentImageList(m).length"
            class="kaya-moment-imgs"
            :class="momentImageList(m).length > 1 ? 'is-double' : 'is-single'"
          >
            <image
              v-for="(src, idx) in momentImageList(m)"
              :key="`${m.id}-${idx}`"
              class="kaya-moment-img"
              :src="src"
              mode="aspectFill"
              @tap.stop="previewMomentImage(src)"
            />
          </view>
          <view class="kaya-moment-author">
            <AppAvatarImage
              :src="companion.avatar"
              :seed="companionId"
              :generating="companion.avatar_generating"
            />
            <text class="kaya-moment-name">{{ displayName }}</text>
            <text class="kaya-moment-time">{{ formatRelativeTime(m.created_at) }}</text>
          </view>
          <text v-if="m.caption" class="kaya-moment-caption">{{ m.caption }}</text>
          <view class="kaya-moment-foot">
            <text v-if="momentCategory(m)" class="kaya-moment-cat">{{ momentCategory(m) }}</text>
            <view v-else class="kaya-moment-cat-spacer" />
            <view class="kaya-moment-actions">
              <view class="kaya-moment-action">
                <image
                  class="kaya-moment-action-ico"
                  :src="m.liked ? likeActiveIconSrc() : likeIcon"
                  mode="aspectFit"
                />
                <text class="kaya-moment-action-num">{{ m.likes_count || 0 }}</text>
              </view>
              <view class="kaya-moment-action">
                <image
                  class="kaya-moment-action-ico"
                  :src="commentIcon"
                  mode="aspectFit"
                />
                <text class="kaya-moment-action-num">{{ m.comments_count || 0 }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Our Moments 私密相册 -->
      <view
        v-else-if="activeTab === 'ourMoments'"
        :id="ourMomentsAnchorId"
        class="our-moments-panel"
        :class="themeStore.isDark ? 'theme-dark' : 'theme-light'"
      >
        <view v-if="ourMomentsLoading && !ourMomentsLoaded" class="center text-muted py-lg">
          {{ t("common.loading") }}
        </view>
        <view v-else-if="ourMomentsError && !ourMoments" class="center text-muted py-lg">
          {{ ourMomentsError }}
        </view>
        <template v-else>
          <view v-if="ourMomentsIsEmpty" class="our-moments-list">
            <view class="our-moments-card">
              <view class="our-moments-card-inner">
                <view class="our-moments-empty-inner">
                  <text class="our-moments-empty-text">{{ ourMomentsEmptyHint }}</text>
                </view>
              </view>
            </view>
          </view>
          <view v-else class="our-moments-list">
            <view
              v-for="photo in ourMomentsPhotos"
              :key="photo.photo_id"
              class="our-moments-card"
              @tap="previewOurMomentPhoto(photo)"
            >
              <view class="our-moments-card-inner">
                <image
                  v-if="photo.unlocked && photoCoverUrl(photo)"
                  class="our-moments-img"
                  :src="photoCoverUrl(photo)"
                  mode="aspectFill"
                />
                <view
                  v-else
                  class="our-moments-locked"
                  :class="{ 'has-cover': !!photoCoverUrl(photo) }"
                >
                  <image
                    v-if="photoCoverUrl(photo)"
                    class="our-moments-locked-bg"
                    :src="photoCoverUrl(photo)"
                    mode="aspectFill"
                  />
                  <view class="our-moments-locked-mask" />
                  <image
                    class="our-moments-lock-badge"
                    src="/static/companion/our-moments-lock.svg"
                    mode="aspectFit"
                  />
                  <view
                    v-if="ourMomentsUnlockHintParts(photo)"
                    class="our-moments-lock-hint"
                  >
                    <text class="our-moments-lock-hint-text">{{
                      ourMomentsUnlockHintParts(photo).before
                    }}</text>
                    <text class="our-moments-lock-hint-n">{{
                      ourMomentsUnlockHintParts(photo).n
                    }}</text>
                    <text class="our-moments-lock-hint-text">{{
                      ourMomentsUnlockHintParts(photo).after
                    }}</text>
                  </view>
                  <view
                    v-if="ourMomentsUnlockHintParts(photo)"
                    class="our-moments-go-chat"
                    @tap.stop="openChat"
                  >
                    <text class="our-moments-go-chat-text">{{
                      t("companionProfile.ourMomentsGoChat")
                    }}</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </template>
      </view>
      </view>
    </view>
    </scroll-view>

    <!-- 底部操作按钮：固定在页面最下方，内容在其上方滚动 -->
    <view v-if="showProfileBody" class="bottom-bar" :style="bottomBarStyle">
      <view class="bottom-actions">
        <button
          v-if="companion && activeTab === 'about'"
          class="btn-clone"
          @tap="bindAnalyticsTap('companion-profile-clone', cloneCompanion, '克隆')"
        >
          <text class="btn-text">{{ t("companionProfile.clone") }}</text>
        </button>
        <button
          class="btn-send"
          :disabled="!companion"
          @tap="bindAnalyticsTap('companion-profile-chat', openChat, '聊天')"
        >
          <image class="btn-send-ico" src="/static/vest/companion/send-white.png" mode="aspectFit" />
          <text class="btn-text">{{ t("companionProfile.chat") }}</text>
        </button>
      </view>
    </view>

    <!-- 顶栏菜单弹层 -->
    <view v-if="showMenu && companion" class="menu-mask" @tap="showMenu = false">
      <view class="menu-popup" @tap.stop>
        <view v-if="isCreator()" class="menu-item" @tap="bindAnalyticsTap('companion-profile-edit', editCompanion, '编辑')">{{ t("common.edit") }}</view>
        <view class="menu-item" @tap="bindAnalyticsTap('companion-profile-clear-messages', clearMessages, '清空消息')">{{ t("chat.clearMessages") }}</view>
        <view
          v-if="!isCreator()"
          class="menu-item muted"
          @tap="bindAnalyticsTap('companion-profile-dislike', () => setOutreachPreference('dislike'), '不感兴趣')"
        >{{ t("companionProfile.unlike") }}</view>
        <view
          v-if="!isCreator()"
          class="menu-item danger"
          @tap="bindAnalyticsTap('companion-profile-block', () => setOutreachPreference('block'), '屏蔽触达')"
        >{{ t("companionProfile.block") }}</view>
        <view
          v-if="!isCreator()"
          class="menu-item"
          @tap="bindAnalyticsTap('companion-profile-report', openReportCharacter, '举报此角色')"
        >{{ t("characterReport.menuItem") }}</view>
        <view v-if="isCreator()" class="menu-item danger" @tap="bindAnalyticsTap('companion-profile-delete', deleteCompanion, '删除伴侣')">{{ t("companionProfile.deleteCompanion") }}</view>
      </view>
    </view>

    <AppConfirmDialog
      v-model:open="confirmOpen"
      :title="confirmTitle"
      :description="confirmDesc"
      :destructive="confirmDestructive"
      :confirm-text="t('common.confirm')"
      :cancel-text="t('common.cancel')"
      @confirm="confirmAction?.()"
    />
    <AppReportCharacterPopup
      v-model:open="reportOpen"
      :character-id="companion?.profile?.id || companionId"
      source="profile"
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
    <AppLimitedOfferHost />
  </AppPageShell>
</template>

<style scoped lang="scss">
:deep(.is-page-behind) {
  pointer-events: none;
}

.center { text-align: center; padding: 80rpx 0; }
.page-scroll {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  height: auto;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
.page-content {
  position: relative;
  z-index: 0;
  background: var(--bg);
  background-clip: content-box; /* 顶栏占位区保持透明，让光晕透进状态栏 */
  padding-bottom: 220rpx;
  /* 顶栏占位：scroll-view 铺到屏幕顶，内容从标题栏下开始，光晕仍画进状态栏 */
  padding-top: calc(var(--app-safe-top) + var(--app-header-content));
  overflow: visible;
}

/* ── 顶部背景图：上拉到屏幕最顶（状态栏后方） ── */
.top-bg {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 0;
  width: 100%;
  /* top/height 由 topBgStyle 注入 */
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.45s ease;
  will-change: opacity;

  &.loaded {
    opacity: 1;
  }
}
.top-bg-fade {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 0;
  /* top/height 与 .top-bg 同，由 topBgStyle 注入 */
  pointer-events: none;
  background: linear-gradient(180deg, transparent 45%, var(--bg) 92%);
  opacity: 0;
  transition: opacity 0.45s ease;
  will-change: opacity;

  &.loaded {
    opacity: 1;
  }
}
.top-hero-clip {
  /* 人物顶对齐内容区顶边（不超出元素框）；露出 70%，卡顶下移对齐裁切底边 */
  --hero-size: 290rpx;
  --hero-visible: 203rpx; /* 290 * 0.7 */

  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--hero-visible);
  overflow: hidden; /* 下 30% 裁掉，避免透出半透明卡面 */
  pointer-events: none;
  z-index: 0; /* 必须在 .page-main（资料卡）后面 */
}

/* 资料/统计/Tab/列表：必须高于顶图，否则朋友圈图会被顶图盖住 */
.page-main {
  position: relative;
  z-index: 2;
}
.top-hero {
  position: absolute;
  top: 0;
  left: 80%;
  transform: translateX(-50%);
  width: var(--hero-size, 290rpx);
  height: var(--hero-size, 290rpx);
}

/* ── 顶栏：笔（背景）+ 三条杠（菜单） ── */
.header-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4rpx;
}
.edit-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-icon {
  width: 48rpx;
  height: 48rpx;
}
.top-bg-photos {
  overflow: hidden;
}
.top-bg-photo {
  width: 100%;
  height: 100%;
  display: block;
}

/* ── 顶栏菜单：与 moment / 全局弹层一致 ── */
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.menu-popup {
  position: absolute;
  right: var(--page-gutter, 32rpx);
  top: calc(env(safe-area-inset-top) + 100rpx);
  background: var(--modal-bg, #251f33);
  border-radius: 24rpx;
  width: 320rpx;
  padding: 16rpx;
  overflow: hidden;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.16);
}
.menu-item {
  padding: 24rpx 16rpx;
  font-size: 28rpx;
  color: var(--fg, #fafafa);
  border-radius: 24rpx;

  &.muted {
    color: var(--fg-muted);
  }

  &.danger {
    color: #ee3639;
  }
}

/* ── 资料卡：卡顶对齐人物露出底边（70%），整体下移给顶图留位 ── */
.mt-lg {
  margin-top: 92rpx;
}
.profile-card {
  position: relative;
  z-index: 1;
  background: var(--card-bg, rgba(255, 255, 255, 0.08));
  border-radius: 32rpx;
  padding: 108rpx 32rpx 32rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  overflow: visible;
}
.avatar-holder {
  position: absolute;
  top: -92rpx;
  left: 32rpx;
  width: 184rpx;
  height: 184rpx;
  z-index: 3;
}
.avatar-holder :deep(.avatar-root),
.avatar-holder :deep(.size-lg) {
  width: 184rpx !important;
  height: 184rpx !important;
  border: 4rpx solid var(--border, rgba(255, 255, 255, 0.2));
  box-sizing: border-box;
}
.hero-avatar-skeleton {
  width: 184rpx;
  height: 184rpx;
  border-radius: 50%;
}
.hero-name-skeleton {
  width: 200rpx;
  height: 40rpx;
  border-radius: 8rpx;
}
.hero-meta-skeleton {
  width: 320rpx;
  height: 28rpx;
  border-radius: 8rpx;
}
.stat-skeleton {
  display: inline-block;
  width: 64rpx;
  height: 36rpx;
  border-radius: 8rpx;
  margin-bottom: 8rpx;
}
.affection-pill {
  position: absolute;
  top: 32rpx;
  right: 32rpx;
  z-index: 4;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
  gap: 8rpx;
  padding: 10rpx 16rpx;
  border-radius: 32rpx;
  background: rgba(231, 71, 164, 0.2);
  font-size: 24rpx;
  color: var(--fg, #fafafa);
  width: auto;
  max-width: 45%;
  box-sizing: border-box;
}
.name-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 12rpx;
  width: 100%;
  min-width: 0;
}
.identity-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8rpx;
  width: 100%;
  min-width: 0;
  padding: 0;
  box-sizing: border-box;
}
.hero-name {
  flex: 0 0 auto;
  max-width: 100%;
  min-width: 0;
  font-size: 40rpx;
  font-weight: 500;
  color: var(--fg);
  text-align: left;
}
.hero-name :deep(.marquee-clip) {
  flex: 0 0 auto !important;
  width: auto !important;
  max-width: 100%;
}
.mbti-chip,
.orientation-chip,
.deleted-chip {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 4rpx 12rpx;
  border-radius: 32rpx;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.3;
  color: var(--fg, #fafafa);
}
.mbti-chip {
  background: rgba(255, 162, 70, 0.2);
}
.orientation-chip {
  background: rgba(90, 164, 255, 0.2);
}

.deleted-chip {
  background: rgba(255, 77, 79, 0.16);
  color: #ff6b6b;
}
.hero-meta {
  display: block;
  width: 100%;
  font-size: var(--fs-caption, 24rpx);
  line-height: 1.4;
  word-break: break-word;
  color: var(--fg-muted);
  text-align: left;
}
.dashed-divider {
  margin: 8rpx 0 0;
  border-top: 1rpx solid var(--border, rgba(255, 255, 255, 0.12));
  width: 100%;
}
.tags-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
  width: 100%;
}
.tag {
  flex-shrink: 0;
  max-width: 100%;
  padding: 12rpx 16rpx;
  background: var(--bg-active, rgba(255, 255, 255, 0.05));
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  border-radius: 32rpx;
  font-size: 24rpx;
  line-height: 1.2;
}

.stats-card {
  background: var(--card-bg, rgba(255, 255, 255, 0.08));
  border-radius: 24rpx;
  padding: 32rpx 16rpx;
  margin-top: 24rpx;
}
.stat {
  flex: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.num {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: var(--fg);
  line-height: 1.2;
}
.stat-label {
  display: block;
  font-size: var(--fs-caption, 24rpx);
  color: var(--fg-muted);
}

/* Tabs：首页朋友圈/机器人同一套下划线 */
.tabs {
  gap: 24rpx;
  padding: 16rpx 0 24rpx;
  margin-top: 8rpx;
  align-items: flex-end;
}
.tabs text {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0;
  gap: 8rpx;
  font-size: 32rpx;
  font-weight: 500;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  line-height: 1.2;

  &::after {
    content: "";
    width: 48rpx;
    height: 8rpx;
    flex-shrink: 0;
    border-radius: 4rpx;
    background: transparent;
  }

  &.active {
    color: var(--fg, #fafafa);

    &::after {
      background: #ff659b;
    }
  }
}

.about-list,
.moments-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  margin-top: 8rpx;
}
.info-card {
  background: var(--card-bg, rgba(255, 255, 255, 0.08));
  padding: 32rpx;
  border-radius: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.info-title {
  display: block;
  font-size: 24rpx;
  font-weight: 500;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}
.info-content {
  display: block;
  width: 100%;
  font-size: 32rpx;
  font-weight: 500;
  color: var(--fg, #fafafa);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  overflow: visible;
}
.info-chip {
  display: inline-flex;
  align-self: flex-start;
  padding: 10rpx 16rpx;
}

.more-persona {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.more-persona-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  background: var(--card-bg, rgba(255, 255, 255, 0.08));
  border-radius: 32rpx;
  font-size: 32rpx;
  color: var(--fg, #fafafa);
}
.more-persona-arrow {
  color: var(--fg-muted);
  font-size: 28rpx;
}

.kaya-moment {
  background: var(--card-bg, rgba(255, 255, 255, 0.08));
  border-radius: 24rpx;
  padding: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}
.kaya-moment-imgs {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  width: 100%;
}
.kaya-moment-img {
  flex: 1 1 0;
  width: 0;
  height: 331rpx;
  border-radius: 16rpx 16rpx 0 0;
}
.kaya-moment-imgs.is-single .kaya-moment-img {
  flex: 1 1 auto;
  width: 100%;
  height: 360rpx;
  border-radius: 16rpx;
}
.kaya-moment-author {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
}
.kaya-moment-author :deep(.avatar-root) {
  width: 72rpx !important;
  height: 72rpx !important;
}
.kaya-moment-name {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--fg, #fafafa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kaya-moment-time {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--fg-faint, rgba(255, 255, 255, 0.2));
}
.kaya-moment-caption {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--fg, #fafafa);
}
.kaya-moment-foot {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.kaya-moment-cat {
  padding: 10rpx 24rpx;
  background: var(--bg-active, rgba(255, 255, 255, 0.08));
  border-radius: 32rpx;
  font-size: 24rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}
.kaya-moment-cat-spacer {
  flex: 1;
}
.kaya-moment-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 32rpx;
}
.kaya-moment-action {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
}
.kaya-moment-action-ico {
  width: 48rpx;
  height: 48rpx;
}
.kaya-moment-action-num {
  font-size: 24rpx;
  font-weight: 500;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}

.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 24rpx var(--page-gutter, 32rpx);
  background: linear-gradient(180deg, transparent 0%, var(--bg, #0a0a0a) 100%);
}
.bottom-actions {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
}
.btn-clone,
.btn-send {
  flex: 1;
  margin: 0;
  padding: 0 32rpx;
  min-height: 92rpx;
  height: 92rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  line-height: 1;
  border-radius: 999rpx;
  font-size: 32rpx;
  font-weight: 500;
  border: none;
  box-sizing: border-box;

  &::after {
    border: none;
  }
}
.btn-text {
  line-height: 18px;
  font-size: 32rpx;
  font-weight: 500;
  color: inherit;
  text-align: center;
}
.btn-clone {
  background: #333;
  color: #fff;
}
.btn-send {
  background: linear-gradient(168deg, #ff659b 16.65%, #b933e6 96.21%);
  color: #fff;

  &[disabled] {
    opacity: 0.6;
  }
}
.btn-send-ico {
  width: 56rpx;
  height: 56rpx;
  flex-shrink: 0;
}
.py-lg {
  padding: 80rpx 0;
}
.flex-1 {
  flex: 1;
}
</style>
