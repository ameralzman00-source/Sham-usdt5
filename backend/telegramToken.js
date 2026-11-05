const fs = require("fs");
const path = require("path");

function strip(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function readTokenFromFile(file) {
  try {
    if (!file || !fs.existsSync(file)) return "";
    const raw = fs.readFileSync(file, "utf8");
    const lines = String(raw || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.match(/^TELEGRAM_BOT_TOKEN\s*=\s*(.*)$/);
      const value = strip(eq ? eq[1] : trimmed);
      if (value) return value;
    }
    return "";
  } catch {
    return "";
  }
}

function envFile() {
  if (process.env.DATA_DIR) return path.join(path.resolve(process.env.DATA_DIR), ".env");
  return path.join(__dirname, ".env");
}

function telegramBotToken() {
  const fromEnv = strip(process.env.TELEGRAM_BOT_TOKEN);
  if (fromEnv) return fromEnv;
  const files = [envFile(), "/tmp/bot_token_env"];
  for (const file of files) {
    const token = readTokenFromFile(file);
    if (token) return token;
  }
  return "";
}

function tokenHint(token) {
  const t = strip(token || telegramBotToken());
  if (!t) return "";
  if (t.length <= 12) return "••••••••";
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function looksLikeToken(value) {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(strip(value));
}

function writeTelegramBotToken(token) {
  const value = strip(token);
  const file = envFile();
  let lines = [];
  try {
    if (fs.existsSync(file)) {
      lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    }
  } catch {
    lines = [];
  }
  let written = false;
  const next = lines.map((line) => {
    if (/^\s*TELEGRAM_BOT_TOKEN\s*=/.test(line)) {
      written = true;
      return value ? `TELEGRAM_BOT_TOKEN=${value}` : "TELEGRAM_BOT_TOKEN=";
    }
    return line;
  });
  if (!written) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(value ? `TELEGRAM_BOT_TOKEN=${value}` : "TELEGRAM_BOT_TOKEN=");
  }
  const body = next.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
  if (value) process.env.TELEGRAM_BOT_TOKEN = value;
  else delete process.env.TELEGRAM_BOT_TOKEN;
  return value;
}

function clearTelegramBotToken() {
  return writeTelegramBotToken("");
}

module.exports = {
  telegramBotToken,
  tokenHint,
  looksLikeToken,
  writeTelegramBotToken,
  clearTelegramBotToken
};
