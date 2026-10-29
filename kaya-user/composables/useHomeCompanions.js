/**
 * @file useHomeCompanions.js
 * @description 首页顶部智能体条 + Companions Tab 列表加载（从 home/index 拆出，零 UI 变更）。
 */
import { ref, computed } from "vue";
import {
  fetchCompanions,
  fetchBCompanions,
  getCachedCompanions,
  companionPageHasMore,
} from "@/utils/companionsCache";
import {
  readHomeCompanionsStripCache,
  writeHomeCompanionsStripCache,
} from "@/utils/homeCache";
import { sortCompanionsByUserLang } from "@/utils/companionLang";
import { formatCompanionName } from "@/utils/formatCompanion";
import { getItem } from "@/utils/storage";

/**
 * @param {object} opts
 * @param {import('vue').Ref<string>|import('vue').ComputedRef<string>} opts.locale
 * @param {(key: string) => string} opts.t
 */
export function useHomeCompanions({ locale, t }) {
  const cachedCompanions = readHomeCompanionsStripCache();
  const companions = ref(cachedCompanions ?? []);

  const initialCachedHomeCompanions = getCachedCompanions() ?? [];
  const homeCompanions = ref(
    initialCachedHomeCompanions.length ? initialCachedHomeCompanions : []
  );
  const homeCompanionFilter = ref("all");
  /** 马甲包首页性别筛选："" | "男" | "女" */
  const homeGenderFilter = ref("");
  const homeCompanionsLoading = ref(!initialCachedHomeCompanions.length);
  const homeCompanionsLoadingMore = ref(false);
  const homeCompanionsHasMore = ref(true);
  const homeCompanionsPage = ref(0);
  const HOME_COMPANIONS_PAGE_SIZE = 20;
  const STRIP_PAGE_SIZE = 100;
  const stripPage = ref(0);
  const stripHasMore = ref(true);
  const stripLoadingMore = ref(false);
  const displayHomeCompanions = computed(() => homeCompanions.value);

  function mapStripItem(c) {
    return {
      id: c.profile?.id || "",
      name: formatCompanionName(c.profile?.name, t("home.defaultCompanionName")),
      avatar:
        c.avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.profile?.id}`,
      affection: c.state?.affection || 0,
      gender: c.profile?.gender || "",
      avatar_generating: c.avatar_generating,
    };
  }

  async function loadCompanionStrip({ reset = true } = {}) {
    if (!reset) {
      if (stripLoadingMore.value || !stripHasMore.value) return;
      stripLoadingMore.value = true;
    } else {
      stripHasMore.value = true;
    }
    const page = reset ? 1 : stripPage.value + 1;
    try {
      const { list, pagination } = await fetchBCompanions({
        special: "message",
        sort: "affection",
        page,
        page_size: STRIP_PAGE_SIZE,
      });
      const batch = Array.isArray(list) ? list : [];
      const userLang = locale.value || "zh";
      if (reset) {
        const sorted = sortCompanionsByUserLang(batch, userLang);
        companions.value = sorted.map(mapStripItem);
      } else {
        const seen = new Set(companions.value.map((c) => String(c.id || "")));
        const appended = batch
          .map(mapStripItem)
          .filter((c) => c.id && !seen.has(String(c.id)));
        companions.value = [...companions.value, ...appended];
      }
      stripPage.value = Number(pagination.page) || page;
      stripHasMore.value = companionPageHasMore(
        batch,
        pagination,
        STRIP_PAGE_SIZE
      );
      writeHomeCompanionsStripCache(companions.value);
    } catch (err) {
      console.error("[home] 加载头像条失败:", err);
    } finally {
      stripLoadingMore.value = false;
    }
  }

  function loadMoreCompanionStrip() {
    void loadCompanionStrip({ reset: false });
  }

  function homeCompanionsQuery(page) {
    const params = {
      page,
      page_size: HOME_COMPANIONS_PAGE_SIZE,
    };
    if (homeCompanionFilter.value === "recommended") {
      params.special = "recommend";
    } else if (homeCompanionFilter.value === "mine") {
      params.is_created = true;
      params.intimacy_value = 0;
    } else {
      params.intimacy_value = 0;
    }
    if (homeGenderFilter.value) {
      params.gender = homeGenderFilter.value;
    }
    return params;
  }

  async function loadHomeCompanions({ reset = true } = {}) {
    if (!reset) {
      if (
        homeCompanionsLoading.value ||
        homeCompanionsLoadingMore.value ||
        !homeCompanionsHasMore.value
      ) {
        return;
      }
      homeCompanionsLoadingMore.value = true;
    } else {
      homeCompanionsHasMore.value = true;
      // 筛选 / 下拉重置时也要有 loading，方便页面展示等待态
      homeCompanionsLoading.value = true;
    }

    const page = reset ? 1 : homeCompanionsPage.value + 1;
    try {
      const { list, pagination } = await fetchBCompanions(
        homeCompanionsQuery(page)
      );
      let companionsRes = list || [];
      if (
        reset &&
        homeCompanionFilter.value === "mine" &&
        !companionsRes.length
      ) {
        const aliases = new Set();
        try {
          const raw = getItem("user_info");
          if (raw) {
            const u = JSON.parse(raw);
            if (u?.id != null) aliases.add(String(u.id));
            if (u?.username) aliases.add(String(u.username));
            if (u?.nickname) aliases.add(String(u.nickname));
          }
        } catch {
          /* ignore */
        }
        const msgList = await fetchCompanions(
          { special: "message", page: 1, page_size: 100 },
          { force: true }
        );
        companionsRes = (msgList || []).filter((c) => {
          const cb = String(c?.profile?.created_by || "");
          return cb && aliases.has(cb);
        });
      }
      const userLang = locale.value || "zh";
      const nextList =
        homeCompanionFilter.value === "mine"
          ? sortCompanionsByUserLang(companionsRes, userLang)
          : companionsRes;
      let appended = nextList;
      if (reset) {
        homeCompanions.value = nextList;
      } else {
        const seen = new Set(
          homeCompanions.value.map((c) => String(c?.profile?.id || ""))
        );
        appended = nextList.filter((c) => {
          const id = String(c?.profile?.id || "");
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        homeCompanions.value = [...homeCompanions.value, ...appended];
      }
      homeCompanionsPage.value = Number(pagination.page) || page;
      homeCompanionsHasMore.value = companionPageHasMore(
        companionsRes,
        pagination,
        HOME_COMPANIONS_PAGE_SIZE
      );
    } catch (err) {
      console.error("[home] 加载智能体列表失败:", err);
    } finally {
      homeCompanionsLoading.value = false;
      homeCompanionsLoadingMore.value = false;
    }
  }

  return {
    companions,
    homeCompanions,
    homeCompanionFilter,
    homeGenderFilter,
    homeCompanionsLoading,
    displayHomeCompanions,
    loadCompanionStrip,
    loadMoreCompanionStrip,
    loadHomeCompanions,
    homeCompanionsLoadingMore,
    homeCompanionsHasMore,
    hasStripCache: Boolean(cachedCompanions?.length),
  };
}
