const TOKEN_KEY = "pexora_token";
const LIVE_ORIGIN = "https://sham-usdt5.onrender.com";

function detectApiBase() {
  const env = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  if (env) return env;
  if (typeof window === "undefined") return "";
  const proto = String(window.location.protocol || "");
  const host = String(window.location.hostname || "");
  const capacitor = !!(window.Capacitor || window.cordova);
  if (capacitor || proto === "capacitor:" || proto === "ionic:" || proto === "file:") return LIVE_ORIGIN;
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return LIVE_ORIGIN;
  return "";
}

const API_BASE = detectApiBase();

function withBase(path) {
  if (!API_BASE) return path;
  const p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_BASE}${p.startsWith("/") ? p : `/${p}`}`;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(withBase(path), { ...options, headers });
  } catch {
    throw new Error("تعذر الاتصال بالخادم. تأكد من اتصالك بالإنترنت ثم أعد المحاولة.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `تعذر إكمال الطلب (${res.status})`);
    err.status = res.status;
    err.code = data.code || "";
    err.data = data;
    throw err;
  }
  return data;
}

export function authedUrl(path) {
  const token = getToken();
  const join = path.includes("?") ? "&" : "?";
  const url = withBase(path);
  return token ? `${url}${join}token=${encodeURIComponent(token)}` : url;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
    reader.readAsDataURL(file);
  });
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_IMAGE_DIM = 1600;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("تعذر قراءة الصورة"));
    };
    img.src = url;
  });
}

const MAX_VIDEO_BYTES = 12 * 1024 * 1024;

export async function prepareFileForUpload(file, opts = {}) {
  const isImage = String(file.type || "").startsWith("image/");
  const isVideo = String(file.type || "").startsWith("video/");
  const maxBytes = opts.maxBytes || (isVideo ? MAX_VIDEO_BYTES : MAX_FILE_BYTES);
  if (!isImage) {
    const data = await readFileAsDataUrl(file);
    if (file.size > maxBytes) {
      throw new Error(isVideo ? "حجم الفيديو يجب ألا يتجاوز 12MB" : "حجم الملف يجب ألا يتجاوز 4MB");
    }
    return { name: file.name, data };
  }
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  let quality = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > TARGET_IMAGE_BYTES * 1.37 && quality > 0.35) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  let shrink = 1;
  while (dataUrl.length > TARGET_IMAGE_BYTES * 1.37 && shrink > 0.5) {
    shrink -= 0.15;
    const cw = Math.max(1, Math.round(w * shrink));
    const ch = Math.max(1, Math.round(h * shrink));
    canvas.width = cw;
    canvas.height = ch;
    ctx.drawImage(img, 0, 0, cw, ch);
    dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  }
  if (dataUrl.length > MAX_FILE_BYTES * 1.37) {
    throw new Error("حجم الصورة كبير جداً. جرّب صورة أوضح وأصغر.");
  }
  const name = String(file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
  return { name, data: dataUrl };
}
