/**
 * i18n 工具函数
 * 用于在 Options API 中方便地使用 i18n
 */

export function useI18nHelper() {
  // 获取 i18n 实例
  const getI18n = () => {
    const app = getApp();
    if (app && app.$i18n) {
      return app.$i18n;
    }
    return null;
  };

  // 设置语言
  const setLocale = (locale) => {
    const i18n = getI18n();
    if (i18n) {
      i18n.locale.value = locale;
      uni.setStorageSync('currentLanguage', locale);
    }
  };

  // 获取当前语言
  const getLocale = () => {
    const i18n = getI18n();
    if (i18n) {
      return i18n.locale.value;
    }
    return uni.getStorageSync('currentLanguage') || 'zh';
  };

  // 翻译函数
  const t = (key, params = {}) => {
    const i18n = getI18n();
    if (i18n) {
      return i18n.t(key, params);
    }
    return key;
  };

  return {
    getI18n,
    setLocale,
    getLocale,
    t
  };
}

