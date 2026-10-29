<script setup>
/**
 * @file AppListSkeleton.vue
 * @description 列表骨架屏：无缓存首屏占位，配合「先 UI 后数据」。
 * 仅用于数据区域，不替代 AppPageShell 顶栏/Tab。
 */
defineProps({
  /** 骨架行数 */
  rows: { type: Number, default: 4 },
  /** 是否显示左侧圆形头像占位 */
  avatar: { type: Boolean, default: true },
});
</script>

<template>
  <view class="list-skeleton px-md py-sm">
    <view v-for="i in rows" :key="i" class="skel-row flex-row items-center gap-sm">
      <view v-if="avatar" class="skel-avatar skeleton" />
      <view class="skel-body flex-col" style="flex: 1">
        <view class="skel-line skeleton" style="width: 40%; height: 28rpx; margin-bottom: 16rpx" />
        <view class="skel-line skeleton" style="width: 80%; height: 24rpx" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.list-skeleton {
  padding-top: 24rpx;
}

.skel-row {
  margin-bottom: 32rpx;
}

.skel-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
