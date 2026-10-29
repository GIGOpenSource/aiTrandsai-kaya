/**
 * @file openPrivacy.js
 * @description 打开隐私政策 / 用户协议 / Apple 标准 EULA（App 外链浏览器，H5 新窗口）
 */

const PRIVACY_URL =
  "https://www.trandsai.com/agreement/Trands%20-%20Ai%20Privacy%20Policy.html";
const USER_AGREEMENT_URL =
  "https://www.trandsai.com/agreement/Trands%20-%20Ai%20User%20Agreement.html";
/** App Store 审核常用：标准 Licensed Application EULA */
const APPLE_STANDARD_EULA_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

function openExternalUrl(url) {
  // #ifdef APP-PLUS
  plus.runtime.openURL(url);
  // #endif
  // #ifdef H5
  window.open(url, "_blank");
  // #endif
}

export function openPrivacyPolicy() {
  openExternalUrl(PRIVACY_URL);
}

export function openUserAgreement() {
  openExternalUrl(USER_AGREEMENT_URL);
}

/** iOS 内购弹窗「使用条款」→ Apple 标准 EULA */
export function openAppleStandardEula() {
  openExternalUrl(APPLE_STANDARD_EULA_URL);
}

export { PRIVACY_URL, USER_AGREEMENT_URL, APPLE_STANDARD_EULA_URL };
