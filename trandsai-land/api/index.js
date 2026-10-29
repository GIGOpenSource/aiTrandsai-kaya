import { postRequest, getRequest } from "@/utils/http.js";



// 上传图片
export const uploadImages = (params) => {
	return postRequest('/upload/', params)
}

//创建海报
export const createPoster = (params) => {
	return postRequest('/poster/',params)
}

// 海报详情
export const getPosterDetails = (id) => {
	return getRequest(`/poster/${id}/`)
}

// 深度报告
export const getDeepPoster = (params) => {
	return getRequest(`/poster/deep-report/`,params)
}

//获取钱数
export const getProducts = (type) => {
	return getRequest(`/products/`,{product_type:type})
}

//创建订单
export const createOrder = (params) => {
	return postRequest('/wechat/getPrepayId',params)
}

//解锁广告订单
export const advOrder = (params) => {
	return postRequest('/adv/getPrepayId',params)
}

//分享
export const share = (params) => {
	return postRequest('/wechat/updateShare',params)
}

//引导页
export const getGuid = () => {
	return getRequest(`/guid/`,{})
}

//解锁深度报告
export const freeReport = (params) => {
	return getRequest(`/poster/free_report/`, params)
}

//获取答案之书
export const getBook = () => {
	return getRequest(`/answerbook/random_9/`, {})
}

//获取答案之书答案
export const getAnswerbook = (params) => {
	return getRequest(`/answerbook/generate_image/`, params)
}

//获取ai答案
export const getAi = (params) => {
	return getRequest(`/answerbook/generate_answer_deep_image/`, params)
}

//获取次数
export const getCard = (params) => {
	return getRequest(`/answerbook/flip_card/`, params)
}





