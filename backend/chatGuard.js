const PLATFORM_RE = new RegExp(
  [
    "whats\\s*app",
    "wa\\.?me",
    "telegram",
    "t\\.me",
    "telegr[ae]m",
    "instagram",
    "insta",
    "facebook",
    "fb\\.com",
    "messenger",
    "viber",
    "whatsapp",
    "snapchat",
    "snap\\s*chat",
    "discord",
    "signal",
    "tiktok",
    "tik\\s*tok",
    "twitter",
    "skype",
    "wechat",
    "we\\s*chat",
    "imo\\b",
    "botim",
    "line\\.me",
    "واتس\\s*اب",
    "واتساب",
    "تلغرام",
    "تيليجرام",
    "تليجرام",
    "انستغرام",
    "إنستغرام",
    "فيسبوك",
    "فايسبوك",
    "ماسنجر",
    "فايبر",
    "سناب",
    "ديسكورد",
    "سيغنال",
    "سيجنال",
    "تيك\\s*توك",
    "تويتر",
    "سكايب",
    "وي\\s*تشات",
    "إيمو",
    "ايمو",
    "بوتيم"
  ].join("|"),
  "gi"
);

function easternToWestern(s) {
  return String(s || "").replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}

function looksLikeShamCash(s) {
  return /^[a-f0-9]{32}$/i.test(String(s || "").replace(/\s/g, ""));
}

function looksLikeTxOrAddress(s) {
  const t = String(s || "").trim();
  return /^0x[a-fA-F0-9]{40,64}$/.test(t) || looksLikeShamCash(t);
}

function sanitizeChatText(raw) {
  let text = String(raw || "");
  const original = text;
  if (!text.trim()) return { text: "", flagged: false };

  const western = easternToWestern(text);
  let flagged = false;

  function redact(re, flags) {
    const next = text.replace(re, () => {
      flagged = true;
      return "[محذوف]";
    });
    text = next;
    if (flags) {
      /* keep */
    }
  }

  text = western.replace(/https?:\/\/[^\s]+/gi, (url) => {
    if (/t\.me|telegram|wa\.me|whatsapp|instagram|facebook|fb\.com|viber|snapchat|discord|tiktok|twitter|imo|botim|line\.me|wechat/i.test(url)) {
      flagged = true;
      return "[محذوف]";
    }
    return url;
  });

  text = text.replace(PLATFORM_RE, () => {
    flagged = true;
    return "[محذوف]";
  });

  text = text.replace(/(?:^|[^\w])@([a-zA-Z][\w]{3,31})\b/g, (m, name) => {
    if (/^[a-fA-F0-9]{32}$/.test(name)) return m;
    flagged = true;
    return m.replace("@" + name, "[محذوف]");
  });

  text = text.replace(/(?:\+|00)?(?:963)?0?9\d{8}\b/g, () => {
    flagged = true;
    return "[محذوف]";
  });

  text = text.replace(/(?:\+|00)\d{8,15}\b/g, () => {
    flagged = true;
    return "[محذوف]";
  });

  text = text.replace(/(?<![a-fA-F0-9x])\d[\d\s\-.]{7,16}\d/g, (chunk) => {
    const digits = chunk.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15 && !looksLikeTxOrAddress(chunk.trim())) {
      flagged = true;
      return "[محذوف]";
    }
    return chunk;
  });

  if (text !== original && /\[محذوف\]/.test(text)) flagged = true;
  return { text: text.slice(0, 1000), flagged };
}

function hasActivePaymentMethod(userId, types, methods) {
  const list = Array.isArray(types) && types.length ? types : ["SHAM_CASH"];
  return (methods || []).some(
    (m) => m.userId === userId && m.active !== false && list.includes(m.type)
  );
}

function existingPaymentMethod(userId, type, methods) {
  const t = String(type || "SHAM_CASH").trim() || "SHAM_CASH";
  return (methods || []).find(
    (m) => m.userId === userId && m.active !== false && m.type === t
  ) || null;
}

function sellerPaymentSnapshot(seller, methods, paymentType) {
  const type = String(paymentType || "SHAM_CASH").trim() || "SHAM_CASH";
  const sellerId = seller && seller.id;
  const list = (methods || []).filter(
    (m) => m.userId === sellerId && m.active !== false && (m.type === type || m.type === "SHAM_CASH")
  );
  const src = list[0] && list[0].details && typeof list[0].details === "object" ? list[0].details : {};
  const name = String((seller && seller.kyc && seller.kyc.fullName) || src.name || "").trim();
  const address = String(src.address || src.account || src.wallet || "")
    .replace(/^0x/i, "")
    .trim()
    .toLowerCase();
  const details = {};
  if (name) details.name = name;
  if (address) {
    details.address = address;
    details.account = address;
  }
  return {
    details,
    label: list[0] ? list[0].label : "شام كاش",
    type,
    methodId: list[0] ? list[0].id : null
  };
}

module.exports = { sanitizeChatText, hasActivePaymentMethod, existingPaymentMethod, sellerPaymentSnapshot, easternToWestern };
