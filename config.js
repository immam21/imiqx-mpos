// PUBLIC runtime config — SAFE TO COMMIT (no secrets here).
// This file IS deployed. For local dev, config.local.js (gitignored) overrides it.
//
// If your backend (backend-vercel) is deployed as a SEPARATE Vercel project,
// set __ONECOUNTER_API_BASE_URL__ below to that backend URL, e.g.
//   window.__ONECOUNTER_API_BASE_URL__ = "https://your-backend.vercel.app";
(function () {
  var isLocal = ["localhost", "127.0.0.1"].indexOf(location.hostname) !== -1;

  // Backend API base URL. Same-origin in production, localhost:8787 in dev.
  window.__ONECOUNTER_API_BASE_URL__ = isLocal ? "http://localhost:8787" : "https://imiqx-mpos-backend.vercel.app";

  window.__ONECOUNTER_BUSINESS_ID__ = "business-main";
  window.__ONECOUNTER_STORE_ID__ = "store-main";

  // Public Supabase values (safe to expose). Leave blank by default so the app uses
  // the local credential database unless Supabase is explicitly configured.
  window.__ONECOUNTER_SUPABASE_URL__ = "";
  window.__ONECOUNTER_SUPABASE_ANON_KEY__ = "";
})();
