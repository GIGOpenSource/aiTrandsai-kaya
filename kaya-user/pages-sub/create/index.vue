<script setup>
/**
 * @file pages-sub/create — 创建伴侣向导
 * @description 多步表单（人设/城市/MBTI/性格标签等），提交 POST /companions。
 * @depends loadPresets、api、personalityTags、companionLang
 */
import { ref, computed, watch, nextTick, getCurrentInstance, onMounted, onUnmounted } from "vue";
import { onLoad, onReady, onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import { requireAuth } from "@/composables/useAuth";
import { api, apiFetch, unwrapApiResults } from "@/utils/api";
import { loadCitiesByLang } from "@/data/createCompanion/loadPresets";
import {
  findRegionByCity,
  findRegionByKey,
  listRegionsForUi,
  regionLabel,
} from "@/data/createCompanion/regionCatalog";
import {
  AXIS_ORDER,
  defaultAxesKeys,
  listAxisOptions,
  resolveAxesLabels,
  axisTitle,
} from "@/data/createCompanion/personaAxesCatalog";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppWheelPickerPopup from "@/components/AppWheelPickerPopup.vue";
import {
  personalityFeaturedKeys,
  personalityGroupOrder,
  personalityMeta,
  personalityMutexPairs,
  translatePersonalityTag,
} from "@/utils/personalityTags";
import {
  formatCompanionAge,
  formatCompanionName,
  uiLangCode,
} from "@/utils/formatCompanion";
import { showToast } from "@/stores/toast";
import { useThemeStore } from "@/stores/theme";
import { readSafeArea, HEADER_CONTENT_PX } from "@/composables/useStatusBar";
import { getItem, removeItem, setItem } from "@/utils/storage";
import { invalidateCompanionsCache } from "@/utils/companionsCache";
import { bindAnalyticsTap } from "@/utils/analytics";
import {
  trackProductEvent,
  PRODUCT_EVENTS,
  withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import {
  AGE_MAX,
  AGE_MIN,
  buildCreatePayload as makeCreatePayload,
  buildLocalFallbackPersona,
  clampAge,
  classifyCreateError,
  clipText,
  fillI18n,
  firstFilled,
  parseChatHistory,
  pickAgentLimitMax,
} from "@/utils/createCompanionForm";
import {
  buildLocalPersonalityCatalog,
  filterVisiblePersonalityItems,
  findPersonalityMutexPair,
  toPersonalityKey,
} from "@/utils/createPersonality";
import { SHOW_CREATE_EXTRA_FIELDS } from "@/utils/constants";

requireAuth();

const { t, locale } = useI18n();
const themeStore = useThemeStore();
const currentLang = computed(() => uiLangCode(locale.value));

/**
 * App 端 scroll-view 必须写死 px 高度；底栏 fixed 不参与 flex，列表区占满 header 以下区域。
 */
const createPageInstance = getCurrentInstance();
const formScrollHeight = ref(560);
const footerSafeBottom = ref(8);
const footerBlockPx = ref(70);

const formHeaderOffsetPx = ref(58);

function measureCreateLayout() {
  try {
    const area = readSafeArea();
    const win = Number(area.windowHeight) || 667;
    const top =
      (Number(area.statusBarHeight) || Number(area.safeAreaTop) || 0) +
      HEADER_CONTENT_PX;
    formHeaderOffsetPx.value = Math.max(HEADER_CONTENT_PX, Math.floor(top));
    formScrollHeight.value = Math.max(240, Math.floor(win - formHeaderOffsetPx.value));
    const b = Number(area.safeAreaBottom) || 0;
    footerSafeBottom.value = Math.max(8, b);
  } catch {
    formScrollHeight.value = 560;
    footerSafeBottom.value = 8;
  }
  nextTick(() => {
    const q = uni.createSelectorQuery().in(createPageInstance?.proxy);
    q.select(".create-footer")
      .boundingClientRect((rect) => {
        const h = Math.floor(Number(rect?.height) || 0);
        if (h > 40) footerBlockPx.value = h;
      })
      .exec();
  });
}

const formScrollStyle = computed(() => ({
  top: `${formHeaderOffsetPx.value}px`,
  height: `${formScrollHeight.value}px`,
}));

const footerStyle = computed(() => ({
  paddingBottom: `${footerSafeBottom.value}px`,
}));

const formInnerPadStyle = computed(() => ({
  paddingBottom: `${footerBlockPx.value + 12}px`,
}));

/** H5 会被 uni-app 的 --window-top / 状态栏变量垫下来，创建页强制贴顶 */
let h5TopBackup = null;
function pinH5PageTop() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!h5TopBackup) {
    h5TopBackup = {
      windowTop: root.style.getPropertyValue("--window-top"),
      statusBar: root.style.getPropertyValue("--status-bar-height"),
    };
  }
  root.style.setProperty("--window-top", "0px", "important");
  root.style.setProperty("--status-bar-height", "0px", "important");
  const body = document.querySelector("uni-page-body") || document.querySelector(".uni-page-body");
  if (body) {
    body.style.paddingTop = "0px";
    body.style.top = "0px";
  }
}
function unpinH5PageTop() {
  if (typeof document === "undefined" || !h5TopBackup) return;
  const root = document.documentElement;
  if (h5TopBackup.windowTop) root.style.setProperty("--window-top", h5TopBackup.windowTop);
  else root.style.removeProperty("--window-top");
  if (h5TopBackup.statusBar) root.style.setProperty("--status-bar-height", h5TopBackup.statusBar);
  else root.style.removeProperty("--status-bar-height");
  h5TopBackup = null;
}

/** 键盘弹起时藏底栏，避免 fixed「创建」按钮被顶到键盘上方 */
const KEYBOARD_HIDE_PX = 80;
const keyboardOpen = ref(false);
const keyboardHeightPx = ref(0);
const focusedFieldId = ref("");
const formScrollTop = ref(0);
let lastFormScrollTop = 0;
let createKeyboardCb = null;

function onFormScroll(e) {
  lastFormScrollTop = Number(e.detail?.scrollTop) || 0;
}

function onFormFieldFocus(fieldId) {
  focusedFieldId.value = fieldId;
  if (keyboardOpen.value && keyboardHeightPx.value >= KEYBOARD_HIDE_PX) {
    nextTick(() => scrollFieldAboveKeyboard(fieldId, keyboardHeightPx.value));
  }
}

function scrollFieldAboveKeyboard(fieldId, keyboardH) {
  if (!fieldId || keyboardH < KEYBOARD_HIDE_PX) return;
  const q = uni.createSelectorQuery().in(createPageInstance?.proxy);
  q.select(`#${fieldId}`)
    .boundingClientRect((rect) => {
      if (!rect) return;
      const winH = Number(readSafeArea().windowHeight) || 667;
      const overflow = rect.bottom - (winH - keyboardH - 16);
      if (overflow <= 0) return;
      const y = lastFormScrollTop + overflow;
      formScrollTop.value = y > 0 ? y - 0.5 : 0.5;
      nextTick(() => {
        formScrollTop.value = y;
        lastFormScrollTop = y;
      });
    })
    .exec();
}

function onCreateKeyboardHeightChange(res) {
  const h = Math.max(0, Number(res?.height) || 0);
  keyboardHeightPx.value = h;
  keyboardOpen.value = h >= KEYBOARD_HIDE_PX;
  if (keyboardOpen.value && focusedFieldId.value) {
    nextTick(() => scrollFieldAboveKeyboard(focusedFieldId.value, h));
  }
}

/** 编辑模式：?edit=1&id= */
const isEditMode = ref(false);
const editId = ref("");
const pageTitle = computed(() =>
  isEditMode.value
    ? t("createCompanion.editTitle")
    : t("createCompanion.title")
);

/** 创建成功后进资料页；VIP/余额不足弹窗，付费成功后继续创建 */
const showRechargeModal = ref(false);
const rechargeDefaultTab = ref("vip");
const rechargeInsufficient = ref(false);
const awaitingPayToCreate = ref(false);
const createGatePassed = ref(false);
const userIsVip = ref(false);
const userPoints = ref(0);
const userVipName = ref("");
const userVipExpire = ref("");
const userVipType = ref("");
const pendingCreateCost = ref(0);

// ——— 表单状态 ———

// ——— 性格标签目录（分组 + 推荐 + 互斥，与后端 personality_catalog 对齐） ———
const personalityCatalog = ref([]); // { key, label, bucket, group }[]
const personalityMutex = ref(personalityMutexPairs.map((p) => [...p]));
const featuredKeys = ref([...personalityFeaturedKeys]);
const showAllPersonalities = ref(false);
/** 一键生成/回填带出的标签，取消选中后仍保留在列表里 */
const pinnedPersonalityKeys = ref([]);
const personalityMutexHint = ref("");

const GROUP_LABEL_KEYS = {
  temperament: "temperament",
  social: "social",
  emotion: "emotion",
  style: "style",
};

/** 16 型 MBTI 人格 */
const MBTI_TYPES = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP",
];

/** 性取向选项（i18n key 在 register 下） */
const ORIENTATIONS = [
  "heterosexual",
  "homosexual",
  "bisexual",
  "pansexual",
  "asexual",
  "secret",
];

// 基础必填项
const name = ref("");
const age = ref(22);
const gender = ref("female");
/** 用户是否点击过性别按钮；点过后一键填充尊重该性别 */
const genderTouched = ref(false);
const city = ref("");
const selectedPersonalities = ref([]);
const appearance = ref("");
const description = ref("");
const background = ref("");
const speakingStyle = ref("");
// 选填人设细节
const personalityDetailsText = ref("");
const hobbies = ref("");
const values = ref("");
const fears = ref("");
const loveView = ref("");
const dailyRoutine = ref("");
const favoriteThings = ref("");
const mbti = ref("INTJ");
const sexualOrientation = ref("heterosexual");
const lifeStory = ref("");
const culturalValues = ref("");
const genderPerspective = ref("");
const country = ref("");
/** 展示用国家/地区文案（对应后端 region_label，如「中国大陆」） */
const regionLabelText = ref("");
/** 地区机器码（提交用） */
const regionKeyCode = ref("");
/** 人设维度 keys 对象 */
const selectedAxesKeys = ref(defaultAxesKeys());
// 聊天记录导入
const chatHistoryRaw = ref("");
const chatHistoryCount = ref(0);
// 页面状态：字段错误 / 提交中 / 一键填充中 / MBTI 弹窗 / 性取向弹窗 / 地区 / 人设维度
const errors = ref({});
const creating = ref(false);
/** 真正打创建接口的同步锁，防止连点在 await 间隙重复 POST */
let createRequesting = false;
const autoFilling = ref(false);
const showMbtiPicker = ref(false);
const mbtiPickerIndex = ref(0);
const showOrientationPicker = ref(false);
const orientationPickerIndex = ref(0);
const showRegionPicker = ref(false);
const regionPickerIndex = ref(0);
/** 人设维度：当前编辑的 axis + 滚轮下标 */
const showAxisPicker = ref(false);
const activeAxis = ref("");
const axisPickerIndex = ref(0);

const pickerOpen = computed(
  () =>
    showMbtiPicker.value ||
    showOrientationPicker.value ||
    showRegionPicker.value ||
    showAxisPicker.value
);

watch(pickerOpen, () => {
  if (!pickerOpen.value) nextTick(() => measureCreateLayout());
});

const regionOptions = computed(() => listRegionsForUi(currentLang.value));

const regionWheelOptions = computed(() =>
  regionOptions.value.map((r) => ({ label: r.label, value: r.key }))
);

const orientationWheelOptions = computed(() =>
  ORIENTATIONS.map((o) => ({ label: t(`register.${o}`), value: o }))
);

const mbtiWheelOptions = computed(() =>
  MBTI_TYPES.map((type) => ({
    label: `${type} - ${t(`createCompanion.mbtiTypes.${type}`)}`,
    value: type,
  }))
);

const regionDisplayLabel = computed(() => {
  const hit = findRegionByKey(regionKeyCode.value);
  return hit ? regionLabel(hit, currentLang.value) : "";
});

const axesOptionsByAxis = computed(() => {
  const lang = currentLang.value;
  const map = {};
  for (const axis of AXIS_ORDER) {
    map[axis] = listAxisOptions(axis, lang);
  }
  return map;
});

const activeAxisTitle = computed(() =>
  activeAxis.value ? axisTitle(activeAxis.value, currentLang.value) : ""
);

const activeAxisOptions = computed(() =>
  activeAxis.value ? axesOptionsByAxis.value[activeAxis.value] || [] : []
);

function axisFieldLabel(axis) {
  return axisTitle(axis, currentLang.value);
}

function axisSelectedLabel(axis) {
  return resolveAxesLabels(selectedAxesKeys.value, currentLang.value)[axis] || "";
}

function applyRegionSelection(region) {
  if (!region) {
    regionKeyCode.value = "";
    country.value = "";
    regionLabelText.value = "";
    return;
  }
  regionKeyCode.value = region.key || "";
  country.value = region.country || "";
  const label =
    regionLabel(region, currentLang.value) ||
    region.label ||
    "";
  if (label) regionLabelText.value = label;
}

function openRegionPicker() {
  const list = regionOptions.value;
  const idx = list.findIndex((r) => r.key === regionKeyCode.value);
  regionPickerIndex.value = idx >= 0 ? idx : 0;
  showRegionPicker.value = true;
}

function confirmRegionPicker(idx) {
  applyRegionSelection(regionOptions.value[Number(idx) || 0]);
  regionPickerIndex.value = Number(idx) || 0;
  showRegionPicker.value = false;
}

function openAxisPicker(axis) {
  activeAxis.value = axis;
  const opts = axesOptionsByAxis.value[axis] || [];
  const key = selectedAxesKeys.value?.[axis];
  const idx = opts.findIndex((o) => o.key === key);
  axisPickerIndex.value = idx >= 0 ? idx : 0;
  showAxisPicker.value = true;
}

function confirmAxisPicker(idx) {
  const axis = activeAxis.value;
  if (!axis) {
    showAxisPicker.value = false;
    return;
  }
  const opts = axesOptionsByAxis.value[axis] || [];
  const i = Number(idx) || 0;
  const key = opts[i]?.key || opts[0]?.key || "";
  selectedAxesKeys.value = { ...selectedAxesKeys.value, [axis]: key };
  axisPickerIndex.value = i;
  showAxisPicker.value = false;
}

function syncAxesFromKeys(keys) {
  selectedAxesKeys.value =
    keys && typeof keys === "object" ? { ...defaultAxesKeys(), ...keys } : defaultAxesKeys();
}

/** 打开 MBTI 滑动选择器，同步当前索引 */
function openMbtiPicker() {
  const idx = MBTI_TYPES.indexOf(mbti.value);
  mbtiPickerIndex.value = idx >= 0 ? idx : 0;
  showMbtiPicker.value = true;
}

function confirmMbtiPicker(idx) {
  const i = Number(idx) || 0;
  mbti.value = MBTI_TYPES[i] || MBTI_TYPES[0];
  mbtiPickerIndex.value = i;
  showMbtiPicker.value = false;
}

/** MBTI 选项列表：类型码 + 多语言描述 */
const mbtiOptions = computed(() =>
  MBTI_TYPES.map((type) => ({
    value: type,
    label: `${type} - ${t(`createCompanion.mbtiTypes.${type}`)}`,
  }))
);

const mbtiDisplayLabel = computed(() => {
  const opt = mbtiOptions.value.find((o) => o.value === mbti.value);
  return opt?.label || MBTI_TYPES[0];
});

const appearancePreview = computed(() => {
  const text = String(appearance.value || "").trim();
  if (!text) return "";
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
});

function personalityLabel(tagOrKey) {
  return translatePersonalityTag(tagOrKey, currentLang.value);
}

function pinPersonalityKeys(keys) {
  const next = [...pinnedPersonalityKeys.value];
  const seen = new Set(next);
  for (const raw of keys || []) {
    const k = toPersonalityKey(raw);
    if (!k || seen.has(k)) continue;
    next.push(k);
    seen.add(k);
  }
  pinnedPersonalityKeys.value = next;
}

/** 折叠态只展示推荐标签；已选/钉住的非推荐标签也保留，取消选中后不消失 */
const visiblePersonalityItems = computed(() =>
  filterVisiblePersonalityItems(
    personalityCatalog.value,
    featuredKeys.value,
    selectedPersonalities.value,
    showAllPersonalities.value,
    pinnedPersonalityKeys.value
  )
);

/** 按 气质/社交/情绪/风格 分组的展示视图 */
const personalityGroupsView = computed(() => {
  const items = visiblePersonalityItems.value;
  return personalityGroupOrder
    .map((gid) => ({
      id: gid,
      label: t(`createCompanion.personalityGroups.${GROUP_LABEL_KEYS[gid] || gid}`),
      items: items.filter((i) => i.group === gid),
    }))
    .filter((g) => g.items.length > 0);
});

/** 检查已选组合是否命中互斥对，命中返回提示文案 */
function checkPersonalityMutex(keys) {
  const hit = findPersonalityMutexPair(keys, personalityMutex.value);
  if (!hit) return "";
  const a = personalityLabel(hit[0]);
  const b = personalityLabel(hit[1]);
  return fillI18n(t("createCompanion.personalityMutex", { a, b }), { a, b });
}

/** 拉取后端性格目录（目录/推荐/互斥），失败时回退本地字典 */
async function loadPersonalitiesForLang(lang) {
  personalityCatalog.value = buildLocalPersonalityCatalog(lang);
  // 后端目录接口暂未上线，先只用本地字典；接口就绪后取消注释即可
  // try {
  //   const data = await apiFetch(`/api/culture/personalities?lang=${lang}`);
  //   if (data?.items?.length) {
  //     personalityCatalog.value = data.items.map((it) => ({
  //       key: it.key,
  //       label: it.label || personalityLabel(it.key),
  //       bucket: it.bucket || "neutral",
  //       group: it.group || "style",
  //     }));
  //   }
  //   if (data?.featured_keys?.length) featuredKeys.value = data.featured_keys;
  //   if (data?.mutex_pairs?.length) {
  //     personalityMutex.value = data.mutex_pairs.map((p) => [...p]);
  //   }
  // } catch {
  //   /* 本地 personalityTagTranslations 兜底 */
  // }
}

watch(currentLang, (lang) => void loadPersonalitiesForLang(lang), { immediate: true });

// ——— 预设加载 ———

/**
 * 从 clone_companion_data 解析并填充表单（仅复制页面可编辑的字段）。
 * 通常由「我的智能体」页点击复制后跳转而来。
 */
function prefillFromClone(raw) {
  try {
    const data = JSON.parse(raw);
    if (data.name) name.value = data.name.length > 20 ? data.name.slice(0, 20) : data.name;
    if (data.age) age.value = clampAge(data.age);
    if (data.gender) gender.value = data.gender;
    if (data.city) city.value = data.city;
    if (data.personality) {
      const parts = String(data.personality)
        .split(/[、,，]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => toPersonalityKey(p));
      selectedPersonalities.value = parts;
      pinPersonalityKeys(parts);
      personalityMutexHint.value = checkPersonalityMutex(parts);
    }
    if (data.background) background.value = data.background;
    if (data.description) description.value = data.description;
    if (data.appearance) appearance.value = data.appearance;
    if (data.speech_style) speakingStyle.value = data.speech_style;
    if (data.personality_details) personalityDetailsText.value = data.personality_details;
    if (data.hobbies) hobbies.value = data.hobbies;
    if (data.values) values.value = data.values;
    if (data.fears) fears.value = data.fears;
    if (data.love_view) loveView.value = data.love_view;
    if (data.daily_routine) dailyRoutine.value = data.daily_routine;
    if (data.favorite_things) favoriteThings.value = data.favorite_things;
    if (data.mbti) mbti.value = data.mbti;
    if (data.sexual_orientation) sexualOrientation.value = data.sexual_orientation;
    if (data.life_story) lifeStory.value = data.life_story;
    if (data.cultural_values) culturalValues.value = data.cultural_values;
    if (data.gender_perspective) genderPerspective.value = data.gender_perspective;
    if (data.country) country.value = data.country;
    if (data.region_key) {
      const reg = findRegionByKey(data.region_key);
      applyRegionSelection(reg || { key: data.region_key, country: data.country || "" });
    } else if (data.city) {
      applyRegionSelection(findRegionByCity(data.city));
    }
    // 优先用后端 region_label（一键生成/编辑回填）
    if (data.region_label) {
      regionLabelText.value = String(data.region_label);
    } else if (!regionLabelText.value && data.country && String(data.country).length > 2) {
      regionLabelText.value = String(data.country);
    }
    const clonedAxesKeys = extractPersonaAxesKeys(data);
    if (clonedAxesKeys) syncAxesFromKeys(clonedAxesKeys);
  } catch {
    /* ignore parse errors */
  }
}

/** 将 GET /companions/{id} 填充到表单（编辑模式） */
function fillFormFromCompanion(data) {
  const p = data?.profile || data || {};
  prefillFromClone(JSON.stringify({
    name: p.name,
    age: p.age,
    gender: p.gender === "男" || p.gender === "male" ? "male" : "female",
    city: p.city,
    personality: p.personality,
    appearance: p.appearance,
    description: p.description,
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
    country: p.country || "",
    region_key: p.region_key || "",
    region_label: p.region_label || "",
    persona_axes: p.persona_axes || "",
    persona_axes_labels: p.persona_axes_labels || "",
    persona_axes_summary: p.persona_axes_summary || "",
  }));
}

/** 页面入口：edit / clone */
onLoad(async (query) => {
  measureCreateLayout();
  if (query?.edit === "1" && query?.id) {
    isEditMode.value = true;
    editId.value = String(query.id);
    try {
      const data = await apiFetch(`/companions/${editId.value}`);
      fillFormFromCompanion(data);
    } catch (err) {
      console.error("[CreateCompanion] 加载编辑数据失败:", err);
      showToast(t("companionProfile.loadingError"));
    }
    return;
  }
  if (query?.clone !== "1") return;
  const raw = getItem("clone_companion_data");
  if (!raw) return;
  prefillFromClone(raw);
  removeItem("clone_companion_data");
});

onReady(() => {
  measureCreateLayout();
  setTimeout(measureCreateLayout, 80);
});

onShow(() => {
  measureCreateLayout();
  // #ifdef H5
  pinH5PageTop();
  // #endif
});

onMounted(() => {
  createKeyboardCb = onCreateKeyboardHeightChange;
  if (typeof uni.onKeyboardHeightChange === "function") {
    uni.onKeyboardHeightChange(createKeyboardCb);
  }
  // #ifdef H5
  pinH5PageTop();
  // #endif
});

onUnmounted(() => {
  if (createKeyboardCb && typeof uni.offKeyboardHeightChange === "function") {
    uni.offKeyboardHeightChange(createKeyboardCb);
  }
  createKeyboardCb = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("mousemove", onAgeMouseMove);
    window.removeEventListener("mouseup", onAgeMouseUp);
  }
  // #ifdef H5
  unpinH5PageTop();
  // #endif
});

/** 点击性格标签：已选取消；未选加入（最多 4 个），并检测互斥组合 */
function togglePersonality(key) {
  const k = toPersonalityKey(key);
  if (!k) return;
  if (selectedPersonalities.value.includes(k)) {
    selectedPersonalities.value = selectedPersonalities.value.filter((p) => p !== k);
    pinPersonalityKeys([k]);
  } else {
    if (selectedPersonalities.value.length >= 4) {
      showToast(t("createCompanion.errors.personalityMax"));
      return;
    }
    selectedPersonalities.value = [...selectedPersonalities.value, k];
  }
  personalityMutexHint.value = checkPersonalityMutex(selectedPersonalities.value);
}

/** 预设/接口性别 → 表单 male|female|nonbinary */
function toFormGender(raw) {
  const g = String(raw || "").trim().toLowerCase();
  if (g === "男" || g === "male" || g === "m") return "male";
  if (
    g === "nonbinary" ||
    g === "non-binary" ||
    g === "non_binary" ||
    g === "非二元"
  ) {
    return "nonbinary";
  }
  return "female";
}

/** 表单性别 → 接口 male|female|nonbinary */
function toApiGenderLabel(raw) {
  const g = toFormGender(raw);
  if (g === "male") return "male";
  if (g === "nonbinary") return "nonbinary";
  return "female";
}

function selectGender(next) {
  gender.value = toFormGender(next);
  genderTouched.value = true;
}

function pickRandom(arr) {
  if (!arr?.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 随机 2～4 个性格 key，尽量避开互斥对 */
function pickRandomPersonalityKeys() {
  const pool = (personalityCatalog.value || [])
    .map((i) => i.key)
    .filter(Boolean);
  const keys = pool.length
    ? [...pool]
    : Object.keys(personalityMeta || {});
  shuffleInPlace(keys);
  const target = 2 + Math.floor(Math.random() * 3); // 2–4
  const picked = [];
  for (const k of keys) {
    if (picked.length >= target) break;
    const trial = [...picked, k];
    if (!checkPersonalityMutex(trial)) picked.push(k);
  }
  if (picked.length < 2) {
    for (const k of keys) {
      if (picked.includes(k)) continue;
      picked.push(k);
      if (picked.length >= 2) break;
    }
  }
  return picked.slice(0, 4);
}

/** 解开 generate 可能的一层包装（含 { code, results }） */
function unwrapGenerateResult(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.appearance || raw.background || raw.life_story || raw.speech_style || raw.region_label) {
    return raw;
  }
  const unwrapped = unwrapApiResults(raw);
  if (unwrapped && typeof unwrapped === "object" && unwrapped !== raw) {
    return unwrapGenerateResult(unwrapped);
  }
  const nested = raw.data || raw.result || raw.profile;
  if (nested && typeof nested === "object") return nested;
  return raw;
}

/** 提交用：抽出 persona_axes 的 keys 对象 */
function extractPersonaAxesKeys(g) {
  const axes = g?.persona_axes;
  if (!axes) return null;
  if (typeof axes === "string") {
    try {
      const parsed = JSON.parse(axes);
      if (parsed?.keys && typeof parsed.keys === "object") return parsed.keys;
      if (parsed && typeof parsed === "object" && !parsed.keys) return parsed;
    } catch {
      return null;
    }
  }
  if (typeof axes === "object") {
    if (axes.keys && typeof axes.keys === "object") return axes.keys;
    return axes;
  }
  return null;
}

function applyRegionAndAxesFromGenerate(g, seedCity = "") {
  const byKey = g?.region_key ? findRegionByKey(g.region_key) : null;
  const byCity = findRegionByCity(g?.city || seedCity);
  const region = byKey || byCity;
  if (region) {
    applyRegionSelection(region);
  } else if (g?.country || g?.region_label) {
    country.value = clipText(String(g.country || ""), 32);
    regionKeyCode.value = firstFilled(g?.region_key);
  } else {
    applyRegionSelection(null);
  }
  // generate 回传的 region_label 优先生效（创建提交需带上）
  if (g?.region_label) {
    regionLabelText.value = clipText(String(g.region_label), 64);
  }
  const keys = extractPersonaAxesKeys(g);
  if (keys) syncAxesFromKeys(keys);
}

/**
 * 一键填充：纯随机种子（姓名/年龄/城市/性格/MBTI/取向）+ AI generate。
 * 用户已手动点选性别时固定用该性别，否则性别也随机。
 */
async function handleAutoFill() {
  autoFilling.value = true;
  try {
    const lang = currentLang.value;
    const finalGender = genderTouched.value
      ? toFormGender(gender.value)
      : Math.random() < 0.5
        ? "male"
        : "female";
    const genderLabel = toApiGenderLabel(finalGender);
    const finalAge = AGE_MIN + Math.floor(Math.random() * (AGE_MAX - AGE_MIN + 1)); // 18–65
    const langBase = String(lang || "").split("-")[0];
    const cities = loadCitiesByLang(lang);
    const cityFallback = {
      zh: "上海",
      ar: "الرياض",
      fa: "تهران",
      ru: "Москва",
      bg: "София",
      tr: "İstanbul",
    };
    const finalCity =
      pickRandom(cities) || cityFallback[langBase] || "New York";
    const seedRegion =
      findRegionByCity(finalCity) || pickRandom(listRegionsForUi(lang)) || null;
    const seedAxes = (() => {
      const keys = {};
      for (const axis of AXIS_ORDER) {
        const opts = listAxisOptions(axis, lang);
        keys[axis] = pickRandom(opts)?.key || defaultAxesKeys()[axis];
      }
      return keys;
    })();
    const finalMbti = pickRandom(MBTI_TYPES) || MBTI_TYPES[0];
    const finalOrientation = pickRandom(ORIENTATIONS) || "heterosexual";
    const personalityKeys = pickRandomPersonalityKeys();
    const personalityJoined = personalityKeys
      .map((k) => personalityLabel(k))
      .filter(Boolean)
      .join("、");

    // Step 1: 随机名字（文化接口）；失败则用轻量占位，不用预设角色名
    let pickedName = "";
    try {
      const data = await apiFetch(
        `/api/culture/names?lang=${lang}&gender=${finalGender}&count=8`
      );
      if (data.names?.length) {
        pickedName = pickRandom(data.names) || data.names[0];
      }
    } catch {
      /* use fallback below */
    }
    const namePrefix = {
      zh: "旅人",
      ar: "مسافر",
      fa: "مسافر",
      ru: "Путник",
      bg: "Пътник",
      tr: "Gezgin",
    };
    const fallbackName = `${namePrefix[langBase] || "Traveler"}${1000 + Math.floor(Math.random() * 9000)}`;
    const finalName = formatCompanionName(pickedName || fallbackName, fallbackName);

    const local = buildLocalFallbackPersona({
      name: finalName,
      age: finalAge,
      city: finalCity,
      genderLabel,
      personalityLabel: personalityJoined || t("createCompanion.uniquePersonalityFallback"),
      lang,
    });

    // Step 2: 只传随机种子，不带固定长文草稿，让服务端自由生成
    const generatePayload = {
      name: finalName,
      age: finalAge,
      gender: genderLabel,
      sexual_orientation: finalOrientation,
      city: finalCity,
      personality: personalityJoined,
      mbti: finalMbti,
      lang,
      expand_user_input: false,
      country: seedRegion?.country || "",
      region_key: seedRegion?.key || "",
      region_label: seedRegion ? regionLabel(seedRegion, lang) : "",
      persona_axes: seedAxes,
    };

    let generated = null;
    try {
      generated = await apiFetch("/companions/generate", {
        method: "POST",
        data: generatePayload,
        timeout: 60000,
      });
    } catch (e) {
      console.warn("[AutoFill] generate 接口失败，回退本地随机种子文案:", e);
    }

    // Step 3: 一次性写入表单
    name.value = clipText(finalName, 20);
    age.value = finalAge;
    gender.value = finalGender;
    sexualOrientation.value = finalOrientation;
    city.value = finalCity;
    selectedPersonalities.value = personalityKeys.slice(0, 4);
    pinPersonalityKeys(selectedPersonalities.value);
    personalityMutexHint.value = checkPersonalityMutex(selectedPersonalities.value);
    mbti.value = finalMbti;
    errors.value = {};

    const g = unwrapGenerateResult(generated);
    appearance.value = clipText(firstFilled(g.appearance, local.appearance), 300);
    description.value = clipText(
      firstFilled(g.description, local.description, g.background),
      300
    );
    background.value = clipText(firstFilled(g.background, local.background), 300);
    speakingStyle.value = clipText(firstFilled(g.speech_style, local.speech_style), 300);
    personalityDetailsText.value = clipText(
      firstFilled(g.personality_details, local.personality_details),
      500
    );
    hobbies.value = clipText(firstFilled(g.hobbies, local.hobbies), 300);
    values.value = clipText(firstFilled(g.values, local.values), 500);
    fears.value = clipText(firstFilled(g.fears, local.fears), 500);
    loveView.value = clipText(firstFilled(g.love_view, local.love_view), 500);
    dailyRoutine.value = clipText(firstFilled(g.daily_routine, local.daily_routine), 500);
    favoriteThings.value = clipText(firstFilled(g.favorite_things, local.favorite_things), 500);
    lifeStory.value = clipText(firstFilled(g.life_story, local.life_story), 1000);
    culturalValues.value = clipText(firstFilled(g.cultural_values, local.cultural_values), 800);
    genderPerspective.value = clipText(
      firstFilled(g.gender_perspective, local.gender_perspective),
      800
    );

    applyRegionAndAxesFromGenerate(
      {
        ...g,
        region_key: g.region_key || seedRegion?.key,
        country: g.country || seedRegion?.country,
        region_label:
          g.region_label ||
          (seedRegion ? regionLabel(seedRegion, lang) : ""),
        persona_axes: extractPersonaAxesKeys(g) || seedAxes,
      },
      finalCity
    );
    // generate 未回传维度时保留本地随机种子
    if (!extractPersonaAxesKeys(g)) syncAxesFromKeys(seedAxes);
    if (!regionKeyCode.value && seedRegion) applyRegionSelection(seedRegion);
    if (!regionLabelText.value && seedRegion) {
      regionLabelText.value = regionLabel(seedRegion, lang);
    }
  } catch (err) {
    console.error("[AutoFill] 生成失败:", err);
    showToast(t("common.networkError"));
  } finally {
    autoFilling.value = false;
  }
}

/** 聊天记录输入：同步原始文本并更新已识别消息数 */
function onChatHistoryInput(e) {
  chatHistoryRaw.value = e.detail.value;
  chatHistoryCount.value = parseChatHistory(e.detail.value).length;
}

// ——— 校验提交 ———

/** 校验必填项与字数，失败时 toast 提示 */
function validateForm() {
  const newErrors = {};
  const personalityStr = selectedPersonalities.value.join("、");

  if (!name.value.trim()) newErrors.name = t("createCompanion.errors.nameRequired");
  if (name.value.length > 20) newErrors.name = t("createCompanion.errors.nameMax");
  if (!age.value && age.value !== 0) newErrors.age = t("createCompanion.errors.ageRequired");
  if (!gender.value) newErrors.gender = t("createCompanion.errors.genderRequired");
  if (!city.value.trim()) newErrors.city = t("createCompanion.errors.cityRequired");
  if (!personalityStr.trim()) newErrors.personality = t("createCompanion.errors.personalityRequired");
  if (selectedPersonalities.value.length < 2) {
    newErrors.personality = t("createCompanion.errors.personalityMin");
  } else if (selectedPersonalities.value.length > 4) {
    newErrors.personality = t("createCompanion.errors.personalityMax");
  } else {
    const mutex = checkPersonalityMutex(selectedPersonalities.value);
    if (mutex) {
      personalityMutexHint.value = mutex;
      newErrors.personality = mutex;
    }
  }
  if (!mbti.value.trim()) newErrors.mbti = t("createCompanion.errors.mbtiRequired");
  if (!sexualOrientation.value.trim()) {
    newErrors.sexualOrientation = t("createCompanion.errors.orientationRequired");
  }
  if (!appearance.value.trim()) {
    newErrors.appearance = t("createCompanion.errors.appearanceRequired");
  } else if (appearance.value.trim().length < 5) {
    newErrors.appearance = t("createCompanion.errors.appearanceMin");
  }
  if (!background.value.trim()) {
    newErrors.background = t("createCompanion.errors.backgroundRequired");
  } else if (background.value.trim().length < 5) {
    newErrors.background = t("createCompanion.errors.backgroundMin");
  }
  if (!speakingStyle.value.trim()) {
    newErrors.speakingStyle = t("createCompanion.errors.speechRequired");
  } else if (speakingStyle.value.trim().length < 5) {
    newErrors.speakingStyle = t("createCompanion.errors.speechMin");
  }

  errors.value = newErrors;
  const errorList = Object.values(newErrors);
  if (errorList.length > 0) {
    showToast(errorList.join("\n"));
  }
  return errorList.length === 0;
}

/** 单项实时校验：仅更新对应字段的 error，不弹 toast */
function validateField(field) {
  const newErrors = { ...errors.value };
  const personalityStr = selectedPersonalities.value.join("、");

  switch (field) {
    case "name":
      if (!name.value.trim()) newErrors.name = t("createCompanion.errors.nameRequired");
      else if (name.value.length > 20) newErrors.name = t("createCompanion.errors.nameMax");
      else delete newErrors.name;
      break;
    case "age":
      if (!age.value && age.value !== 0) newErrors.age = t("createCompanion.errors.ageRequired");
      else delete newErrors.age;
      break;
    case "gender":
      if (!gender.value) newErrors.gender = t("createCompanion.errors.genderRequired");
      else delete newErrors.gender;
      break;
    case "city":
      if (!city.value.trim()) newErrors.city = t("createCompanion.errors.cityRequired");
      else delete newErrors.city;
      break;
    case "personality":
      if (!personalityStr.trim()) newErrors.personality = t("createCompanion.errors.personalityRequired");
      else if (selectedPersonalities.value.length < 2) newErrors.personality = t("createCompanion.errors.personalityMin");
      else if (selectedPersonalities.value.length > 4) newErrors.personality = t("createCompanion.errors.personalityMax");
      else if (checkPersonalityMutex(selectedPersonalities.value)) newErrors.personality = checkPersonalityMutex(selectedPersonalities.value);
      else delete newErrors.personality;
      break;
    case "mbti":
      if (!mbti.value.trim()) newErrors.mbti = t("createCompanion.errors.mbtiRequired");
      else delete newErrors.mbti;
      break;
    case "sexualOrientation":
      if (!sexualOrientation.value.trim()) newErrors.sexualOrientation = t("createCompanion.errors.orientationRequired");
      else delete newErrors.sexualOrientation;
      break;
    case "appearance":
      if (!appearance.value.trim()) newErrors.appearance = t("createCompanion.errors.appearanceRequired");
      else if (appearance.value.trim().length < 5) newErrors.appearance = t("createCompanion.errors.appearanceMin");
      else delete newErrors.appearance;
      break;
    case "background":
      if (!background.value.trim()) newErrors.background = t("createCompanion.errors.backgroundRequired");
      else if (background.value.trim().length < 5) newErrors.background = t("createCompanion.errors.backgroundMin");
      else delete newErrors.background;
      break;
    case "speakingStyle":
      if (!speakingStyle.value.trim()) newErrors.speakingStyle = t("createCompanion.errors.speechRequired");
      else if (speakingStyle.value.trim().length < 5) newErrors.speakingStyle = t("createCompanion.errors.speechMin");
      else delete newErrors.speakingStyle;
      break;
  }

  errors.value = newErrors;
}

/** 所有必填项是否通过校验（静默，不弹 toast） */
const isFormValid = computed(() => {
  if (!name.value.trim() || name.value.length > 20) return false;
  if (!age.value && age.value !== 0) return false;
  if (!gender.value) return false;
  if (!city.value.trim()) return false;
  if (selectedPersonalities.value.length < 2) return false;
  if (!mbti.value.trim()) return false;
  if (!sexualOrientation.value.trim()) return false;
  if (!appearance.value.trim() || appearance.value.trim().length < 5) return false;
  if (!background.value.trim() || background.value.trim().length < 5) return false;
  if (!speakingStyle.value.trim() || speakingStyle.value.trim().length < 5) return false;
  return true;
});

/** 实时校验：字段变化时立即校验对应项（自动填充期间跳过） */
const fieldWatchers = [
  [name, "name"],
  [age, "age"],
  [gender, "gender"],
  [city, "city"],
  [selectedPersonalities, "personality"],
  [mbti, "mbti"],
  [sexualOrientation, "sexualOrientation"],
  [appearance, "appearance"],
  [background, "background"],
  [speakingStyle, "speakingStyle"],
];
fieldWatchers.forEach(([source, field]) => {
  watch(source, () => {
    if (!autoFilling.value) validateField(field);
  });
});

/** 同步 VIP / 余额展示用状态 */
async function refreshUserPayStatus() {
  try {
    const body = await api.get("/api/payment/vip-status");
    const st = unwrapApiResults(body) || {};
    userIsVip.value = Boolean(st.is_vip);
    userPoints.value = Number(st.effective_balance ?? st.credits ?? st.balance ?? 0) || 0;
    userVipName.value = st.vip_name || st.vip_type || "";
    userVipExpire.value = st.vip_expire_at || "";
    userVipType.value = st.vip_type || "";
    if (st.create_agent_cost != null) pendingCreateCost.value = Number(st.create_agent_cost) || 0;
    try {
      const raw = getItem("user_info");
      const prev = raw ? JSON.parse(raw) : {};
      setItem(
        "user_info",
        JSON.stringify({
          ...prev,
          is_vip: userIsVip.value,
          credits: userPoints.value,
          vip_name: userVipName.value,
          vip_expire_at: userVipExpire.value,
          vip_type: userVipType.value,
        })
      );
    } catch {
      /* ignore */
    }
    return st;
  } catch {
    try {
      const raw = getItem("user_info");
      if (raw) {
        const u = JSON.parse(raw);
        userIsVip.value = Boolean(u?.is_vip);
        userPoints.value = Number(u?.credits ?? u?.effective_balance ?? 0) || 0;
        userVipName.value = u?.vip_name || "";
        userVipExpire.value = u?.vip_expire_at || "";
        userVipType.value = u?.vip_type || "";
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** 创建前权限：VIP → 余额 → 放行 */
async function checkCreatePermission() {
  try {
    const body = await api.post("/api/payment/check-permission", { action: "create_agent" });
    return unwrapApiResults(body) || {};
  } catch (err) {
    return { allowed: false, reason: "check_failed", message: err?.message };
  }
}

function openPayGate(tab = "vip") {
  rechargeDefaultTab.value = tab;
  awaitingPayToCreate.value = true;
  createGatePassed.value = false;
  rechargeInsufficient.value = tab === "points";
  showRechargeModal.value = true;
}

function toastAgentLimit(max, fallbackMsg = "") {
  if (max !== "" && max != null) {
    showToast(fillI18n(t("create.agentLimitReachedWithMax", { max }), { max }));
    return;
  }
  const raw = String(fallbackMsg || "");
  if (raw && raw.indexOf("{max}") === -1) {
    showToast(raw);
    return;
  }
  showToast(t("create.agentLimitReached"));
}

/** 关窗且未付费成功：中断创建 */
watch(showRechargeModal, (open, wasOpen) => {
  if (wasOpen && !open) {
    rechargeInsufficient.value = false;
    if (awaitingPayToCreate.value && !createGatePassed.value) {
      awaitingPayToCreate.value = false;
      if (rechargeDefaultTab.value === "points") {
        showToast(t("create.needRechargeToCreate"));
      } else {
        showToast(t("create.needVipToCreate"));
      }
    }
  }
});

async function onPayPurchased(meta) {
  if (!awaitingPayToCreate.value) return;
  const type = meta?.productType;
  // VIP 开通或积分充值成功后都可再走创建
  if (type && type !== "vip" && type !== "recharge") return;
  createGatePassed.value = true;
  awaitingPayToCreate.value = false;
  if (!lockCreate()) return;
  // 优先使用弹窗传来的最新用户数据，避免重复请求
  const userData = meta?.userData;
  if (userData) {
    userIsVip.value = Boolean(userData.is_vip);
    userPoints.value = Number(userData.credits) || 0;
    userVipName.value = userData.vip_name || "";
    userVipExpire.value = userData.vip_expire_at || "";
    userVipType.value = userData.vip_type || "";
  } else {
    await refreshUserPayStatus();
  }
  await submitCreateCompanion();
}

function lockCreate() {
  if (creating.value || createRequesting) return false;
  creating.value = true;
  return true;
}

function unlockCreate() {
  creating.value = false;
  createRequesting = false;
}

function onCreateSubmitTap() {
  if (creating.value || createRequesting || !isFormValid.value) return;
  bindAnalyticsTap(
    isEditMode.value ? "companion-save" : "companion_create",
    handleCreate,
    isEditMode.value ? "保存伴侣" : "创建智能体"
  );
}

/** 提交创建 / 更新伴侣 */
async function handleCreate() {
  if (creating.value || createRequesting) return;
  if (!validateForm()) return;
  if (!lockCreate()) return;

  if (isEditMode.value && editId.value) {
    createRequesting = true;
    try {
      const payload = buildCreatePayload();
      const saved = await api.put(`/companions/${editId.value}`, payload);
      invalidateCompanionsCache();
      uni.$emit("companion-updated", {
        id: String(editId.value),
        data: saved?.profile ? saved : null,
        personality: payload.personality,
      });
      uni.navigateBack({
        fail: () => goCompanionProfile(editId.value),
      });
    } catch (err) {
      console.error("[CreateCompanion] 更新失败:", err);
      unlockCreate();
    }
    return;
  }

  try {
    await refreshUserPayStatus();
    const perm = await checkCreatePermission();

    if (!perm.allowed) {
      unlockCreate();
      const reason = perm.reason || "";
      if (reason === "vip_required") {
        openPayGate("vip");
        return;
      }
      if (reason === "credits_insufficient") {
        pendingCreateCost.value = Number(perm.cost) || pendingCreateCost.value;
        openPayGate("points");
        return;
      }
      if (reason === "agent_limit_reached") {
        toastAgentLimit(pickAgentLimitMax(perm));
        openPayGate("vip");
        return;
      }
      showToast(
        fillI18n(perm.message || t("create.temporarilyUnavailable"), {
          max: pickAgentLimitMax(perm),
          cost: perm.cost,
        })
      );
      return;
    }

    if (perm.cost != null) pendingCreateCost.value = Number(perm.cost) || 0;
    await submitCreateCompanion();
  } catch (err) {
    console.error("[CreateCompanion] 提交失败:", err);
    unlockCreate();
  }
}

async function submitCreateCompanion() {
  if (createRequesting) return;
  createRequesting = true;
  creating.value = true;
  try {
    const cost = pendingCreateCost.value;
    const res = await api.post("/companions", buildCreatePayload());
    invalidateCompanionsCache();
    const id = res?.profile?.id || res?.id;
    if (!id) {
      showToast(t("common.networkError"));
      unlockCreate();
      return;
    }

    // 创建成功后再上报（非编辑模式）
    trackProductEvent(
      PRODUCT_EVENTS.AGENT_CREATE_BUTTON_CLICK,
      withCompanionId({ page: "create", target_id: String(id) }, id)
    );

    if (cost > 0) {
      showToast(fillI18n(t("create.successWithCost", { cost }), { cost }));
      userPoints.value = Math.max(0, userPoints.value - cost);
    } else {
      showToast(t("create.success"));
    }

    void pollAvatarUntilReady(String(id));
    createGatePassed.value = false;
    awaitingPayToCreate.value = false;
    goCompanionProfile(String(id), { awaitAvatar: true });
  } catch (err) {
    console.error("[CreateCompanion] 提交失败:", err);
    const kind = classifyCreateError(err);
    unlockCreate();
    if (kind === "credits") {
      openPayGate("points");
    } else if (kind === "limit") {
      toastAgentLimit(pickAgentLimitMax(err), err?.message);
      openPayGate("vip");
    } else if (kind === "vip") {
      openPayGate("vip");
    }
  }
}

function goCompanionProfile(id, { awaitAvatar = false } = {}) {
  const q = awaitAvatar ? "&awaitAvatar=1" : "";
  uni.redirectTo({
    url: `/pages-sub/companion/index?id=${id}${q}`,
    fail: () => uni.reLaunch({ url: `/pages-sub/companion/index?id=${id}${q}` }),
  });
}

/**
 * __GENERATING__ 头像：创建后短暂轮询；长等待交给资料页继续。
 * AI 生图通常数十秒，这里只预热几次缓存失效。
 */
async function pollAvatarUntilReady(id, { times = 8, intervalMs = 2500 } = {}) {
  if (!id) return null;
  for (let i = 0; i < times; i++) {
    try {
      const data = await apiFetch(`/companions/${id}`);
      const avatar = String(data?.avatar || data?.profile?.avatar_url || "");
      const generating =
        data?.avatar_generating === true ||
        avatar.includes("__GENERATING__") ||
        !avatar;
      if (!generating && avatar) {
        invalidateCompanionsCache();
        return data;
      }
    } catch {
      /* ignore single poll fail */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  invalidateCompanionsCache();
  return null;
}

function buildCreatePayload() {
  return makeCreatePayload({
    name: name.value,
    age: age.value,
    gender: gender.value,
    city: city.value,
    selectedPersonalities: selectedPersonalities.value,
    currentLang: currentLang.value,
    mbti: mbti.value,
    sexualOrientation: sexualOrientation.value,
    appearance: appearance.value,
    description: description.value,
    background: background.value,
    speakingStyle: speakingStyle.value,
    personalityDetailsText: personalityDetailsText.value,
    hobbies: hobbies.value,
    values: values.value,
    fears: fears.value,
    loveView: loveView.value,
    dailyRoutine: dailyRoutine.value,
    favoriteThings: favoriteThings.value,
    lifeStory: lifeStory.value,
    culturalValues: culturalValues.value,
    genderPerspective: genderPerspective.value,
    country: country.value,
    regionKey: regionKeyCode.value,
    regionLabel: regionLabelText.value,
    personaAxes: selectedAxesKeys.value,
    isEditMode: isEditMode.value,
    chatHistoryRaw: chatHistoryRaw.value,
  });
}

/** 打开性取向滑动选择器 */
function openOrientationPicker() {
  const idx = ORIENTATIONS.indexOf(sexualOrientation.value);
  orientationPickerIndex.value = idx >= 0 ? idx : 0;
  showOrientationPicker.value = true;
}

function confirmOrientationPicker(idx) {
  const i = Number(idx) || 0;
  sexualOrientation.value = ORIENTATIONS[i] || ORIENTATIONS[0];
  orientationPickerIndex.value = i;
  showOrientationPicker.value = false;
}

/** 年龄刻度条（对照 Figma 虚线竖标） */
const AGE_TICK_COUNT = 40;
let ageTrackRect = null;

function ageTickIndex(val) {
  const span = AGE_MAX - AGE_MIN;
  if (span <= 0) return 0;
  return Math.round(((clampAge(val) - AGE_MIN) / span) * (AGE_TICK_COUNT - 1));
}

const ageNowIndex = computed(() => ageTickIndex(age.value));

const ageTicks = computed(() => {
  const cur = ageNowIndex.value;
  return Array.from({ length: AGE_TICK_COUNT }, (_, i) => {
    const t = cur <= 0 ? 1 : i / cur;
    const on = i <= cur;
    return { i, on, major: (i + 1) % 5 === 0, color: on ? lerpAgeTickColor(t) : "rgba(255, 101, 155, 0.28)" };
  });
});

function lerpAgeTickColor(t) {
  const p = Math.min(1, Math.max(0, t));
  const a = { r: 255, g: 101, b: 155 };
  const b = { r: 185, g: 51, b: 230 };
  const r = Math.round(a.r + (b.r - a.r) * p);
  const g = Math.round(a.g + (b.g - a.g) * p);
  const bl = Math.round(a.b + (b.b - a.b) * p);
  return `rgb(${r},${g},${bl})`;
}

function applyAgeFromClientX(clientX) {
  const rect = ageTrackRect;
  if (!rect || !rect.width) return;
  const ratio = Math.min(1, Math.max(0, (Number(clientX) - rect.left) / rect.width));
  age.value = clampAge(Math.round(AGE_MIN + ratio * (AGE_MAX - AGE_MIN)));
}

function cacheAgeTrackRect(done) {
  const q = uni.createSelectorQuery().in(createPageInstance?.proxy);
  q.select(".age-ticks")
    .boundingClientRect((rect) => {
      if (rect && rect.width) ageTrackRect = rect;
      if (typeof done === "function") done();
    })
    .exec();
}

function clientXFromTouch(e) {
  const t = e.touches?.[0] || e.changedTouches?.[0];
  if (t) return t.clientX ?? t.pageX ?? t.x;
  if (e.clientX != null) return e.clientX;
  if (ageTrackRect && e.detail && e.detail.x != null) {
    return ageTrackRect.left + Number(e.detail.x);
  }
  return 0;
}

function onAgeMouseMove(e) {
  applyAgeFromClientX(e.clientX);
}
function onAgeMouseUp() {
  if (typeof window === "undefined") return;
  window.removeEventListener("mousemove", onAgeMouseMove);
  window.removeEventListener("mouseup", onAgeMouseUp);
}

function onAgeTrackStart(e) {
  cacheAgeTrackRect(() => applyAgeFromClientX(clientXFromTouch(e)));
  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", onAgeMouseMove);
    window.addEventListener("mouseup", onAgeMouseUp);
  }
}

function onAgeTrackMove(e) {
  applyAgeFromClientX(clientXFromTouch(e));
}

/** 年龄气泡相对轨道位置（0–100%） */
const ageBubblePercent = computed(() => {
  const ratio = (Number(age.value) - AGE_MIN) / (AGE_MAX - AGE_MIN);
  return `${Math.min(100, Math.max(0, ratio * 100))}%`;
});

const previewGenderLabel = computed(() => {
  if (gender.value === "male") return t("createCompanion.male");
  if (gender.value === "nonbinary") return t("onboarding.nonBinary");
  return t("createCompanion.female");
});

const previewTagLabels = computed(() =>
  (selectedPersonalities.value || []).slice(0, 3).map((k) => personalityLabel(k))
);

const previewMetaLine = computed(() => {
  const parts = [
    formatCompanionAge(age.value, t),
    previewGenderLabel.value,
    city.value || t("createCompanion.unknownCity"),
  ];
  if (previewTagLabels.value[0]) parts.push(previewTagLabels.value[0]);
  return parts.filter(Boolean).join(" · ");
});
</script>

<template>
  <AppPageShell
    :title="pageTitle"
    :show-back="true"
    title-align="start"
    header-right
    fill-webview
    transparent-header
    flush-top
    status-bar-style="light"
    :pad-safe-bottom="false"
    :overlay-open="showRechargeModal || pickerOpen"
    :class="{ 'create-picker-open': pickerOpen, 'create-shell': true }"
    back-analytics-id="create-companion-back"
    back-analytics-name="创建伴侣页返回"
  >
    <template #header-title>
      <view class="create-nav-spacer" />
    </template>
    <template #header-right>
      <view
        class="autofill-btn"
        :class="{ disabled: autoFilling }"
        @tap="bindAnalyticsTap('create-companion-autofill', handleAutoFill, '自动填充')"
      >
        <text class="autofill-btn-text">{{ t("createCompanion.autoFill") }}</text>
      </view>
    </template>

    <view class="create-page">
    <!-- 一键填充加载遮罩 -->
    <view v-if="autoFilling" class="autofill-mask">
      <view class="autofill-loader">
        <view class="loader-spinner"></view>
        <text class="loader-text">{{ t("createCompanion.aiGenerate") }}</text>
      </view>
    </view>

    <view class="create-hero">
      <image
        class="create-hero-img"
        src="/static/vest/create/hero.png"
        mode="scaleToFill"
      />
      <text class="create-hero-title">{{
        isEditMode ? pageTitle : t("createCompanion.heroTitle")
      }}</text>
    </view>

    <scroll-view
      scroll-y
      class="create-body"
      :style="formScrollStyle"
      :scroll-top="formScrollTop"
      :scroll-with-animation="true"
      :enhanced="true"
      :bounces="false"
      :show-scrollbar="false"
      @scroll="onFormScroll"
    >
      <view class="form-inner" :style="formInnerPadStyle">
        <view class="form-sheet">
        <!-- 名字 -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.name") }}</text>
            <text class="char-count" :class="{ over: name.length > 20 }">{{ name.length }}/20</text>
          </view>
          <input
            :value="name"
            class="input-field"
            :class="{ 'input-error': errors.name }"
            :placeholder="t('createCompanion.namePlaceholder')"
            :maxlength="20"
              @input="name = $event.detail.value"
          />
          <text v-if="errors.name" class="error-text">{{ errors.name }}</text>
        </view>

        <!-- 年龄滑块（18~65） -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.age") }}</text>
          </view>
          <view class="age-slider age-slider--ticks">
            <view
              class="age-ticks"
              @touchstart.stop.prevent="onAgeTrackStart"
              @touchmove.stop.prevent="onAgeTrackMove"
              @tap.stop="onAgeTrackStart"
              @mousedown="onAgeTrackStart"
            >
              <view
                v-for="tick in ageTicks"
                :key="tick.i"
                class="age-tick"
                :class="{ on: tick.on, major: tick.major }"
                :style="{ background: tick.color }"
              />
            </view>
            <view class="age-legend">
              <text class="age-end">{{ AGE_MIN }}</text>
              <text class="age-now" :style="{ left: ageBubblePercent }">{{
                clampAge(age)
              }}</text>
              <text class="age-end">{{ AGE_MAX }}</text>
            </view>
          </view>
          <text v-if="errors.age" class="error-text">{{ errors.age }}</text>
        </view>

        <!-- 性别 -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.gender") }}</text>
          </view>
          <view class="gender-row">
            <button
              class="gender-btn"
              :class="{ active: gender === 'female' }"
              @tap="selectGender('female')"
            >
              {{ t("createCompanion.female") }}
            </button>
            <button
              class="gender-btn"
              :class="{ active: gender === 'male' }"
              @tap="selectGender('male')"
            >
              {{ t("createCompanion.male") }}
            </button>
            <button
              class="gender-btn"
              :class="{ active: gender === 'nonbinary' }"
              @tap="selectGender('nonbinary')"
            >
              {{ t("onboarding.nonBinary") }}
            </button>
          </view>
          <text v-if="errors.gender" class="error-text">{{ errors.gender }}</text>
        </view>

        <!-- 性取向 -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.sexualOrientation") }}</text>
          </view>
          <view class="input-field picker-field" :class="{ 'input-error': errors.sexualOrientation }" @tap="openOrientationPicker">
            {{ t(`register.${sexualOrientation}`) }}
            <text class="picker-arrow">›</text>
          </view>
          <text v-if="errors.sexualOrientation" class="error-text">{{ errors.sexualOrientation }}</text>
        </view>

        <!-- 城市（改为文本输入） -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.city") }}</text>
            <text class="char-count" :class="{ over: city.length > 20 }">{{ city.length }}/20</text>
          </view>
          <input
            :value="city"
            class="input-field"
            :class="{ 'input-error': errors.city }"
			:maxlength="20"
            :placeholder="t('createCompanion.cityPlaceholder')"
            @input="city = $event.detail.value"
          />
          <text v-if="errors.city" class="error-text">{{ errors.city }}</text>
        </view>

        <!-- 国家/地区（对应后端 region_label） -->
        <view class="field">
          <text class="label">
            {{ t("createCompanion.country") }}
            <text class="char-count" :class="{ over: regionLabelText.length > 32 }">{{ regionLabelText.length }}/32</text>
          </text>
          <input
            :value="regionLabelText"
            class="input-field"
            :maxlength="32"
            :placeholder="t('createCompanion.countryPlaceholder')"
            @input="regionLabelText = $event.detail.value"
          />
        </view>

        <!-- MBTI（up-popup 自定义深色选择器） -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.mbti") }}</text>
          </view>
          <view class="input-field picker-field" :class="{ 'input-error': errors.mbti }" @tap="openMbtiPicker">
            {{ mbtiDisplayLabel }}
            <text class="picker-arrow">›</text>
          </view>
          <text v-if="errors.mbti" class="error-text">{{ errors.mbti }}</text>
        </view>

        <!-- 性格标签 -->
        <view class="field">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.personalityLabel") }}</text>
          </view>
          <view class="tag-row">
            <button
              v-for="p in visiblePersonalityItems"
              :key="p.key"
              class="tag-btn"
              :class="{ active: selectedPersonalities.includes(p.key) }"
              @tap="togglePersonality(p.key)"
            >
              {{ personalityLabel(p.key) }}
            </button>
          </view>
          <view
            v-if="personalityCatalog.length > featuredKeys.length"
            class="personality-expand"
            @tap="showAllPersonalities = !showAllPersonalities"
          >
            <text class="personality-expand-text">
              {{
                showAllPersonalities
                  ? t("createCompanion.personalityCollapse")
                  : t("createCompanion.personalityExpand")
              }}
            </text>
          </view>
          <text v-if="personalityMutexHint" class="hint-text mutex-hint">{{ personalityMutexHint }}</text>
          <text v-if="errors.personality" class="error-text">{{ errors.personality }}</text>
        </view>

        <!-- 外貌描述（优先于背景，供 AI 头像） -->
        <view class="field" id="create-f-appearance">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.appearance") }}</text>
            <text class="char-count" :class="{ over: appearance.length > 300 }">{{ appearance.length }}/300</text>
          </view>
          <view class="textarea-shell" :class="{ 'textarea-shell--error': errors.appearance }">
            <textarea
              :value="appearance"
              class="textarea-native"
              :placeholder="t('createCompanion.appearancePlaceholder')"
              :maxlength="300"
              :auto-height="false"
              :adjust-position="false"
              @input="appearance = $event.detail.value"
              @focus="onFormFieldFocus('create-f-appearance')"
            />
          </view>
          <text v-if="errors.appearance" class="error-text">{{ errors.appearance }}</text>
        </view>

        <!-- 短简介 description -->
        <view class="field" id="create-f-description">
          <text class="label">
            {{ t("createCompanion.description") }}
            <text class="char-count" :class="{ over: description.length > 300 }">{{ description.length }}/300</text>
          </text>
          <view class="textarea-shell textarea-shell--short">
            <textarea
              :value="description"
              class="textarea-native"
              :placeholder="t('createCompanion.descriptionPlaceholder')"
              :maxlength="300"
              :auto-height="false"
              :adjust-position="false"
              @input="description = $event.detail.value"
              @focus="onFormFieldFocus('create-f-description')"
            />
          </view>
        </view>

        <!-- 背景故事 -->
        <view class="field" id="create-f-background">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.background") }}</text>
            <text class="char-count" :class="{ over: background.length > 300 }">{{ background.length }}/300</text>
          </view>
          <view class="textarea-shell textarea-shell--story" :class="{ 'textarea-shell--error': errors.background }">
            <textarea
              :value="background"
              class="textarea-native"
              :placeholder="t('createCompanion.backgroundPlaceholder')"
              :maxlength="300"
              :auto-height="false"
              :adjust-position="false"
              @input="background = $event.detail.value"
              @focus="onFormFieldFocus('create-f-background')"
            />
          </view>
          <text v-if="errors.background" class="error-text">{{ errors.background }}</text>
        </view>

        <!-- 说话风格 -->
        <view class="field" id="create-f-speaking-style">
          <view class="label">
            <text class="required">*</text>
            <text class="label-text">{{ t("createCompanion.speechStyle") }}</text>
            <text class="char-count" :class="{ over: speakingStyle.length > 300 }">{{ speakingStyle.length }}/300</text>
          </view>
          <view class="textarea-shell textarea-shell--mid" :class="{ 'textarea-shell--error': errors.speakingStyle }">
            <textarea
              :value="speakingStyle"
              class="textarea-native"
              :placeholder="t('createCompanion.speechStylePlaceholder')"
              :maxlength="300"
              :auto-height="false"
              :adjust-position="false"
              @input="speakingStyle = $event.detail.value"
              @focus="onFormFieldFocus('create-f-speaking-style')"
            />
          </view>
          <text v-if="errors.speakingStyle" class="error-text">{{ errors.speakingStyle }}</text>
        </view>

        <!-- 聊天记录导入（暂隐：SHOW_CREATE_EXTRA_FIELDS） -->
        <view class="field" id="create-f-chat-history">
          <view class="label">
            <text class="label-text">{{ t("createCompanion.importChatHistory") }}</text>
            <text class="char-count" :class="{ over: chatHistoryRaw.length > 300 }">{{ chatHistoryRaw.length }}/300</text>
          </view>
          <view class="textarea-shell textarea-shell--story">
            <textarea
              :value="chatHistoryRaw"
              class="textarea-native"
              :placeholder="t('createCompanion.chatHistoryPlaceholder')"
              :maxlength="300"
              :auto-height="false"
              :adjust-position="false"
              @input="onChatHistoryInput"
              @focus="onFormFieldFocus('create-f-chat-history')"
            />
          </view>
          <text v-if="chatHistoryCount > 0" class="text-muted hint-text">
            {{ t("createCompanion.recognizedMessages", { count: chatHistoryCount }) }}
          </text>
        </view>

        <!-- 选填人设细节 -->
        <view class="section-divider" id="create-f-personality-details">
          <!-- 性格细节（暂隐：SHOW_CREATE_EXTRA_FIELDS） -->
          <template v-if="SHOW_CREATE_EXTRA_FIELDS">
            <text class="label">
              {{ t("createCompanion.personalityDetails") }}
              <text class="char-count" :class="{ over: personalityDetailsText.length > 500 }">{{ personalityDetailsText.length }}/500</text>
            </text>
            <view class="textarea-shell textarea-shell--short">
              <textarea
                :value="personalityDetailsText"
                class="textarea-native"
                :placeholder="t('createCompanion.personalityDetailsPlaceholder')"
                :maxlength="500"
                :auto-height="false"
                :adjust-position="false"
                @input="personalityDetailsText = $event.detail.value"
                @focus="onFormFieldFocus('create-f-personality-details')"
              />
            </view>
          </template>

          <view class="field" id="create-f-hobbies">
            <view class="label">
              <text class="label-text">{{ t("createCompanion.hobbies") }}</text>
              <text class="char-count" :class="{ over: hobbies.length > 300 }">{{ hobbies.length }}/300</text>
            </view>
            <view class="textarea-shell textarea-shell--mid">
              <textarea
                :value="hobbies"
                class="textarea-native"
                :placeholder="t('createCompanion.hobbiesPlaceholder')"
                :maxlength="300"
                :auto-height="false"
                :adjust-position="false"
                @input="hobbies = $event.detail.value"
                @focus="onFormFieldFocus('create-f-hobbies')"
              />
            </view>
          </view>

          <template v-if="SHOW_CREATE_EXTRA_FIELDS">
          <view class="field" id="create-f-values">
            <text class="label">{{ t("createCompanion.values") }}</text>
            <view class="textarea-shell textarea-shell--short">
              <textarea
                :value="values"
                class="textarea-native"
                :placeholder="t('createCompanion.valuesPlaceholder')"
                :maxlength="500"
                :auto-height="false"
                :adjust-position="false"
                @input="values = $event.detail.value"
                @focus="onFormFieldFocus('create-f-values')"
              />
            </view>
          </view>

          <view class="field" id="create-f-fears">
            <text class="label">{{ t("createCompanion.fears") }}</text>
            <view class="textarea-shell textarea-shell--short">
              <textarea
                :value="fears"
                class="textarea-native"
                :placeholder="t('createCompanion.fearsPlaceholder')"
                :maxlength="500"
                :auto-height="false"
                :adjust-position="false"
                @input="fears = $event.detail.value"
                @focus="onFormFieldFocus('create-f-fears')"
              />
            </view>
          </view>

          <view class="field" id="create-f-love-view">
            <text class="label">{{ t("createCompanion.loveView") }}</text>
            <view class="textarea-shell textarea-shell--short">
              <textarea
                :value="loveView"
                class="textarea-native"
                :placeholder="t('createCompanion.loveViewPlaceholder')"
                :maxlength="500"
                :auto-height="false"
                :adjust-position="false"
                @input="loveView = $event.detail.value"
                @focus="onFormFieldFocus('create-f-love-view')"
              />
            </view>
          </view>

          <view class="field" id="create-f-daily-routine">
            <text class="label">{{ t("createCompanion.dailyRoutine") }}</text>
            <view class="textarea-shell textarea-shell--short">
              <textarea
                :value="dailyRoutine"
                class="textarea-native"
                :placeholder="t('createCompanion.dailyRoutinePlaceholder')"
                :maxlength="500"
                :auto-height="false"
                :adjust-position="false"
                @input="dailyRoutine = $event.detail.value"
                @focus="onFormFieldFocus('create-f-daily-routine')"
              />
            </view>
          </view>

          <view class="field" id="create-f-favorite-things">
            <text class="label">{{ t("createCompanion.favoriteThings") }}</text>
            <view class="textarea-shell textarea-shell--short">
              <textarea
                :value="favoriteThings"
                class="textarea-native"
                :placeholder="t('createCompanion.favoriteThingsPlaceholder')"
                :maxlength="500"
                :auto-height="false"
                :adjust-position="false"
                @input="favoriteThings = $event.detail.value"
                @focus="onFormFieldFocus('create-f-favorite-things')"
              />
            </view>
          </view>

          <view class="field" id="create-f-life-story">
            <text class="label">{{ t("createCompanion.lifeStory") }}</text>
            <view class="textarea-shell textarea-shell--tall">
              <textarea
                :value="lifeStory"
                class="textarea-native"
                :placeholder="t('createCompanion.lifeStoryPlaceholder')"
                :maxlength="1000"
                :auto-height="false"
                :adjust-position="false"
                @input="lifeStory = $event.detail.value"
                @focus="onFormFieldFocus('create-f-life-story')"
              />
            </view>
          </view>

          <view class="field" id="create-f-cultural-values">
            <text class="label">{{ t("createCompanion.culturalValues") }}</text>
            <view class="textarea-shell textarea-shell--tall">
              <textarea
                :value="culturalValues"
                class="textarea-native"
                :placeholder="t('createCompanion.culturalValuesPlaceholder')"
                :maxlength="800"
                :auto-height="false"
                :adjust-position="false"
                @input="culturalValues = $event.detail.value"
                @focus="onFormFieldFocus('create-f-cultural-values')"
              />
            </view>
          </view>

          <view class="field" id="create-f-gender-perspective">
            <text class="label">{{ t("createCompanion.genderPerspective") }}</text>
            <view class="textarea-shell textarea-shell--tall">
              <textarea
                :value="genderPerspective"
                class="textarea-native"
                :placeholder="t('createCompanion.genderPerspectivePlaceholder')"
                :maxlength="800"
                :auto-height="false"
                :adjust-position="false"
                @input="genderPerspective = $event.detail.value"
                @focus="onFormFieldFocus('create-f-gender-perspective')"
              />
            </view>
          </view>

          <view class="field">
            <text class="label">{{ t("createCompanion.regionKey") }}</text>
            <view class="input-field picker-field" @tap="openRegionPicker">
              <text :class="{ 'picker-placeholder': !regionDisplayLabel }">
                {{ regionDisplayLabel || t("createCompanion.regionKeyPlaceholder") }}
              </text>
            </view>
          </view>

            <view v-for="axis in AXIS_ORDER" :key="axis" class="field">
              <text class="label">{{ axisFieldLabel(axis) }}</text>
              <view class="input-field picker-field" @tap="openAxisPicker(axis)">
                <text :class="{ 'picker-placeholder': !axisSelectedLabel(axis) }">
                  {{ axisSelectedLabel(axis) || t("createCompanion.personaAxisPlaceholder") }}
                </text>
              </view>
            </view>
          </template>
        </view>

        <!-- 实时预览卡片 -->
        <view class="field preview-field">
          <view class="label">
            <text class="label-text">{{ t("createCompanion.preview") }}</text>
          </view>
          <view class="preview-card-wrapper">
            <view class="preview-card-inner">
              <view class="preview-avatar">
                <AppAvatarImage
                  :seed="name || 'preview'"
                  size="lg"
                  :generating="creating"
                />
              </view>
              <view class="preview-info">
                <view class="preview-name-row">
                  <text class="preview-name">{{ name || t("createCompanion.unnamed") }}</text>
                  <text v-if="mbti" class="preview-chip preview-chip-mbti">{{ mbti }}</text>
                  <text class="preview-chip preview-chip-ori">{{ t(`register.${sexualOrientation}`) }}</text>
                </view>
                <text class="preview-meta">{{ previewMetaLine }}</text>
                <view v-if="previewTagLabels.length" class="preview-dash" />
                <view v-if="previewTagLabels.length" class="preview-tags">
                  <text
                    v-for="tag in previewTagLabels"
                    :key="tag"
                    class="preview-tag"
                  >{{ tag }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
        </view>
      </view>
    </scroll-view>

    <!-- Figma 底栏 Publish（fixed）；弹层打开时隐藏，避免挡住滚轮 -->
    <view
      v-show="!pickerOpen && !keyboardOpen"
      class="create-footer"
      :style="footerStyle"
      @touchmove.stop.prevent
    >
      <button
        class="submit-btn"
        :class="{ ready: isFormValid && !creating, 'is-busy': creating }"
        :disabled="!isFormValid || creating"
        hover-class="none"
        @tap.stop="onCreateSubmitTap"
      >
        {{ creating ? t("createCompanion.generating") : (isEditMode ? t("createCompanion.saveBtn") : t("createCompanion.publishBtn")) }}
      </button>
    </view>
    </view>

    <AppWheelPickerPopup
      v-model:show="showOrientationPicker"
      :title="t('createCompanion.sexualOrientation')"
      :options="orientationWheelOptions"
      :model-value="orientationPickerIndex"
      @confirm="confirmOrientationPicker"
    />
    <AppWheelPickerPopup
      v-model:show="showMbtiPicker"
      :title="t('createCompanion.mbti')"
      :options="mbtiWheelOptions"
      :model-value="mbtiPickerIndex"
      @confirm="confirmMbtiPicker"
    />
    <AppWheelPickerPopup
      v-model:show="showRegionPicker"
      :title="t('createCompanion.regionKey')"
      :options="regionWheelOptions"
      :model-value="regionPickerIndex"
      @confirm="confirmRegionPicker"
    />
    <AppWheelPickerPopup
      v-model:show="showAxisPicker"
      :title="activeAxisTitle"
      :options="activeAxisOptions"
      :model-value="axisPickerIndex"
      @confirm="confirmAxisPicker"
    />

    <AppRechargeModal
      v-model:open="showRechargeModal"
      analytics-scene="agent_create"
      :default-tab="rechargeDefaultTab"
      :is-vip="userIsVip"
      :points="userPoints"
      :vip-name="userVipName"
      :vip-expire-date="userVipExpire"
      :vip-type="userVipType"
      :insufficient="rechargeInsufficient"
      @purchased="onPayPurchased"
    />
    <AppLimitedOfferHost />
  </AppPageShell>
</template>

<style scoped lang="scss">
.create-page {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.create-hero {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  width: 750rpx;
  height: 564rpx;
  overflow: hidden;
  pointer-events: none;
}

.create-body {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 1;
  width: 100%;
  box-sizing: border-box;
}

.form-inner {
  padding: 0;
  padding-top: calc(
    564rpx - 220rpx - var(--app-safe-top) - var(--app-header-content)
  );
  box-sizing: border-box;
}

.create-hero-img {
  width: 750rpx;
  height: 564rpx;
  display: block;
}

.create-nav-spacer {
  width: 8rpx;
  height: 8rpx;
}

.create-hero-title {
  position: absolute;
  left: 32rpx;
  right: 200rpx;
  top: calc(var(--app-safe-top) + var(--app-header-content) + 4rpx);
  z-index: 2;
  font-size: 48rpx;
  font-weight: 500;
  line-height: 1.15;
  color: #ffffff;
  letter-spacing: 1rpx;
}

.form-sheet {
  position: relative;
  z-index: 1;
  margin-top: 0;
  padding-top: 24rpx;
  padding-bottom: 8rpx;
  border-radius: 40rpx 40rpx 0 0;
  background: linear-gradient(
    180deg,
    rgba(10, 10, 10, 0.72) 0%,
    var(--bg, #0a0a0a) 120rpx
  );
  overflow: hidden;
}

.theme-light .form-sheet {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.88) 0%,
    var(--bg, #ffffff) 120rpx
  );
}

.create-page :deep(.age-slider--ticks) {
  padding: 8rpx 0 0;
}

.age-ticks {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32rpx;
}

.age-tick {
  width: 4rpx;
  height: 16rpx;
  border-radius: 2rpx;
  flex-shrink: 0;
}

.age-tick.major {
  height: 28rpx;
}

.age-legend {
  position: relative;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 12rpx;
  min-height: 32rpx;
}

.age-end {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 1;
  color: rgba(255, 255, 255, 0.45);
}

.age-now {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  z-index: 2;
  min-width: 40rpx;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 1;
  text-align: center;
  color: #ffffff;
  pointer-events: none;
}

.theme-light .age-end {
  color: rgba(26, 26, 26, 0.4);
}

.theme-light .age-now {
  color: #1a1a1a;
}

.autofill-btn {
  min-width: 156rpx;
  padding: 16rpx 24rpx;
  border-radius: 200rpx;
  background: rgba(10, 10, 10, 0.6);
  border: 1rpx solid rgba(255, 255, 255, 0.2);
  box-sizing: border-box;
}

.autofill-btn-text {
  font-size: 24rpx;
  font-weight: 400;
  line-height: 24rpx;
  color: #ffffff;
}

.create-page :deep(.label) {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  margin-bottom: 16rpx;
  font-size: 28rpx;
  font-weight: 500;
  color: var(--fg, #fafafa);
}

.create-page :deep(.required) {
  color: #ff659b;
  margin: 0;
  font-size: 28rpx;
  font-weight: 500;
}

.create-page :deep(.label-text) {
  font-size: 28rpx;
  font-weight: 500;
  color: var(--fg, #fafafa);
}

.create-page :deep(.input-field) {
  min-height: 80rpx;
  padding: 24rpx;
  font-size: 24rpx;
  font-weight: 400;
  border-radius: 200rpx;
  background: transparent;
  border: 1rpx solid rgba(255, 255, 255, 0.2);
}

.theme-light .create-page :deep(.input-field) {
  border-color: rgba(10, 10, 10, 0.16);
}

.create-page :deep(.gender-row) {
  flex-wrap: wrap;
  gap: 16rpx;
}

.create-page :deep(.gender-btn) {
  flex: none;
  height: auto;
  min-height: 0;
  line-height: 1.2;
  margin: 0;
  padding: 24rpx 32rpx;
  font-size: 24rpx;
  font-weight: 400;
  border-radius: 200rpx;
  background: transparent;
  color: var(--fg, #fafafa);
  border: 1rpx solid rgba(255, 255, 255, 0.2);
}

.theme-light .create-page :deep(.gender-btn) {
  border-color: rgba(10, 10, 10, 0.16);
}

.create-page :deep(.gender-btn.active) {
  background: transparent;
  color: var(--fg, #fafafa);
  border-color: #b933e6;
}

.create-page :deep(.tag-row) {
  gap: 16rpx;
}

.create-page :deep(.tag-btn) {
  padding: 24rpx 32rpx;
  font-size: 24rpx;
  font-weight: 400;
  color: var(--fg, #fafafa);
  background: transparent;
  border: 1rpx solid rgba(255, 255, 255, 0.2);
}

.theme-light .create-page :deep(.tag-btn) {
  border-color: rgba(10, 10, 10, 0.16);
}

.create-page :deep(.tag-btn.active) {
  background: transparent;
  color: var(--fg, #fafafa);
  border-color: #b933e6;
}

.create-page :deep(.textarea-shell) {
  padding: 24rpx;
  border-radius: 40rpx;
  background: transparent;
  border: 1rpx solid rgba(255, 255, 255, 0.2);
}

.theme-light .create-page :deep(.textarea-shell) {
  border-color: rgba(10, 10, 10, 0.16);
}

.create-page :deep(.textarea-shell--story) {
  min-height: 400rpx;
}

.create-page :deep(.textarea-shell--story .textarea-native) {
  height: 352rpx;
  min-height: 352rpx;
}

.create-page :deep(.textarea-shell--mid) {
  min-height: 200rpx;
}

.create-page :deep(.textarea-shell--mid .textarea-native) {
  height: 152rpx;
  min-height: 152rpx;
}

.create-page :deep(.textarea-native) {
  font-size: 24rpx;
  font-weight: 400;
}

.create-page :deep(.preview-card-wrapper) {
  border-radius: 40rpx;
  border: none;
  overflow: hidden;
  background:
    radial-gradient(
      110% 80% at 50% 50%,
      rgba(185, 51, 230, 0.4) 0%,
      rgba(185, 51, 230, 0.2) 42%,
      #16101c 100%
    );
}

.create-page :deep(.preview-card-inner) {
  padding: 28rpx 24rpx;
  gap: 24rpx;
  align-items: center;
}

.create-page :deep(.preview-avatar) {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: visible;
  box-shadow: 0 0 28rpx 6rpx rgba(185, 51, 230, 0.4);
}

.create-page :deep(.preview-avatar .avatar-root),
.create-page :deep(.preview-avatar .size-lg) {
  width: 128rpx !important;
  height: 128rpx !important;
  border-radius: 50%;
  overflow: hidden;
}

.create-page :deep(.preview-info) {
  gap: 10rpx;
}

.preview-name-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx;
}

.create-page :deep(.preview-name) {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.2;
}

.create-page :deep(.preview-meta) {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.62);
  font-weight: 400;
}

.preview-chip {
  flex-shrink: 0;
  padding: 4rpx 14rpx;
  border-radius: 32rpx;
  font-size: 20rpx;
  line-height: 1.35;
  color: #fff;
}

.preview-chip-mbti {
  background: rgba(232, 140, 90, 0.42);
}

.preview-chip-ori {
  background: rgba(90, 140, 255, 0.42);
}

.preview-dash {
  width: 100%;
  margin: 8rpx 0 4rpx;
  border-top: 2rpx dashed rgba(255, 255, 255, 0.22);
}

.preview-tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.preview-tag {
  padding: 10rpx 20rpx;
  border-radius: 32rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.08);
  border: 1rpx solid rgba(255, 255, 255, 0.18);
}

.theme-light .create-page :deep(.preview-card-wrapper) {
  background: #f2f0f4;
}

.theme-light .create-page :deep(.preview-avatar) {
  box-shadow: none;
}

.theme-light .create-page :deep(.preview-name) {
  color: #1a1a1a;
}

.theme-light .create-page :deep(.preview-meta) {
  color: rgba(26, 26, 26, 0.45);
}

.theme-light .preview-chip {
  color: rgba(26, 26, 26, 0.75);
}

.theme-light .preview-chip-mbti {
  background: rgba(255, 198, 160, 0.7);
}

.theme-light .preview-chip-ori {
  background: rgba(186, 214, 255, 0.85);
}

.theme-light .preview-dash {
  border-top-color: rgba(10, 10, 10, 0.12);
}

.theme-light .preview-tag {
  color: rgba(26, 26, 26, 0.42);
  background: rgba(10, 10, 10, 0.05);
  border-color: transparent;
}

.theme-light .create-footer .submit-btn,
.theme-light .create-footer .submit-btn.ready {
  color: rgba(26, 26, 26, 0.38) !important;
  background: rgba(10, 10, 10, 0.08) !important;
  opacity: 1;
}

.create-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  padding: 16rpx var(--page-gutter, 32rpx) 0;
  background: var(--bg, #0a0a0a);
  transform: translateZ(0);
}

.create-footer .submit-btn {
  margin: 0 !important;
  min-height: 96rpx;
  padding: 32rpx;
  font-size: 32rpx;
  font-weight: 600;
  border-radius: 200rpx !important;
  color: #ffffff !important;
  background: rgba(255, 255, 255, 0.1) !important;
  opacity: 0.5;
}

.create-footer .submit-btn.ready {
  opacity: 1;
  color: #ffffff !important;
  background: rgba(255, 255, 255, 0.1) !important;
}

/* 弹层与壳层 column 同级时，u-popup 默认 flex:1 会撑高并被底栏盖住 */
:deep(.u-popup) {
  flex: none !important;
  flex-grow: 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
}

.create-picker-open :deep(.u-popup.awp-host-open),
.create-picker-open :deep(.awp-host-open) {
  position: fixed !important;
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  bottom: 0 !important;
  width: auto !important;
  height: auto !important;
  overflow: hidden !important;
  z-index: 12000 !important;
}

.submit-btn.is-busy,
.submit-btn[disabled] {
  pointer-events: none;
}
</style>

<style lang="scss">
/* 顶栏返回键在壳层内，需非 scoped 才能压过浅色主题 */
.create-shell .back-ico.icon-on-fg {
  filter: brightness(0) invert(1);
}

/* H5：整页含背景上移一个顶栏高度（58），并去掉 uni-app 的 window-top 垫层 */
/* #ifdef H5 */
html {
  --window-top: 0px !important;
  --status-bar-height: 0px !important;
}
uni-page-head,
.uni-page-head {
  display: none !important;
}
uni-page-body,
.uni-page-body,
.uni-page-wrapper {
  padding-top: 0 !important;
  top: 0 !important;
}
.create-shell.app-shell {
  transform: translateY(-58px);
  height: calc(100% + 58px) !important;
}
/* #endif */
</style>
