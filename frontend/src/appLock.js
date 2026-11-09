const LOCK_KEY = "pexora_applock";
const UNLOCK_KEY = "pexora_applock_open";
const IDLE_MS = 45 * 1000;

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function b64ToBuf(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out.buffer;
}

async function shaHex(text) {
  const data = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function pinDigits(value) {
  const map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
  };
  return String(value || "").replace(/[٠-٩۰-۹]/g, (c) => map[c] || c).replace(/\D/g, "").slice(0, 6);
}

export function isValidLockPin(pin) {
  const digits = pinDigits(pin);
  return /^\d{4,6}$/.test(digits) && !/^(\d)\1+$/.test(digits);
}

function nativeBiometricPlugin() {
  try {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    const plugin = plugins && plugins.NativeBiometric;
    if (plugin && typeof plugin.authenticate === "function") return plugin;
  } catch {
    /* ignore */
  }
  return null;
}

export function readLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return { enabled: false, pin: false, bio: false };
    const parsed = JSON.parse(raw);
    if (!parsed) return { enabled: false, pin: false, bio: false };
    const pin = !!(parsed.hash && parsed.salt);
    const bio = !!parsed.bio;
    return {
      enabled: pin || bio,
      pin,
      hash: parsed.hash || "",
      salt: parsed.salt || "",
      bio,
      credId: parsed.credId || "",
      nativeBio: !!parsed.nativeBio,
      fails: Number(parsed.fails || 0),
      lockedUntil: Number(parsed.lockedUntil || 0)
    };
  } catch {
    return { enabled: false, pin: false, bio: false };
  }
}

function writeLock(state) {
  if (!state || !(state.pin || state.bio)) {
    localStorage.removeItem(LOCK_KEY);
    sessionStorage.removeItem(UNLOCK_KEY);
    return;
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify({
    hash: state.hash || "",
    salt: state.salt || "",
    bio: !!state.bio,
    credId: state.credId || "",
    nativeBio: !!state.nativeBio,
    fails: Number(state.fails || 0),
    lockedUntil: Number(state.lockedUntil || 0)
  }));
}

export function lockEnabled() {
  const lock = readLock();
  return !!(lock.pin || lock.bio);
}

export function lockHasPin() {
  return !!readLock().pin;
}

export function lockHasBio() {
  return !!readLock().bio;
}

export function markUnlocked() {
  sessionStorage.setItem(UNLOCK_KEY, String(Date.now()));
}

export function markLocked() {
  sessionStorage.removeItem(UNLOCK_KEY);
}

export function lastUnlockAt() {
  return Number(sessionStorage.getItem(UNLOCK_KEY) || 0);
}

export function shouldShowLock() {
  const lock = readLock();
  if (!(lock.pin || lock.bio)) return false;
  const opened = lastUnlockAt();
  if (!opened) return true;
  if (typeof document !== "undefined" && document.hidden) return true;
  return Date.now() - opened > IDLE_MS * 20;
}

export async function setLockPin(pin) {
  const digits = pinDigits(pin);
  if (!isValidLockPin(digits)) throw new Error("رمز القفل يجب أن يكون 4 إلى 6 أرقام وغير مكرر.");
  const salt = bufToB64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await shaHex(`${salt}:${digits}`);
  const prev = readLock();
  writeLock({
    pin: true,
    hash,
    salt,
    bio: !!prev.bio,
    credId: prev.credId || "",
    nativeBio: !!prev.nativeBio,
    fails: 0,
    lockedUntil: 0
  });
  markUnlocked();
}

export function disableLock() {
  writeLock(null);
}

export function disablePin() {
  const lock = readLock();
  if (!lock.bio) {
    writeLock(null);
    return;
  }
  writeLock({
    pin: false,
    hash: "",
    salt: "",
    bio: true,
    credId: lock.credId || "",
    nativeBio: !!lock.nativeBio,
    fails: 0,
    lockedUntil: 0
  });
}

export async function verifyLockPin(pin) {
  const lock = readLock();
  if (!lock.pin) throw new Error("رمز PIN غير مفعّل.");
  if (lock.lockedUntil && Date.now() < lock.lockedUntil) {
    const mins = Math.max(1, Math.ceil((lock.lockedUntil - Date.now()) / 60000));
    throw new Error(`القفل مؤقت لمدة ${mins} دقيقة بعد محاولات خاطئة.`);
  }
  const digits = pinDigits(pin);
  const hash = await shaHex(`${lock.salt}:${digits}`);
  if (hash !== lock.hash) {
    const fails = Number(lock.fails || 0) + 1;
    const lockedUntil = fails >= 5 ? Date.now() + 5 * 60 * 1000 : 0;
    writeLock({ ...lock, pin: true, fails: fails >= 5 ? 0 : fails, lockedUntil });
    if (lockedUntil) throw new Error("رمز خاطئ. أُقفل لمدة 5 دقائق بعد 5 محاولات.");
    throw new Error(`رمز خاطئ. تبقى ${5 - fails} محاولات.`);
  }
  writeLock({ ...lock, pin: true, fails: 0, lockedUntil: 0 });
  markUnlocked();
  return true;
}

export function webauthnSupported() {
  return !!(typeof window !== "undefined" && window.PublicKeyCredential);
}

export async function nativeBiometricAvailable() {
  const plugin = nativeBiometricPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.available();
    return !!(res && res.available);
  } catch {
    return false;
  }
}

export async function biometricSupported() {
  if (await nativeBiometricAvailable()) return true;
  return webauthnSupported();
}

async function registerWebauthn() {
  if (!webauthnSupported()) throw new Error("هذا الجهاز لا يدعم البصمة أو الوجه من المتصفح.");
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "USDT Sham", id: window.location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "applock",
        displayName: "قفل التطبيق"
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred"
      },
      timeout: 60000
    }
  });
  if (!cred || !cred.rawId) throw new Error("تعذر تسجيل البصمة.");
  return bufToB64(cred.rawId);
}

export async function registerBiometric() {
  const prev = readLock();
  const nativeOk = await nativeBiometricAvailable();
  if (nativeOk) {
    const plugin = nativeBiometricPlugin();
    const res = await plugin.authenticate({
      title: "تفعيل قفل البصمة",
      subtitle: "أكد هويتك لتفعيل قفل التطبيق بالبصمة أو الوجه",
      cancel: "إلغاء"
    });
    if (!res || !res.ok) throw new Error("تعذر تفعيل البصمة.");
    writeLock({
      pin: !!prev.pin,
      hash: prev.hash || "",
      salt: prev.salt || "",
      bio: true,
      credId: "",
      nativeBio: true,
      fails: 0,
      lockedUntil: 0
    });
    markUnlocked();
    return;
  }
  const credId = await registerWebauthn();
  writeLock({
    pin: !!prev.pin,
    hash: prev.hash || "",
    salt: prev.salt || "",
    bio: true,
    credId,
    nativeBio: false,
    fails: 0,
    lockedUntil: 0
  });
  markUnlocked();
}

export async function disableBiometric() {
  const lock = readLock();
  if (!lock.pin) {
    writeLock(null);
    return;
  }
  writeLock({
    pin: true,
    hash: lock.hash,
    salt: lock.salt,
    bio: false,
    credId: "",
    nativeBio: false,
    fails: lock.fails || 0,
    lockedUntil: lock.lockedUntil || 0
  });
}

export async function unlockWithBiometric() {
  const lock = readLock();
  if (!lock.bio) throw new Error("البصمة غير مفعّلة.");
  if (lock.nativeBio || await nativeBiometricAvailable()) {
    const plugin = nativeBiometricPlugin();
    if (!plugin) throw new Error("البصمة غير متاحة على هذا الجهاز.");
    const res = await plugin.authenticate({
      title: "قفل التطبيق",
      subtitle: "استخدم البصمة أو الوجه للمتابعة",
      cancel: "إلغاء"
    });
    if (!res || !res.ok) throw new Error("تعذر التحقق بالبصمة.");
    writeLock({ ...readLock(), fails: 0, lockedUntil: 0 });
    markUnlocked();
    return true;
  }
  if (!webauthnSupported()) throw new Error("البصمة غير متاحة.");
  if (!lock.credId) throw new Error("البصمة غير مفعّلة.");
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: b64ToBuf(lock.credId), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000
    }
  });
  if (!cred) throw new Error("تعذر التحقق بالبصمة.");
  writeLock({ ...readLock(), fails: 0, lockedUntil: 0 });
  markUnlocked();
  return true;
}

export { IDLE_MS };
