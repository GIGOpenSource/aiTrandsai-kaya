/**
 * 创建伴侣：与 Vue 无关的表单工具（解析聊天记录、本地兜底人设、提交 payload）。
 */
import { inferCompanionLanguage } from "@/utils/companionLang";
import { translatePersonalityTag } from "@/utils/personalityTags";
import { normalizeSexualOrientation } from "@/utils/formatCompanion";

export const AGE_MIN = 18;
export const AGE_MAX = 65;

export function clampAge(n, fallback = 22) {
  const v = Number(n);
  return Math.min(AGE_MAX, Math.max(AGE_MIN, Number.isFinite(v) ? v : fallback));
}

export function clipText(raw, max) {
  const text = String(raw || "").trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

export function firstFilled(...candidates) {
  for (const c of candidates) {
    const text = String(c || "").trim();
    if (!text || text.startsWith("（待完善）")) continue;
    return text;
  }
  return "";
}

export function parseChatHistory(raw) {
  const src = String(raw || "");
  if (!src.trim()) return [];
  if (src.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(src.trim());
      if (Array.isArray(parsed)) {
        return parsed
          .filter((m) => m.role && m.content)
          .map((m) => ({ role: m.role, content: String(m.content) }));
      }
    } catch {
      /* continue text parsing */
    }
  }
  const lines = src.split("\n").filter((l) => l.trim());
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(用户|我|user|المستخدم|أنا|کاربر|من|Пользователь|Я|Потребител|Аз|Kullanıcı|Ben)[\s:：]/i.test(trimmed)) {
      result.push({
        role: "user",
        content: trimmed.replace(/^(用户|我|user|المستخدم|أنا|کاربر|من|Пользователь|Я|Потребител|Аз|Kullanıcı|Ben)[\s:：]/i, "").trim(),
      });
    } else if (/^(AI|智能体|assistant|对方|ta|TA|المساعد|دستیار|Ассистент|Асистент|Asistan)[\s:：]/i.test(trimmed)) {
      result.push({
        role: "assistant",
        content: trimmed.replace(/^(AI|智能体|assistant|对方|ta|TA|المساعد|دستیار|Ассистент|Асистент|Asistan)[\s:：]/i, "").trim(),
      });
    } else if (result.length > 0) {
      result[result.length - 1].content += "\n" + trimmed;
    }
  }
  return result;
}

export function classifyCreateError(err) {
  if (Number(err?.status) === 402) return "credits";
  const msg = String(err?.message || err?.detail || "");
  if (/积分不足|credits_insufficient|充值|insufficient credit/i.test(msg)) {
    return "credits";
  }
  if (/上限|agent_limit|升级VIP|limit reached/i.test(msg)) return "limit";
  if (
    Number(err?.status) === 403 ||
    /VIP|会员|vip_required|开通/i.test(msg)
  ) {
    return "vip";
  }
  return "other";
}

/** App 端 vue-i18n 常不替换 {name}，用 split 写入，避免 .vue 里 /\{name\}/ 被编译器吃掉 */
export function fillI18n(template, vars = {}) {
  let s = String(template ?? "");
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue;
    s = s.split("{" + k + "}").join(String(v));
  }
  return s;
}

export function pickAgentLimitMax(...sources) {
  for (const src of sources) {
    if (src == null || src === "") continue;
    if (typeof src !== "object") return src;
    const nested = src.detail && typeof src.detail === "object" ? src.detail : null;
    const body = src.body && typeof src.body === "object" ? src.body : null;
    const v =
      src.max_agents ??
      src.max ??
      nested?.max_agents ??
      nested?.max ??
      body?.max_agents ??
      body?.results?.max_agents;
    if (v != null && v !== "") return v;
  }
  return "";
}

export function buildLocalFallbackPersona({
  name: n,
  age: a,
  city: c,
  genderLabel,
  personalityLabel,
  lang,
}) {
  const langBase = String(lang || "zh").split("-")[0];
  const zh = langBase === "zh";
  if (zh) {
    const background = `${n}今年${a}岁，生活在${c}。性格偏「${personalityLabel}」，处事节奏与这座城市的日常绑在一起，身边人会觉得既好辨认又不完全按模板走。`;
    const speech_style = `说话时能听出「${personalityLabel}」的底色，语气贴合${c}的社交分寸，不端着也不假装万能。`;
    return {
      background,
      speech_style,
      hobbies: `在${c}找自己的小事消遣，兴趣跟着当下状态变，而不是一份固定清单。`,
      values: `更看重边界感与结果，胜过热闹口号；对可信的人会认真，对表演型关系则退避。`,
      fears: `怕被误解成「只会某种人设」，也怕失控把重要的人推开。`,
      love_view: `亲密关系要互相看见，不要牺牲式绑定；合得来就靠近，合不来就坦诚分开。`,
      daily_routine: `${c}的一天里，工作或学习占主轴，晚上留给回血与零碎兴趣，周末不一定按计划执行。`,
      favorite_things: `城市夜里的某段路、合口味的一顿饭、能放空的小物件。`,
      appearance: `${n}，${a}岁左右，${genderLabel}性；气质贴近「${personalityLabel}」，外形与穿搭符合${c}日常，五官与神态有辨识度。`,
      description: clipText(`${n}｜${c}｜${personalityLabel}`, 120),
      life_story: `${n}与${c}一带的生活绑定很深。少年时家庭与学校已留下「${personalityLabel}」的底色；成年后围绕职业与亲密关系做过几次关键选择，也经历过需要慢慢消化的挫败。如今节奏嵌在${c}的主流日常里。成长并未抹平所有棱角，却让TA更清楚什么值得守、什么可以放手。`,
      cultural_values: `${n}的价值排序贴近当地主流又带着个人修正：对权威不盲从，也尊重人情与规则；个人自由与体面要一起谈。${c}的通勤、饮食与社交场合强化了这些立场。亲密关系里要求边界清晰、责任可分担。`,
      gender_perspective: `作为${genderLabel}性，${n}不把性别当枷锁或特权。相处看重尊重、情绪责任与双方自愿；角色可传统可现代，前提是平等。`,
    };
  }

  if (langBase === "ar") {
    const genderWord = genderLabel === "男" ? "رجل" : "امرأة";
    return {
      background: `${n} في الـ${a} من العمر ويعيش في ${c}. شخصيته أقرب إلى «${personalityLabel}»، وإيقاعه مربوط بحياة هذه المدينة دون أن يكون نسخة جاهزة.`,
      speech_style: `في كلامه لمسة «${personalityLabel}»، بنبرة تناسب مجاملة ${c} — واضح دون تصنّع.`,
      hobbies: `طقوس صغيرة في ${c} تتغير مع المزاج، وليست قائمة هوايات ثابتة.`,
      values: `الحدود والالتزام أهم من الشعارات العالية؛ والوفاء حيث يكون متبادلاً.`,
      fears: `أن يُحبس في صورة نمطية عن نفسه، أو أن يفقد السيطرة ويؤذي شخصاً قريباً.`,
      love_view: `القرب يجب أن يكون متبادلاً وناضجاً — بلا تضحية قسرية.`,
      daily_routine: `العمل أو الدراسة محور اليوم في ${c}؛ المساء للراحة؛ وعطلة نهاية الأسبوع نصف مخططة فقط.`,
      favorite_things: `تمشية ليلية، وجبة يعتمد عليها، وأشياء تُهدّئ الذهن.`,
      appearance: `${n}، حوالي ${a} عاماً، ${genderWord}؛ حضوره يطابق «${personalityLabel}»، وأسلوبه اليومي يناسب ${c}.`,
      description: clipText(`${n} · ${c} · ${personalityLabel}`, 120),
      life_story: `قصة ${n} متجذرة في ${c} وما حولها. شكّلت الأسرة والمدرسة نواة «${personalityLabel}»؛ وجاءت مرحلة البلوغ بمحطات مهنية وعاطفية ما زال يهضمها. إيقاعه اليومي جزء من حياة ${c}.`,
      cultural_values: `يمزج ${n} الأعراف المحلية مع تعديلات شخصية: حذر من السلطة الجوفاء، ومراعٍ للأدب. الحياة في ${c} تعزّز الكفاءة والرعاية فوق الشعارات.`,
      gender_perspective: `كـ${genderWord}، يرفض ${n} أن يكون الجندر قفصاً أو عذراً. الاحترام والمسؤولية العاطفية والرضا تأتي أولاً.`,
    };
  }

  if (langBase === "fa") {
    const genderWord = genderLabel === "男" ? "مرد" : "زن";
    return {
      background: `${n} ${a} ساله است و در ${c} زندگی می‌کند. حال‌وهوایش به «${personalityLabel}» نزدیک است و ریتمش با زندگی این شهر گره خورده، نه یک زندگی‌نامه قالبی.`,
      speech_style: `در حرف زدنش رگه‌ای از «${personalityLabel}» هست؛ لحنی که با آداب ${c} جور درمی‌آید — روشن، بدون تصنع.`,
      hobbies: `آیین‌های کوچک در ${c} که با حال عوض می‌شوند، نه فهرست ثابتی از سرگرمی‌ها.`,
      values: `مرز و پایبندی مهم‌تر از شعارهای بلند است؛ وفاداری فقط جایی که دوسویه باشد.`,
      fears: `اینکه در کاریکاتوری از خودش گیر کند، یا کنترل را از دست بدهد و به کسی نزدیک آسیب بزند.`,
      love_view: `نزدیکی باید دوسویه و بالغ باشد — بدون فداکاری اجباری.`,
      daily_routine: `کار یا درس محور روز در ${c} است؛ شب برای بازیابی؛ آخر هفته فقط نیمه‌برنامه‌ریزی‌شده.`,
      favorite_things: `پیاده‌روی شبانه، یک وعده قابل‌اعتماد، و چیزهایی که ذهن را آرام می‌کنند.`,
      appearance: `${n}، حدود ${a} سال، ${genderWord}؛ حضورش با «${personalityLabel}» می‌خواند و استایل روزمره‌اش با ${c} جور است.`,
      description: clipText(`${n} · ${c} · ${personalityLabel}`, 120),
      life_story: `داستان ${n} در ${c} و اطرافش ریشه دارد. خانواده و مدرسه هسته «${personalityLabel}» را شکل دادند؛ بزرگسالی نقاط عطف شغلی و عاطفی آورد که هنوز هضم می‌شود. ریتم روزانه‌اش بخشی از زندگی ${c} است.`,
      cultural_values: `${n} هنجارهای محلی را با اصلاحات شخصی مخلوط می‌کند: محتاط نسبت به اقتدار توخالی، مراقب ادب. زندگی در ${c} شایستگی و مراقبت را بر شعار ترجیح می‌دهد.`,
      gender_perspective: `به‌عنوان ${genderWord}، ${n} جنسیت را قفس یا بهانه نمی‌داند. احترام، مسئولیت عاطفی و رضایت در اولویت است.`,
    };
  }

  if (langBase === "ru") {
    const genderWord = genderLabel === "男" ? "мужчина" : "женщина";
    return {
      background: `${n} — ${a} лет, живёт в городе ${c}. Характер ближе к «${personalityLabel}», ритм связан с жизнью этого города, а не с шаблонной биографией.`,
      speech_style: `В речи слышна «${personalityLabel}» — тон в духе ${c}: ясно, без позы.`,
      hobbies: `Маленькие ритуалы в ${c}, которые меняются с настроением, а не фиксированный список хобби.`,
      values: `Границы и ответственность важнее громких лозунгов; верность — только взаимная.`,
      fears: `Оказаться карикатурой на себя или потерять контроль и ранить близкого.`,
      love_view: `Близость должна быть взаимной и взрослой — без жертвенной привязки.`,
      daily_routine: `Работа или учёба — ось дня в ${c}; вечер для восстановления; выходные лишь наполовину распланированы.`,
      favorite_things: `Ночная прогулка, надёжная еда и вещи, которые успокаивают ум.`,
      appearance: `${n}, около ${a}, ${genderWord}; присутствие совпадает с «${personalityLabel}», повседневный стиль подходит ${c}.`,
      description: clipText(`${n} · ${c} · ${personalityLabel}`, 120),
      life_story: `История ${n} уходит корнями в ${c} и окрестности. Семья и школа сформировали ядро «${personalityLabel}»; взрослая жизнь принесла карьерные и любовные повороты, которые ещё осмысляются. Дневной ритм вплетён в жизнь ${c}.`,
      cultural_values: `${n} смешивает местные нормы с личными поправками: осторожен к пустой власти, внимателен к манерам. Жизнь в ${c} ценит компетентность и заботу выше лозунгов.`,
      gender_perspective: `Как ${genderWord}, ${n} отвергает гендер как клетку или оправдание. Сначала уважение, эмоциональная ответственность и согласие.`,
    };
  }

  if (langBase === "bg") {
    const genderWord = genderLabel === "男" ? "мъж" : "жена";
    return {
      background: `${n} е на ${a} и живее в ${c}. Характерът клони към «${personalityLabel}», а ритъмът е вързан с живота на този град, не с шаблонна биография.`,
      speech_style: `В говора има оттенък на «${personalityLabel}», с тон, който пасва на ${c} — ясен, без поза.`,
      hobbies: `Малки ритуали в ${c}, които се менят с настроението, а не фиксиран списък с хобита.`,
      values: `Границите и последователността са по-важни от гръмки лозунги; вярност само където е взаимна.`,
      fears: `Да бъде заключен в карикатура на себе си или да загуби контрол и да нарани близък.`,
      love_view: `Близостта трябва да е взаимна и зряла — без принудителна жертва.`,
      daily_routine: `Работата или ученето е ос на деня в ${c}; вечерта е за възстановяване; уикендът е само наполовина планиран.`,
      favorite_things: `Нощна разходка, надеждно ястие и неща, които успокояват ума.`,
      appearance: `${n}, около ${a} години, ${genderWord}; присъствието съвпада с «${personalityLabel}», ежедневният стил пасва на ${c}.`,
      description: clipText(`${n} · ${c} · ${personalityLabel}`, 120),
      life_story: `Историята на ${n} е вкоренена в ${c} и околностите. Семейството и училището оформиха ядрото «${personalityLabel}»; зрялата възраст донесе професионални и емоционални обрати, които още се осмислят. Дневният ритъм е част от живота на ${c}.`,
      cultural_values: `${n} смесва местните норми с лични поправки: предпазлив към празна власт, внимателен към маниерите. Животът в ${c} поставя компетентността и грижата над лозунгите.`,
      gender_perspective: `Като ${genderWord}, ${n} отхвърля пола като клетка или извинение. Уважението, емоционалната отговорност и съгласието са първи.`,
    };
  }

  if (langBase === "tr") {
    const genderWord = genderLabel === "男" ? "erkek" : "kadın";
    return {
      background: `${n} ${a} yaşında ve ${c}’te yaşıyor. Havası «${personalityLabel}»e yakın; ritmi bu şehrin hayatına bağlı, hazır bir biyografi değil.`,
      speech_style: `Konuşmasında «${personalityLabel}» dokunuşu var; ${c}’nin üslubuna uyan, poz yapmadan net bir ton.`,
      hobbies: `${c}’teki küçük ritüeller ruh haline göre değişir; sabit bir hobi listesi değil.`,
      values: `Sınırlar ve sözünde durmak yüksek sloganlardan önemli; sadakat yalnızca karşılıklıysa.`,
      fears: `Kendisinin karikatürüne hapsolmak ya da kontrolü kaybedip yakını incitmek.`,
      love_view: `Yakınlık karşılıklı ve yetişkin olmalı — zorunlu fedakârlık yok.`,
      daily_routine: `${c}’te günün omurgası iş veya ders; akşam toparlanma; hafta sonu ancak yarı planlı.`,
      favorite_things: `Gece yürüyüşü, güvenilir bir yemek ve zihni sakinleştiren nesneler.`,
      appearance: `${n}, yaklaşık ${a}, ${genderWord}; duruşu «${personalityLabel}» ile uyumlu, günlük stili ${c}’ye yakışır.`,
      description: clipText(`${n} · ${c} · ${personalityLabel}`, 120),
      life_story: `${n}’in hikâyesi ${c} ve çevresinde kök salmış. Aile ve okul «${personalityLabel}» çekirdeğini şekillendirdi; yetişkinlik hâlâ sindirilen kariyer ve ilişki dönemeçleri getirdi. Günlük ritim ${c} hayatının parçası.`,
      cultural_values: `${n} yerel normları kişisel düzeltmelerle karıştırır: boş otoriteye temkinli, görgüye dikkatli. ${c}’teki hayat yeterliliği ve özeni sloganların üstünde tutar.`,
      gender_perspective: `Bir ${genderWord} olarak ${n}, cinsiyeti kafes veya bahane olarak reddeder. Saygı, duygusal sorumluluk ve rıza önce gelir.`,
    };
  }

  const background = `${n} is ${a} and based in ${c}. Their vibe skews “${personalityLabel}”, shaped by the city’s pace rather than a stock biography.`;
  const speech_style = `Speech carries a “${personalityLabel}” edge with local ${c} manners—direct enough to be clear, warm enough to stay human.`;
  return {
    background,
    speech_style,
    hobbies: `Small rituals in ${c} that change with mood—not a fixed hobby checklist.`,
    values: `Boundaries and follow-through over loud slogans; loyalty only where it’s mutual.`,
    fears: `Being trapped in a caricature of themselves, or losing control and hurting someone close.`,
    love_view: `Closeness should feel mutual and adult—no martyrdom bonds.`,
    daily_routine: `Work or study anchors the day in ${c}; evenings recover; weekends stay only half-planned.`,
    favorite_things: `A night walk, a reliable meal, and objects that quiet the mind.`,
    appearance: `${n}, around ${a}, reads as ${genderLabel === "男" ? "male" : "female"}; presence matches “${personalityLabel}”, with everyday style that fits ${c}.`,
    description: clipText(`${n} · ${c} · ${personalityLabel}`, 120),
    life_story: `${n}’s story is rooted in and around ${c}. Family and school years shaped a “${personalityLabel}” core; adulthood brought career and relationship turning points still being metabolized. Daily life now sits inside ${c}’s mainstream rhythm.`,
    cultural_values: `${n} blends local mainstream norms with personal corrections: wary of hollow authority, mindful of manners. Life in ${c} reinforces competence and care over slogans.`,
    gender_perspective: `As a ${genderLabel === "男" ? "man" : "woman"}, ${n} rejects gender as a cage or an excuse. Respect, emotional responsibility, and consent come first.`,
  };
}

export function buildCreatePayload(form) {
  const companionLang =
    form.companionLang || inferCompanionLanguage(form.city || "");
  const payload = {
    name: String(form.name || "").trim(),
    age: form.age,
    gender: form.gender === "male" ? "male" : "female",
    city: String(form.city || "").trim(),
    personality: (form.selectedPersonalities || [])
      .map((p) =>
        translatePersonalityTag(p, companionLang || form.currentLang)
      )
      .join("、"),
    mbti: form.mbti,
    sexual_orientation: normalizeSexualOrientation(form.sexualOrientation),
    appearance: String(form.appearance || "").trim(),
    description: String(form.description || "").trim(),
    background: String(form.background || "").trim(),
    speech_style: String(form.speakingStyle || "").trim(),
    personality_details: form.personalityDetailsText || "",
    hobbies: form.hobbies || "",
    values: form.values || "",
    fears: form.fears || "",
    love_view: form.loveView || "",
    daily_routine: form.dailyRoutine || "",
    favorite_things: form.favoriteThings || "",
    life_story: form.lifeStory || "",
    cultural_values: form.culturalValues || "",
    gender_perspective: form.genderPerspective || "",
    language: companionLang,
    country: String(form.country || "").trim(),
    region_key: String(form.regionKey || "").trim(),
    region_label: String(form.regionLabel || "").trim(),
  };

  const axesObj = form.personaAxes;
  if (axesObj && typeof axesObj === "object" && Object.keys(axesObj).length) {
    payload.persona_axes = axesObj;
  }

  if (!form.isEditMode) {
    payload.avatar_url = "__GENERATING__";
  }

  const parsedHistory = parseChatHistory(form.chatHistoryRaw);
  if (parsedHistory.length > 0) {
    payload.chat_history = parsedHistory;
  }
  return payload;
}
