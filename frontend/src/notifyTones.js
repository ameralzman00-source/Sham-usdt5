const META_KEY = "pexora_alert_tone_meta";
const DB_NAME = "pexora_tones";
const STORE = "files";
const FILE_KEY = "custom";
const MAX_BYTES = 4 * 1024 * 1024;

let audioEl = null;
let objectUrl = "";

function readMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { mode: "unset" };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.mode === "silent") return { mode: "silent" };
    if (parsed && parsed.mode === "custom" && parsed.name) {
      return { mode: "custom", name: String(parsed.name), type: parsed.type || "audio/mpeg" };
    }
    return { mode: "unset" };
  } catch {
    return { mode: "unset" };
  }
}

function writeMeta(meta) {
  try {
    if (!meta || meta.mode === "unset") localStorage.removeItem(META_KEY);
    else localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("تعذر فتح تخزين النغمة"));
  });
}

async function putFile(blob) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("تعذر حفظ النغمة"));
      tx.objectStore(STORE).put(blob, FILE_KEY);
    });
  } finally {
    db.close();
  }
}

async function getFile() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(FILE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("تعذر قراءة النغمة"));
    });
  } finally {
    db.close();
  }
}

async function deleteFile() {
  try {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("تعذر حذف النغمة"));
        tx.objectStore(STORE).delete(FILE_KEY);
      });
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

export function readTone() {
  const meta = readMeta();
  if (meta.mode === "silent") return { id: "silent", name: "صامت", hint: "اهتزاز فقط" };
  if (meta.mode === "custom") return { id: "custom", name: meta.name, hint: "من جهازك" };
  return { id: "unset", name: "غير معيّنة", hint: "اختر ملفاً من جهازك" };
}

export function readToneId() {
  return readTone().id;
}

export function saveToneId(id) {
  if (id === "silent") {
    writeMeta({ mode: "silent" });
    return readTone();
  }
  return readTone();
}

export async function saveCustomTone(file) {
  if (!file) throw new Error("اختر ملفاً صوتياً من جهازك.");
  const type = String(file.type || "");
  const name = String(file.name || "نغمة مخصصة");
  if (file.size > MAX_BYTES) throw new Error("الملف أكبر من 4 ميغابايت. اختر نغمة أقصر.");
  const okType = !type || type.startsWith("audio/") || type === "video/mp4";
  if (!okType) throw new Error("الملف ليس صوتياً. اختر mp3 أو m4a أو wav أو ogg.");
  await putFile(file);
  writeMeta({ mode: "custom", name, type: type || "audio/mpeg" });
  return readTone();
}

export async function clearCustomTone() {
  await deleteFile();
  writeMeta({ mode: "unset" });
  stopTone();
  return readTone();
}

export async function setSilentTone() {
  writeMeta({ mode: "silent" });
  stopTone();
  return readTone();
}

export function vibrateAlert() {
  try {
    if (navigator.vibrate) navigator.vibrate([450, 180, 450, 180, 700]);
  } catch {
    /* ignore */
  }
}

function stopTone() {
  try {
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    }
  } catch {
    /* ignore */
  }
  if (objectUrl) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
    objectUrl = "";
  }
}

export async function playTone() {
  const meta = readMeta();
  vibrateAlert();
  if (meta.mode !== "custom") return;
  try {
    const blob = await getFile();
    if (!blob) return;
    stopTone();
    objectUrl = URL.createObjectURL(blob);
    if (!audioEl) audioEl = new Audio();
    audioEl.src = objectUrl;
    audioEl.currentTime = 0;
    const play = audioEl.play();
    if (play && play.catch) play.catch(() => {});
  } catch {
    /* ignore */
  }
}
