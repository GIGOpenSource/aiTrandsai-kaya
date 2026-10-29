<script setup>
	/**
	 * @file pages-sub/settings — 更多设置
	 * @description 主题切换、语言偏好、隐私政策、通知设置、退出登录、注销账号。
	 */
	import {
		ref,
		watch,
		computed
	} from "vue";
	import {
		useI18n
	} from "vue-i18n";
	import AppPageShell from "@/components/AppPageShell.vue";
	import AppConfirmDialog from "@/components/AppConfirmDialog.vue";
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
		setAppLanguage
	} from "@/i18n";
	import {
		invalidateCompanionsCache
	} from "@/utils/companionsCache";
	import {
		clearHomeCache
	} from "@/utils/homeCache";
	import {
		bindAnalyticsTap
	} from "@/utils/analytics";
	import {
		openPrivacyPolicy
	} from "@/utils/openPrivacy";
	import {
		api,
		standardApi,
		unwrapApiResults
	} from "@/utils/api";
	import {
		showToast
	} from "@/stores/toast";
	import {
		resetHomeDree0Timer
	} from "@/utils/productAnalyticsHelpers";
	import {
		fillI18n
	} from "@/utils/createCompanionForm";
	import {
		BRAND_DISPLAY_NAME
	} from "@/utils/constants";
	import {
		pushUiLanguageToServer
	} from "@/utils/userLanguageSync";

	/**
	 * 清理第三方 OAuth 登录缓存（Apple/Google 原生 SDK 层）
	 * 退出登录/注销账号后必须调用，否则再次点击登录不会唤起授权弹窗——
	 * uni.login 会复用原生 SDK 缓存的旧凭证直接走登录流程。
	 *
	 * uni-app 没有 uni.logout API，必须通过 plus.oauth.getServices 拿到
	 * AuthService 后调用 service.logout()，参考 html5plus oauth 文档。
	 */
	function clearOAuthCache() {
		return new Promise((resolve) => {
			// H5 端无 plus 对象，直接放行（H5 仅支持账号密码登录）
			if (typeof plus === "undefined" || !plus.oauth || typeof plus.oauth.getServices !== "function") {
				resolve();
				return;
			}
			plus.oauth.getServices(
				(services) => {
					if (!Array.isArray(services) || services.length === 0) {
						resolve();
						return;
					}
					const targets = services.filter(
						(s) => s && (s.id === "apple" || s.id === "google")
					);
					if (targets.length === 0) {
						resolve();
						return;
					}
					let pending = targets.length;
					const done = () => {
						pending -= 1;
						if (pending <= 0) resolve();
					};
					targets.forEach((s) => {
						try {
							// service.logout(successCB, errorCB)：未登录过该 provider 时 errorCB 触发，忽略即可
							s.logout(done, done);
						} catch {
							done();
						}
					});
				},
				() => resolve()
			);
		});
	}

	async function clearSessionCaches() {
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
		await clearOAuthCache();
	}

	const {
		t,
		locale
	} = useI18n();
	const themeStore = useThemeStore();
	const chat = useChatStore();
	const brandDisplayName = BRAND_DISPLAY_NAME;

	const showLangPicker = ref(false);
	const showLogoutConfirm = ref(false);
	const showDeleteAccountConfirm = ref(false);
	const showAbout = ref(false);
	const DELETE_GRACE_DAYS = 7;
	const deleteAccountConfirmText = computed(() =>
		fillI18n(t("profile.deleteAccountConfirm", {
			days: DELETE_GRACE_DAYS
		}), {
			days: DELETE_GRACE_DAYS,
		})
	);

	const languages = [
		// 暂时隐藏中文，文案仍保留在 i18n/locales/zh.json
		// { code: "zh", label: "中文", flag: "🇨🇳" },
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

	/** 切语言：本地生效 + PATCH 用户表，再拉 me 刷新 vip_name 等 */
	async function selectLanguage(code) {
		setAppLanguage(code);
		showLangPicker.value = false;
		void pushUiLanguageToServer(code);
		try {
			const raw = await api.get("/api/auth/me");
			const data = unwrapApiResults(raw) || raw;
			if (!data || typeof data !== "object") return;
			let prev = {};
			try {
				prev = JSON.parse(getItem("user_info") || "{}") || {};
			} catch {
				prev = {};
			}
			const merged = {
				...prev,
				...data,
				avatar_url: data.avatar_url ?? prev.avatar_url ?? "",
				vip_name: data.vip_name ?? prev.vip_name ?? "",
				vip_expire_at: data.vip_expire_at ?? prev.vip_expire_at ?? "",
				vip_type: data.vip_type ?? prev.vip_type ?? "",
				is_vip: data.is_vip ?? prev.is_vip,
				credits: data.credits ?? data.balance ?? prev.credits,
				language: data.language ?? code,
			};
			setItem("user_info", JSON.stringify(merged));
		} catch (e) {
			console.warn("[settings] 切语言后刷新用户信息失败:", e);
		}
	}

	async function handleLogout() {
		try {
			await standardApi.post("/api/auth/logout");
		} catch {
			/* ignore */
		}
		await clearSessionCaches();
		uni.reLaunch({
			url: "/pages/login/index"
		});
	}

	async function handleDeleteAccount() {
		try {
			const res = await standardApi.post("/api/auth/delete-account");
			showToast(res?.message || t("profile.accountDeleted"));
		} catch {
			return;
		}
		await clearSessionCaches();
		uni.reLaunch({
			url: "/pages/login/index"
		});
	}

	function promptLogout() {
		showLogoutConfirm.value = true;
	}

	function promptDeleteAccount() {
		showDeleteAccountConfirm.value = true;
	}

	function goPrivacy() {
		openPrivacyPolicy();
	}

	function goNotificationSettings() {
		uni.navigateTo({
			url: "/pages-sub/notification-settings/index"
		});
	}

	function goFeedback() {
		uni.navigateTo({
			url: "/pages-sub/feedback/index"
		});
	}

	function preventPageScroll() {
		return false;
	}

	watch(showLangPicker, () => {
		// iOS：弹层打开时关掉 WebView 回弹，避免滑语言列表带动整页
		// #ifdef APP-PLUS
		try {
			plus.webview.currentWebview().setStyle({
				bounce: "none"
			});
		} catch {
			/* ignore */
		}
		// #endif
	});
</script>

<template>
	<AppPageShell :title="t('profile.moreSettings')" :show-back="true" fill-webview transparent-header vest-backdrop
		back-analytics-id="settings-back" back-analytics-name="更多设置页返回">
		<view class="settings-page">
			<view class="menu-list">
				<view class="menu-group">
					<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="themeStore.toggleTheme()">
						<text class="menu-item-label">{{ t("profile.lightMode") }}</text>
						<view class="theme-switch" :class="{ on: !themeStore.isDark }">
							<view class="theme-knob" />
						</view>
					</view>
					<!-- <view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="bindAnalyticsTap('settings-notifications', goNotificationSettings, '通知设置')">
						<text class="menu-item-label">{{ t("notifications.title") || "Notifications" }}</text>
						<text class="menu-chevron">›</text>
					</view> -->
					<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="showLangPicker = true">
						<text class="menu-item-label">{{ t("profile.languagePreference") }}</text>
						<text class="menu-chevron">›</text>
					</view>
					<view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="goPrivacy">
						<text class="menu-item-label">{{ t("profile.privacyPolicy") }}</text>
						<text class="menu-chevron">›</text>
					</view>
					<!-- <view class="menu-item-simple" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="showAbout = true">
						<text class="menu-item-label">{{ t("profile.aboutUs") }}</text>
						<text class="menu-chevron">›</text>
					</view> -->
				</view>

				<view class="menu-group">
					<view class="menu-item-simple danger-item" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="bindAnalyticsTap('settings-logout', promptLogout, '退出登录')">
						<text class="menu-item-label danger-text">{{ t("profile.logout") }}</text>
					</view>
				</view>

				<view class="menu-group">
					<view class="menu-item-simple danger-item" hover-class="menu-item-hover" :hover-stay-time="200"
						@tap="bindAnalyticsTap('settings-delete-account', promptDeleteAccount, '注销账号')">
						<text class="menu-item-label danger-text">{{ t("profile.deleteAccount") }}</text>
					</view>
				</view>
			</view>
		</view>

		<!-- 语言选择：全屏遮罩拦住滑动，避免 iOS 带动底层设置页 -->
		<view v-if="showLangPicker" class="modal-mask bottom" @tap="showLangPicker = false"
			@touchmove.stop.prevent="preventPageScroll">
			<view class="modal-sheet lang-sheet" @tap.stop>
				<view class="modal-header-row sheet-header">
					<text class="modal-title">{{ t("profile.selectLanguage") }}</text>
					<text class="modal-close" @tap="showLangPicker = false">✕</text>
				</view>
				<scroll-view scroll-y class="lang-list" :enhanced="true" :bounces="false" @touchmove.stop>
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
		<view v-if="showAbout" class="modal-mask center" @tap="showAbout = false"
			@touchmove.stop.prevent="preventPageScroll">
			<view class="about-card" @tap.stop>
				<text class="about-title">{{ t("profile.aboutUs") }}</text>
				<text class="about-brand">{{ brandDisplayName }}</text>
				<text class="about-desc">{{ t("login.subtitle") }}</text>
				<view class="about-close-btn" @tap="showAbout = false">
					<text class="about-close-text">{{ t("common.confirm") }}</text>
				</view>
			</view>
		</view>

		<!-- 退出登录确认 -->
		<AppConfirmDialog :open="showLogoutConfirm" :title="t('profile.logout')"
			:description="t('profile.logoutConfirm')" :confirm-text="t('common.confirm')"
			:cancel-text="t('common.cancel')" destructive @update:open="showLogoutConfirm = $event"
			@confirm="handleLogout" />

		<!-- 注销账号确认 -->
		<AppConfirmDialog :open="showDeleteAccountConfirm" :title="t('profile.deleteAccount')"
			:description="deleteAccountConfirmText" :confirm-text="t('common.confirm')"
			:cancel-text="t('common.cancel')" destructive @update:open="showDeleteAccountConfirm = $event"
			@confirm="handleDeleteAccount" />
	</AppPageShell>
</template>

<style scoped lang="scss">
	.settings-page {
		padding: 0 var(--page-gutter, 32rpx) 48rpx;
		box-sizing: border-box;
	}

	.menu-list {
		display: flex;
		flex-direction: column;
		gap: 24rpx;
		padding-top: 24rpx;
	}

	.menu-group {
		display: flex;
		flex-direction: column;
		background: var(--card-bg, rgba(255, 255, 255, 0.05));
		border-radius: 32rpx;
		overflow: hidden;
	}

	.theme-light .menu-group,
	page[data-theme="light"] .menu-group {
		background: #ffffff;
	}

	.menu-item-simple {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 32rpx;
		min-height: 112rpx;
		box-sizing: border-box;
	}

	.menu-item-hover {
		background: var(--surface-faint, rgba(255, 255, 255, 0.03));
	}

	.menu-item-label {
		font-size: var(--fs-row-title, 32rpx);
		color: var(--fg);
	}

	.danger-item {
		justify-content: center;
	}

	.danger-text {
		color: var(--destructive, #ef4444);
		text-align: center;
	}

	.menu-chevron {
		font-size: 36rpx;
		line-height: 1;
		color: var(--fg-dim, rgba(255, 255, 255, 0.4));
		flex-shrink: 0;
	}

	.theme-switch {
		width: 100rpx;
		height: 56rpx;
		border-radius: 999px;
		flex-shrink: 0;
		background: var(--bg-secondary, #414141);
		border: none;
		position: relative;
		transition: background-color 0.3s ease;

		&.on {
			background: var(--gradient-brand, linear-gradient(135deg, #ff659b, #b933e6));
		}
	}

	.theme-knob {
		width: 48rpx;
		height: 48rpx;
		border-radius: 50%;
		box-shadow: none;
		background: #fff;
		position: absolute;
		top: 4rpx;
		left: 4rpx;
		transition: transform 0.3s ease;

		.on & {
			transform: translateX(44rpx);
		}
	}

	.about-card {
		width: 100%;
		max-width: 560rpx;
		background: var(--modal-bg, #1a1a1a);
		border-radius: 32rpx;
		padding: 48rpx 40rpx 40rpx;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16rpx;
	}

	.about-title {
		font-size: 34rpx;
		font-weight: 600;
		color: var(--fg);
		margin-bottom: 8rpx;
	}

	.about-brand {
		font-size: 32rpx;
		font-weight: 500;
		color: var(--fg);
	}

	.about-desc {
		font-size: 26rpx;
		color: var(--fg-muted);
		text-align: center;
		margin-bottom: 16rpx;
	}

	.about-close-btn {
		margin-top: 8rpx;
		width: 100%;
		height: 88rpx;
		border-radius: 9999px;
		background: var(--gradient-brand);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.about-close-text {
		color: var(--fg-on-brand, #fff);
		font-size: 30rpx;
		font-weight: 500;
	}

	.modal-mask {
		position: fixed;
		inset: 0;
		z-index: 12000;
		background: rgba(0, 0, 0, 0.55);
		padding: 32rpx;
		box-sizing: border-box;
		overflow: hidden;
		touch-action: none;

		&.bottom {
			display: flex;
			align-items: flex-end;
			justify-content: center;
			padding: 0;
		}

		&.center {
			display: flex;
			align-items: center;
			justify-content: center;
		}
	}

	.modal-sheet {
		width: 100%;
		max-width: 672px;
		background: var(--surface-sheet, var(--modal-bg, #0a0a0a));
		border: 1px solid var(--border);
		border-radius: 32rpx 32rpx 0 0;
		padding: 32rpx;
		padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
		max-height: 85vh;
		box-sizing: border-box;
	}

	.sheet-header {
		margin-bottom: 16rpx;
	}

	.modal-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 32rpx;
		flex-shrink: 0;
	}

	.modal-title {
		font-size: 34rpx;
		font-weight: 600;
		color: var(--fg);
	}

	.modal-close {
		font-size: 36rpx;
		color: var(--fg-muted);
		padding: 8rpx 12rpx;
		line-height: 1;
	}

	.lang-list {
		max-height: 60vh;
		box-sizing: border-box;
		touch-action: pan-y;
	}

	.lang-item {
		display: flex;
		align-items: center;
		gap: 20rpx;
		border-radius: 24rpx;
		margin-bottom: 8rpx;
		padding: 24rpx 20rpx;
		background: var(--bg-input);
		border: 1px solid var(--border);

		&.active {
			border-color: rgba(236, 72, 153, 0.35);
			background: rgba(236, 72, 153, 0.08);
		}
	}

	.lang-flag {
		font-size: 40rpx;
	}

	.lang-label {
		flex: 1;
		font-size: 30rpx;
		color: var(--fg);
	}

	.lang-check {
		font-size: 32rpx;
		color: var(--brand-text, var(--brand));
	}
</style>