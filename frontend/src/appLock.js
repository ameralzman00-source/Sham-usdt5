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

export function readLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return { enabled: false };
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.hash || !parsed.salt) return { enabled: false };
    return {
      enabled: true,
      hash: parsed.hash,
      salt: parsed.salt,
      bio: !!parsed.bio,
      credId: parsed.credId || "",
      fails: Number(parsed.fails || 0),
      lockedUntil: Number(parsed.lockedUntil || 0)
    };
  } catch {
    return { enabled: false };
  }
}

function writeLock(state) {
  if (!state || !state.enabled) {
    localStorage.removeItem(LOCK_KEY);
    sessionStorage.removeItem(UNLOCK_KEY);
    return;
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify({
    enabled: true,
    hash: state.hash,
    salt: state.salt,
    bio: !!state.bio,
    credId: state.credId || "",
    fails: Number(state.fails || 0),
    lockedUntil: Number(state.lockedUntil || 0)
  }));
}

export function lockEnabled() {
  return !!readLock().enabled;
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
  if (!lock.enabled) return false;
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
    enabled: true,
    hash,
    salt,
    bio: !!prev.bio,
    credId: prev.credId || "",
    fails: 0,
    lockedUntil: 0
  });
  markUnlocked();
}

export function disableLock() {
  writeLock(null);
}

export async function verifyLockPin(pin) {
  const lock = readLock();
  if (!lock.enabled) return true;
  if (lock.lockedUntil && Date.now() < lock.lockedUntil) {
    const mins = Math.max(1, Math.ceil((lock.lockedUntil - Date.now()) / 60000));
    throw new Error(`القفل مؤقت لمدة ${mins} دقيقة بعد محاولات خاطئة.`);
  }
  const digits = pinDigits(pin);
  const hash = await shaHex(`${lock.salt}:${digits}`);
  if (hash !== lock.hash) {
    const fails = Number(lock.fails || 0) + 1;
    const lockedUntil = fails >= 5 ? Date.now() + 5 * 60 * 1000 : 0;
    writeLock({ ...lock, fails: fails >= 5 ? 0 : fails, lockedUntil });
    if (lockedUntil) throw new Error("رمز خاطئ. أُقفل لمدة 5 دقائق بعد 5 محاولات.");
    throw new Error(`رمز خاطئ. تبقى ${5 - fails} محاولات.`);
  }
  writeLock({ ...lock, fails: 0, lockedUntil: 0 });
  markUnlocked();
  return true;
}

export function biometricSupported() {
  return !!(typeof window !== "undefined" && window.PublicKeyCredential);
}

export async function registerBiometric() {
  if (!biometricSupported()) throw new Error("هذا الجهاز لا يدعم البصمة أو الوجه من المتصفح.");
  const lock = readLock();
  if (!lock.enabled) throw new Error("عيّن رمز PIN أولاً.");
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
  writeLock({ ...readLock(), bio: true, credId: bufToB64(cred.rawId) });
  markUnlocked();
}

export async function disableBiometric() {
  const lock = readLock();
  if (!lock.enabled) return;
  writeLock({ ...lock, bio: false, credId: "" });
}

export async function unlockWithBiometric() {
  const lock = readLock();
  if (!lock.enabled || !lock.bio || !lock.credId) throw new Error("البصمة غير مفعّلة.");
  if (!biometricSupported()) throw new Error("البصمة غير متاحة.");
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
