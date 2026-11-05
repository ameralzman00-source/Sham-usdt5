const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname, "uploads", "kyc");
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};
const KINDS = ["id_front", "id_back", "selfie", "residence", "extra"];
const MAX_BYTES = 4 * 1024 * 1024;
const BASIC_KINDS = ["id_front", "id_back", "selfie"];
const ADVANCED_KINDS = ["residence"];

const KIND_LABELS = {
  id_front: "وجه الهوية",
  id_back: "ظهر الهوية",
  selfie: "صورة شخصية مع الوثيقة",
  residence: "إثبات السكن",
  extra: "مستند إضافي"
};

const DOC_LABELS = {
  id: "بطاقة هوية",
  passport: "جواز سفر",
  license: "رخصة"
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

function docLabel(type) {
  return DOC_LABELS[type] || type || "وثيقة";
}

function decodeDataUrl(data) {
  const raw = String(data || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("صيغة الملف غير صالحة");
  return { mime: m[1].trim().toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

function saveFiles(userId, files) {
  const dir = path.join(ROOT, String(userId));
  ensureDir(dir);
  const saved = [];
  for (const f of files || []) {
    if (!KINDS.includes(f.kind)) continue;
    const { mime, buf } = decodeDataUrl(f.data);
    if (!ALLOWED[mime]) throw new Error("يُسمح بصور JPEG/PNG/WEBP أو ملف PDF فقط");
    if (!buf.length) throw new Error("ملف فارغ");
    if (buf.length > MAX_BYTES) throw new Error("حجم كل ملف يجب ألا يتجاوز 4MB");
    const id = `kf_${crypto.randomBytes(8).toString("hex")}`;
    const storedName = `${id}.${ALLOWED[mime]}`;
    fs.writeFileSync(path.join(dir, storedName), buf);
    saved.push({
      id,
      kind: f.kind,
      name: String(f.name || storedName).slice(0, 80),
      mime,
      size: buf.length,
      storedName
    });
  }
  return saved;
}

function fileAbsPath(userId, file) {
  const abs = path.resolve(ROOT, String(userId), String(file.storedName || ""));
  if (!abs.startsWith(path.resolve(ROOT))) throw new Error("مسار غير صالح");
  return abs;
}

function readFile(userId, file) {
  return fs.readFileSync(fileAbsPath(userId, file));
}

function hasKinds(kyc, kinds) {
  const files = (kyc && kyc.files) || [];
  return kinds.every((kind) => files.some((f) => f.kind === kind));
}

function hasRequiredFiles(kyc) {
  return hasKinds(kyc, BASIC_KINDS);
}

function hasAdvancedFiles(kyc) {
  return hasKinds(kyc, ADVANCED_KINDS);
}

function publicFiles(kyc) {
  return ((kyc && kyc.files) || []).map((f) => ({
    id: f.id,
    kind: f.kind,
    label: kindLabel(f.kind),
    name: f.name,
    mime: f.mime,
    size: f.size
  }));
}

function findFile(kyc, fileId) {
  return ((kyc && kyc.files) || []).find((f) => f.id === fileId) || null;
}

function clearAll() {
  if (!fs.existsSync(ROOT)) {
    ensureDir(ROOT);
    return;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
  ensureDir(ROOT);
}

function clearUser(userId) {
  const dir = path.join(ROOT, String(userId || ""));
  if (!userId || !fs.existsSync(dir)) return;
  try {
    fs.renameSync(dir, `${dir}.removed-${Date.now()}`);
  } catch {
    /* ignore */
  }
}

function isImage(file) {
  return file && String(file.mime || "").startsWith("image/");
}

module.exports = {
  ROOT,
  KINDS,
  BASIC_KINDS,
  ADVANCED_KINDS,
  REQUIRED_KINDS: BASIC_KINDS,
  KIND_LABELS,
  saveFiles,
  fileAbsPath,
  readFile,
  hasRequiredFiles,
  hasAdvancedFiles,
  publicFiles,
  findFile,
  clearAll,
  clearUser,
  kindLabel,
  docLabel,
  isImage
};
