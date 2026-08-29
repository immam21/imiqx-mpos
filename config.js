// PUBLIC runtime config — SAFE TO COMMIT (no secrets here).
// This file IS deployed. For local dev, config.local.js (gitignored) overrides it.
//
// If your backend (backend-vercel) is deployed as a SEPARATE Vercel project,
// set __ONECOUNTER_API_BASE_URL__ below to that backend URL, e.g.
//   window.__ONECOUNTER_API_BASE_URL__ = "https://your-backend.vercel.app";
(function () {
  var isLocal = ["localhost", "127.0.0.1"].indexOf(location.hostname) !== -1;

  // Backend API base URL. Same-origin in production, localhost:8787 in dev.
  window.__ONECOUNTER_API_BASE_URL__ = isLocal ? "http://localhost:8787" : location.origin;

  window.__ONECOUNTER_BUSINESS_ID__ = "business-main";
  window.__ONECOUNTER_STORE_ID__ = "store-main";

  // Public Supabase values (safe to expose). Service-role key stays on the backend.
  window.__ONECOUNTER_SUPABASE_URL__ = "https://oisuwwdykgpghqcvbesj.supabase.co";
  window.__ONECOUNTER_SUPABASE_ANON_KEY__ = "sb_publishable_D8K21sPXMfV2lh_G_npiUA_-_SDzEbT";
})();
