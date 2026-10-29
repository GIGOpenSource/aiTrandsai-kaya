/**
 * @file firebaseProductAnalytics.js
 * @description 产品行为埋点：Firebase Analytics + 后端 /api/growth/attribution（event_type=product）双写。
 */

import { logEvent } from "@/utils/firebaseAnalytics";
import { reportProductAnalytics } from "@/utils/growthAttribution";
import { buildProductEventParams } from "@/utils/analyticsEventParams";

/** 产品事件名（与投放/数据表一致；含 26–36 扩展） */
export const PRODUCT_EVENTS = {
  APP_LAUNCH: "app_launch",
  LOGIN_PAGE_SHOW: "login_page_show",
  ACCOUNT_LOGIN_CLICK: "account_login_click",
  GOOGLE_LOGIN_CLICK: "google_login_click",
  APPLE_LOGIN_CLICK: "apple_login_click",
  NEWBIE_GUIDE_SHOW: "newbie_guide_show",
  HOME_PAGE_SHOW: "home_page_show",
  SEND_MESSAGE_ICON_CLICK: "send_message_icon_click",
  HOME_ROBOT_TAB_CLICK: "home_robot_tab_click",
  MOMENTS_COMMENT_CLICK: "moments_comment_click",
  PULL_REFRESH_REPORT: "pull_refresh_report",
  PULL_UP_LOAD_REPORT: "pull_up_load_report",
  MESSAGE_PAGE_CLICK: "message_page_click",
  CHAT_DETAIL_CLICK: "chat_detail_click",
  COMMUNITY_PAGE_CLICK: "community_page_click",
  MINE_PAGE_CLICK: "mine_page_click",
  AGENT_CREATE_CLICK: "agent_create_click",
  AGENT_CREATE_PAY_POPUP: "agent_create_pay_popup",
  FREE_MESSAGE_PAY_POPUP: "free_message_pay_popup",
  /** 首页 Say Hi 额度不足弹出充值/会员窗 */
  SAY_HI_PAY_POPUP: "say_hi_pay_popup",
  AGENT_CREATE_BUTTON_CLICK: "agent_create_button_click",
  MOMENTS_DETAIL_CLICK: "moments_detail_click",
  AVATAR_PROFILE_CLICK: "avatar_profile_click",
  ROBOT_LIST_CLICK: "robot_list_click",
  ROBOT_LIST_PULL_UP: "robot_list_pull_up",
  ROBOT_LIST_PULL_REFRESH: "robot_list_pull_refresh",
  /** 26–36 */
  REGISTRATION_FINISH: "Registration_finish",
  REGISTRATION_SKIP: "registration_skip",
  AVATAR_UPLOAD: "avatar_upload",
  PROFILE_DISPLAYED_15S: "profile_displayed_15s",
  MOMENT_15S: "Moment_15s",
  SEND_MESSAGE_CLICK_MOMENT: "send_message_click_moment",
  SEND_MESSAGE_CLICK_IM: "send_message_click_im",
  NO_DATA_OF_IM: "no_data_of_im",
  DREE_MESSAGE_5: "dree_message_5",
  DREE_MESSAGE_3: "dree_message_3",
  DREE_MESSAGE_0: "dree_message_0",
  /** 充值弹窗底部支付按钮点击（不看成败） */
  PAID_CLICK: "paid_click",
  /** AI 人物举报 */
  REPORT_CHARACTER_CLICK: "Report_character_Click",
  REPORT_CHARACTER_SUBMIT: "Report_character_submit",
  REPORT_CHARACTER_SUCCESS: "Report_character_success",
  REPORT_CHARACTER_REASON_MINOR: "Report_character_reason_minor_Click",
  REPORT_CHARACTER_REASON_SENSITIVE: "Report_character_reason_sensitive_Click",
  REPORT_CHARACTER_REASON_DISTURBING: "Report_character_reason_disturbing_Click",
  REPORT_CHARACTER_REASON_COPYRIGHT: "Report_character_reason_copyright_Click",
  REPORT_CHARACTER_REASON_OTHER: "Report_character_reason_other_Click",
  /** 意见反馈：仅 Messages 入口点击进入聊天 */
  FEEDBACK_ENTRY_CLICK: "feedback_entry_click",
  /** IM 对话页加载并渲染完成 */
  CHAT_PAGE_VIEW: "chat_page_view",
  /** 登录页快速登录：点击 / 成功 / 失败（含用户中途离开） */
  QUICK_LOGIN_CLICK: "quick_login_click",
  QUICK_LOGIN_SUCCESS: "quick_login_success",
  QUICK_LOGIN_FAIL: "quick_login_fail",
  /** Our Moments 私密相册 */
  OUR_MOMENTS_ENTRY_CLICK: "our_moments_entry_click",
  OUR_MOMENTS_VIEW: "our_moments_view",
  OUR_MOMENTS_PHOTO_UNLOCK: "our_moments_photo_unlock",
  OUR_MOMENTS_PHOTO_PREVIEW: "our_moments_photo_preview",
  /** 性别选择弹窗（首页强制补选；无确认按钮，不打 gender_confirm_click） */
  GENDER_PAGE_SHOW: "gender_page_show",
  GENDER_OPTION_CLICK: "gender_option_click",
  GENDER_SUBMIT_SUCCESS: "gender_submit_success",
  GENDER_SUBMIT_FAIL: "gender_submit_fail",
  /** 资料页编辑保存时性别变更 */
  PROFILE_GENDER_CHANGE: "profile_gender_change",
  /** 限时优惠 */
  LIMITED_OFFER_POPUP_SHOW: "limited_offer_popup_show",
  LIMITED_OFFER_BUY_CLICK: "limited_offer_buy_click",
  LIMITED_OFFER_CLOSE_CLICK: "limited_offer_close_click",
  LIMITED_OFFER_ENTRY_SHOW: "limited_offer_entry_show",
  LIMITED_OFFER_ENTRY_CLICK: "limited_offer_entry_click",
  LIMITED_OFFER_PURCHASE_SUCCESS: "limited_offer_purchase_success",
  LIMITED_OFFER_PURCHASE_FAIL: "limited_offer_purchase_fail",
  LIMITED_OFFER_EXPIRE: "limited_offer_expire",
};

/**
 * 上报产品事件（Firebase + 后端并行，fire-and-forget）
 * @param {string} eventName
 * @param {Record<string, string|number|boolean>} [params]
 */
export function trackProductEvent(eventName, params = {}) {
  if (!eventName) return;
  const payload = buildProductEventParams(params);
  logEvent(eventName, payload);
  void reportProductAnalytics(eventName, payload);
}

/**
 * 有智能体 id 时写入 companion_id（空值不写，避免污染参数）
 * @param {Record<string, string|number|boolean>} [params]
 * @param {string|number|null|undefined} companionId
 */
export function withCompanionId(params = {}, companionId) {
  const id =
    companionId != null && String(companionId).trim()
      ? String(companionId).trim()
      : "";
  if (!id) return { ...(params || {}) };
  return { ...(params || {}), companion_id: id };
}
