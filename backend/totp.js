const crypto = require("crypto");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(str) {
  const clean = String(str || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

function totpAt(secret, timeMs) {
  const secretBuf = Buffer.isBuffer(secret) ? secret : fromBase32(secret);
  const counter = Math.floor(Number(timeMs) / 1000 / 30);
  return hotp(secretBuf, counter);
}

function generateTotpSecret() {
  return toBase32(crypto.randomBytes(20));
}

function normalizeOtpDigits(code) {
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9"
  };
  return String(code || "")
    .replace(/[٠-٩۰-۹]/g, (c) => map[c] || c)
    .replace(/\s+/g, "")
    .replace(/[^\d]/g, "");
}

function verifyTotp(secret, code, window = 2) {
  const expected = normalizeOtpDigits(code);
  if (!/^\d{6}$/.test(expected) || !secret) return false;
  const now = Date.now();
  const got = Buffer.from(expected);
  for (let i = -window; i <= window; i++) {
    const t = totpAt(secret, now + i * 30000);
    try {
      if (crypto.timingSafeEqual(Buffer.from(t), got)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function otpauthUrl(secret, account, issuer = "USDTSham") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = [
    `secret=${encodeURIComponent(String(secret || "").replace(/=+$/g, ""))}`,
    `issuer=${encodeURIComponent(issuer)}`,
    "algorithm=SHA1",
    "digits=6",
    "period=30"
  ].join("&");
  return `otpauth://totp/${label}?${params}`;
}

function formatSecretGroups(secret) {
  return String(secret || "")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

module.exports = {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
  formatSecretGroups,
  normalizeOtpDigits
};
