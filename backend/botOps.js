const {
  db,
  save,
  uid,
  now,
  freeze,
  unfreeze,
  credit,
  debit,
  settleFrozen,
  calcPctFee,
  notify,
  nextAdSerial,
  findUserByUid,
  getAssets,
  getFiats,
  getPaymentTypes,
  requireKyc,
  requireMerchant,
  freezeRestriction,
  isDemoUser,
  sameSandbox,
  getWallet,
  assertTradePin,
  activeDepositWallet,
  isPlatformTreasuryAddress,
  nationalIdTaken
} = require("./db");
const kycStore = require("./kycStore");
const priceEngine = require("./priceEngine");

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

function validateAdPrice(asset, fiat, price, side) {
  const range = priceEngine.rangeFor(db.settings, asset, fiat, side);
  const min = Number(range && range.min) || 0;
  const max = Number(range && range.max) || 0;
  const label = String(side || "").toUpperCase() === "BUY" ? "شراء" : "بيع";
  if (min > 0 && max > 0 && min > max) return `نطاق سعر ${label} غير صالح في إعدادات الإدارة`;
  if (min > 0 && Number(price) < min - 1e-10) return `سعر ${label} ${asset}/${fiat} يجب ألا يقل عن ${min}`;
  if (max > 0 && Number(price) > max + 1e-10) return `سعر ${label} ${asset}/${fiat} يجب ألا يتجاوز ${max}`;
  return null;
}

async function suggestedAdPrice(side, asset, fiat) {
  const quote = await priceEngine.quoteFor(db.settings, asset || "USDT", fiat || "SYP");
  return {
    quote: priceEngine.publicQuote(quote),
    suggested: priceEngine.suggestedPrice(quote, side)
  };
}

function createDeposit(user, { asset, amount, txHash, fromAddress }) {
  if (db.settings.depositEnabled === false) throw new Error("الإيداع متوقف حالياً");
  const frozenErr = freezeRestriction(user, "deposit");
  if (frozenErr) throw new Error(frozenErr);
  const kycErr = requireKyc(user, "deposit");
  if (kycErr) throw new Error(kycErr);
  const coin = getAssets().find((x) => x.symbol === asset && x.depositEnabled);
  if (!coin) throw new Error("عملة الإيداع غير مدعومة على BEP20");
  const a = Number(amount);
  if (!(a > 0) || a > 1e7) throw new Error("مبلغ غير صالح");
  if (a < Number(db.settings.minDeposit || 0)) {
    throw new Error(`الحد الأدنى للإيداع ${db.settings.minDeposit} ${asset}`);
  }
  if (!isValidTxHash(txHash)) throw new Error("هاش المعاملة غير صالح (BEP20 0x... 64 خانة)");
  const hash = String(txHash).trim();
  if (db.deposits.find((d) => d.txHash.toLowerCase() === hash.toLowerCase())) {
    throw new Error("هذا الهاش مستخدم مسبقاً");
  }
  if (fromAddress && !isValidAddress(fromAddress)) throw new Error("عنوان المحفظة المرسلة غير صالح");
  const feePct = Number(db.settings.depositFeePct || 0);
  const fee = calcPctFee(a, feePct);
  const netAmount = a - fee;
  if (!(netAmount > 0)) throw new Error("المبلغ بعد عمولة الإيداع غير صالح");
  const deposit = {
    id: uid("dep"),
    userId: user.id,
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
  if (isDemoUser(user)) {
    credit(user.id, deposit.asset, deposit.netAmount);
    deposit.status = "credited";
    deposit.reviewedAt = now();
    deposit.note = "قيد تجريبي تلقائي — لا يراجع المدير";
    notify(user.id, "إيداع تجريبي", `أُضيف ${deposit.netAmount} ${asset} في صندوق العرض فقط.`);
  } else {
    notify(user.id, "طلب إيداع BEP20", `بانتظار مراجعة الإدارة: ${a} ${asset}`);
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "إيداع جديد", `${user.username} أرسل ${a} ${asset}`, { depositId: deposit.id });
    });
  }
  save();
  return deposit;
}

function createWithdraw(user, { asset, amount, toAddress, tradePin }) {
  if (db.settings.withdrawEnabled === false) throw new Error("السحب متوقف حالياً");
  const frozenErr = freezeRestriction(user, "withdraw");
  if (frozenErr) throw new Error(frozenErr);
  const kycErr = requireKyc(user, "withdraw");
  if (kycErr) throw new Error(kycErr);
  const pinErr = assertTradePin(user, tradePin);
  if (pinErr) throw new Error(pinErr);
  const coin = getAssets().find((x) => x.symbol === asset && x.enabled);
  if (!coin) throw new Error("عملة السحب غير مدعومة");
  const a = Number(amount);
  if (!(a > 0) || a > 1e7) throw new Error("مبلغ غير صالح");
  const flatFee = Number(db.settings.withdrawFee || 0);
  const feePct = Number(db.settings.withdrawFeePct || 0);
  const pctFee = calcPctFee(a, feePct);
  const fee = flatFee + pctFee;
  const minW = Number(db.settings.minWithdraw || 0);
  if (a < minW) throw new Error(`الحد الأدنى للسحب ${minW} ${asset}`);
  if (!toAddress || !isValidAddress(toAddress)) throw new Error("عنوان محفظة الاستلام غير صالح (BEP20 0x...)");
  if (isPlatformTreasuryAddress(toAddress)) {
    throw new Error("لا يمكن السحب إلى عنوان المنصة");
  }
  const total = a + fee;
  const wallet = getWallet(user.id, coin.symbol);
  if (wallet.available < total - 1e-10) {
    throw new Error(`رصيد غير كافٍ. المطلوب ${total} ${asset} (يشمل الرسوم ${fee})`);
  }
  if (!freeze(user.id, coin.symbol, total)) throw new Error("تعذر حجز الرصيد للسحب");
  const withdrawal = {
    id: uid("wd"),
    userId: user.id,
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
  if (isDemoUser(user)) {
    settleFrozen(user.id, withdrawal.asset, withdrawal.total);
    withdrawal.status = "completed";
    withdrawal.reviewedAt = now();
    withdrawal.note = "سحب تجريبي تلقائي — لا يراجع المدير";
    notify(user.id, "سحب تجريبي", `خُصم ${withdrawal.amount} ${coin.symbol} من صندوق العرض فقط.`);
  } else {
    notify(user.id, "طلب سحب", `بانتظار مراجعة الإدارة: ${a} ${coin.symbol} (رسوم ${fee})`);
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "طلب سحب جديد", `${user.username} يطلب سحب ${a} ${coin.symbol}`, { withdrawalId: withdrawal.id });
    });
  }
  save();
  return withdrawal;
}

function createTransfer(user, { to, asset, amount, note, tradePin }) {
  const frozenErr = freezeRestriction(user, "transfer");
  if (frozenErr) throw new Error(frozenErr);
  const kycErr = requireKyc(user, "withdraw");
  if (kycErr) throw new Error(kycErr);
  const pinErr = assertTradePin(user, tradePin);
  if (pinErr) throw new Error(pinErr);
  const coin = getAssets().find((x) => x.symbol === asset && x.enabled);
  if (!coin) throw new Error("عملة غير مدعومة");
  const a = Number(amount);
  if (!(a > 0) || a > 1e7) throw new Error("مبلغ غير صالح");
  const target = findUserByUid(to);
  if (!target || !sameSandbox(user, target)) throw new Error("المستلم غير موجود. أدخل رقم UID أو اسم المستخدم.");
  if (target.id === user.id) throw new Error("لا يمكن التحويل لنفسك");
  const feePct = Number(db.settings.transferFeePct || 0);
  const fee = calcPctFee(a, feePct);
  const total = a + fee;
  if (!debit(user.id, coin.symbol, total)) {
    throw new Error(fee > 0 ? `رصيد غير كافٍ. المطلوب ${total} ${coin.symbol} (يشمل عمولة ${feePct}%)` : "رصيد غير كافٍ");
  }
  credit(target.id, coin.symbol, a);
  const transfer = {
    id: uid("tr"),
    fromId: user.id,
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
  notify(user.id, "تحويل داخلي", `أرسلت ${a} ${coin.symbol} إلى UID ${target.uidCode} (${target.displayName})${fee > 0 ? ` · عمولة ${fee}` : ""}`, { transferId: transfer.id });
  notify(target.id, "استلام داخلي", `وصلك ${a} ${coin.symbol} من UID ${user.uidCode} (${user.displayName})`, { transferId: transfer.id });
  save();
  return { transfer, target };
}

async function createAd(user, body) {
  const frozenErr = freezeRestriction(user, "ad");
  if (frozenErr) throw new Error(frozenErr);
  const kycErr = requireKyc(user, "ad");
  if (kycErr) throw new Error(kycErr);
  const merchantErr = requireMerchant(user);
  if (merchantErr) throw new Error(merchantErr);
  const { side, asset, fiat, price, minAmount, maxAmount, available, terms, timeLimitMin } = body || {};
  if (!["BUY", "SELL"].includes(side)) throw new Error("نوع الإعلان غير صالح");
  if (!getAssets().find((x) => x.symbol === asset)) throw new Error("أصل غير مدعوم");
  if (!getFiats().find((x) => x.code === fiat)) throw new Error("عملة فيات غير مدعومة");
  const priceType = String((body && body.priceType) || "fixed") === "floating" ? "floating" : "fixed";
  const floatRatio = Number((body && body.floatRatio) || 1);
  let p = Number(price);
  if (priceType === "floating") {
    if (!(floatRatio > 0) || floatRatio > 10) throw new Error("نسبة السعر العائم غير صالحة");
    const quote = await priceEngine.quoteFor(db.settings, asset, fiat);
    const market = Number(quote && quote.market) || priceEngine.syncMarket(db.settings, asset, fiat);
    if (!(market > 0)) throw new Error("تعذر حساب السعر العائم. استخدم سعراً ثابتاً أو أدخل مصدر سعر.");
    const resolved = priceEngine.resolveAdPrice(db.settings, { asset, fiat, side, priceType: "floating", floatRatio, price: 0 }, market);
    p = resolved.price;
  }
  const minA = Number(minAmount);
  const maxA = Number(maxAmount);
  const avail = Number(available);
  if (!(p > 0) || !(minA > 0) || !(maxA >= minA) || !(avail >= maxA)) {
    throw new Error("حدود المبالغ أو السعر غير صالحة");
  }
  const priceErr = validateAdPrice(asset, fiat, p, side);
  if (priceErr) throw new Error(priceErr);
  const pts = ["SHAM_CASH"];
  if (!getPaymentTypes().find((x) => x.id === "SHAM_CASH")) throw new Error("شام كاش غير مفعّل");
  const methods = db.paymentMethods.filter((m) => m.userId === user.id && m.active && m.type === "SHAM_CASH");
  if (!methods.length) throw new Error("أضف طريقة دفع شام كاش أولاً من «حسابي»");
  if (side === "SELL" && !freeze(user.id, asset, avail)) throw new Error("رصيد غير كافٍ لتغطية الإعلان");
  const ad = {
    id: uid("ad"),
    serial: nextAdSerial(),
    userId: user.id,
    side,
    asset,
    fiat,
    price: p,
    priceType,
    floatRatio: priceType === "floating" ? floatRatio : 1,
    minAmount: minA,
    maxAmount: maxA,
    available: avail,
    paymentTypes: pts,
    terms: String(terms || "").slice(0, 500),
    timeLimitMin: Math.min(Math.max(Number(timeLimitMin) || 15, 5), 120),
    status: "active",
    isDemo: isDemoUser(user),
    createdAt: now()
  };
  db.ads.unshift(ad);
  notify(user.id, "تم نشر الإعلان", `إعلانك رقم #${ad.serial} ظاهر الآن في السوق.`, { adId: ad.id });
  save();
  return ad;
}

function toggleAd(user, adId) {
  const ad = db.ads.find((a) => a.id === adId && a.userId === user.id);
  if (!ad) throw new Error("الإعلان غير موجود");
  if (ad.status === "active") {
    if (ad.side === "SELL" && ad.available > 0) unfreeze(user.id, ad.asset, ad.available);
    ad.status = "paused";
  } else if (ad.status === "paused") {
    if (ad.side === "SELL" && !freeze(user.id, ad.asset, ad.available)) {
      throw new Error("رصيد غير كافٍ لإعادة تفعيل الإعلان");
    }
    ad.status = "active";
  } else {
    throw new Error("لا يمكن تبديل حالة هذا الإعلان");
  }
  save();
  return ad;
}

function addShamCashMethod(user, { address }) {
  if (user.kycStatus !== "verified" || !verifiedPaymentName(user)) {
    throw new Error("وثّق هويتك أولاً. اسم المستلم يُثبَّت من الاسم الحقيقي في التوثيق.");
  }
  const exists = db.paymentMethods.find((m) => m.userId === user.id && m.active !== false && m.type === "SHAM_CASH");
  if (exists) throw new Error("لديك شام كاش واحدة مسبقاً. عدّلها أو احذفها ثم أضف من جديد.");
  const legalName = verifiedPaymentName(user);
  const addr = String(address || "").replace(/^0x/i, "").trim().toLowerCase();
  if (!isValidShamCashAddress(addr)) {
    throw new Error("عنوان شام كاش غير صالح. 32 خانة hex.");
  }
  const method = {
    id: uid("pm"),
    userId: user.id,
    type: "SHAM_CASH",
    label: `شام كاش ${addr.slice(0, 8)}`,
    details: {
      name: legalName,
      address: addr,
      account: addr
    },
    active: true
  };
  db.paymentMethods.push(method);
  save();
  return method;
}

function listPaymentMethods(user) {
  return db.paymentMethods.filter((m) => m.userId === user.id && m.active !== false);
}

function updateShamCashMethod(user, methodId, { address, label }) {
  const method = db.paymentMethods.find((m) => m.id === methodId && m.userId === user.id && m.active !== false);
  if (!method) throw new Error("طريقة الدفع غير موجودة");
  if (user.kycStatus !== "verified" || !verifiedPaymentName(user)) {
    throw new Error("وثّق هويتك أولاً. اسم المستلم يُثبَّت من الاسم الحقيقي في التوثيق.");
  }
  if (typeof label === "string" && label.trim()) method.label = label.trim().slice(0, 80);
  if (address) {
    const addr = String(address || "").replace(/^0x/i, "").trim().toLowerCase();
    if (!isValidShamCashAddress(addr)) throw new Error("عنوان شام كاش غير صالح. 32 خانة hex.");
    method.details = {
      name: verifiedPaymentName(user),
      address: addr,
      account: addr
    };
  } else {
    method.details = { ...(method.details || {}), name: verifiedPaymentName(user) };
  }
  save();
  return method;
}

function removePaymentMethod(user, methodId) {
  const i = db.paymentMethods.findIndex((m) => m.id === methodId && m.userId === user.id);
  if (i < 0) throw new Error("طريقة الدفع غير موجودة");
  db.paymentMethods.splice(i, 1);
  const stillHas = db.paymentMethods.some((m) => m.userId === user.id && m.active !== false && m.type === "SHAM_CASH");
  if (!stillHas) {
    db.ads.filter((a) => a.userId === user.id && a.status === "active").forEach((ad) => {
      if (ad.side === "SELL" && ad.available > 0) unfreeze(user.id, ad.asset, ad.available);
      ad.status = "paused";
    });
  }
  save();
  return { pausedAds: !stillHas };
}

function applyMerchant(user, { shopName, note }) {
  const frozenErr = freezeRestriction(user, "ad");
  if (frozenErr) throw new Error(frozenErr);
  if (user.isAdmin || user.isMerchant || user.merchantStatus === "approved") {
    throw new Error("حسابك معتمد كتاجر مسبقاً");
  }
  if (user.merchantStatus === "pending" && !isDemoUser(user)) {
    throw new Error("طلبك قيد مراجعة المدير");
  }
  user.merchantShop = String(shopName || "").slice(0, 60);
  user.merchantNote = String(note || "").slice(0, 300);
  user.merchantAppliedAt = now();
  if (isDemoUser(user)) {
    user.merchantStatus = "approved";
    user.isMerchant = true;
    notify(user.id, "تم اعتمادك تاجراً (تجريبي)", "الحساب التجريبي للعرض فقط ولا يراجع المدير الطلب.");
  } else {
    user.merchantStatus = "pending";
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "طلب اعتماد تاجر", `${user.username} طلب اعتماد حساب كتاجر`);
    });
    notify(user.id, "تم إرسال طلب التاجر", "طلبك قيد مراجعة المدير.");
  }
  save();
  return user;
}

function submitKyc(user, { fullName, nationalId, country, level, files, upgradeOnly }) {
  const alreadyVerified = user.kycStatus === "verified";
  const nextLevel = level === "advanced" ? "advanced" : "basic";
  if (alreadyVerified && nextLevel === "basic") throw new Error("حسابك موثّق مسبقاً");
  if (alreadyVerified && nextLevel === "advanced" && user.kycLevel === "advanced") {
    throw new Error("حسابك موثّق توثيقاً متقدماً مسبقاً");
  }
  const prev = user.kyc || {};
  const nextFullName = String(fullName || prev.fullName || "").slice(0, 80);
  const nextNationalId = String(nationalId || prev.nationalId || "").slice(0, 40);
  const nextCountry = String(country || prev.country || "SY").slice(0, 40);
  if (!nextFullName || !nextNationalId || !nextCountry) throw new Error("الاسم ورقم الهوية والدولة مطلوبة");
  if (nationalIdTaken(nextNationalId, user.id)) throw new Error("الرقم الوطني مستخدم مسبقاً في حساب آخر");
  if (!Array.isArray(files) || !files.length) throw new Error(upgradeOnly ? "ارفع إثبات السكن" : "ارفع صور الهوية");
  const savedFiles = kycStore.saveFiles(user.id, files);
  const mergedFiles = upgradeOnly
    ? [...(prev.files || []).filter((f) => f.kind !== "residence" && f.kind !== "extra"), ...savedFiles]
    : savedFiles;
  const kyc = {
    fullName: nextFullName,
    nationalId: nextNationalId,
    country: nextCountry,
    documentType: prev.documentType || "id",
    phone: prev.phone || "",
    address: prev.address || "",
    level: nextLevel,
    submittedAt: now(),
    reviewedAt: null,
    note: "",
    files: mergedFiles
  };
  if (!upgradeOnly && !kycStore.hasRequiredFiles(kyc)) {
    throw new Error("مطلوب: وجه الهوية، ظهر الهوية، وصورة شخصية مع الوثيقة");
  }
  if (nextLevel === "advanced" && !kycStore.hasAdvancedFiles(kyc)) {
    throw new Error("التوثيق المتقدم يتطلب إثبات السكن");
  }
  user.kyc = kyc;
  if (upgradeOnly) {
    user.kycStatus = "verified";
    user.kycLevel = "basic";
    user.kycUpgradePending = true;
  } else {
    user.kycStatus = "submitted";
    user.kycLevel = nextLevel;
    user.kycUpgradePending = false;
  }
  const existing = db.kycRequests.find((k) => k.userId === user.id && k.status === "submitted");
  if (!existing) {
    db.kycRequests.unshift({ id: uid("kyc"), userId: user.id, status: "submitted", level: nextLevel, createdAt: now() });
  } else {
    existing.level = nextLevel;
  }
  if (isDemoUser(user)) {
    user.kycStatus = "verified";
    user.kycLevel = nextLevel;
    user.kycUpgradePending = false;
    if (user.kyc) user.kyc.reviewedAt = now();
    notify(user.id, "تم قبول KYC التجريبي", "الحساب التجريبي للعرض فقط ولا يراجع المدير ملفه.");
  } else {
    db.users.filter((u) => u.isAdmin).forEach((u) => {
      notify(u.id, "طلب KYC", `${user.username} أرسل ملف توثيق ${nextLevel === "advanced" ? "متقدم" : "أساسي"} للمراجعة`);
    });
    notify(user.id, "تم إرسال KYC", "طلب التوثيق قيد المراجعة.");
  }
  save();
  return user;
}

function fileToDataUrl(mime, buf) {
  return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
}

module.exports = {
  isValidTxHash,
  isValidAddress,
  isValidShamCashAddress,
  verifiedPaymentName,
  suggestedAdPrice,
  createDeposit,
  createWithdraw,
  createTransfer,
  createAd,
  toggleAd,
  addShamCashMethod,
  listPaymentMethods,
  updateShamCashMethod,
  removePaymentMethod,
  applyMerchant,
  submitKyc,
  fileToDataUrl
};
