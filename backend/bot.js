const TelegramBot = require("node-telegram-bot-api");
const {
  db,
  save,
  uid,
  now,
  hashPassword,
  freeze,
  unfreeze,
  releaseFrozenTo,
  credit,
  settleFrozen,
  notify,
  claimTelegramNotifications,
  getAssets,
  requireKyc,
  requireAdvancedKyc,
  freezeRestriction,
  ownerTelegramId,
  ensureUserFromTelegram,
  bindTelegramToUser,
  reload,
  isDemoUser,
  adIsDemo,
  orderIsDemo,
  liveUsers,
  liveItemsByUser,
  pauseUserLiveAds,
  freezeUserFunds,
  unfreezeUserFunds,
  debit,
  getWallet,
  completeTradeStats,
  publicUser,
  hasTradePin,
  assertTradePin,
  setTradePin,
  normalizePinDigits,
  generateTempPassword,
  setUserPassword,
  clearTradePin,
  unlockTradePin,
  revokeUserSessions,
  createSupportTicket,
  replySupportTicket,
  closeSupportTicket,
  supportTickets,
  activeDepositWallet
} = require("./db");
const kycStore = require("./kycStore");
const evidenceStore = require("./evidenceStore");
const ops = require("./botOps");
const helpGuide = require("./helpGuide");
const supportBot = require("./supportBot");
const { sellerPaymentSnapshot } = require("./chatGuard");
const { telegramBotToken } = require("./telegramToken");
const priceEngine = require("./priceEngine");

const TOKEN = telegramBotToken();
const API = process.env.PUBLIC_API || "http://localhost:3001";
const pending = new Map();
const botAssistant = new Map();

function assistantFor(user) {
  const id = user && user.id;
  let s = botAssistant.get(id);
  if (!s) {
    s = { turns: 0, topicId: "start", unlocked: false };
    botAssistant.set(id, s);
  }
  return s;
}

function webAppUrl() {
  reload();
  return String((db.settings && db.settings.webAppUrl) || process.env.WEB_APP_URL || "https://5173-9b12c5a1da8443a8.monkeycode-ai.live").replace(/\/$/, "");
}

function appIsDown() {
  reload();
  return db.settings && db.settings.appEnabled === false;
}

function downMessage() {
  return String((db.settings && db.settings.appDisabledMessage) || "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً.");
}

function notifyHref(n, user) {
  const extra = (n && n.extra) || {};
  if (n && n.href) return n.href.startsWith("http") ? n.href : `${webAppUrl()}${n.href}`;
  if (extra.href) return extra.href.startsWith("http") ? extra.href : `${webAppUrl()}${extra.href}`;
  if (user && user.isAdmin) {
    if (extra.supportTicketId) return `${webAppUrl()}/admin?tab=support&ticket=${encodeURIComponent(extra.supportTicketId)}`;
    if (extra.orderId) return `${webAppUrl()}/admin?tab=orders&order=${encodeURIComponent(extra.orderId)}`;
    if (extra.depositId) return `${webAppUrl()}/admin?tab=deposits`;
    if (extra.withdrawalId) return `${webAppUrl()}/admin?tab=withdrawals`;
    if (extra.kycUserId) return `${webAppUrl()}/admin?tab=kyc&user=${encodeURIComponent(extra.kycUserId)}`;
    if (extra.merchantUserId) return `${webAppUrl()}/admin?tab=merchants&user=${encodeURIComponent(extra.merchantUserId)}`;
    return `${webAppUrl()}/admin`;
  }
  if (extra.orderId) return `${webAppUrl()}/orders/${extra.orderId}`;
  if (extra.adId) return `${webAppUrl()}/ads/${extra.adId}/edit`;
  if (extra.supportTicketId) return `${webAppUrl()}/support`;
  return `${webAppUrl()}/notifications`;
}

function webAppButton(text) {
  return { text, web_app: { url: webAppUrl() } };
}

function apkUrl() {
  return `${webAppUrl()}/download/android`;
}

function apkButton(text) {
  return { text: text || "تحميل التطبيق", url: apkUrl() };
}

function isAdminUser(user) {
  return !!(user && (user.isAdmin || String(user.telegramId) === ownerTelegramId()));
}

function userFromMsg(msg) {
  reload();
  const user = ensureUserFromTelegram(msg.from);
  if (user && isDemoUser(user) && !user.isAdmin) return null;
  return user;
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now();
}

function walletsOf(userId) {
  return db.wallets.filter((w) => w.userId === userId);
}

function fmt(n, d = 2) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
}

function mainKeyboard(user) {
  const rows = [
    [webAppButton("فتح المنصة")],
    [{ text: "شراء USDT" }, { text: "بيع USDT" }],
    [{ text: "محفظتي" }, { text: "صفقاتي" }],
    [{ text: "إيداع" }, { text: "سحب" }],
    [{ text: "تحويل" }, { text: "إعلاناتي" }],
    [{ text: "حسابي" }, { text: "الإشعارات" }],
    [{ text: "تحميل التطبيق" }, { text: "المساعدة" }],
    [{ text: "تواصل الدعم" }]
  ];
  if (isAdminUser(user)) rows.push([{ text: "لوحة الإدارة" }]);
  return { keyboard: rows, resize_keyboard: true };
}

function cancelKb() {
  return { keyboard: [[{ text: "إلغاء" }]], resize_keyboard: true };
}

function assetButtons(prefix) {
  return getAssets(true).slice(0, 6).map((a) => [{ text: a.symbol, callback_data: `${prefix}:${a.symbol}` }]);
}

function kycStatusLine(user) {
  const st = user.kycStatus === "verified"
    ? (user.kycLevel === "advanced" ? "موثّق متقدم" : "موثّق أساسي")
    : user.kycStatus === "submitted"
      ? "قيد المراجعة"
      : user.kycStatus === "rejected"
        ? "مرفوض"
        : "غير مكتمل";
  const mer = user.isMerchant || user.merchantStatus === "approved"
    ? "تاجر معتمد"
    : user.merchantStatus === "pending"
      ? "طلب تاجر قيد المراجعة"
      : user.merchantStatus === "rejected"
        ? "طلب تاجر مرفوض"
        : "ليس تاجراً";
  const merNote = user.merchantDecisionNote ? `\nملاحظة الإدارة: ${user.merchantDecisionNote}` : "";
  return `الاسم: ${user.displayName}\nUID: ${user.uidCode || "—"}\nالمستخدم: ${user.username}\nKYC: ${st}\nالتاجر: ${mer}${merNote}`;
}

function adsKeyboard(ads, prefix) {
  const rows = ads.slice(0, 8).map((a) => {
    const owner = db.users.find((u) => u.id === a.userId);
    const name = owner ? owner.displayName : a.userId;
    return [
      {
        text: `${a.price} ${a.fiat} | ${fmt(a.minAmount)}-${fmt(a.maxAmount)} ${a.asset} | ${name}`,
        callback_data: `${prefix}:${a.id}`
      }
    ];
  });
  return { inline_keyboard: rows };
}

if (!TOKEN) {
  console.log("TELEGRAM_BOT_TOKEN غير معيّن. البوت لن يتصل بتيليجرام، والـ API يعمل بشكل مستقل.");
  console.log("ضع التوكن في backend/.env.example ثم شغّل: TELEGRAM_BOT_TOKEN=xxx node bot.js");
  setInterval(() => {}, 60 * 60 * 1000);
} else {
  const bot = new TelegramBot(TOKEN, { polling: true });

  function applyWebAppMenu() {
    bot.setChatMenuButton({
      menu_button: { type: "web_app", text: "المنصة", web_app: { url: webAppUrl() } }
    }).catch(() => {});
  }
  applyWebAppMenu();
  setInterval(applyWebAppMenu, 20000);

  bot.onText(/\/start(?:\s+(\S+))?/, (msg, match) => {
    const user = userFromMsg(msg);
    if (!user) return bot.sendMessage(msg.chat.id, "الحسابات التجريبية غير متاحة. استخدم حساباً حقيقياً.");
    if (appIsDown() && !isAdminUser(user)) return bot.sendMessage(msg.chat.id, downMessage());
    const payload = match && match[1];
    if (payload && payload.startsWith("LINK_")) {
      const code = payload.slice(5);
      const target = db.users.find(
        (u) => u.telegramLinkCode === code && u.telegramLinkExpires > now()
      );
      if (target) {
        bindTelegramToUser(target, msg.from);
        save();
        bot.sendMessage(msg.chat.id, `تم ربط حساب الموقع (${target.username}) بهذا التلغرام.`, { reply_markup: mainKeyboard(target) });
        return;
      }
    }
    const extra = isAdminUser(user)
      ? "\nأنت المدير. اضغط لوحة الإدارة للتحكم بالمنصة من البوت والموقع معاً."
      : "";
    bot.sendMessage(
      msg.chat.id,
      `أهلاً ${user.displayName}\nمنصة USDT شام لتداول التيثر في سوريا.\nشراء وبيع USDT مقابل الليرة السورية أو الدولار عبر شام كاش.${extra}\nاضغط فتح المنصة لدخول الموقع داخل تلغرام.`,
      { reply_markup: mainKeyboard(user) }
    );
    bot.sendMessage(msg.chat.id, "التطبيق المصغّر وتطبيق أندرويد:", {
      reply_markup: { inline_keyboard: [[webAppButton("فتح المنصة")], [apkButton("تحميل تطبيق أندرويد")]] }
    });
  });

  bot.onText(/^\/help(?:@\w+)?$|^المساعدة$/, (msg) => {
    bot.sendMessage(msg.chat.id, helpGuide.overview(), { reply_markup: helpGuide.listKeyboard() });
  });

  async function attachTelegramFile(user, order, kind, msg) {
    let fileId;
    let mime = "image/jpeg";
    let name = "telegram.jpg";
    if (msg.photo && msg.photo.length) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      mime = "image/jpeg";
      name = "telegram.jpg";
    } else if (msg.video) {
      fileId = msg.video.file_id;
      mime = msg.video.mime_type || "video/mp4";
      name = msg.video.file_name || "telegram.mp4";
    } else if (msg.document) {
      fileId = msg.document.file_id;
      mime = msg.document.mime_type || "application/octet-stream";
      name = msg.document.file_name || "telegram.bin";
      const ext = String(name).toLowerCase();
      if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) mime = "image/jpeg";
      else if (ext.endsWith(".png")) mime = "image/png";
      else if (ext.endsWith(".webp")) mime = "image/webp";
      else if (ext.endsWith(".mp4")) mime = "video/mp4";
      else if (ext.endsWith(".webm")) mime = "video/webm";
      else if (ext.endsWith(".mov")) mime = "video/quicktime";
    } else if (msg.video_note) {
      fileId = msg.video_note.file_id;
      mime = "video/mp4";
      name = "circle.mp4";
    }
    if (!fileId) throw new Error("أرسل صورة أو فيديو");
    if (kind === "payment_proof" && !String(mime).startsWith("image/")) {
      throw new Error("إثبات الدفع يجب أن يكون صورة");
    }
    if (kind === "dispute_video" && !String(mime).startsWith("video/")) {
      kind = "dispute_image";
    }
    const link = await bot.getFileLink(fileId);
    const res = await fetch(link);
    if (!res.ok) throw new Error("تعذر تنزيل الملف من تلغرام");
    const buf = Buffer.from(await res.arrayBuffer());
    const data = `data:${mime};base64,${buf.toString("base64")}`;
    const saved = evidenceStore.saveFiles(order.id, user.id, [{ kind, name, data }]);
    order.evidence = [...(order.evidence || []), ...saved];
    db.messages.push({
      id: uid("msg"),
      orderId: order.id,
      userId: "system",
      text: `أُرفق ${evidenceStore.kindLabel(kind)} عبر تلغرام.`,
      createdAt: now()
    });
    save();
    return saved;
  }

  async function telegramFilePayload(msg) {
    let fileId;
    let mime = "image/jpeg";
    let name = "telegram.jpg";
    if (msg.photo && msg.photo.length) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.document) {
      fileId = msg.document.file_id;
      mime = msg.document.mime_type || "application/octet-stream";
      name = msg.document.file_name || "telegram.bin";
    } else {
      return null;
    }
    const link = await bot.getFileLink(fileId);
    const res = await fetch(link);
    if (!res.ok) throw new Error("تعذر تنزيل الملف من تلغرام");
    const buf = Buffer.from(await res.arrayBuffer());
    return { kind: "", name, data: ops.fileToDataUrl(mime.startsWith("image/") || mime === "application/pdf" ? mime : "image/jpeg", buf) };
  }

  bot.on("message", async (msg) => {
    if (!(msg.photo || msg.video || msg.document || msg.video_note)) return;
    const user = userFromMsg(msg);
    if (!user) return;
    if (appIsDown() && !isAdminUser(user)) return bot.sendMessage(msg.chat.id, downMessage());
    const st = pending.get(user.id);
    if (!st) return;
    if (st.step === "kyc_file") {
      try {
        const payload = await telegramFilePayload(msg);
        if (!payload) return bot.sendMessage(msg.chat.id, "أرسل صورة أو PDF.");
        payload.kind = st.kind;
        st.files = st.files || [];
        st.files = st.files.filter((f) => f.kind !== st.kind);
        st.files.push(payload);
        const order = ["id_front", "id_back", "selfie", "residence"];
        const labels = { id_front: "وجه الهوية", id_back: "ظهر الهوية", selfie: "صورة مع الوثيقة", residence: "إثبات السكن" };
        const need = st.upgrade ? ["residence"] : ["id_front", "id_back", "selfie"];
        const have = new Set(st.files.map((f) => f.kind));
        const nextKind = need.find((k) => !have.has(k));
        if (nextKind) {
          st.kind = nextKind;
          pending.set(user.id, st);
          return bot.sendMessage(msg.chat.id, `تم حفظ ${labels[payload.kind] || "الملف"}.\nأرسل الآن: ${labels[nextKind]}`, { reply_markup: cancelKb() });
        }
        ops.submitKyc(user, {
          fullName: st.fullName,
          nationalId: st.nationalId,
          country: st.country || "SY",
          level: st.upgrade ? "advanced" : "basic",
          files: st.files,
          upgradeOnly: !!st.upgrade
        });
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, isDemoUser(user) ? "تم قبول التوثيق التجريبي تلقائياً." : "تم إرسال ملف التوثيق للمراجعة.", { reply_markup: mainKeyboard(user) });
      } catch (e) {
        return bot.sendMessage(msg.chat.id, e.message || "تعذر حفظ صورة التوثيق.");
      }
    }
    if (!["proof", "dispute_file"].includes(st.step)) return;
    const order = db.orders.find((o) => o.id === st.orderId);
    if (!order) {
      pending.delete(user.id);
      return bot.sendMessage(msg.chat.id, "الصفقة غير موجودة.");
    }
    try {
      if (st.step === "proof") {
        await attachTelegramFile(user, order, "payment_proof", msg);
        pending.delete(user.id);
        bot.sendMessage(msg.chat.id, "تم حفظ إثبات الدفع. اضغط «أكدت الدفع» لإشعار البائع.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "أكدت الدفع", callback_data: `paid:${order.id}` }],
              [{ text: "تفاصيل الصفقة", callback_data: `ord:${order.id}` }]
            ]
          }
        });
        return;
      }
      const kind = msg.video || msg.video_note ? "dispute_video" : "dispute_image";
      await attachTelegramFile(user, order, kind, msg);
      pending.delete(user.id);
      if (!orderIsDemo(order)) {
        db.users.filter((u) => u.isAdmin).forEach((a) => {
          notify(a.id, "مرفق نزاع", `${user.username} رفع مرفق نزاع على صفقة ${order.id.slice(-8)}`, { orderId: order.id, href: `/admin?tab=orders&order=${order.id}` });
        });
      }
      save();
      bot.sendMessage(msg.chat.id, orderIsDemo(order) ? "تم حفظ مرفق النزاع التجريبي. الحساب للعرض فقط ولا يراجع المدير." : "تم حفظ مرفق النزاع. سيراجعه المدير.");
    } catch (e) {
      bot.sendMessage(msg.chat.id, e.message || "تعذر حفظ الملف. أرسل صورة JPEG/PNG أو فيديو أقصر من 12MB.");
    }
  });

  bot.on("message", async (msg) => {
    if (msg.photo || msg.video || msg.document || msg.video_note) return;
    if (!msg.text || msg.text.startsWith("/")) return;
    const user = userFromMsg(msg);
    if (!user) return bot.sendMessage(msg.chat.id, "الحسابات التجريبية غير متاحة. استخدم حساباً حقيقياً.");
    if (appIsDown() && !isAdminUser(user)) {
      return bot.sendMessage(msg.chat.id, downMessage());
    }
    const text = msg.text.trim();
    const st = pending.get(user.id);

    if (text === "إلغاء") {
      pending.delete(user.id);
      return bot.sendMessage(msg.chat.id, "أُلغي الإجراء.", { reply_markup: mainKeyboard(user) });
    }

    if (st && (st.step === "proof" || st.step === "dispute_file" || st.step === "kyc_file")) {
      const wait = st.step === "proof"
        ? "أرسل الآن صورة إيصال شام كاش (ليست نصاً)."
        : st.step === "kyc_file"
          ? "أرسل صورة الوثيقة المطلوبة الآن."
          : "أرسل فيديو أو صورة للنزاع (ليست نصاً).";
      return bot.sendMessage(msg.chat.id, wait, { reply_markup: cancelKb() });
    }

    if (st && st.step === "amount" && st.adId && !st.flow) {
      const qty = Number(text.replace(",", "."));
      const ad = db.ads.find((a) => a.id === st.adId && a.status === "active");
      pending.delete(user.id);
      if (!ad) return bot.sendMessage(msg.chat.id, "الإعلان لم يعد متاحاً.", { reply_markup: mainKeyboard(user) });
      if (!(qty >= ad.minAmount) || qty > ad.maxAmount) {
        return bot.sendMessage(msg.chat.id, `الكمية يجب أن تكون بين ${ad.minAmount} و ${ad.maxAmount}`, { reply_markup: mainKeyboard(user) });
      }
      const pay = ad.paymentTypes[0];
      try {
        const order = createOrder(user, ad, qty, pay);
        bot.sendMessage(msg.chat.id, formatOrder(order, user), {
          reply_markup: {
            inline_keyboard: [
              [{ text: "أكدت الدفع", callback_data: `paid:${order.id}` }],
              [{ text: "إلغاء الصفقة", callback_data: `cancel:${order.id}` }],
              [{ text: "تفاصيل الصفقة", callback_data: `ord:${order.id}` }]
            ]
          }
        });
        bot.sendMessage(msg.chat.id, "القائمة:", { reply_markup: mainKeyboard(user) });
      } catch (e) {
        bot.sendMessage(msg.chat.id, e.message || "تعذر إنشاء الصفقة", { reply_markup: mainKeyboard(user) });
      }
      return;
    }

    if (st && st.flow === "pinset") {
      if (st.step === "current") {
        const err = assertTradePin(user, text);
        if (err) return bot.sendMessage(msg.chat.id, err, { reply_markup: cancelKb() });
        st.step = "new";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "أرسل رمز التحرير الجديد (6 أرقام).", { reply_markup: cancelKb() });
      }
      if (st.step === "new") {
        try {
          setTradePin({ ...user }, text);
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "رمز غير صالح", { reply_markup: cancelKb() });
        }
        st.pin = text;
        st.step = "confirm";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "أعد إدخال الرمز للتأكيد.", { reply_markup: cancelKb() });
      }
      if (st.step === "confirm") {
        if (normalizePinDigits(text) !== normalizePinDigits(st.pin)) {
          st.step = "new";
          pending.set(user.id, st);
          return bot.sendMessage(msg.chat.id, "الرمزان غير متطابقين. أرسل الرمز الجديد من جديد.", { reply_markup: cancelKb() });
        }
        try {
          setTradePin(user, st.pin);
          save();
          pending.delete(user.id);
          return bot.sendMessage(msg.chat.id, "تم حفظ رمز التحرير. يُطلب عند الإفراج والسحب والتحويل.", { reply_markup: mainKeyboard(user) });
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر الحفظ", { reply_markup: cancelKb() });
        }
      }
    }

    if (st && st.flow === "release" && st.step === "pin") {
      const order = db.orders.find((o) => o.id === st.orderId);
      const pinErr = assertTradePin(user, text);
      if (pinErr) return bot.sendMessage(msg.chat.id, pinErr, { reply_markup: cancelKb() });
      pending.delete(user.id);
      if (!order || order.sellerId !== user.id || !["paid", "disputed"].includes(order.status)) {
        return bot.sendMessage(msg.chat.id, "تعذر الإفراج. حدّث تفاصيل الصفقة.", { reply_markup: mainKeyboard(user) });
      }
      if (!releaseFrozenTo(order.sellerId, order.buyerId, order.asset, order.amount)) {
        return bot.sendMessage(msg.chat.id, "فشل الإفراج عن الرصيد المجمّد.", { reply_markup: mainKeyboard(user) });
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
      return bot.sendMessage(msg.chat.id, `أُفرج عن ${order.amount} ${order.asset} للمشتري.`, { reply_markup: mainKeyboard(user) });
    }

    if (st && st.flow === "deposit") {
      if (st.step === "amount") {
        const amount = Number(text.replace(",", "."));
        if (!(amount > 0)) return bot.sendMessage(msg.chat.id, "أدخل مبلغاً صالحاً.", { reply_markup: cancelKb() });
        st.amount = amount;
        st.step = "hash";
        pending.set(user.id, st);
        const depW = activeDepositWallet();
        const depAddr = (depW && depW.address) || db.settings.bep20Address || "—";
        const depName = depW ? `${depW.name}${depW.platform ? ` · ${depW.platform}` : ""}` : "الخزينة";
        return bot.sendMessage(msg.chat.id, `الشبكة: BEP20 فقط\nالمحفظة: ${depName}\nأرسل إلى:\n${depAddr}\nثم أرسل هاش المعاملة (0x... 64 خانة).`, { reply_markup: cancelKb() });
      }
      if (st.step === "hash") {
        try {
          const deposit = ops.createDeposit(user, { asset: st.asset, amount: st.amount, txHash: text });
          pending.delete(user.id);
          return bot.sendMessage(
            msg.chat.id,
            deposit.status === "credited"
              ? `تم إضافة ${deposit.netAmount} ${deposit.asset} (تجريبي).`
              : `طلب إيداع ${deposit.amount} ${deposit.asset} قيد مراجعة الإدارة.`,
            { reply_markup: mainKeyboard(user) }
          );
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر الإيداع", { reply_markup: cancelKb() });
        }
      }
    }

    if (st && st.flow === "withdraw") {
      if (st.step === "amount") {
        const amount = Number(text.replace(",", "."));
        if (!(amount > 0)) return bot.sendMessage(msg.chat.id, "أدخل مبلغاً صالحاً.", { reply_markup: cancelKb() });
        st.amount = amount;
        st.step = "address";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "أرسل عنوان محفظة الاستلام BEP20 (0x...).", { reply_markup: cancelKb() });
      }
      if (st.step === "address") {
        st.toAddress = text;
        st.step = "pin";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, hasTradePin(user) ? "أرسل رمز التحرير (6 أرقام) لتأكيد السحب." : "عيّن رمز تحرير أولاً من «حسابي» ثم أعد المحاولة.", { reply_markup: cancelKb() });
      }
      if (st.step === "pin") {
        try {
          const w = ops.createWithdraw(user, { asset: st.asset, amount: st.amount, toAddress: st.toAddress, tradePin: text });
          pending.delete(user.id);
          return bot.sendMessage(
            msg.chat.id,
            w.status === "completed"
              ? `تم السحب التجريبي ${w.amount} ${w.asset}.`
              : `طلب سحب ${w.amount} ${w.asset} قيد المراجعة. الرسوم ${w.fee}.`,
            { reply_markup: mainKeyboard(user) }
          );
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر السحب", { reply_markup: cancelKb() });
        }
      }
    }

    if (st && st.flow === "transfer") {
      if (st.step === "to") {
        st.to = text;
        st.step = "amount";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "أرسل المبلغ.", { reply_markup: cancelKb() });
      }
      if (st.step === "amount") {
        const amount = Number(text.replace(",", "."));
        if (!(amount > 0)) return bot.sendMessage(msg.chat.id, "أدخل مبلغاً صالحاً.", { reply_markup: cancelKb() });
        st.amount = amount;
        st.step = "pin";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, hasTradePin(user) ? "أرسل رمز التحرير (6 أرقام) لتأكيد التحويل." : "عيّن رمز تحرير أولاً من «حسابي» ثم أعد المحاولة.", { reply_markup: cancelKb() });
      }
      if (st.step === "pin") {
        try {
          const { transfer, target } = ops.createTransfer(user, { to: st.to, asset: st.asset, amount: st.amount, tradePin: text });
          pending.delete(user.id);
          return bot.sendMessage(msg.chat.id, `تم تحويل ${transfer.amount} ${transfer.asset} إلى ${target.displayName} (UID ${target.uidCode}).`, { reply_markup: mainKeyboard(user) });
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر التحويل", { reply_markup: cancelKb() });
        }
      }
    }

    if (st && st.flow === "ad") {
      const n = Number(text.replace(",", "."));
      if (st.step === "ratio") {
        if (!(n > 0) || n > 10) return bot.sendMessage(msg.chat.id, "نسبة غير صالحة (أكبر من 0 وأقل من 10).", { reply_markup: cancelKb() });
        st.floatRatio = n;
        st.step = "min";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "الحد الأدنى للكمية:", { reply_markup: cancelKb() });
      }
      if (st.step === "price") {
        if (!(n > 0)) return bot.sendMessage(msg.chat.id, "سعر غير صالح.", { reply_markup: cancelKb() });
        st.price = n;
        st.step = "min";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "الحد الأدنى للكمية:", { reply_markup: cancelKb() });
      }
      if (st.step === "min") {
        if (!(n > 0)) return bot.sendMessage(msg.chat.id, "قيمة غير صالحة.", { reply_markup: cancelKb() });
        st.minAmount = n;
        st.step = "max";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "الحد الأقصى للكمية:", { reply_markup: cancelKb() });
      }
      if (st.step === "max") {
        if (!(n >= st.minAmount)) return bot.sendMessage(msg.chat.id, "يجب ألا يقل عن الحد الأدنى.", { reply_markup: cancelKb() });
        st.maxAmount = n;
        st.step = "avail";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "الكمية المتاحة في الإعلان:", { reply_markup: cancelKb() });
      }
      if (st.step === "avail") {
        try {
          const ad = await ops.createAd(user, {
            side: st.side,
            asset: st.asset || "USDT",
            fiat: st.fiat || "SYP",
            price: st.price,
            priceType: st.priceType || "fixed",
            floatRatio: st.floatRatio || 1,
            minAmount: st.minAmount,
            maxAmount: st.maxAmount,
            available: n,
            terms: "من البوت"
          });
          pending.delete(user.id);
          const kind = ad.priceType === "floating" ? `عائم ×${ad.floatRatio}` : "ثابت";
          return bot.sendMessage(msg.chat.id, `نُشر الإعلان #${ad.serial} · ${ad.side === "SELL" ? "بيع" : "شراء"} ${ad.asset}/${ad.fiat} @ ${ad.price} (${kind})`, { reply_markup: mainKeyboard(user) });
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر نشر الإعلان", { reply_markup: cancelKb() });
        }
      }
    }

    if (st && st.flow === "pay") {
      if (st.step === "address") {
        try {
          if (st.methodId) ops.updateShamCashMethod(user, st.methodId, { address: text });
          else ops.addShamCashMethod(user, { address: text });
          pending.delete(user.id);
          return bot.sendMessage(msg.chat.id, st.methodId ? "عُدّل عنوان شام كاش. اسم المستلم يبقى من التوثيق." : "أُضيفت طريقة شام كاش (الاسم من التوثيق، بدون رقم هاتف).", { reply_markup: mainKeyboard(user) });
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر الحفظ", { reply_markup: cancelKb() });
        }
      }
    }

    if (st && st.flow === "merchant") {
      if (st.step === "shop") {
        st.shopName = text;
        st.step = "note";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "ملاحظة اختيارية للإدارة (أو اكتب -):", { reply_markup: cancelKb() });
      }
      if (st.step === "note") {
        try {
          ops.applyMerchant(user, { shopName: st.shopName, note: text === "-" ? "" : text });
          pending.delete(user.id);
          return bot.sendMessage(msg.chat.id, isDemoUser(user) ? "تم اعتمادك تاجراً تجريبياً." : "أُرسل طلب التاجر للإدارة.", { reply_markup: mainKeyboard(user) });
        } catch (e) {
          pending.delete(user.id);
          return bot.sendMessage(msg.chat.id, e.message || "تعذر الإرسال", { reply_markup: mainKeyboard(user) });
        }
      }
    }

    if (st && st.flow === "kyc") {
      if (st.step === "name") {
        st.fullName = text;
        st.step = "nid";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "رقم الهوية أو جواز السفر:", { reply_markup: cancelKb() });
      }
      if (st.step === "nid") {
        st.nationalId = text;
        st.step = "kyc_file";
        st.kind = st.upgrade ? "residence" : "id_front";
        st.files = [];
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, st.upgrade ? "أرسل صورة إثبات السكن." : "أرسل صورة وجه الهوية.", { reply_markup: cancelKb() });
      }
    }

    if (st && st.flow === "supask") {
      const sess = assistantFor(user);
      sess.turns += 1;
      sess.unlocked = true;
      const result = supportBot.answer(text, { humanUnlocked: sess.unlocked });
      sess.topicId = result.topicId;
      pending.delete(user.id);
      return bot.sendMessage(msg.chat.id, result.reply, {
        reply_markup: supportQuickKeyboard(result, sess)
      });
    }

    if (st && st.flow === "support") {
      const sess = assistantFor(user);
      const gate = supportBot.canHandoff({
        turns: sess.turns,
        topicId: sess.topicId,
        force: sess.unlocked
      });
      if (!gate.ok) {
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, gate.error, { reply_markup: supportQuickKeyboard(supportBot.answer("", { humanUnlocked: false }), sess) });
      }
      try {
        createSupportTicket(user, text);
        save();
        sess.unlocked = true;
        pending.delete(user.id);
        return bot.sendMessage(
          msg.chat.id,
          "وصلت رسالتك للدعم البشري. سيظهر الرد في الإشعارات وصفحة الدعم في المنصة. لا ترسل كلمة المرور أو رمز التحرير.",
          { reply_markup: mainKeyboard(user) }
        );
      } catch (e) {
        return bot.sendMessage(msg.chat.id, e.message || "تعذر الإرسال", { reply_markup: cancelKb() });
      }
    }

    if (st && st.flow === "supreply" && st.ticketId) {
      if (!isAdminUser(user)) {
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, "للإدارة فقط.", { reply_markup: mainKeyboard(user) });
      }
      const ticket = supportTickets().find((t) => t.id === st.ticketId);
      if (!ticket || ticket.isDemo) {
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, "التذكرة غير موجودة.", { reply_markup: mainKeyboard(user) });
      }
      try {
        replySupportTicket(ticket, user, text);
        save();
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, `تم الرد على ${ticket.userId}.`, { reply_markup: mainKeyboard(user) });
      } catch (e) {
        return bot.sendMessage(msg.chat.id, e.message || "تعذر الرد", { reply_markup: cancelKb() });
      }
    }

    if (st && st.flow === "admaccess") {
      if (!isAdminUser(user)) {
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, "للإدارة فقط.", { reply_markup: mainKeyboard(user) });
      }
      const target = db.users.find((u) => String(u.uidCode) === text || u.username === text.toLowerCase());
      pending.delete(user.id);
      if (!target || isDemoUser(target) || target.isAdmin) {
        return bot.sendMessage(msg.chat.id, "مستخدم حقيقي غير موجود. أدخل UID أو اسم المستخدم.", { reply_markup: cancelKb() });
      }
      return bot.sendMessage(
        msg.chat.id,
        `${target.username} · UID ${target.uidCode}\nرمز التحرير: ${hasTradePin(target) ? "معيّن" : "غير معيّن"}\nقفل الرمز: ${target.tradePinLockedUntil && target.tradePinLockedUntil > now() ? "مقفل" : "لا"}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "كلمة مرور مؤقتة", callback_data: `recpass:${target.id}` }],
              [{ text: "مسح رمز التحرير", callback_data: `recpin:${target.id}` }],
              [{ text: "فك قفل الرمز", callback_data: `recunlock:${target.id}` }]
            ]
          }
        }
      );
    }

    if (st && st.flow === "merdecide") {
      if (!isAdminUser(user)) {
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, "للإدارة فقط.", { reply_markup: mainKeyboard(user) });
      }
      const note = String(text || "").trim();
      if (note.length < 3) return bot.sendMessage(msg.chat.id, "الملاحظة إلزامية (3 أحرف على الأقل).", { reply_markup: cancelKb() });
      const target = db.users.find((u) => u.id === st.userId);
      pending.delete(user.id);
      if (!target || isDemoUser(target)) return bot.sendMessage(msg.chat.id, "المستخدم غير موجود.", { reply_markup: mainKeyboard(user) });
      if (st.act === "ok") {
        target.isMerchant = true;
        target.merchantStatus = "approved";
        target.merchantDecisionNote = note.slice(0, 400);
        target.merchantDecidedAt = now();
        notify(target.id, "تم اعتمادك تاجراً", note.slice(0, 400));
        save();
        return bot.sendMessage(msg.chat.id, `تم اعتماد ${target.username} وأُرسلت الملاحظة.`, { reply_markup: mainKeyboard(user) });
      }
      target.isMerchant = false;
      target.merchantStatus = "rejected";
      target.merchantDecisionNote = note.slice(0, 400);
      target.merchantDecidedAt = now();
      notify(target.id, "تعذر اعتماد حسابك كتاجر", note.slice(0, 400));
      save();
      return bot.sendMessage(msg.chat.id, `رُفض طلب ${target.username} وأُرسلت الملاحظة.`, { reply_markup: mainKeyboard(user) });
    }

    if (st && st.flow === "admwallet") {
      if (!isAdminUser(user)) {
        pending.delete(user.id);
        return bot.sendMessage(msg.chat.id, "للإدارة فقط.", { reply_markup: mainKeyboard(user) });
      }
      if (st.step === "user") {
        const target = db.users.find((u) => String(u.uidCode) === text || u.username === text.toLowerCase());
        if (!target || isDemoUser(target)) return bot.sendMessage(msg.chat.id, "مستخدم حقيقي غير موجود. أدخل UID أو اسم المستخدم.", { reply_markup: cancelKb() });
        st.userId = target.id;
        st.step = "amount";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, `المستخدم ${target.username}. أرسل المبلغ:`, { reply_markup: cancelKb() });
      }
      if (st.step === "amount") {
        const amount = Number(text.replace(",", "."));
        if (!(amount > 0)) return bot.sendMessage(msg.chat.id, "مبلغ غير صالح.", { reply_markup: cancelKb() });
        const target = db.users.find((u) => u.id === st.userId);
        try {
          if (st.act === "credit") credit(target.id, st.asset, amount);
          else if (!debit(target.id, st.asset, amount)) throw new Error("الرصيد غير كافٍ");
          notify(target.id, st.act === "credit" ? "ترصيد إداري" : "خصم إداري", `${st.act === "credit" ? "أُضيف" : "خُصم"} ${amount} ${st.asset}`);
          save();
          pending.delete(user.id);
          return bot.sendMessage(msg.chat.id, `تم ${st.act === "credit" ? "إضافة" : "خصم"} ${amount} ${st.asset} لـ ${target.username}.`, { reply_markup: mainKeyboard(user) });
        } catch (e) {
          return bot.sendMessage(msg.chat.id, e.message || "تعذر التنفيذ", { reply_markup: cancelKb() });
        }
      }
    }

    if (user.accountFrozen || user.fundsFrozen) {
      const frozenMsg = user.accountFrozen ? "حسابك مجمّد." : "أموالك مجمّدة داخل المحفظة.";
      if (["شراء USDT", "بيع USDT", "إيداع", "سحب", "تحويل", "إعلاناتي"].includes(text)) {
        return bot.sendMessage(msg.chat.id, `${frozenMsg} ${user.freezeReason || "تواصل مع الدعم لفك التجميد."}`, {
          reply_markup: { inline_keyboard: [[{ text: "تواصل الدعم", callback_data: "support" }]] }
        });
      }
    }
    if (text === "شراء USDT") return sendAds(msg.chat.id, "SELL", "USDT", user);
    if (text === "بيع USDT") return sendAds(msg.chat.id, "BUY", "USDT", user);
    if (text === "محفظتي") {
      const lines = walletsOf(user.id).map((w) => `${w.asset}: متاح ${fmt(w.available, 6)} | مجمّد ${fmt(w.frozen, 6)}`);
      const depW = activeDepositWallet();
      const addr = (depW && depW.address) || db.settings.bep20Address || "—";
      const depName = depW ? `${depW.name}${depW.platform ? ` · ${depW.platform}` : ""}` : "الخزينة";
      return bot.sendMessage(msg.chat.id, `محفظتك\nUID: ${user.uidCode || "—"}\nالشبكة: BEP20 فقط\nمحفظة الإيداع: ${depName}\nالعنوان:\n${addr}\n\n` + lines.join("\n"), {
        reply_markup: {
          inline_keyboard: [
            [{ text: "إيداع", callback_data: "menu:deposit" }, { text: "سحب", callback_data: "menu:withdraw" }],
            [{ text: "تحويل UID", callback_data: "menu:transfer" }]
          ]
        }
      });
    }
    if (text === "إيداع") {
      pending.set(user.id, { flow: "deposit", step: "asset" });
      return bot.sendMessage(msg.chat.id, "اختر عملة الإيداع:", { reply_markup: { inline_keyboard: assetButtons("depasset") } });
    }
    if (text === "سحب") {
      pending.set(user.id, { flow: "withdraw", step: "asset" });
      return bot.sendMessage(msg.chat.id, "اختر عملة السحب:", { reply_markup: { inline_keyboard: assetButtons("wdasset") } });
    }
    if (text === "تحويل") {
      pending.set(user.id, { flow: "transfer", step: "asset" });
      return bot.sendMessage(msg.chat.id, "اختر عملة التحويل:", { reply_markup: { inline_keyboard: assetButtons("trasset") } });
    }
    if (text === "صفقاتي") {
      const orders = db.orders.filter((o) => o.buyerId === user.id || o.sellerId === user.id).slice(0, 8);
      if (!orders.length) return bot.sendMessage(msg.chat.id, "لا توجد صفقات بعد.");
      const rows = orders.map((o) => [
        { text: `${statusAr(o.status)} ${o.amount} ${o.asset}`, callback_data: `ord:${o.id}` }
      ]);
      return bot.sendMessage(msg.chat.id, "آخر صفقاتك:", { reply_markup: { inline_keyboard: rows } });
    }
    if (text === "إعلاناتي") {
      const ads = db.ads.filter((a) => a.userId === user.id && a.status !== "closed");
      const rows = [
        [{ text: "نشر إعلان بيع", callback_data: "adnew:SELL" }, { text: "نشر إعلان شراء", callback_data: "adnew:BUY" }]
      ];
      ads.slice(0, 8).forEach((a) => {
        rows.push([{ text: `#${a.serial} ${a.status === "active" ? "إيقاف" : "تشغيل"} ${a.side === "SELL" ? "بيع" : "شراء"} ${a.asset}`, callback_data: `adtog:${a.id}` }]);
      });
      if (!ads.length) {
        return bot.sendMessage(msg.chat.id, "ليس لديك إعلانات. يمكنك نشر إعلان من هنا إن كنت تاجراً موثّقاً.", {
          reply_markup: { inline_keyboard: rows }
        });
      }
      const lines = ads.map(
        (a) => `#${a.serial || "-"} ${a.side === "SELL" ? "بيع" : "شراء"} ${a.asset}/${a.fiat} @ ${a.price} | ${statusAr(a.status)} | المتاح ${fmt(a.available)} ${a.asset}`
      );
      return bot.sendMessage(msg.chat.id, "إعلاناتي:\n" + lines.join("\n"), { reply_markup: { inline_keyboard: rows } });
    }
    if (text === "حسابي") {
      return bot.sendMessage(msg.chat.id, kycStatusLine(user), {
        reply_markup: {
          inline_keyboard: [
            [{ text: user.kycStatus === "verified" ? "ترقية توثيق متقدم" : "بدء التوثيق", callback_data: user.kycStatus === "verified" && user.kycLevel !== "advanced" ? "kycgo:adv" : "kycgo:basic" }],
            [{ text: "طرق الدفع", callback_data: "paylist" }, { text: "طلب تاجر", callback_data: "merapply" }],
            [{ text: hasTradePin(user) ? "تغيير رمز التحرير" : "تعيين رمز التحرير", callback_data: "pinset" }],
            [webAppButton("فتح الملف في المنصة")]
          ]
        }
      });
    }
    if (text === "الإشعارات") {
      const items = db.notifications.filter((n) => n.userId === user.id).slice(0, 8);
      if (!items.length) return bot.sendMessage(msg.chat.id, "لا توجد إشعارات حالياً.");
      const lines = items
        .map((n) => `${n.read ? "" : "● "}${n.title}\n${n.body}`)
        .join("\n\n");
      items.forEach((n) => { n.read = true; });
      save();
      return bot.sendMessage(msg.chat.id, lines);
    }
    if (text === "تواصل الدعم") {
      pending.delete(user.id);
      return sendSupport(msg.chat.id, true, user);
    }
    if (text === "فتح المنصة") {
      return bot.sendMessage(msg.chat.id, "افتح الموقع داخل تلغرام:", {
        reply_markup: { inline_keyboard: [[webAppButton("فتح المنصة")]] }
      });
    }
    if (text === "تحميل التطبيق") {
      return bot.sendMessage(
        msg.chat.id,
        "حمّل تطبيق USDT شام لأندرويد (APK).\nإن ظهر تحذير التثبيت من مصادر غير معروفة فاسمح به من إعدادات الهاتف.",
        { reply_markup: { inline_keyboard: [[apkButton("تحميل تطبيق أندرويد")]] } }
      );
    }
    if (text === "لوحة الإدارة") {
      if (!isAdminUser(user)) return bot.sendMessage(msg.chat.id, "هذه اللوحة للمدير فقط.");
      return sendAdminPanel(msg.chat.id);
    }
  });

  bot.on("callback_query", async (q) => {
    const msg = q.message;
    const user = ensureUserFromTelegram(q.from);
    if (appIsDown() && !isAdminUser(user)) {
      return bot.answerCallbackQuery(q.id, { text: downMessage(), show_alert: true });
    }
    const [action, id, extra] = (q.data || "").split(":");

    if (action === "support") {
      bot.answerCallbackQuery(q.id);
      pending.delete(user.id);
      return sendSupport(msg.chat.id, true, user);
    }

    if (action === "supq") {
      bot.answerCallbackQuery(q.id);
      const sess = assistantFor(user);
      if (id !== "human") {
        sess.turns += 1;
        sess.unlocked = true;
      }
      if (id === "human" && !sess.unlocked) {
        return bot.sendMessage(msg.chat.id, "اسأل المساعد الآلي أولاً ثم يُفتح التحويل للدعم البشري.", {
          reply_markup: supportQuickKeyboard(supportBot.answer("", { humanUnlocked: false }), sess)
        });
      }
      const result = supportBot.topicReply(id, { humanUnlocked: sess.unlocked });
      sess.topicId = result.topicId;
      return bot.sendMessage(msg.chat.id, result.reply, { reply_markup: supportQuickKeyboard(result, sess) });
    }

    if (action === "supask") {
      pending.set(user.id, { flow: "supask" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "اكتب سؤالك وسيجيبك المساعد الآلي فوراً:", { reply_markup: cancelKb() });
    }

    if (action === "suphuman") {
      const sess = assistantFor(user);
      const gate = supportBot.canHandoff({
        turns: sess.turns,
        topicId: sess.topicId,
        force: sess.unlocked
      });
      if (!gate.ok) {
        bot.answerCallbackQuery(q.id, { text: "جرّب المساعد أولاً" });
        return bot.sendMessage(msg.chat.id, gate.error, {
          reply_markup: supportQuickKeyboard(supportBot.answer("", { humanUnlocked: false }), sess)
        });
      }
      pending.set(user.id, { flow: "support" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(
        msg.chat.id,
        "اكتب وصف المشكلة ليصل الطلب إلى الدعم البشري. أضف رقم الصفقة أو هاش التحويل إن وُجد. لا ترسل كلمة المرور أو رمز التحرير.",
        { reply_markup: cancelKb() }
      );
    }

    if (action === "admsup") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      bot.answerCallbackQuery(q.id);
      const tickets = supportTickets().filter((t) => t.status === "open" && !t.isDemo).slice(0, 10);
      if (!tickets.length) return bot.sendMessage(msg.chat.id, "لا توجد تذاكر دعم مفتوحة.");
      const rows = tickets.map((t) => {
        const u = db.users.find((x) => x.id === t.userId);
        const last = (t.messages || [])[(t.messages || []).length - 1];
        return [{ text: `${u?.username || "?"} · ${(last && last.text || "").slice(0, 24)}`, callback_data: `supview:${t.id}` }];
      });
      return bot.sendMessage(msg.chat.id, "تذاكر الدعم المفتوحة:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "supview") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const ticket = supportTickets().find((t) => t.id === id);
      if (!ticket || ticket.isDemo) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      const u = db.users.find((x) => x.id === ticket.userId);
      bot.answerCallbackQuery(q.id);
      const lines = (ticket.messages || []).slice(-8).map((m) => `${m.from === "admin" ? "دعم" : u?.username || "مستخدم"}: ${m.text}`);
      return bot.sendMessage(
        msg.chat.id,
        `${u?.username || "?"} · UID ${u?.uidCode || "—"}\n${lines.join("\n")}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "رد", callback_data: `supreply:${ticket.id}` }],
              [{ text: "إغلاق", callback_data: `supclose:${ticket.id}` }]
            ]
          }
        }
      );
    }

    if (action === "supreply") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const ticket = supportTickets().find((t) => t.id === id);
      if (!ticket || ticket.isDemo) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      pending.set(user.id, { flow: "supreply", ticketId: ticket.id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "أرسل نص الرد:", { reply_markup: cancelKb() });
    }

    if (action === "supclose") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const ticket = supportTickets().find((t) => t.id === id);
      if (!ticket || ticket.isDemo) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      closeSupportTicket(ticket);
      save();
      bot.answerCallbackQuery(q.id, { text: "أُغلق" });
      return bot.sendMessage(msg.chat.id, "أُغلقت المحادثة وحُذفت.");
    }

    if (action === "help") {
      bot.answerCallbackQuery(q.id);
      if (!id || id === "menu") {
        return bot.sendMessage(msg.chat.id, helpGuide.overview(), { reply_markup: helpGuide.listKeyboard() });
      }
      return bot.sendMessage(msg.chat.id, helpGuide.sectionMessage(id), { reply_markup: helpGuide.topicKeyboard(id) });
    }

    if (action === "menu") {
      bot.answerCallbackQuery(q.id);
      if (id === "deposit") {
        pending.set(user.id, { flow: "deposit", step: "asset" });
        return bot.sendMessage(msg.chat.id, "اختر عملة الإيداع:", { reply_markup: { inline_keyboard: assetButtons("depasset") } });
      }
      if (id === "withdraw") {
        pending.set(user.id, { flow: "withdraw", step: "asset" });
        return bot.sendMessage(msg.chat.id, "اختر عملة السحب:", { reply_markup: { inline_keyboard: assetButtons("wdasset") } });
      }
      if (id === "transfer") {
        pending.set(user.id, { flow: "transfer", step: "asset" });
        return bot.sendMessage(msg.chat.id, "اختر عملة التحويل:", { reply_markup: { inline_keyboard: assetButtons("trasset") } });
      }
    }

    if (action === "depasset") {
      pending.set(user.id, { flow: "deposit", step: "amount", asset: id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, `المبلغ المراد إيداعه (${id}):`, { reply_markup: cancelKb() });
    }
    if (action === "wdasset") {
      pending.set(user.id, { flow: "withdraw", step: "amount", asset: id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, `المبلغ المراد سحبه (${id}):`, { reply_markup: cancelKb() });
    }
    if (action === "trasset") {
      pending.set(user.id, { flow: "transfer", step: "to", asset: id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "أرسل UID أو اسم المستخدم للمستلم:", { reply_markup: cancelKb() });
    }
    if (action === "adnew") {
      pending.set(user.id, { flow: "ad", step: "fiat", side: id, asset: "USDT" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "اختر الفيات:", {
        reply_markup: { inline_keyboard: [[{ text: "ليرة SYP", callback_data: "adfiat:SYP" }, { text: "دولار USD", callback_data: "adfiat:USD" }]] }
      });
    }
    if (action === "adfiat") {
      const st = pending.get(user.id) || { flow: "ad", step: "ptype", side: "SELL", asset: "USDT" };
      st.fiat = id;
      st.step = "ptype";
      pending.set(user.id, st);
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "نوع الطلب:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "ثابت — سعر لا يتأثر بالسوق", callback_data: "adptype:fixed" }],
            [{ text: "عائم — سعر السوق × النسبة", callback_data: "adptype:floating" }]
          ]
        }
      });
    }
    if (action === "adptype") {
      const st = pending.get(user.id) || { flow: "ad", step: "price", side: "SELL", asset: "USDT", fiat: "USD" };
      st.priceType = id === "floating" ? "floating" : "fixed";
      st.step = st.priceType === "floating" ? "ratio" : "price";
      pending.set(user.id, st);
      bot.answerCallbackQuery(q.id);
      if (st.priceType === "floating") {
        let hint = "أرسل النسبة (مثل 1.1 يعني السوق × 1.1):";
        try {
          const { quote } = await ops.suggestedAdPrice(st.side, st.asset || "USDT", st.fiat || "USD");
          if (quote && quote.market > 0) hint += `\nالسوق الآن: ${fmt(quote.market, 4)} ${st.fiat}`;
          const lo = st.side === "BUY" ? quote && quote.buyMin : quote && quote.sellMin;
          const hi = st.side === "BUY" ? quote && quote.buyMax : quote && quote.sellMax;
          if (lo > 0 || hi > 0) {
            hint += `\nحد ${st.side === "BUY" ? "الشراء" : "البيع"}: ${lo > 0 ? fmt(lo, 4) : "—"} إلى ${hi > 0 ? fmt(hi, 4) : "—"}`;
          }
        } catch {
          /* keep default */
        }
        return bot.sendMessage(msg.chat.id, hint, { reply_markup: cancelKb() });
      }
      let hint = `أرسل سعر ${st.asset || "USDT"}/${st.fiat || "USD"}:`;
      try {
        const { quote, suggested } = await ops.suggestedAdPrice(st.side, st.asset || "USDT", st.fiat || "USD");
        if (suggested > 0) {
          hint += `\nالمقترح: ${fmt(suggested, 4)} ${st.fiat}`;
          if (quote && quote.market > 0) hint += `\nالسوق: ${fmt(quote.market, 4)}`;
          const lo = st.side === "BUY" ? quote && quote.buyMin : quote && quote.sellMin;
          const hi = st.side === "BUY" ? quote && quote.buyMax : quote && quote.sellMax;
          if (lo > 0 || hi > 0) {
            hint += `\nحد ${st.side === "BUY" ? "الشراء" : "البيع"}: ${lo > 0 ? fmt(lo, 4) : "—"} إلى ${hi > 0 ? fmt(hi, 4) : "—"}`;
          }
        }
      } catch {
        /* keep default prompt */
      }
      return bot.sendMessage(msg.chat.id, hint, { reply_markup: cancelKb() });
    }
    if (action === "adtog") {
      try {
        const ad = ops.toggleAd(user, id);
        bot.answerCallbackQuery(q.id, { text: ad.status === "active" ? "نشط" : "متوقف" });
        return bot.sendMessage(msg.chat.id, `الإعلان #${ad.serial} أصبح ${ad.status === "active" ? "نشطاً" : "متوقفاً"}.`);
      } catch (e) {
        return bot.answerCallbackQuery(q.id, { text: e.message || "تعذر التبديل" });
      }
    }
    if (action === "kycgo") {
      const upgrade = id === "adv";
      if (user.kycStatus === "verified" && user.kycLevel === "advanced") {
        return bot.answerCallbackQuery(q.id, { text: "موثّق متقدم مسبقاً" });
      }
      pending.set(user.id, {
        flow: "kyc",
        step: upgrade ? "kyc_file" : "name",
        upgrade,
        kind: upgrade ? "residence" : "id_front",
        files: [],
        fullName: (user.kyc && user.kyc.fullName) || user.displayName,
        nationalId: (user.kyc && user.kyc.nationalId) || "",
        country: "SY"
      });
      bot.answerCallbackQuery(q.id);
      if (upgrade) {
        const st = pending.get(user.id);
        st.step = "kyc_file";
        pending.set(user.id, st);
        return bot.sendMessage(msg.chat.id, "أرسل صورة إثبات السكن للتوثيق المتقدم.", { reply_markup: cancelKb() });
      }
      return bot.sendMessage(msg.chat.id, "الاسم الحقيقي كما في الهوية:", { reply_markup: cancelKb() });
    }
    if (action === "paylist") {
      bot.answerCallbackQuery(q.id);
      const methods = ops.listPaymentMethods(user);
      const rows = methods.map((m) => {
        const addr = (m.details && (m.details.address || m.details.account)) || "";
        return [{ text: `${m.label || "شام كاش"} · ${String(addr).slice(0, 8)}`, callback_data: `payview:${m.id}` }];
      });
      if (!methods.some((m) => m.type === "SHAM_CASH")) rows.push([{ text: "إضافة شام كاش", callback_data: "payadd" }]);
      return bot.sendMessage(
        msg.chat.id,
        methods.length
          ? `طرق الدفع المحفوظة (طريقة واحدة لكل نوع):\nاسم المستلم ثابت من التوثيق: ${(user.kyc && user.kyc.fullName) || "—"}\nاضغط طريقة للتعديل أو الحذف.`
          : "لا توجد طرق دفع. أضف عنوان شام كاش أولاً.",
        { reply_markup: { inline_keyboard: rows } }
      );
    }
    if (action === "payview") {
      const method = ops.listPaymentMethods(user).find((m) => m.id === id);
      if (!method) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      bot.answerCallbackQuery(q.id);
      const addr = (method.details && (method.details.address || method.details.account)) || "—";
      const name = (method.details && method.details.name) || (user.kyc && user.kyc.fullName) || "—";
      return bot.sendMessage(
        msg.chat.id,
        `شام كاش\nالوصف: ${method.label || "—"}\nاسم المستلم (من التوثيق): ${name}\nالعنوان: ${addr}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "تعديل العنوان", callback_data: `payedit:${method.id}` }],
              [{ text: "حذف", callback_data: `paydel:${method.id}` }]
            ]
          }
        }
      );
    }
    if (action === "payedit") {
      pending.set(user.id, { flow: "pay", step: "address", methodId: id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "أرسل عنوان شام كاش الجديد (32 خانة). الاسم يبقى من التوثيق.", { reply_markup: cancelKb() });
    }
    if (action === "paydel") {
      try {
        const result = ops.removePaymentMethod(user, id);
        bot.answerCallbackQuery(q.id, { text: "حُذفت" });
        return bot.sendMessage(
          msg.chat.id,
          result.pausedAds ? "حُذفت طريقة الدفع. أُوقفت إعلاناتك حتى تضيف عنواناً نشطاً." : "حُذفت طريقة الدفع.",
          { reply_markup: mainKeyboard(user) }
        );
      } catch (e) {
        return bot.answerCallbackQuery(q.id, { text: e.message || "تعذر الحذف" });
      }
    }
    if (action === "payadd") {
      const exists = ops.listPaymentMethods(user).find((m) => m.type === "SHAM_CASH");
      if (exists) {
        bot.answerCallbackQuery(q.id, { text: "شام كاش مسجّلة مسبقاً" });
        return bot.sendMessage(msg.chat.id, "لديك شام كاش واحدة فقط. عدّلها أو احذفها ثم أضف من جديد.");
      }
      pending.set(user.id, { flow: "pay", step: "address" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "أرسل عنوان شام كاش (32 خانة hex). طريقة واحدة فقط لكل نوع دفع.", { reply_markup: cancelKb() });
    }
    if (action === "pinset") {
      pending.set(user.id, { flow: "pinset", step: hasTradePin(user) ? "current" : "new" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(
        msg.chat.id,
        hasTradePin(user) ? "أرسل رمز التحرير الحالي أولاً." : "أرسل رمز تحرير جديداً من 6 أرقام واحفظه في ذاكرتك. لا تستخدم 000000 أو تكرار رقم واحد.",
        { reply_markup: cancelKb() }
      );
    }
    if (action === "merapply") {
      pending.set(user.id, { flow: "merchant", step: "shop" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "اسم المتجر الظاهر:", { reply_markup: cancelKb() });
    }

    if (action === "buyad" || action === "sellad") {
      const ad = db.ads.find((a) => a.id === id);
      if (!ad) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      if (adIsDemo(ad) !== isDemoUser(user)) {
        return bot.answerCallbackQuery(q.id, { text: "هذا الإعلان من صندوق آخر" });
      }
      pending.set(user.id, { step: "amount", adId: ad.id });
      bot.answerCallbackQuery(q.id);
      bot.sendMessage(
        msg.chat.id,
        `إعلان ${ad.side === "SELL" ? "بيع" : "شراء"} ${ad.asset}\nالسعر: ${ad.price} ${ad.fiat}\nالحد: ${ad.minAmount} - ${ad.maxAmount}\nالدفع: ${ad.paymentTypes.join(", ")}\nالشروط: ${ad.terms}\n\nأرسل الكمية الآن (${ad.asset})`
      );
      return;
    }

    if (action === "ord") {
      const order = db.orders.find((o) => o.id === id);
      if (!order) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      bot.answerCallbackQuery(q.id);
      const buttons = [];
      if (order.status === "pending_payment" && order.buyerId === user.id) {
        buttons.push([{ text: evidenceStore.hasPaymentProof(order.evidence) ? "أكدت الدفع" : "ارفع إثبات الدفع", callback_data: `paid:${order.id}` }]);
      }
      if (order.status === "disputed") {
        buttons.push([{ text: "ارفع فيديو/صورة للنزاع", callback_data: `evup:${order.id}` }]);
      }
      if ((order.status === "paid" || order.status === "disputed") && order.sellerId === user.id) {
        buttons.push([{ text: "إفراج عن العملة", callback_data: `release:${order.id}` }]);
      }
      if (["pending_payment", "paid"].includes(order.status)) {
        buttons.push([{ text: "فتح نزاع", callback_data: `dispute:${order.id}` }]);
      }
      if (order.status === "pending_payment") {
        buttons.push([{ text: "إلغاء", callback_data: `cancel:${order.id}` }]);
      }
      bot.sendMessage(msg.chat.id, formatOrder(order, user), {
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }

    if (action === "paid") {
      const order = db.orders.find((o) => o.id === id);
      if (!order || order.buyerId !== user.id) return bot.answerCallbackQuery(q.id, { text: "غير مسموح" });
      if (order.status !== "pending_payment") return bot.answerCallbackQuery(q.id, { text: "حالة غير صالحة" });
      if (db.settings.requirePaymentProof !== false && !evidenceStore.hasPaymentProof(order.evidence)) {
        pending.set(user.id, { step: "proof", orderId: order.id });
        bot.answerCallbackQuery(q.id, { text: "ارفع صورة الإثبات أولاً" });
        bot.sendMessage(msg.chat.id, "أرسل الآن صورة إيصال شام كاش (لقطة شاشة واضحة). بعد استلامها يمكنك تأكيد الدفع.");
        return;
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
      notify(order.sellerId, "تم الدفع", `صفقة ${order.id}`, { orderId: order.id });
      save();
      pingSellerTelegram(bot, order);
      bot.answerCallbackQuery(q.id, { text: "تم تسجيل الدفع" });
      bot.sendMessage(msg.chat.id, "تم إشعار البائع. انتظر الإفراج.");
      return;
    }

    if (action === "evup") {
      const order = db.orders.find((o) => o.id === id);
      if (!order) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      if (order.buyerId !== user.id && order.sellerId !== user.id) return bot.answerCallbackQuery(q.id, { text: "غير مسموح" });
      pending.set(user.id, { step: "dispute_file", orderId: order.id });
      bot.answerCallbackQuery(q.id);
      bot.sendMessage(msg.chat.id, "أرسل فيديو قصيراً أو صورة للنزاع (يظهر للإدارة).");
      return;
    }

    if (action === "release") {
      const order = db.orders.find((o) => o.id === id);
      if (!order || order.sellerId !== user.id) return bot.answerCallbackQuery(q.id, { text: "غير مسموح" });
      if (!["paid", "disputed"].includes(order.status)) {
        return bot.answerCallbackQuery(q.id, { text: "حالة غير صالحة" });
      }
      if (!hasTradePin(user)) {
        bot.answerCallbackQuery(q.id, { text: "عيّن رمز التحرير أولاً" });
        return bot.sendMessage(msg.chat.id, "عيّن رمز تحرير من 6 أرقام في «حسابي» قبل الإفراج.");
      }
      pending.set(user.id, { flow: "release", step: "pin", orderId: order.id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, "أرسل رمز التحرير (6 أرقام) لتأكيد الإفراج عن العملة.", { reply_markup: cancelKb() });
    }

    if (action === "cancel") {
      const order = db.orders.find((o) => o.id === id);
      if (!order) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        return bot.answerCallbackQuery(q.id, { text: "غير مسموح" });
      }
      if (order.status !== "pending_payment") return bot.answerCallbackQuery(q.id, { text: "لا يمكن الإلغاء" });
      const ad = db.ads.find((a) => a.id === order.adId);
      if (ad) {
        ad.available = Math.round((ad.available + order.amount) * 1e8) / 1e8;
        if (ad.status === "filled") ad.status = "active";
      }
      if (ad && ad.side === "BUY") unfreeze(order.sellerId, order.asset, order.amount);
      order.status = "cancelled";
      order.cancelledAt = now();
      save();
      bot.answerCallbackQuery(q.id, { text: "أُلغيت" });
      bot.sendMessage(msg.chat.id, "أُلغيت الصفقة.");
      return;
    }

    if (action === "dispute") {
      const order = db.orders.find((o) => o.id === id);
      if (!order) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        return bot.answerCallbackQuery(q.id, { text: "غير مسموح" });
      }
      if (!["pending_payment", "paid"].includes(order.status)) {
        return bot.answerCallbackQuery(q.id, { text: "لا يمكن فتح نزاع الآن" });
      }
      order.status = "disputed";
      order.disputeReason = "نزاع عبر تلغرام";
      order.disputeOpenedBy = user.id;
      order.disputedAt = now();
      notify(order.buyerId === user.id ? order.sellerId : order.buyerId, "نزاع على صفقة", "فُتح نزاع عبر تلغرام", { orderId: order.id });
      if (!orderIsDemo(order)) {
        db.users.filter((u) => u.isAdmin).forEach((a) => notify(a.id, "نزاع جديد", `صفقة ${order.id.slice(-8)}`, { orderId: order.id, href: `/admin?tab=orders&order=${order.id}` }));
      }
      save();
      bot.answerCallbackQuery(q.id, { text: "تم فتح النزاع" });
      bot.sendMessage(msg.chat.id, "تم فتح نزاع. العملة تبقى في الضمان حتى إفراج البائع أو قرار الإدارة. أرسل فيديو أو صورة للإثبات إن وُجد.");
      pending.set(user.id, { step: "dispute_file", orderId: order.id });
      return;
    }

    if (action === "admin" || action.startsWith("adm")) {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
    }

    if (action === "admin") {
      bot.answerCallbackQuery(q.id);
      return sendAdminPanel(msg.chat.id);
    }

    if (action === "admkyc") {
      bot.answerCallbackQuery(q.id);
      const pendingKyc = liveUsers().filter((u) => u.kycStatus === "submitted" || u.kycUpgradePending).slice(0, 8);
      if (!pendingKyc.length) return bot.sendMessage(msg.chat.id, "لا توجد طلبات KYC معلّقة.");
      const rows = pendingKyc.map((u) => [
        { text: `عرض ملف ${u.username}`, callback_data: `kycview:${u.id}` }
      ]);
      return bot.sendMessage(msg.chat.id, "افتح الملف الكامل قبل القبول أو الرفض:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "kycview") {
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target) || !target.kyc) return bot.answerCallbackQuery(q.id, { text: "لا يوجد ملف" });
      bot.answerCallbackQuery(q.id);
      const k = target.kyc;
      const files = k.files || [];
      const level = k.level || target.kycLevel || "basic";
      await bot.sendMessage(
        msg.chat.id,
        `ملف توثيق ${target.username}\nالمستوى: ${level === "advanced" ? "متقدم" : "أساسي"}\nالاسم: ${k.fullName || "—"}\nالهوية: ${k.nationalId || "—"}\nالوثيقة: ${kycStore.docLabel(k.documentType)}\nالدولة: ${k.country || "—"}\nالهاتف: ${k.phone || "—"}\nالعنوان: ${k.address || "—"}\nالملفات: ${files.length}\nاطلع على الصور أدناه ثم قرر. للطباعة استخدم لوحة الموقع.`
      );
      for (const f of files) {
        try {
          const caption = `${kycStore.kindLabel(f.kind)} — ${f.name}`;
          if (kycStore.isImage(f)) {
            await bot.sendPhoto(msg.chat.id, kycStore.fileAbsPath(target.id, f), { caption });
          } else {
            await bot.sendDocument(msg.chat.id, kycStore.fileAbsPath(target.id, f), { caption });
          }
        } catch {
          await bot.sendMessage(msg.chat.id, `تعذر إرسال ${kycStore.kindLabel(f.kind)}`);
        }
      }
      if (!kycStore.hasRequiredFiles(k)) {
        return bot.sendMessage(msg.chat.id, "الملف ناقص. لا يمكن القبول حتى تكتمل الصور.");
      }
      if (level === "advanced" && !kycStore.hasAdvancedFiles(k)) {
        return bot.sendMessage(msg.chat.id, "التوثيق المتقدم يتطلب إثبات السكن. لا يمكن القبول.");
      }
      return bot.sendMessage(msg.chat.id, "بعد الاطلاع:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "قبول بعد الاطلاع", callback_data: `kycok:${target.id}` },
              { text: "رفض", callback_data: `kycno:${target.id}` }
            ]
          ]
        }
      });
    }

    if (action === "kycok" || action === "kycno") {
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target)) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      const level = (target.kyc && target.kyc.level) || target.kycLevel || "basic";
      if (action === "kycok" && !kycStore.hasRequiredFiles(target.kyc)) {
        return bot.answerCallbackQuery(q.id, { text: "الملف ناقص", show_alert: true });
      }
      if (action === "kycok" && level === "advanced" && !kycStore.hasAdvancedFiles(target.kyc)) {
        return bot.answerCallbackQuery(q.id, { text: "التوثيق المتقدم يتطلب إثبات السكن", show_alert: true });
      }
      target.kycStatus = action === "kycok" ? "verified" : "rejected";
      target.kycLevel = action === "kycok" ? level : "none";
      if (!target.kyc) target.kyc = {};
      target.kyc.reviewedAt = now();
      target.kyc.reviewedBy = user.id;
      const reqRow = db.kycRequests.find((k) => k.userId === target.id && k.status === "submitted");
      if (reqRow) {
        reqRow.status = target.kycStatus;
        reqRow.level = level;
      }
      notify(target.id, action === "kycok" ? "تم قبول KYC" : "رُفض توثيق KYC", "");
      save();
      bot.answerCallbackQuery(q.id, { text: "تم" });
      return bot.sendMessage(msg.chat.id, `KYC لـ ${target.username}: ${target.kycStatus === "verified" ? `مقبول (${level})` : "مرفوض"}`);
    }

    if (action === "admdep") {
      bot.answerCallbackQuery(q.id);
      const pendingDeps = liveItemsByUser(db.deposits).filter((d) => d.status === "pending").slice(0, 8);
      if (!pendingDeps.length) return bot.sendMessage(msg.chat.id, "لا توجد إيداعات معلّقة.");
      const rows = pendingDeps.map((d) => [
        { text: `قبول ${d.amount} ${d.asset}`, callback_data: `depok:${d.id}` },
        { text: "رفض", callback_data: `depno:${d.id}` }
      ]);
      return bot.sendMessage(msg.chat.id, "إيداعات BEP20:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "depok" || action === "depno") {
      const deposit = db.deposits.find((d) => d.id === id);
      if (!deposit || deposit.status !== "pending" || isDemoUser(db.users.find((u) => u.id === deposit.userId))) {
        return bot.answerCallbackQuery(q.id, { text: "غير صالح" });
      }
      deposit.reviewedAt = now();
      deposit.reviewedBy = user.id;
      if (action === "depok") {
        credit(deposit.userId, deposit.asset, deposit.amount);
        deposit.status = "credited";
      } else {
        deposit.status = "rejected";
      }
      save();
      bot.answerCallbackQuery(q.id, { text: "تم" });
      return bot.sendMessage(msg.chat.id, action === "depok" ? "تم إضافة الرصيد." : "رُفض الإيداع.");
    }

    if (action === "admwd") {
      bot.answerCallbackQuery(q.id);
      const pending = liveItemsByUser(db.withdrawals).filter((w) => w.status === "pending").slice(0, 8);
      if (!pending.length) return bot.sendMessage(msg.chat.id, "لا توجد طلبات سحب معلّقة.");
      const rows = pending.map((w) => {
        const owner = db.users.find((u) => u.id === w.userId);
        return [{ text: `${owner?.username || "?"} ${w.amount} ${w.asset} → ${w.toAddress.slice(0, 10)}...`, callback_data: `wdview:${w.id}` }];
      });
      return bot.sendMessage(msg.chat.id, "طلبات السحب المعلّقة:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "wdview") {
      const w = db.withdrawals.find((x) => x.id === id);
      if (!w || isDemoUser(db.users.find((u) => u.id === w.userId))) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      bot.answerCallbackQuery(q.id);
      const owner = db.users.find((u) => u.id === w.userId);
      return bot.sendMessage(
        msg.chat.id,
        `طلب سحب ${owner?.username || w.userId}\nالمبلغ: ${w.amount} ${w.asset}\nالرسوم: ${w.fee}\nالإجمالي المحجوز: ${w.total}\nالشبكة: ${w.network}\nإلى: ${w.toAddress}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "تنفيذ السحب", callback_data: `wdok:${w.id}` },
                { text: "رفض وإرجاع الرصيد", callback_data: `wdno:${w.id}` }
              ]
            ]
          }
        }
      );
    }

    if (action === "wdok" || action === "wdno") {
      const w = db.withdrawals.find((x) => x.id === id);
      if (!w || w.status !== "pending" || isDemoUser(db.users.find((u) => u.id === w.userId))) {
        return bot.answerCallbackQuery(q.id, { text: "غير صالح" });
      }
      w.reviewedAt = now();
      w.reviewedBy = user.id;
      if (action === "wdok") {
        settleFrozen(w.userId, w.asset, w.total);
        w.status = "completed";
        notify(w.userId, "تم تنفيذ السحب", `أُرسل ${w.amount} ${w.asset} إلى ${w.toAddress}`);
      } else {
        unfreeze(w.userId, w.asset, w.total);
        w.status = "rejected";
        notify(w.userId, "رُفض طلب السحب", "أُعيد الرصيد إلى محفظتك.");
      }
      save();
      bot.answerCallbackQuery(q.id, { text: "تم" });
      return bot.sendMessage(msg.chat.id, action === "wdok" ? "تم تنفيذ السحب." : "رُفض الطلب وأُعيد الرصيد.");
    }

    if (action === "admord") {
      bot.answerCallbackQuery(q.id);
      const open = db.orders.filter((o) => ["pending_payment", "paid", "disputed"].includes(o.status) && !orderIsDemo(o)).slice(0, 8);
      if (!open.length) return bot.sendMessage(msg.chat.id, "لا صفقات مفتوحة.");
      const rows = open.map((o) => [{ text: `${statusAr(o.status)} ${o.amount} ${o.asset}`, callback_data: `ord:${o.id}` }]);
      return bot.sendMessage(msg.chat.id, "الصفقات المفتوحة:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "admpay") {
      bot.answerCallbackQuery(q.id);
      const rows = db.paymentTypes.map((p) => [
        { text: `${p.enabled ? "إيقاف" : "تفعيل"} ${p.name}`, callback_data: `paytog:${p.id}` }
      ]);
      return bot.sendMessage(msg.chat.id, "طرق الدفع:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "paytog") {
      const item = db.paymentTypes.find((p) => p.id === id);
      if (!item) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      item.enabled = !item.enabled;
      save();
      bot.answerCallbackQuery(q.id, { text: item.enabled ? "مفعّلة" : "متوقفة" });
      return sendAdminPanel(msg.chat.id);
    }

    if (action === "admcoin") {
      bot.answerCallbackQuery(q.id);
      const rows = db.assets.map((a) => [
        { text: `${a.enabled ? "إيقاف" : "تفعيل"} ${a.symbol}`, callback_data: `cointog:${a.symbol}` }
      ]);
      return bot.sendMessage(msg.chat.id, "عملات المنصة:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "cointog") {
      const asset = db.assets.find((a) => a.symbol === id);
      if (!asset) return bot.answerCallbackQuery(q.id, { text: "غير موجودة" });
      asset.enabled = !asset.enabled;
      save();
      bot.answerCallbackQuery(q.id, { text: asset.enabled ? "مفعّلة" : "متوقفة" });
      return sendAdminPanel(msg.chat.id);
    }

    if (action === "admmerch") {
      bot.answerCallbackQuery(q.id);
      const pending = liveUsers().filter((u) => u.merchantStatus === "pending").slice(0, 8);
      const approved = liveUsers().filter((u) => u.merchantStatus === "approved" || u.isMerchant).slice(0, 8);
      const rows = [
        ...pending.map((u) => [{ text: `طلب: ${u.merchantShop || u.displayName || u.username}`, callback_data: `merview:${u.id}` }]),
        ...approved.map((u) => [{ text: `ترقية: ${u.displayName || u.username}`, callback_data: `merview:${u.id}` }])
      ];
      if (!rows.length) return bot.sendMessage(msg.chat.id, "لا توجد طلبات أو تجار للترقية.");
      return bot.sendMessage(msg.chat.id, "طلبات الاعتماد وترقية الإطار:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "merview") {
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target)) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      bot.answerCallbackQuery(q.id);
      const pub = publicUser(target) || {};
      const badgeNow = pub.merchantBadge || "new";
      const labels = { sponsored: "تاجر مدعوم", verified: "تاجر موثّق", featured: "تاجر مميز", regular: "تاجر عادي", new: "تاجر جديد" };
      return bot.sendMessage(
        msg.chat.id,
        `تاجر\nالمستخدم: ${target.username}\nالاسم: ${target.displayName || "—"}\nالمتجر: ${target.merchantShop || "—"}\nالحالة: ${target.merchantStatus || "none"}\nالإطار: ${labels[badgeNow] || badgeNow}${pub.merchantBadgeOverride && pub.merchantBadgeOverride !== "auto" ? " (يدوي)" : " (تلقائي)"}\nصفقات الأسبوع: ${pub.weeklyTrades || 0}\nحجم الأسبوع: ${pub.weeklyUsdtVolume || 0} USDT\nالحجم الكلي: ${pub.lifetimeUsdtVolume || 0} USDT\nKYC: ${target.kycStatus} (${target.kycLevel || "basic"})\nملاحظة: ${target.merchantNote || "—"}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "اعتماد تاجر", callback_data: `merok:${target.id}` },
                { text: "رفض", callback_data: `merno:${target.id}` }
              ],
              [
                { text: "مدعوم", callback_data: `merbadge:${target.id}:sponsored` },
                { text: "موثّق", callback_data: `merbadge:${target.id}:verified` }
              ],
              [
                { text: "مميز", callback_data: `merbadge:${target.id}:featured` },
                { text: "عادي", callback_data: `merbadge:${target.id}:regular` },
                { text: "جديد", callback_data: `merbadge:${target.id}:new` }
              ],
              [{ text: "تلقائي", callback_data: `merbadge:${target.id}:auto` }]
            ]
          }
        }
      );
    }

    if (action === "merok" || action === "merno") {
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target)) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      pending.set(user.id, { flow: "merdecide", act: action === "merok" ? "ok" : "no", userId: target.id });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(
        msg.chat.id,
        action === "merok"
          ? `اكتب ملاحظة تُرسل إلى ${target.username} مع الاعتماد:`
          : `اكتب ملاحظة تُرسل إلى ${target.username} مع الرفض:`,
        { reply_markup: cancelKb() }
      );
    }

    if (action === "merbadge") {
      const target = db.users.find((u) => u.id === id);
      const badge = extra;
      if (!target || isDemoUser(target)) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      if (!["sponsored", "verified", "featured", "regular", "new", "auto"].includes(badge)) {
        return bot.answerCallbackQuery(q.id, { text: "إطار غير صالح" });
      }
      target.isMerchant = true;
      target.merchantStatus = "approved";
      if (badge === "auto") {
        target.merchantBadgeMode = "auto";
        target.merchantBadge = null;
        notify(target.id, "تم تحديث شارة التاجر", "عادت الشارة إلى الوضع التلقائي.");
        save();
        bot.answerCallbackQuery(q.id, { text: "تلقائي" });
        return bot.sendMessage(msg.chat.id, `أُعيد ${target.username} إلى الشارة التلقائية.`);
      }
      target.merchantBadgeMode = "manual";
      target.merchantBadge = badge;
      const labels = { sponsored: "تاجر مدعوم", verified: "تاجر موثّق", featured: "تاجر مميز", regular: "تاجر عادي", new: "تاجر جديد" };
      notify(target.id, "تم تحديث شارة التاجر", `أصبحت الآن: ${labels[badge]}`);
      save();
      bot.answerCallbackQuery(q.id, { text: labels[badge] });
      return bot.sendMessage(msg.chat.id, `رُقّي ${target.username} إلى ${labels[badge]} (يدوي).`);
    }

    if (action === "admwallet") {
      bot.answerCallbackQuery(q.id);
      pending.set(user.id, { flow: "admwallet", step: "user", act: "credit", asset: "USDT" });
      return bot.sendMessage(msg.chat.id, "ترصيد إداري. اختر العملية ثم أرسل UID أو اسم المستخدم:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "إضافة USDT", callback_data: "admbal:credit:USDT" }, { text: "خصم USDT", callback_data: "admbal:debit:USDT" }]
          ]
        }
      });
    }

    if (action === "admbal") {
      pending.set(user.id, { flow: "admwallet", step: "user", act: id, asset: extra || "USDT" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(msg.chat.id, `أرسل UID أو اسم المستخدم لـ ${id === "credit" ? "إضافة" : "خصم"} ${extra || "USDT"}:`, { reply_markup: cancelKb() });
    }

    if (action === "admfreeze") {
      bot.answerCallbackQuery(q.id);
      const users = liveUsers().filter((u) => !u.isAdmin).slice(0, 10);
      if (!users.length) return bot.sendMessage(msg.chat.id, "لا مستخدمين.");
      const rows = users.map((u) => [{ text: `${u.username} ${u.accountFrozen ? "●حساب" : ""} ${u.fundsFrozen ? "●أموال" : ""}`, callback_data: `frview:${u.id}` }]);
      return bot.sendMessage(msg.chat.id, "اختر مستخدماً للتجميد/الفك:", { reply_markup: { inline_keyboard: rows } });
    }

    if (action === "admaccess") {
      bot.answerCallbackQuery(q.id);
      pending.set(user.id, { flow: "admaccess", step: "user" });
      const users = liveUsers().filter((u) => !u.isAdmin).slice(0, 8);
      const rows = users.map((u) => [{ text: `${u.username} · ${u.uidCode || ""}`, callback_data: `recview:${u.id}` }]);
      return bot.sendMessage(msg.chat.id, "أرسل UID أو اسم المستخدم، أو اختر من القائمة. تحقق من الهوية عبر تلغرام قبل إعادة التعيين.", {
        reply_markup: { inline_keyboard: rows.length ? rows : [] }
      });
    }

    if (action === "recview") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target) || target.isAdmin) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(
        msg.chat.id,
        `${target.username} · UID ${target.uidCode}\nرمز التحرير: ${hasTradePin(target) ? "معيّن" : "غير معيّن"}\nقفل الرمز: ${target.tradePinLockedUntil && target.tradePinLockedUntil > now() ? "مقفل" : "لا"}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "كلمة مرور مؤقتة", callback_data: `recpass:${target.id}` }],
              [{ text: "مسح رمز التحرير", callback_data: `recpin:${target.id}` }],
              [{ text: "فك قفل الرمز", callback_data: `recunlock:${target.id}` }]
            ]
          }
        }
      );
    }

    if (action === "recpass" || action === "recpin" || action === "recunlock") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target) || target.isAdmin) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      if (action === "recpass") {
        const tempPassword = generateTempPassword();
        setUserPassword(target, tempPassword);
        revokeUserSessions(target.id);
        notify(
          target.id,
          "إعادة تعيين كلمة المرور",
          "أعاد المدير تعيين كلمة المرور بعد التحقق من هويتك. اطلب الكلمة المؤقتة من الدعم عبر تلغرام ثم غيّرها فوراً بعد الدخول.",
          { skipTelegramBody: true }
        );
        save();
        bot.answerCallbackQuery(q.id, { text: "تم" });
        return bot.sendMessage(
          msg.chat.id,
          `كلمة مرور مؤقتة لـ ${target.username}:\n${tempPassword}\nسلّمها عبر دعم تلغرام بعد التحقق ثم اطلب تغييرها. لا تضعها في مجموعة عامة.`
        );
      }
      if (action === "recpin") {
        if (!hasTradePin(target)) return bot.answerCallbackQuery(q.id, { text: "لا رمز تحرير", show_alert: true });
        clearTradePin(target);
        notify(
          target.id,
          "مسح رمز التحرير",
          "مسح المدير رمز التحرير بعد التحقق من هويتك. عيّن رمزاً جديداً من الحساب أو البوت قبل الإفراج أو السحب أو التحويل."
        );
        save();
        bot.answerCallbackQuery(q.id, { text: "تم المسح" });
        return bot.sendMessage(msg.chat.id, `مُسح رمز التحرير لـ ${target.username}. يعين رمزاً جديداً بنفسه.`);
      }
      unlockTradePin(target);
      notify(target.id, "فك قفل رمز التحرير", "فُك القفل المؤقت لرمز التحرير. يمكنك المحاولة من جديد.");
      save();
      bot.answerCallbackQuery(q.id, { text: "فُك القفل" });
      return bot.sendMessage(msg.chat.id, `فُك قفل رمز التحرير لـ ${target.username}.`);
    }

    if (action === "admkill") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      db.settings.appEnabled = db.settings.appEnabled === false;
      if (!db.settings.appDisabledMessage) {
        db.settings.appDisabledMessage = "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً.";
      }
      save();
      bot.answerCallbackQuery(q.id, { text: db.settings.appEnabled === false ? "تم إيقاف المنصة" : "تم تشغيل المنصة" });
      return sendAdminPanel(msg.chat.id);
    }

    if (action === "frview") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target) || target.isAdmin) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      bot.answerCallbackQuery(q.id);
      return bot.sendMessage(
        msg.chat.id,
        `${target.username} · UID ${target.uidCode}\nتجميد الحساب: ${target.accountFrozen ? "نعم" : "لا"}\nتجميد الأموال: ${target.fundsFrozen ? "نعم" : "لا"}\n${target.freezeReason || ""}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: target.accountFrozen ? "فك تجميد الحساب" : "تجميد الحساب", callback_data: `fracc:${target.id}` }],
              [{ text: target.fundsFrozen ? "فك تجميد الأموال" : "تجميد الأموال", callback_data: `frfund:${target.id}` }]
            ]
          }
        }
      );
    }

    if (action === "fracc" || action === "frfund") {
      if (!isAdminUser(user)) return bot.answerCallbackQuery(q.id, { text: "للإدارة فقط" });
      const target = db.users.find((u) => u.id === id);
      if (!target || isDemoUser(target) || target.isAdmin) return bot.answerCallbackQuery(q.id, { text: "غير موجود" });
      if (action === "fracc") {
        target.accountFrozen = !target.accountFrozen;
        if (target.accountFrozen) {
          pauseUserLiveAds(target.id, true);
          notify(target.id, "تم تجميد الحساب", "تواصل مع الدعم عبر تلغرام لفك التجميد.");
        } else {
          notify(target.id, "تم فك تجميد الحساب", "يمكنك استخدام المنصة من جديد.");
        }
      } else {
        if (!target.fundsFrozen) freezeUserFunds(target.id);
        else unfreezeUserFunds(target.id);
        target.fundsFrozen = !target.fundsFrozen;
        notify(target.id, target.fundsFrozen ? "تم تجميد الأموال" : "تم فك تجميد الأموال", target.fundsFrozen ? "الأموال مجمّدة داخل المحفظة." : "أصبح الرصيد المتاح قابلاً للاستخدام.");
      }
      save();
      bot.answerCallbackQuery(q.id, { text: "تم" });
      return bot.sendMessage(msg.chat.id, `الحساب: ${target.accountFrozen ? "مجمّد" : "نشط"} · الأموال: ${target.fundsFrozen ? "مجمّدة" : "متاحة"}`);
    }
  });

  function sendAdminPanel(chatId) {
    const users = liveUsers();
    const pendingKyc = users.filter((u) => u.kycStatus === "submitted" || u.kycUpgradePending).length;
    const pendingDeps = liveItemsByUser(db.deposits).filter((d) => d.status === "pending").length;
    const pendingWds = liveItemsByUser(db.withdrawals).filter((w) => w.status === "pending").length;
    const pendingMerchants = users.filter((u) => u.merchantStatus === "pending").length;
    const disputed = db.orders.filter((o) => o.status === "disputed" && !orderIsDemo(o)).length;
    const openSupport = (db.supportTickets || []).filter((t) => t.status === "open" && !t.isDemo).length;
    bot.sendMessage(
      chatId,
      `لوحة إدارة USDT شام\nالمستخدمون: ${users.length}\nKYC معلّق: ${pendingKyc}\nطلب تاجر معلّق: ${pendingMerchants}\nإيداعات معلّقة: ${pendingDeps}\nسحوبات معلّقة: ${pendingWds}\nنزاعات: ${disputed}\nدعم مفتوح: ${openSupport}\nالحسابات التجريبية معزولة ولا تظهر هنا.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "طلبات KYC", callback_data: "admkyc" }, { text: "طلبات التجار", callback_data: "admmerch" }],
            [{ text: "الإيداعات", callback_data: "admdep" }, { text: "السحوبات", callback_data: "admwd" }],
            [{ text: "الصفقات", callback_data: "admord" }, { text: "طرق الدفع", callback_data: "admpay" }],
            [{ text: "العملات", callback_data: "admcoin" }, { text: "ترصيد محفظة", callback_data: "admwallet" }],
            [{ text: "تجميد مستخدم", callback_data: "admfreeze" }, { text: "استعادة دخول", callback_data: "admaccess" }],
            [{ text: "تذاكر الدعم", callback_data: "admsup" }],
            [{ text: appIsDown() ? "تشغيل المنصة" : "إيقاف المنصة", callback_data: "admkill" }]
          ]
        }
      }
    );
  }

  function supportQuickKeyboard(result, sess) {
    const unlocked = !!(sess && sess.unlocked);
    const rows = [];
    const quick = (result && result.quick) || [];
    for (let i = 0; i < quick.length; i += 2) {
      const a = quick[i];
      const b = quick[i + 1];
      const row = [{ text: a.title, callback_data: `supq:${a.id}` }];
      if (b) row.push({ text: b.title, callback_data: `supq:${b.id}` });
      rows.push(row);
    }
    rows.push([{ text: "اكتب سؤالاً آخر", callback_data: "supask" }]);
    if (unlocked) rows.push([{ text: "التحدث مع الدعم البشري", callback_data: "suphuman" }]);
    return { inline_keyboard: rows };
  }

  function sendSupport(chatId, askMessage, user) {
    const sess = user ? assistantFor(user) : { unlocked: false };
    const uname = String(db.settings.supportTelegramUsername || "Entrepreneurma").replace(/^@/, "") || "Entrepreneurma";
    const web = String((db.settings && db.settings.webAppUrl) || "").replace(/\/$/, "");
    const topics = supportBot.topTopics({ humanUnlocked: sess.unlocked });
    const rows = [];
    for (let i = 0; i < topics.length; i += 2) {
      const a = topics[i];
      const b = topics[i + 1];
      const row = [{ text: a.title, callback_data: `supq:${a.id}` }];
      if (b) row.push({ text: b.title, callback_data: `supq:${b.id}` });
      rows.push(row);
    }
    rows.push([{ text: "اكتب سؤالك للمساعد الآلي", callback_data: "supask" }]);
    if (sess.unlocked) rows.push([{ text: "التحدث مع الدعم البشري", callback_data: "suphuman" }]);
    rows.push([{ text: "محادثة الدعم على تلغرام", url: `https://t.me/${uname}` }]);
    if (web) rows.push([{ text: "فتح صفحة الدعم في المنصة", web_app: { url: `${web}/support` } }]);
    return bot.sendMessage(
      chatId,
      askMessage
        ? `${supportBot.greeting()}\n\nاختر موضوعاً أو اكتب سؤالك. الدعم البشري يُفتح بعد تجربة المساعد.`
        : supportBot.greeting(),
      { reply_markup: { inline_keyboard: rows } }
    );
  }

  function sendAds(chatId, side, asset, viewer) {
    const viewerDemo = isDemoUser(viewer);
    const ads = db.ads.filter((a) => a.status === "active" && a.side === side && a.asset === asset && adIsDemo(a) === viewerDemo).slice(0, 8);
    if (!ads.length) return bot.sendMessage(chatId, "لا توجد إعلانات حالياً.");
    const prefix = side === "SELL" ? "buyad" : "sellad";
    const title = side === "SELL" ? "إعلانات البيع (أنت تشتري)" : "إعلانات الشراء (أنت تبيع)";
    bot.sendMessage(chatId, title, { reply_markup: adsKeyboard(ads, prefix) });
  }

  function pingSellerTelegram(bot, order) {
    const seller = db.users.find((u) => u.id === order.sellerId);
    const buyer = db.users.find((u) => u.id === order.buyerId);
    const buyerLegal = String(order.buyerLegalName || (buyer && buyer.kyc && buyer.kyc.fullName) || "—").trim();
    if (seller && seller.telegramId) {
      bot.sendMessage(
        seller.telegramId,
        `المشتري أكد الدفع في صفقة ${order.id}\n${order.amount} ${order.asset} مقابل ${order.fiatAmount} ${order.fiat}\nاسم المشتري الحقيقي: ${buyerLegal}\nطابق الاسم مع إيصال شام كاش قبل الإفراج.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "إفراج", callback_data: `release:${order.id}` }]]
          }
        }
      ).catch(() => {});
    }
  }

  let pushing = false;
  async function pushNotifications() {
    if (pushing) return;
    pushing = true;
    try {
      const queue = claimTelegramNotifications(20);
      if (!queue.length) return;
      for (const n of queue) {
        const user = db.users.find((u) => u.id === n.userId);
        if (!user || !user.telegramId) continue;
        const extra = n.extra || {};
        const url = notifyHref(n, user);
        try {
          const text = extra.skipTelegramBody ? n.title : `${n.title}\n${n.body}`;
          await bot.sendMessage(user.telegramId, text, {
            reply_markup: url
              ? { inline_keyboard: [[{ text: "فتح المكان المقصود", web_app: { url } }]] }
              : undefined
          });
        } catch {
          /* ignore blocked or invalid chats */
        }
      }
    } finally {
      pushing = false;
    }
  }

  setInterval(() => {
    pushNotifications().catch(() => {});
  }, 7000);

  console.log("USDT Sham Telegram bot polling...");
}

function createOrder(user, ad, qty, paymentType) {
  const frozenErr = freezeRestriction(user, "trade");
  if (frozenErr) throw new Error(frozenErr);
  const kycErr = requireKyc(user, "trade");
  if (kycErr) throw new Error(kycErr);
  const advErr = requireAdvancedKyc(user, qty);
  if (advErr) throw new Error(advErr);
  if (ad.userId === user.id) throw new Error("لا يمكنك التداول مع إعلانك");
  if (adIsDemo(ad) !== isDemoUser(user)) throw new Error("لا يمكن التداول بين الحساب التجريبي والحقيقي");
  if (qty > ad.available) throw new Error("الكمية المتاحة غير كافية");
  const live = priceEngine.resolveAdPrice(db.settings, ad, priceEngine.syncMarket(db.settings, ad.asset, ad.fiat));
  const tradePrice = live.price > 0 ? live.price : Number(ad.price);
  if (!(tradePrice > 0)) throw new Error("تعذر حساب سعر الصفقة");
  const fiatAmount = Math.round(qty * tradePrice * 100) / 100;
  let buyerId;
  let sellerId;
  if (ad.side === "SELL") {
    buyerId = user.id;
    sellerId = ad.userId;
  } else {
    buyerId = ad.userId;
    sellerId = user.id;
    if (!freeze(sellerId, ad.asset, qty)) throw new Error("رصيدك غير كافٍ");
  }
  ad.available = Math.round((ad.available - qty) * 1e8) / 1e8;
  if (ad.available + 1e-12 < ad.minAmount) {
    if (ad.side === "SELL" && ad.available > 0) unfreeze(sellerId, ad.asset, ad.available);
    ad.available = 0;
    ad.status = "filled";
  }
  const sellerUser = db.users.find((u) => u.id === sellerId);
  const buyerUser = db.users.find((u) => u.id === buyerId);
  const buyerLegalName = String((buyerUser && buyerUser.kyc && buyerUser.kyc.fullName) || "").trim();
  if (!buyerLegalName) throw new Error("المشتري يجب أن يكون موثّقاً باسم حقيقي قبل إنشاء الصفقة.");
  const paySnap = sellerPaymentSnapshot(sellerUser, db.paymentMethods, paymentType || "SHAM_CASH");
  if (!paySnap.details.name || !paySnap.details.address) {
    throw new Error("البائع لم يضف عنوان شام كاش نشطاً بعد. لا يمكن إنشاء الصفقة.");
  }
  const order = {
    id: uid("ord"),
    adId: ad.id,
    buyerId,
    sellerId,
    buyerLegalName,
    takerId: user.id,
    makerId: ad.userId,
    side: ad.side,
    asset: ad.asset,
    fiat: ad.fiat,
    price: tradePrice,
    amount: qty,
    fiatAmount,
    paymentType: paySnap.type,
    paymentDetails: paySnap.details,
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
    isDemo: isDemoUser(user) || adIsDemo(ad)
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
  return order;
}

function formatOrder(order, viewer) {
  const seller = db.users.find((u) => u.id === order.sellerId);
  const buyer = db.users.find((u) => u.id === order.buyerId);
  const snap = sellerPaymentSnapshot(seller, db.paymentMethods, order.paymentType || "SHAM_CASH");
  const d = { ...snap.details, ...(order.paymentDetails || {}) };
  const buyerLegal = String(order.buyerLegalName || (buyer && buyer.kyc && buyer.kyc.fullName) || "").trim();
  const isSeller = viewer && viewer.id === order.sellerId;
  const isBuyer = viewer && viewer.id === order.buyerId;
  const partyLines = [];
  if (isSeller || (viewer && viewer.isAdmin)) {
    partyLines.push(buyerLegal ? `اسم المشتري الحقيقي: ${buyerLegal}` : "اسم المشتري: غير موثّق");
    if (buyer && buyer.displayName) partyLines.push(`الاسم الظاهر: ${buyer.displayName}`);
    partyLines.push("طابق اسم المرسل في إيصال شام كاش مع اسم المشتري أعلاه.");
  }
  if (isBuyer || (viewer && viewer.isAdmin)) {
    partyLines.push(`الدفع: ${order.paymentLabel || snap.label || "شام كاش"}`);
    if (d.name) partyLines.push(`اسم المستلم (البائع): ${d.name}`);
    if (d.address || d.account) partyLines.push(`عنوان شام كاش: ${d.address || d.account}`);
  }
  return [
    `صفقة ${order.id}`,
    `الحالة: ${statusAr(order.status)}`,
    `${order.amount} ${order.asset} @ ${order.price} ${order.fiat}`,
    `الإجمالي: ${order.fiatAmount} ${order.fiat}`,
    partyLines.join("\n")
  ].filter(Boolean).join("\n");
}

function statusAr(s) {
  return (
    {
      pending_payment: "بانتظار الدفع",
      paid: "مدفوعة",
      completed: "مكتملة",
      cancelled: "ملغاة",
      disputed: "نزاع"
    }[s] || s
  );
}

module.exports = { createOrder };
