const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUNDLED_DATA_DIR = path.join(__dirname, "data");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : BUNDLED_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, "db.json");
const LEGACY_PREVIEW_HOST = "monkeycode-ai.live";

function publicSiteUrlFromEnv() {
  const fromEnv = String(process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/$/, "");
  if (/^https:\/\//i.test(fromEnv)) return fromEnv;
  return "https://sham-usdt5.onrender.com";
}

function isLegacyPreviewUrl(url) {
  const value = String(url || "").trim().toLowerCase();
  return !value || value.includes(LEGACY_PREVIEW_HOST);
}

function resolveWebAppUrl(stored) {
  const live = publicSiteUrlFromEnv();
  const current = String(stored || "").trim().replace(/\/$/, "");
  if (live && isLegacyPreviewUrl(current)) return live;
  if (/^https:\/\//i.test(current)) return current;
  return live;
}

function publicSiteUrl() {
  return resolveWebAppUrl(db.settings && db.settings.webAppUrl);
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, s, 64).toString("hex");
  return { salt: s, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

function normalizePinDigits(code) {
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9"
  };
  return String(code || "")
    .replace(/[٠-٩۰-۹]/g, (c) => map[c] || c)
    .replace(/\s+/g, "")
    .replace(/[^\d]/g, "");
}

function isValidTradePin(pin) {
  const digits = normalizePinDigits(pin);
  if (!/^\d{6}$/.test(digits)) return false;
  if (/^(\d)\1{5}$/.test(digits)) return false;
  return true;
}

function hashTradePin(pin) {
  const digits = normalizePinDigits(pin);
  return hashPassword(digits);
}

function hasTradePin(user) {
  return !!(user && user.tradePinHash && user.tradePinSalt);
}

function tradePinLockedUntil(user) {
  return Number(user && user.tradePinLockedUntil) || 0;
}

function verifyTradePin(user, pin) {
  if (!hasTradePin(user)) return false;
  const digits = normalizePinDigits(pin);
  if (!/^\d{6}$/.test(digits)) return false;
  try {
    return verifyPassword(digits, user.tradePinSalt, user.tradePinHash);
  } catch {
    return false;
  }
}

function assertTradePin(user, pin, { optionalForDemo } = {}) {
  if (optionalForDemo && user && user.isDemo) return null;
  if (!user) return "الحساب غير موجود";
  const locked = tradePinLockedUntil(user);
  if (locked && now() < locked) {
    const mins = Math.max(1, Math.ceil((locked - now()) / 60000));
    return `رمز التحرير مقفل مؤقتاً. أعد المحاولة بعد ${mins} دقيقة.`;
  }
  if (!hasTradePin(user)) {
    return "عيّن رمز تحرير من 6 أرقام في الحساب قبل الإفراج أو السحب أو التحويل.";
  }
  if (!verifyTradePin(user, pin)) {
    user.tradePinFails = Number(user.tradePinFails || 0) + 1;
    if (user.tradePinFails >= 5) {
      user.tradePinFails = 0;
      user.tradePinLockedUntil = now() + 15 * 60 * 1000;
      save();
      return "رمز التحرير غير صحيح. أُقفل لمدة 15 دقيقة بعد 5 محاولات خاطئة.";
    }
    save();
    const left = 5 - user.tradePinFails;
    return `رمز التحرير غير صحيح. تبقى ${left} محاولات قبل القفل المؤقت.`;
  }
  user.tradePinFails = 0;
  user.tradePinLockedUntil = 0;
  return null;
}

function setTradePin(user, pin) {
  if (!isValidTradePin(pin)) {
    throw new Error("رمز التحرير يجب أن يكون 6 أرقام مختلفة عن تكرار رقم واحد مثل 000000.");
  }
  const hashed = hashTradePin(pin);
  user.tradePinHash = hashed.hash;
  user.tradePinSalt = hashed.salt;
  user.tradePinFails = 0;
  user.tradePinLockedUntil = 0;
  user.tradePinSetAt = now();
}

function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function setUserPassword(user, password) {
  if (!password || String(password).length < 6) {
    throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
  }
  const cred = hashPassword(String(password));
  user.passwordHash = cred.hash;
  user.passwordSalt = cred.salt;
  user.passwordChangedAt = now();
}

function clearTradePin(user) {
  if (!user) return;
  user.tradePinHash = "";
  user.tradePinSalt = "";
  user.tradePinFails = 0;
  user.tradePinLockedUntil = 0;
  user.tradePinSetAt = 0;
}

function unlockTradePin(user) {
  if (!user) return;
  user.tradePinFails = 0;
  user.tradePinLockedUntil = 0;
}

function revokeUserSessions(userId) {
  db.sessions = (db.sessions || []).filter((s) => s.userId !== userId);
}

function isTradePinLocked(user) {
  const locked = tradePinLockedUntil(user);
  return !!(locked && now() < locked);
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function now() {
  return Date.now();
}

function defaultAssets() {
  return [
    { symbol: "USDT", name: "Tether", decimals: 2, network: "BEP20", contract: "0x55d398326f99059fF775485246999027B3197955", enabled: true, depositEnabled: true },
    { symbol: "USDC", name: "USD Coin", decimals: 2, network: "BEP20", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", enabled: true, depositEnabled: true },
    { symbol: "BNB", name: "BNB", decimals: 6, network: "BEP20", contract: "native", enabled: true, depositEnabled: true },
    { symbol: "ETH", name: "Ethereum", decimals: 6, network: "BEP20", contract: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", enabled: true, depositEnabled: true },
    { symbol: "BTC", name: "Bitcoin", decimals: 8, network: "BEP20", contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", enabled: true, depositEnabled: true }
  ];
}

function defaultFiats() {
  return [
    { code: "SYP", name: "ليرة سورية", symbol: "ل.س", enabled: true },
    { code: "USD", name: "دولار أمريكي", symbol: "$", enabled: true }
  ];
}

function defaultPaymentTypes() {
  return [
    { id: "SHAM_CASH", name: "شام كاش", icon: "wallet", enabled: true, fields: "name,address" }
  ];
}

function defaultSettings() {
  return {
    brand: "USDT شام",
    brandTagline: "منصة التداول P2P",
    country: "SY",
    telegramBotUsername: "EntrepreneurMA_bot",
    ownerTelegramId: "1441524960",
    webAppUrl: publicSiteUrlFromEnv(),
    bep20Address: "0x4e5e8A2C91B6F3d1A0c7E4b9F8D2a6C1B0E3F847",
    bep20Network: "BEP20",
    depositEnabled: true,
    withdrawEnabled: true,
    minDeposit: 10,
    minWithdraw: 10,
    withdrawFee: 0,
    depositFeePct: 0,
    withdrawFeePct: 0,
    transferFeePct: 0,
    priceRanges: [],
    priceMode: "manual",
    buySpreadPct: 0,
    sellSpreadPct: 0,
    manualBuyPrice: 0,
    manualSellPrice: 0,
    priceApiUrl: "",
    priceApiKey: "",
    priceApiKeyHeader: "X-API-Key",
    priceJsonPath: "",
    featuredWeeklyTrades: 50,
    featuredHoldDays: 3,
    verifiedMerchantVolumeUsdt: 1500,
    featuredMerchantId: "",
    featuredGrantedAt: 0,
    featuredMerchantIdDemo: "",
    featuredGrantedAtDemo: 0,
    supportTelegramId: "1441524960",
    supportTelegramUsername: "Entrepreneurma",
    requirePaymentProof: true,
    requireKycForTrade: true,
    requireKycForAd: true,
    requireKycForDeposit: false,
    requireKycForWithdraw: true,
    requireMerchantForAd: true,
    advancedKycUsdt: 2000,
    treasuryWallets: [],
    appEnabled: true,
    appDisabledMessage: "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً."
  };
}

function publicTreasury(w) {
  if (!w) return null;
  return {
    id: w.id,
    name: w.name || "",
    platform: w.platform || "",
    address: w.address || "",
    network: "BEP20",
    note: w.note || "",
    active: w.active !== false,
    forDeposit: w.forDeposit !== false,
    forWithdraw: w.forWithdraw !== false
  };
}

function normalizeTreasuryWallets(settings) {
  const s = settings || {};
  const list = Array.isArray(s.treasuryWallets) ? s.treasuryWallets : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const address = String((raw && raw.address) || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String((raw && raw.id) || uid("tw")).slice(0, 40),
      name: String((raw && raw.name) || "خزينة").trim().slice(0, 40) || "خزينة",
      platform: String((raw && raw.platform) || "").trim().slice(0, 40),
      address,
      network: "BEP20",
      note: String((raw && raw.note) || "").trim().slice(0, 120),
      active: raw && raw.active === false ? false : true,
      forDeposit: raw && raw.forDeposit === false ? false : true,
      forWithdraw: raw && raw.forWithdraw === false ? false : true
    });
  }
  const fallback = String(s.bep20Address || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(fallback) && !seen.has(fallback.toLowerCase())) {
    out.unshift({
      id: "tw_main",
      name: "الخزينة الرئيسية",
      platform: "المنصة",
      address: fallback,
      network: "BEP20",
      note: "",
      active: true,
      forDeposit: true,
      forWithdraw: true
    });
  }
  if (out.length && (!s.bep20Address || !/^0x[a-fA-F0-9]{40}$/.test(String(s.bep20Address)))) {
    s.bep20Address = out[0].address;
  }
  return out;
}

function activeDepositWallet(settings) {
  const list = normalizeTreasuryWallets(settings || db.settings || {});
  return list.find((w) => w.active && w.forDeposit) || list.find((w) => w.active) || list[0] || null;
}

function treasuryByAddress(address, settings) {
  const key = String(address || "").trim().toLowerCase();
  if (!key) return null;
  return normalizeTreasuryWallets(settings || db.settings || {}).find((w) => w.address.toLowerCase() === key) || null;
}

function isPlatformTreasuryAddress(address) {
  const key = String(address || "").trim().toLowerCase();
  if (!key) return false;
  if (key === String((db.settings && db.settings.bep20Address) || "").trim().toLowerCase()) return true;
  return !!treasuryByAddress(key);
}

function emptyDb() {
  return {
    users: [],
    wallets: [],
    paymentMethods: [],
    ads: [],
    orders: [],
    messages: [],
    notifications: [],
    sessions: [],
    assets: defaultAssets(),
    fiats: defaultFiats(),
    paymentTypes: defaultPaymentTypes(),
    settings: defaultSettings(),
    kycRequests: [],
    deposits: [],
    withdrawals: [],
    transfers: [],
    supportTickets: [],
    deletedSupportIds: [],
    adCounter: 100000,
    uidCounter: 10000000
  };
}

function seedDb() {
  const demo = hashPassword("demo123");
  const merchant = hashPassword("merchant123");
  const admin = hashPassword("ameralzman199200");
  const buyer = hashPassword("buyer123");

  const users = [
    {
      id: "u_demo",
      username: "demo",
      email: "demo@p2p.local",
      displayName: "مستخدم تجريبي",
      passwordHash: demo.hash,
      passwordSalt: demo.salt,
      telegramId: null,
      telegramUsername: null,
      isMerchant: false,
      isAdmin: false,
      kycStatus: "verified",
      kyc: { fullName: "مستخدم تجريبي", nationalId: "01010012345", country: "SY", submittedAt: now() - 86400000 * 39, reviewedAt: now() - 86400000 * 38, note: "" },
      rating: 98.5,
      completedTrades: 12,
      createdAt: now() - 86400000 * 40,
      isDemo: true
    },
    {
      id: "u_merchant",
      username: "merchant",
      email: "merchant@p2p.local",
      displayName: "تاجر الشام",
      passwordHash: merchant.hash,
      passwordSalt: merchant.salt,
      telegramId: null,
      telegramUsername: null,
      isMerchant: true,
      isAdmin: false,
      kycStatus: "verified",
      kyc: { fullName: "تاجر الشام", nationalId: "01010019876", country: "SY", submittedAt: now() - 86400000 * 390, reviewedAt: now() - 86400000 * 389, note: "" },
      rating: 99.7,
      completedTrades: 1840,
      createdAt: now() - 86400000 * 400,
      isDemo: true
    },
    {
      id: "u_admin",
      username: "ameralzman00",
      email: "ameralzman00@p2p.local",
      displayName: "الإدارة",
      passwordHash: admin.hash,
      passwordSalt: admin.salt,
      telegramId: "1441524960",
      telegramUsername: null,
      isMerchant: true,
      isAdmin: true,
      kycStatus: "verified",
      kycLevel: "advanced",
      kycUpgradePending: false,
      kyc: adminAdvancedKyc({ fullName: "مدير المنصة", nationalId: "01010010001", country: "SY", submittedAt: now() - 86400000 * 499, reviewedAt: now() - 86400000 * 499, note: "" }),
      rating: 100,
      completedTrades: 50,
      createdAt: now() - 86400000 * 500
    },
    {
      id: "u_buyer",
      username: "buyer",
      email: "buyer@p2p.local",
      displayName: "مشتري سريع",
      passwordHash: buyer.hash,
      passwordSalt: buyer.salt,
      telegramId: null,
      telegramUsername: null,
      isMerchant: false,
      isAdmin: false,
      kycStatus: "verified",
      kyc: { fullName: "مشتري سريع", nationalId: "01010015555", country: "SY", submittedAt: now() - 86400000 * 85, reviewedAt: now() - 86400000 * 84, note: "" },
      rating: 97.2,
      completedTrades: 34,
      createdAt: now() - 86400000 * 90,
      isDemo: true
    }
  ];

  const extraMerchants = [
    ["u_m1", "shamdesk", "مكتب الشام", 99.8, 3200],
    ["u_m2", "damascusex", "دمشق إكسشينج", 99.4, 910],
    ["u_m3", "aleppocash", "حلب كاش", 98.9, 540],
    ["u_m4", "baradap2p", "بردى P2P", 99.1, 1280],
    ["u_m5", "shamotc", "شام OTC", 99.9, 4100],
    ["u_m6", "reefcash", "ريف كاش", 98.6, 220]
  ];

  extraMerchants.forEach(([id, username, displayName, rating, trades]) => {
    const p = hashPassword("pass123");
    users.push({
      id,
      username,
      email: `${username}@p2p.local`,
      displayName,
      passwordHash: p.hash,
      passwordSalt: p.salt,
      telegramId: null,
      telegramUsername: null,
      isMerchant: true,
      isAdmin: false,
      kycStatus: "verified",
      kyc: { fullName: displayName, nationalId: "", country: "SY", submittedAt: now(), reviewedAt: now(), note: "" },
      rating,
      completedTrades: trades,
      createdAt: now() - 86400000 * (100 + trades / 10),
      isDemo: true
    });
  });

  const wallets = [];
  users.forEach((u) => {
    const isMerchant = u.isMerchant;
    wallets.push(
      {
        userId: u.id,
        asset: "USDT",
        available: isMerchant ? 250000 : u.id === "u_demo" ? 1250.5 : 320,
        frozen: 0
      },
      {
        userId: u.id,
        asset: "BTC",
        available: isMerchant ? 2.15 : 0.012,
        frozen: 0
      },
      {
        userId: u.id,
        asset: "ETH",
        available: isMerchant ? 18.4 : 0.45,
        frozen: 0
      },
      {
        userId: u.id,
        asset: "USDC",
        available: isMerchant ? 80000 : 200,
        frozen: 0
      }
    );
  });

  const paymentMethods = [
    {
      id: "pm_m_sham",
      userId: "u_merchant",
      type: "SHAM_CASH",
      label: "شام كاش - تاجر الشام",
      details: { name: "تاجر الشام", address: "a4c8e19b7d02f6e5c1a3b8d0479e2f5a", account: "a4c8e19b7d02f6e5c1a3b8d0479e2f5a" },
      active: true
    },
    {
      id: "pm_demo_sham",
      userId: "u_demo",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "مستخدم تجريبي", address: "b5d9f20c8e13a7f6d2b4c9e1580f3a6b", account: "b5d9f20c8e13a7f6d2b4c9e1580f3a6b" },
      active: true
    },
    {
      id: "pm_buyer_sham",
      userId: "u_buyer",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "مشتري سريع", address: "c6e0a31d9f24b8a7e3c5d0f2691a4b7c", account: "c6e0a31d9f24b8a7e3c5d0f2691a4b7c" },
      active: true
    },
    {
      id: "pm_m1_sham",
      userId: "u_m1",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "مكتب الشام", address: "d7f1b42e0a35c9b8f4d6e1a3702b5c8d", account: "d7f1b42e0a35c9b8f4d6e1a3702b5c8d" },
      active: true
    },
    {
      id: "pm_m2_sham",
      userId: "u_m2",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "دمشق إكسشينج", address: "e8a2c53f1b46d0c9a5e7f2b4813c6d9e", account: "e8a2c53f1b46d0c9a5e7f2b4813c6d9e" },
      active: true
    },
    {
      id: "pm_m3_sham",
      userId: "u_m3",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "حلب كاش", address: "f9b3d64a2c57e1d0b6f8a3c5924d7e0f", account: "f9b3d64a2c57e1d0b6f8a3c5924d7e0f" },
      active: true
    },
    {
      id: "pm_m4_sham",
      userId: "u_m4",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "بردى P2P", address: "a0c4e75b3d68f2e1c7a9b4d6a35e8f10", account: "a0c4e75b3d68f2e1c7a9b4d6a35e8f10" },
      active: true
    },
    {
      id: "pm_m5_sham",
      userId: "u_m5",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "شام OTC", address: "b1d5f86c4e79a3f2d8b0c5e7b46f9a21", account: "b1d5f86c4e79a3f2d8b0c5e7b46f9a21" },
      active: true
    },
    {
      id: "pm_m6_sham",
      userId: "u_m6",
      type: "SHAM_CASH",
      label: "شام كاش",
      details: { name: "ريف كاش", address: "c2e6a97d5f80b4a3e9c1d6f8c57a0b32", account: "c2e6a97d5f80b4a3e9c1d6f8c57a0b32" },
      active: true
    }
  ];

  const ads = [
    {
      id: "ad_1",
      userId: "u_merchant",
      side: "SELL",
      asset: "USDT",
      fiat: "SYP",
      price: 14850,
      minAmount: 50,
      maxAmount: 5000,
      available: 42000,
      paymentTypes: ["SHAM_CASH"],
      terms: "حوّل عبر شام كاش ثم اضغط تم الدفع. يُفرج عن USDT بعد التحقق.",
      timeLimitMin: 15,
      status: "active",
      createdAt: now() - 86400000 * 10
    },
    {
      id: "ad_2",
      userId: "u_merchant",
      side: "BUY",
      asset: "USDT",
      fiat: "SYP",
      price: 14550,
      minAmount: 100,
      maxAmount: 8000,
      available: 20000,
      paymentTypes: ["SHAM_CASH"],
      terms: "أرسل USDT أولاً. تحويل شام كاش خلال 10 دقائق بعد الاستلام.",
      timeLimitMin: 20,
      status: "active",
      createdAt: now() - 86400000 * 8
    },
    {
      id: "ad_3",
      userId: "u_m1",
      side: "SELL",
      asset: "USDT",
      fiat: "SYP",
      price: 14920,
      minAmount: 200,
      maxAmount: 15000,
      available: 88000,
      paymentTypes: ["SHAM_CASH"],
      terms: "شام كاش فقط. لا تستخدم حساب طرف ثالث.",
      timeLimitMin: 30,
      status: "active",
      createdAt: now() - 86400000 * 20
    },
    {
      id: "ad_4",
      userId: "u_m2",
      side: "SELL",
      asset: "USDT",
      fiat: "SYP",
      price: 14780,
      minAmount: 20,
      maxAmount: 2000,
      available: 9500,
      paymentTypes: ["SHAM_CASH"],
      terms: "شام كاش. أرسل لقطة الشاشة في المحادثة.",
      timeLimitMin: 10,
      status: "active",
      createdAt: now() - 86400000 * 3
    },
    {
      id: "ad_5",
      userId: "u_m3",
      side: "SELL",
      asset: "USDT",
      fiat: "USD",
      price: 1.02,
      minAmount: 50,
      maxAmount: 3000,
      available: 18000,
      paymentTypes: ["SHAM_CASH"],
      terms: "بيع USDT مقابل دولار عبر شام كاش.",
      timeLimitMin: 20,
      status: "active",
      createdAt: now() - 86400000 * 5
    },
    {
      id: "ad_6",
      userId: "u_m5",
      side: "SELL",
      asset: "USDT",
      fiat: "USD",
      price: 1.015,
      minAmount: 100,
      maxAmount: 20000,
      available: 150000,
      paymentTypes: ["SHAM_CASH"],
      terms: "شام كاش بالدولار. الإفراج فوري بعد التأكيد.",
      timeLimitMin: 15,
      status: "active",
      createdAt: now() - 86400000 * 2
    },
    {
      id: "ad_7",
      userId: "u_m5",
      side: "BUY",
      asset: "USDT",
      fiat: "USD",
      price: 0.995,
      minAmount: 200,
      maxAmount: 30000,
      available: 90000,
      paymentTypes: ["SHAM_CASH"],
      terms: "نشتري USDT مقابل دولار عبر شام كاش.",
      timeLimitMin: 20,
      status: "active",
      createdAt: now() - 86400000 * 2
    },
    {
      id: "ad_8",
      userId: "u_m6",
      side: "SELL",
      asset: "USDT",
      fiat: "SYP",
      price: 14690,
      minAmount: 30,
      maxAmount: 2500,
      available: 12000,
      paymentTypes: ["SHAM_CASH"],
      terms: "ريف كاش عبر شام كاش. لا تذكر كلمة كريبتو في الملاحظة.",
      timeLimitMin: 12,
      status: "active",
      createdAt: now() - 86400000 * 7
    },
    {
      id: "ad_9",
      userId: "u_m4",
      side: "BUY",
      asset: "USDT",
      fiat: "SYP",
      price: 14480,
      minAmount: 50,
      maxAmount: 4000,
      available: 16000,
      paymentTypes: ["SHAM_CASH"],
      terms: "نشتري USDT بالليرة السورية عبر شام كاش.",
      timeLimitMin: 15,
      status: "active",
      createdAt: now() - 86400000 * 4
    },
    {
      id: "ad_10",
      userId: "u_m2",
      side: "BUY",
      asset: "USDT",
      fiat: "USD",
      price: 0.99,
      minAmount: 50,
      maxAmount: 3000,
      available: 12000,
      paymentTypes: ["SHAM_CASH"],
      terms: "شراء سريع عبر شام كاش بالدولار.",
      timeLimitMin: 12,
      status: "active",
      createdAt: now() - 86400000 * 1
    },
    {
      id: "ad_11",
      userId: "u_m1",
      side: "SELL",
      asset: "USDT",
      fiat: "SYP",
      price: 15010,
      minAmount: 100,
      maxAmount: 8000,
      available: 35000,
      paymentTypes: ["SHAM_CASH"],
      terms: "مكتب الشام. شام كاش فقط.",
      timeLimitMin: 20,
      status: "active",
      createdAt: now() - 86400000 * 6
    },
    {
      id: "ad_12",
      userId: "u_merchant",
      side: "SELL",
      asset: "USDT",
      fiat: "USD",
      price: 1.008,
      minAmount: 50,
      maxAmount: 4000,
      available: 22000,
      paymentTypes: ["SHAM_CASH"],
      terms: "بيع USDT مقابل دولار عبر شام كاش.",
      timeLimitMin: 15,
      status: "active",
      createdAt: now() - 86400000 * 1
    }
  ];

  ads.forEach((ad) => {
    if (ad.side !== "SELL") return;
    const w = wallets.find((x) => x.userId === ad.userId && x.asset === ad.asset);
    if (!w) return;
    const amt = Math.min(w.available, ad.available);
    w.available = Math.round((w.available - amt) * 1e8) / 1e8;
    w.frozen = Math.round((w.frozen + amt) * 1e8) / 1e8;
  });

  return {
    users,
    wallets,
    paymentMethods,
    ads,
    orders: [],
    messages: [],
    notifications: [],
    sessions: [],
    assets: defaultAssets(),
    fiats: defaultFiats(),
    paymentTypes: defaultPaymentTypes(),
    settings: defaultSettings(),
    kycRequests: [],
    deposits: [],
    withdrawals: [],
    supportTickets: [],
    deletedSupportIds: []
  };
}

let db = emptyDb();

function adminAdvancedKyc(existing) {
  const submittedAt = (existing && existing.submittedAt) || now() - 86400000 * 499;
  const reviewedAt = (existing && existing.reviewedAt) || submittedAt;
  return {
    fullName: (existing && existing.fullName) || "مدير المنصة",
    nationalId: (existing && existing.nationalId) || "01010010001",
    country: "SY",
    docType: (existing && existing.docType) || "id",
    level: "advanced",
    submittedAt,
    reviewedAt,
    note: "",
    files: Array.isArray(existing && existing.files) ? existing.files : []
  };
}

function ensureAdminReady(admin) {
  if (!admin) return admin;
  admin.isAdmin = true;
  admin.isMerchant = true;
  admin.merchantStatus = "approved";
  admin.kycStatus = "verified";
  admin.kycLevel = "advanced";
  admin.kycUpgradePending = false;
  admin.kyc = adminAdvancedKyc(admin.kyc);
  admin.accountFrozen = false;
  admin.fundsFrozen = false;
  admin.freezeReason = "";
  return admin;
}

function bindOwnerAdmin(data) {
  const ownerId = String((data.settings && data.settings.ownerTelegramId) || "1441524960");
  const admin =
    (data.users || []).find((u) => u.username === "ameralzman00") ||
    (data.users || []).find((u) => u.username === "admin") ||
    (data.users || []).find((u) => u.isAdmin);
  if (!admin) return data;
  const extra = (data.users || []).find((u) => u.id !== admin.id && String(u.telegramId) === ownerId);
  admin.username = "ameralzman00";
  admin.email = admin.email && admin.email !== "admin@p2p.local" ? admin.email : "ameralzman00@p2p.local";
  admin.telegramId = ownerId;
  ensureAdminReady(admin);
  if (extra) {
    if (extra.telegramUsername) admin.telegramUsername = extra.telegramUsername;
    if (extra.displayName && extra.displayName !== extra.username) admin.displayName = extra.displayName;
    extra.telegramId = null;
    extra.isAdmin = false;
  }
  return data;
}

const MERCHANT_BADGES = ["sponsored", "verified", "featured", "regular", "new"];

function migrate(data) {
  if (!data || typeof data !== "object") data = emptyDb();
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.wallets)) data.wallets = [];
  if (!Array.isArray(data.paymentMethods)) data.paymentMethods = [];
  if (!Array.isArray(data.ads)) data.ads = [];
  if (!Array.isArray(data.orders)) data.orders = [];
  if (!Array.isArray(data.messages)) data.messages = [];
  if (!Array.isArray(data.notifications)) data.notifications = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.assets) || !data.assets.length) data.assets = defaultAssets();
  if (!Array.isArray(data.fiats) || !data.fiats.length) data.fiats = defaultFiats();
  if (!Array.isArray(data.paymentTypes) || !data.paymentTypes.length) data.paymentTypes = defaultPaymentTypes();
  const prevSettings = data.settings || {};
  data.settings = {
    ...defaultSettings(),
    ...prevSettings,
    brand: String(prevSettings.brand || "USDT شام").trim().slice(0, 40) || "USDT شام",
    brandTagline: String(prevSettings.brandTagline || "منصة التداول P2P").trim().slice(0, 60) || "منصة التداول P2P",
    country: "SY",
    telegramBotUsername: prevSettings.telegramBotUsername || "EntrepreneurMA_bot",
    ownerTelegramId: prevSettings.ownerTelegramId || "1441524960",
    webAppUrl: resolveWebAppUrl(prevSettings.webAppUrl),
    requireMerchantForAd: prevSettings.requireMerchantForAd === false ? false : true,
    advancedKycUsdt: Number(prevSettings.advancedKycUsdt) || 2000,
    priceRanges: Array.isArray(prevSettings.priceRanges)
      ? prevSettings.priceRanges.map((r) => {
          const sellMin = Number(r.sellMin != null ? r.sellMin : r.min) || 0;
          const sellMax = Number(r.sellMax != null ? r.sellMax : r.max) || 0;
          const buyMin = Number(r.buyMin != null ? r.buyMin : r.min) || 0;
          const buyMax = Number(r.buyMax != null ? r.buyMax : r.max) || 0;
          return {
            asset: String(r.asset || "").toUpperCase(),
            fiat: String(r.fiat || "").toUpperCase(),
            min: sellMin,
            max: sellMax,
            sellMin,
            sellMax,
            buyMin,
            buyMax
          };
        })
      : [],
    featuredWeeklyTrades: Number(prevSettings.featuredWeeklyTrades || 50) || 50,
    featuredHoldDays: Number(prevSettings.featuredHoldDays || 3) || 3,
    verifiedMerchantVolumeUsdt: Number(prevSettings.verifiedMerchantVolumeUsdt || 1500) || 1500,
    featuredMerchantId: String(prevSettings.featuredMerchantId || ""),
    featuredGrantedAt: Number(prevSettings.featuredGrantedAt || 0),
    featuredMerchantIdDemo: String(prevSettings.featuredMerchantIdDemo || ""),
    featuredGrantedAtDemo: Number(prevSettings.featuredGrantedAtDemo || 0),
    supportTelegramId: String(prevSettings.supportTelegramId || "1441524960"),
    supportTelegramUsername: String(prevSettings.supportTelegramUsername || "Entrepreneurma").replace(/^@/, ""),
    requirePaymentProof: prevSettings.requirePaymentProof === false ? false : true,
    bep20Network: "BEP20",
    depositEnabled: prevSettings.depositEnabled === false ? false : true,
    withdrawEnabled: prevSettings.withdrawEnabled === false ? false : true,
    treasuryWallets: Array.isArray(prevSettings.treasuryWallets) ? prevSettings.treasuryWallets : [],
    priceMode: String(prevSettings.priceMode || "manual") === "auto" ? "auto" : "manual",
    buySpreadPct: Number(prevSettings.buySpreadPct || 0) || 0,
    sellSpreadPct: Number(prevSettings.sellSpreadPct || 0) || 0,
    manualBuyPrice: Number(prevSettings.manualBuyPrice || 0) || 0,
    manualSellPrice: Number(prevSettings.manualSellPrice || 0) || 0,
    priceApiUrl: String(prevSettings.priceApiUrl || ""),
    priceApiKey: String(prevSettings.priceApiKey || ""),
    priceApiKeyHeader: String(prevSettings.priceApiKeyHeader || "X-API-Key"),
    priceJsonPath: String(prevSettings.priceJsonPath || ""),
    appEnabled: prevSettings.appEnabled === false ? false : true,
    appDisabledMessage: String(prevSettings.appDisabledMessage || "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً.").slice(0, 400)
  };
  data.settings.treasuryWallets = normalizeTreasuryWallets(data.settings);
  if (!Array.isArray(data.kycRequests)) data.kycRequests = [];
  if (!Array.isArray(data.deposits)) data.deposits = [];
  if (!Array.isArray(data.withdrawals)) data.withdrawals = [];
  if (!Array.isArray(data.transfers)) data.transfers = [];
  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];
  if (!Array.isArray(data.deletedSupportIds)) data.deletedSupportIds = [];
  if (data.deletedSupportIds.length) {
    const gone = new Set(data.deletedSupportIds);
    data.supportTickets = data.supportTickets.filter((t) => t && t.id && !gone.has(t.id));
  }
  const usedUids = new Set();
  (data.users || []).forEach((u) => {
    if (u.uidCode) usedUids.add(String(u.uidCode));
  });
  (data.users || []).forEach((u) => {
    if (u.uidCode) return;
    let code = "";
    for (let i = 0; i < 80; i++) {
      code = String(10000000 + crypto.randomInt(90000000));
      if (!usedUids.has(code)) break;
    }
    if (!code || usedUids.has(code)) code = String(Date.now()).slice(-8) + String(crypto.randomInt(90));
    u.uidCode = code;
    usedUids.add(code);
  });
  const serialAds = (data.ads || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let nextSerial = Math.max(100000, Number(data.adCounter) || 100000);
  serialAds.forEach((ad) => {
    if (!ad.serial) {
      nextSerial += 1;
      ad.serial = nextSerial;
    } else {
      nextSerial = Math.max(nextSerial, Number(ad.serial) || 0);
    }
  });
  data.adCounter = nextSerial;
  (data.ads || []).forEach((ad) => {
    if (ad.priceType !== "floating") ad.priceType = "fixed";
    const r = Number(ad.floatRatio);
    ad.floatRatio = ad.priceType === "floating" && r > 0 ? r : 1;
  });
  (data.notifications || []).forEach((n) => {
    if (n.read === undefined) n.read = false;
    if (!n.href && n.extra) n.href = n.extra.href || "";
  });
  const year = 365 * 24 * 60 * 60 * 1000;
  (data.sessions || []).forEach((s) => {
    if (!s) return;
    if (!s.expiresAt || s.expiresAt < Date.now() + year / 2) s.expiresAt = Date.now() + year;
  });
  (data.users || []).forEach((u) => {
    if (!u.kyc) u.kyc = null;
    if (!u.kycStatus) u.kycStatus = "pending";
    if (u.kyc && u.kyc.country === "EG") u.kyc.country = "SY";
    if (!u.merchantStatus) u.merchantStatus = u.isMerchant ? "approved" : "none";
    if (!u.kycLevel) u.kycLevel = u.kycStatus === "verified" ? "basic" : "none";
    if (u.isAdmin) ensureAdminReady(u);
    if (u.displayNameChangedAt == null) u.displayNameChangedAt = 0;
    if (u.accountFrozen == null) u.accountFrozen = false;
    if (u.fundsFrozen == null) u.fundsFrozen = false;
    if (u.freezeReason == null) u.freezeReason = "";
    if (u.tradePinFails == null) u.tradePinFails = 0;
    if (u.tradePinLockedUntil == null) u.tradePinLockedUntil = 0;
    if (u.merchantBadgeMode !== "manual" && u.merchantBadgeMode !== "auto") {
      u.merchantBadgeMode = MERCHANT_BADGES.includes(String(u.merchantBadge || "").trim()) ? "manual" : "auto";
    }
    if (u.merchantBadgeMode === "auto") u.merchantBadge = null;
  });
  const adminUser =
    (data.users || []).find((u) => u.username === "ameralzman00") ||
    (data.users || []).find((u) => u.username === "admin") ||
    (data.users || []).find((u) => u.isAdmin);
  if (adminUser) {
    adminUser.username = "ameralzman00";
    adminUser.isAdmin = true;
    if (!adminUser.email || adminUser.email === "admin@p2p.local") adminUser.email = "ameralzman00@p2p.local";
    if (!verifyPassword("ameralzman199200", adminUser.passwordSalt, adminUser.passwordHash)) {
      const cred = hashPassword("ameralzman199200");
      adminUser.passwordHash = cred.hash;
      adminUser.passwordSalt = cred.salt;
    }
  }
  bindOwnerAdmin(data);
  (data.ads || []).forEach((ad) => {
    ad.paymentTypes = ["SHAM_CASH"];
    if (ad.fiat === "EGP" || ad.fiat === "SAR" || ad.fiat === "AED") {
      if (ad.asset === "USDT") ad.price = ad.fiat === "EGP" ? Math.round(ad.price * 300) : 14750;
      ad.fiat = "SYP";
    }
    if (ad.asset !== "USDT") {
      ad.asset = "USDT";
      ad.fiat = ad.fiat === "USD" ? "USD" : "SYP";
    }
  });
  (data.orders || []).forEach((o) => {
    if (!Array.isArray(o.evidence)) o.evidence = [];
    o.isDemo = !!(o.isDemo || isDemoUser((data.users || []).find((u) => u.id === o.buyerId)) || isDemoUser((data.users || []).find((u) => u.id === o.sellerId)));
    if (o.paymentDetails && typeof o.paymentDetails === "object") {
      delete o.paymentDetails.phone;
    } else {
      o.paymentDetails = {};
    }
    const seller = (data.users || []).find((u) => u.id === o.sellerId);
    if (seller && (!o.paymentDetails.name || !(o.paymentDetails.address || o.paymentDetails.account))) {
      const legalName = String((seller.kyc && seller.kyc.fullName) || "").trim();
      const method = (data.paymentMethods || []).find(
        (m) => m.userId === seller.id && m.active !== false && (m.type === (o.paymentType || "SHAM_CASH") || m.type === "SHAM_CASH")
      );
      const src = method && method.details ? method.details : {};
      if (legalName && !o.paymentDetails.name) o.paymentDetails.name = legalName;
      const addr = String(src.address || src.account || o.paymentDetails.address || o.paymentDetails.account || "")
        .replace(/^0x/i, "")
        .trim()
        .toLowerCase();
      if (/^[a-fA-F0-9]{32}$/.test(addr)) {
        o.paymentDetails.address = addr;
        o.paymentDetails.account = addr;
      }
      if (!o.paymentLabel && method) o.paymentLabel = method.label;
      if (!o.paymentType) o.paymentType = "SHAM_CASH";
    }
  });
  (data.ads || []).forEach((ad) => {
    ad.isDemo = !!(ad.isDemo || isDemoUser((data.users || []).find((u) => u.id === ad.userId)));
  });
  const keptPay = [];
  const seenPay = new Set();
  (data.paymentMethods || []).forEach((m) => {
    if (!m.type) m.type = "SHAM_CASH";
    if (!m.details) m.details = {};
    const owner = (data.users || []).find((u) => u.id === m.userId);
    const legalName = String((owner && owner.kyc && owner.kyc.fullName) || "").trim();
    if (legalName) m.details.name = legalName;
    if (m.details.raw) delete m.details.raw;
    const addr = String(m.details.address || m.details.account || "").replace(/^0x/i, "").trim();
    if (/^[a-fA-F0-9]{32}$/.test(addr)) {
      m.details.address = addr.toLowerCase();
      m.details.account = addr.toLowerCase();
    }
    delete m.details.phone;
    if (m.active === false) return;
    const key = `${m.userId}:${m.type}`;
    if (seenPay.has(key)) return;
    seenPay.add(key);
    keptPay.push(m);
  });
  data.paymentMethods = keptPay;
  return data;
}

const LOCK_PATH = path.join(DATA_DIR, "db.lock");
let lockDepth = 0;

function sleepSync(ms) {
  const end = Date.now() + Number(ms || 0);
  while (Date.now() < end) {
    /* wait */
  }
}

function lockHolderLive(pid) {
  const n = Number(pid);
  if (!n) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  if (lockDepth > 0) {
    lockDepth += 1;
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (let i = 0; i < 80; i += 1) {
    try {
      const fd = fs.openSync(LOCK_PATH, "wx");
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      lockDepth = 1;
      return;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
      try {
        const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
        const pid = Number(fs.readFileSync(LOCK_PATH, "utf8"));
        if (!lockHolderLive(pid) || age > 8000) fs.unlinkSync(LOCK_PATH);
      } catch {
        /* retry */
      }
      sleepSync(25);
    }
  }
  lockDepth = 1;
}

function releaseLock() {
  if (lockDepth > 1) {
    lockDepth -= 1;
    return;
  }
  lockDepth = 0;
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

function indexById(list) {
  const map = new Map();
  (list || []).forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });
  return map;
}

function unionById(primary, secondary) {
  const map = indexById(secondary);
  (primary || []).forEach((item) => {
    if (!item || !item.id) return;
    map.set(item.id, item);
  });
  const seen = new Set();
  const out = [];
  (primary || []).forEach((item) => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(map.get(item.id) || item);
  });
  (secondary || []).forEach((item) => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  });
  return out;
}

function mergeNotifications(primary, secondary) {
  const disk = indexById(secondary);
  const mem = indexById(primary);
  const ids = new Set([...mem.keys(), ...disk.keys()]);
  const out = [];
  const seen = new Set();
  function pushId(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const a = mem.get(id);
    const b = disk.get(id);
    const row = { ...(b || {}), ...(a || {}) };
    row.telegramPushed = !!(a && a.telegramPushed) || !!(b && b.telegramPushed);
    out.push(row);
  }
  (primary || []).forEach((n) => n && n.id && pushId(n.id));
  (secondary || []).forEach((n) => n && n.id && pushId(n.id));
  ids.forEach((id) => pushId(id));
  return out;
}

function applyDisk(parsed) {
  Object.keys(db).forEach((key) => {
    if (!(key in parsed)) delete db[key];
  });
  Object.assign(db, parsed);
}

const DB_BAK = `${DB_PATH}.bak`;
const DB_BAK2 = `${DB_PATH}.bak2`;

function parseDbFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("invalid db");
  return migrate(parsed);
}

function dbFileHealthy(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return !!(parsed && typeof parsed === "object" && Array.isArray(parsed.users));
  } catch {
    return false;
  }
}

function rotateDbBackups() {
  if (!dbFileHealthy(DB_PATH)) return;
  try {
    if (fs.existsSync(DB_BAK)) {
      const age = Date.now() - fs.statSync(DB_BAK).mtimeMs;
      if (age < 60 * 60 * 1000) return;
      fs.copyFileSync(DB_BAK, DB_BAK2);
    }
  } catch {
    /* ignore */
  }
  try {
    fs.copyFileSync(DB_PATH, DB_BAK);
  } catch {
    /* ignore */
  }
}

function readDisk() {
  return parseDbFile(DB_PATH);
}

function loadFromBackups() {
  for (const file of [DB_BAK, DB_BAK2]) {
    try {
      const parsed = parseDbFile(file);
      if (parsed) {
        console.error(`db.json damaged; restored from ${path.basename(file)} (${(parsed.users || []).length} users)`);
        return parsed;
      }
    } catch (err) {
      console.error(`backup ${path.basename(file)} unreadable:`, err && err.message);
    }
  }
  return null;
}

function recoverLiveDb() {
  const recovered = loadFromBackups();
  if (recovered && (recovered.users || []).length) return recovered;
  if (path.resolve(DATA_DIR) === path.resolve(BUNDLED_DATA_DIR)) return recovered;
  for (const file of [path.join(BUNDLED_DATA_DIR, "db.json"), path.join(BUNDLED_DATA_DIR, "db.json.bak"), path.join(BUNDLED_DATA_DIR, "db.json.bak2")]) {
    try {
      const parsed = parseDbFile(file);
      if (parsed && (parsed.users || []).length) {
        console.error(`migrating ${(parsed.users || []).length} users from ${file} into ${DB_PATH}`);
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return recovered;
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`USDT Sham data: ${DB_PATH}`);
  if (!fs.existsSync(DB_PATH)) {
    const recovered = recoverLiveDb();
    if (recovered) {
      db = recovered;
      save();
      return;
    }
    console.error("no existing user database; starting a new empty store (accounts are not deleted from a previous disk if DATA_DIR=/var/data is mounted)");
    db = emptyDb();
    const admin = seedDb();
    const keepAdmin = (admin.users || []).find((u) => u && u.isAdmin);
    if (keepAdmin) {
      db.users = [keepAdmin];
      db.wallets = (admin.wallets || []).filter((w) => w.userId === keepAdmin.id);
    }
    save();
    return;
  }
  try {
    db = parseDbFile(DB_PATH);
    refreshFeaturedMerchant();
    save();
  } catch (err) {
    console.error("db.json parse failed, keeping user data via backup:", err && err.message);
    const recovered = recoverLiveDb();
    if (recovered) {
      db = recovered;
      save();
      return;
    }
    console.error("no healthy backup; leaving db.json untouched and using empty memory until a valid file exists");
    db = emptyDb();
  }
}

function reloadLocked() {
  try {
    const parsed = readDisk();
    if (!parsed) return false;
    applyDisk(parsed);
    return true;
  } catch {
    return false;
  }
}

function reload() {
  acquireLock();
  try {
    return reloadLocked();
  } finally {
    releaseLock();
  }
}

function saveLocked() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let disk = null;
  try {
    disk = readDisk();
  } catch {
    disk = null;
  }
  if (!disk && fs.existsSync(DB_PATH) && !(db.users && db.users.length)) {
    throw new Error("refusing to overwrite unreadable db.json with empty memory");
  }
  if (disk) {
    const diskUsers = disk.users || [];
    const memUsers = db.users || [];
    if (diskUsers.length && !memUsers.length) {
      db.users = diskUsers;
      db.wallets = disk.wallets || db.wallets;
      db.paymentMethods = disk.paymentMethods || db.paymentMethods;
      db.kycRequests = disk.kycRequests || db.kycRequests;
      db.deposits = disk.deposits || db.deposits;
      db.withdrawals = disk.withdrawals || db.withdrawals;
      db.transfers = disk.transfers || db.transfers;
    }
    db.messages = unionById(db.messages, disk.messages);
    db.orders = unionById(db.orders, disk.orders);
    db.notifications = mergeNotifications(db.notifications, disk.notifications);
    db.ads = unionById(db.ads, disk.ads);
    const gone = new Set([...(db.deletedSupportIds || []), ...(disk.deletedSupportIds || [])]);
    db.deletedSupportIds = Array.from(gone).slice(-5000);
    db.supportTickets = unionById(db.supportTickets, disk.supportTickets).filter((t) => t && t.id && !gone.has(t.id));
    const sessMap = new Map();
    (disk.sessions || []).forEach((s) => {
      if (s && s.token) sessMap.set(s.token, s);
    });
    (db.sessions || []).forEach((s) => {
      if (s && s.token) sessMap.set(s.token, s);
    });
    db.sessions = Array.from(sessMap.values()).filter((s) => s && s.expiresAt > Date.now() - 86400000);
  }
  rotateDbBackups();
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function save() {
  acquireLock();
  try {
    saveLocked();
  } catch (err) {
    console.error("db save skipped:", err && err.message);
  } finally {
    releaseLock();
  }
}

function claimTelegramNotifications(limit) {
  acquireLock();
  try {
    reloadLocked();
    const cap = Math.max(1, Number(limit) || 20);
    const queue = (db.notifications || [])
      .filter((n) => n && !n.telegramPushed)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(0, cap);
    queue.forEach((n) => {
      n.telegramPushed = true;
    });
    if (queue.length) saveLocked();
    return queue.map((n) => ({
      id: n.id,
      userId: n.userId,
      title: n.title,
      body: n.body,
      extra: n.extra || {},
      createdAt: n.createdAt
    }));
  } finally {
    releaseLock();
  }
}

load();

function publicKyc(kyc) {
  if (!kyc) return null;
  return {
    fullName: kyc.fullName || "",
    nationalId: kyc.nationalId || "",
    country: kyc.country || "",
    documentType: kyc.documentType || "id",
    phone: kyc.phone || "",
    address: kyc.address || "",
    submittedAt: kyc.submittedAt || null,
    reviewedAt: kyc.reviewedAt || null,
    note: kyc.note || "",
    files: ((kyc.files || []).map((f) => ({
      id: f.id,
      kind: f.kind,
      name: f.name,
      mime: f.mime,
      size: f.size
    }))),
    level: kyc.level || "basic"
  };
}

function nextUidCode() {
  const used = new Set((db.users || []).map((u) => String(u.uidCode || "")));
  for (let i = 0; i < 80; i++) {
    const code = String(10000000 + crypto.randomInt(90000000));
    if (!used.has(code)) return code;
  }
  return String(Date.now()).slice(-8);
}

function findUserByUid(q) {
  const key = String(q || "").trim().replace(/^@/, "");
  if (!key) return null;
  return (
    db.users.find((u) => String(u.uidCode) === key) ||
    db.users.find((u) => u.username === key.toLowerCase()) ||
    db.users.find((u) => String(u.telegramUsername || "").toLowerCase() === key.toLowerCase()) ||
    null
  );
}

const MERCHANT_BADGE_RANK = { sponsored: 0, verified: 1, featured: 2, regular: 3, new: 4 };

function orderUsdtAmount(order) {
  if (!order) return 0;
  if (String(order.asset || "").toUpperCase() === "USDT") return Number(order.amount) || 0;
  const price = Number(order.price) || 0;
  if (price > 0) return (Number(order.fiatAmount) || 0) / price;
  return 0;
}

function completedOrdersOf(userId, since) {
  const from = Number(since) || 0;
  return (db.orders || []).filter(
    (o) =>
      o.status === "completed" &&
      (o.buyerId === userId || o.sellerId === userId) &&
      (!from || Number(o.releasedAt || o.updatedAt || 0) >= from)
  );
}

function weeklyTradeCount(userId) {
  return completedOrdersOf(userId, now() - 7 * 24 * 60 * 60 * 1000).length;
}

function weeklyUsdtVolume(userId) {
  return completedOrdersOf(userId, now() - 7 * 24 * 60 * 60 * 1000).reduce((s, o) => s + orderUsdtAmount(o), 0);
}

function lifetimeUsdtVolume(userId) {
  return completedOrdersOf(userId, 0).reduce((s, o) => s + orderUsdtAmount(o), 0);
}

function hasCreditedDeposit(userId) {
  return (db.deposits || []).some((d) => d.userId === userId && d.status === "credited");
}

function featuredHoldMs() {
  const days = Number((db.settings && db.settings.featuredHoldDays) || 3) || 3;
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function featuredNeedTrades() {
  return Number((db.settings && db.settings.featuredWeeklyTrades) || 50) || 50;
}

function verifiedNeedVolume() {
  return Number((db.settings && db.settings.verifiedMerchantVolumeUsdt) || 1500) || 1500;
}

function isApprovedMerchant(user) {
  return !!(user && (user.isMerchant || user.merchantStatus === "approved"));
}

function pickFeaturedWinner(list) {
  const need = featuredNeedTrades();
  const eligible = (list || []).filter((u) => {
    if (!isApprovedMerchant(u) || u.isAdmin) return false;
    if (u.merchantBadgeMode === "manual") return false;
    if (u.kycStatus === "verified" && u.kycLevel === "advanced" && lifetimeUsdtVolume(u.id) >= verifiedNeedVolume()) {
      return false;
    }
    return weeklyTradeCount(u.id) >= need;
  });
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    const vol = weeklyUsdtVolume(b.id) - weeklyUsdtVolume(a.id);
    if (Math.abs(vol) > 1e-8) return vol;
    return weeklyTradeCount(b.id) - weeklyTradeCount(a.id);
  });
  return eligible[0];
}

function refreshFeaturedSlot(isDemo) {
  const keyId = isDemo ? "featuredMerchantIdDemo" : "featuredMerchantId";
  const keyAt = isDemo ? "featuredGrantedAtDemo" : "featuredGrantedAt";
  const merchants = (db.users || []).filter((u) => isApprovedMerchant(u) && isDemoUser(u) === !!isDemo);
  const winner = pickFeaturedWinner(merchants);
  if (!winner) {
    if (db.settings[keyId]) {
      db.settings[keyId] = "";
      db.settings[keyAt] = 0;
      return true;
    }
    return false;
  }
  const currentId = String(db.settings[keyId] || "");
  const grantedAt = Number(db.settings[keyAt] || 0);
  const current = merchants.find((u) => u.id === currentId) || null;
  const expired = !current || !grantedAt || now() > grantedAt + featuredHoldMs();
  const currentVol = current ? weeklyUsdtVolume(current.id) : -1;
  const winnerVol = weeklyUsdtVolume(winner.id);
  const challenged = current && winner.id !== current.id && winnerVol > currentVol + 1e-8;
  if (!currentId || expired || challenged) {
    if (currentId === winner.id && !expired && !challenged) return false;
    db.settings[keyId] = winner.id;
    db.settings[keyAt] = now();
    return true;
  }
  return false;
}

function refreshFeaturedMerchant() {
  const liveChanged = refreshFeaturedSlot(false);
  const demoChanged = refreshFeaturedSlot(true);
  return liveChanged || demoChanged;
}

function currentFeaturedId(user) {
  const demo = isDemoUser(user);
  return String((db.settings && (demo ? db.settings.featuredMerchantIdDemo : db.settings.featuredMerchantId)) || "");
}

function featuredUntilOf(user) {
  if (!user) return 0;
  const demo = isDemoUser(user);
  const id = String((db.settings && (demo ? db.settings.featuredMerchantIdDemo : db.settings.featuredMerchantId)) || "");
  if (id !== user.id) return 0;
  const grantedAt = Number((db.settings && (demo ? db.settings.featuredGrantedAtDemo : db.settings.featuredGrantedAt)) || 0);
  return grantedAt ? grantedAt + featuredHoldMs() : 0;
}

function resolveMerchantBadge(user) {
  if (!user) return "new";
  const override = String(user.merchantBadge || "").trim();
  if (user.merchantBadgeMode === "manual" && MERCHANT_BADGES.includes(override)) return override;
  if (user.isAdmin) return "sponsored";
  if (!isApprovedMerchant(user)) return "new";
  if (user.kycStatus === "verified" && user.kycLevel === "advanced" && lifetimeUsdtVolume(user.id) >= verifiedNeedVolume()) {
    return "verified";
  }
  if (currentFeaturedId(user) === user.id) return "featured";
  if (hasCreditedDeposit(user.id)) return "regular";
  return "new";
}

function setMerchantBadgeManual(user, badge) {
  if (!user) return;
  if (badge === "auto" || badge === "" || badge == null) {
    user.merchantBadgeMode = "auto";
    user.merchantBadge = null;
    return;
  }
  if (!MERCHANT_BADGES.includes(badge)) {
    throw new Error("شارة التاجر غير صالحة");
  }
  user.merchantBadgeMode = "manual";
  user.merchantBadge = badge;
}

function completeTradeStats(order) {
  if (!order) return;
  [order.buyerId, order.sellerId].forEach((id) => {
    const u = (db.users || []).find((x) => x.id === id);
    if (u) u.completedTrades = Number(u.completedTrades || 0) + 1;
  });
  refreshFeaturedMerchant();
}

function merchantBadgeRank(badge) {
  const key = MERCHANT_BADGES.includes(badge) ? badge : "new";
  return MERCHANT_BADGE_RANK[key];
}

function isDemoUser(u) {
  return !!(u && u.isDemo);
}

function userById(id) {
  return (db.users || []).find((u) => u.id === id) || null;
}

function sameSandbox(a, b) {
  return isDemoUser(a) === isDemoUser(b);
}

function adIsDemo(ad) {
  if (!ad) return false;
  if (ad.isDemo === true) return true;
  return isDemoUser(userById(ad.userId));
}

function orderIsDemo(order) {
  if (!order) return false;
  if (order.isDemo === true) return true;
  return isDemoUser(userById(order.buyerId)) || isDemoUser(userById(order.sellerId));
}

function liveUsers(list) {
  return (list || db.users || []).filter((u) => !isDemoUser(u));
}

function liveItemsByUser(list, userIdKey) {
  const key = userIdKey || "userId";
  return (list || []).filter((item) => !isDemoUser(userById(item[key])));
}

function totpDayKey() {
  const d = new Date(now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function publicUser(u) {
  if (!u) return null;
  const badge = resolveMerchantBadge(u);
  return {
    id: u.id,
    uidCode: u.uidCode || "",
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    displayNameChangedAt: Number(u.displayNameChangedAt || 0),
    nextDisplayNameChangeAt: Number(u.displayNameChangedAt || 0) ? Number(u.displayNameChangedAt) + 60 * 24 * 60 * 60 * 1000 : 0,
    canChangeDisplayName: !Number(u.displayNameChangedAt || 0) || now() >= Number(u.displayNameChangedAt) + 60 * 24 * 60 * 60 * 1000,
    telegramId: u.telegramId || null,
    telegramUsername: u.telegramUsername || null,
    isMerchant: !!u.isMerchant,
    merchantStatus: u.merchantStatus || (u.isMerchant ? "approved" : "none"),
    merchantShop: u.merchantShop || "",
    merchantNote: u.merchantNote || "",
    merchantDecisionNote: u.merchantDecisionNote || "",
    merchantBadge: badge,
    merchantBadgeOverride: u.merchantBadgeMode === "manual" && MERCHANT_BADGES.includes(String(u.merchantBadge || "").trim()) ? u.merchantBadge : "auto",
    merchantBadgeMode: u.merchantBadgeMode === "manual" ? "manual" : "auto",
    weeklyTrades: weeklyTradeCount(u.id),
    weeklyUsdtVolume: Math.round(weeklyUsdtVolume(u.id) * 100) / 100,
    lifetimeUsdtVolume: Math.round(lifetimeUsdtVolume(u.id) * 100) / 100,
    featuredUntil: featuredUntilOf(u),
    isAdmin: !!u.isAdmin,
    kycStatus: u.kycStatus,
    kycLevel: u.kycLevel || (u.kycStatus === "verified" ? "basic" : "none"),
    kycUpgradePending: !!u.kycUpgradePending,
    kyc: publicKyc(u.kyc),
    rating: u.rating,
    completedTrades: u.completedTrades,
    createdAt: u.createdAt,
    isDemo: !!u.isDemo,
    totpEnabled: !!u.totpEnabled,
    totpDayRequired: !!(u.totpEnabled && u.totpDayVerified !== totpDayKey()),
    tradePinSet: hasTradePin(u),
    tradePinLocked: isTradePinLocked(u),
    accountFrozen: !!u.accountFrozen,
    fundsFrozen: !!u.fundsFrozen,
    freezeReason: u.freezeReason || "",
    hasAvatar: !!(u.avatar && u.avatar.storedName),
    avatarAt: u.avatar && u.avatar.updatedAt ? u.avatar.updatedAt : 0
  };
}

function getWallet(userId, asset) {
  let w = db.wallets.find((x) => x.userId === userId && x.asset === asset);
  if (!w) {
    w = { userId, asset, available: 0, frozen: 0 };
    db.wallets.push(w);
  }
  return w;
}

function freeze(userId, asset, amount) {
  const w = getWallet(userId, asset);
  if (w.available < amount - 1e-10) return false;
  w.available = round(w.available - amount, 8);
  w.frozen = round(w.frozen + amount, 8);
  return true;
}

function unfreeze(userId, asset, amount) {
  const w = getWallet(userId, asset);
  const a = Math.min(w.frozen, amount);
  w.frozen = round(w.frozen - a, 8);
  w.available = round(w.available + a, 8);
}

function settleFrozen(userId, asset, amount) {
  const w = getWallet(userId, asset);
  const a = Math.min(w.frozen, amount);
  w.frozen = round(w.frozen - a, 8);
  return a;
}

function releaseFrozenTo(fromId, toId, asset, amount) {
  const from = getWallet(fromId, asset);
  const to = getWallet(toId, asset);
  if (from.frozen < amount - 1e-10) return false;
  from.frozen = round(from.frozen - amount, 8);
  to.available = round(to.available + amount, 8);
  return true;
}

function credit(userId, asset, amount) {
  const w = getWallet(userId, asset);
  w.available = round(w.available + amount, 8);
}

function debit(userId, asset, amount) {
  const w = getWallet(userId, asset);
  if (w.available < amount - 1e-10) return false;
  w.available = round(w.available - amount, 8);
  return true;
}

function calcPctFee(amount, pct) {
  const a = Number(amount) || 0;
  const p = Number(pct) || 0;
  if (!(a > 0) || !(p > 0)) return 0;
  return round((a * p) / 100, 8);
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round((n + Number.EPSILON) * p) / p;
}

function notificationHref(extra, { admin } = {}) {
  const e = extra || {};
  if (e.href) return String(e.href);
  if (e.supportTicketId) return admin ? `/admin?tab=support&ticket=${encodeURIComponent(e.supportTicketId)}` : "/support";
  if (e.orderId) return admin ? `/admin?tab=orders&order=${encodeURIComponent(e.orderId)}` : `/orders/${e.orderId}`;
  if (e.adId) return admin ? `/admin?tab=ads` : `/ads/${e.adId}/edit`;
  if (e.depositId) return admin ? `/admin?tab=deposits` : "/wallet";
  if (e.withdrawalId) return admin ? `/admin?tab=withdrawals` : "/wallet";
  if (e.kycUserId) return `/admin?tab=kyc&user=${encodeURIComponent(e.kycUserId)}`;
  if (e.merchantUserId) return `/admin?tab=merchants&user=${encodeURIComponent(e.merchantUserId)}`;
  if (e.userId && admin) return `/admin?tab=users&user=${encodeURIComponent(e.userId)}`;
  if (e.transferId) return "/wallet";
  return admin ? "/admin" : "/notifications";
}

function notify(userId, title, body, extra) {
  const target = (db.users || []).find((u) => u.id === userId);
  const payload = extra || {};
  const href = payload.href || notificationHref(payload, { admin: !!(target && target.isAdmin) });
  db.notifications.unshift({
    id: uid("n"),
    userId,
    title,
    body,
    extra: { ...payload, href },
    href,
    read: false,
    telegramPushed: false,
    createdAt: now()
  });
}

function supportTickets() {
  if (!Array.isArray(db.supportTickets)) db.supportTickets = [];
  return db.supportTickets;
}

function publicSupportTicket(t, { withMessages } = {}) {
  if (!t) return null;
  const msgs = Array.isArray(t.messages) ? t.messages : [];
  const last = msgs[msgs.length - 1] || null;
  const out = {
    id: t.id,
    userId: t.userId,
    status: t.status || "open",
    subject: t.subject || "طلب دعم",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt || t.createdAt,
    closedAt: t.closedAt || null,
    closedBy: t.closedBy || null,
    rating: Number(t.rating) || 0,
    ratingComment: t.ratingComment || "",
    lastMessage: last ? { from: last.from, text: String(last.text || "").slice(0, 160), createdAt: last.createdAt } : null,
    messageCount: msgs.length
  };
  if (withMessages) {
    out.messages = msgs.map((m) => ({
      id: m.id,
      from: m.from,
      userId: m.userId || null,
      text: m.text || "",
      createdAt: m.createdAt
    }));
  }
  return out;
}

function userOpenTicket(userId) {
  return supportTickets().find((t) => t.userId === userId && t.status === "open") || null;
}

function createSupportTicket(user, text, subject) {
  const body = String(text || "").trim().slice(0, 2000);
  if (body.length < 4) throw new Error("اكتب رسالتك للدعم (4 أحرف على الأقل).");
  let ticket = userOpenTicket(user.id);
  const msg = {
    id: uid("sm"),
    from: "user",
    userId: user.id,
    text: body,
    createdAt: now()
  };
  if (ticket) {
    ticket.messages.push(msg);
    ticket.updatedAt = now();
    ticket.status = "open";
  } else {
    ticket = {
      id: uid("sup"),
      userId: user.id,
      subject: String(subject || "طلب دعم").trim().slice(0, 80) || "طلب دعم",
      status: "open",
      messages: [msg],
      createdAt: now(),
      updatedAt: now(),
      closedAt: null,
      isDemo: !!user.isDemo
    };
    supportTickets().unshift(ticket);
  }
  liveUsers()
    .filter((u) => u.isAdmin)
    .forEach((a) => notify(a.id, "رسالة دعم جديدة", `${user.username}: ${body.slice(0, 80)}`, { supportTicketId: ticket.id }));
  return ticket;
}

function replySupportTicket(ticket, adminUser, text) {
  const body = String(text || "").trim().slice(0, 2000);
  if (body.length < 1) throw new Error("اكتب الرد.");
  if (!ticket) throw new Error("التذكرة غير موجودة");
  ticket.messages.push({
    id: uid("sm"),
    from: "admin",
    userId: adminUser.id,
    text: body,
    createdAt: now()
  });
  ticket.status = "open";
  ticket.updatedAt = now();
  ticket.closedAt = null;
  notify(ticket.userId, "رد من الدعم", body.slice(0, 160), { supportTicketId: ticket.id });
  return ticket;
}

function addSupportBotMessage(ticket, text) {
  const body = String(text || "").trim().slice(0, 2000);
  if (!body || !ticket) return ticket;
  ticket.messages.push({
    id: uid("sm"),
    from: "bot",
    userId: null,
    text: body,
    createdAt: now()
  });
  ticket.updatedAt = now();
  return ticket;
}

function closeSupportTicket(ticket, { by, rating, comment } = {}) {
  if (!ticket) throw new Error("التذكرة غير موجودة");
  ticket.status = "closed";
  ticket.closedAt = now();
  ticket.closedBy = by || "user";
  ticket.updatedAt = now();
  const stars = Number(rating);
  if (stars >= 1 && stars <= 5) ticket.rating = Math.round(stars);
  if (comment) ticket.ratingComment = String(comment).trim().slice(0, 400);
  return ticket;
}

function deleteSupportTicket(ticket) {
  if (!ticket) throw new Error("التذكرة غير موجودة");
  const id = ticket.id;
  const userId = ticket.userId;
  db.supportTickets = supportTickets().filter((t) => t.id !== id);
  if (!Array.isArray(db.deletedSupportIds)) db.deletedSupportIds = [];
  if (!db.deletedSupportIds.includes(id)) db.deletedSupportIds.push(id);
  if (db.deletedSupportIds.length > 5000) db.deletedSupportIds = db.deletedSupportIds.slice(-4000);
  db.notifications = (db.notifications || []).filter((n) => !(n.extra && n.extra.supportTicketId === id));
  return { id, userId };
}

function wipeSupportData() {
  const ids = supportTickets().map((t) => t.id);
  db.supportTickets = [];
  if (!Array.isArray(db.deletedSupportIds)) db.deletedSupportIds = [];
  ids.forEach((id) => {
    if (id && !db.deletedSupportIds.includes(id)) db.deletedSupportIds.push(id);
  });
  db.notifications = (db.notifications || []).filter((n) => !(n.extra && n.extra.supportTicketId));
  return ids.length;
}

function normalizeNationalId(value) {
  return String(value || "").replace(/[\s\-]/g, "").toUpperCase();
}

function nationalIdTaken(nationalId, exceptUserId) {
  const n = normalizeNationalId(nationalId);
  if (!n) return false;
  return (db.users || []).some((u) => {
    if (exceptUserId && u.id === exceptUserId) return false;
    return normalizeNationalId(u.kyc && u.kyc.nationalId) === n;
  });
}

function bindTelegramToUser(user, from) {
  if (!user) return null;
  const src = from || {};
  const tid = String(src.id || src.telegramId || "");
  if (!tid || tid === "undefined") throw new Error("معرّف تلغرام غير صالح");
  (db.users || []).forEach((u) => {
    if (u.id !== user.id && String(u.telegramId) === tid) u.telegramId = null;
  });
  user.telegramId = tid;
  user.telegramUsername = src.username || user.telegramUsername || null;
  if (!user.displayName && src.first_name) {
    user.displayName = [src.first_name, src.last_name].filter(Boolean).join(" ");
  }
  user.telegramLinkCode = null;
  user.telegramLinkExpires = 0;
  return user;
}

function findUserByTelegramId(tid) {
  const id = String(tid || "");
  if (!id || id === "undefined") return null;
  return (db.users || []).find((u) => String(u.telegramId) === id) || null;
}

function userBalanceSnapshot(userId) {
  const wallets = (db.wallets || []).filter((w) => w.userId === userId);
  const lines = wallets.map((w) => ({
    asset: w.asset,
    available: Number(w.available || 0),
    frozen: Number(w.frozen || 0)
  }));
  const hasFunds = lines.some((w) => w.available > 1e-8 || w.frozen > 1e-8);
  const openOrders = (db.orders || []).filter(
    (o) => (o.buyerId === userId || o.sellerId === userId) && ["pending_payment", "paid", "disputed"].includes(o.status)
  );
  const pendingMoney = [
    ...((db.deposits || []).filter((d) => d.userId === userId && d.status === "pending")),
    ...((db.withdrawals || []).filter((w) => w.userId === userId && w.status === "pending"))
  ];
  return { wallets: lines, hasFunds, openOrders: openOrders.length, pendingMoney: pendingMoney.length };
}

function nextAdSerial() {
  const current = Number(db.adCounter) || 100000;
  db.adCounter = current + 1;
  return db.adCounter;
}

function getAssets(all) {
  return (db.assets || []).filter((a) => all || a.enabled);
}

function getFiats(all) {
  return (db.fiats || []).filter((f) => all || f.enabled);
}

function getPaymentTypes(all) {
  return (db.paymentTypes || []).filter((p) => all || p.enabled);
}

function ownerTelegramId() {
  return String((db.settings && db.settings.ownerTelegramId) || "1441524960");
}

function createUserFromTelegram(from) {
  const src = from || {};
  const tid = String(src.id);
  if (!tid || tid === "undefined") return null;
  const existing = findUserByTelegramId(tid);
  if (existing) return existing;
  const rawUname = String(src.username || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const uname =
    rawUname && rawUname.length >= 3 && !db.users.find((u) => u.username === rawUname)
      ? rawUname
      : `tg_${tid}`;
  const p = hashPassword(`${tid}:${Date.now()}:${Math.random()}`);
  const user = {
    id: uid("u"),
    username: uname,
    email: `${uname}@telegram.p2p`,
    displayName: [src.first_name, src.last_name].filter(Boolean).join(" ") || uname,
    passwordHash: p.hash,
    passwordSalt: p.salt,
    telegramId: tid,
    telegramUsername: src.username || null,
    isMerchant: false,
    merchantStatus: "none",
    isAdmin: false,
    kycStatus: "pending",
    kycLevel: "none",
    kyc: null,
    rating: 100,
    completedTrades: 0,
    createdAt: now(),
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
  notify(user.id, "حساب تلغرام", "تم إنشاء حسابك من تلغرام.");
  save();
  return user;
}

function ensureUserFromTelegram(from) {
  const src = from || {};
  const tid = String(src.id);
  if (!tid || tid === "undefined") return null;
  if (tid === ownerTelegramId()) {
    const admin =
      db.users.find((u) => u.username === "ameralzman00") ||
      db.users.find((u) => u.username === "admin") ||
      db.users.find((u) => u.isAdmin);
    if (admin) {
      const extra = db.users.find((u) => u.id !== admin.id && String(u.telegramId) === tid);
      admin.telegramId = tid;
      admin.telegramUsername = src.username || admin.telegramUsername || null;
      ensureAdminReady(admin);
      if (src.first_name) admin.displayName = [src.first_name, src.last_name].filter(Boolean).join(" ");
      if (extra) extra.telegramId = null;
      save();
      return admin;
    }
  }
  const user = findUserByTelegramId(tid);
  if (user) return user;
  return createUserFromTelegram(src);
}

function requireKyc(user, kind) {
  const s = db.settings || defaultSettings();
  const need =
    (kind === "trade" && s.requireKycForTrade) ||
    (kind === "ad" && s.requireKycForAd) ||
    (kind === "deposit" && s.requireKycForDeposit) ||
    (kind === "withdraw" && s.requireKycForWithdraw);
  if (!need) return null;
  if (user && user.isAdmin) return null;
  if (!user || user.kycStatus !== "verified") {
    return "يجب إكمال توثيق الهوية KYC أولاً";
  }
  return null;
}

function requireMerchant(user) {
  const s = db.settings || defaultSettings();
  if (s.requireMerchantForAd === false) return null;
  if (!user) return "يجب تسجيل الدخول";
  if (user.isAdmin) return null;
  if (user.isMerchant || user.merchantStatus === "approved") return null;
  if (user.merchantStatus === "pending") return "طلب التاجر قيد موافقة المدير";
  return "يجب أن يوافق المدير على حسابك كتاجر قبل نشر الإعلانات";
}

function ensureDemoAccounts() {
  if ((db.users || []).some((u) => u.username === "demo")) return false;
  const seeded = seedDb();
  const taken = new Set((db.users || []).map((u) => u.username));
  const takenIds = new Set((db.users || []).map((u) => u.id));
  (seeded.users || []).forEach((u) => {
    if (u.isAdmin || u.username === "ameralzman00" || u.username === "admin" || taken.has(u.username) || takenIds.has(u.id)) return;
    u.isDemo = true;
    u.merchantStatus = u.isMerchant ? "approved" : "none";
    u.kycLevel = u.kycStatus === "verified" ? "basic" : "none";
    if (!u.uidCode) u.uidCode = nextUidCode();
    db.users.push(u);
    taken.add(u.username);
    takenIds.add(u.id);
  });
  (seeded.wallets || []).forEach((w) => {
    if (!takenIds.has(w.userId)) return;
    if (db.wallets.some((x) => x.userId === w.userId && x.asset === w.asset)) return;
    db.wallets.push(w);
  });
  (seeded.paymentMethods || []).forEach((m) => {
    if (!takenIds.has(m.userId)) return;
    if (db.paymentMethods.some((x) => x.id === m.id)) return;
    db.paymentMethods.push(m);
  });
  (seeded.ads || []).forEach((ad) => {
    if (!takenIds.has(ad.userId)) return;
    if (db.ads.some((x) => x.id === ad.id)) return;
    if (!ad.serial) ad.serial = nextAdSerial();
    db.ads.push(ad);
  });
  save();
  return true;
}

function resetPlatform(keepUser) {
  if (!keepUser || !keepUser.id) throw new Error("حساب المدير مطلوب لإعادة التعيين");
  const settings = { ...defaultSettings(), ...(db.settings || {}) };
  const assets = Array.isArray(db.assets) && db.assets.length ? JSON.parse(JSON.stringify(db.assets)) : defaultAssets();
  const fiats = Array.isArray(db.fiats) && db.fiats.length ? JSON.parse(JSON.stringify(db.fiats)) : defaultFiats();
  const paymentTypes =
    Array.isArray(db.paymentTypes) && db.paymentTypes.length
      ? JSON.parse(JSON.stringify(db.paymentTypes))
      : defaultPaymentTypes();
  const admin = JSON.parse(JSON.stringify(keepUser));
  ensureAdminReady(admin);
  admin.completedTrades = 0;
  admin.rating = 100;
  if (!admin.uidCode) admin.uidCode = nextUidCode();
  const sessions = (db.sessions || []).filter((s) => s.userId === keepUser.id);
  const goneTickets = (db.supportTickets || []).map((t) => t && t.id).filter(Boolean);
  const next = emptyDb();
  next.settings = settings;
  next.assets = assets;
  next.fiats = fiats;
  next.paymentTypes = paymentTypes;
  next.users = [admin];
  next.sessions = sessions;
  next.supportTickets = [];
  next.notifications = [];
  next.deletedSupportIds = Array.from(new Set([...(db.deletedSupportIds || []), ...goneTickets])).slice(-5000);
  next.adCounter = 100000;
  Object.keys(db).forEach((key) => {
    if (!(key in next)) delete db[key];
  });
  Object.assign(db, next);
  getAssets().forEach((coin) => getWallet(admin.id, coin.symbol));
  save();
  return { users: 1, keptUserId: admin.id };
}

function freezeRestriction(user, kind) {
  if (!user || user.isAdmin) return null;
  if (user.accountFrozen) {
    return "الحساب مجمّد. تواصل مع الدعم لفك التجميد.";
  }
  if (user.fundsFrozen && ["withdraw", "transfer", "trade", "ad"].includes(kind)) {
    return "الأموال مجمّدة داخل المحفظة. تواصل مع الدعم لفك التجميد.";
  }
  return null;
}

function pauseUserLiveAds(userId, unfreezeAvailable) {
  (db.ads || []).forEach((ad) => {
    if (ad.userId !== userId || ad.status !== "active") return;
    if (unfreezeAvailable && ad.side === "SELL" && ad.available > 0) unfreeze(ad.userId, ad.asset, ad.available);
    ad.status = "paused";
    ad.updatedAt = now();
  });
}

function freezeUserFunds(userId) {
  pauseUserLiveAds(userId, true);
  getAssets(true).forEach((coin) => {
    const w = getWallet(userId, coin.symbol);
    if (w.available > 1e-12) {
      w.adminHold = round(Number(w.adminHold || 0) + w.available, 8);
      freeze(userId, coin.symbol, w.available);
    }
  });
}

function unfreezeUserFunds(userId) {
  getAssets(true).forEach((coin) => {
    const w = getWallet(userId, coin.symbol);
    const hold = Number(w.adminHold || 0);
    if (hold > 0) {
      unfreeze(userId, coin.symbol, hold);
      w.adminHold = 0;
    }
  });
}

function requireAdvancedKyc(user, amountUsdt) {
  const limit = Number((db.settings && db.settings.advancedKycUsdt) || 2000);
  if (!(Number(amountUsdt) > limit)) return null;
  if (user && user.isAdmin) return null;
  if (!user || user.kycLevel !== "advanced") {
    return `التداول فوق ${limit} USDT يتطلب توثيقاً متقدماً مع إثبات السكن`;
  }
  return null;
}

module.exports = {
  db,
  save,
  load,
  reload,
  publicSiteUrl,
  resolveWebAppUrl,
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
  claimTelegramNotifications,
  wipeSupportData,
  nextAdSerial,
  nextUidCode,
  findUserByUid,
  getAssets,
  getFiats,
  getPaymentTypes,
  requireKyc,
  requireMerchant,
  requireAdvancedKyc,
  ownerTelegramId,
  ensureUserFromTelegram,
  createUserFromTelegram,
  bindOwnerAdmin,
  defaultSettings,
  seedDb,
  resetPlatform,
  ensureDemoAccounts,
  resolveMerchantBadge,
  setMerchantBadgeManual,
  merchantBadgeRank,
  refreshFeaturedMerchant,
  completeTradeStats,
  weeklyTradeCount,
  weeklyUsdtVolume,
  lifetimeUsdtVolume,
  MERCHANT_BADGES,
  isDemoUser,
  userById,
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
  isValidTradePin,
  normalizePinDigits,
  generateTempPassword,
  publicSupportTicket,
  userOpenTicket,
  createSupportTicket,
  replySupportTicket,
  addSupportBotMessage,
  closeSupportTicket,
  deleteSupportTicket,
  supportTickets,
  normalizeNationalId,
  nationalIdTaken,
  bindTelegramToUser,
  findUserByTelegramId,
  userBalanceSnapshot,
  setUserPassword,
  clearTradePin,
  unlockTradePin,
  revokeUserSessions,
  isTradePinLocked,
  publicTreasury,
  normalizeTreasuryWallets,
  activeDepositWallet,
  treasuryByAddress,
  isPlatformTreasuryAddress
};
