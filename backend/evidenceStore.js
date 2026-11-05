const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname, "uploads", "orders");
const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const VIDEO_TYPES = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov"
};
const KINDS = ["payment_proof", "dispute_video", "dispute_image"];
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_VIDEO = 12 * 1024 * 1024;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function decodeDataUrl(data) {
  const raw = String(data || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("صيغة الملف غير صالحة");
  return { mime: m[1].trim().toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

function kindLabel(kind) {
  return {
    payment_proof: "إثبات الدفع",
    dispute_video: "فيديو النزاع",
    dispute_image: "صورة النزاع"
  }[kind] || kind;
}

function saveFiles(orderId, userId, files) {
  const dir = path.join(ROOT, String(orderId));
  ensureDir(dir);
  const saved = [];
  for (const f of files || []) {
    const kind = String(f.kind || "");
    if (!KINDS.includes(kind)) throw new Error("نوع المرفق غير صالح");
    const { mime, buf } = decodeDataUrl(f.data);
    const isVideo = kind === "dispute_video";
    const allowed = isVideo ? VIDEO_TYPES : IMAGE_TYPES;
    if (!allowed[mime]) {
      throw new Error(isVideo ? "يُسمح بفيديو MP4 أو WEBM أو MOV فقط" : "يُسمح بصور JPEG/PNG/WEBP فقط");
    }
    if (!buf.length) throw new Error("ملف فارغ");
    const limit = isVideo ? MAX_VIDEO : MAX_IMAGE;
    if (buf.length > limit) {
      throw new Error(isVideo ? "حجم الفيديو يجب ألا يتجاوز 12MB" : "حجم الصورة يجب ألا يتجاوز 4MB");
    }
    const id = `ev_${crypto.randomBytes(8).toString("hex")}`;
    const storedName = `${id}.${allowed[mime]}`;
    fs.writeFileSync(path.join(dir, storedName), buf);
    saved.push({
      id,
      kind,
      name: String(f.name || storedName).slice(0, 80),
      mime,
      size: buf.length,
      storedName,
      userId,
      createdAt: Date.now()
    });
  }
  if (!saved.length) throw new Error("لم يُرفع أي ملف صالح");
  return saved;
}

function fileAbsPath(orderId, file) {
  const abs = path.resolve(ROOT, String(orderId), String(file.storedName || ""));
  if (!abs.startsWith(path.resolve(ROOT))) throw new Error("مسار غير صالح");
  return abs;
}

function readFile(orderId, file) {
  return fs.readFileSync(fileAbsPath(orderId, file));
}

function publicFiles(files) {
  return (files || []).map((f) => ({
    id: f.id,
    kind: f.kind,
    label: kindLabel(f.kind),
    name: f.name,
    mime: f.mime,
    size: f.size,
    userId: f.userId,
    createdAt: f.createdAt
  }));
}

function findFile(files, fileId) {
  return (files || []).find((f) => f.id === fileId) || null;
}

function hasPaymentProof(files) {
  return (files || []).some((f) => f.kind === "payment_proof");
}

function isImage(file) {
  return file && String(file.mime || "").startsWith("image/");
}

function isVideo(file) {
  return file && String(file.mime || "").startsWith("video/");
}

function clearAll() {
  if (!fs.existsSync(ROOT)) {
    ensureDir(ROOT);
    return;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
  ensureDir(ROOT);
}

module.exports = {
  ROOT,
  saveFiles,
  readFile,
  fileAbsPath,
  publicFiles,
  findFile,
  hasPaymentProof,
  kindLabel,
  isImage,
  isVideo,
  clearAll
};
