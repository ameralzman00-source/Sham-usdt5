const https = require("https");
const http = require("http");
const { URL } = require("url");

const STABLE = { USDT: 1, USD: 1, BUSD: 1 };
const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "USDCUSDT"];
const TTL = 60 * 1000;
const FETCH_MS = 8000;

let cache = {
  rates: { USDT: 1, USD: 1, USDC: 1, BTC: 0, ETH: 0, BNB: 0 },
  at: 0
};

function httpGet(urlString) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      reject(new Error("رابط السعر غير صالح"));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "USDTSham/1.0" },
        timeout: FETCH_MS
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`مصدر السعر أعاد ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error("مصدر السعر لم يُرجع JSON صالحاً"));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("انتهت مهلة مصدر السعر"));
    });
    req.on("error", (e) => reject(e));
    req.end();
  });
}

async function refresh(force) {
  if (!force && cache.at && Date.now() - cache.at < TTL) return cache.rates;
  try {
    const url =
      "https://api.binance.com/api/v3/ticker/price?symbols=" +
      encodeURIComponent(JSON.stringify(PAIRS));
    const data = await httpGet(url);
    const rows = Array.isArray(data) ? data : [];
    const rates = { USDT: 1, USD: 1, USDC: 1, BTC: 0, ETH: 0, BNB: 0 };
    rows.forEach((row) => {
      const sym = String(row.symbol || "").toUpperCase();
      const base = sym.replace(/USDT$/, "");
      const p = Number(row.price);
      if (base && p > 0) rates[base] = p;
    });
    if (!(rates.USDC > 0)) rates.USDC = 1;
    cache = { rates, at: Date.now() };
  } catch {
    if (!cache.at) cache.at = Date.now();
  }
  return cache.rates;
}

function usdRate(asset, rates) {
  const s = String(asset || "").toUpperCase();
  if (STABLE[s]) return 1;
  const table = rates || cache.rates;
  const n = Number(table[s]);
  return n > 0 ? n : 0;
}

function withPrices(assets, rates) {
  const table = rates || cache.rates;
  return (assets || []).map((a) => ({
    ...a,
    usdPrice: usdRate(a.symbol, table)
  }));
}

function getCached() {
  return cache.rates;
}

function updatedAt() {
  return cache.at || 0;
}

module.exports = { refresh, usdRate, withPrices, getCached, updatedAt };
