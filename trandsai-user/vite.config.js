import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

const require = createRequire(import.meta.url)
const proxyTarget = process.env.VITE_PROXY_TARGET || 'https://www.trandsai.com'
/** HBuilderX / uni-cli 编译时注入；App 真机调试为 app / app-plus，不能走 H5 专用逻辑 */
const isH5 = process.env.UNI_PLATFORM === 'h5'

const hbxDcloudio =
  '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules/@dcloudio'

/**
 * 项目 node_modules 通常没有 @dcloudio/uni-*（由 HBuilderX 提供）。
 * 优先旁路 vite-plugin-uni，再回落到本机 HBuilderX 安装目录。
 */
function resolveDcloudioFile(pkg, subpath) {
  const tries = []
  try {
    const pluginPkg = require.resolve('@dcloudio/vite-plugin-uni/package.json')
    tries.push(path.resolve(path.dirname(pluginPkg), '..', pkg, subpath))
  } catch {
    /* HBuilderX 外单独跑时可能解析不到 */
  }
  tries.push(path.resolve(__dirname, 'node_modules', '@dcloudio', pkg, subpath))
  tries.push(path.join(hbxDcloudio, pkg, subpath))
  for (const file of tries) {
    if (fs.existsSync(file)) return file
  }
  return null
}

const uniH5Vue = resolveDcloudioFile('uni-h5-vue', 'dist/vue.runtime.esm.js')

/** H5 下 WXS 仍是 module.exports，浏览器 ESM 需要 default export。 */
function wxsCjsToEsm() {
  return {
    name: 'wxs-cjs-to-esm',
    transform(code, id) {
      const q = id.split('?')[1] || ''
      const isWxs = q.includes('type=wxs') || q.includes('lang.wxs') || /\.wxs(?:\?|$)/.test(id)
      if (!isWxs) return null
      if (/\bexport\s+default\b/.test(code)) return null
      return {
        code: `const module = { exports: {} };\nconst exports = module.exports;\n${code}\nexport default module.exports;\n`,
        map: null,
      }
    },
  }
}

/**
 * ESM 里 `uni` 不是 window 全局；官方 uni:h5-inject 只在 build 生效。
 * 不能过早 import '@dcloudio/uni-h5'：会早于 pages-json-js 执行。
 * 用 virtual 模块代理到运行时的 window.uni；set 必须始终返回 true。
 * 仅 H5 使用；App 编译若注入 @dcloudio/uni-h5 会 Could not resolve。
 */
function injectUniGlobal() {
  const virtualName = 'virtual:uni-global'
  const virtualId = `\0${virtualName}`
  const skipPkg = /[\\/]@dcloudio[\\/]/
  let pagesJsonJsId = ''
  return {
    name: 'inject-uni-global',
    enforce: 'post',
    configResolved() {
      const input = process.env.UNI_INPUT_DIR || __dirname
      pagesJsonJsId = path.resolve(input, 'pages-json-js')
    },
    resolveId(id) {
      if (id === virtualName) return virtualId
      if (
        id === './pages-json-js' ||
        id === 'pages-json-js' ||
        id.endsWith('/pages-json-js')
      ) {
        return pagesJsonJsId || path.resolve(process.env.UNI_INPUT_DIR || __dirname, 'pages-json-js')
      }
    },
    load(id) {
      if (id !== virtualId) return null
      return `
const pending = Object.create(null)
const getUni = () => globalThis.uni
function flushPending(u) {
  for (const k of Object.keys(pending)) {
    if (u[k] == null) u[k] = pending[k]
    delete pending[k]
  }
}
export const uni = new Proxy(function () {}, {
  get(_t, p) {
    const u = getUni()
    if (u) {
      flushPending(u)
      const v = u[p]
      return typeof v === 'function' ? v.bind(u) : v
    }
    return pending[p]
  },
  set(_t, p, v) {
    const u = getUni()
    if (u) {
      u[p] = v
      return true
    }
    pending[String(p)] = v
    return true
  },
  has(_t, p) {
    const u = getUni()
    return u ? p in u : String(p) in pending
  },
})
`
    },
    transform(code, id) {
      if (id === virtualId || id.includes(virtualName)) return null
      if (skipPkg.test(id)) return null
      if (id.includes('type=wxs') || id.includes('lang.wxs') || /\.wxs(?:\?|$)/.test(id)) {
        return null
      }
      const file = id.split('?')[0].replace(/\\/g, '/')
      if (!/\.(vue|js|mjs|cjs|ts|jsx|tsx)$/.test(file) && !id.includes('type=script')) {
        return null
      }
      if (file.includes('uview-plus/libs/function/uni-api-shims.js')) return null

      let next = code
      if (/(^|\/)main\.js$/.test(file)) {
        next = ensureH5MainBootstrap(next, pagesJsonJsId)
      }

      if (!/\buni\b/.test(next)) return next === code ? null : { code: next, map: null }
      if (/from\s+['"]virtual:uni-global['"]/.test(next)) {
        return next === code ? null : { code: next, map: null }
      }

      if (file.includes('uview-plus/components/u-parse/parser.js')) {
        next = next.replace(
          /const systemInfo = uni\.getSystemInfoSync\(\)\s*\n\s*windowWidth = systemInfo\.windowWidth/,
          `try {
  const _u = typeof uni !== 'undefined' ? uni : globalThis.uni
  windowWidth = (_u && _u.getSystemInfoSync && _u.getSystemInfoSync().windowWidth) || (typeof window !== 'undefined' && window.innerWidth) || 375
} catch (e) {
  windowWidth = (typeof window !== 'undefined' && window.innerWidth) || 375
}`
        )
      }

      const shimImport = `import { uni } from 'virtual:uni-global';\n`
      const pagesMarker = 'pages-json-js'
      const pagesAt = next.indexOf(pagesMarker)
      if (pagesAt >= 0) {
        const lineEnd = next.indexOf('\n', pagesAt)
        const at = lineEnd >= 0 ? lineEnd + 1 : pagesAt + pagesMarker.length
        next = next.slice(0, at) + shimImport + next.slice(at)
      } else {
        next = shimImport + next
      }
      return { code: next, map: null }
    },
  }
}

/** 官方 uni:h5-main-js 未改写时，补上 pages-json-js + plugin + mount。 */
function ensureH5MainBootstrap(code, pagesJsonJsId) {
  if (code.includes('pages-json-js') && /mount\s*\(\s*["']#app["']\s*\)/.test(code)) {
    return code
  }
  let next = code
  if (!/from\s+['"]@dcloudio\/uni-h5['"]/.test(next)) {
    // createVueApp 仅存在于 uni-h5-vue；无该运行时时保持 createSSRApp
    if (uniH5Vue) {
      next = next.replace(
        /import\s*\{\s*createSSRApp\s*\}\s*from\s*['"]vue['"]/,
        "import { createVueApp as createSSRApp } from 'vue'"
      )
    }
    next = `import { plugin as __plugin } from '@dcloudio/uni-h5';${next};\ncreateApp().app.use(__plugin).mount("#app");`
  }
  if (!next.includes('pages-json-js')) {
    const abs =
      pagesJsonJsId ||
      path.resolve(process.env.UNI_INPUT_DIR || __dirname, 'pages-json-js')
    next = `import ${JSON.stringify(abs)};${next}`
  }
  return next
}

export default defineConfig({
  plugins: [
    uni(),
    ...(isH5 ? [wxsCjsToEsm(), injectUniGlobal()] : []),
  ],
  transpileDependencies: ['uview-plus'],
  ...(isH5 && uniH5Vue
    ? {
        resolve: { alias: { vue: uniH5Vue } },
        optimizeDeps: {
          exclude: ['uview-plus', 'vue', '@dcloudio/uni-h5'],
        },
      }
    : {}),
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: true,
      },
      '/companions': {
        target: proxyTarget,
        changeOrigin: true,
        secure: true,
      },
      '/ws': {
        target: proxyTarget,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
})
