/**
 * @file toast.js
 * @description 全局轻提示：Pinia 状态 + uni.showToast 双写。
 * api.js 通过导出的 showToast() 调用，页面也可直接 import。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import i18n from "@/i18n";

/** Pinia store：可在模板中绑定 message 做自定义 Toast UI */
export const useToastStore = defineStore("toast", () => {
  const message = ref("");
  let timer = null;

/**
   * 展示提示
   * @param {string} text
   * @param {number} [duration=2500]
   * @param {{ skipNative?: boolean }} [opts] skipNative：仅写 Pinia（付费弹窗上自绘 tip 时用）
   */
  function showToast(text, duration = 2500, opts = {}) {
    message.value = text;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      message.value = "";
      timer = null;
    }, duration);
    if (!opts?.skipNative) {
      uni.showToast({ title: text, icon: "none", duration });
    }
  }

  return { message, showToast };
});

/**
 * 非组件上下文便捷调用（utils/api.js 等）
 * @param {string} text
 * @param {number} [duration]
 */
export function showToast(text, duration) {
  useToastStore().showToast(text, duration);
}

/**
 * 长文案提示：优先 Modal，避免 uni.showToast 截断审核说明
 * @param {string} text
 * @param {string} [title]
 */
export function showNotice(text, title = "") {
  uni.showModal({
    title: title || " ",
    content: String(text || ""),
    showCancel: false,
    confirmText: i18n.global.t("common.confirm"),
  });
}
