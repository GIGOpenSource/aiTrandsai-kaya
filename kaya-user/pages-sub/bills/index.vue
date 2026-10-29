<script setup>
/**
 * @file pages-sub/bills — 账单明细页
 * @description Tab 对接 GET /api/payment/transactions
 * - vip_recharge_record / point_recharge_record / free_recharge_record / point_use_record
 * Tab 类名勿用 tab-item/tab-label（与全局底栏冲突会导致「没有样式」）。
 */
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/components/AppPageShell.vue";
import { api } from "@/utils/api";
import {
  initListViewHeight,
  measureListViewHeight,
  inspectListScroll,
  nextListPage,
  pushUniqueById,
  createListScrollGuard,
} from "@/utils/appListScroll";
import { companionPageHasMore } from "@/utils/companionsCache";

const { t } = useI18n();

const activeTab = ref("vip");
const tabs = computed(() => [
  { key: "vip", label: t("recharge.vipRecharge"), type: "vip_recharge_record" },
  { key: "topup", label: t("recharge.pointsRecharge"), type: "point_recharge_record" },
  { key: "gift", label: t("recharge.giftPoints"), type: "free_recharge_record" },
  { key: "used", label: t("recharge.pointsUsed"), type: "point_use_record" },
]);

const bills = ref([]);
const loading = ref(false);
const loadingMore = ref(false);
const page = ref(1);
const pageSize = 20;
const hasMore = ref(false);

const listViewHeight = ref(initListViewHeight(200));
const pin = createListScrollGuard();
let loadMoreLatched = false;
let loadMoreInFlight = null;
let loadSeq = 0;

function measureHeight() {
  measureListViewHeight(".bills-scroll", (h) => {
    listViewHeight.value = h;
  });
}

/** Tab → 接口 type */
function tabQueryType(tab) {
  const hit = tabs.value.find((x) => x.key === tab);
  return hit?.type || "vip_recharge_record";
}

/** 解包 { code, data: { pagination, results } } */
function pickPayload(body) {
  if (!body || typeof body !== "object") {
    return { results: [], pagination: null };
  }
  const data = body.data != null ? body.data : body.results != null ? body : body;
  if (Array.isArray(data)) {
    return { results: data, pagination: null };
  }
  if (!data || typeof data !== "object") {
    return { results: [], pagination: null };
  }
  const results = data.results ?? data.list ?? data.items ?? [];
  return {
    results: Array.isArray(results) ? results : [],
    pagination: data.pagination || null,
  };
}

function pickId(row) {
  return String(
    row?.id ??
      row?.transaction_id ??
      row?.order_id ??
      row?.txn_id ??
      row?.uuid ??
      ""
  );
}

function pickAmount(row) {
  const raw =
    row?.amount ??
    row?.credits ??
    row?.credit_delta ??
    row?.points ??
    row?.change ??
    row?.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function pickTitle(row) {
  return String(
    row?.event_name ??
      row?.title ??
      row?.product_title ??
      row?.plan_name ??
      row?.vip_name ??
      row?.name ??
      row?.remark ??
      row?.description ??
      ""
  ).trim();
}

function pickTime(row) {
  const raw =
    row?.created_at ??
    row?.time ??
    row?.created_time ??
    row?.timestamp ??
    row?.paid_at ??
    "";
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
}

function normalizeRow(row, idx, tabKey = activeTab.value, pageNo = 1) {
  let amount = pickAmount(row);
  // 积分使用：接口 amount 为正，展示为消耗（负数）
  if (tabKey === "used" && amount > 0) amount = -amount;
  const rawId = pickId(row);
  // 无真实 id 时带上页码，避免翻页 row-0 与首页撞车被去重掉
  return {
    id: rawId || `row-${pageNo}-${idx}`,
    amount,
    title: pickTitle(row),
    eventName: String(row?.event_name || "").trim(),
    time: pickTime(row),
    eventType: String(row?.event_type || row?.type || ""),
    raw: row,
  };
}

async function fetchBills({ reset = true } = {}) {
  if (reset) {
    if (loading.value) return;
    loading.value = true;
    page.value = 1;
    loadMoreLatched = false;
    // 立即清空旧 tab 数据，让 loading UI（loading && !bills.length）显示加载反馈
    bills.value = [];
  } else {
    if (loadMoreInFlight || loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
  }

  const seq = ++loadSeq;
  const type = tabQueryType(activeTab.value);
  const nextPage = reset ? 1 : nextListPage(false, page.value);
  const parts = [
    `type=${encodeURIComponent(type)}`,
    `page=${encodeURIComponent(nextPage)}`,
    `page_size=${encodeURIComponent(pageSize)}`,
  ];

  try {
    const body = await api.get(`/api/payment/transactions?${parts.join("&")}`);
    if (seq !== loadSeq) return;
    const { results, pagination } = pickPayload(body);
    const mapped = results.map((row, idx) =>
      normalizeRow(row, idx, activeTab.value, nextPage)
    );
    let appendedCount = mapped.length;
    if (reset) {
      bills.value = mapped;
    } else {
      const { appendedCount: n } = pushUniqueById(bills, mapped);
      appendedCount = n;
    }
    page.value = nextPage;

    let more = false;
    if (pagination && typeof pagination.total_pages === "number") {
      more = nextPage < Number(pagination.total_pages);
    } else if (pagination && typeof pagination.total === "number") {
      more = bills.value.length < Number(pagination.total);
    } else {
      more = companionPageHasMore(mapped, pagination, pageSize);
    }
    if (!reset) {
      if (appendedCount <= 0 || mapped.length < pageSize) more = false;
    } else if (mapped.length < pageSize) {
      more = false;
    }
    hasMore.value = more;
  } catch (e) {
    console.error("[bills] fetch failed:", e);
    if (seq !== loadSeq) return;
    if (reset) {
      bills.value = [];
      hasMore.value = false;
    } else {
      hasMore.value = false;
    }
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
    nextTick(measureHeight);
  }
}

function onTabTap(key) {
  if (activeTab.value === key) return;
  activeTab.value = key;
}

function formatAmount(val) {
  const n = Number(val) || 0;
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

/** 积分使用：-50积分 */
function formatUsedAmount(val) {
  const n = Math.abs(Number(val) || 0);
  return `-${n}${t("recharge.points")}`;
}

function onScrollToLower() {
  if (loadMoreLatched) return;
  if (loading.value || loadingMore.value || loadMoreInFlight || !hasMore.value) return;
  if (!pin.contentOverflows(listViewHeight.value)) return;
  loadMoreLatched = true;
  loadMoreInFlight = fetchBills({ reset: false }).finally(() => {
    loadMoreInFlight = null;
  });
}

function onBillsScroll(e) {
  const detail = e?.detail || {};
  pin.noteScroll(detail);
  const { load, unlock } = inspectListScroll(detail, listViewHeight.value, {
    hasMore: hasMore.value,
    busy: Boolean(loading.value || loadingMore.value || loadMoreInFlight),
    latched: loadMoreLatched,
  });
  if (load) {
    onScrollToLower();
    return;
  }
  if (unlock) loadMoreLatched = false;
}

watch(activeTab, () => {
  fetchBills({ reset: true });
});

onMounted(() => {
  fetchBills({ reset: true });
});
</script>

<template>
  <AppPageShell :title="t('recharge.billsTitle')" :show-back="true">
    <!-- 类名 bills-*：避开全局 .tab-item / .tab-label -->
    <scroll-view scroll-x class="bills-tabs-scroll" :show-scrollbar="false">
      <view class="bills-tabs">
        <view
          v-for="tab in tabs"
          :key="tab.key"
          class="bills-tab"
          :class="{ 'bills-tab--active': activeTab === tab.key }"
          hover-class="none"
          @tap="onTabTap(tab.key)"
        >
          <text class="bills-tab__text">{{ tab.label }}</text>
          <view v-if="activeTab === tab.key" class="bills-tab__line" />
        </view>
      </view>
    </scroll-view>

    <scroll-view
      scroll-y
      class="bills-scroll"
      :lower-threshold="120"
      @scroll="onBillsScroll"
      @scrolltolower="onScrollToLower"
    >
      <view v-if="loading && !bills.length" class="empty-hint">{{ t("common.loading") }}</view>
      <view v-else-if="!bills.length" class="empty-hint">{{ t("recharge.noRecords") }}</view>
      <view v-else class="bills-card">
        <view
          v-for="(item, idx) in bills"
          :key="`${activeTab}-${item.id}-${idx}`"
          class="bill-item"
        >
          <view class="bill-left">
            <!-- 积分使用：event_name + -N积分 -->
            <template v-if="activeTab === 'used'">
              <text v-if="item.eventName || item.title" class="bill-title">
                {{ item.eventName || item.title }}
              </text>
              <view class="bill-amount-row">
                <text class="bill-amount negative">{{ formatUsedAmount(item.amount) }}</text>
                <image
                  class="bill-coin"
                  src="/static/recharge/points-bills-icon.webp"
                  mode="aspectFit"
                />
              </view>
            </template>
            <template v-else>
              <view class="bill-amount-row">
                <!-- VIP：优先展示套餐名；无标题时回退金额 -->
                <text
                  v-if="activeTab === 'vip' && item.title"
                  class="bill-title"
                >{{ item.title }}</text>
                <template v-else>
                  <text
                    class="bill-amount"
                    :class="item.amount > 0 ? 'positive' : 'negative'"
                  >
                    {{ formatAmount(item.amount) }}
                  </text>
                  <image
                    v-if="activeTab !== 'vip'"
                    class="bill-coin"
                    src="/static/recharge/points-bills-icon.webp"
                    mode="aspectFit"
                  />
                </template>
              </view>
            </template>
            <text class="bill-id">ID:{{ item.id }}</text>
          </view>
          <view class="bill-right">
            <text class="bill-time">{{ item.time }}</text>
          </view>
        </view>
      </view>
      <view v-if="loadingMore" class="empty-hint loadmore">{{ t("common.loading") }}</view>
    </scroll-view>
  </AppPageShell>
</template>

<style scoped lang="scss">
/* 对齐充值弹窗 recharge-tabs；四 Tab 可横滑 */
.bills-tabs-scroll {
  width: 100%;
  flex-shrink: 0;
  white-space: nowrap;
}

.bills-tabs {
  display: inline-flex;
  flex-direction: row;
  align-items: flex-end;
  padding: 28rpx 32rpx 0;
  box-sizing: border-box;
  min-width: 100%;
}

.bills-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 12rpx;
  margin-right: 36rpx;
  flex-shrink: 0;
}

.bills-tab__text {
  font-size: 30rpx;
  font-weight: 500;
  line-height: 1.2;
  color: var(--fg-faint, rgba(255, 255, 255, 0.45));
  white-space: nowrap;
}

.bills-tab--active .bills-tab__text {
  color: var(--fg, #ffffff);
  font-weight: 600;
}

.bills-tab__line {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 40rpx;
  height: 4rpx;
  margin-left: -20rpx;
  border-radius: 4rpx;
  /* 深色品牌渐变；浅色跟 --tab-underline（深色实线） */
  background: var(--tab-underline, var(--gradient-brand));
}

.bills-scroll {
  flex: 1;
  min-height: 0;
  height: 0;
  width: 100%;
  max-width: 100%;
  padding: 16rpx 0 calc(24rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  overflow-x: hidden;
}

.empty-hint {
  text-align: center;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  padding: 80rpx 0;
  font-size: 28rpx;

  &.loadmore {
    padding: 32rpx 0;
  }
}

.bills-card {
  background: var(--card-bg, rgba(255, 255, 255, 0.05));
  border-radius: 24rpx;
  padding: 8rpx 0;
  margin: 0 32rpx;
  overflow: hidden;
}

.bill-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 32rpx 32rpx;
  box-sizing: border-box;
  width: 100%;
}

.bill-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  margin-right: 24rpx;
}

.bill-amount-row {
  display: flex;
  align-items: center;
  margin-bottom: 8rpx;
}

.bill-amount {
  font-size: 32rpx;
  font-weight: 600;
  margin-right: 12rpx;

  &.positive {
    color: #dfab52;
  }

  &.negative {
    color: #3dae73;
  }
}

.bill-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--fg, #ffffff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  margin-bottom: 8rpx;
}

.bill-coin {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.bill-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}

.bill-id {
  font-size: 22rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.bill-time {
  font-size: 22rpx;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
}
</style>
