const TABLE = "app_state";
const ROW_ID = "main";

function strip(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");
}

function supabaseConfig() {
  const url = strip(process.env.USER_SUPABASE_URL || process.env.SUPABASE_URL || "");
  const key = strip(
    process.env.USER_SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      ""
  );
  if (!url || !key) return null;
  return { url, key };
}

function supabaseEnabled() {
  return !!supabaseConfig();
}

function headers(key, prefer) {
  const out = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
  if (prefer) out.Prefer = prefer;
  return out;
}

async function fetchJson(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = typeof data === "string" ? data : JSON.stringify(data);
      const err = new Error(`supabase ${res.status}: ${detail}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

async function pullSnapshot() {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const rows = await fetchJson(
    `${cfg.url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}&select=payload,updated_at`,
    { headers: headers(cfg.key, "return=representation") }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.payload || typeof row.payload !== "object") return null;
  return row.payload;
}

async function pushSnapshot(payload) {
  const cfg = supabaseConfig();
  if (!cfg) return false;
  if (!payload || typeof payload !== "object") return false;
  await fetchJson(`${cfg.url}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: headers(cfg.key, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      id: ROW_ID,
      payload,
      updated_at: new Date().toISOString()
    })
  });
  return true;
}

let pending = null;
let flushing = false;

function queueSnapshot(payload) {
  if (!supabaseEnabled()) return;
  try {
    pending = JSON.parse(JSON.stringify(payload));
  } catch {
    return;
  }
  flushSnapshots().catch((err) => {
    console.error("supabase save:", err && err.message);
  });
}

async function flushSnapshots() {
  if (flushing) return;
  flushing = true;
  try {
    while (pending) {
      const snap = pending;
      pending = null;
      await pushSnapshot(snap);
    }
  } finally {
    flushing = false;
    if (pending) {
      flushSnapshots().catch((err) => {
        console.error("supabase save:", err && err.message);
      });
    }
  }
}

module.exports = {
  supabaseEnabled,
  pullSnapshot,
  pushSnapshot,
  queueSnapshot
};
