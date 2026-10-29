/**
 * @file rechargeDisclaimerAndroid.js
 * @description Android 充值声明（含商店名）。仅 Android 打包引入，避免进入 iOS 二进制。
 */
const COPY = {
  en: "Subscription fees will be charged at the start of each renewal period via Google Play. You can cancel anytime in your store account settings. Daily free points are used first, then top-up balance is deducted. Unlimited conversations are not provided.",
  zh: "订阅费用将在每个续费周期开始时通过 Google Play 账户扣款。您可以随时在商店账户设置中取消。每日免费积分优先使用，然后扣除充值余额。不提供无限对话。",
  ja: "サブスクリプション料金は各更新期間の開始時にGoogle Playアカウントから請求されます。ストアアカウント設定でいつでもキャンセルできます。毎日の無料ポイントが優先的に使用され、その後チャージ残高から差し引かれます。無制限の会話は提供されません。",
  ko: "구독 요금은 각 갱신 기간 시작 시 Google Play 계정으로 청구됩니다. 스토어 계정 설정에서 언제든지 취소할 수 있습니다. 매일 무료 포인트가 우선 사용된 후 충전 잔액에서 차감됩니다. 무제한 대화는 제공되지 않습니다.",
  es: "Los cargos de suscripción se aplicarán al inicio de cada período de renovación a través de Google Play. Puedes cancelar en cualquier momento en la configuración de tu cuenta de la tienda. Los puntos gratuitos diarios se usan primero, luego se descuenta del saldo recargado. No se ofrecen conversaciones ilimitadas.",
  pt: "As taxas de assinatura serão cobradas no início de cada período de renovação via Google Play. Você pode cancelar a qualquer momento nas configurações da conta da loja. Pontos gratuitos diários são usados primeiro, depois o saldo recarregado é descontado. Conversas ilimitadas não são oferecidas.",
  id: "Biaya langganan akan ditagih pada awal setiap periode perpanjangan melalui Google Play. Anda dapat membatalkan kapan saja di pengaturan akun toko. Poin gratis harian digunakan terlebih dahulu, kemudian saldo isi ulang dikurangi. Percakapan tak terbatas tidak disediakan.",
  ar: "تُحصَّل رسوم الاشتراك في بداية كل فترة تجديد عبر Google Play. يمكنك الإلغاء في أي وقت من إعدادات حساب المتجر. تُستخدم النقاط المجانية اليومية أولاً، ثم يُخصم رصيد الشحن. لا تُقدَّم محادثات غير محدودة.",
  fa: "هزینه اشتراک در شروع هر دوره تمدید از طریق Google Play کسر می‌شود. هر زمان می‌توانید در تنظیمات حساب فروشگاه لغو کنید. امتیاز روزانه رایگان ابتدا مصرف می‌شود، سپس موجودی شارژشده کسر می‌گردد. گفتگوی نامحدود ارائه نمی‌شود.",
  ru: "Плата за подписку списывается в начале каждого периода продления через Google Play. Отменить можно в любое время в настройках аккаунта магазина. Сначала расходуются ежедневные бесплатные баллы, затем пополненный баланс. Безлимитные разговоры не предоставляются.",
  bg: "Таксите за абонамент се начисляват в началото на всеки период на подновяване чрез Google Play. Можеш да отмениш по всяко време в настройките на акаунта в магазина. Първо се използват дневните безплатни точки, след това зареденият баланс. Неограничени разговори не се предоставят.",
  tr: "Abonelik ücretleri her yenileme döneminin başında Google Play üzerinden tahsil edilir. Mağaza hesap ayarlarından istediğin zaman iptal edebilirsin. Önce günlük ücretsiz puanlar kullanılır, ardından yükleme bakiyesi düşülür. Sınırsız sohbet sağlanmaz.",
};

export function getAndroidRechargeDisclaimer(lang) {
  const raw =
    lang && typeof lang === "object" && lang.value != null ? lang.value : lang;
  const base = String(raw || "en").split("-")[0].toLowerCase();
  return COPY[base] || COPY.en;
}
