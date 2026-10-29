/**
 * @file useAnalyticsButton.js
 * @description 模板内 @tap 用的埋点组合式，薄封装 trackButtonClick。
 */
import { trackButtonClick } from "@/utils/analytics";

/** @returns {{ trackTap: Function }} */
export function useAnalyticsButton() {
  /**
   * @param {string} buttonId
   * @param {string} [buttonName]
   * @param {string} [pagePath]
   */
  function trackTap(buttonId, buttonName, pagePath) {
    trackButtonClick(buttonId, buttonName || buttonId, pagePath);
  }
  return { trackTap };
}
