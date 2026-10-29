/**
 * @description Companion 语言推断与排序：根据城市名称推断机器人语言，并按用户界面语言优先排序列表。
 */

/** 城市到语言的映射（与 CreateCompanion 预设城市列表对应） */
const citiesByLang = {
  zh: ["北京", "上海", "成都", "广州", "深圳", "杭州", "武汉", "西安"],
  en: ["New York", "Los Angeles", "London", "San Francisco", "Seattle", "Chicago", "Boston", "Austin"],
  ja: ["東京", "大阪", "京都", "札幌", "福岡", "名古屋", "横浜", "神戸"],
  ko: ["서울", "부산", "인천", "대구", "광주", "대전", "울산", "제주"],
  pt: ["São Paulo", "Rio de Janeiro", "Salvador", "Brasília", "Belo Horizonte", "Fortaleza", "Curitiba", "Porto Alegre"],
  es: ["Madrid", "Barcelona", "México City", "Buenos Aires", "Lima", "Bogotá", "Santiago", "Valencia"],
  id: ["Jakarta", "Surabaya", "Bandung", "Medan", "Makassar", "Yogyakarta", "Semarang", "Bali"],
  ar: ["الرياض", "جدة", "دبي", "أبوظبي", "القاهرة", "الدار البيضاء", "عمّان", "الدوحة"],
  fa: ["تهران", "اصفهان", "مشهد", "شیراز", "تبریز", "کرج", "اهواز", "قم"],
  ru: ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Нижний Новгород", "Краснодар", "Сочи"],
  bg: ["София", "Пловдив", "Варна", "Бургас", "Русе", "Стара Загора", "Плевен", "Благоевград"],
  tr: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Gaziantep", "Eskişehir"],
};

/** 城市名称 → 语言代码的反向查找表 */
const cityToLangMap = {};
Object.entries(citiesByLang).forEach(([lang, cities]) => {
  cities.forEach((city) => {
    cityToLangMap[city] = lang;
  });
});

/**
 * 根据城市名称推断 Companion 的语言。
 * 与后端 culture_data.py::infer_language_from_city 保持一致，
 * 用于确保机器人 profile.language 与其地区（city）信息严格一致。
 * @param {string} city - 城市名称
 * @returns {string} 语言代码（zh/en/ja/ko/pt/es/id/ar/fa/ru/bg/tr），无法推断时返回 "zh"
 */
export function inferCompanionLanguage(city) {
  if (!city) return "zh";
  const cityLower = city.trim().toLowerCase();
  return cityToLangMap[city] ||
         (["北京", "上海", "成都", "广州", "深圳", "杭州", "武汉", "西安", "南京", "重庆"].some(c =>
           cityLower.includes(c.toLowerCase()) || c.toLowerCase().includes(cityLower)) ? "zh" : "zh");
}

/**
 * 根据用户当前语言对 Companion 列表进行排序：语言匹配的排在前面，其余保持相对顺序。
 * @param {Array<object>} companions - Companion 列表
 * @param {string} userLang - 用户当前界面语言
 * @returns {Array<object>} 排序后的新数组
 */
export function sortCompanionsByUserLang(companions, userLang) {
  const targetLang = userLang?.split("-")[0] || userLang || "zh";
  return [...companions].sort((a, b) => {
    const langA = a.profile?.language || inferCompanionLanguage(a.profile?.city || "");
    const langB = b.profile?.language || inferCompanionLanguage(b.profile?.city || "");
    const matchA = langA === targetLang ? 1 : 0;
    const matchB = langB === targetLang ? 1 : 0;
    return matchB - matchA;
  });
}
