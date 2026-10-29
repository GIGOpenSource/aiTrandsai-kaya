<script setup>
/**
 * @file pages-sub/intimacy — 亲密度记录
 * @description 列出我的伴侣及亲密度等级展示。
 * @depends companionsCache、formatAffection、appListScroll
 */
import { ref, onMounted, nextTick } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import AppAvatarImage from "@/components/AppAvatarImage.vue";
import AppListSkeleton from "@/components/AppListSkeleton.vue";
import { requireAuth } from "@/composables/useAuth";
import { fetchBCompanions } from "@/utils/companionsCache";
import {
  initListViewHeight,
  measureListViewHeight,
  inspectListScroll,
  nextListPage,
  resolveListHasMore,
  pushUniqueById,
  createListScrollGuard,
} from "@/utils/appListScroll";
import { formatAffectionDisplay } from "@/utils/formatAffection";

const { t } = useI18n();
requireAuth();

function mapIntimacyCompanion(c) {
  const profile = c.profile || {};
  const state = c.state || {};
  return {
    id: profile.id || "",
    name: profile.name || "",
    avatar: c.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
    gender: profile.gender || "",
    affection: state.affection || 0,
    turns: state.turns || 0,
    mbti: profile.mbti || "",
  };
}

function mapIntimacyCompanions(data) {
  return (data || [])
    .map(mapIntimacyCompanion)
    .filter((c) => (c.turns || 0) > 0)
    .sort((a, b) => b.affection - a.affection);
}

const companions = ref([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const companionsPage = ref(0);
const PAGE_SIZE = 20;

const listViewHeight = ref(initListViewHeight(160));
const pin = createListScrollGuard();
let loadMoreLatched = false;
let loadMoreInFlight = null;
let loadSeq = 0;

function measureHeight() {
  measureListViewHeight(".list-scroll", (h) => {
    listViewHeight.value = h;
  });
}

async function loadIntimacy(background = false, { reset = true } = {}) {
  if (!reset) {
    if (loadMoreInFlight || loadingMore.value || !hasMore.value || loading.value) {
      return;
    }
    loadingMore.value = true;
  } else {
    if (loadMoreInFlight || loadingMore.value) return;
    loadMoreLatched = false;
    if (!background) loading.value = true;
  }

  const seq = ++loadSeq;
  const page = nextListPage(reset, companionsPage.value);
  try {
    const { list, pagination } = await fetchBCompanions({
      is_create: "none",
      intimacy_value: 0,
      min_turns: 1,
      page,
      page_size: PAGE_SIZE,
    });
    if (seq !== loadSeq) return;

    const mapped = mapIntimacyCompanions(list);
    let appendedCount = mapped.length;
    if (reset) {
      if (!(Array.isArray(list) && list.length === 0 && companions.value.length > 0)) {
        companions.value = mapped;
      }
    } else {
      // 只 push 追加，不改 scroll，新内容在下方滑到再看
      const { appendedCount: n } = pushUniqueById(companions, mapped);
      appendedCount = n;
    }
    companionsPage.value = page;
    const filteredEmptyButRawFull =
      mapped.length === 0 && Array.isArray(list) && list.length > 0;
    hasMore.value = resolveListHasMore({
      batch: list,
      pagination,
      pageSize: PAGE_SIZE,
      appendedCount,
      isReset: reset,
      emptyAppendStops: !filteredEmptyButRawFull,
    });
  } catch (e) {
    console.error("[intimacy] load failed:", e);
    if (seq !== loadSeq) return;
    if (reset && !companions.value.length) companions.value = [];
    if (!reset) hasMore.value = false;
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
    nextTick(measureHeight);
  }
}

function loadMoreIntimacy() {
  if (loadMoreLatched) return;
  if (loading.value || loadingMore.value || loadMoreInFlight || !hasMore.value) return;
  if (!pin.contentOverflows(listViewHeight.value)) return;
  loadMoreLatched = true;
  loadMoreInFlight = loadIntimacy(true, { reset: false }).finally(() => {
    loadMoreInFlight = null;
  });
}

function onIntimacyScroll(e) {
  const detail = e?.detail || {};
  pin.noteScroll(detail);
  const { load, unlock } = inspectListScroll(detail, listViewHeight.value, {
    hasMore: hasMore.value,
    busy: Boolean(loading.value || loadingMore.value || loadMoreInFlight),
    latched: loadMoreLatched,
  });
  if (load) {
    loadMoreIntimacy();
    return;
  }
  if (unlock) loadMoreLatched = false;
}

const avgAffection = () =>
  companions.value.length
    ? companions.value.reduce((s, c) => s + c.affection, 0) / companions.value.length
    : 0;

function affectionInfo(a) {
  if (a >= 80) return { label: t("myCompanions.soulmate"), color: "pink" };
  if (a >= 50) return { label: t("myCompanions.close"), color: "purple" };
  if (a >= 20) return { label: t("myCompanions.familiar"), color: "blue" };
  return { label: t("myCompanions.stranger"), color: "muted" };
}

onMounted(() => {
  measureHeight();
  loadIntimacy(false);
});

onShow(() => {
  const busy = Boolean(loadMoreInFlight || loadingMore.value);
  if (busy || companionsPage.value > 1) return;
  loadIntimacy(true);
});
</script>

<template>
  <AppPageShell :title="t('profile.intimacyRecord')" :show-back="true">
    <scroll-view
      scroll-y
      class="list-scroll"
      :lower-threshold="120"
      @scroll="onIntimacyScroll"
      @scrolltolower="loadMoreIntimacy"
    >
    <view class="page-gutter-x py-sm">
      <view class="stats-row flex-row">
        <view class="stat card"><text class="num">{{ formatAffectionDisplay(avgAffection()) }}</text><text class="text-muted">{{ t("intimacy.avgAffection") }}</text></view>
        <view class="stat card"><text class="num">{{ formatAffectionDisplay(companions[0]?.affection ?? 0) }}</text><text class="text-muted">{{ t("intimacy.highest") }}</text></view>
        <view class="stat card"><text class="num">{{ companions.reduce((s, c) => s + c.turns, 0) }}</text><text class="text-muted">{{ t("profile.chatTurns") }}</text></view>
      </view>

      <AppListSkeleton v-if="loading && !companions.length" />
      <template v-else>
        <view v-if="companions[0]" class="card highlight mt-md flex-row items-center gap-sm">
          <AppAvatarImage :src="companions[0].avatar" :seed="companions[0].id" />
          <view>
            <text class="name">{{ companions[0].name }}</text>
            <text class="text-muted">{{ t("intimacy.topCompanion") }}</text>
            <text class="text-primary">♥ {{ formatAffectionDisplay(companions[0].affection) }}</text>
          </view>
        </view>

        <view v-if="!companions.length" class="center text-muted py-lg">{{ t("common.noData") }}</view>
        <template v-else>
          <view
            v-for="(c, idx) in companions"
            :key="c.id"
            class="card row mt-md"
            @tap="uni.navigateTo({ url: `/pages/chat/index?id=${c.id}` })"
          >
            <AppAvatarImage :src="c.avatar" :seed="c.id" size="sm" />
            <view class="row-body">
              <text class="name">{{ idx + 1 }}. {{ c.name }}</text>
              <text class="text-muted">{{ affectionInfo(c.affection).label }} · {{ c.turns }} {{ t("profile.chatTurns") }}</text>
              <view class="progress"><view class="bar" :style="{ width: Math.min(c.affection, 100) + '%' }" /></view>
            </view>
            <text class="score">{{ formatAffectionDisplay(c.affection) }}</text>
          </view>
          <view v-if="loadingMore" class="center text-muted py-lg">{{ t("common.loading") }}</view>
        </template>
      </template>
    </view>
    </scroll-view>
  </AppPageShell>
</template>

<style scoped lang="scss">
.list-scroll {
  flex: 1;
  height: 0;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}
.center { text-align: center; padding: 80rpx 0; }
.stats-row { gap: 16rpx; }
.stat {
  flex: 1;
  min-width: 0;
  padding: 24rpx 12rpx;
  text-align: center;
}
.num { display: block; font-size: 36rpx; font-weight: 600; }
.highlight { padding: 24rpx; background: rgba(236, 72, 153, 0.08); border-color: rgba(236, 72, 153, 0.2); }
.row {
  display: flex;
  gap: 16rpx;
  padding: 24rpx;
  align-items: center;
  box-sizing: border-box;
}
.row-body {
  flex: 1;
  min-width: 0;
}
.name { display: block; font-weight: 600; }
.progress { height: 8rpx; background: var(--bg-input); border-radius: 999px; margin-top: 12rpx; overflow: hidden; }
.bar { height: 100%; background: var(--brand-text, var(--brand)); border-radius: 999px; }
.score {
  color: var(--brand-text, var(--brand));
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}
.py-lg { padding: 80rpx 0; }
</style>

