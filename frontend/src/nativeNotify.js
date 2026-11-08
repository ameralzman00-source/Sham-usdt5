const SEEN_KEY = "pexora_seen_notices";

function nativePlugin() {
  try {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    const notify = plugins && plugins.NativeNotify;
    if (notify && typeof notify.show === "function") return notify;
  } catch {
    /* ignore */
  }
  return null;
}

export function isNativeApp() {
  try {
    return !!(window.Capacitor || window.cordova);
  } catch {
    return false;
  }
}

function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}

function writeSeen(ids) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

export function markNoticesSeen(ids) {
  const seen = new Set(readSeen());
  (ids || []).forEach((id) => seen.add(String(id)));
  writeSeen(Array.from(seen));
}

export function unseenNotices(items) {
  const seen = new Set(readSeen());
  return (items || []).filter((n) => n && !n.read && n.id && !seen.has(String(n.id)));
}

let asked = false;

function blockFirebasePush() {
  try {
    const cap = window.Capacitor;
    if (!cap) return;
    const plugins = cap.Plugins || (cap.Plugins = {});
    const noop = async () => ({ receive: "granted" });
    plugins.PushNotifications = {
      register: async () => ({}),
      unregister: async () => {},
      requestPermissions: noop,
      checkPermissions: noop,
      getDeliveredNotifications: async () => ({ notifications: [] }),
      removeAllDeliveredNotifications: async () => {},
      addListener: async () => ({ remove() {} }),
      removeAllListeners: async () => {},
      __shamStub: true
    };
    if (typeof cap.toNative === "function" && !cap.__shamPushGuard) {
      const native = cap.toNative.bind(cap);
      cap.toNative = function (plugin, method, options, callback) {
        if (String(plugin || "") === "PushNotifications" && String(method || "") === "register") {
          return "";
        }
        return native(plugin, method, options, callback);
      };
      cap.__shamPushGuard = true;
    }
  } catch {
    /* ignore */
  }
}

export async function ensureNotifyPermission() {
  blockFirebasePush();
  const plugin = nativePlugin();
  if (plugin && plugin.requestPermission) {
    try {
      const r = await plugin.requestPermission();
      asked = true;
      blockFirebasePush();
      return !!(r && r.granted);
    } catch {
      asked = true;
    }
  }
  asked = true;
  return true;
}

export function armNotifyPermission() {
  blockFirebasePush();
  if (asked) return;
  const once = () => {
    document.removeEventListener("pointerdown", once, true);
    document.removeEventListener("keydown", once, true);
    ensureNotifyPermission().catch(() => {});
  };
  document.addEventListener("pointerdown", once, true);
  document.addEventListener("keydown", once, true);
}

function vibrateAlert() {
  try {
    if (navigator.vibrate) navigator.vibrate([450, 180, 450, 180, 700]);
  } catch {
    /* ignore */
  }
}

function playAlertTone() {
  vibrateAlert();
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [880, 1174, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.22);
    });
    setTimeout(() => {
      try { ctx.close(); } catch { /* ignore */ }
    }, 1200);
  } catch {
    /* ignore */
  }
}

export async function showNativeNotice({ title, body, href }) {
  blockFirebasePush();
  const payload = {
    title: title || "USDT شام",
    body: body || "",
    href: href || "/notifications"
  };
  const plugin = nativePlugin();
  if (plugin && plugin.show) {
    try {
      await plugin.show(payload);
      playAlertTone();
      return true;
    } catch {
      /* fall through */
    }
  }
  playAlertTone();
  return false;
}
