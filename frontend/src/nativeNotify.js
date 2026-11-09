import { playTone } from "./notifyTones.js";

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

function playAlertTone() {
  playTone();
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
