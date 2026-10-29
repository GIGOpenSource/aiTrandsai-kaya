import App from './App'
import i18n from './i18n'
import uviewPlus from 'uview-plus'
import { standardFetch, standardApi } from './utils/api'

/**
 * 全局暴露统一 HTTP 客户端，挂到 uni 对象上：
 * - 所有页面 / 组件 / 普通 JS 文件可直接调用，无需每次 import
 * - 跨 H5 / APP / 小程序端通用（uni 为全局对象，属性在页面切换后保留）
 *
 * 用法：
 *   uni.standardFetch(url, options)
 *   uni.standardApi.get(url, options)
 *   uni.standardApi.post(url, data, options)
 *   uni.standardApi.put(url, data, options)
 *   uni.standardApi.delete(url, options)
 */
uni.standardFetch = standardFetch
uni.standardApi = standardApi

// #ifndef VUE3
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
Vue.prototype.$standardFetch = standardFetch
Vue.prototype.$standardApi = standardApi
App.mpType = 'app'
const app = new Vue({
  i18n,
  ...App
})
app.$mount()
// #endif

// #ifdef VUE3
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import { useChatStore } from './stores/chat'
import { useThemeStore } from './stores/theme'
import { trackCurrentPageIfChanged } from './utils/analytics'

export function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(i18n)
  app.use(uviewPlus)

  app.mixin({
    onShow() {
      try {
        trackCurrentPageIfChanged();
      } catch {
        /* ignore */
      }
    },
  });

  // Vue3：同时挂到 globalProperties，模板里可用 $standardApi / $standardFetch
  app.config.globalProperties.$standardFetch = standardFetch
  app.config.globalProperties.$standardApi = standardApi

  const chat = useChatStore()
  chat.setupLifecycle()
  chat.watchPersistEffects()

  useThemeStore()

  return { app }
}
// #endif
