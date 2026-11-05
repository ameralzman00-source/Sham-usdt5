const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { telegramBotToken, tokenHint } = require("./telegramToken");

const PID_FILE = "/tmp/usdtsham-bot.pid";
const LOG_FILE = "/tmp/usdtsham-bot.log";
const BOT_SCRIPT = path.join(__dirname, "bot.js");

let child = null;

function pidRunning(pid) {
  const n = Number(pid);
  if (!n) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    return Number(String(fs.readFileSync(PID_FILE, "utf8") || "").trim()) || 0;
  } catch {
    return 0;
  }
}

function writePid(pid) {
  try {
    fs.writeFileSync(PID_FILE, String(pid), "utf8");
  } catch {
    /* ignore */
  }
}

function clearPid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function findBotPids() {
  try {
    const out = execSync("ps -eo pid,args", { encoding: "utf8" });
    return out
      .split("\n")
      .filter((line) => /node\s+.*bot\.js/.test(line) && !/ps -eo/.test(line))
      .map((line) => Number(String(line).trim().split(/\s+/)[0]))
      .filter((pid) => pid && pid !== process.pid);
  } catch {
    return [];
  }
}

function adoptExisting() {
  if (child && pidRunning(child.pid)) return child.pid;
  const pid = readPid();
  if (pid && pidRunning(pid)) return pid;
  const live = findBotPids();
  if (live[0]) {
    writePid(live[0]);
    return live[0];
  }
  return 0;
}

function status() {
  const token = telegramBotToken();
  const pid = adoptExisting();
  const running = pid > 0;
  return {
    running,
    pid: running ? pid : 0,
    tokenSet: !!token,
    tokenHint: tokenHint(token)
  };
}

function stop() {
  const pids = new Set();
  if (child && child.pid) pids.add(child.pid);
  const filePid = readPid();
  if (filePid) pids.add(filePid);
  findBotPids().forEach((pid) => pids.add(pid));
  pids.forEach((pid) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  });
  child = null;
  clearPid();
  return { running: false, pid: 0, tokenSet: !!telegramBotToken(), tokenHint: tokenHint() };
}

function start() {
  const token = telegramBotToken();
  if (!token) {
    return { ...status(), ok: false, error: "ضع توكن بوت تلغرام أولاً ثم شغّل البوت." };
  }
  stop();
  const out = fs.openSync(LOG_FILE, "a");
  child = spawn(process.execPath, [BOT_SCRIPT], {
    env: { ...process.env, TELEGRAM_BOT_TOKEN: token },
    stdio: ["ignore", out, out],
    detached: true
  });
  fs.closeSync(out);
  child.unref();
  child.on("exit", () => {
    if (child && child.exitCode !== null) {
      if (readPid() === child.pid) clearPid();
      child = null;
    }
  });
  writePid(child.pid);
  return { ...status(), ok: true };
}

module.exports = { status, start, stop };
