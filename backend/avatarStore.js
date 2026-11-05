const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname, "uploads", "avatars");
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const MAX_BYTES = 2 * 1024 * 1024;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function decodeDataUrl(data) {
  const raw = String(data || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("صيغة الصورة غير صالحة");
  return { mime: m[1].trim().toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

function dirOf(userId) {
  return path.join(ROOT, String(userId));
}

function clearDir(userId) {
  const dir = dirOf(userId);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, name));
  }
}

function saveAvatar(userId, dataUrl) {
  const { mime, buf } = decodeDataUrl(dataUrl);
  if (!ALLOWED[mime]) throw new Error("يُسمح بصور JPEG أو PNG أو WEBP فقط");
  if (!buf.length) throw new Error("ملف فارغ");
  if (buf.length > MAX_BYTES) throw new Error("حجم الصورة يجب ألا يتجاوز 2MB");
  const dir = dirOf(userId);
  ensureDir(dir);
  clearDir(userId);
  const id = `av_${crypto.randomBytes(8).toString("hex")}`;
  const storedName = `${id}.${ALLOWED[mime]}`;
  fs.writeFileSync(path.join(dir, storedName), buf);
  return { storedName, mime, size: buf.length };
}

function fileAbsPath(userId, storedName) {
  const abs = path.resolve(ROOT, String(userId), String(storedName || ""));
  if (!abs.startsWith(path.resolve(ROOT))) throw new Error("مسار غير صالح");
  return abs;
}

function removeAvatar(userId) {
  clearDir(userId);
}

module.exports = {
  saveAvatar,
  fileAbsPath,
  removeAvatar
};
