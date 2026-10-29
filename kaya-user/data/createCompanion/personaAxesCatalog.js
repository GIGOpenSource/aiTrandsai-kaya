/** @file personaAxesCatalog.js — 人设维度选项（对齐 server persona_axes） */
export const AXIS_ORDER = ["career_class","attachment","conflict_style","life_pace","interest_domain"];

export const AXIS_OPTIONS = {
  "career_class": [
    {
      "key": "student",
      "labels": {
        "zh": "学生/尚在求学",
        "en": "student",
        "ja": "学生",
        "ko": "학생",
        "pt": "estudante",
        "es": "estudiante",
        "id": "pelajar",
        "ar": "طالب",
        "fa": "دانشجو",
        "ru": "студент",
        "bg": "студент",
        "tr": "öğrenci"
      }
    },
    {
      "key": "entry_white_collar",
      "labels": {
        "zh": "职场新人/基层白领",
        "en": "entry-level white collar",
        "ja": "若手会社員",
        "ko": "사회초년생",
        "pt": "iniciante corporativo",
        "es": "oficinista junior",
        "id": "karyawan pemula",
        "ar": "موظف مبتدئ",
        "fa": "کارمند تازه‌کار",
        "ru": "младший офисный сотрудник",
        "bg": "младши офис служител",
        "tr": "yeni ofis çalışanı"
      }
    },
    {
      "key": "skilled_trade",
      "labels": {
        "zh": "技术工种/手艺人",
        "en": "skilled trade",
        "ja": "職人・現場職",
        "ko": "기술직",
        "pt": "ofício técnico",
        "es": "oficio técnico",
        "id": "pekerja terampil",
        "ar": "حرفة ماهرة",
        "fa": "حرفه ماهر",
        "ru": "рабочая специальность",
        "bg": "квалифициран занаят",
        "tr": "ustalık mesleği"
      }
    },
    {
      "key": "creative",
      "labels": {
        "zh": "创意/内容/设计",
        "en": "creative / content",
        "ja": "クリエイティブ",
        "ko": "크리에이티브",
        "pt": "criativo",
        "es": "creativo",
        "id": "kreatif",
        "ar": "إبداعي",
        "fa": "خلاق / محتوا",
        "ru": "креатив / контент",
        "bg": "креатив / съдържание",
        "tr": "yaratıcı / içerik"
      }
    },
    {
      "key": "tech",
      "labels": {
        "zh": "科技/工程",
        "en": "tech / engineering",
        "ja": "テック・工学",
        "ko": "테크/엔지니어",
        "pt": "tech/engenharia",
        "es": "tech/ingeniería",
        "id": "teknologi",
        "ar": "تقنية",
        "fa": "فناوری / مهندسی",
        "ru": "технологии / инженерия",
        "bg": "технологии / инженеринг",
        "tr": "teknoloji / mühendislik"
      }
    },
    {
      "key": "service_hospitality",
      "labels": {
        "zh": "服务/餐饮/零售",
        "en": "service / hospitality",
        "ja": "接客・サービス",
        "ko": "서비스업",
        "pt": "serviços",
        "es": "servicios",
        "id": "jasa/hospitality",
        "ar": "خدمات وضيافة",
        "fa": "خدمات / مهمان‌نوازی",
        "ru": "сервис / гостеприимство",
        "bg": "услуги / хотелиерство",
        "tr": "hizmet / konaklama"
      }
    },
    {
      "key": "public_sector",
      "labels": {
        "zh": "体制内/公共部门",
        "en": "public sector",
        "ja": "公務員・公共",
        "ko": "공공/공직",
        "pt": "setor público",
        "es": "sector público",
        "id": "sektor publik",
        "ar": "قطاع عام",
        "fa": "بخش عمومی",
        "ru": "госсектор",
        "bg": "публичен сектор",
        "tr": "kamu sektörü"
      }
    },
    {
      "key": "entrepreneur",
      "labels": {
        "zh": "创业/自由职业",
        "en": "entrepreneur / freelance",
        "ja": "起業・フリー",
        "ko": "창업/프리랜서",
        "pt": "empreendedor",
        "es": "emprendedor",
        "id": "wirausaha",
        "ar": "رائد أعمال",
        "fa": "کارآفرین / فریلنسر",
        "ru": "предприниматель / фриланс",
        "bg": "предприемач / фрийланс",
        "tr": "girişimci / serbest"
      }
    },
    {
      "key": "finance_pro",
      "labels": {
        "zh": "金融/商务专业岗",
        "en": "finance / business pro",
        "ja": "金融・ビジネス",
        "ko": "금융/비즈니스",
        "pt": "finanças",
        "es": "finanzas",
        "id": "keuangan",
        "ar": "مالية",
        "fa": "مالی / کسب‌وکار",
        "ru": "финансы / бизнес",
        "bg": "финанси / бизнес",
        "tr": "finans / iş"
      }
    }
  ],
  "attachment": [
    {
      "key": "secure",
      "labels": {
        "zh": "安全型依恋",
        "en": "secure attachment",
        "ja": "安定型愛着",
        "ko": "안정 애착",
        "pt": "apego seguro",
        "es": "apego seguro",
        "id": "kelekatan aman",
        "ar": "تعلق آمن",
        "fa": "دلبستگی ایمن",
        "ru": "надёжная привязанность",
        "bg": "сигурна привързаност",
        "tr": "güvenli bağlanma"
      }
    },
    {
      "key": "anxious",
      "labels": {
        "zh": "焦虑型依恋",
        "en": "anxious attachment",
        "ja": "不安型愛着",
        "ko": "불안 애착",
        "pt": "apego ansioso",
        "es": "apego ansioso",
        "id": "kelekatan cemas",
        "ar": "تعلق قلق",
        "fa": "دلبستگی اضطرابی",
        "ru": "тревожная привязанность",
        "bg": "тревожна привързаност",
        "tr": "kaygılı bağlanma"
      }
    },
    {
      "key": "avoidant",
      "labels": {
        "zh": "回避型依恋",
        "en": "avoidant attachment",
        "ja": "回避型愛着",
        "ko": "회피 애착",
        "pt": "apego evitante",
        "es": "apego evitativo",
        "id": "kelekatan menghindar",
        "ar": "تعلق تجنبي",
        "fa": "دلبستگی اجتنابی",
        "ru": "избегающая привязанность",
        "bg": "избягваща привързаност",
        "tr": "kaçınan bağlanma"
      }
    },
    {
      "key": "fearful",
      "labels": {
        "zh": "恐惧-矛盾型",
        "en": "fearful-avoidant",
        "ja": "恐れ回避型",
        "ko": "공포-회피",
        "pt": "medo-evitativo",
        "es": "temeroso-evitativo",
        "id": "takut-menghindar",
        "ar": "خائف-تجنبي",
        "fa": "ترسناک-اجتنابی",
        "ru": "тревожно-избегающий",
        "bg": "страшно-избягващ",
        "tr": "korkulu-kaçınan"
      }
    }
  ],
  "conflict_style": [
    {
      "key": "direct",
      "labels": {
        "zh": "当面直说",
        "en": "direct confrontation",
        "ja": "面と向かって話す",
        "ko": "직접 말하기",
        "pt": "confronto direto",
        "es": "confrontación directa",
        "id": "langsung terang",
        "ar": "مواجهة مباشرة",
        "fa": "مواجهه مستقیم",
        "ru": "прямое столкновение",
        "bg": "пряка конфронтация",
        "tr": "doğrudan yüzleşme"
      }
    },
    {
      "key": "cool_down",
      "labels": {
        "zh": "先冷静再谈",
        "en": "cool down then talk",
        "ja": "冷めてから話す",
        "ko": "식힌 뒤 대화",
        "pt": "esfriar depois falar",
        "es": "enfriar y hablar",
        "id": "tenang dulu baru bicara",
        "ar": "هدوء ثم حديث",
        "fa": "آرام شو بعد حرف بزن",
        "ru": "остыть, потом говорить",
        "bg": "изстини, после говори",
        "tr": "sakinleş, sonra konuş"
      }
    },
    {
      "key": "compromise",
      "labels": {
        "zh": "折中求和",
        "en": "compromising",
        "ja": "妥協を探る",
        "ko": "타협 지향",
        "pt": "compromisso",
        "es": "compromiso",
        "id": "kompromi",
        "ar": "تسوية",
        "fa": "سازش",
        "ru": "компромисс",
        "bg": "компромис",
        "tr": "uzlaşma"
      }
    },
    {
      "key": "competitive",
      "labels": {
        "zh": "争赢/好辩",
        "en": "competitive / debate",
        "ja": "勝ちにこだわる",
        "ko": "승부형 논쟁",
        "pt": "competitivo",
        "es": "competitivo",
        "id": "kompetitif",
        "ar": "تنافسي",
        "fa": "رقابتی / بحث",
        "ru": "соревновательный / спор",
        "bg": "състезателен / дебат",
        "tr": "rekabetçi / tartışma"
      }
    },
    {
      "key": "withdraw",
      "labels": {
        "zh": "沉默抽离",
        "en": "withdraw / stonewall",
        "ja": "黙って距離を取る",
        "ko": "침묵 거리두기",
        "pt": "afastar-se",
        "es": "retirarse",
        "id": "menarik diri",
        "ar": "انسحاب",
        "fa": "کناره‌گیری",
        "ru": "уход / молчание",
        "bg": "отдръпване",
        "tr": "çekilme"
      }
    }
  ],
  "life_pace": [
    {
      "key": "slow",
      "labels": {
        "zh": "慢节奏",
        "en": "slow pace",
        "ja": "スローペース",
        "ko": "느린 템포",
        "pt": "ritmo lento",
        "es": "ritmo lento",
        "id": "tempo lambat",
        "ar": "إيقاع بطيء",
        "fa": "ریتم آهسته",
        "ru": "медленный темп",
        "bg": "бавно темпо",
        "tr": "yavaş tempo"
      }
    },
    {
      "key": "steady",
      "labels": {
        "zh": "稳健规律",
        "en": "steady routine",
        "ja": "安定したリズム",
        "ko": "규칙적 안정",
        "pt": "rotina estável",
        "es": "rutina estable",
        "id": "rutin stabil",
        "ar": "روتين ثابت",
        "fa": "روال ثابت",
        "ru": "стабильный распорядок",
        "bg": "стабилна рутина",
        "tr": "istikrarlı rutin"
      }
    },
    {
      "key": "fast",
      "labels": {
        "zh": "快节奏高压",
        "en": "fast / high-pressure",
        "ja": "ハイペース",
        "ko": "빠른 고압",
        "pt": "ritmo acelerado",
        "es": "ritmo rápido",
        "id": "tempo cepat",
        "ar": "سريع/ضغط عالٍ",
        "fa": "سریع / پرفشار",
        "ru": "быстрый / высокое давление",
        "bg": "бърз / високо налягане",
        "tr": "hızlı / yüksek baskı"
      }
    },
    {
      "key": "irregular",
      "labels": {
        "zh": "作息不规则",
        "en": "irregular schedule",
        "ja": "不規則",
        "ko": "불규칙",
        "pt": "horário irregular",
        "es": "horario irregular",
        "id": "jadwal tidak teratur",
        "ar": "جدول غير منتظم",
        "fa": "برنامه نامنظم",
        "ru": "нерегулярный график",
        "bg": "нередовен график",
        "tr": "düzensiz program"
      }
    }
  ],
  "interest_domain": [
    {
      "key": "sports",
      "labels": {
        "zh": "运动竞技",
        "en": "sports",
        "ja": "スポーツ",
        "ko": "스포츠",
        "pt": "esportes",
        "es": "deportes",
        "id": "olahraga",
        "ar": "رياضة",
        "fa": "ورزش",
        "ru": "спорт",
        "bg": "спорт",
        "tr": "spor"
      }
    },
    {
      "key": "arts",
      "labels": {
        "zh": "艺术审美",
        "en": "arts / aesthetics",
        "ja": "アート",
        "ko": "예술",
        "pt": "artes",
        "es": "artes",
        "id": "seni",
        "ar": "فنون",
        "fa": "هنر / زیبایی‌شناسی",
        "ru": "искусство / эстетика",
        "bg": "изкуство / естетика",
        "tr": "sanat / estetik"
      }
    },
    {
      "key": "tech_gadgets",
      "labels": {
        "zh": "数码科技",
        "en": "tech & gadgets",
        "ja": "ガジェット",
        "ko": "디지털",
        "pt": "tech",
        "es": "gadgets",
        "id": "gadget",
        "ar": "أدوات تقنية",
        "fa": "فناوری و گجت",
        "ru": "техника и гаджеты",
        "bg": "технологии и джаджи",
        "tr": "teknoloji ve gadget"
      }
    },
    {
      "key": "food",
      "labels": {
        "zh": "美食烹饪",
        "en": "food & cooking",
        "ja": "食",
        "ko": "음식",
        "pt": "comida",
        "es": "comida",
        "id": "kuliner",
        "ar": "طعام",
        "fa": "غذا و آشپزی",
        "ru": "еда и готовка",
        "bg": "храна и готвене",
        "tr": "yemek ve mutfak"
      }
    },
    {
      "key": "outdoors",
      "labels": {
        "zh": "户外自然",
        "en": "outdoors",
        "ja": "アウトドア",
        "ko": "아웃도어",
        "pt": "ar livre",
        "es": "aire libre",
        "id": "outdoor",
        "ar": "هواء طلق",
        "fa": "فضای باز",
        "ru": "на природе",
        "bg": "на открито",
        "tr": "açık hava"
      }
    },
    {
      "key": "gaming",
      "labels": {
        "zh": "游戏电竞",
        "en": "gaming",
        "ja": "ゲーム",
        "ko": "게임",
        "pt": "games",
        "es": "videojuegos",
        "id": "game",
        "ar": "ألعاب",
        "fa": "بازی",
        "ru": "игры",
        "bg": "игри",
        "tr": "oyun"
      }
    },
    {
      "key": "music",
      "labels": {
        "zh": "音乐现场",
        "en": "music",
        "ja": "音楽",
        "ko": "음악",
        "pt": "música",
        "es": "música",
        "id": "musik",
        "ar": "موسيقى",
        "fa": "موسیقی",
        "ru": "музыка",
        "bg": "музика",
        "tr": "müzik"
      }
    },
    {
      "key": "reading",
      "labels": {
        "zh": "阅读写作",
        "en": "reading / writing",
        "ja": "読書・執筆",
        "ko": "독서/글",
        "pt": "leitura",
        "es": "lectura",
        "id": "membaca",
        "ar": "قراءة",
        "fa": "خواندن / نوشتن",
        "ru": "чтение / письмо",
        "bg": "четене / писане",
        "tr": "okuma / yazma"
      }
    },
    {
      "key": "markets",
      "labels": {
        "zh": "财经投资",
        "en": "markets / investing",
        "ja": "投資・経済",
        "ko": "재테크",
        "pt": "investimentos",
        "es": "inversiones",
        "id": "investasi",
        "ar": "استثمار",
        "fa": "بازار / سرمایه‌گذاری",
        "ru": "рынки / инвестиции",
        "bg": "пазари / инвестиции",
        "tr": "piyasa / yatırım"
      }
    },
    {
      "key": "travel",
      "labels": {
        "zh": "旅行探索",
        "en": "travel",
        "ja": "旅行",
        "ko": "여행",
        "pt": "viagem",
        "es": "viajes",
        "id": "travel",
        "ar": "سفر",
        "fa": "سفر",
        "ru": "путешествия",
        "bg": "пътуване",
        "tr": "seyahat"
      }
    }
  ]
};

export const AXIS_TITLE = {
  zh: { career_class: "职业阶层", attachment: "依恋类型", conflict_style: "冲突风格", life_pace: "生活节奏", interest_domain: "兴趣领域分类（可选）" },
  en: { career_class: "Career class", attachment: "Attachment style", conflict_style: "Conflict style", life_pace: "Life pace", interest_domain: "Interest domain (optional)" },
  ja: { career_class: "職業クラス", attachment: "愛着タイプ", conflict_style: "衝突スタイル", life_pace: "生活ペース", interest_domain: "関心領域カテゴリ（任意）" },
  ko: { career_class: "직업 계층", attachment: "애착 유형", conflict_style: "갈등 스타일", life_pace: "생활 리듬", interest_domain: "관심 영역 분류 (선택)" },
  pt: { career_class: "Classe de carreira", attachment: "Estilo de apego", conflict_style: "Estilo de conflito", life_pace: "Ritmo de vida", interest_domain: "Domínio de interesse (opcional)" },
  es: { career_class: "Clase laboral", attachment: "Estilo de apego", conflict_style: "Estilo de conflicto", life_pace: "Ritmo de vida", interest_domain: "Ámbito de interés (opcional)" },
  id: { career_class: "Kelas karier", attachment: "Gaya kelekatan", conflict_style: "Gaya konflik", life_pace: "Tempo hidup", interest_domain: "Kategori bidang minat (opsional)" },
  ar: { career_class: "الطبقة المهنية", attachment: "نمط التعلق", conflict_style: "أسلوب النزاع", life_pace: "إيقاع الحياة", interest_domain: "مجال الاهتمام (اختياري)" },
  fa: { career_class: "طبقه شغلی", attachment: "سبک دلبستگی", conflict_style: "سبک تعارض", life_pace: "ریتم زندگی", interest_domain: "حوزه علاقه (اختیاری)" },
  ru: { career_class: "Класс карьеры", attachment: "Стиль привязанности", conflict_style: "Стиль конфликта", life_pace: "Темп жизни", interest_domain: "Сфера интересов (необязательно)" },
  bg: { career_class: "Кариерен клас", attachment: "Стил на привързаност", conflict_style: "Стил на конфликт", life_pace: "Житейско темпо", interest_domain: "Област на интерес (по избор)" },
  tr: { career_class: "Kariyer sınıfı", attachment: "Bağlanma stili", conflict_style: "Çatışma stili", life_pace: "Yaşam temposu", interest_domain: "İlgi alanı (isteğe bağlı)" },
};

function pickLabel(labels, lang) {
  const l = String(lang || 'zh').split('-')[0];
  return (labels && (labels[l] || labels.en)) || '';
}

export function axisTitle(axis, lang = 'zh') {
  const l = String(lang || 'zh').split('-')[0];
  return (AXIS_TITLE[l] || AXIS_TITLE.en)[axis] || axis;
}

export function listAxisOptions(axis, lang = 'zh') {
  return (AXIS_OPTIONS[axis] || []).map((o) => ({
    key: o.key,
    label: pickLabel(o.labels, lang),
  }));
}

export function resolveAxesLabels(keys, lang = 'zh') {
  const labels = {};
  for (const axis of AXIS_ORDER) {
    const k = keys?.[axis];
    const opt = (AXIS_OPTIONS[axis] || []).find((o) => o.key === k);
    labels[axis] = opt ? pickLabel(opt.labels, lang) : '';
  }
  return labels;
}

export function formatAxesSummary(keys, lang = 'zh') {
  const labels = resolveAxesLabels(keys, lang);
  return AXIS_ORDER
    .map((axis) => {
      const title = axisTitle(axis, lang);
      const lab = labels[axis];
      return lab ? `${title}：${lab}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function defaultAxesKeys() {
  const keys = {};
  for (const axis of AXIS_ORDER) {
    keys[axis] = (AXIS_OPTIONS[axis] || [])[0]?.key || '';
  }
  return keys;
}

export function axesKeysToPickerValue(keys) {
  return AXIS_ORDER.map((axis) => {
    const opts = AXIS_OPTIONS[axis] || [];
    const idx = opts.findIndex((o) => o.key === keys?.[axis]);
    return idx >= 0 ? idx : 0;
  });
}

export function pickerValueToAxesKeys(value) {
  const keys = {};
  AXIS_ORDER.forEach((axis, i) => {
    const opts = AXIS_OPTIONS[axis] || [];
    const idx = Number(value?.[i] ?? 0);
    keys[axis] = opts[idx]?.key || opts[0]?.key || '';
  });
  return keys;
}
