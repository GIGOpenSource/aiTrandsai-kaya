<script setup>
/**
 * @file pages/discover — 发现 Tab：社区帖子 + 伴侣发现
 * @description 双 Tab（posts/companions）；发帖含选图上传；伴侣筛选与排序。
 * @depends apiFetch、deviceHeaders、companionsCache
 */
import {
	ref,
	computed,
	watch,
	onMounted,
	nextTick
} from "vue";
import {
	onShow
} from "@dcloudio/uni-app";
import {
	useI18n
} from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import {
	requireAuth
} from "@/composables/useAuth";
import {
	useRelativeTime
} from "@/composables/useRelativeTime";
import {
	useChatStore
} from "@/stores/chat";
import { useCreateCompanionEntry } from "@/composables/useCreateCompanionEntry";
import AppRechargeModal from "@/components/AppRechargeModal.vue";
import MomentsFeedPanel from "@/components/MomentsFeedPanel.vue";
import apiFetch from "@/utils/api";
import {
	fetchBCompanions,
	getCachedCompanions,
	companionPageHasMore,
} from "@/utils/companionsCache";
import { isScrollNearBottom } from "@/utils/scrollNearBottom";
import {
	formatAffectionDisplay
} from "@/utils/formatAffection";
import { filterBlockedPosts } from "@/utils/ugcSafety";
import {
	formatCompanionMeta,
	formatCompanionName,
	uiLangCode,
} from "@/utils/formatCompanion";
import {
	translatePersonalityTag
} from "@/utils/personalityTags";
import {
	normalizeMediaUrl,
	previewMedia
} from "@/utils/media";
import {
	deviceHeaders
} from "@/utils/device";
import {
	getItem,
	setItem
} from "@/utils/storage";
import {
	bindAnalyticsTap,
	bindAnalyticsTapArg
} from "@/utils/analytics";
import {
	trackProductEvent,
	PRODUCT_EVENTS,
	withCompanionId,
} from "@/utils/firebaseProductAnalytics";
import {
	useTabScrollStore
} from "@/stores/tabScroll";
import {
	useThemeStore
} from "@/stores/theme";
import { likeIconSrc, commentIconSrc, titleAddIconSrc, titleSearchIconSrc } from "@/utils/themeIcons";
import { useListVirtualWindow } from "@/composables/useListVirtualWindow";

const themeStore = useThemeStore();
const likeIcon = computed(() => likeIconSrc(themeStore.isDark));
const commentIcon = computed(() => commentIconSrc(themeStore.isDark));
const addIcon = computed(() => titleAddIconSrc(themeStore.isDark));
const searchIcon = computed(() => titleSearchIconSrc(themeStore.isDark));
const TAB_PATH = "/pages/discover/index";
const tabScroll = useTabScrollStore();
let discoverLastScrollTop = 0;
const discoverScrollTop = ref(0);
const discoverViewHeight = ref(600);
const discoverListScrollTop = ref(0);

const POST_CATEGORIES = [{
	key: "",
	label: "discover.catAll"
},
{
	key: "dating",
	label: "discover.catDating"
},
{
	key: "psychology",
	label: "discover.catPsychology"
},
{
	key: "tips",
	label: "discover.catTips"
},
{
	key: "story",
	label: "discover.catStory"
},
{
	key: "offtopic",
	label: "discover.catOfftopic"
},
];

const POSTS_PAGE_SIZE = 20;
const IMAGE_FALLBACK =
	"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTJlOGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSI5IiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+5pWw5o2u5aSE55CG6ZSZ6K+vPC90ZXh0Pjwvc3ZnPg==";

const {
	t,
	te,
	locale
} = useI18n();
const chat = useChatStore();
const {
	format: formatRelativeTime
} = useRelativeTime("discover");
requireAuth();

// ——— Tab / 帖子 / 伴侣状态 ———

function loadSavedTab() {
	const saved = getItem("discover_tab");
	if (saved === "posts" || saved === "discover") return "posts";
	return "moments";
}

const activeTab = ref(loadSavedTab());
const momentsPanelRef = ref(null);

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

// 帖子
const posts = ref([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMorePosts = ref(true);
const postsPage = ref(0);
const loadingMoreGuard = ref(false);
const hasMoreGuard = ref(true);
const postsLoadError = ref(false);
/** 与首页 pendingMomentSync 同理：从帖子详情返回才整表同步 */
let pendingPostsSync = false;
let discoverInitialized = false;
/** 进行中的点赞：防安卓重复 tap；fetchPosts 合并时保留本地态 */
const likingPostIds = new Set();
/** 点赞成功后的短时覆盖，防止并发列表刷新把终态打回 */
const localLikeOverrides = new Map();

const searchQuery = ref("");
const showSearchBar = ref(false);
const searchResults = ref([]);
const searchLoading = ref(false);
let searchTimer = null;

function onSearchInput(e) {
	searchQuery.value = e.detail.value;
}

const activeCategory = ref("");

// 伴侣
const initialCachedCompanions = getCachedCompanions() ?? [];
const companions = ref(
	initialCachedCompanions.length ? initialCachedCompanions : []
);
const companionFilter = ref("all");
const companionsLoading = ref(!initialCachedCompanions.length);
const companionsLoadingMore = ref(false);
const companionsHasMore = ref(true);
const companionsPage = ref(0);
const COMPANIONS_PAGE_SIZE = 20;
const refreshing = ref(false);

const displayPosts = computed(() =>
	searchQuery.value.trim() ? searchResults.value : posts.value
);
const isSearchLoading = computed(() => Boolean(searchQuery.value.trim()) && searchLoading.value);

const {
	slice: virtualDisplayPosts,
	topPad: postsTopPad,
	bottomPad: postsBottomPad,
} = useListVirtualWindow({
	rows: displayPosts,
	scrollTop: discoverListScrollTop,
	viewHeight: discoverViewHeight,
	rowHeight: 480,
	threshold: 80,
});

/** 与首页一致：驱动 u-pull-refresh 内置 loadmore */
const loadmoreStatus = computed(() => {
	if (activeTab.value === "moments") {
		return "loadmore";
	}
	if (searchQuery.value.trim()) return "nomore";
	if (loadingMore.value) return "loading";
	if (!hasMorePosts.value) return "nomore";
	return "loadmore";
});

const loadmoreNomoreText = computed(() =>
	activeTab.value === "posts" ? t("discover.noMorePosts") : t("home.noMoreMoments")
);

/** 搜索结果是单次请求，不展示底部分页/「没有更多了」；列表为空时由空态提示覆盖，也不显示 */
const showDiscoverLoadmore = computed(() => {
	if (activeTab.value === "posts") {
		if (searchQuery.value.trim()) return false;
		if (!displayPosts.value.length) return false;
	}
	return true;
});

const uiLang = computed(() => uiLangCode(locale.value));

const displayCompanions = computed(() => companions.value);

function categoryLabel(key) {
	if (!key) return "";
	const i18nKey = `discover.cat_${key}`;
	// 运营机可能返回中文分类名（如「日常」），无对应文案时直接展示原文，避免 intlify 缺键告警
	if (typeof te === "function" && !te(i18nKey)) return String(key);
	const label = t(i18nKey);
	return label === i18nKey ? String(key) : label;
}

function splitPersonalities(personality) {
	if (!personality) return [];
	return personality.split(/[、,，]/).filter(Boolean).slice(0, 3);
}

function pickPostsList(body) {
	if (Array.isArray(body)) return body;
	if (Array.isArray(body?.results)) return body.results;
	if (Array.isArray(body?.posts)) return body.posts;
	return [];
}

// ——— 帖子加载 ———

/** 按分类/分页加载社区帖子列表：GET /api/bposts */
async function fetchPosts(reset = true) {
	if (!reset) {
		if (loadingMoreGuard.value || !hasMoreGuard.value) return;
		loadingMoreGuard.value = true;
		loadingMore.value = true;
	} else {
		loading.value = true;
		postsPage.value = 0;
		hasMoreGuard.value = true;
		hasMorePosts.value = true;
		postsLoadError.value = false;
	}

	try {
		const page = reset ? 1 : postsPage.value + 1;
		const queryParts = [
			`page=${encodeURIComponent(page)}`,
			`page_size=${encodeURIComponent(POSTS_PAGE_SIZE)}`,
		];
		if (activeCategory.value) {
			queryParts.push(`category=${encodeURIComponent(activeCategory.value)}`);
		}

		const data = await apiFetch(
			`/api/bposts?${queryParts.join("&")}`, {
			header: deviceHeaders()
		}
		);
		const batch = filterBlockedPosts(pickPostsList(data));
		const pagination =
			data?.pagination && typeof data.pagination === "object"
				? data.pagination
				: {};

		if (reset) {
			// 刷新时保留点赞中/刚点过的本地态，避免与 like 请求竞态把图标打回去
			const prevById = new Map(
				(posts.value || []).map((p) => [String(p.id), p])
			);
			const now = Date.now();
			posts.value = batch.map((p) => {
				const id = String(p.id);
				const ov = localLikeOverrides.get(id);
				if (ov && ov.exp > now) {
					return {
						...p,
						liked: ov.liked,
						likes_count: ov.likes_count ?? p.likes_count,
					};
				}
				const prev = prevById.get(id);
				if (prev && likingPostIds.has(id)) {
					return {
						...p,
						liked: !!prev.liked,
						likes_count: prev.likes_count,
					};
				}
				return p;
			});
		} else {
			const ids = new Set(posts.value.map((p) => p.id));
			posts.value = [...posts.value, ...batch.filter((p) => !ids.has(p.id))];
		}
		postsPage.value = Number(pagination.page) || page;
		const more = companionPageHasMore(batch, pagination, POSTS_PAGE_SIZE);
		hasMoreGuard.value = more;
		hasMorePosts.value = more;
	} catch (err) {
		console.error("加载帖子失败:", err);
		if (reset && !posts.value.length) postsLoadError.value = true;
	} finally {
		loading.value = false;
		loadingMoreGuard.value = false;
		loadingMore.value = false;
	}
}

// ——— 伴侣列表 ———

/** 拉取发现页伴侣列表并排序（支持分页） */
async function loadCompanions({ reset = true } = {}) {
	if (!reset) {
		if (companionsLoadingMore.value || !companionsHasMore.value) return;
		companionsLoadingMore.value = true;
	} else {
		const cacheParams =
			companionFilter.value === "recommended"
				? { special: "recommend", page: 1, page_size: COMPANIONS_PAGE_SIZE }
				: { page: 1, page_size: COMPANIONS_PAGE_SIZE };
		const cached = getCachedCompanions(cacheParams);
		if (cached?.length && !companions.value.length) {
			companions.value = cached;
		}
		if (!companions.value.length) {
			companionsLoading.value = true;
		}
		companionsHasMore.value = true;
		companionsPage.value = 0;
	}

	try {
		const page = reset ? 1 : companionsPage.value + 1;
		const params = {
			page,
			page_size: COMPANIONS_PAGE_SIZE,
		};
		if (companionFilter.value === "recommended") {
			params.special = "recommend";
		}
		const { list, pagination } = await fetchBCompanions(params);
		const batch = Array.isArray(list) ? list : [];
		let appended = batch;
		if (reset) {
			companions.value = batch;
		} else {
			const seen = new Set(companions.value.map((c) => String(c?.profile?.id || "")));
			appended = batch.filter((c) => {
				const id = String(c?.profile?.id || "");
				if (!id || seen.has(id)) return false;
				seen.add(id);
				return true;
			});
			companions.value = [...companions.value, ...appended];
		}
		companionsPage.value = Number(pagination.page) || page;
		companionsHasMore.value = companionPageHasMore(
			batch,
			pagination,
			COMPANIONS_PAGE_SIZE
		);
	} catch (err) {
		console.error("加载智能体列表失败:", err);
	} finally {
		companionsLoading.value = false;
		companionsLoadingMore.value = false;
	}
}

function onScrollToLower() {
	if (activeTab.value === "moments") {
		momentsPanelRef.value?.loadMore?.();
		return;
	}
	if (searchQuery.value.trim()) return;
	void (async () => {
		await fetchPosts(false);
		trackProductEvent(PRODUCT_EVENTS.PULL_UP_LOAD_REPORT, { page: "discover", tab: "posts" });
	})();
}

async function onRefresh() {
	if (refreshing.value) return;
	refreshing.value = true;
	try {
		if (activeTab.value === "moments") {
			await momentsPanelRef.value?.refresh?.();
			trackProductEvent(PRODUCT_EVENTS.PULL_REFRESH_REPORT, { page: "discover", tab: "moments" });
		} else {
			await fetchPosts(true);
			trackProductEvent(PRODUCT_EVENTS.PULL_REFRESH_REPORT, { page: "discover", tab: "posts" });
		}
	} finally {
		refreshing.value = false;
	}
}

// ——— 发帖入口与互动 ———

function coerceLiked(v) {
	if (v === true || v === 1 || v === "1" || v === "true") return true;
	if (v === false || v === 0 || v === "0" || v === "false") return false;
	return !!v;
}

/** 就地改字段，避免整表替换导致安卓 image 重挂载闪烁 */
function patchPostLike(id, liked, likesCount) {
	const applyOne = (list) => {
		const p = (list || []).find((x) => String(x.id) === id);
		if (!p) return;
		p.liked = liked;
		if (likesCount != null) p.likes_count = likesCount;
	};
	applyOne(posts.value);
	applyOne(searchResults.value);
	const cur = (posts.value || [])
		.concat(searchResults.value || [])
		.find((x) => String(x.id) === id);
	localLikeOverrides.set(id, {
		liked,
		likes_count: likesCount != null ? likesCount : cur?.likes_count,
		exp: Date.now() + 2500,
	});
}

async function handleLike(postId) {
	const id = String(postId ?? "");
	if (!id || likingPostIds.has(id)) return;
	likingPostIds.add(id);

	try {
		// 与首页朋友圈一致：等接口返回后再写 UI
		const data = await apiFetch(`/api/posts/${id}/like`, {
			method: "POST",
			header: deviceHeaders(),
		});
		if (data?.ok) {
			patchPostLike(
				id,
				coerceLiked(data.liked),
				data.likes_count != null ? Number(data.likes_count) : null
			);
		}
	} catch (e) {
		console.error("点赞失败:", e);
	} finally {
		// 稍留冷却，吞掉安卓延迟的第二次 tap
		setTimeout(() => likingPostIds.delete(id), 320);
	}
}

function openPost(id, opts = {}) {
	pendingPostsSync = true;
	const focus = opts.focus ? "&focus=1" : "";
	uni.navigateTo({
		url: `/pages-sub/post/index?id=${id}${focus}`
	});
}

function openCompanionProfile(id) {
	trackProductEvent(
		PRODUCT_EVENTS.AVATAR_PROFILE_CLICK,
		withCompanionId({ page: "discover", target_id: String(id ?? "") }, id)
	);
	uni.navigateTo({
		url: `/pages-sub/companion/index?id=${id}`
	});
}

function openCreateModal() {
	uni.navigateTo({ url: "/pages-sub/create-post/index" });
}

// ——— Tab 切换与滚动 ———

function switchToPostsTab() {
	activeTab.value = "posts";
}

function switchToMomentsTab() {
	activeTab.value = "moments";
	showSearchBar.value = false;
}

function toggleSearchBar() {
	showSearchBar.value = !showSearchBar.value;
	if (!showSearchBar.value) searchQuery.value = "";
}

const onPostLikeTap = bindAnalyticsTapArg(
	"discover-post-like",
	handleLike,
	"发现页帖子点赞"
);
const onPostCommentTap = bindAnalyticsTapArg(
	"discover-post-comment",
	openPost,
	"发现页帖子评论"
);
const onPostDetailTap = bindAnalyticsTapArg(
	"discover-view-detail",
	openPost,
	"发现页查看详情"
);

function onDiscoverScroll(e) {
	discoverLastScrollTop = e.detail.scrollTop;
	discoverListScrollTop.value = e.detail.scrollTop;
	tabScroll.setScroll(TAB_PATH, e.detail.scrollTop);
	// H5 scrolltolower / u-pull-refresh loadmore 可能只触发一次
	if (isScrollNearBottom(e.detail, discoverViewHeight.value)) {
		onScrollToLower();
	}
}

function scrollDiscoverToTop() {
	discoverScrollTop.value = discoverLastScrollTop;
	void nextTick(() => {
		discoverScrollTop.value = 0;
		discoverListScrollTop.value = 0;
	});
}

watch(
	() => tabScroll.scrollToTopTick[TAB_PATH],
	() => {
		scrollDiscoverToTop();
	}
);

function openChat(id) {
	// 只跳转；由 chat 页统一建连，避免与 onMounted 抢连
	uni.navigateTo({
		url: `/pages/chat/index?id=${id}`
	});
}

function previewImage(images, currentIndex) {
	if (!images || images.length === 0) return;
	previewMedia(images, currentIndex);
}
watch(activeTab, (tab) => {
	setItem("discover_tab", tab);
	if (tab === "posts") {
		fetchPosts(true);
	} else {
		void nextTick(() => momentsPanelRef.value?.refresh?.());
	}
});

watch(activeCategory, () => {
	searchQuery.value = "";
	if (activeTab.value === "posts") {
		fetchPosts(true);
	}
});

watch(searchQuery, (query) => {
	if (searchTimer) clearTimeout(searchTimer);
	const trimmed = query.trim();
	if (!trimmed) {
		searchResults.value = [];
		searchLoading.value = false;
		return;
	}
	searchTimer = setTimeout(async () => {
		searchLoading.value = true;
		try {
			const data = await apiFetch(
				`/api/posts/search?q=${encodeURIComponent(trimmed)}&limit=50`, {
				header: deviceHeaders()
			}
			);
			searchResults.value = filterBlockedPosts(data.posts || []);
		} catch (err) {
			console.error("搜索失败:", err);
		} finally {
			searchLoading.value = false;
		}
	}, 400);
});

onMounted(() => {
	try {
		const sys = uni.getSystemInfoSync();
		discoverViewHeight.value = Math.max(400, (sys.windowHeight || 600) - 160);
	} catch {
		/* keep default */
	}
	if (activeTab.value === "posts") {
		fetchPosts(true);
	}
	discoverInitialized = true;
});

// 与首页一致：勿每次 onShow 整表刷新（会与点赞竞态，安卓上图标亮暗闪且终态错乱）
onShow(() => {
	if (!discoverInitialized) return;
	if (!pendingPostsSync) return;
	pendingPostsSync = false;
	if (activeTab.value === "posts") {
		fetchPosts(true);
	}
});
</script>

<template>
	<AppPageShell
		:show-header="false"
		show-tab-bar
		:reserve-tab-bar="false"
		fill-webview
		transparent-header
		:overlay-open="showCreateVipGate"
	>
		<template #header>
			 <view class="header-top">
					<view class="discover-tabs">
						<text
							class="discover-tab"
							:class="{ active: activeTab === 'moments' }"
							@tap="switchToMomentsTab"
						>{{ t("discover.moments") || "Moments" }}</text>
						<text
							class="discover-tab"
							:class="{ active: activeTab === 'posts' }"
							@tap="switchToPostsTab"
						>{{ t("discover.title") || "Discover" }}</text>
					</view>
					<view class="header-right-actions">
						<view
							v-if="activeTab === 'posts'"
							class="icon-btn"
							@tap="toggleSearchBar"
						>
							<image class="header-add-ico" :src="searchIcon" mode="aspectFit" />
						</view>
						<view
							v-if="activeTab === 'posts'"
							class="icon-btn"
							@tap="bindAnalyticsTap('discover-create-post', openCreateModal, '发帖')"
						>
							<image class="header-add-ico" :src="addIcon" mode="aspectFit" />
						</view>
						<view
							v-else
							class="icon-btn"
							@tap="bindAnalyticsTap('discover-moments-create-header', () => enterCreateCompanion({ page: 'discover', source: 'moments_header' }), '创建伴侣')"
						>
							<image class="header-add-ico" :src="addIcon" mode="aspectFit" />
						</view>
					</view>
				</view>

		</template>
		<!-- 发现页根容器：头部固定 + 内容可滚动 -->
		<view class="discover-page">
			<!-- 顶部：搜索、分类筛选（仅 Discover/Posts） -->
			<view class="discover-header">
				<template v-if="activeTab === 'posts'">
					<view v-if="showSearchBar" class="search-wrap">
						<image class="search-ico" :src="searchIcon" mode="aspectFit"></image>
						<input :value="searchQuery" @input="searchQuery = $event.detail.value"
							:placeholder="t('discover.searchPlaceholder')" placeholder-class="search-placeholder"
							class="search-input" :focus="showSearchBar" />
						<text v-if="searchQuery" class="search-clear" @tap="searchQuery = ''">✕</text>
					</view>

					<scroll-view scroll-x class="category-scroll" show-scrollbar="false">
						<view class="category-row">
							<view v-for="cat in POST_CATEGORIES" :key="cat.key || 'all'" class="category-chip"
								:class="{ active: activeCategory === cat.key }" @tap="activeCategory = cat.key">
								<text>{{ t(cat.label) }}</text>
							</view>
						</view>
					</scroll-view>
				</template>
			</view>

			<!-- 可滚动内容区：品牌下拉刷新（与首页 u-pull-refresh 一致） -->
			<u-pull-refresh
				class="discover-body"
				:refreshing="refreshing"
				:threshold="80"
				:lower-threshold="240"
				:scroll-top="discoverScrollTop"
				:show-loadmore="showDiscoverLoadmore"
				:loadmore-props="{
					status: loadmoreStatus,
					loadmoreText: ' ',
					loadingText: t('common.loading'),
					nomoreText: loadmoreNomoreText,
				}"
				@refresh="onRefresh"
				@loadmore="onScrollToLower"
				@scroll="onDiscoverScroll"
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

				<!-- 帖子 Tab -->
				<view v-if="activeTab === 'posts'" class="content px-md py-sm">
					<AppListSkeleton v-if="(isSearchLoading || loading) && !displayPosts.length" :rows="4" />

					<view v-else-if="!displayPosts.length" class="empty">
						<text class="empty-icon">💬</text>
						<text class="text-muted">
							{{
                postsLoadError
                  ? t("common.loadFailed")
                  : (searchQuery.trim() ? t("discover.noSearchResults") : t("discover.noPosts"))
              }}
						</text>
						<text
							v-if="postsLoadError"
							class="empty-retry"
							@tap="fetchPosts(true)"
						>{{ t("common.retry") }}</text>
					</view>

					<view v-else class="post-list">
						<view
							v-if="postsTopPad"
							class="list-virtual-pad"
							:style="{ height: `${postsTopPad}px` }"
						/>
						<view v-for="post in virtualDisplayPosts" :key="post.id" class="card post-card">
						<!-- 对照 Figma 图5：图 → 作者 → 正文 → 分类/互动 -->
						<view v-if="post.images?.length" class="post-images" @tap="openPost(post.id)">
							<view
								class="image-row"
								:class="{
									'is-single': post.images.length === 1,
									'is-double': post.images.length === 2,
									'is-triple': post.images.length >= 3,
								}"
							>
								<view v-for="(img, idx) in post.images.slice(0, 3)" :key="idx" class="image-item">
									<image class="post-thumb" :src="normalizeMediaUrl(img) || IMAGE_FALLBACK"
										mode="aspectFill" @tap.stop="previewImage(post.images, idx)" />
									<view v-if="post.images.length > 3 && idx === 2" class="image-count-badge">
										<text class="count-icon">🖼</text>
										<text class="count-num">{{ post.images.length }}</text>
									</view>
								</view>
							</view>
						</view>

						<view class="post-header" :class="{ 'has-images': !!post.images?.length }">
							<AppAvatarImage class="post-avatar" :src="post.avatar" :seed="String(post.user_id || 'user')" size="md" />
							<view class="post-author-info">
								<text class="author-name">{{ post.user_name }}</text>
							</view>
							<text class="text-muted author-time">{{ formatRelativeTime(post.created_at) }}</text>
						</view>

						<view class="post-body" @tap="openPost(post.id)">
							<text v-if="post.content" class="post-content">{{ post.content }}</text>
							<text v-else-if="post.title" class="post-content">{{ post.title }}</text>
						</view>

						<view class="post-actions">
							<text v-if="post.category" class="post-cat-tag">{{ categoryLabel(post.category) }}</text>
							<view class="social-actions post-stats">
								<view
									class="action-btn"
									@tap.stop="onPostLikeTap(post.id)"
									@touchstart.stop
									@touchmove.stop
								>
									<view class="like-icon-wrap">
										<image
											class="action-img"
											:class="{ 'is-hidden': !!post.liked }"
											:src="likeIcon"
											mode="aspectFit"
										/>
										<image
											class="action-img"
											:class="{ 'is-hidden': !post.liked }"
											src="/static/vest/common/like-red.png"
											mode="aspectFit"
										/>
									</view>
									<text class="action-count">{{ post.likes_count || 0 }}</text>
								</view>
								<view class="action-btn" @tap.stop="onPostCommentTap(post.id)">
									<image
										class="action-img"
										:src="commentIcon"
										mode="aspectFit"
									/>
									<text class="action-count">{{ post.comments_count || 0 }}</text>
								</view>
							</view>
						</view>
						</view>
						<view
							v-if="postsBottomPad"
							class="list-virtual-pad"
							:style="{ height: `${postsBottomPad}px` }"
						/>
					</view>
				</view>

				<!-- Moments Tab -->
				<view v-else class="content">
					<MomentsFeedPanel
						ref="momentsPanelRef"
						:active="activeTab === 'moments'"
						@create="() => enterCreateCompanion({ page: 'discover', source: 'moments_strip' })"
					/>
				</view>
			</u-pull-refresh>
		</view>

		<AppRechargeModal
			v-model:open="showCreateVipGate"
			default-tab="vip"
			:is-vip="createGateVip"
			:points="createGatePoints"
			:vip-name="createGateVipName"
			:vip-expire-date="createGateVipExpire"
			:vip-type="createGateVipType"
			analytics-scene="agent_create"
			@purchased="onCreateVipPurchased"
		/>
	</AppPageShell>
</template>

<style scoped lang="scss">
/* ===== 页面骨架 ===== */
.discover-page {
	flex: 1;
	min-height: 0;
	height: 100%;
	background: transparent;
}

.discover-header {
	padding: 0;
	background: transparent;
}

.discover-body {
	flex: 1;
	height: 0;
	min-height: 0;
}

:deep(.u-loadmore) {
	padding: 32rpx 20rpx 48rpx;
}

/* ===== 顶部操作区（对照 Figma 8:916） ===== */

.header-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex: 1;
	width: 100%;
	box-sizing: border-box;
	/* 左右 16pt 由 AppPageShell .app-header-inner 提供，此处勿再叠 */
	padding: 0;
	margin: 0;
	min-height: 76rpx;
}

.page-title {
	font-size: var(--fs-title, 40rpx);
	font-weight: 600;
	color: var(--fg);
}

.discover-tabs {
	display: flex;
	align-items: center;
	gap: 40rpx; /* 稿 20px */
	height: 100%;
}

.discover-tab {
	position: relative;
	font-size: 36rpx; /* 18 */
	font-weight: 200; /* 未选中 Thin */
	color: var(--fg, #fff);
	line-height: 1.2;
	padding-bottom: 0;
	opacity: 1;
}

.discover-tab.active {
	color: var(--fg, #fff);
	font-weight: 600; /* Semibold */
}

.discover-tab.active::after {
	display: none;
}

.header-right-actions {
	display: flex;
	align-items: center;
	gap: 24rpx;
}

.header-right-actions .icon-btn {
	width: 56rpx;
	height: 56rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}

.header-add-ico {
	width: 48rpx;
	height: 48rpx;
}

.btn-new-post {
	font-weight: 500;
	color: var(--fg);
	line-height: 1.2;
}

.btn-new-post {
	display: flex;
	align-items: center;
	gap: 4rpx;
	padding: 22rpx 24rpx;
	border-radius: 32rpx;
	background: var(--bg-active, rgba(255, 255, 255, 0.1));
	border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.1));
	box-sizing: border-box;
}

.btn-new-post-ico {
	width: 24rpx;
	height: 24rpx;
}

.btn-new-post-text {
	font-size: 28rpx;
	line-height: 32rpx;
	color: var(--fg);
}

.tab-switch {
	display: flex;
	gap: 8rpx;
	padding: 8rpx;
	background: var(--bg-input);
	border-radius: 20rpx;
	margin-bottom: 24rpx;
}

.tab-switch-item {
	flex: 1;
	padding: 16rpx 0;
	color: var(--fg-muted);
	text-align: center;
	border-radius: 16rpx;
	font-size: 26rpx;

	&.active {
		background: var(--bg-card);
		color: var(--fg);
		box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
	}
}

.search-wrap {
	display: flex;
	align-items: center;
	gap: 16rpx;
	padding: 24rpx;
	margin: 0 32rpx 16rpx;
	background: var(--surface-inset, rgba(255, 255, 255, 0.05));
	border-radius: 32rpx;
	border: 1rpx solid var(--border-soft, rgba(255, 255, 255, 0.05));
	box-sizing: border-box;
	min-height: 92rpx;
}

.search-ico {
	width: 44rpx;
	height: 44rpx;
	flex-shrink: 0;
}

.search-input {
	flex: 1;
	color: var(--fg);
	font-size: 28rpx;
	font-weight: 500;
	height: 32rpx;
	line-height: 32rpx;
	background: transparent;
}

.search-placeholder {
	color: var(--fg-placeholder, rgba(255, 255, 255, 0.3));
	font-weight: 500;
}

/* ===== 分类标签 ===== */

.category-chip {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 16rpx 28rpx;
	margin-right: 16rpx;
	border-radius: 999rpx;
	font-size: 28rpx;
	white-space: nowrap;
	background: transparent;
	border: none;
	color: var(--fg-muted, rgba(255, 255, 255, 0.55));

	&.active {
		background: rgba(255, 255, 255, 0.12);
		border-color: transparent;
		color: var(--fg, #fff);
		font-weight: 500;
	}
}


/* ===== 卡片列表 ===== */
.post-card,
.companion-card {
	padding: 32rpx;
}

.chat-btn {
	padding: 12rpx 28rpx;
	border-radius: 999px;
	background: var(--gradient-brand);
	color: #fff;
}

/* ===== 发帖弹窗 ===== */
.modal-sheet {
	width: 100%;
	max-width: 672px;
	background: var(--modal-bg);
}

.discover-page {
	display: flex;
	flex-direction: column;
}

.discover-header {
	flex-shrink: 0;
	padding: 12rpx var(--page-gutter, 32rpx) 16rpx;
	background: transparent;
}

.category-scroll {
	white-space: nowrap;
	padding: 8rpx 32rpx 16rpx;
	box-sizing: border-box;
}

.category-row {
	padding-bottom: 0;
	display: inline-flex;
	flex-direction: row;
	align-items: center;
}

.discover-body {}

.content {
	padding-bottom: calc(var(--app-tab-bar, var(--safe-tab)) + 24rpx);
}

.empty {
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16rpx;
	padding: 48rpx 32rpx;
}

.empty-icon {
	font-size: 80rpx;
	margin-bottom: 8rpx;
}

.empty-retry {
	color: var(--fg);
	font-size: 28rpx;
	font-weight: 500;
	text-decoration: underline;
	padding: 16rpx 32rpx;
}

.post-list,
.companion-list {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
	padding: 8rpx 0 16rpx;
}

.post-card {
	margin-bottom: 0;
	background: var(--card-bg, rgba(255, 255, 255, 0.05));
	border-radius: 32rpx;
	border: none;
	padding: 32rpx;
	box-sizing: border-box;
}


.post-header {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 20rpx;
	margin-bottom: 0;
}

.post-header.has-images {
	margin-top: 24rpx;
}

.post-header :deep(.post-avatar.avatar-root),
.post-header :deep(.avatar-root) {
	width: 84rpx !important;
	height: 84rpx !important;
}

.post-header .author-time {
	margin-left: auto;
	flex-shrink: 0;
}

.post-author-info {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	min-width: 0;
	flex: 1;
}

.author-name {
	font-size: 28rpx;
	font-weight: 500;
	color: var(--fg);
}

.author-time {
	font-size: 22rpx;
	opacity: 0.6;
}

.post-body {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
	margin-top: 24rpx;
}

.post-cat {
	font-size: 24rpx;
	border-radius: 32rpx;
	display: inline-block;
	padding: 10rpx 16rpx;
	background: var(--surface-inset, rgba(255, 255, 255, 0.05));
	color: var(--fg-muted, rgba(255, 255, 255, 0.6));
	font-weight: 400;
	align-self: flex-start;
	margin-bottom: 0;
}

.post-title {
	font-size: 32rpx;
	font-weight: 400;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	text-overflow: ellipsis;
	word-break: break-word;
	overflow-wrap: break-word;
}

.post-content {
	font-size: 32rpx;
	line-height: 1.4;
	color: var(--fg);
	font-weight: 400;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	overflow: hidden;
	text-overflow: ellipsis;
	word-break: break-word;
	overflow-wrap: break-word;
	box-orient: vertical;
	line-clamp: 4;
}

.post-images {
	margin-top: 0;
	width: 100%;
}

.image-row {
	display: flex;
	flex-direction: row;
	align-items: stretch;
	gap: 12rpx;
	width: 100%;
}

.image-item {
	position: relative;
	flex-shrink: 0;
	width: 196rpx;
	height: 196rpx;
	min-width: 0;
}

/* 单图：占满帖卡内容宽 */
.image-row.is-single .image-item {
	width: 100%;
	height: 360rpx;
	flex: 1 1 auto;
}

/* 双图 / 三图：均分宽度 */
.image-row.is-double .image-item,
.image-row.is-triple .image-item {
	flex: 1 1 0;
	width: 0;
	height: 220rpx;
}

.post-thumb {
	display: block;
	width: 100%;
	height: 100%;
	border-radius: 16rpx;
	background: var(--bg-input);
	overflow: hidden;
}

.image-count-badge {
	position: absolute;
	right: 8rpx;
	bottom: 8rpx;
	display: flex;
	align-items: center;
	gap: 8rpx;
	padding: 8rpx 16rpx;
	background: rgba(10, 10, 10, 0.8);
	border: 1rpx solid rgba(255, 255, 255, 0.2);
	border-radius: 32rpx;
	z-index: 2;
}

.count-icon {
	font-size: 18rpx;
	line-height: 1;
}

.count-num {
	font-size: 20rpx;
	color: #fff;
	font-weight: 500;
	line-height: 1;
}

.post-actions {
	display: flex;
	flex-direction: row;
	align-items: center;
	margin-top: 20rpx;
}

.post-actions .post-stats {
	margin-left: auto;
}

.post-cat-tag {
	font-size: 24rpx;
	padding: 10rpx 16rpx;
	background: var(--surface-inset, rgba(255, 255, 255, 0.05));
	border: 1rpx solid var(--border);
	border-radius: 32rpx;
	color: var(--fg-muted, rgba(255, 255, 255, 0.6));
	font-weight: 400;
	box-sizing: border-box;
}

.post-stats {
	/* 布局由全局 .social-actions 提供；此处仅保留与分类标签的排版关系 */
	margin-left: auto;
}

/* 灰心/彩心叠放切换透明度，避免安卓换 image src 闪烁 */
.like-icon-wrap {
	position: relative;
	width: 40rpx;
	height: 40rpx;
	flex-shrink: 0;
}

.like-icon-wrap .action-img {
	position: absolute;
	left: 0;
	top: 0;
}

.like-icon-wrap .action-img.is-hidden {
	opacity: 0;
	pointer-events: none;
}

.liked {
	color: #ff375f;
}

.detail-link {
	font-size: 26rpx;
	font-weight: 500;
}

.footer-hint {
	text-align: center;
	font-size: 26rpx;

	&.dim {
		font-size: 22rpx;
	}
}

.companion-card {
	margin-bottom: 24rpx;
	background: var(--bg-card);
	border-radius: 24rpx;
	border: 1px solid var(--border);
}

.companion-name-block {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	min-width: 0;
}

.companion-name {
	font-size: 30rpx;
	font-weight: 600;
	color: var(--fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.companion-meta {
	font-size: 22rpx;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.companion-city {
	font-size: 22rpx;
	text-overflow: ellipsis;
	white-space: nowrap;
	overflow: hidden;
}

.tag-row {
	flex-wrap: wrap;
}

.tag {
	font-size: 22rpx;
	border-radius: 999px;

	&.mbti {}
}

.companion-side {
	flex-shrink: 0;
}

.affection-badge {
	border-radius: 999px;
	font-size: 22rpx;
	font-weight: 500;
}

.chat-btn {
	display: flex;
	border-radius: 50%;
	align-items: center;
	justify-content: center;
	font-size: 28rpx;
}

.flex-1 {
	min-width: 0;
}

.min-w-0 {
	min-width: 0;
}

/* ===== 发帖弹窗 ===== */
.modal-mask {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.55);
	display: flex;
	z-index: 100;
	align-items: flex-end;
	justify-content: center;
  
}

.modal-sheet {
	display: flex;
	flex-direction: column;
	max-height: 75vh;
	width: 100%;
	overflow: hidden;
	padding-bottom: calc(var(--safe-tab) + 16rpx);
	border-radius: 32rpx 32rpx 0 0;
	background: var(--modal-bg);
}

.modal-header {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 12rpx;
	padding: var(--page-gutter, 32rpx) var(--page-gutter, 32rpx) 24rpx;
	border-bottom: 1px solid var(--border);
}

.modal-back {
	font-size: var(--fs-title, 40rpx);
	line-height: 1;
	color: var(--fg);
	padding: 0 8rpx 4rpx 0;
}

.modal-title {
	font-size: var(--fs-row-title, 32rpx);
	font-weight: 600;
}

.modal-close {
	font-size: 36rpx;
	padding: 8rpx;
}

.create-error {
	display: block;
	text-align: center;
	color: #ff3b30;
	font-size: 24rpx;
	margin-top: 8rpx;
	margin-bottom: 8rpx;
}

/* 可滚动表单区 */
.modal-body {
	width: 100%;
	height: calc(75vh - 140px); /* 明确像素高度，Android scroll-view 不支持 flex 高度 */
	padding: 24rpx 32rpx;
	box-sizing: border-box;
}

.form-group {
	margin-bottom: 32rpx;
	width: 100%;
	overflow: hidden;
}

.form-label {
	display: block;
	font-size: 28rpx;
	font-weight: 500;
	margin-bottom: 16rpx;
}

/* 分类芯片：flex 换行，避免叠在一起 */
.chip-wrap {
	display: flex;
	flex-wrap: wrap;
}

.chip-wrap .category-chip {
	margin-right: 16rpx;
	margin-bottom: 16rpx;
}

/* 输入框 */
.input-box {
	width: 100%;
	overflow: hidden;
	border-radius: 16rpx;
}

.input-field {
	width: 100%;
	max-width: 100%;
	padding: 20rpx 24rpx;
	background: var(--bg-input);
	border: 1px solid var(--border);
	border-radius: 16rpx;
	font-size: 28rpx;
	color: var(--fg);
	box-sizing: border-box;
}

.textarea {
	min-height: 240rpx;
}

.char-count {
	display: block;
	text-align: right;
	font-size: 22rpx;
	margin-top: 8rpx;
}

/* 图片上传网格 */
.upload-grid {
	display: flex;
	flex-wrap: wrap;
}

.upload-grid .upload-thumb,
.upload-grid .upload-add {
	margin-right: 16rpx;
	margin-bottom: 16rpx;
}

.upload-thumb {
	position: relative;
	width: 208rpx;
	height: 208rpx;
	border-radius: 16rpx;
	overflow: hidden;
	flex-shrink: 0;
}

.upload-img {
	width: 100%;
	height: 100%;
}

.remove-btn {
	position: absolute;
	top: 8rpx;
	right: 8rpx;
	width: 44rpx;
	height: 44rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.5);
	border-radius: 50%;
	color: #fff;
	font-size: 28rpx;
	z-index: 2;
}

.upload-add {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 208rpx;
	height: 208rpx;
	border: 2rpx dashed var(--border);
	border-radius: 16rpx;
	background: var(--bg-input);
	flex-shrink: 0;
}

.add-icon {
	font-size: 40rpx;
	margin-bottom: 8rpx;
}

.add-label {
	font-size: 22rpx;
	color: var(--fg);
}

/* 底部操作 */
.modal-footer {
	flex-shrink: 0;
	padding: 24rpx 32rpx 32rpx;
	border-top: none;
}

.publish-btn {
	border-radius: 999px;
	padding: 24rpx;
	font-size: 30rpx;
	font-weight: 600;
	background: var(--gradient-brand) !important;
	color: var(--fg-on-brand, #ffffff) !important;
}
</style>