/**
 * @file useRechargeCatalog.js
 * @description 拉取 VIP/积分套餐与积分说明；不含 Apple/Google 调起。
 * 选模板：platform（必传）+ X-App-Key + 商店国家 X-Storefront-Country。
 * iOS 再用商品 id 调 appleiap.requestProduct 显示店面价。
 */
import { ref } from "vue";
import { api, unwrapApiResults } from "@/utils/api";
import i18n from "@/i18n";
import { getAuthHeaders } from "@/utils/authHeaders";
import {
  formatAppleStorePrice,
  requestAppleProducts,
  subscriptionPeriodDays,
} from "@/utils/appleStorePrice";
import {
  benefitsQuery,
  formatAgents,
  formatBenefitPrice,
  formatDailyAvg,
  formatGiftPoints,
  formatStoreDailyAvg,
  getPayPlatform,
} from "@/utils/rechargeCatalog";
import { resolveBenefitsRequestContext } from "@/utils/storefront";

function maskRequestHeaders(header) {
  const out = { ...(header || {}) };
  const tokenKey = Object.keys(out).find(
    (k) => String(k).toLowerCase() === "x-token"
  );
  if (tokenKey && out[tokenKey]) {
    out[tokenKey] = `present,len=${String(out[tokenKey]).length}`;
  }
  return out;
}

function logBenefitsRequest(type, query, storefrontHeader) {
  const uiLocale = String(i18n.global.locale.value || "");
  const sys = (() => {
    try {
      return uni.getSystemInfoSync() || {};
    } catch {
      return {};
    }
  })();
  const mergedHeader = {
    "Accept-Language": uiLocale,
    ...getAuthHeaders(),
    ...storefrontHeader,
    "Content-Type": "application/json",
  };
  console.log(
    "[rechargeCatalog] 发给后端 /api/benefits 的全部信息",
    JSON.stringify({
      method: "GET",
      path: `/api/benefits?${query}`,
      query,
      type,
      payPlatform: getPayPlatform() || "",
      uiLanguage: uiLocale,
      systemLanguage: sys.language || "",
      systemLocale: sys.locale || sys.osLanguage || "",
      note:
        "必带 platform + X-Storefront-Country（商店国家优先，其次语言映射）；X-App-Key 由全局 header 注入",
      header: maskRequestHeaders(mergedHeader),
    })
  );
}

export function useRechargeCatalog(t) {
  const selectedVipPlan = ref("");
  const selectedPackageKey = ref("");
  const selectedPoints = ref(0);
  const vipPlans = ref([]);
  const pointPackages = ref([]);
  const benefitsLoading = ref(false);
  /** TestFlight 上直接显示，便于截图看卡在哪一步 */
  const catalogDebug = ref("");
  const benefitNotes = { subscribe: "", point: "" };

  function rememberBenefitNote(type, text) {
    if (type === "point" || type === "points") benefitNotes.point = text;
    else benefitNotes.subscribe = text;
  }

  function benefitsNoteText() {
    return [benefitNotes.subscribe, benefitNotes.point].filter(Boolean).join(" ");
  }
  /** 未就绪前不展示本地兜底数字，避免弹窗先闪本地值再跳成接口值 */
  const creditExplainReady = ref(false);
  const creditExplain = ref({
    chat: null,
    create_companion: null,
    maintain_companion: null,
  });

  async function fetchBenefits(
    type = "subscribe",
    { manageLoading = true, header = {}, ctx = null } = {}
  ) {
    if (manageLoading) benefitsLoading.value = true;
    try {
      const benefitsCtx = ctx || (await resolveBenefitsRequestContext());
      if (!benefitsCtx) {
        rememberBenefitNote(type, `${type}跳过：缺少 platform`);
        return;
      }
      const query = benefitsQuery(type, {
        platform: benefitsCtx.platform,
        country: benefitsCtx.country,
        locale: i18n.global.locale.value,
      });
      const requestHeader = {
        ...(header || {}),
        ...benefitsCtx.header,
      };
      logBenefitsRequest(type, query, requestHeader);
      const res = await api.get(`/api/benefits?${query}`, {
        header: requestHeader,
      });
      console.log(
        "[rechargeCatalog] /api/benefits 返回",
        JSON.stringify({
          type,
          raw: res,
        })
      );
      const data = unwrapApiResults(res) || {};
      const readList = (key) => {
        const candidates = [data?.[key], data?.results?.[key], data?.result?.[key], res?.[key], res?.results?.[key], res?.result?.[key]];
        return candidates.find((item) => Array.isArray(item)) || [];
      };
      if (type === "subscribe" || type === "vip") {
        const list = readList("subscribe");
        rememberBenefitNote(type, `会员接口 ${list.length} 条`);
        // 不去重：同 period 多条（如两个 monthly）全部展示；苹果/谷歌共用
        vipPlans.value = list.map((item, idx) => {
          const period = String(item.period || "").trim();
          const discountPct = item.discount_pct;
          const priced = formatBenefitPrice(item);
          const id = item.id ?? `vip-${idx}`;
          return {
            id,
            key: `id:${id}`,
            planType: period,
            name: item.title,
            price: priced.price,
            showDollarPrefix: priced.showDollarPrefix,
            daily: formatDailyAvg(t, item.daily_avg_price, priced.price),
            dailyGiftCredits: Number(item.daily_gift_credits) || 0,
            points: formatGiftPoints(t, item.daily_gift_credits),
            maxAgents: Number(item.max_agents) || 0,
            agents: formatAgents(t, item.max_agents),
            save: discountPct
              ? String(t("recharge.savePct", { n: discountPct })).replace(
                  /\{n\}/g,
                  String(discountPct)
                )
              : "",
            storeProductId: item.store_product_id || "",
            appleProductId: item.apple_product_id || "",
          };
        });
        if (
          list.length &&
          (!selectedVipPlan.value ||
            !vipPlans.value.some(
              (p) => String(p.key) === String(selectedVipPlan.value)
            ))
        ) {
          selectedVipPlan.value = String(vipPlans.value[0]?.key || "");
        }
      }
      if (type === "point" || type === "points") {
        const list = readList("point");
        rememberBenefitNote(type, `积分接口 ${list.length} 条`);
        // 不去重：同积分数多条全部展示；苹果/谷歌共用
        pointPackages.value = list.map((item, idx) => {
          const points = Number(item.credits_amount) || 0;
          const priced = formatBenefitPrice(item);
          const id = item.id ?? `pts-${idx}`;
          return {
            id,
            points,
            packageKey: `id:${id}`,
            price: priced.price,
            showDollarPrefix: priced.showDollarPrefix,
            discount: item.discount_pct ? `${item.discount_pct}% off` : "",
            title: item.title,
            storeProductId: item.store_product_id || "",
            appleProductId: item.apple_product_id || "",
          };
        });
        if (
          list.length &&
          (!selectedPackageKey.value ||
            !pointPackages.value.some(
              (p) => String(p.packageKey) === String(selectedPackageKey.value)
            ))
        ) {
          const first = pointPackages.value[0];
          selectedPackageKey.value = String(first?.packageKey || first?.id || "");
          selectedPoints.value = Number(first?.points) || 0;
        }
      }
    } catch (err) {
      rememberBenefitNote(type, `${type}失败 ${err?.status || ""} ${err?.message || err}`.trim());
      console.error("[rechargeCatalog] fetchBenefits error:", err);
    } finally {
      if (manageLoading) benefitsLoading.value = false;
    }
  }

  async function fetchCreditExplain() {
    const fallback = {
      chat: creditExplain.value.chat ?? 2,
      create_companion: creditExplain.value.create_companion ?? 50,
      maintain_companion: creditExplain.value.maintain_companion ?? 10,
    };
    try {
      const res = await api.get("/api/payment/credit-explain");
      const raw =
        (res &&
          typeof res === "object" &&
          (res.result ?? res.results ?? res.data)) ||
        unwrapApiResults(res) ||
        res ||
        {};
      const chat = Number(raw.chat);
      const create = Number(raw.create_companion);
      const maintain = Number(raw.maintain_companion);
      creditExplain.value = {
        chat: Number.isFinite(chat) && chat >= 0 ? chat : fallback.chat,
        create_companion:
          Number.isFinite(create) && create >= 0
            ? create
            : fallback.create_companion,
        maintain_companion:
          Number.isFinite(maintain) && maintain >= 0
            ? maintain
            : fallback.maintain_companion,
      };
    } catch (err) {
      console.error("[rechargeCatalog] fetchCreditExplain error:", err);
      if (!creditExplainReady.value) {
        creditExplain.value = fallback;
      }
    } finally {
      creditExplainReady.value = true;
    }
  }

  function applyAppleStorePrices(products) {
    const byId = new Map();
    for (const product of products) {
      const id = String(product?.productid || product?.productId || "").trim();
      if (!id) continue;
      const display = formatAppleStorePrice(
        product?.price,
        product?.pricelocal ?? product?.priceLocale
      );
      if (!display) continue;
      byId.set(id, { ...product, display });
    }
    if (!byId.size) return;

    vipPlans.value = vipPlans.value.map((plan) => {
      const priced = byId.get(String(plan.appleProductId || "").trim());
      if (!priced) return plan;
      const next = {
        ...plan,
        price: priced.display,
        showDollarPrefix: false,
      };
      const days = subscriptionPeriodDays(plan.planType);
      const amount = Number(priced.price);
      if (days > 0 && Number.isFinite(amount)) {
        const dailyDisplay = formatAppleStorePrice(
          amount / days,
          priced.pricelocal ?? priced.priceLocale
        );
        if (dailyDisplay) next.daily = formatStoreDailyAvg(t, dailyDisplay);
      }
      return next;
    });

    pointPackages.value = pointPackages.value.map((pkg) => {
      const priced = byId.get(String(pkg.appleProductId || "").trim());
      if (!priced) return pkg;
      return {
        ...pkg,
        price: priced.display,
        showDollarPrefix: false,
      };
    });
  }

  function setCatalogDebug(text) {
    catalogDebug.value = text;
    console.log("[rechargeDebug]", text);
  }

  async function loadCatalog() {
    benefitsLoading.value = true;
    setCatalogDebug("1 开始拉套餐");
    try {
      const benefitsCtx = await resolveBenefitsRequestContext();
      if (!benefitsCtx) {
        setCatalogDebug("2 缺少 platform=apple|google，跳过");
        return;
      }
      setCatalogDebug(
        `2 platform=${benefitsCtx.platform} country=${benefitsCtx.country} source=${benefitsCtx.source}`
      );
      benefitNotes.subscribe = "";
      benefitNotes.point = "";
      await Promise.all([
        fetchBenefits("subscribe", { manageLoading: false, ctx: benefitsCtx }),
        fetchBenefits("point", { manageLoading: false, ctx: benefitsCtx }),
        fetchCreditExplain(),
      ]);
      const ids = [
        ...vipPlans.value.map((plan) => plan.appleProductId),
        ...pointPackages.value.map((pkg) => pkg.appleProductId),
      ].filter(Boolean);
      setCatalogDebug(
        `3 后台 vip=${vipPlans.value.length} 积分=${pointPackages.value.length} ids=${ids.join(",") || "无"}`
      );
      if (getPayPlatform() === "apple") {
        setCatalogDebug(`4 支付通道查价 ids=${ids.join(",") || "无"}`);
        const result = await requestAppleProducts(ids);
        const products = result?.products || [];
        const shown = products
          .map((product) => {
            const id = product?.productid || product?.productId || "";
            const local = product?.pricelocal ?? product?.priceLocale ?? "";
            return `${id}:${product?.price}:${local}`;
          })
          .join(" | ");
        setCatalogDebug(
          `5 reason=${result?.reason || "empty"} 苹果返回 ${products.length} 个 vip=${vipPlans.value.length} ${benefitsNoteText()} ${shown || "空"}`
        );
        applyAppleStorePrices(products);
      } else {
        setCatalogDebug(`4 非 iOS，平台=${getPayPlatform() || "空"}`);
      }
    } catch (err) {
      setCatalogDebug(`失败 ${err?.message || err}`);
      console.error("[rechargeCatalog] loadCatalog error:", err);
    } finally {
      benefitsLoading.value = false;
    }
  }

  return {
    selectedVipPlan,
    selectedPackageKey,
    selectedPoints,
    vipPlans,
    pointPackages,
    benefitsLoading,
    catalogDebug,
    creditExplain,
    creditExplainReady,
    fetchBenefits,
    fetchCreditExplain,
    loadCatalog,
  };
}
