// Dependency-free Supabase REST (PostgREST) client using the service-role key.
// Server-side only. Never expose the service-role key to the browser.

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("supabase_not_configured");
  }
  return { url: url.replace(/\/$/, ""), key };
}

function baseHeaders() {
  const { key } = getConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

// GET rows from a table/view. `query` is a PostgREST query string, e.g.
// "select=*&store_id=eq.store-main&order=created_at.desc".
async function sbSelect(table, query = "") {
  const { url } = getConfig();
  const suffix = query ? `?${query}` : "";
  const res = await fetch(`${url}/rest/v1/${table}${suffix}`, {
    method: "GET",
    headers: baseHeaders()
  });
  if (!res.ok) {
    throw new Error(`supabase_select_failed:${table}:${res.status}:${await res.text()}`);
  }
  return res.json();
}

// INSERT one or more rows. Returns the inserted rows.
async function sbInsert(table, rows) {
  const { url } = getConfig();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...baseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    throw new Error(`supabase_insert_failed:${table}:${res.status}:${await res.text()}`);
  }
  return res.json();
}

// PATCH rows matching `filter` (a PostgREST query string). Returns updated rows.
async function sbUpdate(table, filter, patch) {
  const { url } = getConfig();
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...baseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(patch)
  });
  if (!res.ok) {
    throw new Error(`supabase_update_failed:${table}:${res.status}:${await res.text()}`);
  }
  return res.json();
}

// Call a Postgres function via PostgREST RPC. Returns the function result.
async function sbRpc(fn, args = {}) {
  const { url } = getConfig();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(args)
  });
  if (!res.ok) {
    throw new Error(`supabase_rpc_failed:${fn}:${res.status}:${await res.text()}`);
  }
  return res.json();
}

module.exports = { sbSelect, sbInsert, sbUpdate, sbRpc };
