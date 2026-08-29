// Local development server for the OneCounter backend.
// Loads backend-vercel/.env, then serves the same handler used on Vercel,
// so the app runs against a real Supabase database without the Vercel CLI.
//
//   node backend-vercel/dev-server.js
//
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// Minimal .env loader (Node 18 has no built-in --env-file support).
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.join(__dirname, ".env"));
loadEnv(path.join(__dirname, "..", ".env"));

const handler = require("./api/v1/[...route].js");

const PORT = Number(process.env.PORT || 8787);

// Adapt a Node req/res pair to the Vercel handler contract (req.query, res.status/json).
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true, service: "onecounter-backend", db: Boolean(process.env.SUPABASE_URL) }));
    return;
  }

  const routePart = requestUrl.pathname.replace(/^\/v1\//, "").replace(/^\//, "");
  req.query = { route: routePart ? routePart.split("/") : [] };

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
    return res;
  };

  try {
    await handler(req, res);
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "server_error", message: String(err && err.message ? err.message : err) }));
  }
});

server.listen(PORT, () => {
  const mode = process.env.SUPABASE_URL ? "supabase (real DB)" : "NOT CONFIGURED";
  // eslint-disable-next-line no-console
  console.log(`OneCounter backend listening on http://localhost:${PORT} [data source: ${mode}]`);
});
