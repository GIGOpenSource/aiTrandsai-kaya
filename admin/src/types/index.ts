export interface StatsOverview {
  companion_count: number;
  total_turns: number;
  avg_affection: number;
  knowledge_count: number;
  user_count: number;
  avg_open_count: number;
  like_user_count: number;
  message_user_count: number;
  definitions?: Record<string, string>;
}

export type StatsUserType = 'all' | 'new' | 'old';

export type StatsModule = 'dau' | 'retention' | 'events' | 'funnel' | 'revenue';

export interface StatsDauItem {
  date: string;
  app_key?: string;
  open_devices: number;
  login_uids: number;
  /** 日活用户数：当日有任意归因/产品事件且 user_id 非空的去重用户 */
  active_users?: number;
  new_users: number;
}

export interface StatsRetentionItem {
  cohort_date: string;
  new_users: number;
  d0_count: number;
  d0_rate: number;
  d1_count: number;
  d1_rate: number;
  d2_count: number;
  d2_rate: number;
  d3_count: number;
  d3_rate: number;
  d4_count: number;
  d4_rate: number;
  d5_count: number;
  d5_rate: number;
  d6_count: number;
  d6_rate: number;
  d7_count: number;
  d7_rate: number;
  d30_count: number;
  d30_rate: number;
}

export interface StatsEventItem {
  date: string;
  event_name_zh: string;
  event_name_en: string;
  pv: number;
  uv: number;
}

export interface StatsFunnelItem {
  date: string;
  login_users: number;
  login_users_display?: string;
  message_users: number;
  message_users_display?: string;
  turn3_users: number;
  turn3_rate: number | null;
  turn3_display?: string;
  turn5_users: number;
  turn5_rate: number | null;
  turn5_display?: string;
  free_exhausted_users: number;
  free_exhausted_display?: string;
  pay_popup_users: number;
  pay_popup_display?: string;
  pay_click_users: number;
  pay_click_display?: string;
  recharge_users: number;
  recharge_display?: string;
  survey_fail: number;
  survey_fail_display?: string;
}

export interface StatsRevenueItem {
  date: string;
  total_revenue: number;
  all_pay_rate: number;
  all_paying_users: number;
  all_users: number;
  all_arppu: number;
  all_arpu: number;
  new_pay_rate: number;
  new_paying_users: number;
  new_users: number;
  new_arppu: number;
  new_arpu: number;
  old_pay_rate: number;
  old_paying_users: number;
  old_users: number;
  old_arppu: number;
  old_arpu: number;
}

export type StatsTableRow =
  | StatsDauItem
  | StatsRetentionItem
  | StatsEventItem
  | StatsFunnelItem
  | StatsRevenueItem;

export interface CompanionProfile {
  id: string;
  name: string;
  gender: string;
  age: number;
  city: string;
  personality: string;
  sexual_orientation?: string | null;
  background: string;
  speech_style: string;
  hobbies: string;
  values: string;
  fears: string;
  love_view: string;
  daily_routine: string;
  favorite_things: string;
  description?: string;
  appearance?: string;
  mbti?: string;
  life_story?: string;
  cultural_values?: string;
  gender_perspective?: string;
  country?: string;
  region_key?: string;
  region_label?: string;
  moderation_status?: string;
  /** 资料背景图 URL，0~3 张 */
  profile_backgrounds?: string[];
  language: string;  // 与地区(city)信息保持一致的语言
  tier?: string; // s / featured / candidate / ad
  is_deleted?: boolean;
  created_at: string;
}

export interface CompanionState {
  affection: number;
  turns: number;
}

export interface CompanionItem {
  profile: CompanionProfile;
  state: CompanionState;
  avatar?: string;
  avatar_generating?: boolean;
  is_deleted?: boolean;
  /** 列表排序用顶层字段 */
  age?: number;
  created_at?: string;
}

export interface MomentItem {
  id: number;
  companion_id: string;
  companion_name: string;
  companion_avatar: string;
  image_url: string | null;
  preview_url?: string | null;
  has_preview?: boolean;
  preview_pos?: { x: number; y: number } | null;
  image_generating?: boolean;
  caption: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
}

export interface ContentCompanion {
  id: string;
  avatar_url?: string;
  avatar?: string;
  avatar_generating?: boolean;
  name: string;
  gender: string;
  age: number;
  city: string;
  language: string;
  tier?: string;
  is_active?: boolean;
  is_deleted?: boolean;
  moderation_status?: string;
  total_credit_revenue?: number;
  month_credit_revenue?: number;
  created_at?: string;
  created_by?: string | number;
  ops_admin_id?: number | null;
  ops_admin?: ImOpsAdmin | null;
  personality?: string;
  sexual_orientation?: string | null;
  background?: string;
  speech_style?: string;
  hobbies?: string;
  values?: string;
  fears?: string;
  love_view?: string;
  daily_routine?: string;
  favorite_things?: string;
  appearance?: string;
  description?: string;
  mbti?: string;
  life_story?: string;
  cultural_values?: string;
  gender_perspective?: string;
  country?: string;
  region_key?: string;
  region_label?: string;
  profile_backgrounds?: string[];
  tags?: string[];
  i18n_profile?: Record<string, Record<string, string>>;
  profile?: CompanionProfile;
  state?: CompanionState;
  private_album_count?: number;
  private_album?: PrivateAlbumPhoto[];
}

export interface PrivateAlbumPhoto {
  id: number;
  photo_id?: number;
  companion_id?: string;
  image_url?: string;
  unlock_x?: number;
  sort_order?: number;
  is_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type MsgStrategySenderMode = 'broadcast' | 'companion' | string;

export interface ProductEvent {
  event_key: string;
  name_zh?: string;
  name_en?: string;
  name?: string;
  label?: string;
  /** broadcast=通用随机 1～3；companion=仅埋点上报的智能体 */
  sender_mode?: MsgStrategySenderMode;
}

export interface ContentStrategy {
  id: number | string;
  companion_id?: string;
  companion_name?: string;
  companion_avatar?: string | null;
  trigger_event: string;
  trigger_event_name?: string;
  strategy_type?: string;
  content: string;
  image_url?: string | null;
  language: string;
  source?: string;
  is_active: boolean;
  sort_order?: number;
  created_by?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** 单体埋点消息策略（全局列表，与 ContentStrategy 同表） */
export type CompanionStrategy = ContentStrategy;

export interface ContentMoment {
  id: number;
  companion_id: string;
  companion_name?: string;
  companion_avatar?: string;
  author_id?: string | number;
  image_url: string | null;
  preview_url?: string | null;
  has_preview?: boolean;
  preview_pos?: { x: number; y: number } | null;
  image_generating?: boolean;
  caption: string;
  caption_lang?: string;
  /** 定时发布语种（决定时区） */
  schedule_lang?: string | null;
  /** 运营填写的本地墙钟时间，格式 YYYY-MM-DD HH:MM:SS */
  schedule_at?: string | null;
  /** 换算后的 UTC 开放时间（ISO，Z 结尾） */
  publish_at?: string | null;
  /** 有效发布时间：coalesce(publish_at, created_at) */
  published_at?: string | null;
  /** IANA 时区名，如 Asia/Tokyo */
  timezone?: string | null;
  /** 当前是否已到点（用户端可见） */
  is_published?: boolean;
  /** 是否已创建但未到点 */
  is_scheduled?: boolean;
  language?: string | null;
  view_count?: number;
  view_users?: number;
  detail_click_count?: number;
  detail_click_users?: number;
  likes_count: number;
  likes_users?: number;
  comments_count: number;
  comments_users?: number;
  msg_click_count?: number;
  msg_click_users?: number;
  has_image?: boolean;
  ops_admin_id?: number | null;
  ops_admin?: ImOpsAdmin | null;
  created_at: string;
}

export interface ContentPost {
  id: number;
  user_id?: number | null;
  username?: string | null;
  user_name?: string | null;
  avatar?: string | null;
  title: string;
  content: string;
  images?: string[];
  category?: string | null;
  language?: string | null;
  likes_count?: number;
  comments_count?: number;
  review_status?: string;
  status?: string;
  reject_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
}

export interface ContentPostComment {
  id: number;
  post_id: number;
  user_id?: number | null;
  user_name?: string | null;
  avatar?: string | null;
  content: string;
  created_at?: string | null;
}

export type UserAccountStatus = 'normal' | 'banned' | 'cancelled';

export interface UserItem {
  id: number;
  username: string;
  nickname: string | null;
  gender: string | null;
  sexual_orientation: string | null;
  age?: number | null;
  region?: string | null;
  occupation?: string | null;
  tags?: string[];
  ua_tags?: string[];
  acquisition?: 'none' | 'ads' | 'attributed' | string;
  acquisition_label?: string | null;
  is_ads?: boolean;
  preferred_gender?: string | null;
  chat_purpose?: string | null;
  created_at: string;
  is_vip?: boolean | null;
  vip?: boolean | number | string | null;
  vip_expire_at?: string | null;
  vip_type?: string | null;
  credits?: number | null;
  free_messages_remaining?: number | null;
  status?: string | number | null;
  is_banned?: boolean | null;
  is_deleted?: boolean | null;
}

export interface AdminPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface UsersListResponse {
  code: number;
  message: string;
  pagination: AdminPagination;
  results: UserItem[];
}

export interface UserCompanionStatItem {
  companion_id: string;
  companion_name: string;
  avatar_url: string;
  affection: number;
  turns: number;
  updated_at: string | null;
}

export interface FeedbackItem {
  id: number;
  user_id: number;
  username?: string | null;
  nickname?: string | null;
  user_name: string | null;
  language?: string | null;
  status: string;
  unread_count?: number;
  last_message: string;
  last_message_sender: string;
  last_message_at?: string | null;
  last_user_msg_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackMessage {
  id: number;
  sender: 'user' | 'system' | 'admin' | string;
  content: string;
  translated_content?: string | null;
  created_at: string;
}

export interface FeedbackThreadDetail {
  thread: {
    id: number;
    user_id: number;
    username?: string | null;
    nickname?: string | null;
    user_name: string | null;
    language?: string | null;
    status: string;
    unread_count?: number;
  };
  unread_count?: number;
  messages: FeedbackMessage[];
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  language: string;
  content: string;
}

export interface SearchResult extends KnowledgeEntry {
  distance?: number;
}

export interface SystemConfig {
  anthropic_ready: boolean;
  openai_ready: boolean;
  deepseek_ready: boolean;
  model_provider: string;
  admin_password_set: boolean;
}

export interface AgentConfig {
  model_provider?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt_zh?: string;
  system_prompt_en?: string;
  system_prompt_ja?: string;
  system_prompt_ko?: string;
  system_prompt_pt?: string;
  system_prompt_es?: string;
  system_prompt_id?: string;
}

export interface EmbeddingStatus {
  state: string;
  message: string;
  progress: number;
}

export interface ConfigGroup {
  id: number;
  key: string;
  name: string;
  description: string;
  config_type: 'model_service' | 'agent' | 'image_generation' | 'system' | 'payment' | string;
  config_json: Record<string, unknown>;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface SystemNotificationItem {
  id: number;
  title: string;
  content: string;
  language: string;
  created_at: string;
  updated_at?: string;
}

export interface ImOpsAdmin {
  id: number;
  username?: string;
  nickname?: string | null;
  name?: string;
}

export interface ChatSessionItem {
  user_id: number;
  username: string;
  nickname: string;
  companion_id: string;
  companion_name: string;
  companion_avatar_url?: string | null;
  turns: number;
  affection: number;
  session_updated_at: string | null;
  message_count: number;
  last_message?: string | null;
  last_message_at: string | null;
  ops_admin_id?: number | null;
  ops_admin?: ImOpsAdmin | null;
  takeover_by?: number | null;
  takeover_admin?: ImOpsAdmin | null;
  takeover_at?: string | null;
  takeover_active_at?: string | null;
  is_taken_over?: boolean;
  can_takeover?: boolean;
  can_release?: boolean;
  idle_timeout_seconds?: number | null;
  idle_remaining_seconds?: number | null;
  ops_unread_count?: number;
}

export interface ChatSessionMessage {
  id: number | string;
  role: string;
  content: string;
  translated_content?: string | null;
  content_type?: string | null;
  image_url?: string | null;
  /** unpaid = 已发出但未扣费、未走 AI；空或缺失为正常消息 */
  send_status?: string | null;
  admin_id?: number | null;
  created_at: string | null;
}

export interface CompanionReportChatDetail {
  user_id: number;
  companion_id: string;
  messages_api?: string;
}

export type CompanionReportStatus = 'pending' | 'approved' | 'rejected';

export interface CompanionReportItem {
  id: number;
  reporter_user_id: number;
  reporter_nickname?: string | null;
  companion_id: string;
  companion_name?: string | null;
  reason_code: string;
  reason_label_zh?: string;
  reason_label_en?: string;
  remark?: string | null;
  content?: string | null;
  source?: string | null;
  status: CompanionReportStatus | string;
  chat_detail?: CompanionReportChatDetail | null;
  review_note?: string | null;
  created_at?: string | null;
}

export interface ChatSessionMessagesResponse {
  user_id: number;
  username?: string;
  nickname?: string;
  companion_id: string;
  companion_name?: string;
  ops_admin_id?: number | null;
  takeover_by?: number | null;
  is_taken_over?: boolean;
  total: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
  has_older?: boolean;
  has_newer?: boolean;
  translate?: boolean;
  target_lang?: string;
  offset: number;
  messages: ChatSessionMessage[];
}

export interface TranslateTextResponse {
  original: string;
  translated: string | null;
  target_lang: string;
  skipped: boolean;
}

export interface ImCompanionUnread {
  companion_id: string;
  unread_count: number;
  companion_name?: string;
}

export interface ImUnreadSummary {
  total_unread: number;
  session_count: number;
  by_companion: ImCompanionUnread[];
}

export type ImReplyModeValue = 'human_first' | 'ai';

export interface ImReplyModeOption {
  value: ImReplyModeValue | string;
  label_zh?: string;
  label_en?: string;
}

export interface ImReplyModeSettings {
  reply_mode: ImReplyModeValue | string;
  wait_seconds: number;
  updated_by?: string;
  updated_at?: string | null;
  modes?: ImReplyModeOption[];
  wait_seconds_min?: number;
  wait_seconds_max?: number;
  wait_seconds_default?: number;
}

export interface ImReadCompanionResult {
  ok: boolean;
  user_id: number;
  companion_id: string;
  ops_unread_count: number;
  cleared_unread?: number;
  ops_last_read_at?: string | null;
  summary?: ImUnreadSummary;
}

export interface ImReadAllResult extends ImUnreadSummary {
  ok: boolean;
  cleared_unread: number;
  cleared_sessions: number;
}

export type ImSessionsTimeMode = 'last_2_days' | 'all' | 'custom';

export interface ImCompanionProfile {
  id?: string;
  name?: string;
  nickname?: string;
  avatar_url?: string | null;
  gender?: string;
  language?: string;
  personality?: string;
  background?: string;
  city?: string;
  country?: string;
  age?: number;
  mbti?: string;
  sexual_orientation?: string | null;
  speech_style?: string;
}

export interface ImConsumeStats {
  user_id?: number;
  companion_id?: string;
  is_vip?: boolean;
  vip_type?: string | null;
  remaining_points?: number;
  credits?: number;
  free_messages_remaining?: number;
  session_turns?: number;
  credits_spent?: number;
  [key: string]: unknown;
}

export interface BenefitAppOption {
  value: string;
  label: string;
}

export interface BenefitProduct {
  id: number;
  product_type: string;      // subscribe / point
  platform: string;          // apple / google / all
  /** 应用马甲：trandsai / kaya，默认 trandsai */
  app_key?: string;
  title: string;
  /** 国家码 → 展示名；未绑定时为 {} */
  titles?: Record<string, string>;
  period: string;            // yearly/monthly/weekly/lifetime（订阅类）
  /** 商店区域价展示文案（只读），如 ¥12,800 */
  price_display?: string;
  /** 商店币种（只读），如 JPY */
  price_currency?: string;
  /** 数值兜底，管理端勿编辑 */
  price_usd?: number;
  discount_pct: number;
  credits_amount: number;    // 金币类
  daily_gift_credits: number;
  max_agents: number;
  daily_avg_price: number;
  store_product_id: string;
  apple_product_id: string;
  sort_order: number;
  is_active: boolean;
  /** 限时弹窗商品；用户端不混进钱包列表 */
  is_limited_offer?: boolean;
  /** 限时有效秒数，1–3600；关闭限时时为 0 */
  limited_duration_sec?: number;
  created_at: string;
  updated_at: string;
}

export interface BenefitTemplate {
  id: number;
  name: string;
  description: string;
  /** 应用马甲：trandsai / kaya，默认 trandsai */
  app_key?: string;
  user_id_rule: string;
  priority: number;
  is_active: boolean;
  start_at: string | null;
  end_at: string | null;
  product_ids: number[];
  regions: string[];
  created_at: string;
  updated_at: string;
}

export interface I18nLabel {
  zh?: string;
  en?: string;
}

export interface PendingOrderUser {
  id: number;
  username?: string;
  nickname?: string;
  email?: string;
  avatar_url?: string;
  account_status?: string;
}

export interface PendingOrderProduct {
  id: number;
  title?: string;
  product_type?: string;
  period?: string;
  price_usd?: number;
  credits_amount?: number;
  apple_product_id?: string;
  store_product_id?: string;
  is_active?: boolean;
}

export interface PendingOrder {
  id: number;
  transaction_id: string;
  original_transaction_id?: string;
  product_id: string;
  product_type: string;
  product_type_label?: I18nLabel;
  plan_type?: string;
  plan_type_label?: I18nLabel;
  package_key?: string;
  price_usd?: number;
  credits_amount?: number;
  duration_days?: number;
  store_type: string;
  store_type_label?: I18nLabel;
  status: string;
  status_label?: I18nLabel;
  user_id?: number | null;
  user?: PendingOrderUser | null;
  product?: PendingOrderProduct | null;
  product_name?: string;
  callback_data?: unknown;
  created_at: string;
  updated_at?: string;
}

export interface PendingOrderSummary {
  total: number;
  by_status: Record<string, number>;
  by_store_type: Record<string, number>;
  by_product_type: Record<string, number>;
  price_usd_sum: number;
  credits_amount_sum: number;
  completed_price_usd_sum: number;
}

export interface AdminAccount {
  id: number;
  username: string;
  nickname?: string | null;
  email?: string | null;
  role_key?: string | null;
  role_name?: string | null;
  is_active?: boolean | null;
  companion_ids?: Array<string | number> | string | null;
  remark?: string | null;
  created_at?: string;
}

export interface AdminRole {
  role_key: string;
  role_name: string;
  description?: string | null;
  is_active?: boolean;
  created_at?: string;
  menu_keys?: string[] | null;
  menus?: Array<string | { menu_key: string }> | null;
}

export interface AdminMenu {
  id?: number;
  menu_key: string;
  menu_name: string;
  path: string;
  parent_key?: string | null;
  sort_order?: number;
  is_active?: boolean;
  children?: AdminMenu[];
}

export interface VisibleMenuItem {
  id?: number;
  menu_key: string;
  menu_name: string;
  path: string;
  parent_key?: string | null;
  sort_order?: number;
  children?: VisibleMenuItem[];
}

export interface PaginatedResponse<T> {
  code: number;
  message: string;
  results: T[];
  pagination?: AdminPagination;
}

export interface MsgStrategyTrigger {
  trigger_key: string;
  name_zh?: string;
  name_en?: string;
  event_keys?: string[];
  sender_mode?: MsgStrategySenderMode;
  seq?: number;
}

export interface MsgStrategyLibraryType {
  type_key: string;
  name_zh?: string;
  name_en?: string;
  trigger_key?: string;
  seq?: number;
  /** broadcast=通用；companion=指定智能体（由埋点带 id，库里仍不用选手动绑定） */
  sender_mode?: MsgStrategySenderMode;
}

export interface MsgStrategyMeta {
  triggers: MsgStrategyTrigger[];
  library_types: MsgStrategyLibraryType[];
  companion_bound_events?: string[];
  user_scope_types: { value: string; label: string }[];
  languages: { value: string; label: string }[];
}

export type MsgStrategyScopeType = 'all' | 'ads' | 'attr' | string;

export interface MsgStrategyScopeOption {
  value: string;
  label: string;
  kind?: string;
  count?: number;
  group?: string;
  source?: string;
}

export interface MsgStrategyScopeOptions {
  ads: MsgStrategyScopeOption[];
  attr: MsgStrategyScopeOption[];
  hint?: {
    ads?: string;
    attr?: string;
  };
}

export interface MsgStrategyGlobal {
  id: number;
  name: string;
  user_scope_type?: MsgStrategyScopeType;
  user_scope_value?: string | string[] | null;
  fatigue_window_hours?: number;
  fatigue_max_unreplied?: number;
  daily_limit?: number;
  interval_min_sec?: number;
  interval_max_sec?: number;
  priority?: number;
  is_active?: boolean;
}

export interface MsgStrategyRule {
  id: number;
  name: string;
  user_scope_type?: MsgStrategyScopeType;
  user_scope_value?: string | string[] | null;
  triggers?: Record<string, number>;
  priority?: number;
  is_active?: boolean;
}

export interface MsgStrategyLibraryCompanion {
  id: string;
  name?: string;
}

export interface MsgStrategyLibraryItem {
  id: number;
  content: string;
  language?: string;
  type_key?: string;
  /** global = 全局库；precise = 精准库（带 companion_ids） */
  scope?: 'global' | 'precise' | string;
  companion_ids?: string[];
  companions?: MsgStrategyLibraryCompanion[];
  is_active?: boolean;
  sort_order?: number;
}

export interface QuickReplyCompanion {
  id: string;
  name?: string;
}

export interface QuickReplyLibraryItem {
  id: number;
  content: string;
  language: string;
  /** 用户触发词；空数组 = 兜底 */
  keywords?: string[];
  /** 与 keywords 同值（列表/详情可能同时返回） */
  trigger_keywords?: string[];
  companion_ids?: string[];
  companions?: QuickReplyCompanion[];
  sort_order?: number;
  is_active?: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface QuickReplyConfigItem {
  id: number;
  companion_id: string;
  companion_name?: string;
  name?: string;
  is_active?: boolean;
  priority?: number;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SayHiCopyItem {
  id: number;
  content: string;
  language: string;
  sort_order?: number;
  is_active?: boolean;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChatVersionPromptItem {
  id: number;
  version: string;
  prompt: string;
  is_enabled?: boolean;
  remark?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  apply_registered_start_at?: string | null;
  apply_registered_end_at?: string | null;
  applied_count?: number;
  removed_count?: number;
}

export interface ChatVersionPromptUser {
  id: number;
  username?: string;
  nickname?: string;
  email?: string;
  app_version?: string | null;
  created_at?: string | null;
  account_status?: string;
  platform?: string;
  language?: string;
  app_key?: string;
  prompt_id?: number;
  version?: string;
  scope?: 'applied' | 'removed' | string;
  in_scope?: boolean;
  removed_at?: string | null;
  removed_by?: string | number | null;
}

export type StrategyCenterTab = 'independent' | 'msg-library' | 'quick-reply';

export interface StrategyCenterConfigType {
  type_key: string;
  type_name?: string;
  count?: number;
}

export interface StrategyCenterRow {
  application_key?: string;
  id: number;
  companion_id: string;
  companion_name?: string;
  companion_avatar?: string | null;
  content: string;
  image_url?: string | null;
  language: string;
  type_key?: string;
  type_name?: string;
  trigger_event?: string;
  trigger_event_name?: string;
  config_count?: number;
  config_types?: StrategyCenterConfigType[];
  sort_order?: number;
  is_active?: boolean;
  updated_at?: string | null;
  trigger_keyword?: string;
  keywords?: string[];
  is_fallback?: boolean;
  ops_admin_id?: number | null;
  ops_admin?: { id?: number; name?: string; nickname?: string; username?: string } | null;
}
