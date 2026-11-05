const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  db,
  save,
  uid,
  now,
  hashPassword,
  verifyPassword,
  publicUser,
  publicKyc,
  getWallet,
  freeze,
  unfreeze,
  releaseFrozenTo,
  credit,
  debit,
  settleFrozen,
  calcPctFee,
  notify,
  notificationHref,
  wipeSupportData,
  nextAdSerial,
  nextUidCode,
  findUserByUid,
  reload,
  getAssets,
  getFiats,
  getPaymentTypes,
  requireKyc,
  requireMerchant,
  requireAdvancedKyc,
  ensureUserFromTelegram,
  createUserFromTelegram,
  bindTelegramToUser,
  findUserByTelegramId,
  nationalIdTaken,
  normalizeNationalId,
  deleteSupportTicket,
  userBalanceSnapshot,
  resetPlatform,
  merchantBadgeRank,
  completeTradeStats,
  refreshFeaturedMerchant,
  setMerchantBadgeManual,
  isDemoUser,
  sameSandbox,
  adIsDemo,
  orderIsDemo,
  liveUsers,
  liveItemsByUser,
  freezeRestriction,
  pauseUserLiveAds,
  freezeUserFunds,
  unfreezeUserFunds,
  hasTradePin,
  assertTradePin,
  setTradePin,
  verifyTradePin,
  generateTempPassword,
  setUserPassword,
  clearTradePin,
  unlockTradePin,
  revokeUserSessions,
  publicSupportTicket,
  userOpenTicket,
  createSupportTicket,
  replySupportTicket,
  addSupportBotMessage,
  closeSupportTicket,
  supportTickets,
  publicTreasury,
  normalizeTreasuryWallets,
  activeDepositWallet,
  treasuryByAddress,
  isPlatformTreasuryAddress
} = require("./db");
const kycStore = require("./kycStore");
const evidenceStore = require("./evidenceStore");
const avatarStore = require("./avatarStore");
const { sanitizeChatText, hasActivePaymentMethod, existingPaymentMethod, sellerPaymentSnapshot } = require("./chatGuard");
const helpGuide = require("./helpGuide");
const supportBot = require("./supportBot");
const { generateTotpSecret, verifyTotp, otpauthUrl, formatSecretGroups } = require("./totp");
const { telegramBotToken, looksLikeToken, writeTelegramBotToken, clearTelegramBotToken } = require("./telegramToken");
const priceEngine = require("./priceEngine");
const marketPrices = require("./marketPrices");
const botManager = require("./botManager");
const { buildPdf } = require("./pdfGuide");
const { adminSections, userSections } = require("./guideContent");

const app = express();
const PORT = process.env.PORT || 3001;
const TOKEN_TTL = 365 * 24 * 60 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) reload();
  next();
});

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "حجم الملفات كبير جداً. ارفع صوراً أصغر (كل صورة أقل من 4MB)." });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "تعذر قراءة البيانات المرسلة" });
  }
  return next(err);
});

function touchSession(session) {
  if (!session) return;
  const remain = (session.expiresAt || 0) - now();
  if (remain < TOKEN_TTL / 2) {
    session.expiresAt = now() + TOKEN_TTL;
    session.touchedAt = now();
    save();
  }
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول" });
  const session = db.sessions.find((s) => s.token === token && s.expiresAt > now());
  if (!session) return res.status(401).json({ error: "جلسة غير صالحة" });
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });
  if (rejectDemo(user)) return res.status(401).json({ error: "الحسابات التجريبية غير متاحة" });
  touchSession(session);
  req.user = user;
  req.token = token;
  next();
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    const session = db.sessions.find((s) => s.token === token && s.expiresAt > now());
    if (session) {
      const u = db.users.find((x) => x.id === session.userId) || null;
      req.user = rejectDemo(u) ? null : u;
      if (req.user) touchSession(session);
    }
  }
  next();
}

function appDisabledPayload() {
  return {
    error: String((db.settings && db.settings.appDisabledMessage) || "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً."),
    code: "APP_DISABLED",
    appEnabled: false
  };
}

function isAppOpenPath(req) {
  const p = String(req.path || "");
  return (
    p === "/api/meta" ||
    p === "/api/auth/login" ||
    p === "/api/auth/register" ||
    p === "/api/auth/telegram" ||
    p === "/api/auth/telegram-link" ||
    p === "/api/auth/logout" ||
    p === "/api/me" ||
    p === "/api/help" ||
    p.startsWith("/api/admin")
  );
}

function userFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query && req.query.token;
  if (!token) return null;
  const session = (db.sessions || []).find((s) => s.token === token && s.expiresAt > now());
  if (!session) return null;
  const user = (db.users || []).find((u) => u.id === session.userId);
  return rejectDemo(user) ? null : user || null;
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (db.settings && db.settings.appEnabled === false) {
    const u = userFromRequest(req);
    if (u && u.isAdmin) return next();
    if (isAppOpenPath(req)) return next();
    return res.status(503).json(appDisabledPayload());
  }
  next();
});

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions.push({
    token,
    userId,
    createdAt: now(),
    expiresAt: now() + TOKEN_TTL
  });
  save();
  return token;
}

function badgeLabel(badge) {
  return {
    sponsored: "تاجر مدعوم",
    verified: "تاجر موثّق",
    featured: "تاجر مميز",
    regular: "تاجر عادي",
    new: "تاجر جديد"
  }[badge] || "تاجر";
}

function publicPriceRanges() {
  return (Array.isArray(db.settings.priceRanges) ? db.settings.priceRanges : [])
    .filter((r) => r && r.asset && r.fiat)
    .map((r) => {
      const sellMin = Number(r.sellMin != null ? r.sellMin : r.min) || 0;
      const sellMax = Number(r.sellMax != null ? r.sellMax : r.max) || 0;
      const buyMin = Number(r.buyMin != null ? r.buyMin : r.min) || 0;
      const buyMax = Number(r.buyMax != null ? r.buyMax : r.max) || 0;
      return {
        asset: String(r.asset),
        fiat: String(r.fiat),
        min: sellMin,
        max: sellMax,
        sellMin,
        sellMax,
        buyMin,
        buyMax
      };
    });
}

function validateAdPrice(asset, fiat, price, side) {
  const range = priceEngine.rangeFor(db.settings, asset, fiat, side);
  const min = Number(range && range.min) || 0;
  const max = Number(range && range.max) || 0;
  const label = String(side || "").toUpperCase() === "BUY" ? "شراء" : "بيع";
  if (min > 0 && max > 0 && min > max) return `نطاق سعر ${label} غير صالح في إعدادات الإدارة`;
  if (min > 0 && Number(price) < min - 1e-10) {
    return `سعر ${label} ${asset}/${fiat} يجب ألا يقل عن ${min}`;
  }
  if (max > 0 && Number(price) > max + 1e-10) {
    return `سعر ${label} ${asset}/${fiat} يجب ألا يتجاوز ${max}`;
  }
  return null;
}

function publicPricingSettings() {
  return priceEngine.publicPricing(db.settings);
}

function liveAdQuote(ad) {
  return priceEngine.resolveAdPrice(db.settings, ad, priceEngine.syncMarket(db.settings, ad.asset, ad.fiat));
}

function enrichAd(ad) {
  const owner = db.users.find((u) => u.id === ad.userId);
  const live = liveAdQuote(ad);
  const price = live.price > 0 ? live.price : Number(ad.price) || 0;
  return {
    ...ad,
    priceType: live.priceType,
    floatRatio: live.floatRatio,
    price,
    marketPrice: live.market || 0,
    owner: publicUser(owner)
  };
}

async function resolvePostedPrice(body, asset, fiat, side) {
  const priceType = String((body && body.priceType) || "fixed") === "floating" ? "floating" : "fixed";
  if (priceType !== "floating") {
    const p = Number(body && body.price);
    return { priceType: "fixed", floatRatio: 1, price: p };
  }
  const floatRatio = Number(body && body.floatRatio);
  if (!(floatRatio > 0) || floatRatio > 10) {
    throw new Error("نسبة السعر العائم غير صالحة");
  }
  const quote = await priceEngine.quoteFor(db.settings, asset, fiat);
  const market = Number(quote && quote.market) || priceEngine.syncMarket(db.settings, asset, fiat);
  if (!(market > 0)) {
    throw new Error("تعذر حساب السعر العائم. أدخل مصدر سعر لهذا الزوج أو استخدم سعراً ثابتاً.");
  }
  const resolved = priceEngine.resolveAdPrice(db.settings, { asset, fiat, side, priceType: "floating", floatRatio, price: 0 }, market);
  if (!(resolved.price > 0)) {
    throw new Error("السعر العائم خارج حدود الأمان");
  }
  return { priceType: "floating", floatRatio, price: resolved.price };
}

function publicPaymentDetails(details) {
  const src = details && typeof details === "object" ? details : {};
  const out = {};
  if (src.name) out.name = src.name;
  if (src.address) out.address = src.address;
  if (src.account && src.account !== src.address) out.account = src.account;
  return out;
}

function orderPaymentView(order) {
  const stored = publicPaymentDetails(order && order.paymentDetails);
  if (stored.name && (stored.address || stored.account)) {
    return {
      details: stored,
      label: (order && order.paymentLabel) || "شام كاش",
      type: (order && order.paymentType) || "SHAM_CASH"
    };
  }
  const seller = db.users.find((u) => u.id === (order && order.sellerId));
  const snap = sellerPaymentSnapshot(seller, db.paymentMethods, (order && order.paymentType) || "SHAM_CASH");
  return {
    details: publicPaymentDetails({ ...snap.details, ...stored }),
    label: (order && order.paymentLabel) || snap.label,
    type: (order && order.paymentType) || snap.type
  };
}

function lastOrderMessage(order) {
  const msgs = db.messages.filter((m) => m.orderId === order.id);
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  const raw = String(last.text || "");
  const text = last.userId === "system" ? raw : (sanitizeChatText(raw).text || raw);
  return {
    text: text.slice(0, 160),
    createdAt: last.createdAt,
    userId: last.userId
  };
}

function enrichOrder(order) {
  const ad = db.ads.find((a) => a.id === order.adId);
  const buyer = db.users.find((u) => u.id === order.buyerId);
  const seller = db.users.find((u) => u.id === order.sellerId);
  const pay = orderPaymentView(order);
  const buyerLegalName = String(order.buyerLegalName || verifiedPaymentName(buyer) || "").trim();
  return {
    ...order,
    buyerLegalName,
    paymentType: pay.type,
    paymentLabel: pay.label,
    paymentDetails: pay.details,
    evidence: evidenceStore.publicFiles(order.evidence),
    hasPaymentProof: evidenceStore.hasPaymentProof(order.evidence),
    ad: ad ? { id: ad.id, terms: ad.terms, timeLimitMin: ad.timeLimitMin } : null,
    lastMessage: lastOrderMessage(order),
    buyer: publicUser(buyer),
    seller: publicUser(seller)
  };
}

function counterparty(order, userId) {
  return order.buyerId === userId ? order.sellerId : order.buyerId;
}

function adminOnly(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: "للإدارة فقط" });
  next();
}

function sandboxMismatch(a, b) {
  return !sameSandbox(a, b);
}

function liveUser(id) {
  const u = db.users.find((x) => x.id === id);
  return u && !isDemoUser(u);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function isValidTxHash(h) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(h || "").trim());
}

function isValidAddress(a) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(a || "").trim());
}

function isValidShamCashAddress(a) {
  return /^[a-fA-F0-9]{32}$/.test(String(a || "").trim());
}

function verifiedPaymentName(user) {
  return String((user && user.kyc && user.kyc.fullName) || "").trim();
}

function normalizePaymentDetails(type, details, user) {
  const src = details && typeof details === "object" ? details : {};
  const out = {};
  const legalName = verifiedPaymentName(user);
  if (!legalName) {
    return { error: "يجب توثيق الهوية أولاً. اسم المستلم يُؤخذ من الاسم الحقيقي في KYC ولا يمكن تغييره." };
  }
  out.name = legalName;
  const account = String(src.account || src.address || src.wallet || src.raw || "").trim();
  if (type === "SHAM_CASH") {
    const addr = account.replace(/^0x/i, "").toLowerCase();
    if (!isValidShamCashAddress(addr)) {
      return { error: "عنوان شام كاش غير صالح. الصيغة: 32 خانة مثل a4c8e19b7d02f6e5c1a3b8d0479e2f5a" };
    }
    out.address = addr;
    out.account = addr;
  } else if (account) {
    out.account = account.slice(0, 80);
  }
  if (!out.address && !out.account) {
    return { error: "أدخل عنوان محفظة شام كاش" };
  }
  return { details: out };
}

function slugId(value, fallback) {
  const s = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 24);
  return s || fallback;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "USDT شام", time: now() });
});

app.get("/api/help", (_req, res) => {
  res.json(helpGuide.publicPayload());
});

app.get("/api/help.pdf", (_req, res) => {
  try {
    const pdf = buildPdf("دليل المستخدم — USDT شام", userSections());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"usdt-sham-user-guide.pdf\"");
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: "تعذر إنشاء دليل المستخدم" });
  }
});

app.get("/api/meta", async (req, res) => {
  const rates = await marketPrices.refresh();
  res.json({
    assets: marketPrices.withPrices(getAssets(), rates),
    prices: rates,
    pricesAt: marketPrices.updatedAt(),
    fiats: getFiats(),
    paymentTypes: getPaymentTypes(),
    settings: {
      brand: db.settings.brand || "USDT شام",
      country: db.settings.country || "SY",
      telegramBotUsername: db.settings.telegramBotUsername || "EntrepreneurMA_bot",
      webAppUrl: db.settings.webAppUrl || "https://5173-9b12c5a1da8443a8.monkeycode-ai.live",
      bep20Address: (activeDepositWallet() && activeDepositWallet().address) || db.settings.bep20Address,
      bep20Network: "BEP20",
      depositWalletName: (activeDepositWallet() && activeDepositWallet().name) || "الخزينة",
      depositWalletPlatform: (activeDepositWallet() && activeDepositWallet().platform) || "",
      depositEnabled: db.settings.depositEnabled !== false,
      withdrawEnabled: db.settings.withdrawEnabled !== false,
      minDeposit: db.settings.minDeposit,
      minWithdraw: Number(db.settings.minWithdraw || 0),
      withdrawFee: Number(db.settings.withdrawFee || 0),
      depositFeePct: Number(db.settings.depositFeePct || 0),
      withdrawFeePct: Number(db.settings.withdrawFeePct || 0),
      transferFeePct: Number(db.settings.transferFeePct || 0),
      requireKycForTrade: !!db.settings.requireKycForTrade,
      requireKycForAd: !!db.settings.requireKycForAd,
      requireKycForDeposit: !!db.settings.requireKycForDeposit,
      requireKycForWithdraw: db.settings.requireKycForWithdraw !== false,
      requireMerchantForAd: db.settings.requireMerchantForAd !== false,
      advancedKycUsdt: Number(db.settings.advancedKycUsdt || 2000),
      priceRanges: publicPriceRanges(),
      featuredWeeklyTrades: Number(db.settings.featuredWeeklyTrades || 50),
      featuredHoldDays: Number(db.settings.featuredHoldDays || 3),
      verifiedMerchantVolumeUsdt: Number(db.settings.verifiedMerchantVolumeUsdt || 1500),
      supportTelegramId: String(db.settings.supportTelegramId || ""),
      supportTelegramUsername: String(db.settings.supportTelegramUsername || "").replace(/^@/, ""),
      requirePaymentProof: db.settings.requirePaymentProof !== false,
      telegramAuth: !!telegramBotToken(),
      pricing: publicPricingSettings(),
      appEnabled: db.settings.appEnabled !== false,
      appDisabledMessage: String(db.settings.appDisabledMessage || "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً.")
    }
  });
});

app.get("/api/pricing", optionalAuth, async (req, res) => {
  const asset = String(req.query.asset || "USDT").toUpperCase();
  const fiat = String(req.query.fiat || "SYP").toUpperCase();
  try {
    const quote = await priceEngine.quoteFor(db.settings, asset, fiat);
    res.json({
      pricing: publicPricingSettings(),
      quote: priceEngine.publicQuote(quote)
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "تعذر حساب السعر" });
  }
});

const DEMO_LOGINS = new Set(["demo", "merchant", "buyer"]);

function rejectDemo(user) {
  return !!(user && user.isDemo && !user.isAdmin);
}

app.post("/api/auth/register", (req, res) => {
  const { username, email, password, displayName, acceptTerms } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبة" });
  }
  if (!acceptTerms) {
    return res.status(400).json({ error: "يجب الموافقة على شروط الاستخدام وسياسة الخصوصية" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
  }
  const uname = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(uname) || DEMO_LOGINS.has(uname) || uname === "admin" || uname === "ameralzman00") {
    return res.status(400).json({ error: "اسم مستخدم غير صالح. استخدم 3 إلى 24 حرفاً إنجليزياً أو رقماً." });
  }
  const mail = String(email || `${uname}@user.p2p`).trim().toLowerCase();
  if (db.users.find((u) => u.username === uname)) {
    return res.status(400).json({ error: "اسم المستخدم مستخدم مسبقاً" });
  }
  if (db.users.find((u) => u.email === mail)) {
    return res.status(400).json({ error: "البريد مستخدم مسبقاً" });
  }
  const p = hashPassword(password);
  const user = {
    id: uid("u"),
    username: uname,
    email: mail,
    displayName: String(displayName || uname).trim().slice(0, 40) || uname,
    passwordHash: p.hash,
    passwordSalt: p.salt,
    telegramId: null,
    telegramUsername: null,
    isMerchant: false,
    merchantStatus: "none",
    isAdmin: false,
    isDemo: false,
    kycStatus: "pending",
    kycLevel: "none",
    kyc: null,
    rating: 100,
    completedTrades: 0,
    createdAt: now(),
    acceptedTermsAt: now(),
    uidCode: nextUidCode()
  };
  db.users.push(user);
  getAssets(true).forEach((asset) => {
    db.wallets.push({
      userId: user.id,
      asset: asset.symbol,
      available: 0,
      frozen: 0
    });
  });
  const token = createSession(user.id);
  notify(user.id, "مرحباً بك في USDT شام", "تم إنشاء حسابك. أكمل توثيق KYC ثم أودع عبر BEP20 لبدء التداول.");
  save();
  res.json({ token, user: publicUser(user) });
});

function dayKey(ts) {
  const d = new Date(ts || now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function totpDayVerified(user) {
  return !!(user && user.totpEnabled && user.totpDayVerified === dayKey());
}

function requireTotpCode(user, code, { requiredIfEnabled = true } = {}) {
  if (!user || !user.totpEnabled) {
    if (requiredIfEnabled) return null;
    return "فعّل تطبيق المصادقة من الحساب أولاً";
  }
  if (!code) return "أدخل رمز تطبيق المصادقة";
  if (!verifyTotp(user.totpSecret, code)) return "رمز تطبيق المصادقة غير صحيح";
  return null;
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "بيانات ناقصة" });
  const key = String(username).trim().toLowerCase();
  const user = db.users.find((u) => u.username === key || u.email === key);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }
  if (rejectDemo(user) || DEMO_LOGINS.has(key)) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }
  const token = createSession(user.id);
  res.json({
    token,
    user: publicUser(user),
    frozen: !!(user.accountFrozen || user.fundsFrozen),
    totpDayRequired: !!(user.totpEnabled && !totpDayVerified(user))
  });
});

app.post("/api/me/totp/verify-day", auth, (req, res) => {
  if (!req.user.totpEnabled) {
    return res.status(400).json({ error: "تطبيق المصادقة غير مفعّل" });
  }
  if (totpDayVerified(req.user)) {
    return res.json({ user: publicUser(req.user), totpDayRequired: false });
  }
  const err = requireTotpCode(req.user, (req.body || {}).code);
  if (err) return res.status(401).json({ error: err, totpRequired: true });
  req.user.totpDayVerified = dayKey();
  save();
  res.json({ user: publicUser(req.user), totpDayRequired: false });
});

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(String(initData || ""));
  const hash = params.get("hash");
  if (!hash || !botToken) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const check = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (check !== hash) return null;
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

app.post("/api/auth/telegram", (req, res) => {
  const botToken = telegramBotToken();
  if (!botToken) {
    return res.status(503).json({ error: "الدخول عبر تلغرام غير مفعّل على الخادم حالياً. استخدم اسم المستخدم من الموقع أو أعد تشغيل الـ API مع توكن البوت." });
  }
  const tgUser = verifyTelegramInitData(req.body && req.body.initData, botToken);
  if (!tgUser || !tgUser.id) return res.status(401).json({ error: "جلسة تلغرام غير صالحة. افتح المنصة من زر البوت داخل تلغرام." });
  const body = req.body || {};
  const action = String(body.action || "auto");
  const existing = findUserByTelegramId(tgUser.id);
  if (action === "status") {
    return res.json({
      linked: !!existing,
      needsChoice: !existing
    });
  }
  let user = null;
  if (action === "login" || action === "link") {
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !password) return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان لربط الحساب." });
    const target = db.users.find((u) => u.username === username || u.email === username);
    if (!target || !verifyPassword(password, target.passwordSalt, target.passwordHash)) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }
    if (rejectDemo(target) || DEMO_LOGINS.has(username)) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }
    bindTelegramToUser(target, tgUser);
    save();
    user = target;
  } else if (action === "create") {
    if (existing) {
      user = existing;
    } else {
      user = createUserFromTelegram(tgUser);
    }
  } else {
    user = existing || null;
    if (!user) {
      return res.json({ needsChoice: true, linked: false });
    }
  }
  if (!user) return res.status(401).json({ error: "تعذر إنشاء الحساب من تلغرام" });
  if (rejectDemo(user)) return res.status(401).json({ error: "الحسابات التجريبية غير متاحة" });
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user), linked: true, needsChoice: false });
});

app.post("/api/auth/telegram-link", auth, (req, res) => {
  const botToken = telegramBotToken();
  if (!botToken) return res.status(503).json({ error: "الدخول عبر تلغرام غير مفعّل." });
  const tgUser = verifyTelegramInitData(req.body && req.body.initData, botToken);
  if (!tgUser || !tgUser.id) return res.status(401).json({ error: "جلسة تلغرام غير صالحة." });
  bindTelegramToUser(req.user, tgUser);
  save();
  res.json({ token: req.token, user: publicUser(req.user), linked: true });
});

app.post("/api/auth/logout", auth, (req, res) => {
  db.sessions = db.sessions.filter((s) => s.token !== req.token);
  const mine = supportTickets().filter((t) => t.userId === req.user.id);
  mine.forEach((t) => deleteSupportTicket(t));
  save();
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

const DISPLAY_NAME_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;

app.post("/api/me/avatar", auth, (req, res) => {
  const data = (req.body || {}).data;
  if (!data) return res.status(400).json({ error: "اختر صورة أولاً" });
  try {
    const saved = avatarStore.saveAvatar(req.user.id, data);
    req.user.avatar = { storedName: saved.storedName, mime: saved.mime, updatedAt: now() };
    save();
    res.json({ user: publicUser(req.user) });
  } catch (e) {
    res.status(400).json({ error: e.message || "تعذر حفظ الصورة" });
  }
});

app.delete("/api/me/avatar", auth, (req, res) => {
  avatarStore.removeAvatar(req.user.id);
  req.user.avatar = null;
  save();
  res.json({ user: publicUser(req.user) });
});

app.get("/api/users/:id/avatar", (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u || !u.avatar || !u.avatar.storedName) return res.status(404).end();
  try {
    const abs = avatarStore.fileAbsPath(u.id, u.avatar.storedName);
    if (!require("fs").existsSync(abs)) return res.status(404).end();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type(u.avatar.mime || "image/jpeg");
    res.sendFile(abs);
  } catch {
    res.status(404).end();
  }
});

app.put("/api/me", auth, (req, res) => {
  const { displayName } = req.body || {};
  if (displayName == null) return res.json({ user: publicUser(req.user) });
  const next = String(displayName).trim().slice(0, 40);
  if (!next) return res.status(400).json({ error: "الاسم الظاهر مطلوب" });
  if (next === req.user.displayName) return res.json({ user: publicUser(req.user) });
  const last = Number(req.user.displayNameChangedAt || 0);
  const until = last ? last + DISPLAY_NAME_COOLDOWN_MS : 0;
  if (last && now() < until) {
    const days = Math.max(1, Math.ceil((until - now()) / (24 * 60 * 60 * 1000)));
    return res.status(400).json({ error: `يمكن تغيير الاسم الظاهر مرة كل 60 يوماً. المتبقي تقريباً ${days} يوماً.` });
  }
  req.user.displayName = next;
  req.user.displayNameChangedAt = now();
  save();
  res.json({ user: publicUser(req.user) });
});

app.post("/api/me/totp/setup", auth, (req, res) => {
  if (req.user.totpEnabled) {
    return res.status(400).json({ error: "تطبيق المصادقة مفعّل مسبقاً" });
  }
  const secret = generateTotpSecret();
  req.user.totpPendingSecret = secret;
  save();
  const account = req.user.username || req.user.uidCode || "user";
  res.json({
    secret,
    secretGrouped: formatSecretGroups(secret),
    otpauth: otpauthUrl(secret, account)
  });
});

app.post("/api/me/totp/enable", auth, (req, res) => {
  const { code } = req.body || {};
  const pending = req.user.totpPendingSecret;
  if (!pending) return res.status(400).json({ error: "ابدأ إعداد المصادقة أولاً" });
  if (!verifyTotp(pending, code)) return res.status(400).json({ error: "رمز التحقق غير صحيح. أعد المحاولة." });
  req.user.totpSecret = pending;
  req.user.totpEnabled = true;
  req.user.totpPendingSecret = null;
  save();
  res.json({ user: publicUser(req.user) });
});

app.post("/api/me/password", auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "أدخل كلمة المرور الحالية والجديدة" });
  }
  if (!verifyPassword(currentPassword, req.user.passwordSalt, req.user.passwordHash)) {
    return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
  }
  try {
    setUserPassword(req.user, newPassword);
  } catch (e) {
    return res.status(400).json({ error: e.message || "تعذر حفظ كلمة المرور" });
  }
  db.sessions = (db.sessions || []).filter((s) => s.userId !== req.user.id || s.token === req.token);
  save();
  res.json({ user: publicUser(req.user) });
});

app.post("/api/me/trade-pin", auth, (req, res) => {
  const { pin, currentPin, password } = req.body || {};
  try {
    if (hasTradePin(req.user)) {
      const passOk = !!(password && req.user.passwordHash && verifyPassword(password, req.user.passwordSalt, req.user.passwordHash));
      if (!passOk) {
        const pinErr = assertTradePin(req.user, currentPin);
        if (pinErr) return res.status(401).json({ error: pinErr, tradePinRequired: true });
      }
    }
    setTradePin(req.user, pin);
    save();
    res.json({ user: publicUser(req.user) });
  } catch (e) {
    res.status(400).json({ error: e.message || "تعذر حفظ رمز التحرير" });
  }
});

app.post("/api/me/totp/disable", auth, (req, res) => {
  const { code, password } = req.body || {};
  if (!req.user.totpEnabled) return res.status(400).json({ error: "المصادقة غير مفعّلة" });
  const passOk = password && verifyPassword(password, req.user.passwordSalt, req.user.passwordHash);
  const codeOk = verifyTotp(req.user.totpSecret, code);
  if (!passOk && !codeOk) {
    return res.status(401).json({ error: "أدخل كلمة المرور أو رمزاً صحيحاً من التطبيق" });
  }
  req.user.totpEnabled = false;
  req.user.totpSecret = null;
  req.user.totpPendingSecret = null;
  save();
  res.json({ user: publicUser(req.user) });
});

app.get("/api/wallet", auth, async (req, res) => {
  const enabled = getAssets(true).map((a) => a.symbol);
  enabled.forEach((symbol) => getWallet(req.user.id, symbol));
  const wallets = db.wallets.filter((w) => w.userId === req.user.id && enabled.includes(w.asset));
  const rates = await marketPrices.refresh();
  const priced = wallets.map((w) => {
    const avail = Number(w.available || 0);
    const frozen = Number(w.frozen || 0);
    const usdPrice = marketPrices.usdRate(w.asset, rates);
    return {
      ...w,
      usdPrice,
      usdValue: (avail + frozen) * usdPrice
    };
  });
  const totalUsdt = priced.reduce((s, w) => s + Number(w.usdValue || 0), 0);
  res.json({
    wallets: priced,
    uidCode: req.user.uidCode || "",
    prices: rates,
    totalUsdt,
    pricesAt: marketPrices.updatedAt()
  });
});

app.get("/api/users/lookup", auth, (req, res) => {
  const q = String(req.query.q || "").trim();
  const found = findUserByUid(q);
  if (!found) return res.status(404).json({ error: "لا يوجد مستخدم بهذا الرقم أو الاسم" });
  if (found.id === req.user.id) return res.status(400).json({ error: "لا يمكن التحويل لنفسك" });
  if (sandboxMismatch(req.user, found)) {
    return res.status(404).json({ error: "لا يوجد مستخدم بهذا الرقم أو الاسم" });
  }
  res.json({
    user: {
      uidCode: found.uidCode,
      username: found.username,
      displayName: found.displayName
    }
  });
});

app.get("/api/transfers", auth, (req, res) => {
  const items = (db.transfers || []).filter((t) => t.fromId === req.user.id || t.toId === req.user.id);
  res.json({
    transfers: items.map((t) => ({
      ...t,
      from: publicUser(db.users.find((u) => u.id === t.fromId)),
      to: publicUser(db.users.find((u) => u.id === t.toId)),
      direction: t.fromId === req.user.id ? "out" : "in"
    }))
  });
});

app.post("/api/transfers", auth, (req, res) => {
  const frozenErr = freezeRestriction(req.user, "transfer");
  if (frozenErr) return res.status(403).json({ error: frozenErr });
  const kycErr = requireKyc(req.user, "withdraw");
  if (kycErr) return res.status(403).json({ error: kycErr });
  const { to, asset, amount, note, tradePin } = req.body || {};
  const pinErr = assertTradePin(req.user, tradePin);
  if (pinErr) return res.status(403).json({ error: pinErr, tradePinRequired: true });
  const coin = getAssets().find((x) => x.symbol === asset && x.enabled);
  if (!coin) return res.status(400).json({ error: "عملة غير مدعومة" });
  const a = Number(amount);
  if (!(a > 0) || a > 1e7) return res.status(400).json({ error: "مبلغ غير صالح" });
  const target = findUserByUid(to);
  if (!target || sandboxMismatch(req.user, target)) {
    return res.status(404).json({ error: "المستلم غير موجود. أدخل رقم UID أو اسم المستخدم." });
  }
  if (target.id === req.user.id) return res.status(400).json({ error: "لا يمكن التحويل لنفسك" });
  const feePct = Number(db.settings.transferFeePct || 0);
  const fee = calcPctFee(a, feePct);
  const total = a + fee;
  if (!debit(req.user.id, coin.symbol, total)) {
    return res.status(400).json({ error: fee > 0 ? `رصيد غير كافٍ. المطلوب ${total} ${coin.symbol} (يشمل عمولة ${feePct}%)` : "رصيد غير كافٍ" });
  }
  credit(target.id, coin.symbol, a);
  const transfer = {
    id: uid("tr"),
    fromId: req.user.id,
    toId: target.id,
    asset: coin.symbol,
    amount: a,
    fee,
    feePct,
    total,
    note: String(note || "").trim().slice(0, 120),
    createdAt: now()
  };
  db.transfers.unshift(transfer);
  notify(req.user.id, "تحويل داخلي", `أرسلت ${a} ${coin.symbol} إلى UID ${target.uidCode} (${target.displayName})${fee > 0 ? ` · عمولة ${fee}` : ""}`, { transferId: transfer.id });
  notify(target.id, "استلام داخلي", `وصلك ${a} ${coin.symbol} من UID ${req.user.uidCode} (${req.user.displayName})`, { transferId: transfer.id });
  save();
  res.json({
    transfer,
    to: { uidCode: target.uidCode, username: target.username, displayName: target.displayName }
  });
});

app.get("/api/deposits", auth, (req, res) => {
  const items = db.deposits.filter((d) => d.userId === req.user.id);
  res.json({ deposits: items });
});

app.post("/api/deposits", auth, (req, res) => {
  const frozenErr = freezeRestriction(req.user, "deposit");
  if (frozenErr) return res.status(403).json({ error: frozenErr });
  const kycErr = requireKyc(req.user, "deposit");
  if (kycErr) return res.status(403).json({ error: kycErr });
  if (db.settings.depositEnabled === false) return res.status(403).json({ error: "الإيداع متوقف حالياً" });
  const { asset, amount, txHash, fromAddress } = req.body || {};
  const coin = getAssets().find((x) => x.symbol === asset && x.depositEnabled);
  if (!coin) return res.status(400).json({ error: "عملة الإيداع غير مدعومة على BEP20" });
  const a = Number(amount);
  if (!(a > 0) || a > 1e7) return res.status(400).json({ error: "مبلغ غير صالح" });
  if (a < Number(db.settings.minDeposit || 0)) {
    return res.status(400).json({ error: `الحد الأدنى للإيداع ${db.settings.minDeposit} ${asset}` });
  }
  if (!isValidTxHash(txHash)) return res.status(400).json({ error: "هاش المعاملة غير صالح (BEP20 0x... 64)" });
  const hash = String(txHash).trim();
  if (db.deposits.find((d) => d.txHash.toLowerCase() === hash.toLowerCase())) {
    return res.status(400).json({ error: "هذا الهاش مستخدم مسبقاً" });
  }
  if (fromAddress && !isValidAddress(fromAddress)) {
    return res.status(400).json({ error: "عنوان المحفظة المرسلة غير صالح" });
  }
  const feePct = Number(db.settings.depositFeePct || 0);
  const fee = calcPctFee(a, feePct);
  const netAmount = a - fee;
  if (!(netAmount > 0)) return res.status(400).json({ error: "المبلغ بعد عمولة الإيداع غير صالح" });
  const deposit = {
    id: uid("dep"),
    userId: req.user.id,
    asset: coin.symbol,
    network: "BEP20",
    amount: a,
    fee,
    feePct,
    netAmount,
    txHash: hash,
    fromAddress: fromAddress ? String(fromAddress).trim() : "",
    toAddress: (activeDepositWallet() && activeDepositWallet().address) || db.settings.bep20Address,
    treasuryWalletId: (activeDepositWallet() && activeDepositWallet().id) || "",
    treasuryWalletName: (activeDepositWallet() && activeDepositWallet().name) || "الخزينة",
    treasuryWalletPlatform: (activeDepositWallet() && activeDepositWallet().platform) || "",
    status: "pending",
    note: "",
    createdAt: now(),
    reviewedAt: null,
    reviewedBy: null
  };
  db.deposits.unshift(deposit);
  if (isDemoUser(req.user)) {
    credit(req.user.id, deposit.asset, deposit.netAmount);
    deposit.status = "credited";
    deposit.reviewedAt = now();
    deposit.note = "قيد تجريبي تلقائي — لا يراجع المدير";
    notify(req.user.id, "إيداع تجريبي", `أُضيف ${deposit.netAmount} ${asset} في صندوق العرض فقط.`);
  } else {
    notify(req.user.id, "طلب إيداع BEP20", `بانتظار مراجعة الإدارة: ${a} ${asset}`);
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "إيداع جديد", `${req.user.username} أرسل ${a} ${asset}`, { depositId: deposit.id, href: "/admin?tab=deposits" });
    });
  }
  save();
  res.json({ deposit });
});

app.get("/api/withdrawals", auth, (req, res) => {
  const items = db.withdrawals.filter((w) => w.userId === req.user.id);
  res.json({ withdrawals: items });
});

app.post("/api/withdrawals", auth, (req, res) => {
  const frozenErr = freezeRestriction(req.user, "withdraw");
  if (frozenErr) return res.status(403).json({ error: frozenErr });
  const kycErr = requireKyc(req.user, "withdraw");
  if (kycErr) return res.status(403).json({ error: kycErr });
  if (db.settings.withdrawEnabled === false) return res.status(403).json({ error: "السحب متوقف حالياً" });
  const { asset, amount, toAddress, tradePin, totpCode } = req.body || {};
  const pinErr = assertTradePin(req.user, tradePin);
  if (pinErr) return res.status(403).json({ error: pinErr, tradePinRequired: true });
  if (req.user.totpEnabled) {
    const totpErr = requireTotpCode(req.user, totpCode);
    if (totpErr) return res.status(403).json({ error: totpErr, totpRequired: true });
  }
  const coin = getAssets().find((x) => x.symbol === asset && x.enabled);
  if (!coin) return res.status(400).json({ error: "عملة السحب غير مدعومة" });
  const a = Number(amount);
  if (!(a > 0) || a > 1e7) return res.status(400).json({ error: "مبلغ غير صالح" });
  const flatFee = Number(db.settings.withdrawFee || 0);
  const feePct = Number(db.settings.withdrawFeePct || 0);
  const pctFee = calcPctFee(a, feePct);
  const fee = flatFee + pctFee;
  const minW = Number(db.settings.minWithdraw || 0);
  if (a < minW) return res.status(400).json({ error: `الحد الأدنى للسحب ${minW} ${asset}` });
  if (!toAddress || !isValidAddress(toAddress)) {
    return res.status(400).json({ error: "عنوان محفظة الاستلام غير صالح (BEP20 0x...)" });
  }
  if (isPlatformTreasuryAddress(toAddress)) {
    return res.status(400).json({ error: "لا يمكن السحب إلى عنوان المنصة" });
  }
  const total = a + fee;
  const wallet = getWallet(req.user.id, coin.symbol);
  if (wallet.available < total - 1e-10) {
    return res.status(400).json({ error: `رصيد غير كافٍ. المطلوب ${total} ${asset} (يشمل الرسوم ${fee})` });
  }
  if (!freeze(req.user.id, coin.symbol, total)) {
    return res.status(400).json({ error: "تعذر حجز الرصيد للسحب" });
  }
  const withdrawal = {
    id: uid("wd"),
    userId: req.user.id,
    asset: coin.symbol,
    network: "BEP20",
    amount: a,
    fee,
    feePct,
    flatFee,
    total,
    toAddress: String(toAddress).trim(),
    fromAddress: (activeDepositWallet() && activeDepositWallet().address) || db.settings.bep20Address,
    treasuryWalletId: "",
    treasuryWalletName: "",
    treasuryWalletPlatform: "",
    status: "pending",
    note: "",
    txHash: "",
    createdAt: now(),
    reviewedAt: null,
    reviewedBy: null
  };
  db.withdrawals.unshift(withdrawal);
  if (isDemoUser(req.user)) {
    settleFrozen(req.user.id, withdrawal.asset, withdrawal.total);
    withdrawal.status = "completed";
    withdrawal.reviewedAt = now();
    withdrawal.note = "سحب تجريبي تلقائي — لا يراجع المدير";
    notify(req.user.id, "سحب تجريبي", `خُصم ${withdrawal.amount} ${coin.symbol} من صندوق العرض فقط.`);
  } else {
    notify(req.user.id, "طلب سحب", `بانتظار مراجعة الإدارة: ${a} ${coin.symbol} (رسوم ${fee})`);
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "طلب سحب جديد", `${req.user.username} يطلب سحب ${a} ${coin.symbol}`, { withdrawalId: withdrawal.id, href: "/admin?tab=withdrawals" });
    });
  }
  save();
  res.json({ withdrawal });
});

app.get("/api/payment-methods", auth, (req, res) => {
  res.json({
    methods: db.paymentMethods
      .filter((m) => m.userId === req.user.id)
      .map((m) => ({ ...m, details: publicPaymentDetails(m.details) }))
  });
});

app.post("/api/payment-methods", auth, (req, res) => {
  const { type, label, details } = req.body || {};
  if (!getPaymentTypes().find((p) => p.id === type)) {
    return res.status(400).json({ error: "طريقة دفع غير صالحة" });
  }
  if (req.user.kycStatus !== "verified" || !verifiedPaymentName(req.user)) {
    return res.status(403).json({ error: "وثّق هويتك أولاً. اسم المستلم يُثبَّت من الاسم الحقيقي في التوثيق ولا يمكن تغييره." });
  }
  const typeName = (getPaymentTypes().find((p) => p.id === type) || {}).name || type;
  if (existingPaymentMethod(req.user.id, type, db.paymentMethods)) {
    return res.status(400).json({ error: `لديك طريقة ${typeName} واحدة مسبقاً. عدّلها أو احذفها ثم أضف من جديد.` });
  }
  const normalized = normalizePaymentDetails(type, details, req.user);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const autoLabel =
    String(label || "").trim() ||
    `${getPaymentTypes().find((p) => p.id === type).name} ${normalized.details.address || normalized.details.account || ""}`.trim();
  const method = {
    id: uid("pm"),
    userId: req.user.id,
    type,
    label: autoLabel.slice(0, 80),
    details: normalized.details,
    active: true
  };
  db.paymentMethods.push(method);
  save();
  res.json({ method });
});

app.post("/api/payment-methods/:id", auth, (req, res) => {
  const method = db.paymentMethods.find((m) => m.id === req.params.id && m.userId === req.user.id);
  if (!method) return res.status(404).json({ error: "غير موجودة" });
  const body = req.body || {};
  if (body.remove) {
    const i = db.paymentMethods.findIndex((m) => m.id === method.id);
    if (i >= 0) db.paymentMethods.splice(i, 1);
    const stillHas = hasActivePaymentMethod(req.user.id, ["SHAM_CASH"], db.paymentMethods);
    if (!stillHas) {
      db.ads.filter((a) => a.userId === req.user.id && a.status === "active").forEach((ad) => {
        if (ad.side === "SELL" && ad.available > 0) unfreeze(req.user.id, ad.asset, ad.available);
        ad.status = "paused";
      });
    }
    save();
    return res.json({ ok: true, pausedAds: !stillHas });
  }
  if (typeof body.active === "boolean") method.active = body.active;
  if (typeof body.label === "string" && body.label.trim()) method.label = body.label.trim().slice(0, 80);
  if (body.details) {
    const normalized = normalizePaymentDetails(method.type, { ...method.details, ...body.details }, req.user);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    method.details = normalized.details;
  } else if (typeof body.address === "string" && body.address.trim()) {
    const normalized = normalizePaymentDetails(method.type, { address: body.address }, req.user);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    method.details = normalized.details;
  }
  save();
  res.json({ method: { ...method, details: publicPaymentDetails(method.details) } });
});

app.delete("/api/payment-methods/:id", auth, (req, res) => {
  const method = db.paymentMethods.find((m) => m.id === req.params.id && m.userId === req.user.id);
  if (!method) return res.status(404).json({ error: "غير موجودة" });
  const i = db.paymentMethods.findIndex((m) => m.id === method.id);
  if (i >= 0) db.paymentMethods.splice(i, 1);
  const stillHas = hasActivePaymentMethod(req.user.id, ["SHAM_CASH"], db.paymentMethods);
  if (!stillHas) {
    db.ads.filter((a) => a.userId === req.user.id && a.status === "active").forEach((ad) => {
      if (ad.side === "SELL" && ad.available > 0) unfreeze(req.user.id, ad.asset, ad.available);
      ad.status = "paused";
    });
  }
  save();
  res.json({ ok: true, pausedAds: !stillHas });
});

app.get("/api/ads", optionalAuth, (req, res) => {
  const { side, asset, fiat, payment, q, minRating } = req.query;
  let ads = db.ads.filter((a) => a.status === "active" && !adIsDemo(a));
  if (side) ads = ads.filter((a) => a.side === String(side).toUpperCase());
  if (asset) ads = ads.filter((a) => a.asset === String(asset).toUpperCase());
  if (fiat) ads = ads.filter((a) => a.fiat === String(fiat).toUpperCase());
  if (payment) ads = ads.filter((a) => a.paymentTypes.includes(String(payment).toUpperCase()));
  if (minRating) {
    ads = ads.filter((a) => {
      const u = db.users.find((x) => x.id === a.userId);
      return u && u.rating >= Number(minRating);
    });
  }
  if (q) {
    const s = String(q).toLowerCase();
    ads = ads.filter((a) => {
      const u = db.users.find((x) => x.id === a.userId);
      return (
        (u && (u.username.includes(s) || (u.displayName || "").toLowerCase().includes(s))) ||
        a.asset.toLowerCase().includes(s) ||
        a.fiat.toLowerCase().includes(s)
      );
    });
  }
  ads.sort((a, b) => {
    const da = merchantBadgeRank((enrichAd(a).owner || {}).merchantBadge);
    const dbadge = merchantBadgeRank((enrichAd(b).owner || {}).merchantBadge);
    if (da !== dbadge) return da - dbadge;
    if (a.side === "SELL") return a.price - b.price;
    return b.price - a.price;
  });
  res.json({ ads: ads.map(enrichAd) });
});

app.get("/api/ads/mine", auth, (req, res) => {
  res.json({ ads: db.ads.filter((a) => a.userId === req.user.id).map(enrichAd) });
});

app.get("/api/ads/:id", optionalAuth, (req, res) => {
  const ad = db.ads.find((a) => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: "الإعلان غير موجود" });
  if ((!req.user && adIsDemo(ad)) || (req.user && sandboxMismatch(req.user, db.users.find((u) => u.id === ad.userId)))) {
    return res.status(404).json({ error: "الإعلان غير موجود" });
  }
  res.json({ ad: enrichAd(ad) });
});

app.post("/api/ads", auth, async (req, res) => {
  const frozenErr = freezeRestriction(req.user, "ad");
  if (frozenErr) return res.status(403).json({ error: frozenErr });
  const kycErr = requireKyc(req.user, "ad");
  if (kycErr) return res.status(403).json({ error: kycErr });
  const merchantErr = requireMerchant(req.user);
  if (merchantErr) return res.status(403).json({ error: merchantErr });
  const { side, asset, fiat, minAmount, maxAmount, available, paymentTypes, terms, timeLimitMin } = req.body || {};
  if (!["BUY", "SELL"].includes(side)) return res.status(400).json({ error: "نوع الإعلان غير صالح" });
  if (!getAssets().find((x) => x.symbol === asset)) return res.status(400).json({ error: "أصل غير مدعوم" });
  if (!getFiats().find((x) => x.code === fiat)) return res.status(400).json({ error: "عملة فيات غير مدعومة" });
  let priced;
  try {
    priced = await resolvePostedPrice(req.body || {}, asset, fiat, side);
  } catch (e) {
    return res.status(400).json({ error: e.message || "سعر غير صالح" });
  }
  const p = Number(priced.price);
  const minA = Number(minAmount);
  const maxA = Number(maxAmount);
  const avail = Number(available);
  if (!(p > 0) || !(minA > 0) || !(maxA >= minA) || !(avail >= maxA)) {
    return res.status(400).json({ error: "حدود المبالغ أو السعر غير صالحة" });
  }
  const priceErr = validateAdPrice(asset, fiat, p, side);
  if (priceErr) return res.status(400).json({ error: priceErr });
  const pts = Array.isArray(paymentTypes) ? paymentTypes : [];
  if (!pts.length || pts.some((t) => !getPaymentTypes().find((x) => x.id === t))) {
    return res.status(400).json({ error: "اختر طريقة دفع واحدة على الأقل" });
  }
  if (!hasActivePaymentMethod(req.user.id, pts, db.paymentMethods)) {
    return res.status(400).json({ error: "أضف طريقة دفع شام كاش أولاً قبل نشر الإعلان. طريقة الدفع لا تتضمن رقم هاتف." });
  }
  if (side === "SELL") {
    if (!freeze(req.user.id, asset, avail)) {
      return res.status(400).json({ error: "رصيد غير كافٍ لتغطية الإعلان" });
    }
  }
  const ad = {
    id: uid("ad"),
    serial: nextAdSerial(),
    userId: req.user.id,
    side,
    asset,
    fiat,
    price: p,
    priceType: priced.priceType,
    floatRatio: priced.floatRatio,
    minAmount: minA,
    maxAmount: maxA,
    available: avail,
    paymentTypes: pts,
    terms: String(terms || "").slice(0, 500),
    timeLimitMin: Math.min(Math.max(Number(timeLimitMin) || 15, 5), 120),
    status: "active",
    isDemo: isDemoUser(req.user),
    createdAt: now()
  };
  db.ads.unshift(ad);
  notify(req.user.id, "تم نشر الإعلان", `إعلانك رقم #${ad.serial} ظاهر الآن في السوق.`, { adId: ad.id });
  save();
  res.json({ ad: enrichAd(ad) });
});

app.patch("/api/ads/:id", auth, async (req, res) => {
  const ad = db.ads.find((a) => a.id === req.params.id && (a.userId === req.user.id || req.user.isAdmin));
  if (!ad) return res.status(404).json({ error: "الإعلان غير موجود" });
  const body = req.body || {};
  let priced;
  try {
    priced = await resolvePostedPrice(
      {
        priceType: body.priceType !== undefined ? body.priceType : ad.priceType,
        floatRatio: body.floatRatio !== undefined ? body.floatRatio : ad.floatRatio,
        price: body.price !== undefined ? body.price : ad.price
      },
      ad.asset,
      ad.fiat,
      ad.side
    );
  } catch (e) {
    return res.status(400).json({ error: e.message || "سعر غير صالح" });
  }
  const price = Number(priced.price);
  const minAmount = body.minAmount === undefined ? ad.minAmount : Number(body.minAmount);
  const maxAmount = body.maxAmount === undefined ? ad.maxAmount : Number(body.maxAmount);
  const available = body.available === undefined ? ad.available : Number(body.available);
  if (!(price > 0) || !(minAmount > 0) || !(maxAmount >= minAmount) || !(available >= maxAmount)) {
    return res.status(400).json({ error: "حدود المبالغ أو السعر غير صالحة" });
  }
  const priceErr = validateAdPrice(ad.asset, ad.fiat, price, ad.side);
  if (priceErr) return res.status(400).json({ error: priceErr });
  let pts = ad.paymentTypes;
  if (body.paymentTypes !== undefined) {
    const list = Array.isArray(body.paymentTypes) ? body.paymentTypes : [];
    if (!list.length || list.some((t) => !getPaymentTypes().find((x) => x.id === t))) {
      return res.status(400).json({ error: "اختر طريقة دفع واحدة على الأقل" });
    }
    pts = list;
  }
  const nextStatus = body.status === undefined ? ad.status : String(body.status);
  if (!["active", "paused"].includes(nextStatus)) {
    return res.status(400).json({ error: "حالة الإعلان غير صالحة" });
  }
  if (ad.side === "SELL") {
    const wasActive = ad.status === "active";
    const willBeActive = nextStatus === "active";
    if (wasActive && willBeActive) {
      const diff = Math.round((available - ad.available) * 1e8) / 1e8;
      if (diff > 0 && !freeze(ad.userId, ad.asset, diff)) {
        return res.status(400).json({ error: "رصيد غير كافٍ لتغطية الكمية الجديدة" });
      }
      if (diff < 0) unfreeze(ad.userId, ad.asset, Math.abs(diff));
    } else if (wasActive && !willBeActive) {
      unfreeze(ad.userId, ad.asset, ad.available);
    } else if (!wasActive && willBeActive) {
      if (!freeze(ad.userId, ad.asset, available)) {
        return res.status(400).json({ error: "رصيد غير كافٍ لإعادة تفعيل الإعلان" });
      }
    }
  }
  ad.price = price;
  ad.priceType = priced.priceType;
  ad.floatRatio = priced.floatRatio;
  ad.minAmount = minAmount;
  ad.maxAmount = maxAmount;
  ad.available = available;
  ad.paymentTypes = pts;
  if (body.terms !== undefined) ad.terms = String(body.terms || "").slice(0, 500);
  if (body.timeLimitMin !== undefined) ad.timeLimitMin = Math.min(Math.max(Number(body.timeLimitMin) || 15, 5), 120);
  ad.status = nextStatus;
  ad.updatedAt = now();
  notify(ad.userId, "تم تعديل الإعلان", `حُدّث الإعلان #${ad.serial}.`, { adId: ad.id });
  save();
  res.json({ ad: enrichAd(ad) });
});

app.post("/api/ads/:id/toggle", auth, (req, res) => {
  const ad = db.ads.find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!ad) return res.status(404).json({ error: "الإعلان غير موجود" });
  if (ad.status === "active") {
    if (ad.side === "SELL" && ad.available > 0) unfreeze(req.user.id, ad.asset, ad.available);
    ad.status = "paused";
  } else if (ad.status === "paused") {
    if (ad.side === "SELL") {
      if (!freeze(req.user.id, ad.asset, ad.available)) {
        return res.status(400).json({ error: "رصيد غير كافٍ لإعادة تفعيل الإعلان" });
      }
    }
    ad.status = "active";
  }
  save();
  res.json({ ad: enrichAd(ad) });
});

app.delete("/api/ads/:id", auth, (req, res) => {
  const ad = db.ads.find((a) => a.id === req.params.id && (a.userId === req.user.id || req.user.isAdmin));
  if (!ad) return res.status(404).json({ error: "الإعلان غير موجود" });
  if (["closed", "deleted"].includes(ad.status)) return res.status(400).json({ error: "الإعلان محذوف مسبقاً" });
  const open = db.orders.some((o) => o.adId === ad.id && ["pending_payment", "paid", "disputed"].includes(o.status));
  if (open) return res.status(400).json({ error: "لا يمكن حذف إعلان عليه صفقات جارية أو نزاع. أنهِ الصفقات أولاً." });
  if (ad.side === "SELL" && ad.status === "active" && ad.available > 0) {
    unfreeze(ad.userId, ad.asset, ad.available);
  }
  ad.status = "closed";
  ad.available = 0;
  ad.updatedAt = now();
  notify(ad.userId, "حُذف الإعلان", `أُغلق الإعلان #${ad.serial} وأُعيد الرصيد المجمّد إن وُجد.`, { adId: ad.id });
  save();
  res.json({ ad: enrichAd(ad) });
});

app.post("/api/orders", auth, (req, res) => {
  const frozenErr = freezeRestriction(req.user, "trade");
  if (frozenErr) return res.status(403).json({ error: frozenErr });
  const kycErr = requireKyc(req.user, "trade");
  if (kycErr) return res.status(403).json({ error: kycErr });
  const { adId, amount, paymentType } = req.body || {};
  const ad = db.ads.find((a) => a.id === adId && a.status === "active");
  if (!ad) return res.status(404).json({ error: "الإعلان غير متاح" });
  if (adIsDemo(ad) !== isDemoUser(req.user)) {
    return res.status(404).json({ error: "الإعلان غير متاح" });
  }
  if (ad.userId === req.user.id) return res.status(400).json({ error: "لا يمكنك التداول مع إعلانك" });
  const qty = Number(amount);
  if (!(qty >= ad.minAmount) || qty > ad.maxAmount + 1e-12) {
    return res.status(400).json({ error: `المبلغ يجب أن يكون بين ${ad.minAmount} و ${ad.maxAmount}` });
  }
  if (qty > ad.available + 1e-12) return res.status(400).json({ error: "الكمية المتاحة غير كافية" });
  if (!ad.paymentTypes.includes(paymentType)) {
    return res.status(400).json({ error: "طريقة الدفع غير مدعومة في هذا الإعلان" });
  }
  const advErr = requireAdvancedKyc(req.user, qty);
  if (advErr) return res.status(403).json({ error: advErr });

  const live = liveAdQuote(ad);
  const tradePrice = live.price > 0 ? live.price : Number(ad.price);
  if (!(tradePrice > 0)) return res.status(400).json({ error: "تعذر حساب سعر الصفقة" });
  const priceErr = validateAdPrice(ad.asset, ad.fiat, tradePrice, ad.side);
  if (priceErr) return res.status(400).json({ error: priceErr });
  const fiatAmount = Math.round(qty * tradePrice * 100) / 100;

  let buyerId;
  let sellerId;
  if (ad.side === "SELL") {
    buyerId = req.user.id;
    sellerId = ad.userId;
  } else {
    buyerId = ad.userId;
    sellerId = req.user.id;
    if (!freeze(sellerId, ad.asset, qty)) {
      return res.status(400).json({ error: "رصيدك غير كافٍ لبيع هذه الكمية" });
    }
  }

  ad.available = Math.round((ad.available - qty) * 1e8) / 1e8;
  if (ad.available + 1e-12 < ad.minAmount) {
    if (ad.side === "SELL" && ad.available > 0) unfreeze(ad.userId, ad.asset, ad.available);
    ad.available = 0;
    ad.status = "filled";
  }
  const sellerUser = db.users.find((u) => u.id === sellerId);
  const buyerUser = db.users.find((u) => u.id === buyerId);
  const buyerLegalName = verifiedPaymentName(buyerUser);
  if (!buyerLegalName) {
    return res.status(400).json({ error: "المشتري يجب أن يكون موثّقاً باسم حقيقي قبل إنشاء الصفقة." });
  }
  const paySnap = sellerPaymentSnapshot(sellerUser, db.paymentMethods, paymentType || "SHAM_CASH");
  if (!paySnap.details.name || !paySnap.details.address) {
    return res.status(400).json({ error: "البائع لم يضف عنوان شام كاش نشطاً بعد. لا يمكن إنشاء الصفقة." });
  }
  const order = {
    id: uid("ord"),
    adId: ad.id,
    buyerId,
    sellerId,
    buyerLegalName,
    takerId: req.user.id,
    makerId: ad.userId,
    side: ad.side,
    asset: ad.asset,
    fiat: ad.fiat,
    price: tradePrice,
    amount: qty,
    fiatAmount,
    paymentType: paySnap.type,
    paymentDetails: publicPaymentDetails(paySnap.details),
    paymentLabel: paySnap.label,
    status: "pending_payment",
    createdAt: now(),
    expiresAt: now() + ad.timeLimitMin * 60 * 1000,
    paidAt: null,
    releasedAt: null,
    cancelledAt: null,
    disputeReason: null,
    disputeOpenedBy: null,
    disputedAt: null,
    evidence: [],
    isDemo: isDemoUser(req.user) || adIsDemo(ad)
  };
  db.orders.unshift(order);
  db.messages.push({
    id: uid("msg"),
    orderId: order.id,
    userId: "system",
    text: `تم إنشاء الصفقة. المشتري يحول ${fiatAmount} ${ad.fiat} خلال ${ad.timeLimitMin} دقيقة. يمكنكما الدردشة هنا داخل المنصة.`,
    createdAt: now()
  });
  notify(buyerId, "صفقة جديدة", `اشتريت ${qty} ${ad.asset} مقابل ${fiatAmount} ${ad.fiat}`, { orderId: order.id });
  notify(sellerId, "صفقة جديدة", `بيع ${qty} ${ad.asset} مقابل ${fiatAmount} ${ad.fiat} · المشتري: ${buyerLegalName}`, { orderId: order.id });
  save();
  res.json({ order: enrichOrder(order) });
});

app.get("/api/orders", auth, (req, res) => {
  const { status } = req.query;
  let orders = db.orders.filter((o) => o.buyerId === req.user.id || o.sellerId === req.user.id);
  if (status === "open") {
    orders = orders.filter((o) => ["pending_payment", "paid", "disputed"].includes(o.status));
  } else if (status) {
    orders = orders.filter((o) => o.status === status);
  }
  res.json({ orders: orders.map(enrichOrder) });
});

function messageAuthor(m, order) {
  if (!m || m.userId === "system") return { fromName: "النظام", fromRole: "system" };
  if (m.userId === order.buyerId) {
    const u = db.users.find((x) => x.id === m.userId);
    return { fromName: (u && (verifiedPaymentName(u) || u.displayName || u.username)) || "المشتري", fromRole: "buyer" };
  }
  if (m.userId === order.sellerId) {
    const u = db.users.find((x) => x.id === m.userId);
    return { fromName: (u && (u.displayName || u.username)) || "البائع", fromRole: "seller" };
  }
  const u = db.users.find((x) => x.id === m.userId);
  if (u && u.isAdmin) return { fromName: "الإدارة", fromRole: "admin" };
  return { fromName: (u && (u.displayName || u.username)) || "مستخدم", fromRole: "user" };
}

function enrichMessage(m, order) {
  const author = messageAuthor(m, order);
  if (!m || m.userId === "system") return { ...m, ...author };
  const guarded = sanitizeChatText(m.text || "");
  return { ...m, text: guarded.flagged ? guarded.text : m.text, ...author };
}

app.get("/api/orders/:id", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "الصفقة غير موجودة" });
  if (order.buyerId !== req.user.id && order.sellerId !== req.user.id && !(req.user.isAdmin && !orderIsDemo(order))) {
    return res.status(403).json({ error: "غير مصرح" });
  }
  const messages = db.messages.filter((m) => m.orderId === order.id).map((m) => enrichMessage(m, order));
  res.json({ order: enrichOrder(order), messages });
});

app.post("/api/orders/:id/paid", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  if (order.buyerId !== req.user.id) return res.status(403).json({ error: "المشتري فقط يؤكد الدفع" });
  if (order.status !== "pending_payment") return res.status(400).json({ error: "لا يمكن تأكيد الدفع في هذه الحالة" });
  if (now() > order.expiresAt) {
    expireOrder(order);
    save();
    return res.status(400).json({ error: "انتهى وقت الدفع وألغيت الصفقة" });
  }
  if (db.settings.requirePaymentProof !== false && !evidenceStore.hasPaymentProof(order.evidence)) {
    const files = req.body && req.body.files;
    if (!Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: "ارفع صورة إثبات الدفع قبل تأكيد اكتمال الدفع" });
    }
    try {
      const saved = evidenceStore.saveFiles(order.id, req.user.id, files.map((f) => ({ ...f, kind: "payment_proof" })));
      order.evidence = [...(order.evidence || []), ...saved];
    } catch (e) {
      return res.status(400).json({ error: e.message || "تعذر حفظ إثبات الدفع" });
    }
  }
  order.status = "paid";
  order.paidAt = now();
  db.messages.push({
    id: uid("msg"),
    orderId: order.id,
    userId: "system",
    text: "أكد المشتري أنه دفع وأرفق إثبات التحويل. يرجى من البائع التحقق ثم الإفراج عن العملة.",
    createdAt: now()
  });
  notify(order.sellerId, "تم الدفع", `المشتري ${order.buyerLegalName || verifiedPaymentName(db.users.find((u) => u.id === order.buyerId)) || ""} أكد دفع صفقة ${order.id} مع إثبات. طابق الاسم مع إيصال شام كاش قبل الإفراج.`, { orderId: order.id });
  save();
  res.json({ order: enrichOrder(order) });
});

app.post("/api/orders/:id/evidence", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  const isParty = order.buyerId === req.user.id || order.sellerId === req.user.id;
  if (!isParty && !(req.user.isAdmin && !orderIsDemo(order))) return res.status(403).json({ error: "غير مصرح" });
  const kind = String((req.body && req.body.kind) || "");
  const allowed = req.user.isAdmin && !orderIsDemo(order)
    ? ["payment_proof", "dispute_video", "dispute_image"]
    : order.status === "disputed"
      ? ["dispute_video", "dispute_image", "payment_proof"]
      : order.buyerId === req.user.id && order.status === "pending_payment"
        ? ["payment_proof"]
        : [];
  if (!allowed.includes(kind)) return res.status(400).json({ error: "لا يمكن رفع هذا النوع في الحالة الحالية" });
  const files = (req.body && req.body.files) || [];
  if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: "ارفع ملفاً واحداً على الأقل" });
  let saved;
  try {
    saved = evidenceStore.saveFiles(order.id, req.user.id, files.map((f) => ({ ...f, kind })));
  } catch (e) {
    return res.status(400).json({ error: e.message || "تعذر حفظ الملف" });
  }
  order.evidence = [...(order.evidence || []), ...saved];
  db.messages.push({
    id: uid("msg"),
    orderId: order.id,
    userId: "system",
    text: `أُرفق ${evidenceStore.kindLabel(kind)} بواسطة ${req.user.displayName || req.user.username}.`,
    createdAt: now()
  });
  notify(counterparty(order, req.user.id), "مرفق جديد", evidenceStore.kindLabel(kind), { orderId: order.id });
  if (order.status === "disputed" && !orderIsDemo(order)) {
    db.users.filter((u) => u.isAdmin).forEach((a) => {
      notify(a.id, "مرفق نزاع", `${req.user.username} رفع ${evidenceStore.kindLabel(kind)} على صفقة ${order.id.slice(-8)}`, { orderId: order.id, href: `/admin?tab=orders&order=${order.id}` });
    });
  }
  save();
  res.json({ order: enrichOrder(order) });
});

app.get("/api/orders/:id/evidence/:fileId", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  if (order.buyerId !== req.user.id && order.sellerId !== req.user.id && !(req.user.isAdmin && !orderIsDemo(order))) {
    return res.status(403).json({ error: "غير مصرح" });
  }
  const file = evidenceStore.findFile(order.evidence, req.params.fileId);
  if (!file) return res.status(404).json({ error: "الملف غير موجود" });
  try {
    const buf = evidenceStore.readFile(order.id, file);
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name || file.storedName)}"`);
    res.setHeader("Cache-Control", "private, max-age=120");
    res.send(buf);
  } catch {
    res.status(404).json({ error: "تعذر قراءة الملف" });
  }
});

app.post("/api/orders/:id/release", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  if (orderIsDemo(order) && req.user.isAdmin && order.sellerId !== req.user.id) {
    return res.status(403).json({ error: "الصفقات التجريبية للعرض فقط ولا يتدخل المدير فيها" });
  }
  if (order.sellerId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: "البائع فقط يفرج عن العملة" });
  }
  if (!["paid", "disputed"].includes(order.status)) {
    return res.status(400).json({ error: "لا يمكن الإفراج في هذه الحالة" });
  }
  const adminIntervene = req.user.isAdmin && order.sellerId !== req.user.id;
  if (!adminIntervene) {
    const pinErr = assertTradePin(req.user, (req.body || {}).tradePin);
    if (pinErr) return res.status(403).json({ error: pinErr, tradePinRequired: true });
  }
  if (!releaseFrozenTo(order.sellerId, order.buyerId, order.asset, order.amount)) {
    return res.status(400).json({ error: "فشل الإفراج عن الرصيد المجمّد" });
  }
  order.status = "completed";
  order.releasedAt = now();
  completeTradeStats(order);
  db.messages.push({
    id: uid("msg"),
    orderId: order.id,
    userId: "system",
    text: `تم الإفراج عن ${order.amount} ${order.asset} إلى محفظة المشتري. الصفقة مكتملة.`,
    createdAt: now()
  });
  notify(order.buyerId, "تم الإفراج", `استلمت ${order.amount} ${order.asset}`, { orderId: order.id });
  notify(order.sellerId, "صفقة مكتملة", `أتممت بيع ${order.amount} ${order.asset}`, { orderId: order.id });
  save();
  res.json({ order: enrichOrder(order) });
});

app.post("/api/orders/:id/cancel", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  const isParty = order.buyerId === req.user.id || order.sellerId === req.user.id;
  const demoOrder = orderIsDemo(order);
  if (demoOrder && req.user.isAdmin && !isParty) {
    return res.status(403).json({ error: "الصفقات التجريبية للعرض فقط ولا يتدخل المدير فيها" });
  }
  if (!isParty && !req.user.isAdmin) return res.status(403).json({ error: "غير مصرح" });
  if (order.status === "paid" && !req.user.isAdmin) {
    return res.status(400).json({ error: "بعد تأكيد الدفع لا يُلغى الطلب إلا عبر نزاع ثم قرار الإدارة" });
  }
  if (order.status === "disputed" && !(req.user.isAdmin || (demoOrder && isParty))) {
    return res.status(400).json({ error: "النزاع يُغلق من الإدارة فقط (إفراج للمشتري أو إلغاء وإعادة الرصيد)" });
  }
  if (order.status !== "pending_payment" && !(req.user.isAdmin || (demoOrder && isParty))) {
    return res.status(400).json({ error: "لا يمكن الإلغاء في هذه الحالة" });
  }
  cancelOrder(order, req.user.id);
  save();
  res.json({ order: enrichOrder(order) });
});

app.post("/api/orders/:id/dispute", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  if (order.buyerId !== req.user.id && order.sellerId !== req.user.id) {
    return res.status(403).json({ error: "غير مصرح" });
  }
  if (!["pending_payment", "paid"].includes(order.status)) {
    return res.status(400).json({ error: "لا يمكن فتح نزاع في هذه الحالة" });
  }
  const reason = String((req.body && req.body.reason) || "").trim().slice(0, 400);
  if (!reason) return res.status(400).json({ error: "اختر سبب النزاع" });
  order.status = "disputed";
  order.disputeReason = reason;
  order.disputeOpenedBy = req.user.id;
  order.disputedAt = now();
  db.messages.push({
    id: uid("msg"),
    orderId: order.id,
    userId: "system",
    text: orderIsDemo(order)
      ? `فُتح نزاع تجريبي بواسطة ${req.user.displayName || req.user.username}: ${reason}. الحساب التجريبي للعرض فقط ولا يتدخل المدير.`
      : `فُتح نزاع بواسطة ${req.user.displayName || req.user.username}: ${reason}. العملة تبقى في الضمان حتى قرار الإدارة.`,
    createdAt: now()
  });
  notify(counterparty(order, req.user.id), "نزاع على صفقة", `فُتح نزاع: ${reason}`, { orderId: order.id });
  if (!orderIsDemo(order)) {
    db.users.filter((u) => u.isAdmin).forEach((a) => notify(a.id, "نزاع جديد", `${req.user.username} فتح نزاعاً على صفقة ${order.id.slice(-8)}: ${reason}`, { orderId: order.id, href: `/admin?tab=orders&order=${order.id}` }));
  }
  save();
  res.json({ order: enrichOrder(order) });
});

app.post("/api/orders/:id/messages", auth, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "غير موجودة" });
  if (order.buyerId !== req.user.id && order.sellerId !== req.user.id && !(req.user.isAdmin && !orderIsDemo(order))) {
    return res.status(403).json({ error: "غير مصرح" });
  }
  const raw = String((req.body && req.body.text) || "").trim().slice(0, 1000);
  if (!raw) return res.status(400).json({ error: "الرسالة فارغة" });
  const guarded = sanitizeChatText(raw);
  const cleaned = String(guarded.text || "").replace(/\s*\[محذوف\]\s*/g, " ").trim();
  if (!cleaned) {
    return res.status(400).json({
      error: "يُمنع مشاركة أرقام الهاتف أو حسابات تلغرام أو روابط منصات تواصل. تواصلوا داخل المنصة فقط."
    });
  }
  const text = guarded.flagged
    ? `${guarded.text}\n\n(حُذفت بيانات تواصل خارجي. الدردشة داخل المنصة فقط.)`
    : guarded.text;
  const msg = {
    id: uid("msg"),
    orderId: order.id,
    userId: req.user.id,
    text,
    createdAt: now(),
    flagged: !!guarded.flagged
  };
  db.messages.push(msg);
  if (guarded.flagged) {
    db.messages.push({
      id: uid("msg"),
      orderId: order.id,
      userId: "system",
      text: "رُصدت محاولة تواصل خارج المنصة. الأرقام وحسابات تلغرام/واتساب وغيرها تُحذف تلقائياً.",
      createdAt: now()
    });
    db.users.filter((u) => u.isAdmin).forEach((a) => {
      notify(a.id, "مراقبة دردشة", `${req.user.username} حاول مشاركة تواصل خارجي في صفقة ${order.id.slice(-8)}`, { orderId: order.id, href: `/admin?tab=orders&order=${order.id}` });
    });
  }
  const isParty = req.user.id === order.buyerId || req.user.id === order.sellerId;
  if (isParty) {
    notify(counterparty(order, req.user.id), "رسالة جديدة", text.slice(0, 80), { orderId: order.id });
  } else if (req.user.isAdmin) {
    notify(order.buyerId, "رسالة من الإدارة", text.slice(0, 80), { orderId: order.id });
    notify(order.sellerId, "رسالة من الإدارة", text.slice(0, 80), { orderId: order.id });
  }
  save();
  res.json({ message: msg });
});

app.get("/api/notifications", auth, (req, res) => {
  const all = db.notifications.filter((n) => n.userId === req.user.id);
  const items = all.slice(0, 50);
  res.json({
    notifications: items.map((n) => ({
      ...n,
      href: n.href || notificationHref(n.extra, { admin: !!req.user.isAdmin })
    })),
    unread: all.filter((n) => !n.read).length
  });
});

app.post("/api/notifications/read", auth, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
  db.notifications.forEach((n) => {
    if (n.userId !== req.user.id) return;
    if (!ids || ids.includes(n.id)) n.read = true;
  });
  save();
  res.json({ ok: true });
});

const assistantSessions = new Map();

function assistantState(user) {
  const id = user && user.id;
  let s = assistantSessions.get(id);
  if (!s) {
    s = { turns: 0, topicId: "start", unlocked: false };
    assistantSessions.set(id, s);
  }
  if (!s.unlocked && userOpenTicket(user.id)) s.unlocked = true;
  return s;
}

function publicAssistant(result, state) {
  return {
    topicId: result.topicId,
    title: result.title,
    reply: result.reply,
    quick: result.quick,
    suggestHuman: !!result.suggestHuman && !!state.unlocked,
    humanUnlocked: !!state.unlocked,
    turns: state.turns,
    topics: supportBot.topTopics({ humanUnlocked: state.unlocked }),
    greeting: supportBot.greeting()
  };
}

app.get("/api/support", auth, (req, res) => {
  const mine = supportTickets()
    .filter((t) => t.userId === req.user.id && t.status === "open")
    .slice(0, 30)
    .map((t) => publicSupportTicket(t, { withMessages: true }));
  const state = assistantState(req.user);
  res.json({ tickets: mine, humanUnlocked: !!state.unlocked, turns: state.turns });
});

app.post("/api/support/assistant", auth, (req, res) => {
  const state = assistantState(req.user);
  const text = String((req.body || {}).text || "").slice(0, 1000);
  const topicId = String((req.body || {}).topicId || "");
  const askingHuman = topicId === "human" || (!topicId && text && supportBot.isHumanRequest(text));
  const hasInput = !!(text || topicId);
  if (hasInput && !askingHuman) {
    state.turns += 1;
    state.unlocked = true;
  }
  let result;
  if (askingHuman && !state.unlocked) {
    result = supportBot.answer("دعم بشري", { humanUnlocked: false });
  } else if (topicId) {
    result = supportBot.topicReply(topicId, { humanUnlocked: state.unlocked });
  } else {
    result = supportBot.answer(text, { humanUnlocked: state.unlocked });
  }
  if (supportBot.HUMAN_UNLOCK_TOPICS.has(result.topicId) && result.topicId !== "human") {
    state.unlocked = true;
  }
  state.topicId = result.topicId;
  res.json(publicAssistant(result, state));
});

app.post("/api/support/handoff", auth, (req, res) => {
  const state = assistantState(req.user);
  const gate = supportBot.canHandoff({
    turns: state.turns,
    topicId: state.topicId,
    force: state.unlocked || !!userOpenTicket(req.user.id)
  });
  if (!gate.ok) return res.status(400).json({ error: gate.error });
  const body = req.body || {};
  const text = String(body.text || "").trim();
  const summary = String(body.summary || "").trim().slice(0, 2000);
  const subject = String(body.subject || "").trim().slice(0, 80) || "تحويل من الدعم الآلي";
  const topicId = String(body.topicId || state.topicId || "");
  const topic = supportBot.topicById(topicId);
  try {
    const ticket = createSupportTicket(req.user, text || "أرغب بالتواصل مع الدعم البشري.", subject);
    const noteParts = [];
    if (topic) noteParts.push(`تصنيف المساعد: ${topic.title}`);
    if (summary) noteParts.push(summary);
    if (noteParts.length) {
      const userMsg = ticket.messages.pop();
      addSupportBotMessage(ticket, noteParts.join("\n\n").slice(0, 2000));
      if (userMsg) ticket.messages.push(userMsg);
    }
    state.unlocked = true;
    save();
    res.json({ ticket: publicSupportTicket(ticket, { withMessages: true }), humanUnlocked: true });
  } catch (e) {
    res.status(400).json({ error: e.message || "تعذر تحويل الطلب للدعم" });
  }
});

app.post("/api/support", auth, (req, res) => {
  const state = assistantState(req.user);
  const open = userOpenTicket(req.user.id);
  if (!open) {
    const gate = supportBot.canHandoff({
      turns: state.turns,
      topicId: state.topicId,
      force: state.unlocked
    });
    if (!gate.ok) return res.status(400).json({ error: gate.error });
  }
  const { text, subject } = req.body || {};
  try {
    const ticket = createSupportTicket(req.user, text, subject);
    state.unlocked = true;
    save();
    res.json({ ticket: publicSupportTicket(ticket, { withMessages: true }), humanUnlocked: true });
  } catch (e) {
    res.status(400).json({ error: e.message || "تعذر إرسال الرسالة" });
  }
});

app.post("/api/support/:id/close", auth, (req, res) => {
  const ticket = supportTickets().find((t) => t.id === req.params.id && t.userId === req.user.id);
  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });
  if (ticket.status !== "open") return res.status(400).json({ error: "المحادثة مغلقة مسبقاً" });
  const rating = Number((req.body || {}).rating);
  const comment = String((req.body || {}).comment || "");
  if (!(rating >= 1 && rating <= 5)) {
    return res.status(400).json({ error: "قيّم المحادثة من 1 إلى 5 نجوم قبل الإغلاق" });
  }
  closeSupportTicket(ticket, { by: "user", rating, comment });
  save();
  res.json({ ok: true, ticket: publicSupportTicket(ticket, { withMessages: true }) });
});

app.get("/api/admin/support", auth, adminOnly, (req, res) => {
  const status = String(req.query.status || "open");
  const tickets = supportTickets()
    .filter((t) => !t.isDemo && (status === "all" || t.status === status))
    .slice(0, 120)
    .map((t) => {
      const u = db.users.find((x) => x.id === t.userId);
      return {
        ...publicSupportTicket(t, { withMessages: true }),
        user: u ? { id: u.id, username: u.username, displayName: u.displayName, uidCode: u.uidCode } : null
      };
    });
  res.json({
    tickets,
    open: supportTickets().filter((t) => !t.isDemo && t.status === "open").length,
    closed: supportTickets().filter((t) => !t.isDemo && t.status === "closed").length
  });
});

app.post("/api/admin/support/:id/reply", auth, adminOnly, (req, res) => {
  const ticket = supportTickets().find((t) => t.id === req.params.id);
  if (!ticket || ticket.isDemo) return res.status(404).json({ error: "التذكرة غير موجودة" });
  try {
    replySupportTicket(ticket, req.user, (req.body || {}).text);
    save();
    const u = db.users.find((x) => x.id === ticket.userId);
    res.json({
      ticket: {
        ...publicSupportTicket(ticket, { withMessages: true }),
        user: u ? { id: u.id, username: u.username, displayName: u.displayName, uidCode: u.uidCode } : null
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "تعذر إرسال الرد" });
  }
});

app.post("/api/admin/support/:id/close", auth, adminOnly, (req, res) => {
  const ticket = supportTickets().find((t) => t.id === req.params.id);
  if (!ticket || ticket.isDemo) return res.status(404).json({ error: "التذكرة غير موجودة" });
  closeSupportTicket(ticket, { by: "admin" });
  save();
  res.json({ ok: true });
});

app.post("/api/admin/support/:id/delete", auth, adminOnly, (req, res) => {
  const ticket = supportTickets().find((t) => t.id === req.params.id);
  if (!ticket || ticket.isDemo) return res.status(404).json({ error: "التذكرة غير موجودة" });
  deleteSupportTicket(ticket);
  save();
  res.json({ ok: true });
});

app.post("/api/admin/support/purge", auth, adminOnly, (req, res) => {
  const before = supportTickets().filter((t) => !t.isDemo && t.status !== "open");
  before.forEach((t) => deleteSupportTicket(t));
  save();
  res.json({ ok: true, removed: before.length });
});

app.get("/api/stats", (req, res) => {
  const completed = db.orders.filter((o) => o.status === "completed" && !orderIsDemo(o));
  const volume = completed.reduce((s, o) => s + (o.asset === "USDT" ? o.amount : o.fiatAmount / (o.price || 1)), 0);
  res.json({
    users: liveUsers().length,
    ads: db.ads.filter((a) => a.status === "active" && !adIsDemo(a)).length,
    orders: db.orders.filter((o) => !orderIsDemo(o)).length,
    completed: completed.length,
    volumeUsdt: Math.round(volume * 100) / 100
  });
});

app.get("/api/kyc", auth, (req, res) => {
  res.json({ status: req.user.kycStatus, kyc: publicKyc(req.user.kyc) });
});

app.post("/api/kyc", auth, (req, res) => {
  const level = req.body && req.body.level === "advanced" ? "advanced" : "basic";
  const alreadyVerified = req.user.kycStatus === "verified";
  const upgradeOnly = alreadyVerified && level === "advanced" && req.user.kycLevel !== "advanced";
  if (alreadyVerified && level === "basic") {
    return res.status(400).json({ error: "حسابك موثّق مسبقاً" });
  }
  if (alreadyVerified && level === "advanced" && req.user.kycLevel === "advanced") {
    return res.status(400).json({ error: "حسابك موثّق توثيقاً متقدماً مسبقاً" });
  }
  const { fullName, nationalId, country, documentType, phone, address, files } = req.body || {};
  const prev = req.user.kyc || {};
  const nextFullName = String(fullName || prev.fullName || "").slice(0, 80);
  const nextNationalId = String(nationalId || prev.nationalId || "").slice(0, 40);
  const nextCountry = String(country || prev.country || "").slice(0, 40);
  if (!nextFullName || !nextNationalId || !nextCountry) {
    return res.status(400).json({ error: "الاسم ورقم الهوية والدولة مطلوبة" });
  }
  if (nationalIdTaken(nextNationalId, req.user.id)) {
    return res.status(400).json({ error: "الرقم الوطني مستخدم مسبقاً في حساب آخر" });
  }
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: upgradeOnly ? "ارفع إثبات السكن للتوثيق المتقدم" : "ارفع صور الهوية والوجه قبل الإرسال" });
  }
  let savedFiles;
  try {
    savedFiles = kycStore.saveFiles(req.user.id, files);
  } catch (e) {
    return res.status(400).json({ error: e.message || "تعذر حفظ الملفات" });
  }
  const mergedFiles = upgradeOnly
    ? [...(prev.files || []).filter((f) => f.kind !== "residence" && f.kind !== "extra"), ...savedFiles]
    : savedFiles;
  const kyc = {
    fullName: nextFullName,
    nationalId: nextNationalId,
    country: nextCountry,
    documentType: String(documentType || prev.documentType || "id").slice(0, 30),
    phone: String(phone || prev.phone || "").slice(0, 40),
    address: String(address || prev.address || "").slice(0, 160),
    level,
    submittedAt: now(),
    reviewedAt: null,
    note: "",
    files: mergedFiles
  };
  if (!upgradeOnly && !kycStore.hasRequiredFiles(kyc)) {
    return res.status(400).json({ error: "مطلوب: وجه الهوية، ظهر الهوية، وصورة شخصية مع الوثيقة" });
  }
  if (level === "advanced" && !kycStore.hasAdvancedFiles(kyc)) {
    return res.status(400).json({ error: "التوثيق المتقدم يتطلب إثبات السكن" });
  }
  req.user.kyc = kyc;
  if (upgradeOnly) {
    req.user.kycStatus = "verified";
    req.user.kycLevel = "basic";
    req.user.kycUpgradePending = true;
  } else {
    req.user.kycStatus = "submitted";
    req.user.kycLevel = level;
    req.user.kycUpgradePending = false;
  }
  const existing = db.kycRequests.find((k) => k.userId === req.user.id && k.status === "submitted");
  if (!existing) {
    db.kycRequests.unshift({
      id: uid("kyc"),
      userId: req.user.id,
      status: "submitted",
      level,
      createdAt: now()
    });
  } else {
    existing.level = level;
  }
  if (isDemoUser(req.user)) {
    req.user.kycStatus = "verified";
    req.user.kycLevel = level;
    req.user.kycUpgradePending = false;
    if (req.user.kyc) req.user.kyc.reviewedAt = now();
    notify(req.user.id, "تم قبول KYC التجريبي", "الحساب التجريبي للعرض فقط ولا يراجع المدير ملفه.");
  } else {
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "طلب KYC", `${req.user.username} أرسل ملف توثيق ${level === "advanced" ? "متقدم" : "أساسي"} للمراجعة`, { kycUserId: req.user.id, href: `/admin?tab=kyc&user=${req.user.id}` });
    });
    notify(req.user.id, "تم إرسال KYC", "طلب التوثيق قيد المراجعة. لن يُقبل إلا بعد اطلاع المدير على الصور.");
  }
  save();
  res.json({ user: publicUser(req.user) });
});

app.get("/api/admin/overview", auth, adminOnly, (req, res) => {
  const users = liveUsers();
  res.json({
    users: users.length,
    ads: db.ads.filter((a) => !adIsDemo(a)).length,
    orders: db.orders.filter((o) => !orderIsDemo(o)).length,
    pendingKyc: users.filter((u) => u.kycStatus === "submitted" || u.kycUpgradePending).length,
    pendingMerchants: users.filter((u) => u.merchantStatus === "pending").length,
    pendingDeposits: liveItemsByUser(db.deposits).filter((d) => d.status === "pending").length,
    pendingWithdrawals: liveItemsByUser(db.withdrawals).filter((w) => w.status === "pending").length,
    disputed: db.orders.filter((o) => o.status === "disputed" && !orderIsDemo(o)).length,
    openSupport: supportTickets().filter((t) => t.status === "open" && !t.isDemo).length,
    frozenAccounts: users.filter((u) => u.accountFrozen).length,
    frozenFunds: users.filter((u) => u.fundsFrozen).length,
    activeAds: db.ads.filter((a) => a.status === "active" && !adIsDemo(a)).length
  });
});

app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  res.json({ users: liveUsers().map(publicUser) });
});

app.post("/api/admin/users/:id", auth, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user || isDemoUser(user)) return res.status(404).json({ error: "المستخدم غير موجود" });
  const { isMerchant, merchantStatus, isAdmin, kycStatus, merchantBadge } = req.body || {};
  if (typeof merchantStatus === "string" && ["none", "pending", "approved", "rejected"].includes(merchantStatus)) {
    const decisionNote = String(req.body.merchantDecisionNote || req.body.note || "").trim().slice(0, 400);
    if ((merchantStatus === "approved" || merchantStatus === "rejected") && decisionNote.length < 3) {
      return res.status(400).json({ error: "أدخل ملاحظة تُرسل للتاجر عند الاعتماد أو الرفض" });
    }
    user.merchantStatus = merchantStatus;
    user.isMerchant = merchantStatus === "approved";
    if (merchantStatus === "approved" || merchantStatus === "rejected") {
      user.merchantDecisionNote = decisionNote;
      user.merchantDecidedAt = now();
    }
    if (merchantStatus === "approved") {
      notify(user.id, "تم اعتمادك تاجراً", decisionNote);
    } else if (merchantStatus === "rejected") {
      notify(user.id, "تعذر اعتماد حسابك كتاجر", decisionNote);
    } else if (merchantStatus === "none") {
      user.merchantDecisionNote = "";
    }
  }
  if (typeof isMerchant === "boolean") {
    user.isMerchant = isMerchant;
    user.merchantStatus = isMerchant ? "approved" : "none";
  }
  if (typeof merchantBadge === "string") {
    const badge = merchantBadge.trim();
    try {
      setMerchantBadgeManual(user, badge);
    } catch (e) {
      return res.status(400).json({ error: e.message || "شارة التاجر غير صالحة" });
    }
    if (badge !== "auto" && badge !== "" && user.merchantStatus !== "approved") {
      user.merchantStatus = "approved";
      user.isMerchant = true;
    }
    notify(user.id, "تم تحديث شارة التاجر", badge === "auto" || badge === "" ? "عادت الشارة إلى الوضع التلقائي." : `أصبحت الآن: ${badgeLabel(badge)} (يدوي)`);
  }
  if (typeof isAdmin === "boolean" && user.id !== req.user.id) user.isAdmin = isAdmin;
  if (kycStatus && ["pending", "submitted", "verified", "rejected"].includes(kycStatus)) {
    user.kycStatus = kycStatus;
  }
  const { accountFrozen, fundsFrozen, freezeReason } = req.body || {};
  if (typeof freezeReason === "string") user.freezeReason = freezeReason.trim().slice(0, 240);
  if (typeof accountFrozen === "boolean" && user.id !== req.user.id) {
    user.accountFrozen = accountFrozen;
    if (accountFrozen) {
      pauseUserLiveAds(user.id, true);
      notify(user.id, "تم تجميد الحساب", user.freezeReason || "تواصل مع الدعم عبر تلغرام لفك التجميد.");
    } else {
      notify(user.id, "تم فك تجميد الحساب", "يمكنك استخدام المنصة من جديد.");
    }
  }
  if (typeof fundsFrozen === "boolean" && user.id !== req.user.id) {
    if (fundsFrozen && !user.fundsFrozen) freezeUserFunds(user.id);
    if (!fundsFrozen && user.fundsFrozen) unfreezeUserFunds(user.id);
    user.fundsFrozen = fundsFrozen;
    if (fundsFrozen) {
      notify(user.id, "تم تجميد الأموال", user.freezeReason || "الأموال مجمّدة داخل المحفظة. تواصل مع الدعم لفك التجميد.");
    } else {
      notify(user.id, "تم فك تجميد الأموال", "أصبح الرصيد المتاح قابلاً للاستخدام.");
    }
  }
  save();
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/users/:id/recovery", auth, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user || isDemoUser(user)) return res.status(404).json({ error: "المستخدم غير موجود" });
  if (user.isAdmin && user.id !== req.user.id) {
    return res.status(403).json({ error: "لا يمكن استعادة حساب مدير آخر" });
  }
  const action = String((req.body || {}).action || "").trim();
  if (!["reset_password", "clear_pin", "unlock_pin"].includes(action)) {
    return res.status(400).json({ error: "إجراء غير صالح" });
  }

  if (action === "reset_password") {
    const tempPassword = generateTempPassword();
    setUserPassword(user, tempPassword);
    revokeUserSessions(user.id);
    notify(
      user.id,
      "إعادة تعيين كلمة المرور",
      "أعاد المدير تعيين كلمة المرور بعد التحقق من هويتك. اطلب الكلمة المؤقتة من الدعم عبر تلغرام ثم غيّرها فوراً بعد الدخول.",
      { skipTelegramBody: true }
    );
    save();
    return res.json({
      user: publicUser(user),
      action,
      tempPassword,
      message: "كلمة مرور مؤقتة. سلّمها للمستخدم عبر دعم تلغرام بعد التحقق ثم اطلب منه تغييرها."
    });
  }

  if (action === "clear_pin") {
    if (!hasTradePin(user)) return res.status(400).json({ error: "المستخدم لا يملك رمز تحرير" });
    clearTradePin(user);
    notify(
      user.id,
      "مسح رمز التحرير",
      "مسح المدير رمز التحرير بعد التحقق من هويتك. عيّن رمزاً جديداً من الحساب أو البوت قبل الإفراج أو السحب أو التحويل."
    );
    save();
    return res.json({ user: publicUser(user), action, message: "تم مسح رمز التحرير. يعين المستخدم رمزاً جديداً بنفسه." });
  }

  unlockTradePin(user);
  notify(user.id, "فك قفل رمز التحرير", "فُك القفل المؤقت لرمز التحرير. يمكنك المحاولة من جديد.");
  save();
  return res.json({ user: publicUser(user), action, message: "تم فك قفل رمز التحرير." });
});

app.post("/api/merchant/apply", auth, (req, res) => {
  const frozenErr = freezeRestriction(req.user, "ad");
  if (frozenErr) return res.status(403).json({ error: frozenErr });
  if (req.user.isAdmin || req.user.isMerchant || req.user.merchantStatus === "approved") {
    return res.status(400).json({ error: "حسابك معتمد كتاجر مسبقاً" });
  }
  if (req.user.merchantStatus === "pending" && !isDemoUser(req.user)) {
    return res.status(400).json({ error: "طلبك قيد مراجعة المدير" });
  }
  const { shopName, note } = req.body || {};
  req.user.merchantShop = String(shopName || "").slice(0, 60);
  req.user.merchantNote = String(note || "").slice(0, 300);
  req.user.merchantAppliedAt = now();
  if (isDemoUser(req.user)) {
    req.user.merchantStatus = "approved";
    req.user.isMerchant = true;
    notify(req.user.id, "تم اعتمادك تاجراً (تجريبي)", "الحساب التجريبي للعرض فقط ولا يراجع المدير الطلب.");
  } else {
    req.user.merchantStatus = "pending";
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "طلب اعتماد تاجر", `${req.user.username} طلب اعتماد حساب كتاجر`, { merchantUserId: req.user.id, href: `/admin?tab=merchants&user=${req.user.id}` });
    });
    notify(req.user.id, "تم إرسال طلب التاجر", "طلبك قيد مراجعة المدير.");
  }
  save();
  res.json({ user: publicUser(req.user) });
});

function kycDossier(user) {
  const kyc = user.kyc || {};
  const files = kycStore.publicFiles(kyc).map((f) => ({
    ...f,
    url: `/api/admin/kyc/${user.id}/file/${f.id}`
  }));
  return {
    user: publicUser(user),
    level: kyc.level || user.kycLevel || "basic",
    upgradePending: !!user.kycUpgradePending,
    status: user.kycUpgradePending ? "submitted" : user.kycStatus,
    kyc: {
      ...publicKyc(kyc),
      documentLabel: kycStore.docLabel(kyc.documentType),
      files
    },
    printUrl: `/api/admin/kyc/${user.id}/print`
  };
}

app.get("/api/admin/kyc", auth, adminOnly, (req, res) => {
  const items = liveUsers()
    .filter((u) =>
      u.kycStatus === "submitted" ||
      u.kycStatus === "verified" ||
      u.kycStatus === "rejected" ||
      u.kycUpgradePending ||
      (u.kyc && (u.kyc.submittedAt || u.kyc.fullName))
    )
    .map(kycDossier);
  res.json({ requests: items });
});

app.get("/api/admin/kyc/:userId", auth, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.userId);
  if (!user || isDemoUser(user) || !user.kyc) return res.status(404).json({ error: "لا يوجد ملف توثيق" });
  res.json(kycDossier(user));
});

app.get("/api/admin/kyc/:userId/file/:fileId", auth, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.userId);
  if (!user || isDemoUser(user) || !user.kyc) return res.status(404).json({ error: "لا يوجد ملف توثيق" });
  const file = kycStore.findFile(user.kyc, req.params.fileId);
  if (!file) return res.status(404).json({ error: "الملف غير موجود" });
  try {
    const buf = kycStore.readFile(user.id, file);
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name || file.storedName)}"`);
    res.setHeader("Cache-Control", "private, max-age=120");
    res.send(buf);
  } catch {
    res.status(404).json({ error: "تعذر قراءة الملف" });
  }
});

app.get("/api/admin/kyc/:userId/print", auth, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.userId);
  if (!user || isDemoUser(user) || !user.kyc) return res.status(404).json({ error: "لا يوجد ملف توثيق" });
  const kyc = user.kyc;
  const statusMap = { submitted: "قيد المراجعة", verified: "موثّق", rejected: "مرفوض", pending: "غير مكتمل" };
  const when = (t) => (t ? new Date(t).toLocaleString("ar-SY") : "—");
  const images = (kyc.files || [])
    .filter((f) => kycStore.isImage(f))
    .map((f) => {
      let src = "";
      try {
        src = `data:${f.mime};base64,${kycStore.readFile(user.id, f).toString("base64")}`;
      } catch {
        return `<p>${escapeHtml(kycStore.kindLabel(f.kind))} — تعذر قراءة الملف</p>`;
      }
      return `<figure><img src="${src}" alt="${escapeHtml(kycStore.kindLabel(f.kind))}"><figcaption>${escapeHtml(kycStore.kindLabel(f.kind))} — ${escapeHtml(f.name)}</figcaption></figure>`;
    })
    .join("");
  const pdfs = (kyc.files || [])
    .filter((f) => !kycStore.isImage(f))
    .map((f) => `<li>${escapeHtml(kycStore.kindLabel(f.kind))}: ${escapeHtml(f.name)} (${Math.round(f.size / 1024)} KB)</li>`)
    .join("");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>ملف توثيق — ${escapeHtml(user.username)}</title>
  <style>
    body{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#111}
    h1{margin:0 0 8px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:16px 0 24px}
    .meta div{border-bottom:1px solid #ddd;padding:6px 0}
    .label{color:#555;font-size:12px}
    figure{margin:0 0 18px;page-break-inside:avoid}
    img{max-width:100%;border:1px solid #ccc}
    figcaption{font-size:13px;color:#444;margin-top:6px}
    .stamp{margin-top:28px;display:flex;justify-content:space-between}
    @media print {.noprint{display:none}}
  </style>
</head>
<body>
  <p class="noprint"><button onclick="window.print()">طباعة / حفظ PDF</button></p>
  <h1>USDT شام — ملف توثيق الهوية</h1>
  <p>نسخة إدارية رسمية للمراجعة والطباعة</p>
  <div class="meta">
    <div><div class="label">اسم المستخدم</div>${escapeHtml(user.username)}</div>
    <div><div class="label">الاسم الكامل</div>${escapeHtml(kyc.fullName || "—")}</div>
    <div><div class="label">رقم الهوية</div>${escapeHtml(kyc.nationalId || "—")}</div>
    <div><div class="label">نوع الوثيقة</div>${escapeHtml(kycStore.docLabel(kyc.documentType))}</div>
    <div><div class="label">الدولة</div>${escapeHtml(kyc.country || "—")}</div>
    <div><div class="label">الهاتف</div>${escapeHtml(kyc.phone || "—")}</div>
    <div><div class="label">العنوان</div>${escapeHtml(kyc.address || "—")}</div>
    <div><div class="label">البريد</div>${escapeHtml(user.email || "—")}</div>
    <div><div class="label">تلغرام</div>${escapeHtml(user.telegramId || "—")}</div>
    <div><div class="label">الحالة</div>${escapeHtml(statusMap[user.kycStatus] || user.kycStatus)}</div>
    <div><div class="label">تاريخ الإرسال</div>${escapeHtml(when(kyc.submittedAt))}</div>
    <div><div class="label">تاريخ المراجعة</div>${escapeHtml(when(kyc.reviewedAt))}</div>
  </div>
  ${images || "<p>لا توجد صور مرفقة.</p>"}
  ${pdfs ? `<h3>مستندات غير صورية</h3><ul>${pdfs}</ul>` : ""}
  ${kyc.note ? `<p>ملاحظة الإدارة: ${escapeHtml(kyc.note)}</p>` : ""}
  <div class="stamp">
    <div>توقيع المراجع: ____________</div>
    <div>ختم المنصة: ____________</div>
  </div>
</body>
</html>`);
});

app.post("/api/admin/kyc/:userId", auth, adminOnly, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.userId);
  if (!user || isDemoUser(user)) return res.status(404).json({ error: "المستخدم غير موجود" });
  const { action, note } = req.body || {};
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "إجراء غير صالح" });
  const level = (user.kyc && user.kyc.level) || user.kycLevel || "basic";
  if (action === "approve") {
    if (!user.kyc || !kycStore.hasRequiredFiles(user.kyc)) {
      return res.status(400).json({ error: "لا يمكن القبول بدون ملف توثيق كامل (وجه، ظهر، سيلفي)" });
    }
    if (level === "advanced" && !kycStore.hasAdvancedFiles(user.kyc)) {
      return res.status(400).json({ error: "التوثيق المتقدم يتطلب إثبات السكن" });
    }
  }
  const upgrading = !!user.kycUpgradePending;
  if (action === "approve") {
    user.kycStatus = "verified";
    user.kycLevel = level;
    user.kycUpgradePending = false;
  } else if (upgrading) {
    user.kycStatus = "verified";
    user.kycLevel = "basic";
    user.kycUpgradePending = false;
    if (user.kyc) user.kyc.level = "basic";
  } else {
    user.kycStatus = "rejected";
    user.kycLevel = "none";
    user.kycUpgradePending = false;
  }
  if (!user.kyc) user.kyc = {};
  user.kyc.reviewedAt = now();
  user.kyc.reviewedBy = req.user.id;
  user.kyc.note = String(note || "").slice(0, 300);
  const reqRow = db.kycRequests.find((k) => k.userId === user.id && k.status === "submitted");
  if (reqRow) {
    reqRow.status = user.kycStatus;
    reqRow.level = level;
  }
  notify(
    user.id,
    action === "approve" ? "تم قبول KYC" : "رُفض توثيق KYC",
    action === "approve" && level === "advanced" ? "تم اعتماد توثيقك المتقدم." : note || ""
  );
  save();
  res.json({ user: publicUser(user) });
});

app.get("/api/admin/deposits", auth, adminOnly, (req, res) => {
  const items = liveItemsByUser(db.deposits).map((d) => ({
    ...d,
    user: publicUser(db.users.find((u) => u.id === d.userId))
  }));
  res.json({ deposits: items });
});

app.post("/api/admin/deposits/:id", auth, adminOnly, (req, res) => {
  const deposit = db.deposits.find((d) => d.id === req.params.id);
  if (!deposit || isDemoUser(db.users.find((u) => u.id === deposit.userId))) {
    return res.status(404).json({ error: "الإيداع غير موجود" });
  }
  if (deposit.status !== "pending") return res.status(400).json({ error: "تمت معالجة هذا الإيداع" });
  const { action, note } = req.body || {};
  deposit.note = String(note || "").slice(0, 300);
  deposit.reviewedAt = now();
  deposit.reviewedBy = req.user.id;
  if (action === "approve") {
    const feePct = deposit.feePct != null ? Number(deposit.feePct) : Number(db.settings.depositFeePct || 0);
    const fee = deposit.fee != null ? Number(deposit.fee) : calcPctFee(deposit.amount, feePct);
    const netAmount = deposit.netAmount != null ? Number(deposit.netAmount) : deposit.amount - fee;
    if (!(netAmount > 0)) return res.status(400).json({ error: "المبلغ الصافي بعد العمولة غير صالح" });
    deposit.fee = fee;
    deposit.feePct = feePct;
    deposit.netAmount = netAmount;
    credit(deposit.userId, deposit.asset, netAmount);
    deposit.status = "credited";
    notify(
      deposit.userId,
      "تم قبول الإيداع",
      fee > 0
        ? `أُضيف ${netAmount} ${deposit.asset} إلى محفظتك بعد عمولة ${feePct}% (${fee})`
        : `أُضيف ${netAmount} ${deposit.asset} إلى محفظتك عبر BEP20`
    );
  } else if (action === "reject") {
    deposit.status = "rejected";
    notify(deposit.userId, "رُفض الإيداع", deposit.note || "لم يتم التحقق من التحويل على BEP20");
  } else {
    return res.status(400).json({ error: "إجراء غير صالح" });
  }
  save();
  res.json({ deposit });
});

app.get("/api/admin/withdrawals", auth, adminOnly, (req, res) => {
  const items = liveItemsByUser(db.withdrawals).map((w) => ({
    ...w,
    user: publicUser(db.users.find((u) => u.id === w.userId))
  }));
  res.json({ withdrawals: items });
});

app.post("/api/admin/withdrawals/:id", auth, adminOnly, (req, res) => {
  const withdrawal = db.withdrawals.find((w) => w.id === req.params.id);
  if (!withdrawal || isDemoUser(db.users.find((u) => u.id === withdrawal.userId))) {
    return res.status(404).json({ error: "طلب السحب غير موجود" });
  }
  if (withdrawal.status !== "pending") return res.status(400).json({ error: "تمت معالجة هذا الطلب" });
  const { action, note, txHash } = req.body || {};
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "إجراء غير صالح" });
  }
  if (action === "approve" && txHash && !isValidTxHash(txHash)) {
    return res.status(400).json({ error: "هاش المعاملة غير صالح (BEP20 0x... 64)" });
  }
  withdrawal.note = String(note || "").slice(0, 300);
  withdrawal.reviewedAt = now();
  withdrawal.reviewedBy = req.user.id;
  if (action === "approve") {
    withdrawal.txHash = txHash ? String(txHash).trim() : withdrawal.txHash;
    const list = normalizeTreasuryWallets(db.settings);
    const picked = list.find((w) => w.id === String((req.body && req.body.treasuryWalletId) || "")) || list.find((w) => w.active && w.forWithdraw) || activeDepositWallet();
    if (picked) {
      withdrawal.fromAddress = picked.address;
      withdrawal.treasuryWalletId = picked.id;
      withdrawal.treasuryWalletName = picked.name;
      withdrawal.treasuryWalletPlatform = picked.platform || "";
    }
    settleFrozen(withdrawal.userId, withdrawal.asset, withdrawal.total);
    withdrawal.status = "completed";
    notify(
      withdrawal.userId,
      "تم تنفيذ السحب",
      `أُرسل ${withdrawal.amount} ${withdrawal.asset} إلى ${withdrawal.toAddress}${withdrawal.txHash ? `\nالهاش: ${withdrawal.txHash}` : ""}`
    );
  } else {
    unfreeze(withdrawal.userId, withdrawal.asset, withdrawal.total);
    withdrawal.status = "rejected";
    notify(withdrawal.userId, "رُفض طلب السحب", withdrawal.note || "لم تتم الموافقة على طلب السحب وأُعيد الرصيد.");
  }
  save();
  res.json({ withdrawal });
});

app.get("/api/admin/orders", auth, adminOnly, (req, res) => {
  res.json({ orders: db.orders.filter((o) => !orderIsDemo(o)).map(enrichOrder) });
});

app.get("/api/admin/ads", auth, adminOnly, (req, res) => {
  res.json({ ads: db.ads.filter((a) => !adIsDemo(a)).map(enrichAd) });
});

app.post("/api/admin/ads/:id/toggle", auth, adminOnly, (req, res) => {
  const ad = db.ads.find((a) => a.id === req.params.id);
  if (!ad || adIsDemo(ad)) return res.status(404).json({ error: "الإعلان غير موجود" });
  if (ad.status === "active") {
    if (ad.side === "SELL" && ad.available > 0) unfreeze(ad.userId, ad.asset, ad.available);
    ad.status = "paused";
  } else if (ad.status === "paused") {
    if (ad.side === "SELL" && !freeze(ad.userId, ad.asset, ad.available)) {
      return res.status(400).json({ error: "رصيد المعلن غير كافٍ" });
    }
    ad.status = "active";
  }
  save();
  res.json({ ad: enrichAd(ad) });
});

app.get("/api/admin/catalog", auth, adminOnly, (req, res) => {
  db.settings.treasuryWallets = normalizeTreasuryWallets(db.settings);
  const settings = { ...db.settings };
  settings.priceApiKey = "";
  settings.priceApiKeySet = !!String(db.settings.priceApiKey || "").trim();
  delete settings.telegramBotToken;
  const bot = botManager.status();
  settings.telegramBotTokenHint = bot.tokenHint;
  settings.telegramBotTokenSet = bot.tokenSet;
  settings.telegramBotRunning = bot.running;
  res.json({
    assets: db.assets,
    fiats: db.fiats,
    paymentTypes: db.paymentTypes,
    settings,
    bot
  });
});

app.get("/api/admin/guide.pdf", auth, adminOnly, (_req, res) => {
  try {
    const pdf = buildPdf("دليل الإدارة — USDT شام", adminSections());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"usdt-sham-admin-guide.pdf\"");
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: "تعذر إنشاء دليل الإدارة" });
  }
});

app.get("/api/admin/bot", auth, adminOnly, (_req, res) => {
  res.json(botManager.status());
});

app.post("/api/admin/bot", auth, adminOnly, (req, res) => {
  const body = req.body || {};
  const action = String(body.action || "").trim();
  if (action === "save-token") {
    const raw = String(body.token || "").trim();
    if (!raw) return res.status(400).json({ error: "الصق توكن البوت من BotFather" });
    if (!looksLikeToken(raw)) return res.status(400).json({ error: "شكل التوكن غير صالح. انسخه من BotFather بالشكل 123456:AA...." });
    writeTelegramBotToken(raw);
    return res.json({ ...botManager.status(), saved: true });
  }
  if (action === "clear-token") {
    botManager.stop();
    clearTelegramBotToken();
    return res.json({ ...botManager.status(), saved: true });
  }
  if (action === "start") {
    const out = botManager.start();
    if (!out.ok) return res.status(400).json({ error: out.error || "تعذر تشغيل البوت", ...botManager.status() });
    return res.json(out);
  }
  if (action === "stop") {
    return res.json({ ...botManager.stop(), ok: true });
  }
  if (action === "restart") {
    const out = botManager.start();
    if (!out.ok) return res.status(400).json({ error: out.error || "تعذر إعادة تشغيل البوت", ...botManager.status() });
    return res.json(out);
  }
  return res.status(400).json({ error: "إجراء غير معروف" });
});

app.post("/api/admin/settings", auth, adminOnly, (req, res) => {
  const body = req.body || {};
  delete body.telegramBotToken;
  delete body.telegramBotTokenHint;
  delete body.telegramBotRunning;
  delete body.telegramBotTokenSet;
  if (body.bep20Address) {
    if (!isValidAddress(body.bep20Address)) return res.status(400).json({ error: "عنوان BEP20 غير صالح" });
    db.settings.bep20Address = String(body.bep20Address).trim();
  }
  if (body.telegramBotUsername) {
    db.settings.telegramBotUsername = String(body.telegramBotUsername).replace(/^@/, "").slice(0, 40);
  }
  if (body.webAppUrl) {
    const url = String(body.webAppUrl).trim().replace(/\/$/, "");
    if (!/^https:\/\//i.test(url)) return res.status(400).json({ error: "رابط التطبيق يجب أن يبدأ بـ https" });
    db.settings.webAppUrl = url.slice(0, 200);
  }
  db.settings.bep20Network = "BEP20";
  ["depositEnabled", "withdrawEnabled", "appEnabled"].forEach((k) => {
    if (typeof body[k] === "boolean") db.settings[k] = body[k];
  });
  if (body.appDisabledMessage != null) {
    const msg = String(body.appDisabledMessage || "").trim().slice(0, 400);
    db.settings.appDisabledMessage = msg || "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً.";
  }
  if (body.minDeposit != null) {
    const m = Number(body.minDeposit);
    if (!(m >= 0)) return res.status(400).json({ error: "حد الإيداع غير صالح" });
    db.settings.minDeposit = m;
  }
  if (body.minWithdraw != null) {
    const m = Number(body.minWithdraw);
    if (!(m >= 0)) return res.status(400).json({ error: "حد السحب غير صالح" });
    db.settings.minWithdraw = m;
  }
  if (body.withdrawFee != null) {
    const f = Number(body.withdrawFee);
    if (!(f >= 0)) return res.status(400).json({ error: "رسوم السحب غير صالحة" });
    db.settings.withdrawFee = f;
  }
  const pctFields = [
    ["depositFeePct", "نسبة عمولة الإيداع"],
    ["withdrawFeePct", "نسبة عمولة السحب"],
    ["transferFeePct", "نسبة عمولة التحويل الداخلي"]
  ];
  for (const [key, label] of pctFields) {
    if (body[key] != null) {
      const p = Number(body[key]);
      if (!(p >= 0) || p > 100) return res.status(400).json({ error: `${label} غير صالحة (0 إلى 100)` });
      db.settings[key] = p;
    }
  }
  ["requireKycForTrade", "requireKycForAd", "requireKycForDeposit", "requireKycForWithdraw", "requireMerchantForAd", "requirePaymentProof"].forEach((k) => {
    if (typeof body[k] === "boolean") db.settings[k] = body[k];
  });
  if (body.supportTelegramId != null) {
    db.settings.supportTelegramId = String(body.supportTelegramId).replace(/\D/g, "").slice(0, 20);
  }
  if (body.supportTelegramUsername != null) {
    db.settings.supportTelegramUsername = String(body.supportTelegramUsername).replace(/^@/, "").replace(/[^\w]/g, "").slice(0, 40);
  }
  if (body.advancedKycUsdt != null) {
    const v = Number(body.advancedKycUsdt);
    if (!(v >= 0)) return res.status(400).json({ error: "حد التوثيق المتقدم غير صالح" });
    db.settings.advancedKycUsdt = v;
  }
  if (body.featuredWeeklyTrades != null) {
    const v = Number(body.featuredWeeklyTrades);
    if (!(v >= 1)) return res.status(400).json({ error: "حد صفقات التاجر المميز غير صالح" });
    db.settings.featuredWeeklyTrades = v;
  }
  if (body.featuredHoldDays != null) {
    const v = Number(body.featuredHoldDays);
    if (!(v >= 1) || v > 30) return res.status(400).json({ error: "مدة شارة المميز غير صالحة" });
    db.settings.featuredHoldDays = v;
  }
  if (body.verifiedMerchantVolumeUsdt != null) {
    const v = Number(body.verifiedMerchantVolumeUsdt);
    if (!(v >= 0)) return res.status(400).json({ error: "حجم تاجر موثّق غير صالح" });
    db.settings.verifiedMerchantVolumeUsdt = v;
  }
  if (body.priceMode != null) {
    db.settings.priceMode = String(body.priceMode) === "auto" ? "auto" : "manual";
  }
  if (body.buySpreadPct != null) {
    const p = Number(body.buySpreadPct);
    if (!(p >= 0) || p > 50) return res.status(400).json({ error: "هامش الشراء غير صالح (0 إلى 50%)" });
    db.settings.buySpreadPct = p;
  }
  if (body.sellSpreadPct != null) {
    const p = Number(body.sellSpreadPct);
    if (!(p >= 0) || p > 50) return res.status(400).json({ error: "هامش البيع غير صالح (0 إلى 50%)" });
    db.settings.sellSpreadPct = p;
  }
  if (body.manualBuyPrice != null) {
    const p = Number(body.manualBuyPrice);
    if (!(p >= 0)) return res.status(400).json({ error: "سعر الشراء اليدوي غير صالح" });
    db.settings.manualBuyPrice = p;
  }
  if (body.manualSellPrice != null) {
    const p = Number(body.manualSellPrice);
    if (!(p >= 0)) return res.status(400).json({ error: "سعر البيع اليدوي غير صالح" });
    db.settings.manualSellPrice = p;
  }
  if (body.priceApiUrl != null) db.settings.priceApiUrl = String(body.priceApiUrl || "").trim().slice(0, 400);
  if (body.priceApiKey != null) {
    const nextKey = String(body.priceApiKey || "").trim().slice(0, 200);
    if (nextKey && nextKey !== "••••••••") db.settings.priceApiKey = nextKey;
    if (body.priceApiKey === "") db.settings.priceApiKey = "";
  }
  if (body.priceApiKeyHeader != null) db.settings.priceApiKeyHeader = String(body.priceApiKeyHeader || "X-API-Key").trim().slice(0, 60) || "X-API-Key";
  if (body.priceJsonPath != null) db.settings.priceJsonPath = String(body.priceJsonPath || "").trim().slice(0, 80);
  if (Array.isArray(body.priceRanges)) {
    const cleaned = [];
    for (const r of body.priceRanges) {
      const asset = String((r && r.asset) || "").trim().toUpperCase();
      const fiat = String((r && r.fiat) || "").trim().toUpperCase();
      if (!asset || !fiat) continue;
      if (!getAssets().find((x) => x.symbol === asset) && !db.assets.find((x) => x.symbol === asset)) {
        return res.status(400).json({ error: `عملة ${asset} غير مدعومة` });
      }
      if (!getFiats().find((x) => x.code === fiat) && !db.fiats.find((x) => x.code === fiat)) {
        return res.status(400).json({ error: `فيات ${fiat} غير مدعوم` });
      }
      const sellMin = Number(r.sellMin != null ? r.sellMin : r.min);
      const sellMax = Number(r.sellMax != null ? r.sellMax : r.max);
      const buyMin = Number(r.buyMin != null ? r.buyMin : r.min);
      const buyMax = Number(r.buyMax != null ? r.buyMax : r.max);
      if (!(sellMin >= 0) || !(sellMax >= 0) || !(buyMin >= 0) || !(buyMax >= 0)) {
        return res.status(400).json({ error: `نطاق ${asset}/${fiat} غير صالح` });
      }
      if (sellMin > 0 && sellMax > 0 && sellMin > sellMax) {
        return res.status(400).json({ error: `حد بيع ${asset}/${fiat}: الأدنى أكبر من الأقصى` });
      }
      if (buyMin > 0 && buyMax > 0 && buyMin > buyMax) {
        return res.status(400).json({ error: `حد شراء ${asset}/${fiat}: الأدنى أكبر من الأقصى` });
      }
      cleaned.push({ asset, fiat, min: sellMin, max: sellMax, sellMin, sellMax, buyMin, buyMax });
    }
    db.settings.priceRanges = cleaned;
  }
  if (Array.isArray(body.treasuryWallets)) {
    db.settings.treasuryWallets = body.treasuryWallets;
  }
  db.settings.treasuryWallets = normalizeTreasuryWallets(db.settings);
  const active = activeDepositWallet();
  if (active) db.settings.bep20Address = active.address;
  save();
  const settingsOut = { ...db.settings };
  settingsOut.priceApiKey = "";
  settingsOut.priceApiKeySet = !!String(db.settings.priceApiKey || "").trim();
  delete settingsOut.telegramBotToken;
  const bot = botManager.status();
  settingsOut.telegramBotTokenHint = bot.tokenHint;
  settingsOut.telegramBotTokenSet = bot.tokenSet;
  settingsOut.telegramBotRunning = bot.running;
  res.json({ settings: settingsOut, treasuryWallets: (db.settings.treasuryWallets || []).map(publicTreasury), bot });
});

app.get("/api/admin/treasury-wallets", auth, adminOnly, (req, res) => {
  const list = normalizeTreasuryWallets(db.settings);
  db.settings.treasuryWallets = list;
  res.json({ wallets: list.map(publicTreasury), activeDeposit: publicTreasury(activeDepositWallet()) });
});

app.post("/api/admin/treasury-wallets", auth, adminOnly, (req, res) => {
  const body = req.body || {};
  const address = String(body.address || "").trim();
  if (!isValidAddress(address)) return res.status(400).json({ error: "عنوان BEP20 غير صالح" });
  const list = normalizeTreasuryWallets(db.settings);
  if (list.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
    return res.status(400).json({ error: "هذا العنوان مسجّل مسبقاً" });
  }
  const wallet = {
    id: uid("tw"),
    name: String(body.name || "").trim().slice(0, 40) || "خزينة",
    platform: String(body.platform || "").trim().slice(0, 40),
    address,
    network: "BEP20",
    note: String(body.note || "").trim().slice(0, 120),
    active: body.active !== false,
    forDeposit: body.forDeposit !== false,
    forWithdraw: body.forWithdraw !== false
  };
  list.push(wallet);
  db.settings.treasuryWallets = list;
  const active = activeDepositWallet();
  if (active) db.settings.bep20Address = active.address;
  save();
  res.json({ wallet: publicTreasury(wallet), wallets: list.map(publicTreasury) });
});

app.post("/api/admin/treasury-wallets/:id", auth, adminOnly, (req, res) => {
  const list = normalizeTreasuryWallets(db.settings);
  const wallet = list.find((w) => w.id === req.params.id);
  if (!wallet) return res.status(404).json({ error: "المحفظة غير موجودة" });
  const body = req.body || {};
  if (typeof body.name === "string" && body.name.trim()) wallet.name = body.name.trim().slice(0, 40);
  if (typeof body.platform === "string") wallet.platform = body.platform.trim().slice(0, 40);
  if (typeof body.note === "string") wallet.note = body.note.trim().slice(0, 120);
  if (typeof body.address === "string" && body.address.trim()) {
    if (!isValidAddress(body.address)) return res.status(400).json({ error: "عنوان BEP20 غير صالح" });
    const next = String(body.address).trim();
    if (list.some((w) => w.id !== wallet.id && w.address.toLowerCase() === next.toLowerCase())) {
      return res.status(400).json({ error: "هذا العنوان مسجّل مسبقاً" });
    }
    wallet.address = next;
  }
  if (typeof body.active === "boolean") wallet.active = body.active;
  if (typeof body.forDeposit === "boolean") wallet.forDeposit = body.forDeposit;
  if (typeof body.forWithdraw === "boolean") wallet.forWithdraw = body.forWithdraw;
  if (body.remove) {
    const next = list.filter((w) => w.id !== wallet.id);
    if (!next.length) return res.status(400).json({ error: "يجب الإبقاء على محفظة واحدة على الأقل" });
    db.settings.treasuryWallets = next;
  } else {
    db.settings.treasuryWallets = list;
  }
  const active = activeDepositWallet();
  if (active) db.settings.bep20Address = active.address;
  save();
  res.json({ wallets: (db.settings.treasuryWallets || []).map(publicTreasury), wallet: publicTreasury(wallet) });
});

function adminWalletsOf(userId, enabled) {
  enabled.forEach((symbol) => getWallet(userId, symbol));
  return db.wallets
    .filter((w) => w.userId === userId && enabled.includes(w.asset))
    .map((w) => ({ asset: w.asset, available: w.available, frozen: w.frozen }));
}

app.get("/api/admin/wallet", auth, adminOnly, (req, res) => {
  const enabled = getAssets(true).map((a) => a.symbol);
  const users = liveUsers().map((u) => ({
    user: publicUser(u),
    wallets: adminWalletsOf(u.id, enabled)
  }));
  res.json({
    wallets: adminWalletsOf(req.user.id, enabled),
    users
  });
});

app.post("/api/admin/wallet", auth, adminOnly, (req, res) => {
  const { action, asset, amount, note, userId } = req.body || {};
  const target = userId ? db.users.find((u) => u.id === userId) : req.user;
  if (!target || isDemoUser(target)) return res.status(404).json({ error: "المستخدم غير موجود" });
  const coin = getAssets().find((x) => x.symbol === asset && x.enabled) || getAssets(true).find((x) => x.symbol === asset);
  if (!coin) return res.status(400).json({ error: "عملة غير مدعومة" });
  const a = Number(amount);
  if (!(a > 0) || a > 1e9) return res.status(400).json({ error: "مبلغ غير صالح" });
  const act = String(action || "").toLowerCase();
  if (act !== "credit" && act !== "debit") {
    return res.status(400).json({ error: "اختر إضافة أو خصم" });
  }
  if (act === "credit") {
    credit(target.id, coin.symbol, a);
  } else if (!debit(target.id, coin.symbol, a)) {
    return res.status(400).json({ error: "الرصيد المتاح غير كافٍ للخصم" });
  }
  const wallet = getWallet(target.id, coin.symbol);
  const reason = String(note || "").trim().slice(0, 120);
  const self = target.id === req.user.id;
  const title = act === "credit" ? "ترصيد إداري" : "خصم إداري";
  const body = `${act === "credit" ? "أُضيف" : "خُصم"} ${a} ${coin.symbol} ${self ? "من محفظتك" : `إلى محفظة ${target.username}`} دون معاملة.${reason ? ` · ${reason}` : ""}`;
  notify(target.id, title, body);
  if (!self) notify(req.user.id, title, `${act === "credit" ? "أُضيف" : "خُصم"} ${a} ${coin.symbol} لحساب ${target.username} (${target.uidCode || ""}).${reason ? ` · ${reason}` : ""}`);
  save();
  res.json({
    ok: true,
    action: act,
    asset: coin.symbol,
    amount: a,
    user: publicUser(target),
    wallet: { asset: wallet.asset, available: wallet.available, frozen: wallet.frozen }
  });
});

app.post("/api/admin/reset", auth, adminOnly, (req, res) => {
  const confirm = String((req.body && req.body.confirm) || "").trim();
  if (confirm !== "مسح الكل") {
    return res.status(400).json({ error: "للتأكيد اكتب: مسح الكل" });
  }
  const before = {
    users: db.users.length,
    ads: db.ads.length,
    orders: db.orders.length,
    deposits: db.deposits.length,
    withdrawals: db.withdrawals.length
  };
  kycStore.clearAll();
  evidenceStore.clearAll();
  wipeSupportData();
  resetPlatform(req.user);
  res.json({
    ok: true,
    message: "تم مسح بيانات التطبيق. بقي حسابك فقط.",
    kept: publicUser(req.user),
    removed: before
  });
});

app.post("/api/admin/assets", auth, adminOnly, (req, res) => {
  const { symbol, name, decimals, contract, depositEnabled } = req.body || {};
  const sym = slugId(symbol);
  if (!sym || !name) return res.status(400).json({ error: "رمز واسم العملة مطلوبان" });
  if (db.assets.find((a) => a.symbol === sym)) return res.status(400).json({ error: "العملة موجودة" });
  const asset = {
    symbol: sym,
    name: String(name).slice(0, 40),
    decimals: Math.min(Math.max(Number(decimals) || 2, 0), 18),
    network: "BEP20",
    contract: contract ? String(contract).trim() : "",
    enabled: true,
    depositEnabled: depositEnabled !== false
  };
  db.assets.push(asset);
  db.users.forEach((u) => getWallet(u.id, sym));
  save();
  res.json({ asset });
});

app.post("/api/admin/assets/:symbol", auth, adminOnly, (req, res) => {
  const asset = db.assets.find((a) => a.symbol === String(req.params.symbol).toUpperCase());
  if (!asset) return res.status(404).json({ error: "العملة غير موجودة" });
  const { name, decimals, contract, enabled, depositEnabled } = req.body || {};
  if (name) asset.name = String(name).slice(0, 40);
  if (decimals != null) asset.decimals = Math.min(Math.max(Number(decimals) || 0, 0), 18);
  if (contract != null) asset.contract = String(contract).trim();
  if (typeof enabled === "boolean") asset.enabled = enabled;
  if (typeof depositEnabled === "boolean") asset.depositEnabled = depositEnabled;
  save();
  res.json({ asset });
});

app.post("/api/admin/fiats", auth, adminOnly, (req, res) => {
  const { code, name, symbol } = req.body || {};
  const c = slugId(code).slice(0, 8);
  if (!c || !name) return res.status(400).json({ error: "رمز واسم العملة الورقية مطلوبان" });
  if (db.fiats.find((f) => f.code === c)) return res.status(400).json({ error: "العملة موجودة" });
  const fiat = { code: c, name: String(name).slice(0, 40), symbol: String(symbol || c).slice(0, 8), enabled: true };
  db.fiats.push(fiat);
  save();
  res.json({ fiat });
});

app.post("/api/admin/fiats/:code", auth, adminOnly, (req, res) => {
  const fiat = db.fiats.find((f) => f.code === String(req.params.code).toUpperCase());
  if (!fiat) return res.status(404).json({ error: "غير موجودة" });
  const { name, symbol, enabled } = req.body || {};
  if (name) fiat.name = String(name).slice(0, 40);
  if (symbol) fiat.symbol = String(symbol).slice(0, 8);
  if (typeof enabled === "boolean") fiat.enabled = enabled;
  save();
  res.json({ fiat });
});

app.post("/api/admin/payment-types", auth, adminOnly, (req, res) => {
  const { id, name, fields } = req.body || {};
  const pid = slugId(id || name);
  if (!pid || !name) return res.status(400).json({ error: "معرف واسم طريقة الدفع مطلوبان" });
  if (db.paymentTypes.find((p) => p.id === pid)) return res.status(400).json({ error: "طريقة الدفع موجودة" });
  const item = {
    id: pid,
    name: String(name).slice(0, 40),
    icon: "wallet",
    enabled: true,
    fields: String(fields || "account,name").slice(0, 80)
  };
  db.paymentTypes.push(item);
  save();
  res.json({ paymentType: item });
});

app.post("/api/admin/payment-types/:id", auth, adminOnly, (req, res) => {
  const item = db.paymentTypes.find((p) => p.id === String(req.params.id).toUpperCase());
  if (!item) return res.status(404).json({ error: "غير موجودة" });
  const { name, fields, enabled } = req.body || {};
  if (name) item.name = String(name).slice(0, 40);
  if (fields) item.fields = String(fields).slice(0, 80);
  if (typeof enabled === "boolean") item.enabled = enabled;
  save();
  res.json({ paymentType: item });
});

app.post("/api/telegram/link", auth, (req, res) => {
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  req.user.telegramLinkCode = code;
  req.user.telegramLinkExpires = now() + 10 * 60 * 1000;
  save();
  res.json({ code, expiresIn: 600 });
});

app.post("/api/me/delete", auth, (req, res) => {
  if (req.user.isAdmin) return res.status(400).json({ error: "لا يمكن حذف حساب المدير من هنا" });
  const snap = userBalanceSnapshot(req.user.id);
  if (snap.hasFunds || snap.openOrders || snap.pendingMoney) {
    return res.status(400).json({
      error: "لا يمكن حذف الحساب قبل سحب الأموال وإغلاق الصفقات المعلّقة.",
      hasFunds: snap.hasFunds,
      openOrders: snap.openOrders,
      pendingMoney: snap.pendingMoney,
      wallets: snap.wallets
    });
  }
  const confirm = String((req.body || {}).confirm || "");
  if (confirm !== "DELETE") {
    return res.status(400).json({ error: "اكتب DELETE للتأكيد النهائي" });
  }
  const userId = req.user.id;
  kycStore.clearUser(userId);
  db.sessions = (db.sessions || []).filter((s) => s.userId !== userId);
  db.wallets = (db.wallets || []).filter((w) => w.userId !== userId);
  db.paymentMethods = (db.paymentMethods || []).filter((m) => m.userId !== userId);
  db.notifications = (db.notifications || []).filter((n) => n.userId !== userId);
  db.ads = (db.ads || []).map((a) => (a.userId === userId ? { ...a, status: "closed" } : a));
  db.supportTickets = (db.supportTickets || []).filter((t) => t.userId !== userId);
  db.kycRequests = (db.kycRequests || []).filter((k) => k.userId !== userId);
  db.users = (db.users || []).filter((u) => u.id !== userId);
  save();
  res.json({ ok: true });
});

function expireOrder(order) {
  if (order.status !== "pending_payment") return;
  cancelOrder(order, "system");
}

function cancelOrder(order, by) {
  if (["completed", "cancelled"].includes(order.status)) return;
  const ad = db.ads.find((a) => a.id === order.adId);
  if (ad) {
    ad.available = Math.round((ad.available + order.amount) * 1e8) / 1e8;
    if (ad.status === "filled") ad.status = "active";
  }
  if (ad && ad.side === "BUY") {
    unfreeze(order.sellerId, order.asset, order.amount);
  }
  order.status = "cancelled";
  order.cancelledAt = now();
  db.messages.push({
    id: uid("msg"),
    orderId: order.id,
    userId: "system",
    text: by === "system" ? "أُلغيت الصفقة لانتهاء المهلة." : "أُلغيت الصفقة.",
    createdAt: now()
  });
}



setInterval(() => {
  let changed = false;
  db.orders.forEach((o) => {
    if (o.status === "pending_payment" && now() > o.expiresAt) {
      expireOrder(o);
      changed = true;
    }
  });
  if (refreshFeaturedMerchant()) changed = true;
  if (changed) save();
}, 15000);

const ANDROID_APK = path.join(__dirname, "..", "releases", "usdt-sham.apk");
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

app.get("/download/android", (req, res) => {
  if (!fs.existsSync(ANDROID_APK)) {
    return res.status(404).send("ملف APK غير موجود. اطلب من الإدارة بناء نسخة جديدة.");
  }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", "attachment; filename=\"usdt-sham.apk\"");
  res.sendFile(ANDROID_APK);
});

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/download")) return next();
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`USDT Sham API on ${PORT}`);
  if (process.env.START_BOT === "1" || process.env.RENDER) {
    const out = botManager.start();
    if (!out.ok) console.log("bot:", out.error || "not started");
    else console.log("USDT Sham Telegram bot started");
  }
});

module.exports = { app };
