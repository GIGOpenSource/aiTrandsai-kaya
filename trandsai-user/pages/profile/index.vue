<script setup>
/**
 * @file pages/profile — 我的 Tab：个人中心
 * @description 资料展示/编辑、头像与背景图上传、主题切换、统计与功能菜单入口。
 * @depends apiFetch、uploadImage、theme store、chat store
 */
import {
	ref,
	computed,
	onMounted,
} from "vue";
import {
	onShow
} from "@dcloudio/uni-app";
import {
	useI18n
} from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import { useStatusBar, HEADER_CONTENT_PX, safeTopCss } from "@/composables/useStatusBar";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
import {
	requireAuth
} from "@/composables/useAuth";
import { useCreateCompanionEntry } from "@/composables/useCreateCompanionEntry";
import {
	getItem,
	setItem,
	removeItem
} from "@/utils/storage";
import {
	useChatStore
} from "@/stores/chat";
import {
	useInboxWsStore
} from "@/stores/inboxWs";
import {
	useThemeStore
} from "@/stores/theme";
import {
	showToast,
} from "@/stores/toast";
import {
	invalidateCompanionsCache
} from "@/utils/companionsCache";
import {
	clearHomeCache
} from "@/utils/homeCache";
import apiFetch, {
	api,
	unwrapApiResults,
} from "@/utils/api";
import {
	uploadImage,
	chooseLocalImages,
	isChooseImageCancel,
} from "@/utils/device";
import {
	setAppLanguage
} from "@/i18n";
import {
	normalizeMediaUrl
} from "@/utils/media";
import {
	pushUiLanguageToServer
} from "@/utils/userLanguageSync";
import {
	bindAnalyticsTap,
	trackButtonClick
} from "@/utils/analytics";
import {
	openPrivacyPolicy
} from "@/utils/openPrivacy";
import { devLog } from "@/utils/devLog";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import AppLimitedOfferHost from "@/components/AppLimitedOfferHost.vue";
import AppWheelPickerPopup from "@/components/AppWheelPickerPopup.vue";
import {
	trackProductEvent,
	PRODUCT_EVENTS,
} from "@/utils/firebaseProductAnalytics";
import { resetHomeDree0Timer } from "@/utils/productAnalyticsHelpers";

const safe = useStatusBar();
/**
 * 头图 padding：scroll-view 绝对铺满 body（含顶栏占位），文字仍从标题行下开始。
 * 不要再给 scroll-view 负 margin，否则整页高出 WebView，iOS 会带着顶栏一起弹。
 */
const headerBgStyle = computed(() => ({
	paddingTop: `calc(${safeTopCss(safe.value.safeAreaTop)} + ${HEADER_CONTENT_PX}px)`,
}));

function loadCachedUser() {
	try {
		const raw = getItem("user_info");
		return raw ? (JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

function persistUserInfo(next) {
	try {
		setItem("user_info", JSON.stringify(next));
	} catch {
		/* ignore */
	}
}

function patchUserInfo(partial) {
	try {
		const raw = getItem("user_info");
		if (!raw) return;
		const parsed = JSON.parse(raw);
		Object.assign(parsed, partial);
		setItem("user_info", JSON.stringify(parsed));
	} catch {
		/* ignore */
	}
}

function path() {
	uni.navigateTo({
		url: '/pages-sub/settings/index'
	});
}
// ——— 用户状态与编辑表单 ———

const {
	t,
	locale
} = useI18n();
const chat = useChatStore();
const themeStore = useThemeStore();

const user = ref(loadCachedUser());
const stats = ref({
	companion_count: 0,
	total_turns: 0,
	days_together: 0,
});
const loading = ref(
	Boolean(getItem("user_token")) && !getItem("user_info")
);

const showEditProfile = ref(false);
const showGenderPicker = ref(false);
const showOrientationPicker = ref(false);
const editNickname = ref("");
const editSexualOrientation = ref("");
const editGender = ref("保密");
const editAge = ref("");
const editRegion = ref("");
const editOccupation = ref("");
const editLoading = ref(false);
const pickerOpen = computed(
	() => showGenderPicker.value || showOrientationPicker.value
);

const showLangPicker = ref(false);
const showAbout = ref(false);
const showLogoutConfirm = ref(false);
const avatarUploading = ref(false);
const bgUploading = ref(false);

// 会员 / 积分：从登录缓存读取
const cachedUser = loadCachedUser();
devLog("user_info 缓存内容:", cachedUser);
const isVip = ref(Boolean(cachedUser?.is_vip));
const vipExpireDate = ref(cachedUser?.vip_expire_at || "");
const vipName = ref(cachedUser?.vip_name || "");
const vipType = ref(cachedUser?.vip_type || "");
const points = ref(cachedUser?.credits || 0);
const showRechargeModal = ref(false);
const rechargeTab = ref("vip");

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

const vipExpireText = computed(() => {
	if (isVip.value && (vipType.value === "lifetime" || !vipExpireDate.value)) {
		return t("recharge.vipLifetime");
	}
	if (!vipExpireDate.value) return "";
	const d = new Date(vipExpireDate.value);
	if (Number.isNaN(d.getTime())) return vipExpireDate.value;
	const lang = String(locale.value || "zh").split("-")[0];
	try {
		return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : lang, {
			year: "numeric",
			month: "long",
			day: "numeric",
		}).format(d);
	} catch {
		if (lang === "zh") {
			return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
		}
		return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
	}
});

function onVipTap() {
	rechargeTab.value = "vip";
	showRechargeModal.value = true;
}

function onPointsTap() {
	rechargeTab.value = "points";
	showRechargeModal.value = true;
}

/** 充值弹窗支付成功回调，用弹窗返回的最新用户数据刷新页面状态 */
function onPayPurchased({ userData } = {}) {
	if (!userData) return;
	isVip.value = Boolean(userData.is_vip);
	points.value = Number(userData.credits) || 0;
	vipName.value = userData.vip_name || "";
	vipExpireDate.value = userData.vip_expire_at || "";
	vipType.value = userData.vip_type || "";
}

const genderValueKeys = ["男", "女", "保密"];
const genderPickerLabels = computed(() => [
	t("register.male"),
	t("register.female"),
	t("register.secret"),
]);
const GENDER_ALIAS = {
	男: "男",
	女: "女",
	保密: "保密",
	male: "男",
	female: "女",
	Male: "男",
	Female: "女",
	MALE: "男",
	FEMALE: "女",
	man: "男",
	woman: "女",
	secret: "保密",
	Secret: "保密",
	SECRET: "保密",
	other: "保密",
	Other: "保密",
	unknown: "保密",
	Unknown: "保密",
	无: "保密",
	不明: "保密",
};

function normalizeGender(value) {
	if (value == null || value === "") return "保密";
	const raw = String(value).trim();
	if (GENDER_ALIAS[raw]) return GENDER_ALIAS[raw];
	const lower = raw.toLowerCase();
	if (GENDER_ALIAS[lower]) return GENDER_ALIAS[lower];
	return "保密";
}

function displayGender(value) {
	const g = normalizeGender(value);
	if (g === "男") return t("register.male");
	if (g === "女") return t("register.female");
	return t("register.secret");
}

const orientationValues = [
	"heterosexual",
	"homosexual",
	"bisexual",
	"pansexual",
	"asexual",
	"secret",
];

const languages = [
	// 暂时隐藏中文，文案仍保留在 i18n/locales/zh.json，恢复时取消注释即可
	// {
	// 	code: "zh",
	// 	label: "中文",
	// 	flag: "🇨🇳"
	// },
	{
		code: "en",
		label: "English",
		flag: "🇺🇸"
	},
	{
		code: "ja",
		label: "日本語",
		flag: "🇯🇵"
	},
	{
		code: "ko",
		label: "한국어",
		flag: "🇰🇷"
	},
	{
		code: "pt",
		label: "Português",
		flag: "🇧🇷"
	},
	{
		code: "es",
		label: "Español",
		flag: "🇪🇸"
	},
	{
		code: "id",
		label: "Bahasa Indonesia",
		flag: "🇮🇩"
	},
	{
		code: "ar",
		label: "العربية",
		flag: "🇸🇦"
	},
	{
		code: "fa",
		label: "فارسی",
		flag: "🇮🇷"
	},
	{
		code: "ru",
		label: "Русский",
		flag: "🇷🇺"
	},
	{
		code: "bg",
		label: "Български",
		flag: "🇧🇬"
	},
	{
		code: "tr",
		label: "Türkçe",
		flag: "🇹🇷"
	},
];

// ——— 菜单与展示计算 ———

const menuItems = computed(() => [{
	icon: "✨",
	label: t("home.createCompanion"),
	path: "/pages-sub/create/index",
	requireAuth: true,
},
{
	icon: "🤖",
	label: t("messages.myCreatedCompanions"),
	hint: t("messages.checkDesc"),
	path: "/pages-sub/my-companions/index?mine=1",
	requireAuth: true,
},
{
	icon: "👥",
	label: t("profile.myCompanions"),
	hint: t("profile.myCompanionsHint"),
	path: "/pages-sub/my-companions/index",
	requireAuth: true,
},
{
	icon: "📝",
	label: t("profile.myMoments"),
	path: "/pages-sub/my-posts/index",
	requireAuth: true,
},
{
	icon: "💕",
	label: t("profile.intimacyRecord"),
	path: "/pages-sub/intimacy/index",
	requireAuth: true,
},
{
	icon: "🔔",
	label: t("profile.notificationSettings"),
	path: "/pages-sub/notification-settings/index",
	requireAuth: true,
},
// {
//   icon: "📬",
//   label: t("notifications.title"),
//   path: "/pages-sub/notifications/index",
//   requireAuth: true,
// },
{
	icon: "🌐",
	label: t("profile.languagePreference"),
	action: () => {
		showLangPicker.value = true;
	},
},
{
	icon: "🛡",
	label: t("profile.privacyPolicy"),
	action: openPrivacyPolicy,
	requireAuth: true,
},
	// {
	//   icon: "ℹ️",
	//   label: t("profile.aboutUs"),
	//   action: () => {
	//     showAbout.value = true;
	//   },
	// },
]);

const visibleMenuItems = computed(() =>
	menuItems.value.filter((item) => !item.requireAuth || user.value)
);

const genderPickerIndex = computed(() => {
	const idx = genderValueKeys.indexOf(normalizeGender(editGender.value));
	return idx >= 0 ? idx : 2;
});

const orientationPickerIndex = computed(() => {
	const idx = orientationValues.indexOf(editSexualOrientation.value);
	return idx >= 0 ? idx : 0;
});

const genderWheelOptions = computed(() =>
	genderValueKeys.map((key, i) => ({
		label: genderPickerLabels.value[i],
		value: key,
	}))
);

const orientationWheelOptions = computed(() =>
	orientationValues.map((v) => ({
		label: sexualOrientationLabel(v),
		value: v,
	}))
);

const avatarSrc = computed(() => {
	if (!user.value?.avatar_url) return "";
	return normalizeMediaUrl(user.value.avatar_url) || user.value.avatar_url;
});

/** 资料背景只开放 1 张，展示取第 0 项 */
function backgroundListFrom(raw) {
	if (Array.isArray(raw)) {
		return raw.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 1);
	}
	const one = String(raw || "").trim();
	return one ? [one] : [];
}

function pickBackgroundPayload(body) {
	if (!body || typeof body !== "object") return {};
	const inner = body.results;
	if (inner && typeof inner === "object" && !Array.isArray(inner)) {
		if (
			inner.profile_backgrounds != null ||
			inner.profile_background_review_status != null ||
			inner.cleared != null ||
			inner.id != null
		) {
			return inner;
		}
	}
	return body;
}

const profileBgSrc = computed(() => {
	// 只展示 profile_backgrounds。空数组就是没有背景，不能再回退到待审图。
	const url = backgroundListFrom(user.value?.profile_backgrounds)[0] || "";
	if (!url) return "";
	return normalizeMediaUrl(url) || url;
});

const profileBgPending = computed(
	() => user.value?.profile_background_review_status === "pending"
);

const genderEmoji = computed(() => {
	const g = normalizeGender(user.value?.gender);
	if (g === "男") return "👨";
	if (g === "女") return "👩";
	return "👤";
});

const genderDisplayText = computed(() => displayGender(user.value?.gender));

function sexualOrientationLabel(value) {
	if (!value) return "";
	const raw = String(value).trim();
	const lower = raw.toLowerCase();
	const ORIENT_ALIAS = {
		heterosexual: "heterosexual",
		homosexual: "homosexual",
		bisexual: "bisexual",
		pansexual: "pansexual",
		asexual: "asexual",
		secret: "secret",
		异性恋: "heterosexual",
		同性恋: "homosexual",
		双性恋: "bisexual",
		泛性恋: "pansexual",
		无性恋: "asexual",
		保密: "secret",
	};
	const key = ORIENT_ALIAS[raw] || ORIENT_ALIAS[lower];
	if (key === "heterosexual") return t("register.heterosexual");
	if (key === "homosexual") return t("register.homosexual");
	if (key === "bisexual") return t("register.bisexual");
	if (key === "pansexual") return t("register.pansexual");
	if (key === "asexual") return t("register.asexual");
	if (key === "secret") return t("register.secret");
	return t("register.secret");
}

function onMenuItem(item) {
	if (item.action) {
		item.action();
		return;
	}
	if (item.requireAuth && !requireAuth()) return;
	const path = String(item.path || "");
	if (path.includes("/pages-sub/create/index")) {
		void enterCreateCompanion({ page: "profile", source: "menu", url: path });
		return;
	}
	if (item.path) uni.navigateTo({
		url: item.path
	});
}

function onMenuItemTap(item, index) {
	trackButtonClick(`profile-menu-${index}`, `个人中心菜单-${item.label}`);
	onMenuItem(item);
}

function openEditProfile() {
	if (!user.value) return;
	editNickname.value = user.value.nickname || user.value.username || "";
	editSexualOrientation.value = user.value.sexual_orientation || "";
	editGender.value = normalizeGender(user.value.gender || "保密");
	editAge.value =
		user.value.age != null && user.value.age !== undefined ?
			String(user.value.age) :
			"";
	editRegion.value = user.value.region || "";
	editOccupation.value = user.value.occupation || "";
	showEditProfile.value = true;
}

function openGenderPicker() {
	showGenderPicker.value = true;
}

function confirmGenderPicker(idx) {
	editGender.value = genderValueKeys[Number(idx)] || "保密";
	showGenderPicker.value = false;
}

function openOrientationPicker() {
	showOrientationPicker.value = true;
}

function confirmOrientationPicker(idx) {
	editSexualOrientation.value =
		orientationValues[Number(idx)] || "heterosexual";
	showOrientationPicker.value = false;
}

function onAgeInput(e) {
	editAge.value = String(e.detail.value || "").replace(/\D/g, "");
}

// ——— 资料保存与头像 ———

/** 提交 PATCH 保存个人资料字段 */
async function saveProfile() {
	const token = getItem("user_token");
	if (!token || !editNickname.value.trim()) {
		if (!editNickname.value.trim()) {
			showToast(t("profile.enterNickname"));
		}
		return;
	}

	const trimmedAge = editAge.value.trim();
	let n = null;
	if (trimmedAge) {
		n = parseInt(trimmedAge, 10);
		if (Number.isNaN(n) || n < 18 || n > 99) {
			showToast(t("profile.invalidAge"));
			return;
		}
	}

	editLoading.value = true;
	try {
		const prev = user.value || {};
		const nextNickname = editNickname.value.trim();
		const nextRegion = editRegion.value.trim();
		const nextOccupation = editOccupation.value.trim();
		const nextOrientation = editSexualOrientation.value;
		const nextGender = editGender.value;
		const fromGender = normalizeGender(prev.gender || "保密");
		const toGender = normalizeGender(nextGender);
		const prevNickname = String(prev.nickname || prev.username || "").trim();
		const needsReview =
			nextNickname !== prevNickname ||
			nextRegion !== String(prev.region || "").trim() ||
			nextOccupation !== String(prev.occupation || "").trim();

		const payload = {
			nickname: nextNickname,
			sexual_orientation: nextOrientation,
			gender: nextGender,
			region: nextRegion,
			occupation: nextOccupation,
		};
		if (n != null) payload.age = n;

		const data = await apiFetch("/api/auth/me", {
			method: "PATCH",
			data: payload,
		});

		const nextUser = {
			...(user.value || {}),
			nickname: data.nickname ?? nextNickname,
			sexual_orientation: data.sexual_orientation ?? nextOrientation,
			gender: normalizeGender(data.gender ?? nextGender),
			age: n != null ? (data.age ?? n) : (data.age ?? prev.age ?? null),
			region: data.region ?? nextRegion,
			occupation: data.occupation ?? nextOccupation,
		};
		if (user.value) {
			user.value = nextUser;
			persistUserInfo(user.value);
		} else {
			patchUserInfo(nextUser);
		}
		if (fromGender !== toGender) {
			trackProductEvent(PRODUCT_EVENTS.PROFILE_GENDER_CHANGE, {
				page: "profile",
				from_gender: fromGender,
				to_gender: toGender,
			});
		}
		showToast(
			t(needsReview ? "profile.pendingReview" : "profile.updateSuccess")
		);
		showEditProfile.value = false;
	} catch {
		showToast(t("common.networkError"));
	} finally {
		editLoading.value = false;
	}
}

async function onAvatarTap() {
	const token = getItem("user_token");
	if (!token || !user.value || avatarUploading.value) return;

	let filePath = "";
	try {
		const picked = await chooseLocalImages(1, {
			sizeType: ["compressed"],
			sourceType: ["album", "camera"],
			onPreparing: () => {
				avatarUploading.value = true;
			},
		});
		filePath = picked?.[0] || "";
	} catch (err) {
		avatarUploading.value = false;
		if (isChooseImageCancel(err)) return;
		showToast(t("profile.avatarUploadFailed"));
		return;
	}
	if (!filePath) {
		avatarUploading.value = false;
		return;
	}

	avatarUploading.value = true;
	try {
		const up = await uploadImage(filePath);
		const url = up.url;
		if (!url) {
			showToast(t("profile.avatarUploadFailed"));
			return;
		}

		const j = await apiFetch("/api/auth/me", {
			method: "PATCH",
			data: {
				avatar_url: url,
			},
		});

		const savedUrl = j.avatar_url || url;
		if (user.value) {
			user.value = {
				...user.value,
				avatar_url: savedUrl,
			};
			persistUserInfo(user.value);
		} else {
			patchUserInfo({
				avatar_url: savedUrl,
			});
		}
		showToast(t("profile.pendingReview"));
		trackProductEvent(PRODUCT_EVENTS.AVATAR_UPLOAD, {
			page: "profile",
		});
	} catch (e) {
		console.error("头像上传失败:", e);
		showToast(t("profile.avatarUploadFailed"));
	} finally {
		avatarUploading.value = false;
	}
}

/** 背景图提交进行中时，更早发出的 /me 不能把旧图盖回来 */
let profileMutationEpoch = 0;

function applyClearedBackground(body) {
	const payload = pickBackgroundPayload(body);
	const partial = {
		profile_backgrounds: [],
		profile_backgrounds_pending: null,
		profile_background_review_status: null,
	};
	if (payload.profile_review_status !== undefined) {
		partial.profile_review_status = payload.profile_review_status;
	}
	const pendingObj = user.value?.profile_pending;
	if (pendingObj && typeof pendingObj === "object") {
		const nextPending = {
			...pendingObj,
		};
		delete nextPending.profile_backgrounds;
		partial.profile_pending = nextPending;
	}
	if (user.value) {
		user.value = {
			...user.value,
			...partial,
		};
		persistUserInfo(user.value);
	} else {
		patchUserInfo(partial);
	}
}

function applyBackgroundPayload(body, fallbackList) {
	const payload = pickBackgroundPayload(body);
	const list =
		payload.profile_backgrounds != null
			? backgroundListFrom(payload.profile_backgrounds)
			: fallbackList;
	const partial = {
		profile_backgrounds: list,
		profile_backgrounds_pending:
			payload.profile_backgrounds_pending !== undefined
				? payload.profile_backgrounds_pending
				: list.length
					? list
					: null,
		profile_background_review_status:
			payload.profile_background_review_status !== undefined
				? payload.profile_background_review_status
				: list.length
					? "pending"
					: null,
	};
	if (payload.profile_review_status !== undefined) {
		partial.profile_review_status = payload.profile_review_status;
	}
	if (user.value) {
		user.value = {
			...user.value,
			...partial,
		};
		persistUserInfo(user.value);
	} else {
		patchUserInfo(partial);
	}
}

function hideBgLoading() {
	try {
		uni.hideLoading();
	} catch {
		/* ignore */
	}
}

async function pickAndSaveBackground() {
	if (bgUploading.value) return;
	let filePath = "";
	try {
		const picked = await chooseLocalImages(1, {
			sizeType: ["compressed"],
			sourceType: ["album", "camera"],
		});
		filePath = picked?.[0] || "";
	} catch (err) {
		if (isChooseImageCancel(err)) return;
		showToast(t("profile.backgroundSaveFailed"));
		return;
	}
	if (!filePath) return;

	bgUploading.value = true;
	const epoch = ++profileMutationEpoch;
	uni.showLoading({
		title: t("common.loading"),
		mask: true,
	});
	try {
		const up = await uploadImage(filePath);
		const url = up?.url;
		if (!url) {
			hideBgLoading();
			showToast(t("profile.backgroundSaveFailed"));
			return;
		}
		const body = await apiFetch("/api/auth/me/profile-backgrounds", {
			method: "PATCH",
			data: {
				profile_backgrounds: [url],
			},
		});
		if (epoch !== profileMutationEpoch) {
			hideBgLoading();
			return;
		}
		applyBackgroundPayload(body, [url]);
		profileMutationEpoch++;
		hideBgLoading();
		showToast(t("profile.pendingReview"));
	} catch (e) {
		console.error("背景图上传失败:", e);
		hideBgLoading();
		showToast(e?.message || t("profile.backgroundSaveFailed"));
	} finally {
		bgUploading.value = false;
	}
}

async function clearBackground() {
	if (bgUploading.value) return;
	bgUploading.value = true;
	const epoch = ++profileMutationEpoch;
	uni.showLoading({
		title: t("common.loading"),
		mask: true,
	});
	try {
		const body = await apiFetch("/api/auth/me/profile-backgrounds", {
			method: "PATCH",
			data: {
				profile_backgrounds: [],
			},
		});
		if (epoch !== profileMutationEpoch) {
			hideBgLoading();
			return;
		}
		// 清空立即生效。回包里的待审预览不能再当作当前背景。
		applyClearedBackground(body);
		profileMutationEpoch++;
		hideBgLoading();
		showToast(t("profile.backgroundCleared"));
	} catch (e) {
		hideBgLoading();
		showToast(e?.message || t("profile.backgroundSaveFailed"));
	} finally {
		bgUploading.value = false;
	}
}

/** 昵称区域不触发换背景 */
function onUserMetaTap() {}

/** 点背景图换图：没有图直接选，已有图可更换或清空（清空立即生效） */
function onBackgroundTap() {
	const token = getItem("user_token");
	if (!token || !user.value || bgUploading.value) return;
	const existing = backgroundListFrom(user.value.profile_backgrounds);
	const pending = backgroundListFrom(user.value.profile_backgrounds_pending);
	if (!existing.length && !pending.length) {
		void pickAndSaveBackground();
		return;
	}
	uni.showActionSheet({
		itemList: [
			t("profile.changeBackground"),
			t("profile.clearBackground"),
		],
		success: (res) => {
			if (res.tapIndex === 0) void pickAndSaveBackground();
			else if (res.tapIndex === 1) void clearBackground();
		},
	});
}

// ——— 语言 / 登出 / 主题 ———

function selectLanguage(code) {
	setAppLanguage(code);
	showLangPicker.value = false;
	void pushUiLanguageToServer(code);
	uni.reLaunch({
		url: "/pages/profile/index"
	});
}

async function handleLogout() {
	try {
		await apiFetch("/api/auth/logout", { method: "POST" });
	} catch {
		/* ignore */
	}
	chat.disconnectAll();
	try {
		useInboxWsStore().disconnect();
	} catch {
		/* ignore */
	}
	invalidateCompanionsCache();
	clearHomeCache();
	resetHomeDree0Timer();
	removeItem("user_token");
	removeItem("user_info");
	uni.reLaunch({
		url: "/pages/login/index"
	});
}

function goLogin() {
	uni.reLaunch({
		url: "/pages/login/index"
	});
}

function promptLogout() {
	showLogoutConfirm.value = true;
}

function toggleTheme() {
	devLog('toggleTheme called, isDark before:', themeStore.isDark);
	themeStore.toggleTheme();
	devLog('isDark after:', themeStore.isDark);
}
// ——— 后台刷新 ———

/** 把 /api/auth/me 结果同步到页面 VIP/积分展示（含多语言 vip_name） */
function applyMeToVipState(userData) {
	if (!userData || typeof userData !== "object") return;
	isVip.value = Boolean(userData.is_vip);
	vipExpireDate.value = userData.vip_expire_at || "";
	vipName.value = userData.vip_name || "";
	vipType.value = userData.vip_type || "";
	points.value = Number(userData.credits ?? userData.balance ?? 0) || 0;
}

/** 静默刷新用户信息与统计数据 */
let meLoading = false;
async function loadBackgroundData() {
	const token = getItem("user_token");
	if (!token) {
		loading.value = false;
		return;
	}
	if (meLoading) return;
	meLoading = true;

	try {
		const epoch = profileMutationEpoch;
		const [meRaw, statsRaw] = await Promise.all([
			api.get("/api/auth/me").catch(() => null),
			api.get("/api/users/stats").catch(() => null),
		]);

		let userData = meRaw ? unwrapApiResults(meRaw) || meRaw : null;
		if (
			epoch !== profileMutationEpoch &&
			userData &&
			typeof userData === "object" &&
			user.value
		) {
			userData = {
				...userData,
				profile_backgrounds: user.value.profile_backgrounds ?? [],
				profile_backgrounds_pending: user.value.profile_backgrounds_pending ?? null,
				profile_background_review_status:
					user.value.profile_background_review_status ?? null,
				profile_pending: user.value.profile_pending,
			};
		}
		const statsData = statsRaw ? unwrapApiResults(statsRaw) || statsRaw : null;

		if (userData && typeof userData === "object") {
			const prev = loadCachedUser() || {};
			const nextUser = {
				...prev,
				...userData,
				avatar_url: userData.avatar_url || prev.avatar_url || "",
				region: userData.region || prev.region || "",
				occupation: userData.occupation || prev.occupation || "",
			};
			user.value = nextUser;
			persistUserInfo(nextUser);
			applyMeToVipState(nextUser);
		}

		if (statsData && typeof statsData === "object") {
			stats.value = {
				companion_count: statsData.intimate_companion_count ?? statsData.companion_count ?? 0,
				total_turns: statsData.total_turns ?? 0,
				days_together: statsData.max_days_together ?? statsData.days_together ?? 0,
			};
		}
	} catch (err) {
		console.error(err);
	} finally {
		loading.value = false;
		meLoading = false;
	}
}

onMounted(() => {
	loadBackgroundData();
});

onShow(() => {
	// 先用缓存立刻上屏，再拉 /api/auth/me（设置页切语言后 vip_name 会随 Accept-Language 变）
	const fresh = loadCachedUser();
	if (fresh) {
		applyMeToVipState(fresh);
		if (!user.value) user.value = fresh;
	}
	void loadBackgroundData();
});
</script>

<template>
	<page-meta
		bounce="none"
		page-style="overflow: hidden; height: 100%; width: 100%;"
	/>
	<AppPageShell
		:show-header="false"
		show-tab-bar
		:tab-bar-hidden="pickerOpen"
		transparent-header
		fill-webview
		:class="{ 'sheet-picker-open': pickerOpen }"
	>
		<template #header>
			<view class="page-header">
				<text class="page-header-title" :class="{ 'on-photo': profileBgSrc }">{{ t("profile.title") }}</text>
				<view v-if="user" class="page-header-edit" @tap="openEditProfile">
					<image class="header-edit-icon" :class="{ 'on-photo': profileBgSrc }" src="/static/profile/edit.svg" mode="aspectFit" />
				</view>
			</view>
		</template>
		<scroll-view
			scroll-y
			class="page-scroll"
			:enhanced="true"
			:bounces="false"
			@touchmove.stop
		>
			<view class="page-body">
				<!-- 头部背景图区域：有已通过/预览图则展示，点击更换（与头像同一套审核） -->
				<view class="profile-header-bg"
					:class="profileBgSrc
						? 'profile-header-bg--photo'
						: ['shell-header-glow', themeStore.isDark ? 'shell-header-glow--dark' : 'shell-header-glow--light']"
					:style="headerBgStyle"
					@tap="onBackgroundTap">
					<image v-if="profileBgSrc" class="profile-header-photo" :src="profileBgSrc" mode="aspectFill" />
					<view v-if="profileBgSrc" class="profile-header-scrim" />
					<text v-if="profileBgPending" class="profile-bg-pending">{{ t("profile.backgroundReviewPending") }}</text>
					<!-- 用户信息 -->
					<view class="user-section">
						<template v-if="loading && !user">
							<view class="avatar-block skeleton-avatar-wrap">
								<view class="avatar-placeholder skeleton" />
							</view>
							<view class="user-meta-skeleton-center">
								<view class="skeleton skel-name-center" />
								<view class="skeleton skel-id-center" />
							</view>
						</template>
						<template v-else>
							<view class="avatar-block center-avatar" @tap.stop="onAvatarTap">
								<view v-if="avatarSrc" class="profile-avatar-wrap">
									<AppAvatarImage size="lg" :src="avatarSrc" :seed="`user-${user?.id}`"
										:generating="avatarUploading" />
								</view>
								<view v-else class="avatar-placeholder">
									<text class="avatar-emoji">{{ genderEmoji }}</text>
								</view>
							</view>

							<view class="user-meta-center" @tap.stop="onUserMetaTap">
								<text class="user-name-center">
									{{ user?.nickname || user?.username || t("profile.notLoggedIn") }}
								</text>
								<text v-if="user" class="user-id-center">
									ID:{{ user.id }}
								</text>
								<view v-if="user?.sexual_orientation" class="orientation-pill">
									<text class="orientation-pill-text">{{
										sexualOrientationLabel(user.sexual_orientation) }}</text>
								</view>
							</view>
						</template>
					</view>
				</view>
				<!-- /头部背景图区域 -->

				<!-- 会员与积分（CSS 渐变卡面，禁止 PNG 切图） -->
				<view v-if="user" class="recharge-row">
					<view class="recharge-card vip-card" @tap="onVipTap">
						<view class="vip-header">
							<image class="vip-diamond" src="/static/recharge/vip-diamond.webp" mode="aspectFit" />
							<image class="vip-text" src="/static/recharge/vip-text.svg" mode="aspectFit" />
							<text v-if="isVip" class="vip-plan">{{ vipName }}</text>
						</view>
						<view class="recharge-bottom">
							<view v-if="isVip" class="vip-date">
								<text class="vip-date-num">{{ vipExpireText }}</text>
								<text class="vip-date-label">{{ isVip ? t('recharge.renew') : t('recharge.activate')
									}}</text>
							</view>
							<text v-else class="recharge-action">{{ t('recharge.activateNow') }}</text>
							<image class="recharge-arrow-icon" src="/static/recharge/arrow-gold.svg" mode="aspectFit" />
						</view>
					</view>

					<view class="recharge-card points-card" @tap="onPointsTap">
						<view class="points-header">
							<image class="points-icon" src="/static/recharge/points-icon.webp" mode="aspectFit" />
							<text class="points-title">{{ t('recharge.points') }}</text>
						</view>
						<view class="recharge-bottom">
							<text class="points-num">{{ points }}</text>
							<view class="points-action-group">
								<text class="recharge-action">{{ t('recharge.topUp') }}</text>
								<image class="recharge-arrow-icon" src="/static/recharge/arrow-white.svg"
									mode="aspectFit" />
							</view>
						</view>
					</view>
				</view>

				<!-- 统计 -->
				<view class="stats-row">
					<view class="stat-item">
						<text class="stat-num">{{ stats.companion_count }}</text>
						<text class="stat-desc">{{ t("profile.myCompanions") }}</text>
					</view>
					<view class="stat-item">
						<text class="stat-num">{{ stats.total_turns }}</text>
						<text class="stat-desc">{{ t("profile.chatTurns") }}</text>
					</view>
					<view class="stat-item">
						<text class="stat-num">{{ stats.days_together }}</text>
						<text class="stat-desc">{{ t("profile.daysTogether") }}</text>
					</view>
				</view>

				<!-- 菜单：组1 主功能；组2 更多设置（对照 Figma） -->
				<view class="menu-list">
					<view v-if="user" class="menu-group">
						<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
							@tap="onMenuItemTap({ icon: '🤖', label: t('messages.myCreatedCompanions'), hint: t('messages.checkDesc'), path: '/pages-sub/my-companions/index?mine=1', requireAuth: true }, 0)">
							<text class="menu-item-label">{{ t("messages.myCreatedCompanions") }}</text>
							<text v-if="t('messages.checkDesc')" class="menu-item-hint-inline">{{
								t("messages.checkDesc")
							}}</text>
							<text class="menu-chevron">›</text>
						</view>
						<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
							@tap="onMenuItemTap({ icon: '👥', label: t('profile.myCompanions'), hint: t('profile.myCompanionsHint'), path: '/pages-sub/my-companions/index', requireAuth: true }, 1)">
							<text class="menu-item-label">{{ t("profile.myCompanions") }}</text>
							<text v-if="t('profile.myCompanionsHint')" class="menu-item-hint-inline">{{
								t("profile.myCompanionsHint")
							}}</text>
							<text class="menu-chevron">›</text>
						</view>
						<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
							@tap="onMenuItemTap({ icon: '📝', label: t('profile.myMoments'), path: '/pages-sub/my-posts/index', requireAuth: true }, 2)">
							<text class="menu-item-label">{{ t("profile.myMoments") }}</text>
							<text class="menu-chevron">›</text>
						</view>
						<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
							@tap="onMenuItemTap({ icon: '💕', label: t('profile.intimacyRecord'), path: '/pages-sub/intimacy/index', requireAuth: true }, 3)">
							<text class="menu-item-label">{{ t("profile.intimacyRecord") }}</text>
							<text class="menu-chevron">›</text>
						</view>
					</view>

					<view class="menu-group">
						<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
							@tap="path()">
							<text class="menu-item-label">{{ t("profile.moreSettings") }}</text>
							<text class="menu-chevron">›</text>
						</view>
					</view>

					<!-- 组2：Dark Mode / Notifications / Language Preference -->
					<!-- <view class="menu-group">
                            <view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200" @tap="toggleTheme">
                              <text class="menu-item-label">{{ themeStore.isDark ? t("profile.darkMode") : t("profile.lightMode") }}</text>
                              <view class="theme-switch" :class="{ on: themeStore.isDark }">
                                <view class="theme-knob" />
                              </view>
                            </view>
                            <view
                              v-if="user"
                              class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
                              @tap="onMenuItemTap({ icon: '🔔', label: t('profile.notificationSettings'), path: '/pages-sub/notification-settings/index', requireAuth: true }, 6)"
                            >
                              <text class="menu-item-label">{{ t("profile.notificationSettings") }}</text>
                              <text class="menu-chevron">›</text>
                            </view>
                            <view
                              class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
                              @tap="onMenuItemTap({ icon: '🌐', label: t('profile.languagePreference'), action: () => { showLangPicker = true } }, 4)"
                            >
                              <text class="menu-item-label">{{ t("profile.languagePreference") }}</text>
                              <text class="menu-chevron">›</text>
                            </view>
                          </view> -->

					<!-- 组4：Privacy Policy / Feedback / About Us -->
					<!-- <view class="menu-group" v-if="user">
                            <view
                              class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
                              @tap="onMenuItemTap({ icon: '🛡', label: t('profile.privacyPolicy'), action: openPrivacyPolicy, requireAuth: true }, 5)"
                            >
                              <text class="menu-item-label">{{ t("profile.privacyPolicy") }}</text>
                              <text class="menu-chevron">›</text>
                            </view>
                            <view
                              class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
                              @tap="onMenuItemTap({ icon: '💬', label: t('messages.feedback'), path: '/pages-sub/feedback/index', requireAuth: true }, 7)"
                            >
                              <text class="menu-item-label">{{ t("messages.feedback") }}</text>
                              <text class="menu-chevron">›</text>
                            </view>
                            <view
                              class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
                              @tap="showAbout = true"
                            >
                              <text class="menu-item-label">{{ t("profile.aboutUs") }}</text>
                              <text class="menu-chevron">›</text>
                            </view>
                          </view> -->

					<!-- 组5：Logout -->
					<!-- <view class="menu-group" v-if="user">
                            <view
                              class="logout-btn" hover-class="logout-btn-hover" :hover-stay-time="200"
                              @tap="bindAnalyticsTap('profile-logout', promptLogout, '退出登录')"
                            >
                              <text class="logout-text">{{ t("profile.logout") }}</text>
                            </view>
                          </view> -->

					<button v-if="!user" class="btn-login" @tap="bindAnalyticsTap('profile-login', goLogin, '登录')">
						<text>{{ t("login.loginBtn") }}</text>
					</button>
				</view>
			</view>
		</scroll-view>

		<!-- 编辑资料 -->
		<view v-if="showEditProfile" class="modal-mask center" @tap="showEditProfile = false" @touchmove.stop.prevent>
			<view class="modal-card edit-modal" @tap.stop>
				<view class="modal-header-row">
					<text class="modal-title">{{ t("profile.editProfile") }}</text>
					<text class="modal-close" @tap="showEditProfile = false">✕</text>
				</view>

				<scroll-view scroll-y class="edit-form-scroll">
					<view class="form-group">
						<text class="field-label">{{ t("register.nickname") }}</text>
						<input :value="editNickname" class="input-field" :placeholder="t('profile.enterNickname')"
							maxlength="20" @input="editNickname = $event.detail.value" />
					</view>

					<view class="form-group">
						<text class="field-label">{{ t("register.gender") }}</text>
						<view class="input-field picker-field" @tap="openGenderPicker">
							{{ displayGender(editGender) }}
							<text class="picker-arrow">›</text>
						</view>
					</view>

					<view class="form-group">
						<text class="field-label">{{ t("profile.age") }}</text>
						<input :value="editAge" class="input-field" type="number"
							:placeholder="t('profile.agePlaceholder')" @input="onAgeInput" />
					</view>

					<view class="form-group">
						<text class="field-label">{{ t("profile.region") }}</text>
						<input :value="editRegion" class="input-field" :placeholder="t('profile.placeholderRegion')"
							maxlength="120" @input="editRegion = $event.detail.value" />
					</view>

					<view class="form-group">
						<text class="field-label">{{ t("profile.occupation") }}</text>
						<input :value="editOccupation" class="input-field"
							:placeholder="t('profile.placeholderOccupation')" maxlength="100"
							@input="editOccupation = $event.detail.value" />
					</view>

					<view class="form-group">
						<text class="field-label">{{ t("register.sexualOrientation") }}</text>
						<view class="input-field picker-field" @tap="openOrientationPicker">
							{{ sexualOrientationLabel(editSexualOrientation) }}
							<text class="picker-arrow">›</text>
						</view>
					</view>
				</scroll-view>

				<button class="btn-primary save-btn" :disabled="editLoading || !editNickname.trim()"
					@tap="saveProfile">
					<!-- <text v-if="editLoading">{{ t("common.loading") }}</text> -->
					<text>{{ t("common.save") }}</text>
				</button>
			</view>
		</view>

		<!-- 语言选择 -->
		<view v-if="showLangPicker" class="modal-mask bottom" @tap="showLangPicker = false" @touchmove.stop.prevent>
			<view class="modal-sheet lang-sheet" @tap.stop>
				<view class="modal-header-row sheet-header">
					<text class="modal-title">{{ t("profile.selectLanguage") }}</text>
					<text class="modal-close" @tap="showLangPicker = false">✕</text>
				</view>
				<scroll-view scroll-y class="lang-list" :enhanced="true" :bounces="false">
					<view v-for="lang in languages" :key="lang.code" class="lang-item"
						:class="{ active: locale === lang.code }" @tap="selectLanguage(lang.code)">
						<text class="lang-flag">{{ lang.flag }}</text>
						<text class="lang-label">{{ lang.label }}</text>
						<text v-if="locale === lang.code" class="lang-check">✓</text>
					</view>
				</scroll-view>
			</view>
		</view>

		<!-- 关于我们 -->
		<view v-if="showAbout" class="modal-mask center" @tap="showAbout = false" @touchmove.stop.prevent>
			<view class="modal-card about-card" @tap.stop>
				<view class="modal-header-row">
					<text class="modal-title">{{ t("profile.aboutUs") }}</text>
					<text class="modal-close" @tap="showAbout = false">✕</text>
				</view>
				<view class="about-body">
					<view class="about-logo">
						<text class="about-heart">♥</text>
					</view>
					<text class="about-app-name">{{ t("home.title") }}</text>
					<text class="text-muted about-line">trandsai</text>
					<text class="text-muted about-line">支持多语言 · 多智能体 · 沉浸式聊天</text>
					<view class="about-footer">
						<text class="text-muted about-copy">© 2025 trandsai. All rights reserved.</text>
					</view>
				</view>
			</view>
		</view>

		<!-- 退出登录确认 -->
		<AppConfirmDialog :open="showLogoutConfirm" :title="t('profile.logout')"
			:description="t('profile.logoutConfirm')" :confirm-text="t('common.confirm')"
			:cancel-text="t('common.cancel')" destructive @update:open="showLogoutConfirm = $event"
			@confirm="handleLogout" />

		<!-- 会员 / 积分弹窗：入口永远普通充值墙，不切限时优惠 -->
		<AppRechargeModal v-model:open="showRechargeModal" :default-tab="rechargeTab" :is-vip="isVip"
			:vip-plan="isVip ? 'Weekly' : ''" :vip-expire-date="vipExpireDate" :vip-type="vipType" :points="points"
			:vip-name="vipName" skip-limited-offer @purchased="onPayPurchased" />

		<!-- 创建入口会员拦截 -->
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

		<AppWheelPickerPopup
			v-model:show="showGenderPicker"
			:title="t('register.gender')"
			:options="genderWheelOptions"
			:model-value="genderPickerIndex"
			@confirm="confirmGenderPicker"
		/>
		<AppWheelPickerPopup
			v-model:show="showOrientationPicker"
			:title="t('register.sexualOrientation')"
			:options="orientationWheelOptions"
			:model-value="orientationPickerIndex"
			@confirm="confirmOrientationPicker"
		/>
	</AppPageShell>
</template>

<style scoped lang="scss" src="./index.scss"></style>
