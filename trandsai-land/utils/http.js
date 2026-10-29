import {
	host
} from '@/config/config.js'
// 验证token是否失效
var expired = false;
let requestRecord = {

}

// 动态获取token的函数
function getToken() {
	return uni.getStorageSync('token') || '';
}

let httpConfig = {
	header: {
		'Content-Type': "application/json",
		'is-dev': 'true'
	},
	method: 'POST',
	showLoading: true, // 是否显示请求中的loading
	loadingText: '请求中...',
	loadingTime: 800, // 在此时间内，请求还没回来的话，就显示加载中动画，单位ms
	timer: null, // 定时器
	loadingMask: false, // 展示loading的时候，是否给一个透明的蒙层，防止触摸穿透
	stopRepeat: false, // 是否阻止重复请求
	timeout: 1500000, // 请求超时时间
	errorOutput: true // 请求失败输出信息
}

function request(url, params, other) {
	other = {
		...httpConfig,
		...other
	};
	// 每次请求时动态获取token，确保使用最新的token
	const token = getToken();
	// other.header['Authorization'] = token;
	other.header['token'] = token;
	other.header['Accept-Language'] = uni.getStorageSync('currentLanguage')|| 'zh'
	return new Promise((resolve, reject) => {
		if (other.stopRepeat) {
			if (requestRecord.url === true) {
				reject();
				return;
			}
			requestRecord.url = true;
		}
		if (other.showLoading && !other.timer) {
			httpConfig.timer = setTimeout(() => {
				uni.showLoading({
					title: other.loadingText,
					mask: other.loadingMask
				});
				loadingShown = true; // 标记 loading 已显示
				other.timer = null;
			}, other.loadingTime);
		}
		uni.request({
			url: host + url,
			data: params,
			header: other.header,
			method: other.method,
			timeout: other.timeout,
			complete: data => {
				// 只有在 loading 已经显示的情况下才调用 hideLoading
				if (loadingShown) {
					try {
						uni.hideLoading();
					} catch (e) {
						// 忽略 hideLoading 错误
					}
				}
				clearTimeout(httpConfig.timer);
				httpConfig.timer = null;
	
				const respData = data.data || {};
				const isUnauthorized =
					data.statusCode === 401 ||
					respData.code === 401 ||
					respData.status === 401;

				if (isUnauthorized) {
					if (!expired) {
						expired = true;
						uni.removeStorageSync('token');
						uni.removeStorageSync('userInfo');
						if (httpConfig.errorOutput) {
							uni.showToast({
								title: '身份已过期，请重新登录',
								icon: 'none'
							});
						}
						setTimeout(() => {
						  uni.navigateTo({ url: '/pages/login/login' })
						}, 400);
					}
					reject(respData);
					return;
				}
                 console.log(data,'datata')
				if (data.statusCode == 200 || data.statusCode == 201) {
					if (!(data.data.code == 403 && !expired)) {
						expired = false;
						if (data.data.code == 200 || data.data.code == 201) resolve(data.data);
						else {
							if (httpConfig.errorOutput) {
								uni.showToast({
									title: data.data.msg || data.data.message || '请求失败',
									icon: 'none'
								})
							}
							reject(data.data);
						}
					} else {
						uni.removeStorage({
							key: 'token'
						})
						uni.removeStorage({
							key: 'userInfo'
						})
						uni.navigateTo({ url: '/pages/login/login' })
						expired = true;
						if (httpConfig.errorOutput) {
							uni.showToast({
								title: '身份已过期',
								icon: 'none'
							})
						}
						reject(data.data)
					}
				} else {
					if (httpConfig.errorOutput) {
						uni.showToast({
							title: '请求失败',
							icon: 'none'
						})
					}
					reject(data)
				}
				if (other.stopRepeat && requestRecord.url === true) {
					requestRecord.url = false;
				}
			}
		});
	})
}

function getRequest(url, params = {}, other = {}) {
	return request(url, params, {
		...other,
		method: 'GET'
	})
}

function postRequest(url, params = {}, other = {}) {
	return request(url, params, {
		...other,
		method: 'POST'
	})
}
function putRequest(url, params = {}, other = {}) {
	return request(url, params, {
		...other,
		method: 'PUT'
	})
}
function patchRequest(url, params = {}, other = {}) {
	return request(url, params, {
		...other,
		method: 'PUT'
	})
}
function deleteRequest(url, params = {}, other = {}) {
	return request(url, params, {
		...other,
		method: 'DELETE'
	})
}
function getImg(url) {
	return `/static/${url}.png`
	// return `/static/${url}.png`
}

export {
	request,
	getRequest,
	postRequest,
	putRequest,
	patchRequest,
	deleteRequest,
	getImg
}