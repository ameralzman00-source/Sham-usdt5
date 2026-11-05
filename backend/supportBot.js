const TOPICS = [
  {
    id: "deposit",
    title: "الإيداع BEP20",
    keywords: ["ايداع", "إيداع", "اودع", "أودع", "bep20", "شبكة", "الشبكة", "تحويل", "الرصيد", "وصل", "لم يصل", "txid", "هاش"],
    body: [
      "الإيداع حصراً على شبكة BEP20 (USDT). لا تستخدم ERC20 أو TRC20.",
      "من المحفظة اختر «إيداع»، انسخ اسم المحفظة والعنوان الظاهر، حوّل المبلغ، ثم أرسل الطلب مع هاش التحويل.",
      "الحد الأدنى للإيداع يظهر في صفحة الإيداع. رقمك الداخلي (UID) للتحويل بين المستخدمين فقط وليس للإيداع الخارجي.",
      "بعد إرسال الطلب يراجعه المدير ويضيف الرصيد. إن تأخر أكثر من ساعة أرسل هاش التحويل للدعم.",
      "لا ترسل USDT على شبكة أخرى؛ الأموال المرسلة على شبكة خاطئة قد تُفقد."
    ].join("\n"),
    quick: ["withdraw", "wallet"]
  },
  {
    id: "withdraw",
    title: "السحب",
    keywords: ["سحب", "اسحب", "أسحب", "withdraw", "رسوم السحب", "عنوان المحفظة", "متى يصل", "تأخير"],
    body: [
      "السحب حصراً إلى عنوان BEP20 صحيح يبدأ بـ 0x ويتكون من 42 خانة.",
      "أدخل المبلغ وتأكد من العنوان، ثم أدخل رمز التحرير (6 أرقام) لتأكيد الطلب.",
      "يُحجز المبلغ مع الرسوم حتى ينفذ المدير التحويل ويضيف هاش العملية في السجل.",
      "الرسوم الثابتة والنسبة يحددها المدير وتظهر في نموذج السحب قبل التأكيد.",
      "لا يمكن إلغاء سحب بعد التنفيذ. إن أخطأت في العنوان راسل الدعم فوراً قبل التنفيذ."
    ].join("\n"),
    quick: ["deposit", "pin"]
  },
  {
    id: "kyc",
    title: "التوثيق KYC",
    keywords: ["توثيق", "kyc", "هوية", "الهوية", "وثيقة", "رفض", "مرفوض", "متقدم", "صورة شخصية", "جواز"],
    body: [
      "التوثيق مطلوب قبل التداول والإيداع والسحب ونشر الإعلانات وإضافة شام كاش.",
      "الأساسي: وجه الهوية + ظهر الهوية + صورة شخصية وأنت تحمل الوثيقة، مع الاسم الحقيقي ورقم الهوية والدولة.",
      "إن رُفض الطلب تظهر ملاحظة الإدارة في صفحة التوثيق؛ عدّل الصور أو البيانات ثم أعد الإرسال.",
      "بعد قبول الأساسي يمكن طلب التوثيق المتقدم برفع إثبات سكن لرفع حد المبالغ الكبيرة.",
      "الاسم القانوني في التوثيق هو اسم المستلم في شام كاش ولا يمكن تغييره لاحقاً."
    ].join("\n"),
    quick: ["payment", "start"]
  },
  {
    id: "start",
    title: "البدء والتداول",
    keywords: ["ابدأ", "أبدأ", "بداية", "كيف أشتري", "كيف أبيع", "تداول", "شراء", "أشتري", "بيع", "أبيع"],
    body: [
      "1) وثّق حسابك. 2) أضف عنوان شام كاش. 3) للبيع أو نشر الإعلان اطلب اعتماد تاجر.",
      "للشراء: من السوق اختر إعلاناً وأدخل الكمية ضمن الحدود، ثم حوّل عبر شام كاش وارفع الإيصال وأكد الدفع.",
      "للبيع على إعلان مشترٍ: تُحجز عملتك فوراً، وبعد تأكيد المشتري راجع الإيصال ثم أفرج برمز التحرير.",
      "عملة البائع تبقى محجوزة بضمان المنصة حتى الإفراج أو حل النزاع.",
      "كل الصفقات داخل المنصة تُسجّل تلقائياً في «صفقاتي»."
    ].join("\n"),
    quick: ["escrow", "payment"]
  },
  {
    id: "escrow",
    title: "الضمان والإفراج",
    keywords: ["ضمان", "حجز", "إفراج", "افراج", "محتجز", "البائع", "المشتري", "أكدت الدفع"],
    body: [
      "عند إنشاء الصفقة تُحجز كمية البائع من محفظته كضمان للمنصة.",
      "المشتري يحوّل عبر شام كاش ثم يرفع صورة الإيصال ويضغط «أكدت الدفع».",
      "البائع يطابق اسم المشتري القانوني والإيصال ثم يفرج برمز التحرير.",
      "إذا لم يفرج البائع بعد وصول المبلغ، افتح نزاعاً من غرفة الصفقة مع الصورة أو الفيديو.",
      "لا تفرج قبل التأكد من وصول المبلغ بنفس الاسم."
    ].join("\n"),
    quick: ["dispute", "pin"]
  },
  {
    id: "payment",
    title: "شام كاش وطرق الدفع",
    keywords: ["شام كاش", "شامكاش", "طريقة دفع", "عنوان", "32", "اسم المستلم", "اسم قانوني", "إضافة طريقة"],
    body: [
      "طريقة الدفع الوحيدة هي شام كاش، بدون رقم هاتف وبدون ربط API.",
      "المطلوب: اسم المستلم (من التوثيق، لا يتغير) + عنوان شام كاش 32 خانة hex.",
      "يمكنك وجود طريقة دفع واحدة فقط لكل نوع؛ لتغييرها احذف القديمة ثم أضف الجديدة.",
      "لا تنشر عنوانك في دردشة عامة. يظهر للمشتري داخل غرفة الصفقة فقط.",
      "الاسم الظاهر للمستخدمين يمكن تغييره مرة كل 60 يوماً."
    ].join("\n"),
    quick: ["kyc", "start"]
  },
  {
    id: "ad",
    title: "الإعلانات والتاجر",
    keywords: ["إعلان", "اعلان", "نشر", "تاجر", "اعتماد", "إعلاناتي", "عائم", "ثابت", "سعر", "حدود"],
    body: [
      "نشر الإعلانات متاح للتجار المعتمدين فقط بعد التوثيق وإضافة شام كاش.",
      "أرسل طلب اعتماد تاجر من «إعلاناتي» أو من البوت، وسيصل للمدير مع ملاحظة القرار.",
      "اختر نوع الطلب: ثابت (سعر لا يتأثر بالسوق) أو عائم (السعر = سوق × نسبة).",
      "حدود البيع والشراء منفصلة؛ السعر المقترح يظهر أثناء الإنشاء.",
      "إيقاف إعلان البيع يعيد الكمية غير المباعة إلى رصيدك."
    ].join("\n"),
    quick: ["start", "payment"]
  },
  {
    id: "pin",
    title: "رمز التحرير PIN",
    keywords: ["رمز التحرير", "pin", "رمز", "6 أرقام", "قفل", "نسيت الرمز", "رمز سري"],
    body: [
      "رمز التحرير 6 أرقام منفصل عن كلمة المرور ويُطلب عند الإفراج والسحب والتحويل.",
      "عيّنه من صفحة الحساب أو من البوت «حسابي».",
      "بعد 5 محاولات خاطئة يُقفل 15 دقيقة.",
      "إن نسيته راسل الدعم البشري من حسابك المرتبط بعد التحقق؛ المدير يمسحه لتعيينه من جديد."
    ].join("\n"),
    quick: ["password", "security"]
  },
  {
    id: "password",
    title: "الدخول وكلمة المرور",
    keywords: ["كلمة المرور", "كلمة السر", "دخول", "نسيت", "t0tp", "totp", "مصادقة", "تسجيل", "حساب"],
    body: [
      "الدخول باسم مستخدم وكلمة مرور، أو من داخل بوت تلغرام.",
      "إن فعّلت المصادقة الثنائية (TOTP) أدخل الرمز من تطبيق المصادقة بعد كلمة المرور.",
      "لنسيان كلمة المرور: راسل الدعم البشري من حساب تلغرام المرتبط بعد التحقق من الهوية.",
      "المدير يصدر كلمة مرور مؤقتة؛ غيّرها فوراً من صفحة الحساب.",
      "لا تشارك كلمة المرور أو TOTP أو رمز التحرير مع أي شخص."
    ].join("\n"),
    quick: ["pin", "security"]
  },
  {
    id: "security",
    title: "حماية الحساب",
    keywords: ["حماية", "أمان", "امان", "اختراق", "سرقة", "احتيال", "نصب", "مشبوه"],
    body: [
      "فعّل TOTP ورمز التحرير، ولا تشاركهما مع أحد.",
      "المنصة لا تطلب أبداً كلمة المرور أو رمز التحرير في الدردشة.",
      "تعامل فقط من داخل المنصة أو محادثة تلغرام المعتمدة.",
      "أي طلب تحويل خارج المنصة أو عرض سعر مغرٍ خارجها قد يكون احتيالاً.",
      "أبلغ الدعم البشري فوراً عند أي نشاط مشبوه."
    ].join("\n"),
    quick: ["password", "pin"]
  },
  {
    id: "dispute",
    title: "النزاع والشكاوى",
    keywords: ["نزاع", "شكوى", "اشتكي", "مزيف", "إيصال مزيف", "لم يفرج", "لم يصل", "مبلغ ناقص", "خلاف"],
    body: [
      "افتح نزاعاً من غرفة الصفقة إذا كان الإيصال غير صحيح أو لم يصل المبلغ أو لم يفرج البائع.",
      "ارفع صورة أو فيديو يوضح التحويل؛ المدير يراجع الأدلة ويفرج أو يلغي.",
      "لا تفرج للطرف الآخر قبل التحقق من الاسم والمبلغ.",
      "بعد فتح النزاع لا تُغلق الصفقة تلقائياً؛ انتظر قرار الإدارة.",
      "إن استمرت المشكلة حوّلها للدعم البشري من هذه المحادثة."
    ].join("\n"),
    quick: ["escrow"]
  },
  {
    id: "fees",
    title: "العمولات والحدود",
    keywords: ["عمولة", "رسوم", "fee", "حد أدنى", "حد أقصى", "كم عمولة", "تكلفة"],
    body: [
      "العمولات يحددها المدير: نسبة الإيداع، نسبة السحب، ورسوم تحويل داخلي اختيارية.",
      "رسوم السحب الثابتة تُضاف إلى المبلغ المحجوز وتظهر قبل التأكيد.",
      "حدود الإيداع والسحب تظهر في الصفحة المخصصة وتُحدّث من لوحة الإدارة.",
      "حدود أسعار الإعلانات تُدار لكل زوج على حدة (حد بيع وحد شراء)."
    ].join("\n"),
    quick: ["withdraw", "deposit"]
  },
  {
    id: "freeze",
    title: "تجميد الحساب",
    keywords: ["تجميد", "مجمّد", "مجمد", "موقوف", "إيقاف الحساب", "حظر"],
    body: [
      "التجميد يمنع التداول أو السحب حسب نوعه، ويظهر سببه في أعلى الصفحة.",
      "راجع سبب التجميد الظاهر، ثم راسل الدعم البشري من حساب تلغرام المرتبط.",
      "لا يمكن فك التجميد من داخل المحادثة الآلية؛ يحتاج مراجعة المدير.",
      "قد يُطلب منك إثبات هوية إضافي قبل رفع التجميد."
    ].join("\n"),
    quick: ["kyc"]
  },
  {
    id: "wallet",
    title: "المحفظة والتحويل الداخلي",
    keywords: ["محفظة", "رصيد", "تحويل داخلي", "uid", "إرسال", "استلام", "أرصدة"],
    body: [
      "المحفظة تعرض USDT وغيرها من العملات المفعّلة، مع سجل الإيداع والسحب والتحويلات.",
      "التحويل الداخلي يتم عبر UID أو اسم المستخدم داخل المنصة وفوري.",
      "أي تحويل خارجي يجب أن يكون على شبكة BEP20 فقط.",
      "قد تُطبق عمولة على التحويل الداخلي وستظهر قبل التأكيد.",
      "راجع «سجل السحب» لمعرفة حالة الطلب وهاش التنفيذ."
    ].join("\n"),
    quick: ["deposit", "withdraw"]
  },
  {
    id: "human",
    title: "التحدث مع الدعم البشري",
    keywords: ["موظف", "بشري", "دعم بشري", "شخص", "مدير", "إنسان", "تذكرة"],
    body: [
      "تم فتح التحويل للدعم البشري بعد تجربة المساعد الآلي.",
      "اكتب وصفاً واضحاً للمشكلة مع رقم الصفقة أو هاش التحويل إن وُجد.",
      "لا ترسل كلمة المرور أو رمز التحرير أو رمز TOTP.",
      "ستُفتح تذكرة داخل المنصة ويصلك الرد في الإشعارات وصفحة الدعم."
    ].join("\n"),
    quick: ["dispute", "pin"]
  }
];

const TOPIC_MAP = new Map(TOPICS.map((t) => [t.id, t]));

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTopic(topic, normalized) {
  let score = 0;
  for (const keyword of topic.keywords) {
    const k = normalize(keyword);
    if (!k) continue;
    if (normalized.includes(k)) {
      score += k.length >= 4 ? 3 : 2;
      if (normalized.startsWith(k)) score += 1;
    }
  }
  return score;
}

function topicById(id) {
  return TOPIC_MAP.get(String(id || "")) || null;
}

function normalizeTopicId(id) {
  return TOPIC_MAP.has(String(id || "")) ? String(id) : "start";
}

const HUMAN_UNLOCK_TOPICS = new Set(["human", "dispute", "freeze", "unknown"]);
const MIN_ASSISTANT_TURNS = 1;

function quickFor(topicId, { humanUnlocked } = {}) {
  const topic = topicById(topicId) || topicById("start");
  const ids = Array.from(new Set(topic.quick || []));
  if (humanUnlocked) ids.push("human");
  return ids.map((id) => topicById(id)).filter(Boolean).map((t) => ({ id: t.id, title: t.title }));
}

function topicReply(topicId, opts = {}) {
  const topic = topicById(topicId);
  if (!topic) return answer("", opts);
  const humanUnlocked = !!opts.humanUnlocked;
  return {
    topicId: topic.id,
    title: topic.title,
    reply: `${topic.title}\n\n${topic.body}`,
    quick: quickFor(topic.id, { humanUnlocked }),
    suggestHuman: HUMAN_UNLOCK_TOPICS.has(topic.id) || humanUnlocked,
    humanUnlocked
  };
}

function topTopics({ humanUnlocked } = {}) {
  const ids = ["start", "deposit", "withdraw", "kyc", "ad", "dispute", "pin"];
  if (humanUnlocked) ids.push("human");
  return ids
    .map((id) => topicById(id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, title: t.title }));
}

function greeting() {
  return [
    "مرحباً بك في دعم USDT شام الآلي.",
    "أستطيع مساعدتك فوراً في: الإيداع والسحب، التوثيق، التداول والضمان، شام كاش، الإعلانات، رمز التحرير، والدخول.",
    "اكتب سؤالك أو اختر موضوعاً. الدعم البشري يُفتح بعد تجربة المساعد الآلي أو إذا كانت المسألة تحتاج مراجعة."
  ].join("\n");
}

function withGate(payload, opts = {}) {
  const humanUnlocked = !!opts.humanUnlocked;
  return {
    ...payload,
    humanUnlocked,
    suggestHuman: !!payload.suggestHuman || humanUnlocked,
    quick: payload.quick && payload.quick.length ? payload.quick : topTopics({ humanUnlocked })
  };
}

function answer(text, opts = {}) {
  const humanUnlocked = !!opts.humanUnlocked;
  const normalized = normalize(text);
  if (!normalized) {
    return withGate({
      topicId: "start",
      title: "الدعم الآلي",
      reply: greeting(),
      quick: topTopics({ humanUnlocked }),
      suggestHuman: false
    }, opts);
  }
  if (isHumanRequest(text) && !humanUnlocked) {
    return withGate({
      topicId: "start",
      title: "جرّب المساعد أولاً",
      reply: [
        "الدعم البشري يُفتح بعد سؤال المساعد الآلي مرة واحدة على الأقل.",
        "اكتب مشكلتك باختصار (إيداع، سحب، صفقة، توثيق...) وسأجيب فوراً. إن لم تُحل يمكنك التحويل للدعم البشري."
      ].join("\n"),
      quick: topTopics({ humanUnlocked: false }),
      suggestHuman: false
    }, { humanUnlocked: false });
  }
  let best = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    const score = scoreTopic(topic, normalized);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  if (!best || bestScore < 2) {
    return withGate({
      topicId: "unknown",
      title: "لم أتعرّف على الطلب",
      reply: [
        "لم أفهم طلبك تماماً. جرّب كلمات مثل: إيداع، سحب، توثيق، صفقة، شام كاش، رمز التحرير، أو الإعلانات.",
        humanUnlocked
          ? "يمكنك اختيار موضوع من الأزرار، أو التحدث مع الدعم البشري."
          : "اختر موضوعاً من الأزرار أو أعد صياغة السؤال."
      ].join("\n"),
      quick: topTopics({ humanUnlocked }),
      suggestHuman: humanUnlocked
    }, opts);
  }
  return topicReply(best.id, opts);
}

function matchTopic(text, fallback = "start") {
  const normalized = normalize(text);
  let best = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    const score = scoreTopic(topic, normalized);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best && bestScore >= 2 ? best.id : fallback;
}

function handoffNote(messages) {
  const lines = (messages || [])
    .filter((m) => m && m.text)
    .slice(-6)
    .map((m) => `${m.from === "user" ? "المستخدم" : "المساعد"}: ${String(m.text).slice(0, 240)}`);
  if (!lines.length) return "";
  return `ملخص المحادثة الآلية:\n${lines.join("\n")}`;
}

function isHumanRequest(text) {
  const normalized = normalize(text);
  return ["موظف", "بشري", "دعم بشري", "شخص حقيقي", "مدير", "تذكره", "تذكرة"].some((k) => normalized.includes(normalize(k)));
}

function canHandoff({ turns = 0, topicId, force } = {}) {
  if (force) return { ok: true };
  const n = Number(turns) || 0;
  if (n >= MIN_ASSISTANT_TURNS) return { ok: true };
  if (HUMAN_UNLOCK_TOPICS.has(String(topicId || ""))) return { ok: true };
  return {
    ok: false,
    error: "جرّب المساعد الآلي أولاً بسؤال واحد على الأقل، ثم يمكنك التحويل للدعم البشري إن لم تُحل المشكلة."
  };
}

module.exports = {
  TOPICS,
  topTopics,
  greeting,
  answer,
  topicById,
  topicReply,
  matchTopic,
  quickFor,
  handoffNote,
  isHumanRequest,
  canHandoff,
  HUMAN_UNLOCK_TOPICS,
  MIN_ASSISTANT_TURNS,
  normalize
};
