<template>
	<view class="landing">
		<image class="landing__bg" src="/static/ui/index/backGroundico.svg" mode="aspectFill" />
		<!-- 内容层：叠在背景图之上，自底部向上撑开 -->
		<view class="landing__body">
			<!-- 品牌 -->
			<view class="brand">
                <view style="display: flex; align-items: center; flex-direction: column;">
                    <image class="brand__icon" src="/static/ui/index/iOS_logo_60.svg" mode="aspectFill" />
				    <text class="brand__name">Trands</text>
                </view>  				
				<view class="brand__tagline">
					<image class="brand__glyph brand__glyph--left" src="/static/ui/index/reg.svg" mode="aspectFit" />
					<text class="brand__tagtext">ALWAYS HERE FOR YOU</text>
					<image class="brand__glyph brand__glyph--right" src="/static/ui/index/reg.svg" mode="aspectFit" />
				</view>
			</view>

			<!-- 主标题 -->
			<view class="headline">
				<text class="headline__lead">Meet the AI Companion</text>
				<view class="headline__grad headline__grad--rose">Matched Just</view>
				<view class="headline__grad headline__grad--sun">for You.</view>
			</view>

			<!-- 说明文案 -->
			<text class="desc">Chat, connect, and share deep moments with an Alcompanion shaped perfectly around you, capturingevery beautiful memory together.</text>

			<!-- 下载卡片 -->
			<view class="download">
				<text class="download__title">Start your story today</text>
				<view class="download__row">
					<view class="store">
						<image class="store__icon" src="/static/ui/index/logo.svg" mode="aspectFit" />
						<view class="store__text">
							<text class="store__kicker">GET IT ON</text>
							<text class="store__name">Google Play</text>
						</view>
					</view>
					<view class="store">
						<image class="store__icon store__icon--apple" src="/static/ui/index/iPhone.svg" mode="aspectFit" />
						<view class="store__text">
							<text class="store__kicker">GET IT ON</text>
							<text class="store__name">App Store</text>
						</view>
					</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script setup>
</script>

<style lang="scss" scoped>
/* 设计稿基准：375 × 812，1px = 2rpx */
.landing {
	position: relative;
	width: 100%;
	height: 100vh;
	height: 100dvh;
	overflow: hidden;
	background-color: #0b0b0c;
	font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI',
		'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif;

	/* 本页所有盒子统一按 border-box 计算，尺寸写死不受全局模型影响 */
	&,
	& *,
	& *::before,
	& *::after {
		box-sizing: border-box;
	}

	/* 背景图绝对定位铺满 */
	&__bg {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: block;
		z-index: 0;
	}

	/* 内容层贴在底部 */
	&__body {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		padding: 0 30rpx 56rpx;
	}
}

/* ---------- 品牌 ---------- */
.brand {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	padding: 0 26rpx;

	&__icon {
		width: 136rpx;
		height: 136rpx;
		display: block;
		border-radius: 32rpx;
	}

	&__name {
		margin-top: 12rpx;
		font-size: 28rpx;
		line-height: 40rpx;
		font-weight: 600;
		color: #ffffff;
	}

	&__tagline {
		display: flex;
		align-items: center;
		margin-top: 10rpx;
	}

	&__glyph {
		width: 22rpx;
		height: 22rpx;
		display: block;
		opacity: 0.65;
	}

	&__glyph--left {
		margin-right: 10rpx;
	}

	&__glyph--right {
		margin-left: 8rpx;
	}

	&__tagtext {
		font-size: 18rpx;
		color: #6C6C6C;
        font-family: SF Pro;
        font-weight: 510;
        font-style: Medium;
        line-height: 100%;
        letter-spacing: 0%;

	}
}

/* ---------- 标题 ---------- */
.headline {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	margin-top: 24rpx;
	padding: 0 26rpx;

	&__lead {
		font-size: 40rpx;
		line-height: 52rpx;
		font-weight: 700;
		color: #ffffff;
	}

	&__grad {
		font-size: 68rpx;
		line-height: 84rpx;
		font-weight: 800;
		letter-spacing: -0.5rpx;
		color: transparent;
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	&__grad--rose {
		margin-top: 4rpx;
		background-image: linear-gradient(90deg, #fff27d 0%, #ffdf83 36%, #fca791 72%, #f74f86 100%);
	}

	&__grad--sun {
		background-image: linear-gradient(90deg, #ffec6b 0%, #ffbb5f 52%, #ff9468 84%, #ff7f66 100%);
	}
}

/* ---------- 说明文案 ---------- */
.desc {
	display: block;
	margin-top: 34rpx;
	padding: 0 26rpx;
	color: #6C6C6C;
    font-family: SF Pro;
    font-weight: 510;
    font-style: Medium;
    font-size: 10px;
    line-height: 14px;
    letter-spacing: 0%;

}

/* ---------- 下载卡片 ---------- */
.download {
	margin-top: 32rpx;
	padding: 24rpx 24rpx 28rpx;
	border-radius: 40rpx;
	background-color: #202020;
	/* 用 inset 阴影画 1rpx 描边，不占盒模型尺寸，两种 box-sizing 下宽度一致 */
	box-shadow: inset 0 0 0 1rpx rgba(255, 255, 255, 0.05);

	&__title {
		display: block;
		font-size: 22rpx;
		line-height: 30rpx;
		text-align: center;
		color: #A5A5A5;
	}

	&__row {
		display: flex;
		margin-top: 20rpx;
	}
}

.store {
	flex: 1;
	display: flex;
	align-items: center;
	height: 86rpx;
	padding: 0 16rpx 0 26rpx;
	border-radius: 24rpx;
	background-color: #000000;

	& + & {
		margin-left: 20rpx;
	}

	&__icon {
		width: 40rpx;
		height: 40rpx;
		display: block;
	}

	&__icon--apple {
		width: 42rpx;
		height: 42rpx;
	}

	&__text {
		display: flex;
		flex-direction: column;
		margin-left: 14rpx;
	}

	&__kicker {
		font-size: 15rpx;
		line-height: 18rpx;
		font-weight: 500;
		letter-spacing: 0.8rpx;
		color: #ababb2;
	}

	&__name {
		font-size: 26rpx;
		line-height: 32rpx;
		font-weight: 600;
		color: #ffffff;
	}
}
</style>
