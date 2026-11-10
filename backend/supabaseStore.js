const fs = require("fs");
const path = require("path");

const TABLE = "app_state";
const TEXT_ID = "main";
const NUM_ID = 1;
const CREATE_SQL = `${fs.readFileSync(path.join(__dirname, "supabase.sql"), "utf8")}

notify pgrst, 'reload schema';
`;

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
  if (/^postgres(ql)?:\/\//i.test(url)) return null;
  return { url, key };
}

function postgresUrl() {
  const direct = strip(
    process.env.USER_SUPABASE_DB_URL ||
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      process.env.POSTGRES_URL ||
      process.env.USER_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      ""
  );
  if (/^postgres(ql)?:\/\//i.test(direct)) return direct;
  const password = strip(
    process.env.USER_SUPABASE_DB_PASSWORD ||
      process.env.SUPABASE_DB_PASSWORD ||
      process.env.POSTGRES_PASSWORD ||
      ""
  );
  const rest = supabaseConfig();
  if (!password || !rest) return null;
  let ref = "";
  try {
    ref = new URL(rest.url).hostname.split(".")[0];
  } catch {
    return null;
  }
  if (!ref) return null;
  const encoded = encodeURIComponent(password);
  const region = strip(process.env.USER_SUPABASE_DB_REGION || process.env.SUPABASE_DB_REGION || "");
  if (region) {
    return `postgresql://postgres.${ref}:${encoded}@aws-0-${region}.pooler.supabase.com:6543/postgres?sslmode=require`;
  }
  return `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
}

function supabaseEnabled() {
  return !!(supabaseConfig() || postgresUrl());
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

function errCode(err) {
  const body = err && err.body;
  if (body && typeof body === "object") return String(body.code || "");
  const msg = String((err && err.message) || "");
  const m = msg.match(/"code"\s*:\s*"([^"]+)"/);
  return m ? m[1] : "";
}

function missingTableError(err) {
  const msg = String((err && err.message) || "");
  const code = errCode(err);
  return (
    (err && err.status === 404) ||
    code === "PGRST205" ||
    code === "42P01" ||
    /could not find the table|relation .* does not exist|PGRST205|42P01/i.test(msg)
  );
}

function bigintIdError(err) {
  const msg = String((err && err.message) || "");
  const code = errCode(err);
  return code === "22P02" || /invalid input syntax for type bigint/i.test(msg);
}

function identityIdError(err) {
  const msg = String((err && err.message) || "");
  return /cannot insert .* id|generated always|null value in column "id"/i.test(msg);
}

function payloadOf(row) {
  if (!row || typeof row !== "object") return null;
  const raw = row.payload != null ? row.payload : row.data != null ? row.data : row.state;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

let cachedRowId = null;

function rememberRowId(id) {
  if (id == null || id === "") return;
  cachedRowId = id;
}

function rowCandidates() {
  if (cachedRowId != null) return [cachedRowId];
  return [TEXT_ID, NUM_ID];
}

async function restTableReady() {
  const cfg = supabaseConfig();
  if (!cfg) return false;
  try {
    await fetchJson(
      `${cfg.url}/rest/v1/${TABLE}?select=id&limit=1`,
      { headers: headers(cfg.key) }
    );
    return true;
  } catch (err) {
    if (missingTableError(err)) return false;
    throw err;
  }
}

async function createTableViaPostgres() {
  const url = postgresUrl();
  if (!url) {
    throw new Error("missing USER_SUPABASE_DB_URL or USER_SUPABASE_DB_PASSWORD to create app_state");
  }
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    throw new Error("pg module missing");
  }
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000
  });
  await client.connect();
  try {
    await client.query(CREATE_SQL);
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

let ensurePromise = null;

async function ensureAppStateTableOnce() {
  if (!supabaseEnabled()) return false;
  let ready = false;
  try {
    ready = await restTableReady();
  } catch (err) {
    if (!missingTableError(err) && !bigintIdError(err)) {
      console.error("supabase table check:", err && err.message);
    }
  }
  if (postgresUrl()) {
    try {
      await createTableViaPostgres();
      if (!ready) console.log("created or repaired public.app_state in Supabase");
    } catch (err) {
      if (!ready) {
        console.error("supabase create app_state:", err && err.message);
        return false;
      }
      console.error("supabase repair app_state:", err && err.message);
    }
  } else if (!ready) {
    return false;
  }
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400 + i * 200));
    try {
      if (await restTableReady()) return true;
    } catch (err) {
      if (!missingTableError(err) && !bigintIdError(err)) break;
    }
  }
  try {
    return await restTableReady();
  } catch {
    return ready;
  }
}

function ensureAppStateTable() {
  if (!ensurePromise) ensurePromise = ensureAppStateTableOnce();
  return ensurePromise;
}

async function listRows(cfg) {
  const rows = await fetchJson(
    `${cfg.url}/rest/v1/${TABLE}?select=*&order=id.asc&limit=20`,
    { headers: headers(cfg.key) }
  );
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

async function pullSnapshot() {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  await ensureAppStateTable();
  try {
    const rows = await listRows(cfg);
    const chosen = rows.find((row) => payloadOf(row)) || rows[0];
    if (chosen && chosen.id != null) rememberRowId(chosen.id);
    return payloadOf(chosen);
  } catch (err) {
    if (missingTableError(err)) {
      ensurePromise = null;
      await ensureAppStateTable();
      return null;
    }
    throw err;
  }
}

function rowBody(payload, id) {
  const body = {
    payload,
    updated_at: new Date().toISOString()
  };
  if (id !== undefined) body.id = id;
  return body;
}

async function upsertRow(cfg, payload, id) {
  const body = rowBody(payload, id);
  const created = await fetchJson(`${cfg.url}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: headers(cfg.key, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(body)
  });
  const row = Array.isArray(created) ? created[0] : created;
  if (row && row.id != null) rememberRowId(row.id);
  else if (id !== undefined) rememberRowId(id);
}

async function patchRow(cfg, payload, id) {
  const created = await fetchJson(
    `${cfg.url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(rowBody(payload))
    }
  );
  const row = Array.isArray(created) ? created[0] : created;
  if (row && row.id != null) rememberRowId(row.id);
  else rememberRowId(id);
}

async function pushSnapshot(payload) {
  const cfg = supabaseConfig();
  if (!cfg) return false;
  if (!payload || typeof payload !== "object") return false;
  await ensureAppStateTable();
  if (cachedRowId != null) {
    try {
      await patchRow(cfg, payload, cachedRowId);
      return true;
    } catch (err) {
      if (!bigintIdError(err) && !missingTableError(err) && !identityIdError(err)) {
        /* try insert paths below */
      }
    }
  }
  const ids = rowCandidates();
  let lastErr = null;
  for (const id of ids) {
    try {
      await upsertRow(cfg, payload, id);
      return true;
    } catch (err) {
      lastErr = err;
      if (bigintIdError(err) || identityIdError(err)) {
        rememberRowId(typeof id === "number" ? id : NUM_ID);
        continue;
      }
      if (missingTableError(err)) {
        ensurePromise = null;
        const ok = await ensureAppStateTable();
        if (!ok) throw err;
        continue;
      }
    }
  }
  try {
    await upsertRow(cfg, payload);
    return true;
  } catch (err) {
    lastErr = err;
  }
  if (lastErr) throw lastErr;
  return false;
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
  ensureAppStateTable,
  pullSnapshot,
  pushSnapshot,
  queueSnapshot
};
