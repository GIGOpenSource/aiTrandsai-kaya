<template>
  <image
    :src="iconSrc"
    mode="aspectFit"
    :style="[customStyle]"
  />
</template>

<script>
export default {
  props: {
    // 图标文件名，可带或不带 .svg 后缀，组件统一补全为 .svg
    name: {
      type: String,
      required: true
    },
    // 尺寸，支持 rpx / px
    size: {
      type: String,
      default: '36rpx'
    }
  },
  computed: {
    iconSrc() {
      // 所有图标统一放在 static/home/ 下面
      const base = this.name.replace(/\.svg$/i, '');
      return `/static/home/${base}.svg`;
    },
    customStyle() {
      return {
        width: this.size,
        height: this.size
      }
    }
  }
}
</script>