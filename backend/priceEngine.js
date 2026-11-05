const https = require("https");
const http = require("http");
const { URL } = require("url");

const cache = new Map();
const FETCH_MS = 8000;
const STALE_MS = 60 * 1000;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  let v = Number(value);
  if (!(v > 0)) return 0;
  if (min > 0 && v < min) v = min;
  if (max > 0 && v > max) v = max;
  return Math.round(v * 1e8) / 1e8;
}

function pairKey(asset, fiat) {
  return `${String(asset || "USDT").toUpperCase()}/${String(fiat || "SYP").toUpperCase()}`;
}

function rangeFor(settings, asset, fiat, side) {
  const list = Array.isArray(settings && settings.priceRanges) ? settings.priceRanges : [];
  const row = list.find((r) => String(r.asset) === String(asset) && String(r.fiat) === String(fiat)) || null;
  if (!row) return null;
  const isBuy = String(side || "").toUpperCase() === "BUY";
  const min = isBuy ? num(row.buyMin != null ? row.buyMin : row.min) : num(row.sellMin != null ? row.sellMin : row.min);
  const max = isBuy ? num(row.buyMax != null ? row.buyMax : row.max) : num(row.sellMax != null ? row.sellMax : row.max);
  return {
    asset: String(row.asset),
    fiat: String(row.fiat),
    min,
    max,
    buyMin: num(row.buyMin != null ? row.buyMin : row.min),
    buyMax: num(row.buyMax != null ? row.buyMax : row.max),
    sellMin: num(row.sellMin != null ? row.sellMin : row.min),
    sellMax: num(row.sellMax != null ? row.sellMax : row.max)
  };
}

function walkPath(obj, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc && acc[key] != null ? acc[key] : undefined), obj);
}

function extractPrice(payload) {
  if (payload == null) return 0;
  if (typeof payload === "number") return num(payload);
  if (typeof payload === "string") return num(payload);
  const candidates = [
    payload.price,
    payload.rate,
    payload.usd,
    payload.USDT,
    payload.usdt,
    payload.result,
    payload.value,
    payload.market,
    payload.marketPrice,
    payload.data && payload.data.price,
    payload.data && payload.data.rate,
    payload.data && payload.data.usd,
    payload.tether && (payload.tether.usd || payload.tether.syp),
    payload.ticker && payload.ticker.price,
    payload.result && payload.result.price
  ];
  for (const c of candidates) {
    const n = num(c);
    if (n > 0) return n;
  }
  return 0;
}

function httpGet(urlString, headers) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      reject(new Error("رابط مصدر السعر غير صالح"));
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
        headers: { Accept: "application/json", "User-Agent": "USDTSham/1.0", ...headers },
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

function peggedUsdMarket(asset, fiat) {
  const a = String(asset || "USDT").toUpperCase();
  const f = String(fiat || "").toUpperCase();
  if ((a === "USDT" || a === "USD") && (f === "USD" || f === "USDT")) return 1;
  return 0;
}

function defaultMarketUrl(asset, fiat) {
  const a = String(asset || "USDT").toLowerCase();
  const f = String(fiat || "USD").toLowerCase();
  const ids = a === "usdt" || a === "tether" ? "tether" : a;
  if (f === "syp" || f === "usd") return "";
  return `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(f)}`;
}

async function fetchMarket(settings, asset, fiat) {
  const pegged = peggedUsdMarket(asset, fiat);
  if (pegged > 0) return pegged;
  const key = (settings && settings.priceApiKey) || "";
  let url = String((settings && settings.priceApiUrl) || "").trim();
  if (url) {
    url = url
      .replace(/\{asset\}/gi, encodeURIComponent(asset))
      .replace(/\{fiat\}/gi, encodeURIComponent(fiat))
      .replace(/\{key\}/gi, encodeURIComponent(key));
  } else {
    url = defaultMarketUrl(asset, fiat);
  }
  if (!url) throw new Error("أدخل رابط مصدر السعر للتسعير التلقائي على هذا الزوج");
  const headers = {};
  const headerName = String((settings && settings.priceApiKeyHeader) || "X-API-Key").trim() || "X-API-Key";
  if (key && !url.includes(encodeURIComponent(key)) && !url.includes(key)) {
    if (/^authorization$/i.test(headerName)) headers.Authorization = `Bearer ${key}`;
    else headers[headerName] = key;
  }
  const payload = await httpGet(url, headers);
  const path = String((settings && settings.priceJsonPath) || "").trim();
  const fromPath = path ? num(walkPath(payload, path)) : 0;
  const price = fromPath > 0 ? fromPath : extractPrice(payload);
  if (!(price > 0)) throw new Error("تعذر قراءة سعر السوق من المصدر");
  return price;
}

function computeQuote(settings, asset, fiat, market) {
  const a = String(asset || "USDT").toUpperCase();
  const f = String(fiat || "SYP").toUpperCase();
  const sellRange = rangeFor(settings, a, f, "SELL") || {};
  const buyRange = rangeFor(settings, a, f, "BUY") || {};
  const sellMin = num(sellRange.min);
  const sellMax = num(sellRange.max);
  const buyMin = num(buyRange.min);
  const buyMax = num(buyRange.max);
  const mode = String((settings && settings.priceMode) || "manual") === "auto" ? "auto" : "manual";
  const sellSpread = num(settings && settings.sellSpreadPct);
  const buySpread = num(settings && settings.buySpreadPct);
  let sellPrice = 0;
  let buyPrice = 0;
  let source = "manual";
  if (mode === "auto" && market > 0) {
    sellPrice = market * (1 + sellSpread / 100);
    buyPrice = market * (1 - buySpread / 100);
    source = "auto";
  } else {
    sellPrice = num(settings && settings.manualSellPrice);
    buyPrice = num(settings && settings.manualBuyPrice);
    source = "manual";
  }
  sellPrice = clamp(sellPrice, sellMin, sellMax);
  buyPrice = clamp(buyPrice, buyMin, buyMax);
  return {
    asset: a,
    fiat: f,
    mode,
    source,
    market: market > 0 ? Math.round(market * 1e8) / 1e8 : 0,
    buyPrice,
    sellPrice,
    buySpreadPct: buySpread,
    sellSpreadPct: sellSpread,
    min: sellMin,
    max: sellMax,
    buyMin,
    buyMax,
    sellMin,
    sellMax,
    updatedAt: Date.now()
  };
}

async function quoteFor(settings, asset, fiat) {
  const a = String(asset || "USDT").toUpperCase();
  const f = String(fiat || "SYP").toUpperCase();
  const s = settings || {};
  const mode = String(s.priceMode || "manual") === "auto" ? "auto" : "manual";
  const key = pairKey(a, f);
  const cached = cache.get(key);
  if (mode !== "auto") {
    const q = computeQuote(s, a, f, 0);
    cache.set(key, q);
    return q;
  }
  const pegged = peggedUsdMarket(a, f);
  if (pegged > 0) {
    const q = computeQuote(s, a, f, pegged);
    cache.set(key, q);
    return q;
  }
  if (cached && Date.now() - cached.updatedAt < STALE_MS && cached.market > 0) {
    return computeQuote(s, a, f, cached.market);
  }
  try {
    const market = await fetchMarket(s, a, f);
    const q = computeQuote(s, a, f, market);
    cache.set(key, q);
    return q;
  } catch (e) {
    if (cached && cached.market > 0) {
      const q = computeQuote(s, a, f, cached.market);
      q.stale = true;
      q.error = e.message || "تعذر تحديث سعر السوق";
      return q;
    }
    const q = computeQuote(s, a, f, 0);
    q.error = e.message || "تعذر جلب سعر السوق";
    return q;
  }
}

function suggestedPrice(quote, side) {
  if (!quote) return 0;
  return String(side || "SELL").toUpperCase() === "BUY" ? num(quote.buyPrice) : num(quote.sellPrice);
}

function syncMarket(settings, asset, fiat) {
  const pegged = peggedUsdMarket(asset, fiat);
  if (pegged > 0) return pegged;
  const cached = cache.get(pairKey(asset, fiat));
  if (cached && cached.market > 0) return cached.market;
  return 0;
}

function resolveAdPrice(settings, ad, market) {
  const type = String(ad && ad.priceType) === "floating" ? "floating" : "fixed";
  const ratio = num(ad && ad.floatRatio, 1);
  const a = String((ad && ad.asset) || "USDT").toUpperCase();
  const f = String((ad && ad.fiat) || "SYP").toUpperCase();
  const range = rangeFor(settings, a, f, ad && ad.side) || {};
  const min = num(range.min);
  const max = num(range.max);
  if (type === "floating") {
    const m = num(market);
    const raw = m > 0 && ratio > 0 ? m * ratio : 0;
    return {
      price: clamp(raw, min, max),
      priceType: "floating",
      floatRatio: ratio > 0 ? ratio : 1,
      market: m,
      min,
      max
    };
  }
  return {
    price: num(ad && ad.price),
    priceType: "fixed",
    floatRatio: 1,
    market: num(market),
    min,
    max
  };
}

async function quoteAdPrice(settings, ad) {
  const type = String(ad && ad.priceType) === "floating" ? "floating" : "fixed";
  if (type !== "floating") return resolveAdPrice(settings, ad, 0);
  const quote = await quoteFor(settings, ad.asset, ad.fiat);
  const market = num(quote && quote.market) || syncMarket(settings, ad.asset, ad.fiat);
  return resolveAdPrice(settings, ad, market);
}

function publicQuote(q) {
  if (!q) return null;
  return {
    asset: q.asset,
    fiat: q.fiat,
    mode: q.mode,
    source: q.source,
    market: q.market || 0,
    buyPrice: q.buyPrice || 0,
    sellPrice: q.sellPrice || 0,
    buySpreadPct: q.buySpreadPct || 0,
    sellSpreadPct: q.sellSpreadPct || 0,
    min: q.min || 0,
    max: q.max || 0,
    buyMin: q.buyMin || 0,
    buyMax: q.buyMax || 0,
    sellMin: q.sellMin || 0,
    sellMax: q.sellMax || 0,
    updatedAt: q.updatedAt || 0,
    stale: !!q.stale,
    error: q.error || ""
  };
}

function publicPricing(settings) {
  const s = settings || {};
  return {
    priceMode: String(s.priceMode || "manual") === "auto" ? "auto" : "manual",
    buySpreadPct: num(s.buySpreadPct),
    sellSpreadPct: num(s.sellSpreadPct),
    manualBuyPrice: num(s.manualBuyPrice),
    manualSellPrice: num(s.manualSellPrice)
  };
}

module.exports = {
  quoteFor,
  computeQuote,
  suggestedPrice,
  publicQuote,
  publicPricing,
  rangeFor,
  peggedUsdMarket,
  syncMarket,
  resolveAdPrice,
  quoteAdPrice
};
