# uni-app Vue3 + uview-plus 项目开发规范
## 基础信息
1. 框架：uni-app + Vue3（组合式API `<script setup>`）
2. UI组件库：uview-plus
3. 运行端：兼容 H5 + App（Android/iOS）
4. 目录约束：**根目录直接存放资源，不存在 src 文件夹**
5. 分包规则：
   - 主包页面：`pages/`
   - 分包页面：`pagesA/`
6. 接口管理：统一放置 `api/`，按业务拆分独立js文件
7. 编码规范：
   - 禁止 IIFE 自执行函数
   - App端不兼容样式：禁止使用 `gap`
   - Vue单文件严格分区：template(HTML) → script(JS) → style(CSS)
8. 禁止使用：`gap`、IIFE代码

## 一、项目整体目录结构（根目录层级，无src）
├── .hbuilderx                 # HBuilderX 配置目录
├── api                        # 业务接口目录，按业务模块拆分js文件
├── components                 # 全局自定义公共组件
├── config                     # 项目全局配置文件（环境、常量等）
├── i18n                       # 多语言资源目录
├── node_modules               # npm依赖包
├── pages                      # 【主包】页面目录
├── pagesA                     # 【分包】页面根目录
├── static                     # 静态资源（图片、字体、本地资源）
├── unpackage                  # 打包产物目录
├── utils                      # 工具函数
│   ├── http.js                # 请求基础封装
│   └── i18n.js                # 多语言工具
├── App.vue                    # 应用根组件
├── index.html                 # H5入口html
├── main.js                    # vue应用入口文件
├── manifest.json              # uni-app应用配置
├── package-lock.json
├── package.json               # npm依赖配置
├── pages.json # 路由、分包、easycom 全局配置（已配置完成）
├── README.md                  # 项目说明文档
├── uni.promisify.adaptor.js
├── uni.scss                   # 全局scss样式变量
└── vite.config.js             # vite构建配置


## 三、pages.json 说明
> 文件已提前配置完成，包含路由、分包、uview-plus easycom自动引入，常规开发无需改动
### 核心配置简述
1. `pages` 数组：存放**主包**页面，路径统一 `pages/页面文件夹/页面文件`
2. `subPackages` 配置分包，分包根目录为 `pagesA`，所有分包页面统一放在pagesA下
3. easycom已配置uview-plus自动识别，页面直接书写`<u-xxx>`组件，无需手动import
```json
{
	"pages": [
		// 主包页面示例
		"pages/index/index"
	],
	"subPackages": [
		{
			"root": "pagesA",
			"pages": [
				// 分包页面示例
				"pagesA/list/list"
			]
		}
	],
	"easycom": {
		"autoscan": true,
		"custom": {
			"^u-(.*)": "uni_modules/uview-plus/components/u-$1/u-$1.vue"
		}
	}
}
新增页面后，自行在 pages.json 补充对应路由
四、API 接口开发规范（重点）
utils/http.js 请求底层封装已经完成，禁止修改底层逻辑；
所有业务接口统一新建在 api/ 目录，按业务模块拆分 js 文件
使用规则
1、一个业务模块对应一个 api 文件（user.js、order.js、goods.js...）
2、统一使用 export function 导出接口方法
3、❌ 禁止书写 IIFE 自执行函数
4、❌ 禁止在 vue 页面直接写 uni.request，必须调用 api 导出函数
五、Vue 单文件编码强制规范
template(HTML) → <script setup>(JS) → style(CSS)
<template>
	<!-- HTML结构，直接使用uview-plus组件 -->
	<u-view class="page-wrap">
		<u-button type="primary" @click="login">登录</u-button>
	</u-view>
</template>

<script setup>
// JS业务逻辑，组合式API
import { apiUserLogin } from '../../api/user.js'

const login = async () => {
	// 请求逻辑
}
</script>

<style scoped>
/* 页面样式 */
.page-wrap {
	padding: 30rpx;
}
</style>
2. CSS 样式硬性约束
App 端不兼容 gap 属性，全局禁止使用 gap
/* ❌ 禁止写法 */
.box {
	display: flex;
	gap: 20rpx;
    flex:1
}

/* ✅ 兼容写法，使用margin/padding替代间距 */
.item {
	margin-bottom: 20rpx;
	margin-right: 20rpx;
}
六、uview-plus 使用说明
项目已全局配置 easycom 自动引入，无需在页面 import 组件；
页面中可以直接使用所有 uview 组件：
<u-input v-model="form.name" placeholder="请输入名称"/>
<u-button>提交</u-button>
<u-popup v-model="show">弹窗内容</u-popup>
七、平台兼容要求
1、同时兼容 H5 + App 端；
2、布局尺寸优先使用 rpx 单位；
3、尽量使用 uni 内置 API，避免使用浏览器专属 Web API；
4、样式调试同时关注 App 端表现，重点规避 gap、web 专属样式。
七、getImg所有的图片调用这个函数去写 需要传递图片路径即可