import { createI18n } from 'vue-i18n'
import zh from './locales/zh.js'
import en from './locales/en.js'
import es from './locales/es.js'
import pt from './locales/pt.js'
import ja from './locales/ja.js'
import ko from './locales/ko.js'

// 从本地存储获取语言设置，默认为中文
const getDefaultLocale = () => {
  try {
    const savedLocale = uni.getStorageSync('currentLanguage')
    return savedLocale || 'zh'
  } catch (e) {
    return 'zh'
  }
}

const i18n = createI18n({
  locale: getDefaultLocale(),
  fallbackLocale: 'zh',
  messages: {
    zh,
    en,
    es,
    pt,
    ja,
    ko
  },
  legacy: false, // 使用 Composition API 模式
  globalInjection: true // 全局注入 $t
})

// 导出 i18n 实例，方便在其他地方使用
export default i18n

// 导出设置语言的函数
export function setLocale(locale) {
  i18n.global.locale.value = locale
  uni.setStorageSync('currentLanguage', locale)
}

// 导出获取当前语言的函数
export function getLocale() {
  return i18n.global.locale.value
}

// 导出翻译函数
export function t(key, params = {}) {
  return i18n.global.t(key, params)
}

