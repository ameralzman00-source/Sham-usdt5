import React, { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth, openTelegramBot } from "./auth.jsx";
import { useMeta } from "./meta.jsx";
import { api, authedUrl, prepareFileForUpload, getRememberPref } from "./api.js";
import brandMark from "./assets/logo.png";
import {
  lockEnabled,
  shouldShowLock,
  markLocked,
  verifyLockPin,
  unlockWithBiometric,
  setLockPin,
  disableLock,
  registerBiometric,
  disableBiometric,
  readLock,
  biometricSupported,
  pinDigits as lockPinDigits,
  isValidLockPin
} from "./appLock.js";
import {
  ensureNotifyPermission,
  armNotifyPermission,
  unseenNotices,
  markNoticesSeen,
  showNativeNotice
} from "./nativeNotify.js";

const STATUS = {
  pending_payment: "بانتظار الدفع",
  paid: "مدفوعة",
  completed: "مكتملة",
  cancelled: "ملغاة",
  disputed: "نزاع",
  pending: "قيد المراجعة",
  rejected: "مرفوض",
  active: "نشط",
  paused: "متوقف",
  filled: "نفد",
  closed: "محذوف"
};

const KYC_STATUS = {
  verified: "موثّق",
  submitted: "قيد المراجعة",
  rejected: "مرفوض",
  pending: "غير مكتمل"
};

const WITHDRAW_STATUS = {
  pending: "قيد المراجعة",
  completed: "تم التحويل",
  rejected: "مرفوض"
};

const MERCHANT_BADGE = {
  sponsored: "تاجر مدعوم",
  verified: "تاجر موثّق",
  featured: "تاجر مميز",
  regular: "تاجر عادي",
  new: "تاجر جديد"
};

function badgeTone(badge) {
  if (badge === "sponsored") return "gold";
  if (badge === "verified") return "green";
  if (badge === "featured") return "blue";
  return "";
}

function money(n, d = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: d });
}

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "الآن";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} د`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} س`;
  return d.toLocaleDateString("ar-SY");
}

function priceRangeFor(meta, asset, fiat, side) {
  const list = (meta && meta.settings && meta.settings.priceRanges) || [];
  const row = list.find((r) => r.asset === asset && r.fiat === fiat) || null;
  if (!row) return null;
  const isBuy = String(side || "").toUpperCase() === "BUY";
  return {
    ...row,
    min: Number(isBuy ? (row.buyMin != null ? row.buyMin : row.min) : (row.sellMin != null ? row.sellMin : row.min)) || 0,
    max: Number(isBuy ? (row.buyMax != null ? row.buyMax : row.max) : (row.sellMax != null ? row.sellMax : row.max)) || 0
  };
}

function supportUsername(settings) {
  const uname = String((settings && settings.supportTelegramUsername) || "").replace(/^@/, "");
  if (uname) return uname;
  const bot = String((settings && settings.telegramBotUsername) || "").replace(/^@/, "");
  return bot || "Entrepreneurma";
}

function supportHref(settings) {
  return `https://t.me/${supportUsername(settings)}`;
}

function ApkDownloadButton({ className = "btn dark sm", label = "تحميل تطبيق أندرويد" }) {
  return (
    <a className={`${className} ico-btn`} href="/download/android" download="usdt-sham.apk">
      <Icon name="download" />
      <span>{label}</span>
    </a>
  );
}

function SupportButton({ settings, className = "btn ghost sm", label = "تواصل الدعم", telegram }) {
  const inner = (
    <>
      <Icon name="support" />
      <span>{label}</span>
    </>
  );
  if (telegram) {
    return (
      <a className={`${className} ico-btn`} href={supportHref(settings)} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return (
    <NavLink to="/support" className={`${className} ico-btn`}>
      {inner}
    </NavLink>
  );
}

function TabBtn({ id, label, icon, on, onClick, extra }) {
  return (
    <button type="button" className={on ? "on" : ""} onClick={onClick}>
      {icon ? <Icon name={icon} /> : null}
      <span>{label}{extra || ""}</span>
    </button>
  );
}

function IcoLink({ to, className = "btn", icon, children, end }) {
  return (
    <NavLink to={to} end={!!end} className={`${className} ico-btn`}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </NavLink>
  );
}

function IcoAction({ className = "btn", icon, children, type = "button", ...rest }) {
  return (
    <button type={type} className={`${className} ico-btn`} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

function priceRangeHint(range, asset, fiat, side) {
  if (!range) return "";
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 0;
  const label = String(side || "").toUpperCase() === "BUY" ? "شراء" : String(side || "").toUpperCase() === "SELL" ? "بيع" : "";
  const pair = label ? `${label} ${asset}/${fiat}` : `${asset}/${fiat}`;
  if (min > 0 && max > 0) return `نطاق ${pair}: من ${money(min, 4)} إلى ${money(max, 4)}`;
  if (min > 0) return `الحد الأدنى لسعر ${pair}: ${money(min, 4)}`;
  if (max > 0) return `الحد الأقصى لسعر ${pair}: ${money(max, 4)}`;
  return "";
}

function suggestedForSide(quote, side) {
  if (!quote) return 0;
  return String(side || "SELL").toUpperCase() === "BUY" ? Number(quote.buyPrice || 0) : Number(quote.sellPrice || 0);
}

function quoteHint(quote, side, asset, fiat) {
  if (!quote) return "";
  const suggested = suggestedForSide(quote, side);
  const mode = quote.mode === "auto" ? "تلقائي" : "يدوي";
  const parts = [];
  if (suggested > 0) parts.push(`السعر المقترح (${mode}): ${money(suggested, 4)} ${fiat}`);
  if (quote.market > 0) parts.push(`السوق: ${money(quote.market, 4)}`);
  const qMin = String(side || "").toUpperCase() === "BUY" ? Number(quote.buyMin || quote.min || 0) : Number(quote.sellMin || quote.min || 0);
  const qMax = String(side || "").toUpperCase() === "BUY" ? Number(quote.buyMax || quote.max || 0) : Number(quote.sellMax || quote.max || 0);
  if (qMin > 0 || qMax > 0) {
    const range = priceRangeHint({ min: qMin, max: qMax }, asset, fiat, side);
    if (range) parts.push(range);
  }
  if (quote.stale) parts.push("السعر مؤقت من آخر تحديث");
  if (quote.error) parts.push(quote.error);
  return parts.join(" · ");
}

function usePriceQuote(asset, fiat) {
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api(`/api/pricing?asset=${encodeURIComponent(asset || "USDT")}&fiat=${encodeURIComponent(fiat || "SYP")}`)
      .then((d) => {
        if (!cancelled) setQuote(d.quote || null);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, fiat]);
  return quote;
}

function initials(name) {
  const s = String(name || "?").trim();
  return s.slice(0, 1).toUpperCase();
}

function avatarSrc(person) {
  if (!person || !person.id || !person.hasAvatar) return "";
  return `/api/users/${person.id}/avatar?t=${person.avatarAt || 0}`;
}

function Avatar({ person, name, size = "", className = "" }) {
  const src = avatarSrc(person);
  const label = initials((person && person.displayName) || name);
  const cls = `avatar ${size} ${className}`.trim();
  if (src) {
    return (
      <span className={`${cls} has-photo`}>
        <img src={src} alt="" />
      </span>
    );
  }
  return <span className={cls}>{label}</span>;
}

function statusTone(status) {
  if (["completed", "credited", "verified", "active", "approved"].includes(status)) return "green";
  if (["pending_payment", "paid", "submitted", "pending"].includes(status)) return "gold";
  if (["cancelled", "rejected", "disputed"].includes(status)) return "red";
  return "";
}

function useAppRefresh(fn) {
  useEffect(() => {
    if (!fn) return undefined;
    const onRefresh = () => { fn(); };
    window.addEventListener("app-refresh", onRefresh);
    return () => window.removeEventListener("app-refresh", onRefresh);
  }, [fn]);
}

function PriceTypeFields({ form, setForm, quote }) {
  const market = Number(quote && quote.market) || (form.fiat === "USD" ? 1 : 0);
  const ratio = Number(form.floatRatio) || 1;
  const live = market > 0 ? market * ratio : 0;
  const isBuy = String(form.side || "").toUpperCase() === "BUY";
  const range = quote
    ? {
        min: Number(isBuy ? quote.buyMin || quote.min : quote.sellMin || quote.min) || 0,
        max: Number(isBuy ? quote.buyMax || quote.max : quote.sellMax || quote.max) || 0
      }
    : null;
  return (
    <>
      <div className="field">
        <span>نوع الطلب</span>
        <div className="segmented" style={{ marginTop: 6 }}>
          <button type="button" className={form.priceType !== "floating" ? "on" : ""} onClick={() => setForm({ ...form, priceType: "fixed" })}>ثابت</button>
          <button type="button" className={form.priceType === "floating" ? "on" : ""} onClick={() => setForm({ ...form, priceType: "floating", floatRatio: form.floatRatio || "1" })}>عائم</button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {form.priceType === "floating"
            ? "السعر العائم = سعر السوق × النسبة. يتحدّث مع السوق ضمن حدود الأمان."
            : "سعر ثابت لا يتأثر بتقلبات السوق."}
        </p>
      </div>
      {form.priceType === "floating" ? (
        <div className="form-grid">
          <label className="field">
            <span>النسبة (× السوق)</span>
            <div className="stepper">
              <button type="button" onClick={() => setForm({ ...form, floatRatio: String(Math.max(0.01, Math.round((ratio - 0.001) * 1000) / 1000)) })}>−</button>
              <input value={form.floatRatio} onChange={(e) => setForm({ ...form, floatRatio: e.target.value })} inputMode="decimal" />
              <button type="button" onClick={() => setForm({ ...form, floatRatio: String(Math.round((ratio + 0.001) * 1000) / 1000) })}>+</button>
            </div>
          </label>
          <label className="field">
            <span>السعر الحالي</span>
            <input value={live > 0 ? money(live, 4) : "—"} readOnly />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>السعر</span>
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
        </label>
      )}
      {range && (range.min > 0 || range.max > 0) && (
        <p className="hint">نطاق سعر {isBuy ? "الشراء" : "البيع"}: {range.min > 0 ? money(range.min, 4) : "—"} - {range.max > 0 ? money(range.max, 4) : "—"}</p>
      )}
    </>
  );
}

function AdminPricePreview() {
  const [pair, setPair] = useState({ asset: "USDT", fiat: "SYP" });
  const quote = usePriceQuote(pair.asset, pair.fiat);
  const meta = useMeta();
  return (
    <div className="card" style={{ marginTop: 12, padding: 12 }}>
      <div className="section-title" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>معاينة السعر الحالي</h3>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>العملة</span>
          <select value={pair.asset} onChange={(e) => setPair({ ...pair, asset: e.target.value })}>
            {(meta.assets || [{ symbol: "USDT" }]).map((a) => (
              <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>الفيات</span>
          <select value={pair.fiat} onChange={(e) => setPair({ ...pair, fiat: e.target.value })}>
            {(meta.fiats || [{ code: "SYP" }]).map((f) => (
              <option key={f.code} value={f.code}>{f.code}</option>
            ))}
          </select>
        </label>
      </div>
      {quote ? (
        <p className="hint" style={{ marginBottom: 0 }}>
          بيع {money(quote.sellPrice, 4)} {quote.sellMin || quote.sellMax ? `(حد ${money(quote.sellMin || 0, 4)}-${money(quote.sellMax || 0, 4)})` : ""}
          {" · "}شراء {money(quote.buyPrice, 4)} {quote.buyMin || quote.buyMax ? `(حد ${money(quote.buyMin || 0, 4)}-${money(quote.buyMax || 0, 4)})` : ""}
          {quote.market > 0 ? ` · سوق ${money(quote.market, 4)}` : ""}
          {quote.mode === "auto" ? " · تلقائي" : " · يدوي"}
          {quote.stale ? " · مؤقت" : ""}
          {quote.error ? ` · ${quote.error}` : ""}
        </p>
      ) : (
        <p className="hint" style={{ marginBottom: 0 }}>لا يوجد سعر بعد. احفظ التسعير ثم حدّث الصفحة.</p>
      )}
    </div>
  );
}

function Toast({ text, onDone }) {
  useEffect(() => {
    if (!text) return undefined;
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [text, onDone]);
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

function Icon({ name }) {
  const paths = {
    market: ["M3 4h18v4H3z", "M3 10h8v10H3z", "M13 10h8v10h-8z"],
    orders: ["M5 4h14a1 1 0 011 1v3H4V5a1 1 0 011-1z", "M4 10h16v3H4z", "M4 16h11v3H4z"],
    wallet: ["M3 7a2 2 0 012-2h14a2 2 0 012 2v11H3V7z", "M3 10h18", "M16 14h3"],
    kyc: ["M7 4h10a2 2 0 012 2v14l-7-3-7 3V6a2 2 0 012-2z", "M12 9a2 2 0 100-4 2 2 0 000 4z", "M8.5 14c.8-1.2 2-1.8 3.5-1.8s2.7.6 3.5 1.8"],
    plus: "M12 5v14M5 12h14",
    ads: ["M4 5h16", "M4 12h16", "M4 19h10", "M18 17v4M16 19h4"],
    bell: ["M12 3a5 5 0 00-5 5v4l-2 3h14l-2-3V8a5 5 0 00-5-5z", "M10 19a2 2 0 004 0"],
    bot: ["M12 3v2", "M6 8h12a1 1 0 011 1v9H5V9a1 1 0 011-1z", "M9 13h.01", "M15 13h.01", "M9 17h6", "M8 8V7a4 4 0 018 0v1"],
    user: ["M12 12a4 4 0 100-8 4 4 0 000 8z", "M4 20a8 8 0 0116 0"],
    users: ["M16 11a4 4 0 10-8 0 4 4 0 008 0z", "M4 20a7 7 0 0114 0", "M19 8a3 3 0 11-2-5", "M21 20a6 6 0 00-4-5.6"],
    help: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M9.5 9a2.5 2.5 0 114.2 1.8c-.7.6-1.7 1.1-1.7 2.2V14", "M12 17h.01"],
    lock: ["M7 11V8a5 5 0 0110 0v3", "M6 11h12v10H6z", "M12 15v2"],
    pin: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M17 14v6", "M14 17h6"],
    shield: ["M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z", "M9 12l2 2 4-4"],
    camera: ["M4 8h3l2-3h6l2 3h3v12H4z", "M12 10a4 4 0 100 8 4 4 0 000-8z"],
    copy: ["M8 8h11v13H8z", "M5 3h11v3"],
    refresh: ["M21 12a9 9 0 11-3.2-6.8", "M21 3v6h-6"],
    back: "M15 6l-6 6 6 6",
    overview: ["M4 4h7v7H4z", "M13 4h7v4h-7z", "M13 10h7v10h-7z", "M4 13h7v7H4z"],
    merchants: ["M4 10l8-6 8 6v10H4z", "M9 20v-6h6v6"],
    deposits: ["M12 4v12", "M7 11l5 5 5-5", "M4 20h16"],
    withdrawals: ["M12 20V8", "M7 13l5-5 5 5", "M4 4h16"],
    support: ["M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4z"],
    payments: ["M4 7h16v10H4z", "M4 11h16", "M8 15h4"],
    coins: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M8 12h8", "M12 8v8"],
    treasury: ["M3 10l9-6 9 6v2H3z", "M5 12v6h3v-4h8v4h3v-6", "M9 20h6"],
    settings: ["M12 8a4 4 0 100 8 4 4 0 000-8z", "M4 12h2", "M18 12h2", "M6.3 6.3l1.4 1.4", "M16.3 16.3l1.4 1.4", "M6.3 17.7l1.4-1.4", "M16.3 7.7l1.4-1.4"],
    send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
    close: "M6 6l12 12M18 6L6 18",
    check: "M5 12l5 5 9-9",
    all: ["M4 6h16", "M4 12h16", "M4 18h16"],
    login: ["M15 3h4v18h-4", "M10 17l5-5-5-5", "M3 12h12"],
    list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
    admin: ["M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z", "M12 11v4", "M12 8h.01"],
    star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z",
    crown: ["M3 7l4 4 5-7 5 7 4-4-2 11H5z", "M5 21h14"],
    key: ["M14 4a5 5 0 014.9 6L21 12l-2 2-2-2-2 2-3-3 2.1-2.1A5 5 0 0114 4z", "M5 19a3 3 0 104-4l5-5"],
    pause: "M8 5v14M16 5v14",
    play: "M8 5l11 7-11 7z",
    download: ["M12 3v12", "M7 10l5 5 5-5", "M4 21h16"],
    minus: "M5 12h14",
    search: ["M11 4a7 7 0 100 14 7 7 0 000-14z", "M20 20l-3.5-3.5"],
    print: ["M6 9V3h12v6", "M6 17H4a1 1 0 01-1-1v-5h18v5a1 1 0 01-1 1h-2", "M6 14h12v7H6z"],
    edit: ["M4 20h4l11-11-4-4L4 16v4z", "M13 7l4 4"],
    warning: ["M12 3l10 18H2L12 3z", "M12 10v5", "M12 18h.01"],
    human: ["M12 12a4 4 0 100-8 4 4 0 000 8z", "M4 21v-1a6 6 0 0112 0v1", "M18 11h4M20 9v4"],
    fees: ["M4 6h16v4H4z", "M4 14h16v4H4z", "M8 8h.01", "M8 16h.01"],
    prices: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
    platform: ["M4 7h16v10H4z", "M8 17v3", "M16 17v3", "M2 20h20"],
    rules: ["M7 3h10v18H7z", "M10 8h4", "M10 12h4", "M10 16h3"],
    ladder: ["M7 21V3", "M17 21V3", "M7 8h10", "M7 13h10", "M7 18h10"],
    danger: ["M12 3l10 18H2L12 3z", "M12 10v5", "M12 18h.01"],
    ticket: ["M4 8h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4V8z", "M9 8v10"],
    chat: ["M4 5h16v11H8l-4 4z", "M8 9h8", "M8 12h5"],
    eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 9a3 3 0 100 6 3 3 0 000-6z"],
    eyeoff: ["M3 3l18 18", "M10.6 10.6A3 3 0 0013.4 13.4", "M9.9 5.1A10.4 10.4 0 0112 5c6.5 0 10 7 10 7a16 16 0 01-3.2 3.8", "M6.1 6.1C3.7 7.8 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"],
    chevron: "M6 9l6 6 6-6"
  };
  const d = paths[name] || paths.wallet;
  const list = Array.isArray(d) ? d : [d];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {list.map((p) => <path key={p} d={p} />)}
    </svg>
  );
}

function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/");
}

const TOPIC_ICONS = {
  deposit: "deposits",
  withdraw: "withdrawals",
  kyc: "kyc",
  start: "market",
  escrow: "shield",
  payment: "payments",
  ad: "ads",
  pin: "pin",
  password: "lock",
  security: "shield",
  dispute: "support",
  fees: "coins",
  freeze: "lock",
  wallet: "wallet",
  human: "human",
  unknown: "help"
};

const HELP_ICONS = {
  about: "help",
  start: "market",
  kyc: "kyc",
  buy: "deposits",
  sell: "withdrawals",
  escrow: "shield",
  sham: "payments",
  wallet: "wallet",
  ads: "ads",
  dispute: "support",
  security: "lock",
  bot: "bot"
};

async function reloadApp({ refresh, reload } = {}) {
  try {
    await Promise.all([refresh ? refresh() : null, reload ? reload() : null]);
  } catch {
    /* keep session */
  }
  window.dispatchEvent(new Event("app-refresh"));
}

function Brand() {
  const meta = useMeta();
  const name = (meta.settings && meta.settings.brand) || "USDT شام";
  const tagline = (meta.settings && meta.settings.brandTagline) || "منصة التداول P2P";
  return (
    <NavLink to="/" className="brand">
      <span className="logo" aria-hidden="true">
        <img src={brandMark} alt="" width="38" height="38" />
      </span>
      <span className="brand-lockup">
        <b>{name}</b>
        <small>{tagline}</small>
      </span>
    </NavLink>
  );
}

function Topbar() {
  const { user, logout, refresh } = useAuth();
  const meta = useMeta();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const home = loc.pathname === "/";

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return undefined;
    }
    let stop = false;
    async function load() {
      try {
        const d = await api("/api/notifications");
        if (!stop) setUnread(d.unread || 0);
      } catch {
        /* ignore */
      }
    }
    load();
    const t = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-lead">
          {!home && (
            <button type="button" className="top-tool back" onClick={goBack} title="رجوع" aria-label="رجوع للصفحة السابقة">
              <Icon name="back" />
            </button>
          )}
          <Brand />
        </div>
        <nav className="nav">
          <NavLink to="/" end className="nav-link">
            <Icon name="market" /><span>السوق</span>
          </NavLink>
          <NavLink to="/orders" className="nav-link">
            <Icon name="orders" /><span>الطلبات</span>
          </NavLink>
          <NavLink to="/ads" className="nav-link">
            <Icon name="ads" /><span>إعلاناتي</span>
          </NavLink>
          <NavLink to="/wallet" className="nav-link">
            <Icon name="wallet" /><span>المحفظة</span>
          </NavLink>
          <NavLink to="/kyc" className={`nav-link ${user && user.kycStatus !== "verified" ? "nav-link-urgent" : ""}`}>
            <Icon name="kyc" /><span>التوثيق</span>
          </NavLink>
          <NavLink to="/ads/new" className="nav-link nav-link-create">
            <Icon name="plus" /><span>نشر إعلان</span>
          </NavLink>
          <NavLink to="/help" className="nav-link">
            <Icon name="help" /><span>المساعدة</span>
          </NavLink>
          <NavLink to="/support" className="nav-link">
            <Icon name="support" /><span>الدعم</span>
          </NavLink>
          <NavLink to="/bot" className="nav-link">
            <Icon name="user" /><span>الحساب</span>
          </NavLink>
        </nav>
        <div className="top-actions">
          <IcoLink to="/ads/new" className="btn sm create-ad create-ad-top" icon="plus">نشر إعلان</IcoLink>
          <button
            type="button"
            className={`top-tool refresh ${refreshing ? "spin" : ""}`}
            title="تحديث الموقع"
            aria-label="تحديث الموقع"
            onClick={async () => {
              if (refreshing) return;
              setRefreshing(true);
              await reloadApp({ refresh, reload: meta.reload });
            }}
          >
            <Icon name="refresh" />
          </button>
          <SupportButton settings={meta.settings} className="btn ghost sm support-top" />
          {user ? (
            <div className="user-chip">
              <NavLink to="/notifications" className="bell-link" title="الإشعارات">
                <Icon name="bell" />
                {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
              </NavLink>
              {user.kycStatus === "verified" ? (
                 <span className="pill green">موثّق</span>
               ) : (
                 <IcoLink to="/kyc" className="btn sm kyc-cta" icon="kyc">
                    {user.kycStatus === "submitted" ? "التوثيق قيد المراجعة" : user.kycStatus === "rejected" ? "أعد التوثيق" : "وثّق حسابك"}
                  </IcoLink>
               )}
               <NavLink to="/bot" className="user-chip-link" title="الملف الشخصي">
                 <Avatar person={user} />
                 <span className="user-meta">
                   <b>{user.displayName}</b>
                   <small>UID {user.uidCode || "—"}</small>
                 </span>
               </NavLink>
               <IcoAction className="btn ghost sm" icon="close" onClick={logout}>خروج</IcoAction>
             </div>
           ) : (
             <IcoLink to="/gate" className="btn sm" icon="login">دخول</IcoLink>
           )}
        </div>
      </div>
    </header>
  );
}

function FreezeBanner() {
  const { user } = useAuth();
  const meta = useMeta();
  if (!user || user.isAdmin || (!user.accountFrozen && !user.fundsFrozen)) return null;
  return (
    <div className="kyc-banner warn">
      <div>
        <b>{user.accountFrozen ? "الحساب مجمّد" : "الأموال مجمّدة داخل المحفظة"}</b>
        <span>{user.freezeReason || "تواصل مع الدعم عبر تلغرام لفك التجميد."}</span>
      </div>
      <SupportButton settings={meta.settings} className="btn sm" label="تواصل مع الدعم" />
    </div>
  );
}

function KycBanner() {
  const { user } = useAuth();
  if (!user || user.kycStatus === "verified") return null;
  const submitted = user.kycStatus === "submitted";
  const rejected = user.kycStatus === "rejected";
  return (
    <div className={`kyc-banner ${rejected ? "warn" : ""}`}>
      <div>
        <b>{submitted ? "توثيقك قيد مراجعة الإدارة" : rejected ? "رُفض التوثيق" : "وثّق حسابك لبدء التداول"}</b>
        <span>
          {submitted
            ? "يمكنك متابعة حالة الطلب من صفحة التوثيق."
            : rejected
              ? "راجع الملاحظة وأعد رفع الوثائق."
              : "التوثيق مطلوب للشراء والبيع والسحب ونشر الإعلانات."}
        </span>
      </div>
      <IcoLink to="/kyc" className="btn sm" icon="kyc">
        {submitted ? "عرض الحالة" : rejected ? "إعادة التوثيق" : "ابدأ التوثيق"}
      </IcoLink>
    </div>
  );
}

function BottomNav() {
  const { user } = useAuth();
  const needKyc = user && user.kycStatus !== "verified";
  const links = [
    ["/orders", "الطلبات", "orders", false, "tone-orders"],
    ["/ads/new", "نشر", "plus", false, "create tone-create"],
    ["/", "السوق", "market", true, "center market"],
    ["/wallet", "المحفظة", "wallet", false, "tone-wallet"],
    ["/bot", "حسابي", "user", false, "tone-account"]
  ];
  return (
    <nav className="bottom-nav">
      {links.map(([to, label, icon, end, extra]) => (
        <NavLink
          key={to}
          to={to}
          end={!!end}
          className={({ isActive }) => {
            const bits = [];
            if (isActive) bits.push("active");
            if (to === "/kyc" && needKyc) bits.push("urgent");
            if (extra) bits.push(extra);
            return bits.join(" ") || undefined;
          }}
        >
          <span className="nav-ico"><Icon name={icon} /></span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function TelegramGate({ message }) {
  const {
    insideTelegram,
    authError,
    botUsername,
    loginWithPassword,
    registerAccount,
    loginWithTelegram,
    linkTelegramAccount,
    createTelegramAccount,
    needsTelegramChoice
  } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const bot = meta.settings?.telegramBotUsername || botUsername || "EntrepreneurMA_bot";
  const [realTab, setRealTab] = useState("login");
  const [real, setReal] = useState({ username: "", password: "", displayName: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [rememberMe, setRememberMe] = useState(getRememberPref());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tgStep, setTgStep] = useState(needsTelegramChoice ? "ask" : "");
  const [createAck, setCreateAck] = useState(false);

  useEffect(() => {
    if (needsTelegramChoice) setTgStep((s) => s || "ask");
  }, [needsTelegramChoice]);

  async function submitReal(e) {
    e.preventDefault();
    setErr("");
    if (realTab === "register" && !acceptTerms) {
      setErr("يجب الموافقة على شروط الاستخدام وسياسة الخصوصية.");
      return;
    }
    setBusy(true);
    try {
      if (insideTelegram && tgStep === "has") {
        await linkTelegramAccount(real.username, real.password);
      } else if (realTab === "register") {
        await registerAccount(real.username, real.password, real.displayName, true, rememberMe);
      } else {
        await loginWithPassword(real.username, real.password, "real", rememberMe);
      }
      nav("/");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function enterWithTelegram() {
    setErr("");
    setBusy(true);
    try {
      await loginWithTelegram();
      nav("/");
    } catch (ex) {
      setErr(ex.message);
      if (insideTelegram) setTgStep("ask");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreateTelegram() {
    if (!createAck) {
      setErr("أكّد أنك تريد إنشاء حساب جديد.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await createTelegramAccount();
      nav("/");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate-wrap">
      <div className="card gate">
        <span className="pill gold">منصة P2P سورية · ضمان مشفّر</span>
        <h2>ادخل إلى {(meta.settings && meta.settings.brand) || "USDT شام"}</h2>
        <p>{message || "سجّل الدخول باسم مستخدم أو عبر تلغرام. الحسابات حقيقية فقط."}</p>
        {authError && <div className="error" style={{ width: "100%" }}>{authError}</div>}

        {insideTelegram && tgStep === "ask" && (
          <div className="stack" style={{ width: "100%" }}>
            <div className="notice">هل لديك حساب حالي في المنصة؟</div>
            <IcoAction className="btn block" icon="login" onClick={() => { setTgStep("has"); setErr(""); }}>نعم، لدي حساب</IcoAction>
            <IcoAction className="btn outline block" icon="plus" onClick={() => { setTgStep("create"); setErr(""); setCreateAck(false); }}>لا، حساب جديد</IcoAction>
          </div>
        )}

        {insideTelegram && tgStep === "create" && (
          <div className="stack" style={{ width: "100%" }}>
            <div className="error">انتبه، أنت الآن تنشئ حساباً جديداً مرتبطاً بتلغرام.</div>
            <label className="check-row">
              <input type="checkbox" checked={createAck} onChange={(e) => setCreateAck(e.target.checked)} />
              <span>أفهم ذلك وأريد إنشاء حساب جديد</span>
            </label>
            {err && <div className="error">{err}</div>}
            <IcoAction className="btn block" icon="plus" disabled={busy || !createAck} onClick={confirmCreateTelegram}>
              {busy ? "جاري الإنشاء..." : "إنشاء الحساب والمتابعة"}
            </IcoAction>
            <IcoAction className="btn ghost" icon="back" onClick={() => setTgStep("ask")}>رجوع</IcoAction>
          </div>
        )}

        {(!insideTelegram || tgStep === "has" || !tgStep) && (
          <>
            <div className="tabs" style={{ width: "100%", justifyContent: "center" }}>
              <TabBtn id="login" icon="login" label="دخول" on={realTab === "login"} onClick={() => { setRealTab("login"); setErr(""); }} />
              <TabBtn id="register" icon="plus" label="إنشاء حساب" on={realTab === "register"} onClick={() => { setRealTab("register"); setErr(""); }} />
            </div>
            <form className="form" style={{ width: "100%", textAlign: "right" }} onSubmit={submitReal}>
              {insideTelegram && tgStep === "has" && (
                <div className="notice">أدخل بيانات حسابك الحالي ليُربط فوراً بتلغرام.</div>
              )}
              {realTab === "register" && tgStep !== "has" && (
                <div className="legal-box">
                  <b>قبل إنشاء الحساب</b>
                  <p>باستخدام المنصة توافق على شروط الاستخدام وسياسة الخصوصية: الضمان، منع الاحتيال، وعدم مشاركة بيانات التواصل خارج الصفقة.</p>
                  <div className="legal-links">
                    <NavLink to="/terms">شروط الاستخدام</NavLink>
                    <NavLink to="/privacy">سياسة الخصوصية</NavLink>
                  </div>
                  <label className="check-row">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
                    <span>أوافق على شروط الاستخدام وسياسة الخصوصية</span>
                  </label>
                </div>
              )}
              {realTab === "register" && tgStep !== "has" && (
                <label className="field">
                  <span>الاسم الظاهر</span>
                  <input value={real.displayName} onChange={(e) => setReal({ ...real, displayName: e.target.value })} placeholder="اختياري" />
                </label>
              )}
              <label className="field">
                <span>اسم المستخدم</span>
                <input value={real.username} onChange={(e) => setReal({ ...real, username: e.target.value })} autoComplete="username" placeholder="english_name" required />
              </label>
              <label className="field">
                <span>كلمة المرور</span>
                <input type="password" value={real.password} onChange={(e) => setReal({ ...real, password: e.target.value })} autoComplete={realTab === "register" ? "new-password" : "current-password"} required />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                <span>حفظ تسجيل الدخول على هذا الجهاز</span>
              </label>
              {err && <div className="error">{err}</div>}
              <IcoAction type="submit" className="btn block" icon={realTab === "register" && tgStep !== "has" ? "plus" : "login"} disabled={busy || (realTab === "register" && tgStep !== "has" && !acceptTerms)}>
                {busy ? "جاري التنفيذ..." : insideTelegram && tgStep === "has" ? "ربط الحساب والدخول" : realTab === "register" ? "إنشاء حساب" : "دخول"}
              </IcoAction>
            </form>
          </>
        )}

        {!insideTelegram && (
          <>
            <p className="hint">من الموقع ادخل باسم المستخدم. لربط تلغرام افتح المنصة من البوت أو أنشئ رمز ربط من الحساب.</p>
            <div className="form-actions" style={{ justifyContent: "center" }}>
              <IcoAction className="btn outline" icon="bot" onClick={() => openTelegramBot(bot)}>تسجيل الدخول بتلغرام</IcoAction>
              <ApkDownloadButton className="btn dark" />
              <SupportButton settings={meta.settings} className="btn ghost" />
            </div>
          </>
        )}
        {insideTelegram && tgStep === "ask" && err && <div className="error" style={{ width: "100%" }}>{err}</div>}
      </div>
    </div>
  );
}

function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div className="page-head-copy">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Empty({ title, text, action }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 6, fontSize: 16 }}>{title}</div>
      {text && <div>{text}</div>}
      {action}
    </div>
  );
}

function Market() {
  const { user } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [stats, setStats] = useState({});
  const [ads, setAds] = useState([]);
  const [orders, setOrders] = useState([]);
  const [myAds, setMyAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState("SELL");
  const [asset, setAsset] = useState("USDT");
  const [fiat, setFiat] = useState("SYP");
  const [payment, setPayment] = useState("");
  const [amountQ, setAmountQ] = useState("");
  const [board, setBoard] = useState("ads");
  const quote = usePriceQuote(asset, fiat);
  const coins = meta.assets.length ? meta.assets : [{ symbol: "USDT" }];
  const fiats = meta.fiats.length ? meta.fiats : [{ code: "SYP" }];
  const isBuy = side === "SELL";

  function loadMarket() {
    const q = new URLSearchParams({ side, asset, fiat });
    if (payment) q.set("payment", payment);
    setLoading(true);
    const jobs = [api("/api/stats"), api(`/api/ads?${q}`)];
    if (user) {
      jobs.push(api("/api/orders"));
      jobs.push(api("/api/ads/mine"));
    }
    Promise.all(jobs)
      .then(([s, a, o, mine]) => {
        setStats(s);
        setAds(a.ads || []);
        if (o) setOrders(o.orders || []);
        if (mine) setMyAds(mine.ads || []);
      })
      .catch(() => setAds([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMarket();
  }, [side, asset, fiat, payment, user]);
  useAppRefresh(loadMarket);

  const want = Number(amountQ);
  const shown = ads.filter((ad) => {
    if (!(want > 0)) return true;
    const price = Number(ad.price) || 0;
    const cap = Math.min(Number(ad.maxAmount) || 0, Number(ad.available) || 0);
    const floor = Number(ad.minAmount) || 0;
    if (price > 0) {
      const minFiat = floor * price;
      const maxFiat = cap * price;
      return want >= minFiat && want <= maxFiat;
    }
    return want >= floor && want <= cap;
  });
  const openOrders = orders.filter((o) => ["pending_payment", "paid", "disputed"].includes(o.status));
  const chatOrders = [...orders].sort((a, b) => (b.lastMessage?.createdAt || b.createdAt || 0) - (a.lastMessage?.createdAt || a.createdAt || 0));

  function goBoard(id) {
    if (!user && id !== "ads") {
      nav("/gate");
      return;
    }
    setBoard(id);
  }

  return (
    <div className="page p2p-page">
      <FreezeBanner />
      <KycBanner />

      <div className="card p2p-board" style={{ padding: 0 }}>
        <div className="p2p-brand-bar">
          <div className="p2p-brand-name">
            <b>{(meta.settings && meta.settings.brand) || "USDT شام"}</b>
            <small>{(meta.settings && meta.settings.brandTagline) || "تداول ندّ لندّ"}</small>
          </div>
          <div className="p2p-tools">
            <button type="button" className={board === "ads" ? "on" : ""} onClick={() => goBoard("ads")}>
              <Icon name="market" /><span>السوق</span>
            </button>
            <button type="button" className={board === "chats" ? "on" : ""} onClick={() => goBoard("chats")}>
              <Icon name="chat" /><span>الدردشات</span>
              {openOrders.length > 0 && <em>{openOrders.length}</em>}
            </button>
            <button type="button" className={board === "orders" ? "on" : ""} onClick={() => goBoard("orders")}>
              <Icon name="orders" /><span>طلباتي</span>
            </button>
            <button type="button" className={board === "myads" ? "on" : ""} onClick={() => goBoard("myads")}>
              <Icon name="ads" /><span>إعلاناتي</span>
            </button>
          </div>
        </div>

        {board === "ads" && (
        <>
        <div className="p2p-top">
          <div className="p2p-sides">
            <button type="button" className={isBuy ? "on buy" : ""} onClick={() => setSide("SELL")}>شراء</button>
            <button type="button" className={!isBuy ? "on sell" : ""} onClick={() => setSide("BUY")}>بيع</button>
          </div>
          <div className="p2p-coins">
            {coins.map((a) => (
              <button key={a.symbol} type="button" className={`p2p-coin ${asset === a.symbol ? "on" : ""}`} onClick={() => setAsset(a.symbol)}>
                {a.symbol}
              </button>
            ))}
          </div>
          <IcoAction className="btn sm create-ad p2p-post" icon="plus" onClick={() => nav("/ads/new")}>نشر</IcoAction>
        </div>

        <div className="p2p-filters">
          <label className="p2p-select">
            <span>طريقة الدفع</span>
            <select value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">الكل</option>
              {(meta.paymentTypes || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="p2p-select">
            <span>الفيات</span>
            <select value={fiat} onChange={(e) => { setFiat(e.target.value); setAmountQ(""); }}>
              {fiats.map((f) => (
                <option key={f.code} value={f.code}>{f.code}</option>
              ))}
            </select>
          </label>
          <label className="p2p-amount">
            <span>المبلغ</span>
            <div className="p2p-amount-box">
              <input
                value={amountQ}
                onChange={(e) => setAmountQ(e.target.value)}
                inputMode="decimal"
                placeholder="المبلغ"
              />
              <em>{fiat}</em>
              <button type="button" className="p2p-search" onClick={loadMarket} title="بحث">
                <Icon name="search" />
              </button>
            </div>
          </label>
          <button type="button" className="p2p-refresh" onClick={loadMarket} title="تحديث">
            <Icon name="refresh" />
          </button>
        </div>

        {quoteHint(quote, isBuy ? "SELL" : "BUY", asset, fiat) && (
          <p className="hint p2p-quote">{quoteHint(quote, isBuy ? "SELL" : "BUY", asset, fiat)}</p>
        )}

        {loading ? (
          <Empty title="جاري تحميل الإعلانات..." />
        ) : shown.length === 0 ? (
          <Empty title="لا توجد إعلانات مطابقة" text="جرّب تغيير العملة أو المبلغ أو طريقة الدفع." />
        ) : (
          <div className="p2p-cards">
            {shown.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                side={side}
                onOpen={() => nav(`/trade/${ad.id}${want > 0 ? `?fiat=${encodeURIComponent(amountQ)}` : ""}`)}
              />
            ))}
          </div>
        )}
        </>
        )}

        {board === "chats" && (
          <div className="p2p-pane">
            {!user ? (
              <Empty title="سجّل الدخول للدردشة" action={<IcoLink to="/gate" className="btn sm" icon="login">دخول</IcoLink>} />
            ) : chatOrders.length === 0 ? (
              <Empty title="لا دردشات بعد" text="ابدأ صفقة من السوق لتظهر دردشتها هنا." />
            ) : (
              <div className="p2p-chats">
                {chatOrders.map((o) => {
                  const peer = o.buyerId === user.id ? o.seller : o.buyer;
                  const iBuy = o.buyerId === user.id;
                  return (
                    <button type="button" key={o.id} className="p2p-chat-row" onClick={() => nav(`/orders/${o.id}`)}>
                      <Avatar person={peer} size="sm" />
                      <div className="p2p-chat-main">
                        <div className="p2p-chat-top">
                          <b>{peer?.displayName || (iBuy ? "البائع" : "المشتري")}</b>
                          <span>{fmtWhen(o.lastMessage?.createdAt || o.createdAt)}</span>
                        </div>
                        <div className="p2p-chat-sub">
                          {iBuy ? "شراء" : "بيع"} {money(o.amount, 2)} {o.asset} · {money(o.fiatAmount)} {o.fiat}
                        </div>
                        <div className="p2p-chat-msg">{o.lastMessage?.text || "ابدأ المحادثة داخل الصفقة"}</div>
                      </div>
                      <span className={`pill ${statusTone(o.status)}`}>{STATUS[o.status] || o.status}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {board === "orders" && (
          <div className="p2p-pane">
            {!user ? (
              <Empty title="سجّل الدخول لعرض طلباتك" action={<IcoLink to="/gate" className="btn sm" icon="login">دخول</IcoLink>} />
            ) : orders.length === 0 ? (
              <Empty title="لا طلبات بعد" text="اختر إعلاناً من السوق لبدء صفقة." />
            ) : (
              <div className="p2p-chats">
                {orders.map((o) => (
                  <button type="button" key={o.id} className="p2p-chat-row" onClick={() => nav(`/orders/${o.id}`)}>
                    <div className="p2p-chat-main">
                      <div className="p2p-chat-top">
                        <b>{o.buyerId === user.id ? "شراء" : "بيع"} {money(o.amount, 4)} {o.asset}</b>
                        <span>{fmtWhen(o.createdAt)}</span>
                      </div>
                      <div className="p2p-chat-sub">
                        {money(o.fiatAmount)} {o.fiat} · #{o.id.slice(-8)}
                        {o.ad?.timeLimitMin ? ` · مهلة ${o.ad.timeLimitMin} د` : ""}
                      </div>
                    </div>
                    <span className={`pill ${statusTone(o.status)}`}>{STATUS[o.status] || o.status}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="p2p-pane-foot">
              <IcoLink to="/orders" className="btn ghost sm" icon="orders">كل الطلبات</IcoLink>
            </div>
          </div>
        )}

        {board === "myads" && (
          <div className="p2p-pane">
            {!user ? (
              <Empty title="سجّل الدخول لعرض إعلاناتك" action={<IcoLink to="/gate" className="btn sm" icon="login">دخول</IcoLink>} />
            ) : myAds.length === 0 ? (
              <Empty title="لا إعلانات لك" text="انشر إعلان بيع أو شراء." action={<IcoAction className="btn sm create-ad" icon="plus" onClick={() => nav("/ads/new")}>نشر إعلان</IcoAction>} />
            ) : (
              <div className="p2p-chats">
                {myAds.map((a) => (
                  <button type="button" key={a.id} className="p2p-chat-row" onClick={() => nav(`/ads/${a.id}/edit`)}>
                    <div className="p2p-chat-main">
                      <div className="p2p-chat-top">
                        <b>#{a.serial || "—"} · {a.side === "SELL" ? "بيع" : "شراء"} {a.asset}/{a.fiat}</b>
                        <span>{money(a.price, 2)}</span>
                      </div>
                      <div className="p2p-chat-sub">
                        المتاح {money(a.available, 2)} · الحد {money(a.minAmount, 2)}-{money(a.maxAmount, 2)} · مهلة {a.timeLimitMin || 15} د
                      </div>
                    </div>
                    <span className={`pill ${statusTone(a.status)}`}>{STATUS[a.status] || a.status}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="p2p-pane-foot">
              <IcoLink to="/ads" className="btn ghost sm" icon="ads">إدارة الإعلانات</IcoLink>
              <IcoAction className="btn sm create-ad" icon="plus" onClick={() => nav("/ads/new")}>نشر إعلان</IcoAction>
            </div>
          </div>
        )}
      </div>

      {board === "ads" && <div className="market-stats">
        <div className="hero-stat">
          <b>{stats.ads || 0}</b>
          <span>إعلان نشط</span>
        </div>
        <div className="hero-stat">
          <b>{stats.completed || 0}</b>
          <span>صفقة مكتملة</span>
        </div>
        <div className="hero-stat">
          <b>{money(stats.volumeUsdt)}</b>
          <span>حجم USDT</span>
        </div>
        <div className="hero-stat">
          <b>{stats.users || 0}</b>
          <span>مستخدم</span>
        </div>
      </div>}

      {board === "ads" && <div className="card market-about">
        <p className="hint" style={{ margin: 0 }}>
          تداول USDT بضمان المنصة مقابل الليرة أو الدولار عبر شام كاش. العملة تُحجز حتى تأكيد الدفع ثم تُفرج إلى محفظتك.
        </p>
        <div className="form-actions" style={{ marginTop: 12 }}>
          <IcoAction className="btn sm create-ad" icon="plus" onClick={() => nav("/ads/new")}>نشر إعلان</IcoAction>
          <IcoAction className="btn sm" icon={user && user.kycStatus !== "verified" ? "kyc" : "wallet"} onClick={() => (user ? nav(user.kycStatus === "verified" ? "/wallet" : "/kyc") : nav("/gate"))}>
            {user && user.kycStatus !== "verified" ? "وثّق حسابك" : "ابدأ التداول"}
          </IcoAction>
          <IcoLink to="/help" className="btn ghost sm" icon="help">الدليل</IcoLink>
          <SupportButton settings={meta.settings} className="btn ghost sm" />
        </div>
      </div>}
    </div>
  );
}

function AdCard({ ad, side, onOpen }) {
  const isBuy = side === "SELL";
  const trades = Number(ad.owner?.completedTrades || 0);
  const rating = Number(ad.owner?.rating || 0);
  const cap = Math.min(Number(ad.maxAmount) || 0, Number(ad.available) || 0);
  const price = Number(ad.price) || 0;
  const minFiat = price > 0 ? Number(ad.minAmount || 0) * price : 0;
  const maxFiat = price > 0 ? cap * price : 0;
  const limitMin = Number(ad.timeLimitMin) || 15;
  return (
    <article className="ad-card p2p-card">
      <div className="p2p-card-head">
        <div className="merchant">
          <Avatar person={ad.owner} size="sm" />
          <div>
            <div className="merchant-name">
              {ad.owner?.displayName || "تاجر"}
              {ad.owner?.merchantBadge === "verified" || ad.owner?.merchantBadge === "sponsored" ? <span className="tick">✔</span> : null}
              {ad.owner?.merchantBadge && ad.owner.merchantBadge !== "regular" && ad.owner.merchantBadge !== "new" && (
                <span className={`pill ${badgeTone(ad.owner.merchantBadge)}`}>{MERCHANT_BADGE[ad.owner.merchantBadge]}</span>
              )}
            </div>
            <div className="merchant-sub">
              {trades} عملية | {money(rating, 1)}% إتمام
            </div>
          </div>
        </div>
        <div className={`ad-price ${isBuy ? "buy" : "sell"}`}>
          {money(ad.price, 2)}
          <small>{ad.fiat}{ad.priceType === "floating" ? " · عائم" : ""}</small>
        </div>
      </div>
      <div className="p2p-card-meta">
        <div><span>السعر</span><b>{money(ad.price, 2)} {ad.fiat}</b></div>
        <div><span>الحد</span><b>{money(minFiat, 0)} - {money(maxFiat, 0)} {ad.fiat}</b></div>
        <div><span>المتاح</span><b>{money(ad.available, 2)} {ad.asset}</b></div>
        <div><span>عمليات التداول</span><b>{trades} عملية</b></div>
        <div><span>وقت الإغلاق</span><b>{limitMin} دقيقة إن لم تتم</b></div>
      </div>
      <div className="p2p-card-foot">
        <div className="ad-pay">
          {(ad.paymentTypes || []).map((p) => (
            <span key={p} className="pay-tag">
              {p === "SHAM_CASH" ? "شام كاش" : p}
            </span>
          ))}
        </div>
        <button className={`btn ${isBuy ? "green" : "red"} sm`} onClick={onOpen}>
          {isBuy ? `شراء ${ad.asset}` : `بيع ${ad.asset}`}
        </button>
      </div>
    </article>
  );
}

function Trade() {
  const { id } = useParams();
  const { user } = useAuth();
  const { payName } = useMeta();
  const nav = useNavigate();
  const loc = useLocation();
  const [ad, setAd] = useState(null);
  const [amount, setAmount] = useState("");
  const [fiatAmt, setFiatAmt] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/ads/${id}`)
      .then((d) => {
        setAd(d.ad);
        setPaymentType(d.ad.paymentTypes[0] || "");
        const preset = Number(new URLSearchParams(loc.search).get("fiat"));
        const price = Number(d.ad.price) || 0;
        if (preset > 0 && price > 0) {
          setFiatAmt(String(preset));
          setAmount(String(Math.round((preset / price) * 1e6) / 1e6));
        }
      })
      .catch((e) => setErr(e.message));
  }, [id, loc.search]);

  if (!ad) return <div className="page narrow">{err || "جاري التحميل..."}</div>;

  const qty = Number(amount);
  const fiatVal = Number(fiatAmt);
  const iBuy = ad.side === "SELL";
  const price = Number(ad.price) || 0;
  function setQty(v) {
    setAmount(v);
    const n = Number(v);
    setFiatAmt(n > 0 && price > 0 ? String(Math.round(n * price * 100) / 100) : "");
  }
  function setFiat(v) {
    setFiatAmt(v);
    const n = Number(v);
    setAmount(n > 0 && price > 0 ? String(Math.round((n / price) * 1e6) / 1e6) : "");
  }

  async function place() {
    setErr("");
    if (!user) return nav("/gate");
    setBusy(true);
    try {
      const d = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ adId: ad.id, amount: qty, paymentType })
      });
      nav(`/orders/${d.order.id}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHead
        title={`${iBuy ? "شراء" : "بيع"} ${ad.asset} مقابل ${ad.fiat}`}
        subtitle={`المعلن ${ad.owner?.displayName} · تقييم ${ad.owner?.rating}% · ${ad.owner?.completedTrades} صفقة`}
      />
      <div className="stack">
        <div className="card">
          <div className="form">
            <label className="field">
              <span>السعر{ad.priceType === "floating" ? " (عائم)" : " (ثابت)"}</span>
              <input readOnly value={`${money(ad.price, 4)} ${ad.fiat}${ad.priceType === "floating" && ad.floatRatio ? ` · ×${ad.floatRatio}` : ""}`} />
            </label>
            <label className="field">
              <span>الكمية ({ad.asset})</span>
              <input
                value={amount}
                onChange={(e) => setQty(e.target.value)}
                placeholder={`${money(ad.minAmount, 2)} - ${money(Math.min(ad.maxAmount, ad.available), 2)}`}
                inputMode="decimal"
              />
            </label>
            <label className="field">
              <span>{iBuy ? "ستدفع" : "ستستلم"} ({ad.fiat})</span>
              <input
                value={fiatAmt}
                onChange={(e) => setFiat(e.target.value)}
                placeholder={`${money((ad.minAmount || 0) * price, 0)} - ${money(Math.min(ad.maxAmount, ad.available) * price, 0)}`}
                inputMode="decimal"
              />
            </label>
            <label className="field">
              <span>طريقة الدفع</span>
              <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                {ad.paymentTypes.map((p) => (
                  <option key={p} value={p}>
                    {payName(p)}
                  </option>
                ))}
              </select>
            </label>
            {err && <div className="error">{err}</div>}
            <button className={`btn ${iBuy ? "green" : "red"} block`} onClick={place} disabled={busy}>
              {busy ? "جاري الإنشاء..." : `${iBuy ? "شراء" : "بيع"} الآن`}
            </button>
          </div>
        </div>
        <div className="card">
          <div className="section-title">
            <h3>شروط المعلن</h3>
          </div>
          <p className="small" style={{ lineHeight: 1.8 }}>{ad.terms || "لا شروط إضافية."}</p>
          <div className="summary" style={{ marginTop: 12 }}>
            <div className="summary-row">
              <span>مهلة الدفع</span>
              <b>{ad.timeLimitMin} دقيقة</b>
            </div>
            <div className="summary-row">
              <span>المتبقي في الإعلان</span>
              <b>{money(ad.available, 2)} {ad.asset}</b>
            </div>
            <div className="summary-row">
              <span>حد الطلب الحالي</span>
              <b>{money(ad.minAmount, 2)} - {money(Math.min(ad.maxAmount, ad.available), 2)} {ad.asset}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Orders() {
  const { user } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  function loadOrders() {
    if (!user) return;
    api("/api/orders")
      .then((d) => setOrders(d.orders || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadOrders();
  }, [user]);
  useAppRefresh(loadOrders);

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لعرض صفقاتك." />;

  const tabs = [
    ["all", "الكل", "all"],
    ["open", "جارية", "orders"],
    ["pending_payment", "انتظار", "payments"],
    ["paid", "مدفوعة", "check"],
    ["disputed", "نزاع", "shield"],
    ["completed", "مكتملة", "check"],
    ["cancelled", "ملغاة", "close"]
  ];
  const shown = orders.filter((o) => {
    if (filter === "all") return true;
    if (filter === "open") return ["pending_payment", "paid", "disputed"].includes(o.status);
    return o.status === filter;
  });

  return (
    <div className="page narrow">
      <FreezeBanner />
      <KycBanner />
      <PageHead title="الطلبات" subtitle="الجارية والمكتملة والملغاة والنزاعات.">
        <SupportButton settings={meta.settings} />
      </PageHead>
      <div className="wallet-tabs">
        {tabs.map(([id, label, icon]) => (
          <button key={id} type="button" className={`wallet-tab${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>
            <span className="wallet-tab-icon"><Icon name={icon} /></span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Empty title="جاري التحميل..." />
        ) : shown.length === 0 ? (
          <Empty title="لا توجد صفقات في هذا التبويب" text="ابدأ من السوق واختر إعلاناً مناسباً." action={<IcoAction className="btn sm" icon="market" onClick={() => nav("/")}>السوق</IcoAction>} />
        ) : (
          <div className="list">
            {shown.map((o) => (
              <div key={o.id} className="row" style={{ padding: 16, cursor: "pointer" }} onClick={() => nav(`/orders/${o.id}`)}>
                <div className="row-main">
                  <div className="row-title">
                    {o.buyerId === user.id ? "شراء" : "بيع"} {money(o.amount, 4)} {o.asset}
                  </div>
                  <div className="row-sub">
                    {money(o.fiatAmount)} {o.fiat} · رقم الصفقة {o.id.slice(-8)}
                    {o.buyerId !== user.id ? ` · المشتري: ${o.buyerLegalName || o.buyer?.kyc?.fullName || o.buyer?.displayName || "—"}` : ""}
                    {o.disputeReason ? ` · ${o.disputeReason}` : ""}
                  </div>
                </div>
                <span className={`pill ${statusTone(o.status)}`}>{STATUS[o.status] || o.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const DISPUTE_REASONS = [
  "دفعت ولم يفرج البائع عن العملة",
  "لم يصل المبلغ / بيانات الدفع غير صحيحة",
  "المبلغ المحوّل مختلف عن قيمة الصفقة",
  "الطرف الآخر لا يرد في الدردشة",
  "سبب آخر"
];

function EvidenceGallery({ files, orderId }) {
  if (!files || !files.length) return <p className="hint">لا مرفقات بعد.</p>;
  return (
    <div className="evidence-grid">
      {files.map((f) => {
        const src = authedUrl(`/api/orders/${orderId}/evidence/${f.id}`);
        const video = String(f.mime || "").startsWith("video/");
        return (
          <a key={f.id} className="evidence-item" href={src} target="_blank" rel="noreferrer">
            {video ? (
              <video src={src} muted playsInline preload="metadata" />
            ) : (
              <img src={src} alt={f.label || f.name} />
            )}
            <span>{f.label || f.name}</span>
          </a>
        );
      })}
    </div>
  );
}

function OrderRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  const { payName } = meta;
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [disputeFile, setDisputeFile] = useState(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState(DISPUTE_REASONS[0]);
  const [tradePin, setTradePin] = useState("");

  async function load() {
    const d = await api(`/api/orders/${id}`);
    setData(d);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [id, user]);
  useAppRefresh(() => load().catch(() => {}));

  async function act(path, body) {
    setErr("");
    try {
      await api(`/api/orders/${id}/${path}`, { method: "POST", body: JSON.stringify(body || {}) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function uploadKind(kind, file) {
    if (!file) {
      setErr(kind === "payment_proof" ? "اختر صورة إثبات الدفع أولاً" : "اختر ملف النزاع أولاً");
      return false;
    }
    setBusy(true);
    setErr("");
    try {
      const prepared = await prepareFileForUpload(file);
      await api(`/api/orders/${id}/evidence`, {
        method: "POST",
        body: JSON.stringify({ kind, files: [{ name: prepared.name, data: prepared.data }] })
      });
      await load();
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid() {
    const o = data && data.order;
    const needProof = meta.settings?.requirePaymentProof !== false;
    if (needProof && o && !o.hasPaymentProof) {
      if (!proofFile) {
        setErr("ارفع صورة إثبات الدفع قبل تأكيد اكتمال الدفع");
        return;
      }
      const prepared = await prepareFileForUpload(proofFile);
      await act("paid", { files: [{ name: prepared.name, data: prepared.data }] });
      setProofFile(null);
      return;
    }
    await act("paid");
  }

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لعرض الصفقة." />;
  if (!data) return <div className="page narrow">{err || "جاري التحميل..."}</div>;

  const o = data.order;
  const iBuyer = o.buyerId === user.id;
  const iSeller = o.sellerId === user.id;
  const demoOrder = !!(o.isDemo);
  const adminCanIntervene = user.isAdmin && !demoOrder && !iSeller && !iBuyer;
  const proofs = (o.evidence || []).filter((f) => f.kind === "payment_proof");
  const disputes = (o.evidence || []).filter((f) => f.kind !== "payment_proof");

  return (
    <div className="page">
      <PageHead title={`صفقة #${o.id.slice(-8)}`} subtitle={`${money(o.amount, 4)} ${o.asset} بسعر ${money(o.price, 2)} ${o.fiat}`}>
        <span className={`pill ${statusTone(o.status)}`}>{STATUS[o.status] || o.status}</span>
        {user.isAdmin && <IcoLink className="btn ghost sm" to="/admin" icon="admin">لوحة الإدارة</IcoLink>}
        <SupportButton settings={meta.settings} className="btn ghost sm" />
      </PageHead>
      {adminCanIntervene && (
        <div className="notice" style={{ marginBottom: 14 }}>
          دخول إداري كامل: المشتري {o.buyerLegalName || o.buyer?.kyc?.fullName || o.buyer?.displayName || "—"} · البائع {o.seller?.kyc?.fullName || o.seller?.displayName || "—"} · UID {o.buyer?.uidCode || "—"} / {o.seller?.uidCode || "—"}
        </div>
      )}
      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="summary">
              <div className="summary-row">
                <span>الكمية</span>
                <b>{money(o.amount, 6)} {o.asset}</b>
              </div>
              <div className="summary-row">
                <span>السعر</span>
                <b>{money(o.price, 4)} {o.fiat}</b>
              </div>
              <div className="summary-row total">
                <span>الإجمالي</span>
                <b>{money(o.fiatAmount)} {o.fiat}</b>
              </div>
              <div className="summary-row">
                <span>طريقة الدفع</span>
                <b>{payName(o.paymentType)}</b>
              </div>
            </div>
            {(iSeller || adminCanIntervene) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>
                  <h3>اسم المشتري (للمطابقة)</h3>
                </div>
                <div className="summary pay-box">
                  <div className="summary-row">
                    <span>الاسم الحقيقي للمشتري</span>
                    <b>{o.buyerLegalName || o.buyer?.kyc?.fullName || "غير موثّق"}</b>
                  </div>
                  <div className="summary-row">
                    <span>الاسم الظاهر</span>
                    <b>{o.buyer?.displayName || "—"}</b>
                  </div>
                  <div className="summary-row">
                    <span>UID</span>
                    <b className="mono">{o.buyer?.uidCode || "—"}</b>
                  </div>
                  <p className="hint" style={{ margin: "8px 0 0" }}>هذا اسم المشتري من التوثيق. طابقه مع اسم المرسل في إيصال شام كاش. إن اختلف لا تفرج وافتح نزاعاً.</p>
                </div>
              </>
            )}
            {(iBuyer || adminCanIntervene) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>
                  <h3>بيانات التحويل إلى البائع</h3>
                </div>
                <div className="summary pay-box">
                  <div className="summary-row">
                    <span>طريقة الدفع</span>
                    <b>{o.paymentLabel || payName(o.paymentType) || "شام كاش"}</b>
                  </div>
                  <div className="summary-row">
                    <span>اسم المستلم (البائع)</span>
                    <b>{o.paymentDetails?.name || o.seller?.kyc?.fullName || "—"}</b>
                  </div>
                  <div className="summary-row">
                    <span>عنوان شام كاش</span>
                    <b className="mono pay-addr">{o.paymentDetails?.address || o.paymentDetails?.account || "—"}</b>
                  </div>
                  {(o.paymentDetails?.address || o.paymentDetails?.account) && iBuyer && o.status === "pending_payment" && (
                    <button
                      type="button"
                      className="btn dark sm"
                      onClick={() => {
                        const addr = o.paymentDetails.address || o.paymentDetails.account;
                        if (addr && navigator.clipboard) navigator.clipboard.writeText(addr);
                      }}
                    >
                      نسخ العنوان
                    </button>
                  )}
                  {!o.paymentDetails?.address && !o.paymentDetails?.account && (
                    <div className="notice">لم يضف البائع عنوان شام كاش بعد. لا تحوّل حتى يظهر العنوان هنا.</div>
                  )}
                  {iBuyer && (
                    <p className="hint" style={{ margin: "8px 0 0" }}>حوّل من حساب شام كاش المسجّل باسمك الحقيقي في التوثيق حتى يتعرّف البائع عليك.</p>
                  )}
                </div>
              </>
            )}
            {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
            {o.status === "disputed" && (
              <div className="notice" style={{ marginTop: 12 }}>
                نزاع مفتوح: {o.disputeReason || (demoOrder ? "حساب تجريبي — لا يتدخل المدير" : "بانتظار مراجعة الإدارة")}. {demoOrder ? "الحساب التجريبي للعرض فقط." : "العملة تبقى في الضمان حتى الإفراج أو الإلغاء من المدير."} ارفع فيديو أو صورة للمراجعة.
              </div>
            )}
            {["completed", "cancelled"].includes(o.status) && (
              <div className="hint" style={{ marginTop: 12 }}>هذه الصفقة محفوظة في السجل ولا يمكن تعديلها.</div>
            )}
            {iBuyer && o.status === "pending_payment" && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="section-title"><h3>إثبات الدفع</h3></div>
                <p className="hint">ارفع لقطة شاشة لإيصال شام كاش قبل الضغط على «أكدت الدفع». يراها البائع والإدارة.</p>
                <label className="kyc-upload">
                  <span>{proofFile ? proofFile.name : "اختر صورة الإيصال"}</span>
                  <small>JPEG / PNG / WEBP حتى 4MB</small>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setProofFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                  />
                </label>
                {o.hasPaymentProof && <p className="hint">تم حفظ إثبات. يمكنك تأكيد الدفع.</p>}
              </div>
            )}
            {(proofs.length > 0 || disputes.length > 0) && (
              <div style={{ marginTop: 16 }}>
                <div className="section-title"><h3>المرفقات</h3></div>
                {proofs.length > 0 && (
                  <>
                    <p className="hint">إثبات الدفع</p>
                    <EvidenceGallery files={proofs} orderId={o.id} />
                  </>
                )}
                {disputes.length > 0 && (
                  <>
                    <p className="hint" style={{ marginTop: 10 }}>مرفقات النزاع</p>
                    <EvidenceGallery files={disputes} orderId={o.id} />
                  </>
                )}
              </div>
            )}
            {o.status === "disputed" && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="section-title"><h3>مرفق النزاع للمدير</h3></div>
                <p className="hint">ارفع فيديو قصيراً أو صورة توضح التحويل أو المشكلة. يُعرض للإدارة.</p>
                <label className="kyc-upload">
                  <span>{disputeFile ? disputeFile.name : "اختر فيديو أو صورة"}</span>
                  <small>صورة حتى 4MB أو فيديو حتى 12MB</small>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                    onChange={(e) => setDisputeFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="btn outline"
                    disabled={busy}
                    onClick={async () => {
                      const kind = disputeFile && String(disputeFile.type || "").startsWith("video/") ? "dispute_video" : "dispute_image";
                      const ok = await uploadKind(kind, disputeFile);
                      if (ok) setDisputeFile(null);
                    }}
                  >
                    {busy ? "جاري الرفع..." : "رفع مرفق النزاع"}
                  </button>
                </div>
              </div>
            )}
            {iSeller && (o.status === "paid" || o.status === "disputed") && (
              <div className="pin-release">
                <label className="field pin-field">
                  <span>رمز التحرير</span>
                  <input
                    className="pin-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={tradePin}
                    onChange={(e) => setTradePin(pinDigits(e.target.value))}
                    placeholder="••••••"
                  />
                </label>
                <IcoAction className="btn" icon="check" onClick={() => act("release", { tradePin })}>إفراج عن العملة</IcoAction>
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 16 }}>
              {iBuyer && o.status === "pending_payment" && (
                <IcoAction className="btn green" icon="check" disabled={busy} onClick={() => confirmPaid().catch((e) => setErr(e.message))}>أكدت الدفع</IcoAction>
              )}
              {adminCanIntervene && o.status === "disputed" && (
                <IcoAction className="btn" icon="check" onClick={() => act("release")}>إفراج للمشتري</IcoAction>
              )}
              {o.status === "pending_payment" && (
                <IcoAction className="btn outline" icon="close" onClick={() => act("cancel")}>إلغاء</IcoAction>
              )}
              {(adminCanIntervene || (demoOrder && (iBuyer || iSeller))) && o.status === "disputed" && (
                <IcoAction className="btn outline" icon="close" onClick={() => act("cancel")}>إلغاء النزاع وإعادة الرصيد</IcoAction>
              )}
              {["pending_payment", "paid"].includes(o.status) && (
                <IcoAction className="btn red" icon="warning" onClick={() => setDisputeOpen(true)}>فتح نزاع</IcoAction>
              )}
            </div>
            {disputeOpen && ["pending_payment", "paid"].includes(o.status) && (
              <div className="card" style={{ marginTop: 12, background: "rgba(246,70,93,0.06)" }}>
                <div className="section-title"><h3>فتح نزاع (ضمان Binance)</h3></div>
                  <p className="hint">{demoOrder ? "نزاع تجريبي للعرض فقط ولا يراجع المدير. الطرفان يفرجان أو يلغيان بأنفسهما." : "بعد تأكيد الدفع لا يُلغى الطلب مباشرة. يُجمَّد الأصل ويراجع المدير الدردشة وإثبات التحويل. بعد الفتح ارفع فيديو إن وُجد."}</p>
                <label className="field">
                  <span>سبب النزاع</span>
                  <select value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}>
                    {DISPUTE_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <div className="form-actions">
                  <IcoAction className="btn red" icon="warning" onClick={async () => { await act("dispute", { reason: disputeReason }); setDisputeOpen(false); }}>تأكيد فتح النزاع</IcoAction>
                  <IcoAction className="btn ghost" icon="back" onClick={() => setDisputeOpen(false)}>رجوع</IcoAction>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="chat">
          <div className="chat-head">
            <b>محادثة الصفقة</b>
            <span>{iBuyer ? (o.seller?.displayName || "البائع") : iSeller ? (o.buyerLegalName || o.buyer?.displayName || "المشتري") : "المشتري والبائع"}</span>
          </div>
          <div className="chat-log">
            {(data.messages || []).length === 0 ? (
              <div className="bubble sys">لا رسائل بعد. اكتب هنا للتواصل داخل الصفقة فقط.</div>
            ) : (data.messages || []).map((m) => (
              <div key={m.id} className={`bubble ${m.userId === "system" || m.fromRole === "system" ? "sys" : m.userId === user.id ? "me" : m.fromRole === "admin" ? "admin" : ""}`}>
                {m.userId !== "system" && m.fromRole !== "system" && (
                  <div className="muted small">{m.fromName || (m.fromRole === "buyer" ? "المشتري" : m.fromRole === "seller" ? "البائع" : m.fromRole === "admin" ? "الإدارة" : "")}{m.fromRole === "buyer" ? " · مشتري" : m.fromRole === "seller" ? " · بائع" : m.fromRole === "admin" ? " · إدارة" : ""}</div>
                )}
                <div>{m.text}</div>
              </div>
            ))}
          </div>
          <form
            className="chat-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              await act("messages", { text });
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={adminCanIntervene ? "رسالة من الإدارة للأطراف — دون أرقام أو تلغرام" : "رسالة داخل المنصة فقط — دون أرقام أو تلغرام أو واتساب"} />
            <IcoAction className="btn sm" icon="send" type="submit">إرسال</IcoAction>
          </form>
        </div>
      </div>
    </div>
  );
}

function Wallet() {
  const { user } = useAuth();
  const meta = useMeta();
  const [tab, setTab] = useState("assets");
  const [wallets, setWallets] = useState([]);
  const [methods, setMethods] = useState([]);
  const [ads, setAds] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    const [w, p, a, d, wd, tr] = await Promise.all([
      api("/api/wallet"),
      api("/api/payment-methods"),
      api("/api/ads/mine"),
      api("/api/deposits"),
      api("/api/withdrawals"),
      api("/api/transfers")
    ]);
    setWallets(w.wallets || []);
    setMethods(p.methods || []);
    setAds(a.ads || []);
    setDeposits(d.deposits || []);
    setWithdrawals(wd.withdrawals || []);
    setTransfers(tr.transfers || []);
  }

  useEffect(() => {
    if (user) load().catch((e) => setErr(e.message));
  }, [user]);
  useAppRefresh(() => { if (user) load().catch(() => {}); });

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لعرض محفظتك." />;

  const tabs = [
    ["assets", "الأصول", "coins"],
    ["deposit", "إيداع", "deposits"],
    ["send", "إرسال", "send"],
    ["withdraw", "سحب", "withdrawals"],
    ["withdrawals", "السجل", "list"],
    ["payments", "الدفع", "payments"],
    ["ads", "إعلاناتي", "ads"]
  ];

  return (
    <div className="page narrow">
      <FreezeBanner />
      <KycBanner />
      <PageHead title="المحفظة" subtitle="إيداع وسحب حصراً على شبكة BEP20 وإدارة طرق الدفع.">
        <SupportButton settings={meta.settings} />
      </PageHead>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="wallet-tabs">
        {tabs.map(([id, label, icon]) => (
          <button key={id} type="button" className={`wallet-tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
            <span className="wallet-tab-icon"><Icon name={icon} /></span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === "assets" && <AssetsPanel wallets={wallets} user={user} meta={meta} onDeposit={() => setTab("deposit")} onWithdraw={() => setTab("withdraw")} onSend={() => setTab("send")} />}
      {tab === "deposit" && <DepositPanel meta={meta} deposits={deposits} reload={load} />}
      {tab === "send" && <InternalSendPanel meta={meta} wallets={wallets} transfers={transfers} user={user} reload={load} />}
      {tab === "withdraw" && (
        <WithdrawPanel meta={meta} wallets={wallets} withdrawals={withdrawals} reload={load} user={user} />
      )}
      {tab === "withdrawals" && <WithdrawHistory withdrawals={withdrawals} />}
      {tab === "payments" && <PaymentMethodsPanel meta={meta} methods={methods} reload={load} user={user} />}
      {tab === "ads" && (
        <div className="stack">
          <IcoLink to="/ads" className="btn" icon="ads">فتح صفحة إعلاناتي</IcoLink>
          <IcoLink to="/ads/new" className="btn create-ad" icon="plus">نشر إعلان</IcoLink>
          <MyAdsPanel ads={ads} user={user} reload={load} />
        </div>
      )}
    </div>
  );
}

function assetUsdRate(asset, meta, wallet) {
  const symbol = String(asset || "").toUpperCase();
  if (symbol === "USDT" || symbol === "USD" || symbol === "BUSD") return 1;
  const fromWallet = Number(wallet && wallet.usdPrice);
  if (fromWallet > 0) return fromWallet;
  const row = (meta?.assets || []).find((a) => String(a.symbol).toUpperCase() === symbol);
  const n = Number((meta?.prices && meta.prices[symbol]) || row?.usdPrice || row?.priceUsd || 0);
  if (symbol === "USDC") return n > 0 ? n : 1;
  return n > 0 ? n : 0;
}

function AssetsPanel({ wallets, user, meta, onDeposit, onWithdraw, onSend }) {
  const [copied, setCopied] = useState(false);
  const [hide, setHide] = useState(() => localStorage.getItem("walletHideBal") === "1");
  const [quote, setQuote] = useState(() => localStorage.getItem("walletQuote") || "USDT");
  const [openQuote, setOpenQuote] = useState(false);
  const uidCode = user?.uidCode || "";
  const uidDigits = String(uidCode || "————————").split("");
  const quotes = [
    { id: "USDT", label: "USDT" },
    { id: "USD", label: "USD" }
  ];
  const usdTotal = wallets.reduce((sum, w) => {
    const qty = Number(w.available || 0) + Number(w.frozen || 0);
    return sum + qty * assetUsdRate(w.asset, meta, w);
  }, 0);
  const shownTotal = usdTotal;
  const mask = (v, d = 2) => (hide ? "******" : money(v, d));

  function pickQuote(id) {
    setQuote(id);
    localStorage.setItem("walletQuote", id);
    setOpenQuote(false);
  }

  function toggleHide() {
    const next = !hide;
    setHide(next);
    localStorage.setItem("walletHideBal", next ? "1" : "0");
  }

  return (
    <div className="stack wallet-home">
      <div className="uid-card">
        <div className="uid-card-top">
          <span className="uid-kicker">رقم الحساب</span>
          <button
            type="button"
            className={`uid-copy${copied ? " done" : ""}`}
            disabled={!uidCode}
            onClick={() => {
              if (!uidCode) return;
              navigator.clipboard.writeText(uidCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            <Icon name={copied ? "check" : "copy"} />
            <span>{copied ? "تم النسخ" : "نسخ"}</span>
          </button>
        </div>
        <div className="uid-digits" dir="ltr">
          {uidDigits.map((d, i) => (
            <span key={`${d}-${i}`}>{d}</span>
          ))}
        </div>
        <p className="uid-hint">حوّل داخلياً بهذا الرقم دون شبكة BEP20.</p>
      </div>
      <div className="est-card">
        <div className="est-top">
          <span>إجمالي التقدير</span>
          <button type="button" className="est-eye" onClick={toggleHide} aria-label={hide ? "إظهار الرصيد" : "إخفاء الرصيد"}>
            <Icon name={hide ? "eyeoff" : "eye"} />
          </button>
        </div>
        <div className="est-row">
          <strong dir="ltr">{mask(shownTotal, 2)}</strong>
          <div className="est-quote">
            <button type="button" className="est-quote-btn" onClick={() => setOpenQuote((v) => !v)}>
              <span>{quote}</span>
              <Icon name="chevron" />
            </button>
            {openQuote && (
              <div className="est-quote-menu">
                {quotes.map((q) => (
                  <button key={q.id} type="button" className={q.id === quote ? "on" : ""} onClick={() => pickQuote(q.id)}>
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="est-sub">الإجمالي مقوّم بـ USDT حسب أسعار السوق الحية. USDT ≈ 1 دولار.</p>
      </div>
      <div className="wallet-quick">
         <IcoAction className="wallet-quick-btn in" icon="deposits" onClick={onDeposit}>إيداع</IcoAction>
         <IcoAction className="wallet-quick-btn send" icon="send" onClick={onSend}>إرسال</IcoAction>
         <IcoAction className="wallet-quick-btn out" icon="withdrawals" onClick={onWithdraw}>سحب</IcoAction>
      </div>
      <div className="asset-table">
        <div className="asset-table-head">
          <span>العملة</span>
          <span>الرصيد</span>
        </div>
        {wallets.map((w) => {
          const avail = Number(w.available || 0);
          const frozen = Number(w.frozen || 0);
          const total = avail + frozen;
          const usd = total * assetUsdRate(w.asset, meta, w);
          return (
            <div className="asset-row" key={w.asset}>
              <div className="asset-row-coin">
                <span className={`coin-badge coin-${w.asset.toLowerCase()}`}>{w.asset.slice(0, 1)}</span>
                <div>
                  <b>{w.asset}</b>
                  <span>{w.asset === "USDT" ? "Tether" : w.asset}</span>
                </div>
              </div>
              <div className="asset-row-bal">
                <strong dir="ltr">{mask(avail, 4)}</strong>
                <em dir="ltr">{hide ? "******" : `≈ ${money(usd, 2)} ${quote}`}</em>
                {frozen > 0 && <i>مجمّد {mask(frozen, 4)}</i>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="notice">
        الإرسال الداخلي فوري برقم UID. السحب الخارجي عبر BEP20 يحتاج توثيق وموافقة الإدارة.
      </div>
    </div>
  );
}

function InternalSendPanel({ meta, wallets, transfers, user, reload }) {
  const [form, setForm] = useState({ to: "", asset: "USDT", amount: "", note: "", tradePin: "" });
  const [found, setFound] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const wallet = wallets.find((w) => w.asset === form.asset);
  const feePct = Number(meta.settings?.transferFeePct || 0);
  const amount = Number(form.amount);
  const fee = amount > 0 && feePct > 0 ? (amount * feePct) / 100 : 0;
  const total = (amount > 0 ? amount : 0) + fee;

  async function lookup() {
    setErr("");
    setFound(null);
    if (!form.to.trim()) return;
    try {
      const d = await api(`/api/users/lookup?q=${encodeURIComponent(form.to.trim())}`);
      setFound(d.user);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    setBusy(true);
    try {
      const d = await api("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ to: form.to, asset: form.asset, amount: Number(form.amount), note: form.note, tradePin: form.tradePin })
      });
      setOk(`تم إرسال ${form.amount} ${form.asset} إلى ${d.to.displayName} (UID ${d.to.uidCode})${d.transfer?.fee ? ` · عمولة ${d.transfer.fee}` : ""}.`);
      setForm({ ...form, amount: "", note: "", tradePin: "" });
      await reload();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="card form" onSubmit={submit}>
        <div className="section-title">
          <h3>تحويل داخل المنصة</h3>
        </div>
        <p className="hint">حوّل الرصيد فوراً برقم UID أو اسم المستخدم. رقمك: <b className="mono">{user?.uidCode || "—"}</b></p>
        <label className="field">
          <span>UID المستلم أو اسم المستخدم</span>
          <input
            value={form.to}
            onChange={(e) => { setForm({ ...form, to: e.target.value }); setFound(null); }}
            onBlur={lookup}
            placeholder="مثال: 10000001"
            required
          />
        </label>
        {found && (
          <div className="notice">المستلم: <b>{found.displayName}</b> · @{found.username} · UID {found.uidCode}</div>
        )}
        <div className="form-grid">
          <label className="field">
            <span>العملة</span>
            <select value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })}>
              {(meta.assets.length ? meta.assets : [{ symbol: "USDT" }]).map((a) => (
                <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>المبلغ (المتاح {money(wallet?.available || 0, 6)})</span>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" required />
          </label>
        </div>
        <label className="field">
          <span>ملاحظة (اختياري)</span>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="سبب التحويل" />
        </label>
        <label className="field pin-field">
          <span>رمز التحرير</span>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={form.tradePin}
            onChange={(e) => setForm({ ...form, tradePin: pinDigits(e.target.value) })}
            placeholder="••••••"
            required
          />
        </label>
        {!user?.tradePinSet && (
          <div className="notice">عيّن رمز تحرير من صفحة الحساب قبل التحويل. يحمي الإفراج والسحب إذا فُتح الجوال.</div>
        )}
        <div className="summary">
          <div className="summary-row">
            <span>المبلغ للمستلم</span>
            <b>{money(amount > 0 ? amount : 0, 6)} {form.asset}</b>
          </div>
          <div className="summary-row">
            <span>عمولة التحويل ({feePct}%)</span>
            <b>{money(fee, 6)} {form.asset}</b>
          </div>
          <div className="summary-row total">
            <span>يُخصم من رصيدك</span>
            <b>{money(total, 6)} {form.asset}</b>
          </div>
        </div>
        {err && <div className="error">{err}</div>}
        {ok && <div className="success">{ok}</div>}
        <button className="btn block" disabled={busy}>{busy ? "جاري التحويل..." : "إرسال الآن"}</button>
      </form>
      <div className="card" style={{ padding: 0 }}>
        <div className="section-title" style={{ padding: "16px 16px 0" }}><h3>سجل التحويلات الداخلية</h3></div>
        {transfers.length === 0 ? (
          <Empty title="لا تحويلات بعد" text="بعد أول إرسال أو استلام سيظهر السجل هنا." />
        ) : (
          <div className="list">
            {transfers.map((t) => (
              <div className="row" key={t.id}>
                <div className="row-main">
                  <div className="row-title">{t.direction === "out" ? "أرسلت" : "استلمت"} {money(t.amount, 6)} {t.asset}</div>
                  <div className="row-sub">
                    {t.direction === "out" ? `إلى UID ${t.to?.uidCode} · ${t.to?.displayName}` : `من UID ${t.from?.uidCode} · ${t.from?.displayName}`}
                    {t.direction === "out" && t.fee > 0 ? ` · عمولة ${money(t.fee, 6)}` : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </div>
                </div>
                <span className={`pill ${t.direction === "in" ? "green" : ""}`}>{t.direction === "out" ? "صادر" : "وارد"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DepositPanel({ meta, deposits, reload }) {
  const [form, setForm] = useState({ asset: "USDT", amount: "100", txHash: "", fromAddress: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [copied, setCopied] = useState(false);
  const address = meta.settings?.bep20Address || "";
  const coins = (meta.assets || []).filter((a) => a.depositEnabled !== false);
  const feePct = Number(meta.settings?.depositFeePct || 0);
  const amount = Number(form.amount);
  const fee = amount > 0 && feePct > 0 ? (amount * feePct) / 100 : 0;
  const netAmount = (amount > 0 ? amount : 0) - fee;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    try {
      await api("/api/deposits", {
        method: "POST",
        body: JSON.stringify({
          asset: form.asset,
          amount: Number(form.amount),
          txHash: form.txHash,
          fromAddress: form.fromAddress
        })
      });
      setForm({ ...form, txHash: "", fromAddress: "" });
      setOk("تم إرسال طلب الإيداع وهو بانتظار مراجعة الإدارة.");
      await reload();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">
          <h3>عنوان الإيداع</h3>
          <span className="pill">BEP20</span>
        </div>
        {(meta.settings?.depositWalletName || meta.settings?.depositWalletPlatform) && (
          <p className="hint" style={{ marginTop: 0 }}>
            المحفظة: <b>{meta.settings.depositWalletName || "الخزينة"}</b>
            {meta.settings.depositWalletPlatform ? ` · ${meta.settings.depositWalletPlatform}` : ""}
          </p>
        )}
        <div className="address-box">
          <code>{address || "—"}</code>
          <button
            className="btn dark sm"
            onClick={() => {
              navigator.clipboard.writeText(address);
              setCopied(true);
            }}
          >
            {copied ? "تم النسخ" : "نسخ العنوان"}
          </button>
        </div>
         <p className="hint" style={{ marginTop: 12 }}>
          الإيداع حصراً على شبكة BEP20. الحد الأدنى {meta.settings?.minDeposit || 0}
          {feePct > 0 ? ` · عمولة الإيداع ${feePct}% تُخصم عند القيد` : ""}، ثم أدخل هاش المعاملة ليضاف الرصيد بعد موافقة الإدارة.
        </p>
        {meta.settings?.depositEnabled === false && <div className="notice" style={{ marginTop: 12 }}>الإيداع متوقف من الإدارة.</div>}
      </div>

      <form className="card form" onSubmit={submit}>
        <div className="section-title">
          <h3>إرسال طلب إيداع</h3>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>العملة</span>
            <select value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })}>
              {(coins.length ? coins : [{ symbol: "USDT" }]).map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol} {a.name || ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>المبلغ</span>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" />
          </label>
        </div>
        <label className="field">
          <span>عنوان محفظتك المرسلة</span>
          <input value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} placeholder="0x..." />
        </label>
        <label className="field">
          <span>هاش المعاملة</span>
          <input value={form.txHash} onChange={(e) => setForm({ ...form, txHash: e.target.value })} placeholder="0x..." />
        </label>
        <div className="summary">
          <div className="summary-row">
            <span>المبلغ المرسل</span>
            <b>{money(amount > 0 ? amount : 0, 6)} {form.asset}</b>
          </div>
          <div className="summary-row">
            <span>عمولة الإيداع ({feePct}%)</span>
            <b>{money(fee, 6)} {form.asset}</b>
          </div>
          <div className="summary-row total">
            <span>يُضاف لمحفظتك بعد القبول</span>
            <b>{money(netAmount > 0 ? netAmount : 0, 6)} {form.asset}</b>
          </div>
        </div>
        {err && <div className="error">{err}</div>}
        {ok && <div className="success">{ok}</div>}
        <button className="btn block">إرسال طلب الإيداع</button>
      </form>

      <div className="card" style={{ padding: 0 }}>
        <div className="section-title" style={{ padding: "16px 18px 0" }}>
          <h3>طلبات الإيداع</h3>
        </div>
        {deposits.length === 0 ? (
          <Empty title="لا توجد طلبات إيداع" />
        ) : (
          <div className="list" style={{ padding: "0 18px" }}>
            {deposits.map((d) => (
              <div className="row" key={d.id}>
                <div className="row-main">
                  <div className="row-title">{money(d.netAmount != null ? d.netAmount : d.amount, 4)} {d.asset}{d.fee > 0 ? ` بعد العمولة` : ""}</div>
                  <div className="row-sub mono">{d.txHash}</div>
                  {d.treasuryWalletName && <div className="row-sub">محفظة الاستقبال: {d.treasuryWalletName}{d.treasuryWalletPlatform ? ` · ${d.treasuryWalletPlatform}` : ""}</div>}
                  {d.fee > 0 && <div className="row-sub">أُرسل {money(d.amount, 4)} · عمولة {money(d.fee, 4)} ({d.feePct}%)</div>}
                </div>
                <span className={`pill ${statusTone(d.status === "credited" ? "completed" : d.status)}`}>
                  {d.status === "credited" ? "مقبول" : d.status === "rejected" ? "مرفوض" : "قيد المراجعة"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WithdrawPanel({ meta, wallets, withdrawals, reload, user }) {
  const [form, setForm] = useState({ asset: "USDT", amount: "", toAddress: "", tradePin: "", totpCode: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const coins = (meta.assets || []).filter((a) => a.enabled !== false);
  const wallet = wallets.find((w) => w.asset === form.asset);
  const flatFee = Number(meta.settings?.withdrawFee || 0);
  const feePct = Number(meta.settings?.withdrawFeePct || 0);
  const minWithdraw = Number(meta.settings?.minWithdraw || 0);
  const amount = Number(form.amount);
  const pctFee = amount > 0 && feePct > 0 ? (amount * feePct) / 100 : 0;
  const fee = flatFee + pctFee;
  const total = (amount > 0 ? amount : 0) + fee;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await api("/api/withdrawals", {
        method: "POST",
        body: JSON.stringify({ asset: form.asset, amount: Number(form.amount), toAddress: form.toAddress, tradePin: form.tradePin, totpCode: form.totpCode })
      });
      setForm({ ...form, amount: "", toAddress: "", tradePin: "", totpCode: "" });
      setOk("تم إرسال طلب السحب. سيُحوّل بعد مراجعة الإدارة.");
      await reload();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="card form" onSubmit={submit}>
        <div className="section-title">
          <h3>سحب {form.asset}</h3>
          <span className="pill">BEP20</span>
        </div>
        {meta.settings?.withdrawEnabled === false && <div className="notice">السحب متوقف من الإدارة.</div>}
        <div className="balance-line">
          <span className="muted">الرصيد المتاح</span>
          <b className="mono">{money(wallet?.available || 0, 6)} {form.asset}</b>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>العملة</span>
            <select value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })}>
              {(coins.length ? coins : [{ symbol: "USDT" }]).map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>المبلغ</span>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder={`الحد الأدنى ${minWithdraw}`}
              inputMode="decimal"
            />
          </label>
        </div>
        <label className="field">
          <span>عنوان محفظة الاستلام (BEP20)</span>
          <input
            value={form.toAddress}
            onChange={(e) => setForm({ ...form, toAddress: e.target.value })}
            placeholder="0x..."
          />
        </label>
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setForm({ ...form, amount: String(wallet?.available || 0) })}
        >
          استخدام كامل الرصيد
        </button>
        <div className="summary">
          <div className="summary-row">
            <span>مبلغ السحب</span>
            <b>{money(amount, 6)} {form.asset}</b>
          </div>
          <div className="summary-row">
            <span>رسوم ثابتة</span>
            <b>{money(flatFee, 6)} {form.asset}</b>
          </div>
          <div className="summary-row">
            <span>عمولة السحب ({feePct}%)</span>
            <b>{money(pctFee, 6)} {form.asset}</b>
          </div>
          <div className="summary-row total">
            <span>إجمالي المحجوز</span>
            <b>{money(total, 6)} {form.asset}</b>
          </div>
        </div>
        <label className="field pin-field">
          <span>رمز التحرير</span>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={form.tradePin}
            onChange={(e) => setForm({ ...form, tradePin: pinDigits(e.target.value) })}
            placeholder="••••••"
            required
          />
        </label>
        {user?.totpEnabled && (
          <label className="field">
            <span>رمز تطبيق المصادقة</span>
            <input
              value={form.totpCode}
              onChange={(e) => setForm({ ...form, totpCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              required
            />
          </label>
        )}
        {!user?.tradePinSet && (
          <div className="notice">عيّن رمز تحرير من صفحة الحساب قبل السحب.</div>
        )}
        {user?.totpEnabled && <p className="hint">سحب الأموال يتطلب رمز Google الحالي مع رمز التحرير.</p>}
        {err && <div className="error">{err}</div>}
        {ok && <div className="success">{ok}</div>}
        <button className="btn block" disabled={busy}>{busy ? "جاري الإرسال..." : "إرسال طلب السحب"}</button>
        <p className="hint">
          يُحجز المبلغ من رصيدك فوراً. عند الموافقة تُرسل العملة إلى عنوانك، وعند الرفض يُعاد الرصيد تلقائياً.
        </p>
      </form>

      {withdrawals.filter((w) => w.status === "pending").length > 0 && (
        <div className="card">
          <div className="section-title">
            <h3>طلبات قيد المراجعة</h3>
          </div>
          {withdrawals.filter((w) => w.status === "pending").map((w) => (
            <div className="row" key={w.id}>
              <div className="row-main">
                <div className="row-title">{money(w.amount, 6)} {w.asset}</div>
                <div className="row-sub mono">{w.toAddress}</div>
                {w.fee > 0 && <div className="row-sub">رسوم {money(w.fee, 6)} · الإجمالي {money(w.total, 6)}</div>}
              </div>
              <span className="pill gold">قيد المراجعة</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WithdrawHistory({ withdrawals }) {
  if (!withdrawals.length) return <Empty title="لا توجد عمليات سحب" text="ستظهر هنا طلبات السحب وحالتها." />;
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="list" style={{ padding: "0 18px" }}>
        {withdrawals.map((w) => (
          <div className="row" key={w.id}>
            <div className="row-main">
              <div className="row-title">{money(w.amount, 6)} {w.asset}</div>
              <div className="row-sub mono">{w.toAddress}</div>
              {w.fee > 0 && <div className="row-sub">رسوم {money(w.fee, 6)} · الإجمالي {money(w.total, 6)}</div>}
              {w.txHash && <div className="row-sub mono">Tx: {w.txHash}</div>}
            </div>
            <div className="row-actions">
              <span className={`pill ${w.status === "completed" ? "green" : w.status === "rejected" ? "red" : "gold"}`}>
                {WITHDRAW_STATUS[w.status] || w.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function paymentDetailText(m) {
  const d = m.details || {};
  const addr = d.address || d.account || "";
  const parts = [d.name, addr].filter(Boolean);
  return parts.join(" · ") || m.label || "—";
}

function PaymentMethodsPanel({ meta, methods, reload, user }) {
  const [form, setForm] = useState({ type: "SHAM_CASH", label: "", address: "" });
  const [editId, setEditId] = useState("");
  const [editForm, setEditForm] = useState({ label: "", address: "" });
  const [err, setErr] = useState("");
  const legalName = user?.kyc?.fullName || "";
  const verified = user?.kycStatus === "verified" && legalName;
  const listed = methods.filter((m) => m.active !== false);
  const hasType = (type) => listed.some((m) => m.type === type);
  const shamExists = hasType("SHAM_CASH");

  async function add(e) {
    e.preventDefault();
    setErr("");
    if (!verified) {
      setErr("وثّق هويتك أولاً. اسم المستلم يُؤخذ من الاسم الحقيقي في التوثيق ولا يمكن تغييره.");
      return;
    }
    try {
      await api("/api/payment-methods", {
        method: "POST",
        body: JSON.stringify({
          type: form.type,
          label: form.label,
          details: { address: form.address, account: form.address }
        })
      });
      setForm({ ...form, label: "", address: "" });
      await reload();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function saveEdit(id) {
    setErr("");
    try {
      await api(`/api/payment-methods/${id}`, {
        method: "POST",
        body: JSON.stringify({ label: editForm.label, address: editForm.address })
      });
      setEditId("");
      await reload();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function removeMethod(m) {
    if (!window.confirm(`حذف طريقة الدفع ${m.label || meta.payName(m.type)}؟ إن لم تبقَ طريقة نشطة تُوقف إعلاناتك.`)) return;
    setErr("");
    try {
      await api(`/api/payment-methods/${m.id}`, { method: "DELETE" });
      if (editId === m.id) setEditId("");
      await reload();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">
          <h3>طرق الدفع المحفوظة</h3>
        </div>
        {listed.length === 0 ? (
          <p className="hint">لا توجد طرق دفع بعد. أضف عنوان شام كاش ليظهر للمشتري مع اسمك الحقيقي الموثّق.</p>
        ) : (
          <div className="list">
            {listed.map((m) => (
              <div className="row" key={m.id} style={{ alignItems: "flex-start" }}>
                <div className="row-main">
                  <div className="row-title">{m.label || meta.payName(m.type)}</div>
                  <div className="row-sub">اسم المستلم: {m.details?.name || legalName || "—"}</div>
                  <div className="row-sub mono">{m.details?.address || m.details?.account || "—"}</div>
                  {editId === m.id && (
                    <div className="form" style={{ marginTop: 10 }}>
                      <label className="field">
                        <span>وصف</span>
                        <input value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>عنوان شام كاش</span>
                        <input className="mono" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value.trim() })} />
                      </label>
                      <p className="hint">اسم المستلم يبقى الاسم الحقيقي من التوثيق ولا يُغيَّر.</p>
                      <div className="form-actions">
                        <button className="btn sm" type="button" onClick={() => saveEdit(m.id)}>حفظ التعديل</button>
                        <button className="btn ghost sm" type="button" onClick={() => setEditId("")}>إلغاء</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <span className="pill green">مفعّلة</span>
                  {editId !== m.id && (
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => {
                        setEditId(m.id);
                        setEditForm({ label: m.label || "", address: m.details?.address || m.details?.account || "" });
                      }}
                    >
                      تعديل
                    </button>
                  )}
                  <button className="btn red sm" type="button" onClick={() => removeMethod(m)}>حذف</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {shamExists ? (
        <div className="card">
          <p className="hint" style={{ margin: 0 }}>شام كاش مسجّلة مسبقاً (طريقة واحدة لكل نوع). عدّل العنوان الحالي أو احذفه ثم أضف من جديد. أي نوع دفع مستقبلي مثل سيريتل كاش سيكون أيضاً واحداً فقط.</p>
        </div>
      ) : (
      <form className="card form" onSubmit={add}>
        <div className="section-title">
          <h3>إضافة عنوان شام كاش</h3>
        </div>
        <p className="hint">عنوان واحد فقط لكل نوع دفع. لا يُحفظ رقم هاتف.</p>
        <label className="field">
          <span>اسم المستلم (من التوثيق)</span>
          <input value={legalName || "غير موثّق"} readOnly />
        </label>
        {!verified && (
          <div className="notice">
            أكمل توثيق الهوية أولاً. الاسم الظاهر للمشتري هو الاسم الحقيقي في KYC ولا يمكن تغييره.{" "}
            <NavLink to="/kyc" className="link">الذهاب للتوثيق</NavLink>
          </div>
        )}
        <label className="field">
          <span>عنوان شام كاش</span>
          <input
            className="mono"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value.trim() })}
            placeholder="a4c8e19b7d02f6e5c1a3b8d0479e2f5a"
            required
            disabled={!verified}
          />
        </label>
        <label className="field">
          <span>وصف (اختياري)</span>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="مثال: حساب شام كاش الأساسي" disabled={!verified} />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn block" disabled={!verified}>حفظ عنوان الدفع</button>
      </form>
      )}
    </div>
  );
}

function notificationHref(n) {
  if (n && n.href) return n.href;
  const extra = (n && n.extra) || {};
  if (extra.href) return extra.href;
  if (extra.orderId) return `/orders/${extra.orderId}`;
  if (extra.adId) return `/ads/${extra.adId}/edit`;
  if (extra.withdrawalId) return "/wallet";
  if (extra.depositId) return "/wallet";
  if (extra.supportTicketId) return "/support";
  if (extra.kycUserId) return `/admin?tab=kyc&user=${encodeURIComponent(extra.kycUserId)}`;
  if (extra.merchantUserId) return `/admin?tab=merchants&user=${encodeURIComponent(extra.merchantUserId)}`;
  return "/notifications";
}

function NotificationsPage() {
  const { user } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [err, setErr] = useState("");
  const [notifyHint, setNotifyHint] = useState("");

  async function load() {
    const d = await api("/api/notifications");
    setItems(d.notifications || []);
    setUnread(d.unread || 0);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [user]);
  useAppRefresh(() => { if (user) load().catch(() => {}); });

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لعرض الإشعارات." />;

  async function markAll() {
    await api("/api/notifications/read", { method: "POST", body: JSON.stringify({}) });
    await load();
  }

  return (
    <div className="page narrow">
      <PageHead title="الإشعارات" subtitle={unread ? `${unread} إشعار غير مقروء` : "كل إشعاراتك في مكان واحد."}>
        <SupportButton settings={meta.settings} />
        <button
          type="button"
          className="btn ghost sm"
          onClick={async () => {
            const ok = await ensureNotifyPermission();
            setNotifyHint(ok ? "تم تفعيل تنبيهات الجهاز." : "فعّل الإشعارات من إعدادات التطبيق ثم أعد المحاولة.");
          }}
        >
          تفعيل الرنين
        </button>
        {unread > 0 && <button className="btn ghost sm" onClick={markAll}>تعليم الكل كمقروء</button>}
      </PageHead>
      {notifyHint && <div className="success" style={{ marginBottom: 12 }}>{notifyHint}</div>}
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <Empty title="لا توجد إشعارات" text="ستظهر هنا إشعارات الصفقات والإيداع والسحب واعتماد التاجر." />
        ) : (
          <div className="list">
            {items.map((n) => (
              <div
                key={n.id}
                className={`row notice-row ${n.read ? "" : "unread"}`}
                onClick={async () => {
                  if (!n.read) {
                    await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [n.id] }) });
                  }
                  nav(notificationHref(n));
                }}
              >
                <div className="row-main">
                  <div className="row-title">{n.title}</div>
                  <div className="row-sub">{n.body}</div>
                </div>
                {!n.read && <span className="dot" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MyAdsPage() {
  const { user, refresh } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [ads, setAds] = useState([]);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");

  async function load() {
    const d = await api("/api/ads/mine");
    setAds(d.ads || []);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [user]);
  useAppRefresh(() => { if (user) load().catch(() => {}); });

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لعرض إعلاناتك." />;

  const merchantStatus = user.merchantStatus || (user.isMerchant ? "approved" : "none");
  const shown = ads.filter((a) => filter === "all" || a.status === filter);

  return (
    <div className="page">
      <FreezeBanner />
      <KycBanner />
      <PageHead title="إعلاناتي" subtitle="إدارة إعلاناتك، تعديل السعر والكمية، وإيقاف النشر.">
        <SupportButton settings={meta.settings} />
        <IcoAction className="btn create-ad" icon="plus" onClick={() => nav("/ads/new")}>نشر إعلان</IcoAction>
      </PageHead>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {merchantStatus !== "approved" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <MerchantApply user={user} onApplied={refresh} />
        </div>
      )}
      {merchantStatus === "approved" && user.merchantDecisionNote && (
        <div className="notice" style={{ marginBottom: 16 }}>ملاحظة الإدارة: {user.merchantDecisionNote}</div>
      )}
      {merchantStatus === "approved" && user.kycStatus !== "verified" && (
        <div className="notice" style={{ marginBottom: 16 }}>
          حسابك معتمد كتاجر. أكمل التوثيق لنشر إعلان.{" "}
          <NavLink to="/kyc" className="link">الذهاب للتوثيق</NavLink>
        </div>
      )}
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[["all", "الكل", "all"], ["active", "نشط", "check"], ["paused", "متوقف", "lock"], ["filled", "نفد", "close"], ["closed", "محذوف", "close"]].map(([id, label, icon]) => (
          <TabBtn key={id} id={id} icon={icon} label={label} on={filter === id} onClick={() => setFilter(id)} />
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title="لا توجد إعلانات" text="أنشئ إعلان بيع أو شراء بأسلوب Binance P2P." action={<IcoAction className="btn sm create-ad" icon="plus" onClick={() => nav("/ads/new")}>نشر إعلان</IcoAction>} />
      ) : (
        <MyAdsList ads={shown} reload={load} />
      )}
    </div>
  );
}

function MyAdsPanel({ ads, user, reload }) {
  const merchantStatus = user?.merchantStatus || (user?.isMerchant ? "approved" : "none");
  if (merchantStatus !== "approved") {
    return (
      <div className="stack">
        <div className="card">
          <div className="section-title">
            <h3>اعتماد التاجر</h3>
          </div>
          {merchantStatus === "pending" ? (
            <div className="notice">طلب اعتماد التاجر قيد مراجعة المدير. بعد الموافقة ستستطيع نشر الإعلانات.</div>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                نشر الإعلانات متاح للتجار المعتمدين فقط. أرسل طلب اعتماد ليراجعه المدير.
              </p>
              <IcoLink to="/ads/new" className="btn create-ad" icon="plus">إرسال طلب اعتماد تاجر</IcoLink>
            </>
          )}
        </div>
        {ads.length > 0 && <MyAdsList ads={ads} reload={reload} />}
      </div>
    );
  }
  if (!ads.length) {
    return (
      <div className="stack">
        <Empty title="لا توجد إعلانات" text="أنشئ إعلانك الأول من صفحة نشر إعلان." />
        <IcoLink to="/ads/new" className="btn block create-ad" icon="plus">نشر إعلان جديد</IcoLink>
      </div>
    );
  }
  return <MyAdsList ads={ads} reload={reload} />;
}

function MyAdsList({ ads, reload }) {
  const nav = useNavigate();
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="list" style={{ padding: "0 18px" }}>
        {ads.map((a) => (
          <div className="row" key={a.id}>
            <div className="row-main">
              <div className="row-title">
                #{a.serial || "—"} · {a.side === "SELL" ? "بيع" : "شراء"} {a.asset}/{a.fiat} @ {money(a.price, 4)}{a.priceType === "floating" ? " · عائم" : " · ثابت"}
              </div>
              <div className="row-sub">
                الحد {money(a.minAmount, 2)} - {money(a.maxAmount, 2)} · المتبقي {money(a.available, 2)} {a.asset}
                {a.reviewNote ? ` · ${a.reviewNote}` : ""}
              </div>
            </div>
            <div className="row-actions">
              <span className={`pill ${statusTone(a.status)}`}>{STATUS[a.status] || a.status}</span>
              {["active", "paused"].includes(a.status) && (
                <>
                  <button className="btn dark sm" onClick={() => nav(`/ads/${a.id}/edit`)}>تعديل</button>
                  <button
                    className="btn ghost sm"
                    onClick={async () => {
                      await api(`/api/ads/${a.id}/toggle`, { method: "POST" });
                      await reload();
                    }}
                  >
                    {a.status === "active" ? "إيقاف" : "تشغيل"}
                  </button>
                  <button
                    className="btn red sm"
                    onClick={async () => {
                      if (!window.confirm(`حذف الإعلان #${a.serial}؟ سيُعاد الرصيد المجمّد إن لم تكن هناك صفقات جارية.`)) return;
                      await api(`/api/ads/${a.id}`, { method: "DELETE" });
                      await reload();
                    }}
                  >
                    حذف
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MerchantApply({ user, onApplied }) {
  const [shop, setShop] = useState(user.merchantShop || "");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const status = user.merchantStatus || (user.isMerchant ? "approved" : "none");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/api/merchant/apply", { method: "POST", body: JSON.stringify({ shopName: shop, note }) });
      await onApplied();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  if (status === "approved") {
    return (
      <div className="stack">
        <div className="success">حسابك معتمد كتاجر. يمكنك نشر الإعلانات.</div>
        {user.merchantDecisionNote && <div className="notice">ملاحظة الإدارة: {user.merchantDecisionNote}</div>}
      </div>
    );
  }
  if (status === "pending") {
    return (
      <div className="stack">
        <div className="notice">طلب اعتماد التاجر قيد مراجعة الإدارة. سيتم إشعارك بعد الموافقة.</div>
        {user.kycStatus !== "verified" && (
          <div className="notice">
            يمكنك الآن إكمال توثيق الهوية بالتوازي حتى لا يتأخر نشر إعلانك.{" "}
            <NavLink to="/kyc" className="link">الذهاب للتوثيق</NavLink>
          </div>
        )}
      </div>
    );
  }
  return (
    <form className="form" onSubmit={submit}>
      <p className="hint">نشر الإعلانات متاح للتجار المعتمدين. تُراجع الإدارة الطلب مرة واحدة ثم يُعتمد حسابك.</p>
      {status === "rejected" && (
        <div className="error">
          تم رفض طلبك السابق.{user.merchantDecisionNote ? ` ملاحظة الإدارة: ${user.merchantDecisionNote}` : ""} يمكنك إعادة التقديم.
        </div>
      )}
      {user.kycStatus !== "verified" && (
        <div className="notice">
          توثيق الهوية مطلوب أيضاً قبل نشر الإعلان.{" "}
          <NavLink to="/kyc" className="link">أكمل التوثيق</NavLink>
        </div>
      )}
      <label className="field">
        <span>اسم المتجر أو النشاط</span>
        <input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="مثال: صرافة الشام" />
      </label>
      <label className="field">
        <span>ملاحظة للإدارة</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="خبرتك، قنواتك، حجم التداول المتوقع" />
      </label>
      {err && <div className="error">{err}</div>}
      <button className="btn block" disabled={busy}>{busy ? "جاري الإرسال..." : "إرسال طلب الاعتماد"}</button>
    </form>
  );
}

function NewAd() {
  const { user, refresh } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState({
    side: "SELL",
    asset: "USDT",
    fiat: "SYP",
    price: "1",
    priceType: "fixed",
    floatRatio: "1",
    minAmount: "50",
    maxAmount: "1000",
    available: "1000",
    paymentTypes: ["SHAM_CASH"],
    terms: "حوّل عبر شام كاش ثم اضغط تم الدفع.",
    timeLimitMin: 15
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const quote = usePriceQuote(form.asset, form.fiat);

  useEffect(() => {
    api("/api/payment-methods")
      .then((d) => setMethods((d.methods || []).filter((m) => m.active !== false)))
      .catch(() => setMethods([]));
  }, []);

  useEffect(() => {
    const suggested = suggestedForSide(quote, form.side);
    if (!(suggested > 0)) return;
    setForm((f) => {
      if (f.priceType === "floating") return f;
      if (f.price && Number(f.price) > 0 && f.price !== "1") return f;
      return { ...f, price: String(suggested) };
    });
  }, [quote, form.side]);

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لنشر إعلان." />;

  const merchantStatus = user.merchantStatus || (user.isMerchant ? "approved" : "none");
  if (merchantStatus !== "approved") {
    return (
      <div className="page narrow">
        <PageHead title="نشر إعلان" subtitle="نشر الإعلانات يتطلب اعتماد المدير لحسابك كتاجر.">
          <SupportButton settings={meta.settings} />
        </PageHead>
        <div className="card">
          <MerchantApply user={user} onApplied={refresh} />
        </div>
      </div>
    );
  }

  if (user.kycStatus !== "verified") {
    return (
      <div className="page narrow">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>التوثيق مطلوب</h2>
          <p className="hint">حسابك معتمد كتاجر، ويبقى توثيق الهوية مطلوباً قبل نشر إعلان.</p>
          <IcoLink to="/kyc" className="btn" icon="kyc">الذهاب للتوثيق</IcoLink>
        </div>
      </div>
    );
  }

  if (!methods.some((m) => m.type === "SHAM_CASH")) {
    return (
      <div className="page narrow">
        <PageHead title="نشر إعلان" subtitle="أضف عنوان شام كاش أولاً. طريقة الدفع لا تتضمن رقم هاتف.">
          <SupportButton settings={meta.settings} />
        </PageHead>
        <div className="card">
          <p className="hint">لا يمكن نشر إعلان قبل حفظ طريقة دفع (اسم المستلم من التوثيق + عنوان شام كاش فقط).</p>
          <IcoLink to="/wallet" className="btn" icon="payments">إضافة طريقة دفع</IcoLink>
        </div>
      </div>
    );
  }

  function togglePay(id) {
    setForm((f) => {
      const has = f.paymentTypes.includes(id);
      return { ...f, paymentTypes: has ? f.paymentTypes.filter((x) => x !== id) : [...f.paymentTypes, id] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const data = await api("/api/ads", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          priceType: form.priceType === "floating" ? "floating" : "fixed",
          floatRatio: Number(form.floatRatio || 1),
          minAmount: Number(form.minAmount),
          maxAmount: Number(form.maxAmount),
          available: Number(form.available)
        })
      });
      nav(`/ads`);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHead title="نشر إعلان" subtitle="حدد نوع العرض والسعر والحدود كما في Binance P2P.">
        <SupportButton settings={meta.settings} />
      </PageHead>
      <form className="card form" onSubmit={submit}>
        <div className="segmented" style={{ marginBottom: 8 }}>
          <button type="button" className={form.side === "SELL" ? "on buy" : ""} onClick={() => setForm({ ...form, side: "SELL" })}>أريد البيع</button>
          <button type="button" className={form.side === "BUY" ? "on sell" : ""} onClick={() => setForm({ ...form, side: "BUY" })}>أريد الشراء</button>
        </div>
        <p className="hint">{form.side === "SELL" ? "الإعلان يظهر للمشترين، وتُحجز الكمية من محفظتك حتى اكتمال الصفقات أو إيقاف الإعلان." : "الإعلان يظهر للبائعين. تدفع بالفيات عبر شام كاش بعد قبول الصفقة."}</p>
        <div className="form-grid">
          <label className="field">
            <span>العملة</span>
            <select value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })}>
              {(meta.assets || []).map((a) => (
                <option key={a.symbol}>{a.symbol}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>الفيات</span>
            <select value={form.fiat} onChange={(e) => setForm({ ...form, fiat: e.target.value })}>
              {(meta.fiats || []).map((f) => (
                <option key={f.code} value={f.code}>
                  {f.code} {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PriceTypeFields form={form} setForm={setForm} quote={quote} />
        {quoteHint(quote, form.side, form.asset, form.fiat) && form.priceType !== "floating" ? (
          <p className="hint">
            {quoteHint(quote, form.side, form.asset, form.fiat)}
            {suggestedForSide(quote, form.side) > 0 && (
              <>
                {" "}
                <button type="button" className="linkish" onClick={() => setForm({ ...form, price: String(suggestedForSide(quote, form.side)) })}>
                  استخدم المقترح
                </button>
              </>
            )}
          </p>
        ) : null}
        <label className="field">
          <span>الكمية المتاحة</span>
          <input value={form.available} onChange={(e) => setForm({ ...form, available: e.target.value })} inputMode="decimal" />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>الحد الأدنى</span>
            <input value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} inputMode="decimal" />
          </label>
          <label className="field">
            <span>الحد الأقصى</span>
            <input value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} inputMode="decimal" />
          </label>
        </div>
        <div className="field">
          <span>طرق الدفع</span>
          <div className="chips">
            {(meta.paymentTypes || []).map((p) => (
              <button type="button" key={p.id} className={`chip ${form.paymentTypes.includes(p.id) ? "on" : ""}`} onClick={() => togglePay(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>شروط الإعلان</span>
          <textarea rows={3} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
        </label>
        {err && <div className="error">{err}</div>}
        <IcoAction type="submit" className="btn block create-ad" icon="plus" disabled={busy}>{busy ? "جاري النشر..." : "نشر الإعلان"}</IcoAction>
      </form>
    </div>
  );
}

function EditAd() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const quote = usePriceQuote(form?.asset || "USDT", form?.fiat || "SYP");

  useEffect(() => {
    api(`/api/ads/${id}`)
      .then((d) => {
        const a = d.ad;
        setForm({
          serial: a.serial,
          side: a.side,
          asset: a.asset,
          fiat: a.fiat,
          price: String(a.price),
          priceType: a.priceType === "floating" ? "floating" : "fixed",
          floatRatio: String(a.floatRatio || 1),
          minAmount: String(a.minAmount),
          maxAmount: String(a.maxAmount),
          available: String(a.available),
          paymentTypes: a.paymentTypes || ["SHAM_CASH"],
          terms: a.terms || "",
          timeLimitMin: a.timeLimitMin || 15,
          status: a.status
        });
      })
      .catch((e) => setErr(e.message));
  }, [id]);

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لتعديل الإعلان." />;
  if (!form) return <div className="page narrow">{err || "جاري التحميل..."}</div>;

  function togglePay(pid) {
    setForm((f) => {
      const has = f.paymentTypes.includes(pid);
      return { ...f, paymentTypes: has ? f.paymentTypes.filter((x) => x !== pid) : [...f.paymentTypes, pid] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api(`/api/ads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          price: Number(form.price),
          priceType: form.priceType === "floating" ? "floating" : "fixed",
          floatRatio: Number(form.floatRatio || 1),
          minAmount: Number(form.minAmount),
          maxAmount: Number(form.maxAmount),
          available: Number(form.available),
          paymentTypes: form.paymentTypes,
          terms: form.terms,
          timeLimitMin: Number(form.timeLimitMin),
          status: form.status
        })
      });
      nav("/ads");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHead title={`تعديل الإعلان #${form.serial || ""}`} subtitle={`${form.side === "SELL" ? "بيع" : "شراء"} ${form.asset} مقابل ${form.fiat}`}>
        <span className={`pill ${statusTone(form.status)}`}>{STATUS[form.status] || form.status}</span>
      </PageHead>
      <form className="card form" onSubmit={submit}>
        <PriceTypeFields form={form} setForm={setForm} quote={quote} />
        {quoteHint(quote, form.side, form.asset, form.fiat) && form.priceType !== "floating" ? (
          <p className="hint">
            {quoteHint(quote, form.side, form.asset, form.fiat)}
            {suggestedForSide(quote, form.side) > 0 && (
              <>
                {" "}
                <button type="button" className="linkish" onClick={() => setForm({ ...form, price: String(suggestedForSide(quote, form.side)) })}>
                  استخدم المقترح
                </button>
              </>
            )}
          </p>
        ) : null}
        <label className="field">
          <span>الكمية المتاحة</span>
          <input value={form.available} onChange={(e) => setForm({ ...form, available: e.target.value })} inputMode="decimal" />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>الحد الأدنى</span>
            <input value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} inputMode="decimal" />
          </label>
          <label className="field">
            <span>الحد الأقصى</span>
            <input value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} inputMode="decimal" />
          </label>
        </div>
        <div className="field">
          <span>طرق الدفع</span>
          <div className="chips">
            {(meta.paymentTypes || []).map((p) => (
              <button type="button" key={p.id} className={`chip ${form.paymentTypes.includes(p.id) ? "on" : ""}`} onClick={() => togglePay(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>شروط الإعلان</span>
          <textarea rows={3} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
        </label>
        <label className="field">
          <span>الحالة</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">نشط</option>
            <option value="paused">متوقف</option>
          </select>
        </label>
        {err && <div className="error">{err}</div>}
        <div className="form-actions">
          <button className="btn" disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ التعديلات"}</button>
          <button type="button" className="btn ghost" onClick={() => nav("/ads")}>رجوع</button>
          {["active", "paused"].includes(form.status) && (
            <button
              type="button"
              className="btn red"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`حذف الإعلان #${form.serial}؟ سيُعاد الرصيد المجمّد إن لم تكن هناك صفقات جارية.`)) return;
                setBusy(true);
                try {
                  await api(`/api/ads/${id}`, { method: "DELETE" });
                  nav("/ads");
                } catch (ex) {
                  setErr(ex.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              حذف الإعلان
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function KycFileField({ label, hint, file, onPick }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <label className="kyc-upload">
      <span>{label}</span>
      <small className="muted">{hint}</small>
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => onPick(e.target.files?.[0] || null)} />
      {file && (
        <div className="kyc-preview">
          {preview ? <img src={preview} alt={label} /> : <b>{file.name}</b>}
          <span className="muted">{Math.round(file.size / 1024)} KB</span>
        </div>
      )}
    </label>
  );
}

function KycPage() {
  const { user, refresh } = useAuth();
  const meta = useMeta();
  const [form, setForm] = useState({ fullName: "", nationalId: "", country: "SY", documentType: "id", phone: "", address: "" });
  const [level, setLevel] = useState("basic");
  const [files, setFiles] = useState({ id_front: null, id_back: null, selfie: null, residence: null, extra: null });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام لتوثيق حسابك." />;

  const status = user.kycStatus || "pending";
  const canUpgrade = status === "verified" && user.kycLevel !== "advanced" && !user.kycUpgradePending;
  const upgradeMode = canUpgrade && upgradeOpen;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (upgradeMode) {
      if (!files.residence) {
        setErr("التوثيق المتقدم يتطلب إثبات السكن (فاتورة أو عقد).");
        return;
      }
    } else {
      if (!files.id_front || !files.id_back || !files.selfie) {
        setErr("ارفع وجه الهوية وظهرها وصورة شخصية مع الوثيقة.");
        return;
      }
      if (level === "advanced" && !files.residence) {
        setErr("التوثيق المتقدم يتطلب إثبات السكن (فاتورة أو عقد).");
        return;
      }
    }
    setBusy(true);
    try {
      const payloadFiles = [];
      let totalBytes = 0;
      const source = upgradeMode
        ? { residence: files.residence, extra: files.extra }
        : files;
      for (const [kind, file] of Object.entries(source)) {
        if (!file) continue;
        const prepared = await prepareFileForUpload(file);
        totalBytes += prepared.data.length;
        payloadFiles.push({ kind, name: prepared.name, data: prepared.data });
      }
      if (totalBytes > 20 * 1024 * 1024) {
        setErr("مجموع حجم الملفات كبير جداً. ارفع صوراً أصغر ثم أعد المحاولة.");
        return;
      }
      const payload = upgradeMode
        ? {
            ...form,
            fullName: user.kyc?.fullName || form.fullName,
            nationalId: user.kyc?.nationalId || form.nationalId,
            country: user.kyc?.country || form.country,
            documentType: user.kyc?.documentType || form.documentType,
            phone: user.kyc?.phone || form.phone,
            address: user.kyc?.address || form.address,
            level: "advanced",
            files: payloadFiles
          }
        : { ...form, level, files: payloadFiles };
      await api("/api/kyc", { method: "POST", body: JSON.stringify(payload) });
      setUpgradeOpen(false);
      await refresh();
    } catch (ex) {
      setErr(ex.message || "تعذر إرسال الملفات. جرّب صوراً أصغر ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHead title="توثيق الهوية" subtitle="التوثيق الأساسي يكفي للتداول العادي، والمتقدم يرفع حدّ المبالغ الكبيرة.">
        <SupportButton settings={meta.settings} />
      </PageHead>
      <div className="card stack">
        <div className="row" style={{ paddingTop: 0 }}>
          <span className="muted">الحالة</span>
          <span className={`pill ${status === "verified" ? "green" : status === "rejected" ? "red" : "gold"}`}>
            {KYC_STATUS[status] || status}
            {status === "verified" ? ` · ${user.kycLevel === "advanced" ? "متقدم" : "أساسي"}` : ""}
          </span>
        </div>
        {status === "verified" && (
          <div className="success">حسابك موثّق ({user.kycLevel === "advanced" ? "متقدم" : "أساسي"}).</div>
        )}
        {user.kyc?.note && <div className="notice">ملاحظة الإدارة: {user.kyc.note}</div>}
        {user.kycUpgradePending && (
          <div className="notice">طلب التوثيق المتقدم قيد مراجعة الإدارة. التوثيق الأساسي يبقى سارياً.</div>
        )}
        {canUpgrade && !upgradeOpen && (
          <div className="notice">
            التوثيق الأساسي مقبول. للمبالغ فوق حد الإدارة ارفع إثبات السكن واطلب التوثيق المتقدم.
            <div className="form-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => { setUpgradeOpen(true); setErr(""); }}>طلب التوثيق المتقدم</button>
            </div>
          </div>
        )}

        {status === "submitted" && (
          <div className="kyc-sent">
            <p style={{ marginTop: 0 }}>تم استلام ملفك وهو قيد مراجعة الإدارة{user.kycLevel === "advanced" ? " (توثيق متقدم)" : ""}.</p>
            <ul className="muted" style={{ margin: 0, paddingRight: 18 }}>
              {(user.kyc?.files || []).map((f) => (
                <li key={f.id}>
                  {f.kind === "id_front" ? "وجه الهوية" : f.kind === "id_back" ? "ظهر الهوية" : f.kind === "selfie" ? "صورة شخصية" : f.kind === "residence" ? "إثبات السكن" : "مستند إضافي"} — {f.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {upgradeMode && (
          <form className="form" onSubmit={submit}>
            <div className="section-title"><h3>ترقية إلى توثيق متقدم</h3></div>
            <p className="hint">الاسم ورقم الهوية من التوثيق الأساسي. ارفع إثبات السكن فقط.</p>
            <div className="summary">
              <div className="summary-row"><span>الاسم القانوني</span><b>{user.kyc?.fullName || "—"}</b></div>
              <div className="summary-row"><span>رقم الهوية</span><b>{user.kyc?.nationalId || "—"}</b></div>
            </div>
            <div className="kyc-uploads">
              <KycFileField label="إثبات السكن *" hint="فاتورة كهرباء أو عقد سكن باسمك" file={files.residence} onPick={(f) => setFiles({ ...files, residence: f })} />
              <KycFileField label="مستند إضافي" hint="اختياري" file={files.extra} onPick={(f) => setFiles({ ...files, extra: f })} />
            </div>
            {err && <div className="error">{err}</div>}
            <div className="form-actions">
              <button className="btn" disabled={busy}>{busy ? "جاري الرفع..." : "إرسال طلب التوثيق المتقدم"}</button>
              <button type="button" className="btn ghost" onClick={() => setUpgradeOpen(false)}>رجوع</button>
            </div>
          </form>
        )}

        {status !== "verified" && status !== "submitted" && (
          <form className="form" onSubmit={submit}>
            <div className="form-grid">
              <label className="field">
                <span>الاسم الكامل كما في الهوية</span>
                <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </label>
              <label className="field">
                <span>الرقم الوطني / رقم الهوية</span>
                <input required value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
              </label>
              <label className="field">
                <span>رقم الهاتف</span>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label className="field">
                <span>العنوان</span>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label className="field">
                <span>الدولة</span>
                <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                  <option value="SY">سوريا</option>
                  <option value="OTHER">أخرى</option>
                </select>
              </label>
              <label className="field">
                <span>نوع الوثيقة</span>
                <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
                  <option value="id">بطاقة هوية</option>
                  <option value="passport">جواز سفر</option>
                  <option value="license">رخصة</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>مستوى التوثيق</span>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="basic">أساسي — تداول عادي</option>
                <option value="advanced">متقدم — مبالغ كبيرة + إثبات سكن</option>
              </select>
            </label>
            <div className="kyc-uploads">
              <KycFileField label="وجه الهوية *" hint="صورة واضحة للجهة الأمامية" file={files.id_front} onPick={(f) => setFiles({ ...files, id_front: f })} />
              <KycFileField label="ظهر الهوية *" hint="الجهة الخلفية أو صفحة الجواز الثانية" file={files.id_back} onPick={(f) => setFiles({ ...files, id_back: f })} />
              <KycFileField label="صورة شخصية مع الوثيقة *" hint="أمسك الهوية بجانب وجهك" file={files.selfie} onPick={(f) => setFiles({ ...files, selfie: f })} />
              {level === "advanced" && (
                <KycFileField label="إثبات السكن *" hint="فاتورة كهرباء أو عقد سكن باسمك" file={files.residence} onPick={(f) => setFiles({ ...files, residence: f })} />
              )}
              <KycFileField label="مستند إضافي" hint="اختياري" file={files.extra} onPick={(f) => setFiles({ ...files, extra: f })} />
            </div>
            {err && <div className="error">{err}</div>}
            <button className="btn block" disabled={busy}>{busy ? "جاري الرفع..." : "إرسال ملف التوثيق"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function AdminPage() {
  const { user } = useAuth();
  const { reload } = useMeta();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") || "overview");
  const [overview, setOverview] = useState({});
  const [users, setUsers] = useState([]);
  const [kycs, setKycs] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ads, setAds] = useState([]);
  const [catalog, setCatalog] = useState({ assets: [], fiats: [], paymentTypes: [], settings: {} });
  const [settings, setSettings] = useState({});
  const [err, setErr] = useState("");
  const [assetForm, setAssetForm] = useState({ symbol: "", name: "", decimals: "18", contract: "" });
  const [fiatForm, setFiatForm] = useState({ code: "", name: "", symbol: "" });
  const [payForm, setPayForm] = useState({ id: "", name: "", fields: "account,name" });
  const [kycOpen, setKycOpen] = useState(null);
  const [kycNote, setKycNote] = useState("");
  const [wdTx, setWdTx] = useState({});
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [adminWallets, setAdminWallets] = useState([]);
  const [walletUsers, setWalletUsers] = useState([]);
  const [walletAdj, setWalletAdj] = useState({ userId: "", asset: "USDT", amount: "", note: "" });
  const [walletFilter, setWalletFilter] = useState("");
  const [tempPass, setTempPass] = useState(null);
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportOpen, setSupportOpen] = useState(null);
  const [supportReply, setSupportReply] = useState("");
  const [supportFilter, setSupportFilter] = useState("open");
  const [merchantView, setMerchantView] = useState("list");
  const [merchantOpen, setMerchantOpen] = useState(null);
  const [userOpen, setUserOpen] = useState(null);
  const [userFilter, setUserFilter] = useState("");
  const [userListFilter, setUserListFilter] = useState("all");
  const [settingsSection, setSettingsSection] = useState("platform");
  const [kycView, setKycView] = useState("verified");
  const [treasuryForm, setTreasuryForm] = useState({ name: "", platform: "", address: "", note: "" });
  const [merchantDecisionNote, setMerchantDecisionNote] = useState("");
  const [wdWallet, setWdWallet] = useState({});

  async function loadAll() {
    if (!user?.isAdmin) return;
    const [o, u, k, d, wd, ord, a, c, w, s] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/users"),
      api("/api/admin/kyc"),
      api("/api/admin/deposits"),
      api("/api/admin/withdrawals"),
      api("/api/admin/orders"),
      api("/api/admin/ads"),
      api("/api/admin/catalog"),
      api("/api/admin/wallet"),
      api(`/api/admin/support?status=${encodeURIComponent(supportFilter || "open")}`)
    ]);
    setOverview(o);
    setUsers(u.users);
    setKycs(k.requests);
    setKycOpen((prev) => {
      if (!prev) return null;
      return (k.requests || []).find((x) => x.user && x.user.id === prev.user.id) || prev;
    });
    setDeposits(d.deposits);
    setWithdrawals(wd.withdrawals);
    setOrders(ord.orders);
    setAds(a.ads);
    setCatalog(c);
    setSettings(c.settings || {});
    setAdminWallets(w.wallets || []);
    setWalletUsers(w.users || []);
    setSupportTickets(s.tickets || []);
    setSupportOpen((prev) => {
      if (!prev) return null;
      return (s.tickets || []).find((t) => t.id === prev.id) || null;
    });
    setMerchantOpen((prev) => {
      if (!prev) return null;
      return (u.users || []).find((x) => x.id === prev.id) || null;
    });
    setUserOpen((prev) => {
      if (!prev) return null;
      return (u.users || []).find((x) => x.id === prev.id) || null;
    });
    setWalletAdj((prev) => {
      const next = { ...prev };
      if (!next.userId) next.userId = user?.id || (w.users && w.users[0] && w.users[0].user.id) || "";
      const assets = (w.wallets || []).map((x) => x.asset);
      if (assets.length && !assets.includes(next.asset)) next.asset = assets[0];
      return next;
    });
  }

  useEffect(() => {
    const nextTab = searchParams.get("tab");
    if (nextTab) setTab(nextTab);
    const ticketId = searchParams.get("ticket");
    if (ticketId) setSupportFilter("all");
    const kycUser = searchParams.get("user");
    if (nextTab === "kyc" && kycUser) setKycView("requests");
    if (nextTab === "merchants" && kycUser) setMerchantView("requests");
  }, [searchParams]);

  useEffect(() => {
    loadAll().catch((e) => setErr(e.message));
  }, [user, supportFilter]);
  useAppRefresh(() => loadAll().catch(() => {}));

  useEffect(() => {
    const ticketId = searchParams.get("ticket");
    if (!ticketId || !supportTickets.length) return;
    const found = supportTickets.find((t) => t.id === ticketId);
    if (found) setSupportOpen(found);
  }, [supportTickets, searchParams]);

  useEffect(() => {
    const userId = searchParams.get("user");
    if (!userId) return;
    if (tab === "users" && users.length) {
      const found = users.find((u) => u.id === userId);
      if (found) setUserOpen(found);
    }
    if (tab === "kyc" && kycs.length) {
      const found = kycs.find((k) => k.user && k.user.id === userId);
      if (found) setKycOpen(found);
    }
    if (tab === "merchants" && users.length) {
      const found = users.find((u) => u.id === userId);
      if (found) setMerchantOpen(found);
    }
  }, [tab, users, kycs, searchParams]);

  if (!user) return <TelegramGate message="سجّل الدخول عبر تلغرام للوصول إلى لوحة المدير." />;
  if (!user.isAdmin) return <div className="page narrow">هذه الصفحة للمدير فقط.</div>;

  async function act(path, body) {
    setErr("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body || {}) });
      await loadAll();
      await reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function recover(userId, action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setErr("");
    try {
      const data = await api(`/api/admin/users/${userId}/recovery`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      if (data.tempPassword) {
        setTempPass({ username: data.user?.username, password: data.tempPassword });
      } else {
        setTempPass(null);
      }
      await loadAll();
      await reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  const hubs = [
    ["ops", "التشغيل", "overview", "توثيق وتجار ومستخدمون وصفقات ودعم وإعلانات"],
    ["money", "المال", "wallet", "إيداع وسحب وخزينة وعملات وطرق دفع"],
    ["config", "الإعدادات", "settings", "المنصة والتلغرام والعمولات والأسعار والقواعد"]
  ];
  const opsTabs = [
    ["overview", "نظرة عامة", "overview"],
    ["kyc", "التوثيق", "kyc"],
    ["merchants", "التجار", "merchants"],
    ["users", "المستخدمون", "users"],
    ["support", overview.openSupport ? `الدعم (${overview.openSupport})` : "الدعم", "ticket"],
    ["orders", "الصفقات", "orders"],
    ["ads", "الإعلانات", "ads"]
  ];
  const moneyTabs = [
    ["deposits", "الإيداعات", "deposits"],
    ["withdrawals", "السحوبات", "withdrawals"],
    ["treasury", "المحافظ", "treasury"],
    ["coins", "العملات", "coins"],
    ["payments", "الدفع", "payments"]
  ];
  const hubOf = (id) => (moneyTabs.some((t) => t[0] === id) ? "money" : id === "settings" ? "config" : "ops");
  const hub = hubOf(tab);
  const subTabs = hub === "money" ? moneyTabs : hub === "config" ? [] : opsTabs;
  function goTab(id) {
    setTab(id);
    if (id === "pendingMerchants") setMerchantView("requests");
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="page">
      <PageHead title="لوحة الإدارة" subtitle="ثلاث بوابات لكل الإعدادات والإدارة.">
        <a className="btn ghost sm ico-btn" href={authedUrl("/api/admin/guide.pdf")} target="_blank" rel="noreferrer">
          <Icon name="download" />
          <span>دليل الإدارة PDF</span>
        </a>
      </PageHead>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="admin-hubs">
        {hubs.map(([id, label, icon, hint]) => (
          <button
            key={id}
            type="button"
            className={`admin-hub tone-${id} ${hub === id ? "on" : ""}`}
            onClick={() => goTab(id === "money" ? "deposits" : id === "config" ? "settings" : "overview")}
          >
            <span className="admin-hub-icon"><Icon name={icon} /></span>
            <span className="admin-hub-copy">
              <b>{label}</b>
              <small>{hint}</small>
            </span>
          </button>
        ))}
      </div>
      {subTabs.length > 0 && (
        <div className="admin-tabs">
          {subTabs.map(([id, label, icon]) => (
            <button key={id} type="button" className={`admin-tab tone-${id} ${tab === id ? "on" : ""}`} onClick={() => goTab(id)}>
              <span className="admin-tab-icon"><Icon name={icon} /></span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {tab === "overview" && (
        <div className="stat-grid">
          {[
            ["users", overview.users, "مستخدم", "users", "users"],
            ["pendingKyc", overview.pendingKyc, "توثيق معلّق", "kyc", "kyc"],
            ["pendingMerchants", overview.pendingMerchants, "طلب تاجر", "merchants", "merchants"],
            ["pendingDeposits", overview.pendingDeposits, "إيداع معلّق", "deposits", "deposits"],
            ["pendingWithdrawals", overview.pendingWithdrawals, "سحب معلّق", "withdrawals", "withdrawals"],
            ["disputed", overview.disputed, "نزاع", "orders", "orders"],
            ["openSupport", overview.openSupport || 0, "دعم مفتوح", "support", "ticket"],
            ["activeAds", overview.activeAds, "إعلان نشط", "ads", "ads"],
            ["orders", overview.orders, "صفقات", "orders", "orders"],
            ["frozenAccounts", overview.frozenAccounts, "حساب مجمّد", "users", "lock"],
            ["frozenFunds", overview.frozenFunds, "أموال مجمّدة", "users", "wallet"]
          ].map(([key, value, label, go, icon]) => (
            <button
              key={key}
              type="button"
              className={`stat-card click ${Number(value) > 0 && ["pendingKyc", "pendingMerchants", "pendingDeposits", "pendingWithdrawals", "disputed", "openSupport", "frozenAccounts", "frozenFunds"].includes(key) ? "alert" : ""}`}
              onClick={() => {
                goTab(go);
                if (key === "pendingMerchants") setMerchantView("requests");
                if (key === "pendingKyc") setKycView("requests");
                if (key === "frozenAccounts" || key === "frozenFunds") setUserListFilter("frozen");
                if (key === "users") setUserListFilter("all");
              }}
            >
              <span className="stat-ico"><Icon name={icon} /></span>
              <b>{value || 0}</b>
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {tab === "support" && (
        <div className="split">
          <div className="card">
            <div className="section-title"><h3><Icon name="ticket" /> تذاكر الدعم البشري</h3></div>
            <p className="hint" style={{ marginTop: 0 }}>تصل بعد تجربة المساعد الآلي. يمكنك إغلاق المحادثة أو مسح القديمة.</p>
            <div className="tabs" style={{ marginBottom: 12 }}>
              <TabBtn icon="ticket" label="مفتوحة" on={supportFilter === "open"} onClick={() => setSupportFilter("open")} />
              <TabBtn icon="check" label="مغلقة" on={supportFilter === "closed"} onClick={() => setSupportFilter("closed")} />
              <TabBtn icon="all" label="الكل" on={supportFilter === "all"} onClick={() => setSupportFilter("all")} />
            </div>
            <div className="form-actions" style={{ marginBottom: 10 }}>
              <IcoAction
                className="btn ghost sm"
                icon="close"
                type="button"
                onClick={() => {
                  if (!window.confirm("مسح كل المحادثات المغلقة والقديمة؟ لا يمكن التراجع.")) return;
                  act("/api/admin/support/purge");
                }}
              >
                مسح المحادثات القديمة
              </IcoAction>
            </div>
            {supportTickets.length === 0 && <Empty title="لا توجد تذاكر دعم" />}
            {supportTickets.map((t) => (
              <div
                className="row"
                key={t.id}
                style={{ cursor: "pointer", background: supportOpen?.id === t.id ? "rgba(201,162,39,0.08)" : undefined }}
                onClick={() => { setSupportOpen(t); setSupportReply(""); }}
              >
                <div className="row-main">
                  <div className="row-title">{t.user?.displayName || t.user?.username || "مستخدم"} · {t.subject}</div>
                  <div className="row-sub">{t.lastMessage?.text || ""}</div>
                  <div className="muted small">{t.user?.username} · UID {t.user?.uidCode || "—"}</div>
                </div>
                <span className={`pill ${t.status === "open" ? "gold" : "green"}`}>{t.status === "open" ? "مفتوح" : "مغلق"}</span>
              </div>
            ))}
          </div>
          <div className="card">
            {!supportOpen && <Empty title="اختر تذكرة للرد" />}
            {supportOpen && (
              <>
                <div className="section-title">
                       <h3><Icon name="ticket" /> {supportOpen.user?.username} · UID {supportOpen.user?.uidCode || "—"}</h3>
                  <span className={`pill ${supportOpen.status === "open" ? "gold" : "green"}`}>{supportOpen.status === "open" ? "مفتوح" : "مغلق"}</span>
                </div>
                <div className="chat-log" style={{ maxHeight: 360, minHeight: 180 }}>
                  {(supportOpen.messages || []).map((m) => (
                    <div key={m.id} className={`bubble ${m.from === "admin" ? "me" : ""}`}>
                      <div className="muted small">{m.from === "admin" ? "أنت" : m.from === "bot" ? "المساعد" : supportOpen.user?.username || "المستخدم"}</div>
                      <div>{m.text}</div>
                    </div>
                  ))}
                </div>
                <form
                  className="chat-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await act(`/api/admin/support/${supportOpen.id}/reply`, { text: supportReply });
                    setSupportReply("");
                  }}
                >
                  <input value={supportReply} onChange={(e) => setSupportReply(e.target.value)} placeholder="اكتب الرد..." required disabled={supportOpen.status !== "open"} />
                  {supportOpen.status === "open" && <IcoAction className="btn sm" icon="send" type="submit">رد</IcoAction>}
                  {supportOpen.status === "open" && (
                    <IcoAction
                      className="btn ghost sm"
                      icon="check"
                      type="button"
                      onClick={() => {
                        if (!window.confirm("إغلاق المحادثة عند المستخدم؟")) return;
                        act(`/api/admin/support/${supportOpen.id}/close`);
                      }}
                    >
                      إغلاق
                    </IcoAction>
                  )}
                  <IcoAction
                    className="btn red sm"
                    icon="close"
                    type="button"
                    onClick={() => {
                      if (!window.confirm("حذف هذه المحادثة نهائياً؟")) return;
                      act(`/api/admin/support/${supportOpen.id}/delete`);
                    }}
                  >
                    حذف
                  </IcoAction>
                </form>
                {supportOpen.rating > 0 && <p className="hint">تقييم المستخدم: {supportOpen.rating}/5 {supportOpen.ratingComment ? `· ${supportOpen.ratingComment}` : ""}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "kyc" && (() => {
        const pending = kycs.filter((r) => r.status === "submitted" || r.upgradePending);
        const verified = kycs.filter((r) => r.user?.kycStatus === "verified" && !r.upgradePending);
        const listed = kycView === "requests" ? pending : verified;
        const open = kycOpen
          ? kycs.find((r) => r.user && kycOpen.user && r.user.id === kycOpen.user.id) || kycOpen
          : null;
        const openPending = !!(open && (open.status === "submitted" || open.upgradePending));
        const openVerified = !!(open && open.user?.kycStatus === "verified");
        return (
          <div className="split">
            <div className="card">
              <div className="section-title"><h3><Icon name="kyc" /> التوثيق</h3></div>
              <div className="tabs" style={{ marginBottom: 12 }}>
                <TabBtn icon="check" label="الموثّقون" on={kycView === "verified"} onClick={() => { setKycView("verified"); setKycOpen(null); }} />
                <TabBtn icon="bell" label="الطلبات" extra={pending.length ? ` (${pending.length})` : ""} on={kycView === "requests"} onClick={() => { setKycView("requests"); setKycOpen(null); }} />
              </div>
              {listed.length === 0 && <Empty title={kycView === "requests" ? "لا توجد طلبات توثيق" : "لا يوجد موثّقون بعد"} />}
              {listed.map((r) => (
                <div
                  className={`row click ${open?.user?.id === r.user.id ? "selected" : ""}`}
                  key={r.user.id}
                  onClick={() => { setKycOpen(r); setKycNote(r.kyc?.note || ""); }}
                >
                  <Avatar person={r.user} name={r.kyc?.fullName || r.user.displayName} size="sm" />
                  <div className="row-main">
                    <div className="row-title">{r.kyc?.fullName || r.user.displayName}</div>
                    <div className="row-sub">@{r.user.username} · UID {r.user.uidCode || "—"}</div>
                  </div>
                  <span className={`pill ${r.upgradePending ? "gold" : statusTone(r.status)}`}>
                    {r.upgradePending ? "ترقية" : r.kyc?.level === "advanced" || r.user.kycLevel === "advanced" ? "متقدم" : KYC_STATUS[r.status] || r.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="card">
              {!open && <Empty title={kycView === "requests" ? "اختر طلباً للمراجعة" : "اختر موثّقاً"} />}
              {open && (
                <>
                  <div className="section-title">
                    <div>
                      <h3>{open.kyc?.fullName || open.user.displayName}</h3>
                      <div className="muted small">@{open.user.username} · UID {open.user.uidCode || "—"}</div>
                    </div>
                    <span className={`pill ${openPending ? "gold" : openVerified ? "green" : "red"}`}>
                      {open.upgradePending ? "ترقية معلّقة" : KYC_STATUS[open.user?.kycStatus] || open.status}
                    </span>
                  </div>
                  <div className="profile-grid" style={{ marginTop: 0, marginBottom: 14 }}>
                    <div><span className="muted small">الاسم الكامل</span><b>{open.kyc?.fullName || "—"}</b></div>
                    <div><span className="muted small">رقم الهوية</span><b className="mono">{open.kyc?.nationalId || "—"}</b></div>
                    <div><span className="muted small">المستوى</span><b>{open.kyc?.level === "advanced" || open.user.kycLevel === "advanced" ? "متقدم" : "أساسي"}</b></div>
                    <div><span className="muted small">الوثيقة</span><b>{open.kyc?.documentLabel || open.kyc?.documentType || "—"}</b></div>
                    <div><span className="muted small">الدولة</span><b>{open.kyc?.country || "—"}</b></div>
                    <div><span className="muted small">الهاتف</span><b>{open.kyc?.phone || "—"}</b></div>
                    <div><span className="muted small">العنوان</span><b>{open.kyc?.address || "—"}</b></div>
                    <div><span className="muted small">تلغرام</span><b>{open.user.telegramUsername ? `@${String(open.user.telegramUsername).replace(/^@/, "")}` : open.user.telegramId || "—"}</b></div>
                    <div><span className="muted small">الملفات</span><b>{(open.kyc?.files || []).length}</b></div>
                    <div><span className="muted small">الحساب</span><b>{open.user.accountFrozen ? "مجمّد" : "نشط"}</b></div>
                  </div>
                  {open.kyc?.note && <p className="hint">{open.kyc.note}</p>}
                  <div className="kyc-gallery">
                    {(open.kyc?.files || []).map((f) => (
                      <figure key={f.id}>
                        {String(f.mime || "").startsWith("image/") ? (
                          <a href={authedUrl(f.url)} target="_blank" rel="noreferrer">
                            <img src={authedUrl(f.url)} alt={f.label} />
                          </a>
                        ) : (
                          <a className="btn dark sm" href={authedUrl(f.url)} target="_blank" rel="noreferrer" style={{ margin: 10 }}>فتح {f.name}</a>
                        )}
                        <figcaption>{f.label} — {f.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                  <div className="section-title" style={{ marginTop: 16 }}><h3><Icon name="shield" /> إجراءات المدير</h3></div>
                  <div className="row-actions" style={{ marginBottom: 12 }}>
                    <a className="btn dark sm ico-btn" href={authedUrl(open.printUrl)} target="_blank" rel="noreferrer"><Icon name="print" /><span>طباعة / PDF</span></a>
                    <IcoAction className="btn ghost sm" icon="user" onClick={() => { setTab("users"); setUserOpen(open.user); }}>ملف المستخدم</IcoAction>
                  </div>
                  {openPending && (
                    <div className="form">
                      <textarea rows={3} placeholder="ملاحظة للسجل أو سبب الرفض" value={kycNote} onChange={(e) => setKycNote(e.target.value)} />
                      <div className="form-actions">
                        <IcoAction
                          className="btn green"
                          icon="check"
                          disabled={!(open.kyc?.files || []).length}
                          onClick={async () => {
                            await act(`/api/admin/kyc/${open.user.id}`, { action: "approve", note: kycNote });
                            setKycView("verified");
                          }}
                        >
                          قبول بعد الاطلاع
                        </IcoAction>
                        <IcoAction
                          className="btn red"
                          icon="close"
                          onClick={async () => {
                            await act(`/api/admin/kyc/${open.user.id}`, { action: "reject", note: kycNote || "وثائق غير مكتملة" });
                          }}
                        >
                          رفض
                        </IcoAction>
                      </div>
                    </div>
                  )}
                  {openVerified && !openPending && (
                    <div className="form">
                      <p className="hint" style={{ marginTop: 0 }}>إلغاء التوثيق يعيد الحساب إلى غير موثّق.</p>
                      <textarea rows={2} placeholder="سبب الإلغاء (اختياري)" value={kycNote} onChange={(e) => setKycNote(e.target.value)} />
                      <IcoAction
                        className="btn red sm"
                        icon="close"
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`إلغاء توثيق ${open.user.username}؟`)) return;
                          await act(`/api/admin/kyc/${open.user.id}`, { action: "reject", note: kycNote || "أُلغي التوثيق من الإدارة" });
                          setKycOpen(null);
                        }}
                      >
                        إلغاء التوثيق
                      </IcoAction>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {tab === "merchants" && (() => {
        const approved = users.filter((u) => u.merchantStatus === "approved" || u.isMerchant);
        const pending = users.filter((u) => u.merchantStatus === "pending");
        const open = merchantOpen ? users.find((u) => u.id === merchantOpen.id) || merchantOpen : null;
        return (
          <div className="split">
            <div className="card">
              <div className="section-title"><h3><Icon name="merchants" /> التجار</h3></div>
              <div className="tabs" style={{ marginBottom: 12 }}>
                <TabBtn icon="merchants" label="التجار" on={merchantView === "list"} onClick={() => { setMerchantView("list"); setMerchantOpen(null); }} />
                <TabBtn icon="bell" label="الطلبات" extra={pending.length ? ` (${pending.length})` : ""} on={merchantView === "requests"} onClick={() => { setMerchantView("requests"); setMerchantOpen(null); }} />
              </div>
              {merchantView === "list" && (
                <>
                  {approved.length === 0 && <Empty title="لا يوجد تجار معتمدون بعد" />}
                  {approved.map((u) => (
                    <div
                      className={`row click ${open?.id === u.id ? "selected" : ""}`}
                      key={u.id}
                      onClick={() => setMerchantOpen(u)}
                    >
                      <Avatar person={u} name={u.displayName} size="sm" />
                      <div className="row-main">
                        <div className="row-title">{u.displayName}</div>
                        <div className="row-sub">@{u.username} · UID {u.uidCode || "—"}</div>
                      </div>
                      <span className={`pill ${badgeTone(u.merchantBadge)}`}>{MERCHANT_BADGE[u.merchantBadge] || "جديد"}</span>
                    </div>
                  ))}
                </>
              )}
              {merchantView === "requests" && (
                <>
                  {pending.length === 0 && <Empty title="لا توجد طلبات اعتماد حالياً" />}
                  {pending.map((u) => (
                    <div
                      className={`row click ${open?.id === u.id ? "selected" : ""}`}
                      key={u.id}
                      onClick={() => setMerchantOpen(u)}
                    >
                      <Avatar person={u} name={u.displayName} size="sm" />
                      <div className="row-main">
                        <div className="row-title">{u.merchantShop || u.displayName}</div>
                        <div className="row-sub">@{u.username} · UID {u.uidCode || "—"}</div>
                      </div>
                      <span className="pill gold">طلب</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="card">
              {!open && <Empty title={merchantView === "requests" ? "اختر طلباً للمراجعة" : "اختر تاجراً"} />}
              {open && (
                <>
                  <div className="section-title">
                    <h3>{open.displayName}</h3>
                    <span className={`pill ${open.merchantStatus === "approved" ? "green" : "gold"}`}>
                      {open.merchantStatus === "approved" ? "معتمد" : open.merchantStatus === "pending" ? "قيد المراجعة" : "مرفوض"}
                    </span>
                  </div>
                  <div className="profile-grid" style={{ marginTop: 0, marginBottom: 14 }}>
                    <div><span className="muted small">اسم المستخدم</span><b>@{open.username}</b></div>
                    <div><span className="muted small">UID</span><b className="mono">{open.uidCode || "—"}</b></div>
                    <div><span className="muted small">المتجر</span><b>{open.merchantShop || "—"}</b></div>
                    <div><span className="muted small">التوثيق</span><b>{open.kycStatus === "verified" ? (open.kycLevel === "advanced" ? "متقدم" : "أساسي") : KYC_STATUS[open.kycStatus] || open.kycStatus}</b></div>
                    <div><span className="muted small">صفقات الأسبوع</span><b>{open.weeklyTrades || 0}</b></div>
                    <div><span className="muted small">حجم الأسبوع</span><b>{money(open.weeklyUsdtVolume)} USDT</b></div>
                    <div><span className="muted small">الحجم الكلي</span><b>{money(open.lifetimeUsdtVolume)} USDT</b></div>
                    <div><span className="muted small">صفقات مكتملة</span><b>{open.completedTrades || 0}</b></div>
                    <div><span className="muted small">التقييم</span><b>{open.rating || 100}%</b></div>
                    <div><span className="muted small">تلغرام</span><b>{open.telegramUsername ? `@${String(open.telegramUsername).replace(/^@/, "")}` : "—"}</b></div>
                    <div><span className="muted small">الحساب</span><b>{open.accountFrozen ? "مجمّد" : open.fundsFrozen ? "أموال مجمّدة" : "نشط"}</b></div>
                  </div>
                  {open.merchantNote && <p className="hint">ملاحظة الطلب: {open.merchantNote}</p>}
                  {open.merchantDecisionNote && <p className="hint">آخر ملاحظة إدارية: {open.merchantDecisionNote}</p>}
                  {(open.merchantStatus === "pending" || open.merchantStatus === "rejected") && (
                    <div className="form" style={{ marginBottom: 14 }}>
                      <label className="field">
                        <span>ملاحظة تُرسل للتاجر (إلزامية)</span>
                        <textarea
                          rows={3}
                          placeholder={open.merchantStatus === "pending" ? "سبب الاعتماد أو الرفض..." : "ملاحظة الاعتماد..."}
                          value={merchantDecisionNote}
                          onChange={(e) => setMerchantDecisionNote(e.target.value)}
                        />
                      </label>
                      <div className="form-actions">
                        <IcoAction
                          className="btn green sm"
                          icon="check"
                          type="button"
                          onClick={async () => {
                            const note = String(merchantDecisionNote || "").trim();
                            if (note.length < 3) {
                              setErr("أدخل ملاحظة تُرسل للتاجر عند الاعتماد");
                              return;
                            }
                            await act(`/api/admin/users/${open.id}`, { merchantStatus: "approved", note });
                            setMerchantDecisionNote("");
                            setMerchantView("list");
                          }}
                        >
                          اعتماد وإرسال الملاحظة
                        </IcoAction>
                        {open.merchantStatus === "pending" && (
                          <IcoAction
                            className="btn red sm"
                            icon="close"
                            type="button"
                            onClick={async () => {
                              const note = String(merchantDecisionNote || "").trim();
                              if (note.length < 3) {
                                setErr("أدخل ملاحظة تُرسل للتاجر عند الرفض");
                                return;
                              }
                              await act(`/api/admin/users/${open.id}`, { merchantStatus: "rejected", note });
                              setMerchantDecisionNote("");
                              setMerchantOpen(null);
                            }}
                          >
                            رفض وإرسال الملاحظة
                          </IcoAction>
                        )}
                      </div>
                    </div>
                  )}
                  {open.merchantStatus === "approved" && (
                    <>
                      <div className="section-title"><h3><Icon name="star" /> الشارة</h3>
                        <span className={`pill ${badgeTone(open.merchantBadge)}`}>{MERCHANT_BADGE[open.merchantBadge] || "جديد"}</span>
                      </div>
                      <p className="hint" style={{ marginTop: 0 }}>
                        {open.merchantBadgeOverride && open.merchantBadgeOverride !== "auto" ? "يدوي" : "تلقائي"}
                        {open.merchantBadge === "featured" && open.featuredUntil ? ` · حتى ${new Date(open.featuredUntil).toLocaleString("ar-SY")}` : ""}
                      </p>
                      <select
                        value={open.merchantBadgeOverride || "auto"}
                        onChange={(e) => act(`/api/admin/users/${open.id}`, { merchantBadge: e.target.value, merchantStatus: "approved" })}
                      >
                        <option value="auto">تلقائي ({MERCHANT_BADGE[open.merchantBadge] || "جديد"})</option>
                        <option value="sponsored">تاجر مدعوم</option>
                        <option value="verified">تاجر موثّق</option>
                        <option value="featured">تاجر مميز</option>
                        <option value="regular">تاجر عادي</option>
                        <option value="new">تاجر جديد</option>
                      </select>
                      <div className="row-actions" style={{ marginTop: 10 }}>
                        {[["sponsored", "مدعوم", "star"], ["verified", "موثّق", "shield"], ["featured", "مميز", "crown"], ["regular", "عادي", "merchants"], ["new", "جديد", "plus"]].map(([id, label, icon]) => (
                          <IcoAction
                            key={id}
                            icon={icon}
                            type="button"
                            className={`btn sm ${open.merchantBadgeOverride === id ? "" : "ghost"}`}
                            onClick={() => act(`/api/admin/users/${open.id}`, { merchantBadge: id, merchantStatus: "approved" })}
                          >
                            {label}
                          </IcoAction>
                        ))}
                        <IcoAction icon="refresh" type="button" className={`btn sm ${open.merchantBadgeOverride === "auto" || !open.merchantBadgeOverride ? "" : "ghost"}`} onClick={() => act(`/api/admin/users/${open.id}`, { merchantBadge: "auto" })}>تلقائي</IcoAction>
                        <IcoAction icon="close" type="button" className="btn ghost sm" onClick={() => act(`/api/admin/users/${open.id}`, { merchantStatus: "none" })}>إلغاء التاجر</IcoAction>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {tab === "deposits" && (
        <div className="card">
          <div className="section-title"><h3><Icon name="deposits" /> طلبات الإيداع</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>المستخدم</th><th>المبلغ</th><th>الهاش</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>{d.user?.username}</td>
                    <td>
                      {d.amount} {d.asset}{d.fee > 0 ? ` · صافي ${d.netAmount} (عمولة ${d.fee})` : ""}
                      <div className="muted small">{d.treasuryWalletName || "الخزينة"}{d.treasuryWalletPlatform ? ` · ${d.treasuryWalletPlatform}` : ""}</div>
                    </td>
                    <td className="mono small">{d.txHash}</td>
                    <td>
                      <span className={`pill ${d.status === "credited" ? "green" : d.status === "rejected" ? "red" : "gold"}`}>
                        {d.status === "credited" ? "مقبول" : d.status === "rejected" ? "مرفوض" : "معلّق"}
                      </span>
                    </td>
                    <td>
                      {d.status === "pending" && (
                        <div className="row-actions">
                          <IcoAction className="btn green sm" icon="check" onClick={() => act(`/api/admin/deposits/${d.id}`, { action: "approve" })}>إضافة الرصيد</IcoAction>
                          <IcoAction className="btn red sm" icon="close" onClick={() => act(`/api/admin/deposits/${d.id}`, { action: "reject", note: "لم يظهر التحويل" })}>رفض</IcoAction>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "withdrawals" && (
        <div className="card">
          <div className="section-title"><h3><Icon name="withdrawals" /> طلبات السحب</h3></div>
          <p className="hint" style={{ marginTop: 0 }}>
            عند الموافقة يُخصم المبلغ المحجوز نهائياً. أدخل هاش التحويل (اختياري) لحفظه في السجل.
          </p>
          {withdrawals.length === 0 && <Empty title="لا توجد طلبات سحب" />}
          {withdrawals.map((w) => (
            <div className="row" key={w.id}>
              <div className="row-main">
                <div className="row-title">{w.user?.username} · {money(w.amount, 6)} {w.asset}</div>
                <div className="row-sub mono">{w.toAddress}</div>
                <div className="row-sub">
                  الرسوم {w.fee}{w.feePct ? ` (${w.feePct}%)` : ""} · الإجمالي المحجوز {w.total}
                  {w.txHash ? ` · Tx: ${w.txHash}` : ""}
                </div>
                {(w.treasuryWalletName || w.status === "pending") && (
                  <div className="row-sub">
                    محفظة الإرسال: {w.treasuryWalletName || "تُحدَّد عند التنفيذ"}{w.treasuryWalletPlatform ? ` · ${w.treasuryWalletPlatform}` : ""}
                  </div>
                )}
              </div>
              <div className="row-actions">
                <span className={`pill ${w.status === "completed" ? "green" : w.status === "rejected" ? "red" : "gold"}`}>
                  {WITHDRAW_STATUS[w.status] || w.status}
                </span>
                {w.status === "pending" && (
                  <>
                    <select
                      value={wdWallet[w.id] || ((settings.treasuryWallets || []).find((x) => x.active && x.forWithdraw) || {}).id || ""}
                      onChange={(e) => setWdWallet({ ...wdWallet, [w.id]: e.target.value })}
                      style={{ width: 180, fontSize: 12 }}
                    >
                      {(settings.treasuryWallets || []).filter((x) => x.active !== false && x.forWithdraw !== false).map((x) => (
                        <option key={x.id} value={x.id}>{x.name}{x.platform ? ` · ${x.platform}` : ""}</option>
                      ))}
                    </select>
                    <input
                      className="mono"
                      style={{ width: 220, fontSize: 12 }}
                      placeholder="Tx hash (اختياري)"
                      value={wdTx[w.id] || ""}
                      onChange={(e) => setWdTx({ ...wdTx, [w.id]: e.target.value })}
                    />
                    <IcoAction className="btn green sm" icon="check" onClick={() => act(`/api/admin/withdrawals/${w.id}`, { action: "approve", txHash: wdTx[w.id] || "", treasuryWalletId: wdWallet[w.id] || "" })}>تنفيذ</IcoAction>
                    <IcoAction className="btn red sm" icon="close" onClick={() => act(`/api/admin/withdrawals/${w.id}`, { action: "reject", note: "رفض من الإدارة" })}>رفض وإرجاع</IcoAction>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <div className="card">
          <div className="section-title"><h3><Icon name="orders" /> الصفقات والنزاعات</h3></div>
          <p className="hint" style={{ marginTop: 0 }}>دخول الصفقة يعرض التفاصيل والمحادثة والمرفقات وإثبات الدفع كما يراها الطرفان.</p>
          {orders.length === 0 && <Empty title="لا توجد صفقات" />}
          <div className="table-wrap">
            <table>
              <thead><tr><th>رقم</th><th>الأطراف</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} style={searchParams.get("order") === o.id ? { background: "rgba(201,162,39,0.12)" } : undefined}>
                    <td className="mono">{o.id.slice(-8)}</td>
                    <td>
                      {o.buyerLegalName || o.buyer?.kyc?.fullName || o.buyer?.displayName || o.buyer?.username} / {o.seller?.kyc?.fullName || o.seller?.displayName || o.seller?.username}
                      <div className="muted small">مشتري UID {o.buyer?.uidCode || "—"} · بائع UID {o.seller?.uidCode || "—"}</div>
                    </td>
                    <td>
                      {o.amount} {o.asset}
                      <div className="muted small">{money(o.fiatAmount)} {o.fiat}</div>
                    </td>
                    <td>
                      <span className={`pill ${statusTone(o.status)}`}>{STATUS[o.status] || o.status}</span>
                      {o.disputeReason ? <div className="muted small">{o.disputeReason}</div> : null}
                    </td>
                    <td>
                      <div className="row-actions">
                        <IcoLink className="btn sm" icon="orders" to={`/orders/${o.id}`}>دخول الصفقة</IcoLink>
                        {["paid", "disputed"].includes(o.status) && (
                          <IcoAction className="btn green sm" icon="check" onClick={() => act(`/api/orders/${o.id}/release`)}>إفراج</IcoAction>
                        )}
                        {o.status !== "completed" && o.status !== "cancelled" && (
                          <IcoAction className="btn ghost sm" icon="close" onClick={() => act(`/api/orders/${o.id}/cancel`)}>إلغاء</IcoAction>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "users" && (() => {
        const q = userFilter.trim().toLowerCase();
        const listed = users.filter((u) => {
          if (userListFilter === "frozen" && !u.accountFrozen && !u.fundsFrozen) return false;
          if (userListFilter === "kyc" && u.kycStatus !== "verified") return false;
          if (userListFilter === "merchant" && u.merchantStatus !== "approved" && !u.isMerchant) return false;
          if (!q) return true;
          return [u.displayName, u.username, u.uidCode, u.email, u.telegramUsername].some((v) => String(v || "").toLowerCase().includes(q));
        });
        const open = userOpen ? users.find((u) => u.id === userOpen.id) || userOpen : null;
        const walletRow = open ? walletUsers.find((row) => row.user.id === open.id) : null;
        const kycLabel = open ? (open.kycStatus === "verified" ? (open.kycLevel === "advanced" ? "متقدم" : "أساسي") : KYC_STATUS[open.kycStatus] || open.kycStatus) : "";
        const merchantLabel = open
          ? (open.merchantStatus === "approved" ? "معتمد" : open.merchantStatus === "pending" ? "قيد المراجعة" : open.merchantStatus === "rejected" ? "مرفوض" : "ليس تاجراً")
          : "";
        return (
          <div className="split">
            <div className="card">
              <div className="section-title"><h3><Icon name="users" /> المستخدمون</h3></div>
              <label className="field">
                <span><Icon name="search" /> بحث</span>
                <input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="اسم أو مستخدم أو UID" />
              </label>
              <div className="tabs" style={{ marginBottom: 12 }}>
                <TabBtn icon="all" label="الكل" on={userListFilter === "all"} onClick={() => setUserListFilter("all")} />
                <TabBtn icon="lock" label="مجمّد" on={userListFilter === "frozen"} onClick={() => setUserListFilter("frozen")} />
                <TabBtn icon="kyc" label="موثّق" on={userListFilter === "kyc"} onClick={() => setUserListFilter("kyc")} />
                <TabBtn icon="merchants" label="تاجر" on={userListFilter === "merchant"} onClick={() => setUserListFilter("merchant")} />
              </div>
              {listed.length === 0 && <Empty title="لا يوجد مستخدمون في هذا التصفية" />}
              {listed.map((u) => (
                <div
                  className={`row click ${open?.id === u.id ? "selected" : ""}`}
                  key={u.id}
                  onClick={() => { setUserOpen(u); setTempPass(null); }}
                >
                  <Avatar person={u} name={u.displayName} size="sm" />
                  <div className="row-main">
                    <div className="row-title">{u.displayName}</div>
                    <div className="row-sub">@{u.username} · UID {u.uidCode || "—"}</div>
                  </div>
                  {u.accountFrozen || u.fundsFrozen ? (
                    <span className="pill red">{u.accountFrozen ? "مجمّد" : "أموال"}</span>
                  ) : u.isAdmin ? (
                    <span className="pill green">مدير</span>
                  ) : u.merchantStatus === "approved" ? (
                    <span className={`pill ${badgeTone(u.merchantBadge)}`}>{MERCHANT_BADGE[u.merchantBadge] || "تاجر"}</span>
                  ) : u.kycStatus === "verified" ? (
                    <span className="pill green">موثّق</span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="card">
              {!open && <Empty title="اختر مستخدماً لفتح ملفه" />}
              {open && (
                <>
                  <div className="section-title">
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <Avatar person={open} name={open.displayName} />
                      <div>
                        <h3 style={{ margin: 0 }}>{open.displayName}</h3>
                        <div className="muted small">@{open.username}</div>
                      </div>
                    </div>
                    <span className={`pill ${open.accountFrozen ? "red" : open.kycStatus === "verified" ? "green" : "gold"}`}>
                      {open.accountFrozen ? "حساب مجمّد" : open.isAdmin ? "مدير" : kycLabel}
                    </span>
                  </div>
                  {tempPass && tempPass.username === open.username && (
                    <div className="notice" style={{ marginBottom: 12 }}>
                      كلمة مرور مؤقتة: <span className="mono">{tempPass.password}</span>
                      <div className="row-actions" style={{ marginTop: 8 }}>
                        <IcoAction className="btn ghost sm" icon="copy" type="button" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(tempPass.password); }}>نسخ</IcoAction>
                        <IcoAction className="btn ghost sm" icon="close" type="button" onClick={() => setTempPass(null)}>إخفاء</IcoAction>
                      </div>
                      <div className="muted small">سلّمها عبر دعم تلغرام بعد التحقق ثم اطلب تغييرها.</div>
                    </div>
                  )}
                  <div className="profile-grid" style={{ marginTop: 0, marginBottom: 14 }}>
                    <div><span className="muted small">UID</span><b className="mono">{open.uidCode || "—"}</b></div>
                    <div><span className="muted small">البريد</span><b>{open.email || "—"}</b></div>
                    <div><span className="muted small">تلغرام</span><b>{open.telegramUsername ? `@${String(open.telegramUsername).replace(/^@/, "")}` : "—"}</b></div>
                    <div><span className="muted small">التوثيق</span><b>{kycLabel}</b></div>
                    <div><span className="muted small">التاجر</span><b>{merchantLabel}</b></div>
                    <div><span className="muted small">الشارة</span><b>{open.merchantStatus === "approved" ? (MERCHANT_BADGE[open.merchantBadge] || "جديد") : "—"}</b></div>
                    <div><span className="muted small">صفقات مكتملة</span><b>{open.completedTrades || 0}</b></div>
                    <div><span className="muted small">التقييم</span><b>{open.rating || 100}%</b></div>
                    <div><span className="muted small">حجم الأسبوع</span><b>{money(open.weeklyUsdtVolume)} USDT</b></div>
                    <div><span className="muted small">الحجم الكلي</span><b>{money(open.lifetimeUsdtVolume)} USDT</b></div>
                    <div><span className="muted small">المصادقة</span><b>{open.totpEnabled ? "TOTP مفعّل" : "غير مفعّل"}</b></div>
                    <div><span className="muted small">رمز التحرير</span><b>{open.tradePinLocked ? "مقفل" : open.tradePinSet ? "معيّن" : "غير معيّن"}</b></div>
                    <div><span className="muted small">الحساب</span><b>{open.accountFrozen ? "مجمّد" : "نشط"}</b></div>
                    <div><span className="muted small">الأموال</span><b>{open.fundsFrozen ? "مجمّدة" : "متاحة"}</b></div>
                  </div>
                  {open.freezeReason && <p className="hint">{open.freezeReason}</p>}
                  {walletRow && (
                    <p className="hint" style={{ marginTop: 0 }}>
                      {(walletRow.wallets || []).map((w) => `${w.asset}: متاح ${money(w.available, 6)} / مجمّد ${money(w.frozen, 6)}`).join(" · ") || "لا رصيد"}
                    </p>
                  )}
                  <div className="section-title"><h3><Icon name="merchants" /> التاجر</h3></div>
                  {open.merchantNote && <p className="hint">ملاحظة الطلب: {open.merchantNote}</p>}
                  {open.merchantDecisionNote && <p className="hint">آخر ملاحظة إدارية: {open.merchantDecisionNote}</p>}
                  {open.merchantStatus !== "approved" && (
                    <div className="form" style={{ marginBottom: 14 }}>
                      <label className="field">
                        <span>ملاحظة تُرسل للتاجر (إلزامية)</span>
                        <textarea rows={3} placeholder="سبب الاعتماد أو الرفض..." value={merchantDecisionNote} onChange={(e) => setMerchantDecisionNote(e.target.value)} />
                      </label>
                      <div className="form-actions">
                        <IcoAction
                          className="btn green sm"
                          icon="check"
                          type="button"
                          onClick={async () => {
                            const note = String(merchantDecisionNote || "").trim();
                            if (note.length < 3) {
                              setErr("أدخل ملاحظة تُرسل للتاجر عند الاعتماد");
                              return;
                            }
                            await act(`/api/admin/users/${open.id}`, { merchantStatus: "approved", note });
                            setMerchantDecisionNote("");
                          }}
                        >
                          اعتماد وإرسال الملاحظة
                        </IcoAction>
                        {open.merchantStatus === "pending" && (
                          <IcoAction
                            className="btn red sm"
                            icon="close"
                            type="button"
                            onClick={async () => {
                              const note = String(merchantDecisionNote || "").trim();
                              if (note.length < 3) {
                                setErr("أدخل ملاحظة تُرسل للتاجر عند الرفض");
                                return;
                              }
                              await act(`/api/admin/users/${open.id}`, { merchantStatus: "rejected", note });
                              setMerchantDecisionNote("");
                            }}
                          >
                            رفض وإرسال الملاحظة
                          </IcoAction>
                        )}
                      </div>
                    </div>
                  )}
                  {open.merchantStatus === "approved" && (
                    <div className="row-actions" style={{ marginBottom: 14 }}>
                      <IcoAction className="btn ghost sm" icon="close" onClick={() => act(`/api/admin/users/${open.id}`, { merchantStatus: "none" })}>إلغاء التاجر</IcoAction>
                    </div>
                  )}
                  {open.merchantStatus === "approved" && (
                    <>
                      <select
                        value={open.merchantBadgeOverride || "auto"}
                        onChange={(e) => act(`/api/admin/users/${open.id}`, { merchantBadge: e.target.value })}
                      >
                        <option value="auto">تلقائي ({MERCHANT_BADGE[open.merchantBadge] || "جديد"})</option>
                        <option value="sponsored">تاجر مدعوم</option>
                        <option value="verified">تاجر موثّق</option>
                        <option value="featured">تاجر مميز</option>
                        <option value="regular">تاجر عادي</option>
                        <option value="new">تاجر جديد</option>
                      </select>
                      <div className="row-actions" style={{ marginTop: 10, marginBottom: 14 }}>
                        {[["sponsored", "مدعوم", "star"], ["verified", "موثّق", "shield"], ["featured", "مميز", "crown"], ["regular", "عادي", "merchants"], ["new", "جديد", "plus"]].map(([id, label, icon]) => (
                          <IcoAction key={id} icon={icon} type="button" className={`btn sm ${open.merchantBadgeOverride === id ? "" : "ghost"}`} onClick={() => act(`/api/admin/users/${open.id}`, { merchantBadge: id })}>{label}</IcoAction>
                        ))}
                        <IcoAction icon="refresh" className={`btn sm ${open.merchantBadgeOverride === "auto" || !open.merchantBadgeOverride ? "" : "ghost"}`} type="button" onClick={() => act(`/api/admin/users/${open.id}`, { merchantBadge: "auto" })}>تلقائي</IcoAction>
                      </div>
                    </>
                  )}
                  {!open.isAdmin && (
                    <>
                      <div className="section-title"><h3><Icon name="lock" /> التجميد</h3></div>
                      <div className="row-actions" style={{ marginBottom: 14 }}>
                        <IcoAction
                          className={`btn sm ${open.accountFrozen ? "green" : "red"}`}
                          icon={open.accountFrozen ? "check" : "lock"}
                          onClick={() => act(`/api/admin/users/${open.id}`, { accountFrozen: !open.accountFrozen, freezeReason: open.accountFrozen ? "" : "تم تجميد الحساب من الإدارة" })}
                        >
                          {open.accountFrozen ? "فك الحساب" : "تجميد الحساب"}
                        </IcoAction>
                        <IcoAction
                          className={`btn sm ${open.fundsFrozen ? "green" : "ghost"}`}
                          icon={open.fundsFrozen ? "check" : "wallet"}
                          onClick={() => act(`/api/admin/users/${open.id}`, { fundsFrozen: !open.fundsFrozen, freezeReason: open.fundsFrozen ? "" : "تم تجميد الأموال من الإدارة" })}
                        >
                          {open.fundsFrozen ? "فك الأموال" : "تجميد الأموال"}
                        </IcoAction>
                      </div>
                      <div className="section-title"><h3><Icon name="key" /> استعادة الدخول</h3></div>
                      <p className="hint" style={{ marginTop: 0 }}>بعد التحقق من الهوية عبر تلغرام فقط.</p>
                      <div className="row-actions">
                        <IcoAction className="btn ghost sm" icon="key" onClick={() => recover(open.id, "reset_password", `إنشاء كلمة مرور مؤقتة لـ ${open.username} بعد التحقق من الهوية؟`)}>كلمة مرور مؤقتة</IcoAction>
                        {open.tradePinSet && (
                          <IcoAction className="btn ghost sm" icon="lock" onClick={() => recover(open.id, "clear_pin", `مسح رمز التحرير لـ ${open.username}؟ سيعين رمزاً جديداً بنفسه.`)}>مسح رمز التحرير</IcoAction>
                        )}
                        {open.tradePinLocked && (
                          <IcoAction className="btn green sm" icon="check" onClick={() => recover(open.id, "unlock_pin")}>فك قفل الرمز</IcoAction>
                        )}
                      </div>
                    </>
                  )}
                  <div className="row-actions" style={{ marginTop: 16 }}>
                    <IcoAction className="btn ghost sm" icon="wallet" type="button" onClick={() => { setTab("treasury"); setWalletAdj((prev) => ({ ...prev, userId: open.id })); }}>المحفظة</IcoAction>
                    <IcoAction className="btn ghost sm" icon="orders" type="button" onClick={() => setTab("orders")}>الصفقات</IcoAction>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {tab === "ads" && (
        <div className="card">
          <div className="section-title"><h3><Icon name="ads" /> إعلانات المنصة</h3></div>
          {ads.length === 0 && <Empty title="لا توجد إعلانات" />}
          {ads.map((a) => (
            <div className="row" key={a.id}>
              <div className="row-main">
                <div className="row-title">
                  {a.owner?.username} · {a.side === "SELL" ? "بيع" : "شراء"} {a.asset}/{a.fiat} @ {money(a.price, 2)}
                </div>
                <div className="row-sub">الحد {a.minAmount}-{a.maxAmount} · المتاح {a.available}</div>
                {a.terms && <div className="row-sub">{a.terms}</div>}
                {a.reviewNote && <div className="row-sub">ملاحظة: {a.reviewNote}</div>}
              </div>
              <div className="row-actions">
                <span className={`pill ${statusTone(a.status)}`}>{STATUS[a.status] || a.status}</span>
                {["active", "paused"].includes(a.status) && (
                  <IcoAction className="btn ghost sm" icon={a.status === "active" ? "pause" : "play"} onClick={() => act(`/api/admin/ads/${a.id}/toggle`)}>إيقاف/تشغيل</IcoAction>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "payments" && (
        <div className="card">
          <div className="section-title"><h3><Icon name="payments" /> طرق الدفع في المنصة</h3></div>
          {catalog.paymentTypes.map((p) => (
            <div className="row" key={p.id}>
              <div className="row-main">
                <div className="row-title">{p.name} ({p.id})</div>
                <div className="row-sub">{p.enabled ? "مفعّلة" : "معطّلة"}</div>
              </div>
              <IcoAction className="btn ghost sm" icon={p.enabled ? "pause" : "play"} onClick={() => act(`/api/admin/payment-types/${p.id}`, { enabled: !p.enabled })}>
                {p.enabled ? "إيقاف" : "تفعيل"}
              </IcoAction>
            </div>
          ))}
          <div className="form" style={{ marginTop: 16 }}>
            <div className="form-grid">
              <input placeholder="المعرّف مثل CASH" value={payForm.id} onChange={(e) => setPayForm({ ...payForm, id: e.target.value })} />
              <input placeholder="الاسم" value={payForm.name} onChange={(e) => setPayForm({ ...payForm, name: e.target.value })} />
            </div>
            <input placeholder="الحقول" value={payForm.fields} onChange={(e) => setPayForm({ ...payForm, fields: e.target.value })} />
            <IcoAction className="btn" icon="plus" onClick={() => act("/api/admin/payment-types", payForm)}>إضافة طريقة</IcoAction>
          </div>
        </div>
      )}

      {tab === "coins" && (
        <div className="grid-2">
          <div className="card">
            <div className="section-title"><h3><Icon name="coins" /> العملات الرقمية</h3></div>
            {catalog.assets.map((a) => (
              <div className="row" key={a.symbol}>
                <div className="row-main">
                  <div className="row-title">{a.symbol} · {a.name}</div>
                  <div className="row-sub">{a.enabled ? "مفعّلة" : "متوقفة"} · {a.depositEnabled ? "الإيداع مفعّل" : "الإيداع موقوف"}</div>
                </div>
                <div className="row-actions">
                  <IcoAction className="btn ghost sm" icon={a.enabled ? "pause" : "play"} onClick={() => act(`/api/admin/assets/${a.symbol}`, { enabled: !a.enabled })}>{a.enabled ? "إيقاف" : "تفعيل"}</IcoAction>
                  <IcoAction className="btn ghost sm" icon={a.depositEnabled ? "pause" : "download"} onClick={() => act(`/api/admin/assets/${a.symbol}`, { depositEnabled: !a.depositEnabled })}>{a.depositEnabled ? "إيقاف الإيداع" : "تفعيل الإيداع"}</IcoAction>
                </div>
              </div>
            ))}
            <div className="form" style={{ marginTop: 16 }}>
              <div className="form-grid">
                <input placeholder="الرمز USDT" value={assetForm.symbol} onChange={(e) => setAssetForm({ ...assetForm, symbol: e.target.value })} />
                <input placeholder="الاسم" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} />
              </div>
              <input placeholder="العقد 0x..." value={assetForm.contract} onChange={(e) => setAssetForm({ ...assetForm, contract: e.target.value })} />
              <IcoAction className="btn" icon="plus" onClick={() => act("/api/admin/assets", assetForm)}>إضافة عملة</IcoAction>
            </div>
          </div>
          <div className="card">
            <div className="section-title"><h3><Icon name="fees" /> العملات الورقية</h3></div>
            {catalog.fiats.map((f) => (
              <div className="row" key={f.code}>
                <div className="row-main">
                  <div className="row-title">{f.code} · {f.name}</div>
                  <div className="row-sub">{f.enabled ? "مفعّلة" : "متوقفة"}</div>
                </div>
                <IcoAction className="btn ghost sm" icon={f.enabled ? "pause" : "play"} onClick={() => act(`/api/admin/fiats/${f.code}`, { enabled: !f.enabled })}>{f.enabled ? "إيقاف" : "تفعيل"}</IcoAction>
              </div>
            ))}
            <div className="form" style={{ marginTop: 16 }}>
              <div className="form-grid">
                <input placeholder="الرمز" value={fiatForm.code} onChange={(e) => setFiatForm({ ...fiatForm, code: e.target.value })} />
                <input placeholder="الاسم" value={fiatForm.name} onChange={(e) => setFiatForm({ ...fiatForm, name: e.target.value })} />
              </div>
              <input placeholder="الرمز المختصر" value={fiatForm.symbol} onChange={(e) => setFiatForm({ ...fiatForm, symbol: e.target.value })} />
              <IcoAction className="btn" icon="plus" onClick={() => act("/api/admin/fiats", fiatForm)}>إضافة</IcoAction>
            </div>
          </div>
        </div>
      )}

      {tab === "treasury" && (() => {
        const q = walletFilter.trim().toLowerCase();
        const filtered = walletUsers.filter((row) => {
          if (!q) return true;
          const u = row.user || {};
          return [u.username, u.displayName, u.uidCode, u.email].some((v) => String(v || "").toLowerCase().includes(q));
        });
        const selected = walletUsers.find((row) => row.user.id === walletAdj.userId) || walletUsers.find((row) => row.user.id === user.id);
        const selectedWallets = selected ? selected.wallets : adminWallets;
        return (
          <div className="stack">
            <div className="card" style={{ maxWidth: 720 }}>
              <div className="form">
                <div className="section-title"><h3><Icon name="treasury" /> ترصيد / خصم لأي محفظة</h3></div>
                <p className="hint" style={{ marginTop: 0 }}>يُعدَّل الرصيد المتاح مباشرة دون إيداع أو سحب ظاهر.</p>
                <label className="field">
                  <span>المستخدم</span>
                  <select value={walletAdj.userId || user.id} onChange={(e) => setWalletAdj({ ...walletAdj, userId: e.target.value })}>
                    {walletUsers.map((row) => (
                      <option key={row.user.id} value={row.user.id}>
                        {row.user.displayName} · @{row.user.username} · UID {row.user.uidCode || "—"}{row.user.isAdmin ? " · مدير" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selected && (
                  <div className="row-sub" style={{ marginBottom: 8 }}>
                    {selectedWallets.map((w) => `${w.asset}: متاح ${money(w.available, 6)} / مجمّد ${money(w.frozen, 6)}`).join(" · ")}
                  </div>
                )}
                <label className="field">
                  <span>العملة</span>
                  <select value={walletAdj.asset} onChange={(e) => setWalletAdj({ ...walletAdj, asset: e.target.value })}>
                    {(selectedWallets.length ? selectedWallets : [{ asset: "USDT" }]).map((w) => (
                      <option key={w.asset} value={w.asset}>{w.asset}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>المبلغ</span>
                  <input value={walletAdj.amount} onChange={(e) => setWalletAdj({ ...walletAdj, amount: e.target.value })} inputMode="decimal" placeholder="0.00" />
                </label>
                <label className="field">
                  <span>ملاحظة داخلية (اختياري)</span>
                  <input value={walletAdj.note} onChange={(e) => setWalletAdj({ ...walletAdj, note: e.target.value })} placeholder="سبب التعديل" />
                </label>
                <div className="form-actions">
                  <IcoAction
                    className="btn green"
                    icon="plus"
                    onClick={() => act("/api/admin/wallet", { action: "credit", userId: walletAdj.userId || user.id, asset: walletAdj.asset, amount: walletAdj.amount, note: walletAdj.note })}
                  >
                    إضافة رصيد
                  </IcoAction>
                  <IcoAction
                    className="btn red"
                    icon="minus"
                    onClick={() => act("/api/admin/wallet", { action: "debit", userId: walletAdj.userId || user.id, asset: walletAdj.asset, amount: walletAdj.amount, note: walletAdj.note })}
                  >
                    خصم رصيد
                  </IcoAction>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="section-title"><h3><Icon name="wallet" /> محافظ المستخدمين</h3></div>
              <label className="field">
                <span><Icon name="search" /> بحث</span>
                <input value={walletFilter} onChange={(e) => setWalletFilter(e.target.value)} placeholder="اسم أو UID أو مستخدم" />
              </label>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>المستخدم</th>
                      <th>الرصيد</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.user.id}>
                        <td>
                          {row.user.displayName}
                          <div className="muted small">@{row.user.username} · UID {row.user.uidCode || "—"}{row.user.isAdmin ? " · مدير" : ""}</div>
                        </td>
                        <td>
                          {(row.wallets || []).map((w) => (
                            <div key={w.asset}>{w.asset}: {money(w.available, 6)} {w.frozen > 0 ? `(مجمّد ${money(w.frozen, 6)})` : ""}</div>
                          ))}
                        </td>
                        <td>
                          <IcoAction className="btn ghost sm" icon="wallet" onClick={() => { setWalletAdj({ ...walletAdj, userId: row.user.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>اختيار</IcoAction>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && <Empty title="لا يوجد مستخدمون" />}
            </div>
          </div>
        );
      })()}

      {tab === "settings" && (() => {
        const sections = [
          ["platform", "المنصة والتلغرام", "platform"],
          ["kill", "إيقاف التطبيق", "pause"],
          ["wallet", "الإيداع والسحب", "wallet"],
          ["fees", "العمولات", "fees"],
          ["prices", "أسعار الإعلانات", "prices"],
          ["rules", "قواعد التداول", "rules"],
          ["ladder", "سلم التجار", "ladder"],
          ["danger", "منطقة الخطر", "danger"]
        ];
        function saveSettings() {
          return act("/api/admin/settings", {
            ...settings,
            appEnabled: settings.appEnabled !== false,
            appDisabledMessage: settings.appDisabledMessage || "",
            minDeposit: Number(settings.minDeposit),
            minWithdraw: Number(settings.minWithdraw),
            withdrawFee: Number(settings.withdrawFee),
            bep20Network: "BEP20",
            depositEnabled: settings.depositEnabled !== false,
            withdrawEnabled: settings.withdrawEnabled !== false,
            depositFeePct: Number(settings.depositFeePct),
            withdrawFeePct: Number(settings.withdrawFeePct),
            transferFeePct: Number(settings.transferFeePct),
            advancedKycUsdt: Number(settings.advancedKycUsdt),
            featuredWeeklyTrades: Number(settings.featuredWeeklyTrades),
            featuredHoldDays: Number(settings.featuredHoldDays),
            verifiedMerchantVolumeUsdt: Number(settings.verifiedMerchantVolumeUsdt),
            priceMode: settings.priceMode === "auto" ? "auto" : "manual",
            buySpreadPct: Number(settings.buySpreadPct || 0),
            sellSpreadPct: Number(settings.sellSpreadPct || 0),
            manualBuyPrice: Number(settings.manualBuyPrice || 0),
            manualSellPrice: Number(settings.manualSellPrice || 0),
            priceApiUrl: settings.priceApiUrl || "",
            priceApiKey: !settings.priceApiKey || settings.priceApiKey === "••••••••" ? undefined : settings.priceApiKey,
            priceApiKeyHeader: settings.priceApiKeyHeader || "X-API-Key",
            priceJsonPath: settings.priceJsonPath || "",
            priceRanges: (settings.priceRanges || []).map((r) => ({
              asset: r.asset,
              fiat: r.fiat,
              sellMin: Number(r.sellMin != null ? r.sellMin : r.min),
              sellMax: Number(r.sellMax != null ? r.sellMax : r.max),
              buyMin: Number(r.buyMin != null ? r.buyMin : r.min),
              buyMax: Number(r.buyMax != null ? r.buyMax : r.max)
            }))
          });
        }
        function Toggle({ label, hint, checked, onChange, icon }) {
          return (
            <label className="toggle-row">
              <span className="toggle-copy">
                {icon ? <span className="toggle-ico"><Icon name={icon} /></span> : null}
                <span>
                  <b>{label}</b>
                  {hint ? <small>{hint}</small> : null}
                </span>
              </span>
              <input type="checkbox" checked={checked} onChange={onChange} />
            </label>
          );
        }
        return (
          <div className="settings-wrap">
            <div className="admin-tabs settings-tabs">
              {sections.map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  className={`admin-tab tone-${id} ${settingsSection === id ? "on" : ""}`}
                  onClick={() => setSettingsSection(id)}
                >
                  <span className="admin-tab-icon"><Icon name={icon} /></span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="card">
              {settingsSection === "platform" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="platform" /> المنصة والتلغرام</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>اسم المنصة يظهر في الموقع والتطبيق والبوت. أيقونة أندرويد تتحدث مع نسخة APK الجديدة.</p>
                  <label className="field">
                    <span>اسم المنصة</span>
                    <input value={settings.brand || ""} onChange={(e) => setSettings({ ...settings, brand: e.target.value })} maxLength={40} placeholder="USDT شام" />
                  </label>
                  <label className="field">
                    <span>الوصف المختصر</span>
                    <input value={settings.brandTagline || ""} onChange={(e) => setSettings({ ...settings, brandTagline: e.target.value })} maxLength={60} placeholder="منصة التداول P2P" />
                  </label>
                  <label className="field">
                    <span>اسم البوت (بدون @)</span>
                    <input value={settings.telegramBotUsername || ""} onChange={(e) => setSettings({ ...settings, telegramBotUsername: e.target.value })} placeholder="EntrepreneurMA_bot" />
                  </label>
                  <label className="field">
                    <span>رابط التطبيق المصغّر</span>
                    <input value={settings.webAppUrl || ""} onChange={(e) => setSettings({ ...settings, webAppUrl: e.target.value })} placeholder="https://" />
                  </label>
                  <label className="field">
                    <span>آيدي تلغرام للدعم</span>
                    <input value={settings.supportTelegramId || ""} onChange={(e) => setSettings({ ...settings, supportTelegramId: e.target.value })} placeholder="1441524960" />
                  </label>
                  <label className="field">
                    <span>اسم مستخدم تلغرام للدعم (بدون @)</span>
                    <input value={settings.supportTelegramUsername || ""} onChange={(e) => setSettings({ ...settings, supportTelegramUsername: e.target.value })} placeholder="Entrepreneurma" />
                  </label>
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ</IcoAction>
                  <div className="section-title" style={{ marginTop: 18 }}><h3><Icon name="bot" /> توكن بوت تلغرام</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>
                    الصق التوكن من BotFather ثم احفظ وشغّل البوت. التوكن لا يُعرض كاملاً بعد الحفظ.
                    {settings.telegramBotTokenSet ? ` المحفوظ: ${settings.telegramBotTokenHint || "••••"}` : " لا يوجد توكن محفوظ."}
                    {" · "}
                    {settings.telegramBotRunning ? "البوت يعمل." : "البوت متوقف."}
                  </p>
                  <label className="field">
                    <span>توكن البوت</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={settings.telegramBotToken || ""}
                      onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
                      placeholder={settings.telegramBotTokenSet ? "توكن جديد لاستبداله" : "123456789:AA...."}
                    />
                  </label>
                  <div className="form-actions">
                    <IcoAction
                      className="btn"
                      icon="check"
                      onClick={async () => {
                        await act("/api/admin/bot", { action: "save-token", token: settings.telegramBotToken });
                        setSettings((s) => ({ ...s, telegramBotToken: "" }));
                      }}
                    >
                      حفظ التوكن
                    </IcoAction>
                    <IcoAction
                      className="btn"
                      icon={settings.telegramBotRunning ? "refresh" : "play"}
                      onClick={() => act("/api/admin/bot", { action: settings.telegramBotRunning ? "restart" : "start" })}
                    >
                      {settings.telegramBotRunning ? "إعادة تشغيل البوت" : "تشغيل البوت"}
                    </IcoAction>
                    {settings.telegramBotRunning && (
                      <IcoAction className="btn ghost" icon="pause" onClick={() => act("/api/admin/bot", { action: "stop" })}>
                        إيقاف البوت
                      </IcoAction>
                    )}
                    {settings.telegramBotTokenSet && (
                      <IcoAction
                        className="btn red"
                        icon="close"
                        onClick={() => {
                          if (!window.confirm("حذف التوكن وإيقاف البوت؟")) return;
                          act("/api/admin/bot", { action: "clear-token" });
                        }}
                      >
                        حذف التوكن
                      </IcoAction>
                    )}
                  </div>
                </div>
              )}
              {settingsSection === "kill" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="pause" /> إيقاف الموقع والتطبيق</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>يوقف الموقع وتطبيق أندرويد والبوت عن المستخدمين فوراً. لوحة الإدارة تبقى متاحة. يظهر للمستخدمين نص التنبيه أدناه.</p>
                  <Toggle
                    icon="pause"
                    label="تشغيل المنصة"
                    hint="إيقافه يجمد الموقع وAPK والبوت مع رسالة الصيانة"
                    checked={settings.appEnabled !== false}
                    onChange={(e) => setSettings({ ...settings, appEnabled: e.target.checked })}
                  />
                  <label className="field">
                    <span>رسالة التنبيه للمستخدمين</span>
                    <textarea
                      rows={3}
                      value={settings.appDisabledMessage || ""}
                      onChange={(e) => setSettings({ ...settings, appDisabledMessage: e.target.value })}
                      placeholder="المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً."
                    />
                  </label>
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ حالة التشغيل</IcoAction>
                </div>
              )}
              {settingsSection === "wallet" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="wallet" /> الإيداع والسحب</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>الشبكة ثابتة BEP20. سجّل أكثر من محفظة (اسم + منصة + عنوان). اسم المحفظة يُحفظ مع كل إيداع وسحب.</p>
                  <Toggle icon="deposits" label="تفعيل الإيداع" hint="إيقافه يمنع طلبات الإيداع من الموقع والبوت" checked={settings.depositEnabled !== false} onChange={(e) => setSettings({ ...settings, depositEnabled: e.target.checked })} />
                  <Toggle icon="withdrawals" label="تفعيل السحب" hint="إيقافه يمنع طلبات السحب الخارجي" checked={settings.withdrawEnabled !== false} onChange={(e) => setSettings({ ...settings, withdrawEnabled: e.target.checked })} />
                  <div className="form-grid">
                    <label className="field">
                      <span>الحد الأدنى للإيداع</span>
                      <input value={settings.minDeposit ?? ""} onChange={(e) => setSettings({ ...settings, minDeposit: e.target.value })} inputMode="decimal" />
                    </label>
                    <label className="field">
                      <span>الحد الأدنى للسحب</span>
                      <input value={settings.minWithdraw ?? ""} onChange={(e) => setSettings({ ...settings, minWithdraw: e.target.value })} inputMode="decimal" />
                    </label>
                    <label className="field">
                      <span>رسوم السحب الثابتة</span>
                      <input value={settings.withdrawFee ?? ""} onChange={(e) => setSettings({ ...settings, withdrawFee: e.target.value })} inputMode="decimal" />
                    </label>
                  </div>
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ الحدود</IcoAction>
                  <div className="section-title" style={{ marginTop: 18 }}><h3><Icon name="treasury" /> محافظ الاستقبال والإرسال</h3></div>
                  {!(settings.treasuryWallets || []).length && <Empty title="لا توجد محافظ مسجّلة" text="أضف محفظة باسم ومنصة وعنوان BEP20." />}
                  <div className="price-range-list">
                    {(settings.treasuryWallets || []).map((w) => (
                      <article className={`price-pair ${w.active === false ? "invalid" : ""}`} key={w.id}>
                        <header className="price-pair-head">
                          <div>
                            <div className="price-pair-title"><b>{w.name || "خزينة"}</b></div>
                            <div className="muted small">{w.platform || "بدون منصة"} · BEP20</div>
                          </div>
                          <div className="row-actions">
                            {w.active !== false && w.forDeposit !== false && <span className="pill green">إيداع</span>}
                            {w.active !== false && w.forWithdraw !== false && <span className="pill">سحب</span>}
                            {w.active === false && <span className="pill red">متوقفة</span>}
                          </div>
                        </header>
                        <div className="mono small" style={{ wordBreak: "break-all", marginBottom: 10 }}>{w.address}</div>
                        {w.note && <p className="hint" style={{ marginTop: 0 }}>{w.note}</p>}
                        <div className="row-actions">
                          <IcoAction className="btn ghost sm" icon={w.forDeposit === false ? "check" : "pause"} type="button" onClick={() => act(`/api/admin/treasury-wallets/${w.id}`, { forDeposit: w.forDeposit === false, active: true })}>
                            {w.forDeposit === false ? "تفعيل للإيداع" : "إيقاف الإيداع"}
                          </IcoAction>
                          <IcoAction className="btn ghost sm" icon={w.forWithdraw === false ? "check" : "pause"} type="button" onClick={() => act(`/api/admin/treasury-wallets/${w.id}`, { forWithdraw: w.forWithdraw === false, active: true })}>
                            {w.forWithdraw === false ? "تفعيل للإرسال" : "إيقاف الإرسال"}
                          </IcoAction>
                          <IcoAction className="btn ghost sm" icon={w.active === false ? "play" : "pause"} type="button" onClick={() => act(`/api/admin/treasury-wallets/${w.id}`, { active: w.active === false })}>
                            {w.active === false ? "تشغيل" : "إيقاف"}
                          </IcoAction>
                          <IcoAction className="btn red sm" icon="close" type="button" onClick={() => { if (window.confirm(`حذف محفظة ${w.name}؟`)) act(`/api/admin/treasury-wallets/${w.id}`, { remove: true }); }}>حذف</IcoAction>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="price-pair">
                    <div className="section-title"><h3>تسجيل محفظة</h3></div>
                    <div className="form-grid">
                      <label className="field">
                        <span>اسم المحفظة</span>
                        <input value={treasuryForm.name} onChange={(e) => setTreasuryForm({ ...treasuryForm, name: e.target.value })} placeholder="خزينة Binance 1" />
                      </label>
                      <label className="field">
                        <span>المنصة / المصدر</span>
                        <input value={treasuryForm.platform} onChange={(e) => setTreasuryForm({ ...treasuryForm, platform: e.target.value })} placeholder="Binance / Trust / MetaMask" />
                      </label>
                    </div>
                    <label className="field">
                      <span>عنوان BEP20</span>
                      <input className="mono" value={treasuryForm.address} onChange={(e) => setTreasuryForm({ ...treasuryForm, address: e.target.value })} placeholder="0x..." />
                    </label>
                    <label className="field">
                      <span>ملاحظة داخلية</span>
                      <input value={treasuryForm.note} onChange={(e) => setTreasuryForm({ ...treasuryForm, note: e.target.value })} placeholder="اختياري" />
                    </label>
                    <IcoAction
                      className="btn"
                      icon="plus"
                      type="button"
                      onClick={async () => {
                        const address = String(treasuryForm.address || "").trim();
                        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
                          setErr("عنوان BEP20 غير صالح. يجب أن يبدأ بـ 0x ويتبعه 40 خانة.");
                          return;
                        }
                        await act("/api/admin/treasury-wallets", { ...treasuryForm, address });
                        setTreasuryForm({ name: "", platform: "", address: "", note: "" });
                      }}
                    >
                      إضافة المحفظة
                    </IcoAction>
                  </div>
                </div>
              )}
              {settingsSection === "fees" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="fees" /> العمولات</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>نسب مئوية من 0 إلى 100. عمولة الإيداع عند قبول الطلب، والتحويل من المرسل عبر UID.</p>
                  <div className="form-grid">
                    <label className="field">
                      <span>عمولة الإيداع %</span>
                      <input value={settings.depositFeePct ?? 0} onChange={(e) => setSettings({ ...settings, depositFeePct: e.target.value })} inputMode="decimal" />
                    </label>
                    <label className="field">
                      <span>عمولة السحب %</span>
                      <input value={settings.withdrawFeePct ?? 0} onChange={(e) => setSettings({ ...settings, withdrawFeePct: e.target.value })} inputMode="decimal" />
                    </label>
                    <label className="field">
                      <span>عمولة التحويل الداخلي %</span>
                      <input value={settings.transferFeePct ?? 0} onChange={(e) => setSettings({ ...settings, transferFeePct: e.target.value })} inputMode="decimal" />
                    </label>
                  </div>
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ</IcoAction>
                </div>
              )}
              {settingsSection === "prices" && (
                <div className="form">
                  <div className="section-title">
                    <div>
                      <h3><Icon name="prices" /> وضع التسعير</h3>
                      <p className="hint" style={{ margin: "4px 0 0" }}>تلقائي: USDT = USD = 1 ثم تُطبَّق هوامش البيع/الشراء. أزواج أخرى تحتاج مصدر سعر. اليدوي بأسعار ثابتة. حدود الأمان تمنع تجاوز التقلبات.</p>
                    </div>
                    <span className={`pill ${settings.priceMode === "auto" ? "green" : ""}`}>{settings.priceMode === "auto" ? "تلقائي" : "يدوي"}</span>
                  </div>
                  <Toggle
                    icon="refresh"
                    label="التسعير التلقائي"
                    hint="USDT/USD ثابت على 1 ثم البيع = 1+هامش والشراء = 1−هامش. الليرة تحتاج رابط مصدر إن وُجد."
                    checked={settings.priceMode === "auto"}
                    onChange={(e) => setSettings({ ...settings, priceMode: e.target.checked ? "auto" : "manual" })}
                  />
                  {settings.priceMode === "auto" ? (
                    <>
                      <div className="form-grid">
                        <label className="field">
                          <span>هامش البيع % (يُضاف لسعر السوق)</span>
                          <input value={settings.sellSpreadPct ?? 0} onChange={(e) => setSettings({ ...settings, sellSpreadPct: e.target.value })} inputMode="decimal" />
                        </label>
                        <label className="field">
                          <span>هامش الشراء % (يُخصم من سعر السوق)</span>
                          <input value={settings.buySpreadPct ?? 0} onChange={(e) => setSettings({ ...settings, buySpreadPct: e.target.value })} inputMode="decimal" />
                        </label>
                      </div>
                      <label className="field">
                        <span>رابط مصدر السعر (اختياري)</span>
                        <input value={settings.priceApiUrl || ""} onChange={(e) => setSettings({ ...settings, priceApiUrl: e.target.value })} placeholder="https://...{asset}...{fiat}...{key}" />
                      </label>
                      <div className="form-grid">
                        <label className="field">
                          <span>مفتاح API</span>
                          <input
                            type="password"
                            autoComplete="off"
                            value={settings.priceApiKey || ""}
                            onChange={(e) => setSettings({ ...settings, priceApiKey: e.target.value })}
                            placeholder={settings.priceApiKeySet ? "محفوظ — اتركه أو الصق مفتاحاً جديداً" : "الصق المفتاح هنا"}
                          />
                        </label>
                        <label className="field">
                          <span>ترويسة المفتاح</span>
                          <input value={settings.priceApiKeyHeader || "X-API-Key"} onChange={(e) => setSettings({ ...settings, priceApiKeyHeader: e.target.value })} placeholder="X-API-Key أو Authorization" />
                        </label>
                      </div>
                      <label className="field">
                        <span>مسار السعر في JSON (اختياري)</span>
                        <input value={settings.priceJsonPath || ""} onChange={(e) => setSettings({ ...settings, priceJsonPath: e.target.value })} placeholder="data.price" />
                      </label>
                      <p className="hint">USDT/USD سوقه 1 دائماً. البيع = 1 × (1 + هامش البيع%). الشراء = 1 × (1 − هامش الشراء%). ثم يُقيَّد بحدود الأمان. الليرة تحتاج رابط مصدر سعر.</p>
                    </>
                  ) : (
                    <>
                      <div className="form-grid">
                        <label className="field">
                          <span>سعر البيع اليدوي (USDT)</span>
                          <input value={settings.manualSellPrice ?? ""} onChange={(e) => setSettings({ ...settings, manualSellPrice: e.target.value })} inputMode="decimal" />
                        </label>
                        <label className="field">
                          <span>سعر الشراء اليدوي (USDT)</span>
                          <input value={settings.manualBuyPrice ?? ""} onChange={(e) => setSettings({ ...settings, manualBuyPrice: e.target.value })} inputMode="decimal" />
                        </label>
                      </div>
                      <p className="hint">يتجاوز المصدر الخارجي. الحدود أدناه تبقى سارية على الإعلانات.</p>
                    </>
                  )}
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ التسعير</IcoAction>
                  <AdminPricePreview />
                  <div className="section-title" style={{ marginTop: 18 }}>
                    <div>
                      <h3><Icon name="shield" /> حدود الأمان لكل زوج</h3>
                      <p className="hint" style={{ margin: "4px 0 0" }}>حد بيع وحد شراء منفصلان. إعلانات البيع لا تتجاوز حد البيع، وإعلانات الشراء لا تتجاوز حد الشراء.</p>
                    </div>
                    <span className="pill">{(settings.priceRanges || []).length} زوج</span>
                  </div>
                  {(settings.priceRanges || []).length === 0 && (
                    <Empty title="لا توجد نطاقات" text="أضف زوجاً مثل USDT / SYP لتحديد حد أدنى وأقصى لسعر الإعلان." />
                  )}
                  <div className="price-range-list">
                    {(settings.priceRanges || []).map((r, i) => {
                      const sellMinN = Number(r.sellMin != null ? r.sellMin : r.min);
                      const sellMaxN = Number(r.sellMax != null ? r.sellMax : r.max);
                      const buyMinN = Number(r.buyMin != null ? r.buyMin : r.min);
                      const buyMaxN = Number(r.buyMax != null ? r.buyMax : r.max);
                      const sellOk = !(sellMinN > 0 && sellMaxN > 0 && sellMinN > sellMaxN);
                      const buyOk = !(buyMinN > 0 && buyMaxN > 0 && buyMinN > buyMaxN);
                      const valid = sellOk && buyOk;
                      const assets = catalog.assets.length ? catalog.assets : [{ symbol: "USDT", name: "Tether" }];
                      const fiats = catalog.fiats.length ? catalog.fiats : [{ code: "SYP", name: "ليرة سورية" }];
                      function patch(part) {
                        const next = [...(settings.priceRanges || [])];
                        next[i] = { ...next[i], ...part };
                        setSettings({ ...settings, priceRanges: next });
                      }
                      return (
                        <article className={`price-pair ${valid ? "" : "invalid"}`} key={`${r.asset}-${r.fiat}-${i}`}>
                          <header className="price-pair-head">
                            <div className="price-pair-title">
                              <b className="mono">{r.asset || "USDT"}</b>
                              <span>/</span>
                              <b className="mono">{r.fiat || "SYP"}</b>
                            </div>
                            <IcoAction
                              type="button"
                              className="btn ghost sm"
                              icon="close"
                              onClick={() => setSettings({ ...settings, priceRanges: (settings.priceRanges || []).filter((_, j) => j !== i) })}
                            >
                              حذف
                            </IcoAction>
                          </header>
                          <div className="price-pair-grid">
                            <label className="field">
                              <span>العملة</span>
                              <select value={r.asset} onChange={(e) => patch({ asset: e.target.value })}>
                                {assets.map((a) => (
                                  <option key={a.symbol} value={a.symbol}>{a.symbol}{a.name ? ` · ${a.name}` : ""}</option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span>الفيات</span>
                              <select value={r.fiat} onChange={(e) => patch({ fiat: e.target.value })}>
                                {fiats.map((f) => (
                                  <option key={f.code} value={f.code}>{f.code}{f.name ? ` · ${f.name}` : ""}</option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span>حد البيع الأدنى</span>
                              <input value={r.sellMin ?? r.min ?? ""} onChange={(e) => patch({ sellMin: e.target.value })} inputMode="decimal" placeholder="1.05" />
                            </label>
                            <label className="field">
                              <span>حد البيع الأقصى</span>
                              <input value={r.sellMax ?? r.max ?? ""} onChange={(e) => patch({ sellMax: e.target.value })} inputMode="decimal" placeholder="1.15" />
                            </label>
                            <label className="field">
                              <span>حد الشراء الأدنى</span>
                              <input value={r.buyMin ?? r.min ?? ""} onChange={(e) => patch({ buyMin: e.target.value })} inputMode="decimal" placeholder="0.85" />
                            </label>
                            <label className="field">
                              <span>حد الشراء الأقصى</span>
                              <input value={r.buyMax ?? r.max ?? ""} onChange={(e) => patch({ buyMax: e.target.value })} inputMode="decimal" placeholder="0.95" />
                            </label>
                          </div>
                          <footer className="price-pair-foot">
                            {valid
                              ? <span>بيع {money(sellMinN, 4)}–{money(sellMaxN, 4)} · شراء {money(buyMinN, 4)}–{money(buyMaxN, 4)} {r.fiat}</span>
                              : <span className="warn">حد البيع أو الشراء: الأدنى أكبر من الأقصى</span>}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                  <div className="form-actions">
                    <IcoAction
                      type="button"
                      className="btn dark sm"
                      icon="plus"
                      onClick={() => {
                        const used = new Set((settings.priceRanges || []).map((x) => `${x.asset}/${x.fiat}`));
                        const assets = catalog.assets.length ? catalog.assets : [{ symbol: "USDT" }];
                        const fiats = catalog.fiats.length ? catalog.fiats : [{ code: "SYP" }, { code: "USD" }];
                        let asset = "USDT";
                        let fiat = "SYP";
                        for (const a of assets) {
                          for (const f of fiats) {
                            if (!used.has(`${a.symbol}/${f.code}`)) {
                              asset = a.symbol;
                              fiat = f.code;
                              break;
                            }
                          }
                        }
                        setSettings({
                          ...settings,
                          priceRanges: [...(settings.priceRanges || []), { asset, fiat, sellMin: "", sellMax: "", buyMin: "", buyMax: "" }]
                        });
                      }}
                    >
                      إضافة زوج
                    </IcoAction>
                    <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ النطاقات</IcoAction>
                  </div>
                </div>
              )}
              {settingsSection === "rules" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="rules" /> قواعد التداول</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>شروط التوثيق والإعلانات وإثبات الدفع.</p>
                  <Toggle icon="orders" label="KYC للتداول" hint="لا صفقة قبل توثيق أساسي" checked={!!settings.requireKycForTrade} onChange={(e) => setSettings({ ...settings, requireKycForTrade: e.target.checked })} />
                  <Toggle icon="ads" label="KYC لنشر الإعلان" hint="لا إعلان قبل توثيق أساسي" checked={!!settings.requireKycForAd} onChange={(e) => setSettings({ ...settings, requireKycForAd: e.target.checked })} />
                  <Toggle icon="deposits" label="KYC للإيداع" hint="لا إيداع قبل توثيق" checked={!!settings.requireKycForDeposit} onChange={(e) => setSettings({ ...settings, requireKycForDeposit: e.target.checked })} />
                  <Toggle icon="withdrawals" label="KYC للسحب" hint="لا سحب قبل توثيق" checked={settings.requireKycForWithdraw !== false} onChange={(e) => setSettings({ ...settings, requireKycForWithdraw: e.target.checked })} />
                  <Toggle icon="merchants" label="الإعلانات للتجار المعتمدين فقط" hint="نشر الإعلان بعد اعتماد التاجر" checked={settings.requireMerchantForAd !== false} onChange={(e) => setSettings({ ...settings, requireMerchantForAd: e.target.checked })} />
                  <Toggle icon="camera" label="إثبات الدفع إلزامي" hint="صورة إيصال قبل «أكدت الدفع»" checked={settings.requirePaymentProof !== false} onChange={(e) => setSettings({ ...settings, requirePaymentProof: e.target.checked })} />
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ</IcoAction>
                </div>
              )}
              {settingsSection === "ladder" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="ladder" /> سلم التجار</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>حدود الترقية التلقائية. المميز شارة واحدة لمدة محددة، والموثّق عند حجم كافٍ مع توثيق متقدم.</p>
                  <div className="form-grid">
                    <label className="field">
                      <span>حد التوثيق المتقدم (USDT)</span>
                      <input type="number" value={settings.advancedKycUsdt ?? 2000} onChange={(e) => setSettings({ ...settings, advancedKycUsdt: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>صفقات الأسبوع للتاجر المميز</span>
                      <input type="number" value={settings.featuredWeeklyTrades ?? 50} onChange={(e) => setSettings({ ...settings, featuredWeeklyTrades: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>مدة شارة المميز (أيام)</span>
                      <input type="number" value={settings.featuredHoldDays ?? 3} onChange={(e) => setSettings({ ...settings, featuredHoldDays: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>حجم التاجر الموثّق (USDT)</span>
                      <input type="number" value={settings.verifiedMerchantVolumeUsdt ?? 1500} onChange={(e) => setSettings({ ...settings, verifiedMerchantVolumeUsdt: e.target.value })} />
                    </label>
                  </div>
                  <IcoAction className="btn" icon="check" onClick={saveSettings}>حفظ</IcoAction>
                </div>
              )}
              {settingsSection === "danger" && (
                <div className="form">
                  <div className="section-title"><h3><Icon name="danger" /> منطقة الخطر</h3></div>
                  <p className="hint" style={{ marginTop: 0 }}>يحذف كل المستخدمين والإعلانات والصفقات والمحافظ وطرق الدفع وملفات التوثيق. يبقى حسابك فقط كمدير، وتعود أرقام الإعلانات للصفر.</p>
                  <label className="field">
                    <span>للتأكيد اكتب: مسح الكل</span>
                    <input value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="مسح الكل" />
                  </label>
                  <IcoAction
                    className="btn red"
                    icon="close"
                    disabled={resetBusy || resetConfirm !== "مسح الكل"}
                    onClick={async () => {
                      if (!window.confirm("سيتم حذف كل المستخدمين والبيانات ولا يمكن التراجع. المتابعة؟")) return;
                      setResetBusy(true);
                      setErr("");
                      try {
                        await api("/api/admin/reset", { method: "POST", body: JSON.stringify({ confirm: "مسح الكل" }) });
                        setResetConfirm("");
                        await loadAll();
                        await reload();
                      } catch (e) {
                        setErr(e.message);
                      } finally {
                        setResetBusy(false);
                      }
                    }}
                  >
                    {resetBusy ? "جاري المسح..." : "مسح كل البيانات"}
                  </IcoAction>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function TotpPanel({ user, refresh }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function startSetup() {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      const d = await api("/api/me/totp/setup", { method: "POST" });
      setSetup(d);
      setCode("");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await api("/api/me/totp/enable", { method: "POST", body: JSON.stringify({ code }) });
      setSetup(null);
      setCode("");
      setOk("تم تفعيل تطبيق المصادقة.");
      if (refresh) await refresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await api("/api/me/totp/disable", { method: "POST", body: JSON.stringify({ code, password }) });
      setCode("");
      setPassword("");
      setOk("تم إيقاف تطبيق المصادقة.");
      if (refresh) await refresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-tab-body">
      <div className="section-title">
        <h3>تطبيق المصادقة</h3>
        <span className={`pill ${user.totpEnabled ? "green" : ""}`}>{user.totpEnabled ? "مفعّل" : "غير مفعّل"}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        اربط Google Authenticator أو Authy. الرمز يُطلب عند كل سحب، وبعد الدخول مرة واحدة يومياً لتأكيد هويتك قبل استخدام السوق.
      </p>
      {err && <div className="error">{err}</div>}
      {ok && <div className="notice">{ok}</div>}
      {!user.totpEnabled && !setup && (
        <div className="form-actions">
          <button className="btn" disabled={busy} onClick={startSetup}>{busy ? "جاري الإنشاء..." : "ربط تطبيق المصادقة"}</button>
        </div>
      )}
      {setup && (
        <div className="stack" style={{ marginTop: 8 }}>
          {setup.otpauth && (
            <div className="totp-qr">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&ecc=M&data=${encodeURIComponent(setup.otpauth)}`}
                alt="QR تطبيق المصادقة"
                width="180"
                height="180"
              />
              <a className="btn ghost sm" href={setup.otpauth}>فتح في تطبيق المصادقة</a>
            </div>
          )}
          <div className="address-box">
            <span className="label">المفتاح السري</span>
            <code>{setup.secretGrouped || setup.secret}</code>
            <button
              className="btn dark sm"
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(setup.secret);
                setCopied(true);
              }}
            >
              {copied ? "تم النسخ" : "نسخ المفتاح"}
            </button>
          </div>
          <p className="hint">امسح الرمز أو أضف الحساب يدوياً: TOTP، 6 أرقام، كل 30 ثانية، SHA1. ثم أدخل الرمز الحالي.</p>
          <label className="field">
            <span>أدخل الرمز الحالي من التطبيق</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} />
          </label>
          <div className="form-actions">
            <button className="btn" disabled={busy || code.replace(/\D/g, "").length < 6} onClick={enable}>{busy ? "جاري التحقق..." : "تأكيد التفعيل"}</button>
            <button className="btn ghost" type="button" onClick={() => { setSetup(null); setCode(""); }}>إلغاء</button>
          </div>
        </div>
      )}
      {user.totpEnabled && (
        <form className="form" style={{ marginTop: 8 }} onSubmit={disable}>
          <label className="field">
            <span>رمز التطبيق أو كلمة المرور لإيقاف الحماية</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="رمز 6 أرقام" />
          </label>
          <label className="field">
            <span>كلمة المرور</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="btn ghost" disabled={busy}>{busy ? "جاري الإيقاف..." : "إيقاف تطبيق المصادقة"}</button>
        </form>
      )}
    </div>
  );
}

function PasswordPanel({ refresh }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (newPassword !== confirm) {
      setErr("كلمتا المرور غير متطابقتين.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setOk("تم تغيير كلمة المرور.");
      if (refresh) await refresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-tab-body">
      <div className="section-title">
        <h3>كلمة المرور</h3>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        غيّر كلمة المرور بعد استلام كلمة مؤقتة من الدعم. إن نسيتها تواصل مع الدعم عبر تلغرام بعد التحقق من الهوية.
      </p>
      {err && <div className="error">{err}</div>}
      {ok && <div className="notice">{ok}</div>}
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>كلمة المرور الحالية</span>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>كلمة المرور الجديدة</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
        </label>
        <label className="field">
          <span>تأكيد الجديدة</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={6} required />
        </label>
        <button className="btn" disabled={busy}>{busy ? "جاري الحفظ..." : "تغيير كلمة المرور"}</button>
      </form>
    </div>
  );
}

function pinDigits(value) {
  const map = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
  return String(value || "").replace(/[٠-٩۰-۹]/g, (c) => map[c] || c).replace(/\D/g, "").slice(0, 6);
}

function TradePinPanel({ user, refresh }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const set = !!user.tradePinSet;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (pin !== confirm) {
      setErr("الرمزان غير متطابقين.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/me/trade-pin", {
        method: "POST",
        body: JSON.stringify({ pin, currentPin: set ? currentPin : undefined, password: set ? password : undefined })
      });
      setPin("");
      setConfirm("");
      setCurrentPin("");
      setPassword("");
      setOk(set ? "تم تغيير رمز التحرير." : "تم تعيين رمز التحرير. يُطلب عند الإفراج والسحب والتحويل.");
      if (refresh) await refresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-tab-body">
      <div className="section-title">
        <h3>رمز تحرير العملة</h3>
        <span className={`pill ${set ? "green" : "gold"}`}>{set ? "معيّن" : "غير معيّن"}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        رمز من 6 أرقام مختلف عن تطبيق المصادقة. يحمي الإفراج والسحب والتحويل إذا فُتح الجوال دون علمك. لا تستخدم 000000 أو تكرار رقم واحد.
      </p>
      {err && <div className="error">{err}</div>}
      {ok && <div className="notice">{ok}</div>}
      <form className="form" onSubmit={submit}>
        {set && (
          <>
            <label className="field">
              <span>الرمز الحالي</span>
              <input className="pin-input" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={currentPin} onChange={(e) => setCurrentPin(pinDigits(e.target.value))} placeholder="••••••" />
            </label>
            <label className="field">
              <span>كلمة المرور (بديل عن الرمز الحالي)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          </>
        )}
        <div className="form-grid pin-grid">
          <label className="field">
            <span>{set ? "الرمز الجديد" : "رمز التحرير"}</span>
            <input className="pin-input" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(e) => setPin(pinDigits(e.target.value))} placeholder="••••••" required />
          </label>
          <label className="field">
            <span>تأكيد الرمز</span>
            <input className="pin-input" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={confirm} onChange={(e) => setConfirm(pinDigits(e.target.value))} placeholder="••••••" required />
          </label>
        </div>
        <button className="btn" disabled={busy}>{busy ? "جاري الحفظ..." : set ? "تغيير رمز التحرير" : "تعيين رمز التحرير"}</button>
      </form>
    </div>
  );
}

function AppLockPanel() {
  const lock = readLock();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const enabled = lock.enabled;
  const bioOn = !!(lock.enabled && lock.bio);
  const canBio = biometricSupported();

  async function savePin(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (pin !== confirm) {
      setErr("الرمزان غير متطابقين.");
      return;
    }
    if (!isValidLockPin(pin)) {
      setErr("رمز القفل يجب أن يكون 4 إلى 6 أرقام وغير مكرر.");
      return;
    }
    setBusy(true);
    try {
      await setLockPin(pin);
      setPin("");
      setConfirm("");
      setOk(enabled ? "تم تغيير رمز قفل التطبيق." : "تم تفعيل قفل التطبيق على هذا الجهاز.");
      setTick((n) => n + 1);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setErr("");
    setOk("");
    disableLock();
    setOk("أُلغي قفل التطبيق على هذا الجهاز.");
    setTick((n) => n + 1);
  }

  async function toggleBio() {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      if (bioOn) {
        await disableBiometric();
        setOk("أُلغيت البصمة. يُفتح القفل برمز PIN فقط.");
      } else {
        await registerBiometric();
        setOk("تم تفعيل البصمة أو الوجه على هذا الجهاز.");
      }
      setTick((n) => n + 1);
    } catch (ex) {
      setErr(ex.message || "تعذر تفعيل البصمة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-tab-body" key={tick}>
      <div className="section-title">
        <h3>قفل التطبيق</h3>
        <span className={`pill ${enabled ? "green" : "gold"}`}>{enabled ? "مفعّل" : "غير مفعّل"}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        يحمي فتح التطبيق على هذا الجهاز برمز PIN أو البصمة. لا يُرسل الرمز إلى الخادم ويبقى محلياً. يُطلب بعد إغلاق التطبيق أو تبديل النافذة.
      </p>
      {err && <div className="error">{err}</div>}
      {ok && <div className="notice">{ok}</div>}
      <form className="form" onSubmit={savePin}>
        <div className="form-grid pin-grid">
          <label className="field">
            <span>{enabled ? "رمز القفل الجديد" : "رمز القفل"}</span>
            <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(lockPinDigits(e.target.value))} placeholder="••••" required />
          </label>
          <label className="field">
            <span>تأكيد الرمز</span>
            <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={confirm} onChange={(e) => setConfirm(lockPinDigits(e.target.value))} placeholder="••••" required />
          </label>
        </div>
        <button className="btn" disabled={busy}>{busy ? "جاري الحفظ..." : enabled ? "تغيير رمز القفل" : "تفعيل قفل PIN"}</button>
      </form>
      {enabled && (
        <div className="form-actions" style={{ marginTop: 12 }}>
          {canBio && (
            <IcoAction className={bioOn ? "btn dark" : "btn"} icon="shield" disabled={busy} onClick={toggleBio}>
              {bioOn ? "إيقاف البصمة" : "تفعيل البصمة / الوجه"}
            </IcoAction>
          )}
          <IcoAction className="btn ghost" icon="close" onClick={turnOff}>إلغاء القفل</IcoAction>
        </div>
      )}
      {!canBio && enabled && <p className="hint">هذا المتصفح لا يدعم البصمة. استخدم رمز PIN.</p>}
    </div>
  );
}

function BotPage() {
  const { user, logout, refresh } = useAuth();
  const meta = useMeta();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [saveMsg, setSaveMsg] = useState("");
  const [secTab, setSecTab] = useState("name");
  const [safeTab, setSafeTab] = useState("pin");
  const [deleteText, setDeleteText] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const botUser = meta.settings?.telegramBotUsername || "EntrepreneurMA_bot";

  useEffect(() => {
    if (!user) nav("/gate");
    else setDisplayName(user.displayName || "");
  }, [user, nav]);

  async function link() {
    const d = await api("/api/telegram/link", { method: "POST" });
    setCode(d.code);
  }

  async function saveName(e) {
    e.preventDefault();
    setSaveMsg("");
    try {
      await api("/api/me", { method: "PUT", body: JSON.stringify({ displayName }) });
      if (refresh) await refresh();
      setSaveMsg("تم حفظ الاسم. يمكن تغييره مرة كل 60 يوماً.");
    } catch (ex) {
      setSaveMsg(ex.message);
    }
  }

  const nameLocked = user && user.canChangeDisplayName === false;
  const nameUnlock = user && user.nextDisplayNameChangeAt
    ? new Date(user.nextDisplayNameChangeAt).toLocaleDateString("ar-SY")
    : "";

  if (!user) return <div className="page narrow">جاري التحميل...</div>;

  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString("ar-SY") : "—";
  const kycLabel = user.kycStatus === "verified"
    ? (user.kycLevel === "advanced" ? "موثّق متقدم" : "موثّق")
    : user.kycStatus === "submitted" ? "قيد التوثيق" : user.kycStatus === "rejected" ? "مرفوض" : "غير موثّق";
  const merchLabel = user.merchantStatus === "approved"
    ? (MERCHANT_BADGE[user.merchantBadge] || "تاجر معتمد")
    : user.merchantStatus === "pending" ? "طلب تاجر قيد المراجعة" : "عضو";
  const tgLabel = user.telegramUsername ? `@${user.telegramUsername}` : user.telegramId ? "مرتبط" : "غير مرتبط";
  const kycCta = user.kycStatus === "verified"
    ? (user.kycLevel === "advanced" ? "عرض التوثيق" : "ترقية التوثيق")
    : user.kycStatus === "submitted" ? "متابعة التوثيق" : "وثّق حسابك";

  return (
    <div className="page narrow profile-page">
      <PageHead title="الملف الشخصي" subtitle="هويتك داخل المنصة، الأمان، وربط تلغرام.">
        <SupportButton settings={meta.settings} />
      </PageHead>
      <div className="stack">
        {(user.accountFrozen || user.fundsFrozen) && (
          <div className="notice">
            {user.accountFrozen ? "الحساب مجمّد. " : "الأموال مجمّدة داخل المحفظة. "}
            {user.freezeReason || "تواصل مع الدعم لفك التجميد."}
          </div>
        )}

        {user.isAdmin && (
          <NavLink to="/admin" className="card profile-admin-link">
            <span className="profile-admin-ico"><Icon name="admin" /></span>
            <span className="profile-admin-copy">
              <b>لوحة الإدارة</b>
              <small>التشغيل · المال · الإعدادات</small>
            </span>
            <span className="profile-admin-go"><Icon name="back" /></span>
          </NavLink>
        )}

        <div className="card profile-hero">
          <div className="profile-hero-top">
            <div className="profile-hero-id">
              <h2>{user.displayName}</h2>
              <p>@{user.username}{user.isAdmin ? " · مدير" : ""}</p>
              <div className="profile-uid">
                <span>{user.uidCode || "—"}</span>
                <button
                  type="button"
                  className="copy-ico"
                  title={copied ? "تم النسخ" : "نسخ UID"}
                  onClick={() => {
                    if (!user.uidCode) return;
                    navigator.clipboard.writeText(user.uidCode);
                    setCopied(true);
                  }}
                >
                  <Icon name="copy" />
                </button>
              </div>
              <div className="profile-pills">
                <span className={`pill ${user.kycStatus === "verified" ? "green" : "gold"}`}>{kycLabel}</span>
                <span className={`pill ${user.merchantStatus === "approved" ? "green" : ""}`}>{merchLabel}</span>
                {user.isAdmin && <span className="pill gold">مدير</span>}
              </div>
            </div>
            <label className="avatar-edit">
              <Avatar person={user} size="xl" />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={async (e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = "";
                  if (!file) return;
                  setSaveMsg("");
                  try {
                    const prepared = await prepareFileForUpload(file, { maxBytes: 2 * 1024 * 1024 });
                    await api("/api/me/avatar", { method: "POST", body: JSON.stringify({ data: prepared.data }) });
                    if (refresh) await refresh();
                    setSaveMsg("تم تحديث الصورة.");
                  } catch (ex) {
                    setSaveMsg(ex.message);
                  }
                }}
              />
              <span className="avatar-edit-badge">تغيير</span>
            </label>
          </div>
        </div>

        <div className="card profile-tabs-card">
          <div className="profile-tabs">
            <button type="button" className={secTab === "name" ? "on" : ""} onClick={() => setSecTab("name")}>
              <Icon name="user" />
              <span>الاسم</span>
            </button>
            <button type="button" className={secTab === "photo" ? "on" : ""} onClick={() => setSecTab("photo")}>
              <Icon name="camera" />
              <span>الصورة</span>
            </button>
            <button type="button" className={secTab === "security" ? "on" : ""} onClick={() => setSecTab("security")}>
              <Icon name="lock" />
              <span>الأمان</span>
            </button>
            <button type="button" className={secTab === "telegram" ? "on" : ""} onClick={() => setSecTab("telegram")}>
              <Icon name="bot" />
              <span>تلغرام</span>
            </button>
            <button type="button" className={secTab === "danger" ? "on" : ""} onClick={() => setSecTab("danger")}>
              <Icon name="danger" />
              <span>حذف الحساب</span>
            </button>
          </div>
          {secTab === "security" && (
            <div className="profile-tab-body">
              <div className="profile-subtabs">
                <button type="button" className={safeTab === "pin" ? "on" : ""} onClick={() => setSafeTab("pin")}>
                  <Icon name="pin" />
                  <span>رمز التحرير</span>
                </button>
                <button type="button" className={safeTab === "totp" ? "on" : ""} onClick={() => setSafeTab("totp")}>
                  <Icon name="shield" />
                  <span>المصادقة</span>
                </button>
                <button type="button" className={safeTab === "password" ? "on" : ""} onClick={() => setSafeTab("password")}>
                  <Icon name="lock" />
                  <span>كلمة المرور</span>
                </button>
                <button type="button" className={safeTab === "applock" ? "on" : ""} onClick={() => setSafeTab("applock")}>
                  <Icon name="shield" />
                  <span>قفل التطبيق</span>
                </button>
              </div>
              {safeTab === "pin" && <TradePinPanel user={user} refresh={refresh} />}
              {safeTab === "totp" && <TotpPanel user={user} refresh={refresh} />}
              {safeTab === "password" && <PasswordPanel refresh={refresh} />}
              {safeTab === "applock" && <AppLockPanel />}
            </div>
          )}
          {secTab === "photo" && (
            <div className="profile-tab-body">
              <div className="section-title"><h3>صورة الحساب</h3></div>
              <p className="hint" style={{ marginTop: 0 }}>تظهر في السوق والشريط وملفك. JPEG أو PNG أو WEBP حتى 2MB.</p>
              <div className="avatar-upload">
                <Avatar person={user} size="xl" />
                <div className="form-actions">
                  <label className="btn sm">
                    {user.hasAvatar ? "تغيير الصورة" : "رفع صورة"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={async (e) => {
                        const file = e.target.files && e.target.files[0];
                        e.target.value = "";
                        if (!file) return;
                        setSaveMsg("");
                        try {
                          const prepared = await prepareFileForUpload(file, { maxBytes: 2 * 1024 * 1024 });
                          await api("/api/me/avatar", { method: "POST", body: JSON.stringify({ data: prepared.data }) });
                          if (refresh) await refresh();
                          setSaveMsg("تم تحديث الصورة.");
                        } catch (ex) {
                          setSaveMsg(ex.message);
                        }
                      }}
                    />
                  </label>
                  {user.hasAvatar && (
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={async () => {
                        setSaveMsg("");
                        try {
                          await api("/api/me/avatar", { method: "DELETE" });
                          if (refresh) await refresh();
                          setSaveMsg("أُزيلت الصورة.");
                        } catch (ex) {
                          setSaveMsg(ex.message);
                        }
                      }}
                    >
                      إزالة
                    </button>
                  )}
                </div>
              </div>
              {saveMsg && <p className={saveMsg.includes("تم") || saveMsg.includes("أُزيل") ? "notice" : "error"}>{saveMsg}</p>}
            </div>
          )}
          {secTab === "name" && (
            <div className="profile-tab-body">
              <div className="section-title"><h3>الاسم الظاهر</h3></div>
              <form className="form" onSubmit={saveName}>
                <label className="field">
                  <span>يظهر للمستخدمين في السوق والصفقات</span>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} disabled={nameLocked} />
                </label>
                <p className="hint">يُغيَّر مرة كل 60 يوماً. الاسم القانوني في التوثيق لا يتغير.</p>
                {nameLocked && <p className="hint">التغيير التالي متاح في {nameUnlock}.</p>}
                {saveMsg && <p className={saveMsg.includes("تم") ? "notice" : "error"}>{saveMsg}</p>}
                <button className="btn dark sm" type="submit" disabled={nameLocked}>حفظ الاسم</button>
              </form>
            </div>
          )}
          {secTab === "telegram" && (
            <div className="profile-tab-body">
              <div className="section-title">
                <h3>ربط تلغرام</h3>
                <span className="pill gold">@{botUser}</span>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>افتح البوت للشراء والبيع والمحفظة، أو اربط هذا الحساب برمز لمرة واحدة.</p>
              <div className="form-actions">
                <button className="btn" type="button" onClick={() => openTelegramBot(botUser)}>فتح البوت</button>
                <button className="btn dark" type="button" onClick={link}>إنشاء رمز ربط</button>
                <NavLink to="/help" className="btn ghost">دليل المساعدة</NavLink>
              </div>
              {code && <div className="notice" style={{ marginTop: 12 }}>أرسل للبوت: <span className="mono">/start LINK_{code}</span></div>}
              <div className="section-title" style={{ marginTop: 18 }}><h3>تطبيق أندرويد</h3></div>
              <p className="hint" style={{ marginTop: 0 }}>حمّل تطبيق {(meta.settings && meta.settings.brand) || "USDT شام"} بصيغة APK. إن ظهر تحذير التثبيت من مصادر غير معروفة فاسمح به من إعدادات أندرويد.</p>
              <ApkDownloadButton />
            </div>
          )}
          {secTab === "danger" && (
            <div className="profile-tab-body">
              <div className="section-title"><h3>حذف الحساب</h3></div>
              <p className="hint" style={{ marginTop: 0 }}>يحذف بياناتك وارتباط تلغرام والتوثيق. إن وُجد رصيد أو صفقة معلّقة يُرفض الحذف حتى تسحب أموالك.</p>
              {user.isAdmin ? (
                <div className="notice">حساب المدير لا يُحذف من هنا.</div>
              ) : (
                <>
                  <label className="field">
                    <span>اكتب DELETE للتأكيد</span>
                    <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" />
                  </label>
                  {deleteErr && <div className="error">{deleteErr}</div>}
                  <IcoAction
                    className="btn red"
                    icon="close"
                    disabled={deleteBusy || deleteText !== "DELETE"}
                    onClick={async () => {
                      if (!window.confirm("حذف الحساب نهائياً؟ لا يمكن التراجع.")) return;
                      setDeleteErr("");
                      setDeleteBusy(true);
                      try {
                        await api("/api/me/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) });
                        await logout();
                        nav("/gate");
                      } catch (ex) {
                        setDeleteErr(ex.message);
                      } finally {
                        setDeleteBusy(false);
                      }
                    }}
                  >
                    {deleteBusy ? "جاري الحذف..." : "حذف الحساب نهائياً"}
                  </IcoAction>
                </>
              )}
            </div>
          )}
        </div>

        <div className="profile-foot">
          <div className="profile-stats">
            <div className="profile-stat">
              <span>الصفقات</span>
              <b>{user.completedTrades || 0}</b>
            </div>
            <div className="profile-stat">
              <span>التقييم</span>
              <b>{user.rating || 100}%</b>
            </div>
            <div className="profile-stat">
              <span>تلغرام</span>
              <b>{tgLabel}</b>
            </div>
            <div className="profile-stat">
              <span>عضو منذ</span>
              <b>{joined}</b>
            </div>
          </div>
          <div className="profile-actions">
            {user.isAdmin && (
              <IcoLink to="/admin" className="btn sm admin-profile-btn" icon="admin">لوحة الإدارة</IcoLink>
            )}
            <IcoLink to="/ads/new" className="btn sm create-ad" icon="plus">نشر إعلان</IcoLink>
            <IcoLink to="/kyc" className={`btn sm ${user.kycStatus === "verified" ? "dark" : ""}`} icon="kyc">{kycCta}</IcoLink>
            <IcoLink to="/wallet" className="btn dark sm" icon="wallet">المحفظة</IcoLink>
            {user.merchantStatus !== "approved" && (
              <IcoLink to="/ads/new" className="btn ghost sm" icon="merchants">
                {user.merchantStatus === "pending" ? "طلب التاجر قيد المراجعة" : "طلب اعتماد تاجر"}
              </IcoLink>
            )}
            <SupportButton settings={meta.settings} className="btn ghost sm" label="الدعم" />
            <IcoAction className="btn ghost sm" icon="close" onClick={logout}>خروج</IcoAction>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupportPage() {
  const { user } = useAuth();
  const meta = useMeta();
  const [tickets, setTickets] = useState([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("assistant");
  const [assistantLog, setAssistantLog] = useState([]);
  const [quick, setQuick] = useState([]);
  const [askText, setAskText] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [topicId, setTopicId] = useState("start");
  const [suggestHuman, setSuggestHuman] = useState(false);
  const [humanUnlocked, setHumanUnlocked] = useState(false);
  const [closeStars, setCloseStars] = useState(0);
  const [closeComment, setCloseComment] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);

  async function load() {
    const d = await api("/api/support");
    setTickets(d.tickets || []);
    if (d.humanUnlocked) setHumanUnlocked(true);
  }

  useEffect(() => {
    if (!user) return undefined;
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api("/api/support/assistant", { method: "POST", body: JSON.stringify({}) })
      .then((d) => {
        setAssistantLog([{ id: "greet", from: "bot", text: d.greeting }]);
        setQuick(d.topics || []);
        setHumanUnlocked(!!d.humanUnlocked);
      })
      .catch(() => {});
  }, [user]);

  useAppRefresh(() => { if (user) load().catch(() => {}); });

  if (!user) return <TelegramGate message="سجّل الدخول لفتح محادثة الدعم." />;

  const chat = tickets.find((t) => t.status === "open") || tickets[0] || null;
  const messages = (chat && chat.messages) || [];
  const canHuman = humanUnlocked || !!(chat && chat.status === "open");

  async function ask(e, payload) {
    if (e) e.preventDefault();
    const body = payload || { text: askText };
    if (!payload && !String(askText).trim()) return;
    if (payload && payload.topicId === "human" && !canHuman) {
      setErr("اسأل المساعد الآلي أولاً ثم يمكنك التحويل للدعم البشري.");
      return;
    }
    setErr("");
    setAskBusy(true);
    if (!payload) {
      setAssistantLog((prev) => [...prev, { id: `u${Date.now()}`, from: "user", text: askText }]);
    }
    try {
      const d = await api("/api/support/assistant", { method: "POST", body: JSON.stringify(body) });
      setAssistantLog((prev) => [...prev, { id: `b${Date.now()}`, from: "bot", text: d.reply }]);
      setQuick(d.quick || []);
      setTopicId(d.topicId || "start");
      setSuggestHuman(!!d.suggestHuman);
      setHumanUnlocked(!!d.humanUnlocked);
      if (!payload) setAskText("");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setAskBusy(false);
    }
  }

  async function handoff() {
    if (!canHuman) {
      setErr("اسأل المساعد الآلي أولاً بسؤال واحد على الأقل، ثم يمكنك التحويل للدعم البشري.");
      setView("assistant");
      return;
    }
    setErr("");
    setHandoffBusy(true);
    try {
      const lastUser = [...assistantLog].reverse().find((m) => m.from === "user");
      const summary = assistantLog
        .slice(-6)
        .map((m) => `${m.from === "user" ? "المستخدم" : "المساعد"}: ${String(m.text).slice(0, 240)}`)
        .join("\n");
      await api("/api/support/handoff", {
        method: "POST",
        body: JSON.stringify({
          text: (lastUser && lastUser.text) || "أرغب بالتواصل مع الدعم البشري.",
          summary: `ملخص المحادثة الآلية:\n${summary}`,
          topicId,
          subject: "تحويل من الدعم الآلي"
        })
      });
      setHumanUnlocked(true);
      await load();
      setView("human");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setHandoffBusy(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    if (!canHuman) {
      setErr("اسأل المساعد الآلي أولاً ثم يمكنك مراسلة الدعم البشري.");
      setView("assistant");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await api("/api/support", { method: "POST", body: JSON.stringify({ text }) });
      setText("");
      setHumanUnlocked(true);
      await load();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function closeChat() {
    if (!chat || chat.status !== "open") return;
    if (!(closeStars >= 1 && closeStars <= 5)) {
      setErr("قيّم المحادثة من 1 إلى 5 نجوم قبل الإغلاق.");
      return;
    }
    setErr("");
    setCloseBusy(true);
    try {
      await api(`/api/support/${chat.id}/close`, {
        method: "POST",
        body: JSON.stringify({ rating: closeStars, comment: closeComment })
      });
      setCloseStars(0);
      setCloseComment("");
      await load();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHead title="الدعم" subtitle="مساعد آلي فوري أولاً، ثم تحويل للدعم البشري إن لم تُحل المشكلة.">
        <a className="btn ghost sm ico-btn" href={supportHref(meta.settings)} target="_blank" rel="noreferrer">
          <Icon name="send" /><span>تلغرام</span>
        </a>
      </PageHead>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="tabs" style={{ marginBottom: 14 }}>
        <TabBtn icon="bot" label="المساعد الآلي" on={view === "assistant"} onClick={() => setView("assistant")} />
        <TabBtn
          icon="human"
          label={canHuman ? `الدعم البشري${chat && chat.status === "open" ? " (جارية)" : ""}` : "الدعم البشري (بعد المساعد)"}
          on={view === "human"}
          onClick={() => {
            if (!canHuman) {
              setErr("اسأل المساعد الآلي أولاً ثم يُفتح الدعم البشري.");
              setView("assistant");
              return;
            }
            setView("human");
          }}
        />
      </div>

      {view === "assistant" && (
        <div className="stack">
          <div className="card">
            <p className="hint" style={{ marginTop: 0 }}>
              يجيب المساعد فوراً عن الإيداع والسحب والتوثيق والتداول والضمان والإعلانات ورمز التحرير. الدعم البشري يُفتح بعد سؤال واحد على الأقل. لا ترسل كلمة المرور أو رمز التحرير.
            </p>
            <div className="chips">
              {(quick.length ? quick : []).map((t) => (
                <button key={t.id} type="button" className={`chip ico-chip ${topicId === t.id ? "on" : ""}`} onClick={() => ask(null, { topicId: t.id })}>
                  <Icon name={TOPIC_ICONS[t.id] || "help"} />
                  <span>{t.title}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card chat-box support-chat">
            <div className="section-title" style={{ padding: "12px 16px 0" }}>
              <h3><Icon name="bot" /> المساعد الآلي</h3>
              <span className="pill green">فوري</span>
            </div>
            <div className="chat-log">
              {assistantLog.map((m) => (
                <div key={m.id} className={`bubble ${m.from === "user" ? "me" : ""}`}>
                  <div className="muted small">{m.from === "user" ? "أنت" : "المساعد"}</div>
                  <div style={{ whiteSpace: "pre-line" }}>{m.text}</div>
                </div>
              ))}
            </div>
            <form className="chat-form" onSubmit={ask}>
              <input value={askText} onChange={(e) => setAskText(e.target.value)} placeholder="اكتب سؤالك..." required />
              <IcoAction className="btn sm" icon="send" type="submit" disabled={askBusy}>{askBusy ? "..." : "اسأل"}</IcoAction>
            </form>
            <div className="form-actions" style={{ padding: "0 16px 14px" }}>
              {canHuman ? (
                <IcoAction className="btn green sm" icon="human" disabled={handoffBusy} onClick={handoff}>
                  {handoffBusy ? "جارٍ التحويل..." : "التحدث مع الدعم البشري"}
                </IcoAction>
              ) : (
                <span className="hint" style={{ margin: 0 }}>اسأل المساعد أولاً ليُفتح التحويل للدعم البشري.</span>
              )}
              {suggestHuman && canHuman && <span className="hint" style={{ margin: 0 }}>المسألة تحتاج مراجعة بشرية.</span>}
            </div>
          </div>
        </div>
      )}

      {view === "human" && canHuman && (
        <div className="card chat-box support-chat">
          <div className="section-title" style={{ padding: "12px 16px 0" }}>
            <h3><Icon name="human" /> محادثة الدعم البشري</h3>
            {chat ? (
              <span className={`pill ${chat.status === "open" ? "gold" : "green"}`}>{chat.status === "open" ? "جارية" : "مغلقة"}</span>
            ) : (
              <IcoAction className="btn sm" icon="human" disabled={handoffBusy} onClick={handoff}>فتح تذكرة</IcoAction>
            )}
          </div>
          <div className="chat-log">
            {messages.length === 0 && (
              <div className="bubble sys">
                لا توجد تذكرة بشرية بعد. اكتب رسالتك بالأسفل أو حوّل المحادثة من تبويب المساعد الآلي. لا ترسل كلمة المرور أو رمز التحرير.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.from === "admin" ? "" : m.from === "bot" ? "sys" : "me"}`}>
                <div className="muted small">{m.from === "admin" ? "الدعم" : m.from === "bot" ? "المساعد" : "أنت"}</div>
                <div style={{ whiteSpace: "pre-line" }}>{m.text}</div>
              </div>
            ))}
          </div>
          {chat && chat.status === "open" && (
            <form className="chat-form" onSubmit={send}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك للدعم البشري..." minLength={4} required />
              <IcoAction className="btn sm" icon="send" type="submit" disabled={busy}>{busy ? "..." : "إرسال"}</IcoAction>
            </form>
          )}
          {chat && chat.status === "open" && (
            <div className="support-close" style={{ padding: "0 16px 14px" }}>
              <p className="hint">قيّم المحادثة ثم أغلقها.</p>
              <div className="star-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className={`star-btn${closeStars >= n ? " on" : ""}`} onClick={() => setCloseStars(n)}>
                    <Icon name="star" />
                  </button>
                ))}
              </div>
              <input value={closeComment} onChange={(e) => setCloseComment(e.target.value)} placeholder="رأيك (اختياري)" />
              <IcoAction className="btn ghost sm" icon="check" disabled={closeBusy} onClick={closeChat}>
                {closeBusy ? "جاري الإغلاق..." : "إغلاق المحادثة"}
              </IcoAction>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LegalPage({ kind }) {
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? "سياسة الخصوصية" : "شروط الاستخدام";
  const blocks = isPrivacy
    ? [
        ["البيانات التي نجمعها", "نجمع اسم المستخدم، الاسم الظاهر، وثائق التوثيق، وسجل الصفقات والدردشة داخل المنصة فقط."],
        ["الاستخدام", "تُستخدم البيانات لتشغيل التداول الندّ لندّ، منع الاحتيال، ومراجعة النزاعات من الإدارة."],
        ["المشاركة", "لا نبيع بياناتك. قد تُعرض بيانات الدفع اللازمة للطرف الآخر داخل الصفقة فقط."],
        ["الاحتفاظ", "نحتفظ بسجلات الصفقات والإثباتات للمدة اللازمة للامتثال وحل النزاعات."],
        ["حقوقك", "يمكنك طلب تصحيح بيانات الحساب عبر الدعم. إلغاء الحساب لا يلغي سجلات الصفقات المكتملة."]
      ]
    : [
        ["طبيعة الخدمة", "p2pSham-Syria منصة وساطة P2P. العملة تُحجز في الضمان حتى تأكيد الدفع أو حل النزاع."],
        ["الحساب", "يجب أن يكون الحساب حقيقياً وباسم موثّق. يُحظر الحسابات المتعددة للاحتيال أو التحايل على الحدود."],
        ["التداول", "المشتري يدفع خلال مهلة الإعلان. بعد التأكيد لا يُلغى الطلب إلا بنزاع أو تدخل الإدارة."],
        ["الدردشة", "التواصل داخل الصفقة فقط. يُمنع مشاركة أرقام أو تلغرام أو روابط خارجية."],
        ["المسؤولية", "المنصة ليست طرفاً في تحويل شام كاش. الضمان يغطي الأصل المحجوز وفق قواعد النزاع."]
      ];
  return (
    <div className="page narrow">
      <PageHead title={title} subtitle="p2pSham-Syria">
        <IcoLink to="/gate" className="btn ghost sm" icon="back">التسجيل</IcoLink>
      </PageHead>
      <div className="stack">
        {blocks.map(([h, p]) => (
          <article className="card" key={h}>
            <h3 style={{ margin: "0 0 8px" }}>{h}</h3>
            <p className="hint" style={{ margin: 0 }}>{p}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function HelpPage() {
  const meta = useMeta();
  const [guide, setGuide] = useState(null);
  const [openId, setOpenId] = useState("about");

  useEffect(() => {
    api("/api/help")
      .then(setGuide)
      .catch(() => setGuide(null));
  }, []);

  const sections = (guide && guide.sections) || [];

  return (
    <div className="page narrow">
      <PageHead
        title={guide?.title || `دليل استخدام ${(meta.settings && meta.settings.brand) || "USDT شام"}`}
        subtitle={guide?.intro || "شروحات الشراء والبيع والتوثيق والمحفظة والضمان وشام كاش."}
      >
        <SupportButton settings={meta.settings} />
      </PageHead>
      <div className="card">
        <p className="hint" style={{ marginTop: 0, lineHeight: 1.9 }}>
          المنصة لشراء وبيع USDT في سوريا بضمان الحجز ودفع شام كاش: اسم المستلم من التوثيق وعنوان 32 خانة فقط، بلا رقم هاتف.
          اختر موضوعاً أدناه. للدعم المباشر استخدم زر تلغرام المعتمد.
        </p>
        <div className="form-actions">
          <SupportButton settings={meta.settings} className="btn" />
          <IcoAction className="btn dark" icon="bot" type="button" onClick={() => openTelegramBot(meta.settings?.telegramBotUsername)}>
            فتح البوت
          </IcoAction>
          <ApkDownloadButton className="btn dark" />
          <a className="btn ghost ico-btn" href="/api/help.pdf" target="_blank" rel="noreferrer">
            <Icon name="download" />
            <span>تحميل الدليل PDF</span>
          </a>
          <IcoLink to="/kyc" icon="kyc" className="btn ghost">التوثيق</IcoLink>
          <IcoLink to="/wallet" icon="wallet" className="btn ghost">المحفظة</IcoLink>
        </div>
      </div>
      <div className="help-toc">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip ico-chip ${openId === s.id ? "on" : ""}`}
            onClick={() => {
              setOpenId(s.id);
              const el = document.getElementById(`help-${s.id}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <Icon name={HELP_ICONS[s.id] || "help"} />
            <span>{s.title}</span>
          </button>
        ))}
      </div>
      <div className="stack">
        {sections.map((s) => (
          <article className={`card help-article ${openId === s.id ? "open" : ""}`} id={`help-${s.id}`} key={s.id}>
            <button type="button" className="help-toggle" onClick={() => setOpenId(openId === s.id ? "" : s.id)}>
              <h3><Icon name={HELP_ICONS[s.id] || "help"} /> {s.title}</h3>
              <span className="help-toggle-state"><Icon name={openId === s.id ? "close" : "plus"} /> {openId === s.id ? "إخفاء" : "عرض"}</span>
            </button>
            {openId === s.id && (
              <div className="help-body">
                {String(s.body || "")
                  .split("\n")
                  .filter(Boolean)
                  .map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
              </div>
            )}
          </article>
        ))}
        {!sections.length && (
          <div className="card">
            <p className="hint">تعذر تحميل الدليل. أعد المحاولة أو استخدم زر المساعدة في البوت.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AppDisabledGate() {
  const { user } = useAuth();
  const meta = useMeta();
  const loc = useLocation();
  const enabled = meta.settings && meta.settings.appEnabled !== false;
  if (enabled) return null;
  if (user && user.isAdmin) return null;
  if (loc.pathname.startsWith("/admin")) return null;
  const message = (meta.settings && meta.settings.appDisabledMessage) || "المنصة متوقفة مؤقتاً للصيانة. حاول لاحقاً.";
  return (
    <div className="totp-day-mask app-disabled-mask">
      <div className="card totp-day-card">
        <h2>المنصة متوقفة مؤقتاً</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

function TotpDayGate() {
  const { user, refresh } = useAuth();
  const loc = useLocation();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const marketPath = loc.pathname === "/" || loc.pathname.startsWith("/trade");
  if (!user || !user.totpEnabled || !user.totpDayRequired || !marketPath) return null;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/api/me/totp/verify-day", { method: "POST", body: JSON.stringify({ code }) });
      setCode("");
      if (refresh) await refresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="totp-day-mask">
      <form className="card totp-day-card" onSubmit={submit}>
        <h2>تأكيد الهوية لليوم</h2>
        <p>أدخل رمز تطبيق المصادقة مرة واحدة اليوم قبل استخدام السوق.</p>
        <label className="field">
          <span>رمز Google</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            required
          />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn block" disabled={busy}>{busy ? "جاري التحقق..." : "تأكيد والمتابعة"}</button>
        <IcoLink to="/bot" className="btn ghost sm" icon="user">الحساب</IcoLink>
      </form>
    </div>
  );
}

function AppLockGate() {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => !!(user && shouldShowLock()));
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !lockEnabled()) {
      setOpen(false);
      return undefined;
    }
    function sync() {
      if (shouldShowLock()) setOpen(true);
    }
    function onHide() {
      if (typeof document !== "undefined" && document.hidden) {
        markLocked();
        setOpen(true);
      }
    }
    function onPageHide() {
      markLocked();
      setOpen(true);
    }
    sync();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    let cap;
    try {
      cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (cap && cap.addListener) {
        cap.addListener("appStateChange", (state) => {
          if (state && state.isActive === false) {
            markLocked();
            setOpen(true);
          }
        });
      }
    } catch {
      cap = null;
    }
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [user]);

  useEffect(() => {
    if (!open) return undefined;
    const lock = readLock();
    if (lock.bio && biometricSupported()) {
      unlockWithBiometric().then(() => {
        setOpen(false);
        setPin("");
        setErr("");
      }).catch(() => {});
    }
    return undefined;
  }, [open]);

  if (!user || !open) return null;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await verifyLockPin(pin);
      setPin("");
      setOpen(false);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function bio() {
    setErr("");
    setBusy(true);
    try {
      await unlockWithBiometric();
      setPin("");
      setOpen(false);
    } catch (ex) {
      setErr(ex.message || "تعذر فتح القفل بالبصمة.");
    } finally {
      setBusy(false);
    }
  }

  const lock = readLock();
  return (
    <div className="totp-day-mask app-lock-mask">
      <form className="card totp-day-card" onSubmit={submit}>
        <h2>التطبيق مقفل</h2>
        <p>أدخل رمز PIN أو استخدم البصمة للمتابعة. الجلسة محفوظة ولن تُسجّل خروجك.</p>
        <label className="field">
          <span>رمز القفل</span>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(lockPinDigits(e.target.value))}
            placeholder="••••"
            required
          />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn block" disabled={busy}>{busy ? "جاري التحقق..." : "فتح"}</button>
        {lock.bio && biometricSupported() && (
          <IcoAction className="btn dark block" icon="shield" disabled={busy} onClick={bio}>فتح بالبصمة / الوجه</IcoAction>
        )}
      </form>
    </div>
  );
}

function BrandTitle() {
  const meta = useMeta();
  const name = (meta.settings && meta.settings.brand) || "USDT شام";
  const tagline = (meta.settings && meta.settings.brandTagline) || "تداول ند للند في سوريا";
  useEffect(() => {
    document.title = `${name} | ${tagline}`;
  }, [name, tagline]);
  return null;
}

function NativeNoticeWatcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return undefined;
    let stop = false;
    let primed = false;
    armNotifyPermission();
    ensureNotifyPermission().catch(() => {});

    async function tick() {
      try {
        const d = await api("/api/notifications");
        const items = d.notifications || [];
        const fresh = unseenNotices(items);
        if (stop) return;
        if (!primed) {
          primed = true;
          markNoticesSeen(items.map((n) => n.id).filter(Boolean));
          return;
        }
        for (const n of fresh) {
          await showNativeNotice({
            title: n.title,
            body: n.body,
            href: notificationHref(n)
          });
        }
        if (fresh.length) markNoticesSeen(fresh.map((n) => n.id));
      } catch {
        /* ignore */
      }
    }

    tick();
    const t = setInterval(tick, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user]);

  return null;
}

export default function App() {
  return (
    <div className="app-shell">
      <BrandTitle />
      <Topbar />
      <NativeNoticeWatcher />
      <AppDisabledGate />
      <AppLockGate />
      <TotpDayGate />
      <Routes>
        <Route path="/" element={<Market />} />
        <Route path="/gate" element={<TelegramGate />} />
        <Route path="/login" element={<TelegramGate />} />
        <Route path="/register" element={<TelegramGate />} />
        <Route path="/trade/:id" element={<Trade />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderRoom />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/ads" element={<MyAdsPage />} />
        <Route path="/ads/new" element={<NewAd />} />
        <Route path="/ads/:id/edit" element={<EditAd />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/bot" element={<BotPage />} />
        <Route path="/profile" element={<BotPage />} />
      </Routes>
      <BottomNav />
    </div>
  );
}
