# OneCounter SaaS PWA

A static, installable PWA shell for OneCounter retail operations. The UI now
includes module-level API wiring hooks plus an offline POS outbox queue in the
service worker.

## Files

| File | Purpose |
|---|---|
| `index.html` | Full SaaS UI shell (Dashboard, POS, Orders, Inventory, Customers, Promotions, Reports, Integrations, Settings) |
| `sw.js` | App shell caching + offline POS transaction queue + replay sync |
| `manifest.json` | PWA metadata |
| `.env.example` | Environment variable template for frontend base values and backend credentials |
| `config.local.example.js` | Optional local runtime overrides for API base/store/business IDs |
| `mock-server/server.js` | Tiny local API server for immediate UI data and auth token simulation |
| `mock-server/users.db.json` | Local credential DB used by mock auth login |
| `api-contracts/openapi.v1.yaml` | Full OpenAPI contract for all `/v1` routes |
| `api-contracts/schemas/requests.json` | Request schemas by endpoint |
| `api-contracts/schemas/responses.json` | Response schemas by endpoint |
| `login.html` | Dedicated full-page login experience |
| `supabase/auth-schema.sql` | Supabase profile + role/store access schema for login metadata |

## Run Locally

Use any local server (service workers do not work over `file://`).

```bash
npx serve .
```

Then open the local URL printed in terminal.

In a second terminal, start mock API:

```bash
node mock-server/server.js

Alternative frontend server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Login URL:
- `http://localhost:8080/login.html`

Login credentials:
- Managed only in `mock-server/users.db.json` (local mock) or Supabase Auth users.
- No credentials are read from env files.
```

## Credentials and Env Setup

### 1) Add env values

```bash
cp .env.example .env
```

Fill `.env` with your real values.

Important:
- `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_ACCESS_TOKEN`, and
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` are backend-only secrets.
- Do not expose backend secrets in browser JavaScript.

### 2) Frontend runtime values (safe/public)

This static PWA reads these globals (with fallback defaults):
- `window.__ONECOUNTER_API_BASE_URL__`
- `window.__ONECOUNTER_BUSINESS_ID__`
- `window.__ONECOUNTER_STORE_ID__`
- `window.__ONECOUNTER_SUPABASE_URL__`
- `window.__ONECOUNTER_SUPABASE_ANON_KEY__`

To override locally:

```bash
cp config.local.example.js config.local.js
```

`index.html` already loads `config.local.js` if present.

## API Wiring Added

`index.html` now includes:
- Auth endpoints (`/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`)
- API endpoint map (`/v1/reports/dashboard`, `/v1/orders`, `/v1/orders/void`, `/v1/orders/reprint`, `/v1/inventory/products`, `/v1/inventory/ledger`, `/v1/inventory/labels/print`, `/v1/customers`, `/v1/promotions/campaigns`, `/v1/reports/tax-summary`, `/v1/reports/top-products`, `/v1/reports/reconciliation`, `/v1/integrations/status`, `/v1/integrations/whatsapp/events`, `/v1/integrations/whatsapp/send-receipt`, `/v1/business/setup`, `/v1/storefront/placeholder`, `/v1/pos/sales`)
- Supabase auth wiring (email/password login, logout, refresh-token rotation)
- Auth-aware `apiFetch` helper (Bearer token + store/business headers + auto-refresh/retry on 401)
- Per-module entity mapping aligned to platform architecture
- POS sale submit flow posting to `/v1/pos/sales`
- Order void + reprint actions with audit behavior hooks
- Inventory label print + stock ledger views
- Reports reconciliation + top products panels
- Integrations WhatsApp event log and receipt dispatch action
- Multi-store selector and role-based session timeout behavior

When Supabase config is absent, the app automatically falls back to mock auth endpoints.

## Supabase Auth Setup

1. Put `SUPABASE_URL` and `SUPABASE_ANON_KEY` into `config.local.js`.
2. In Supabase Auth, enable Email provider.
3. Create a user (or sign up) and login from the in-app Login button.
4. The app stores access/refresh tokens in local storage and refreshes 60s before expiry.

Supabase login metadata schema is available in:
- `supabase/auth-schema.sql`

Note:
- Passwords are managed by Supabase Auth (`auth.users`), not in custom tables.
- Use `app_users` and `user_store_access` for role and store-level access mapping.

Backend must still validate JWT and apply RBAC + tenant scope checks.

## API Contracts

Use the contract files for backend implementation:
- `api-contracts/openapi.v1.yaml`
- `api-contracts/schemas/requests.json`
- `api-contracts/schemas/responses.json`

## Offline POS Queueing Added

`sw.js` now supports true offline-first writes for POS sales:
- Intercepts `POST` requests ending in `/v1/pos/sales`
- If network fails, request is stored in IndexedDB outbox
- Returns `202` queued response to the UI
- Replays queued requests on:
  - Background sync tag `pos-outbox-sync`
  - Service worker activation
  - Online event trigger via `postMessage({ type: "SYNC_POS_QUEUE" })`

## Recommended Backend Alignment

Use this entity ownership per module:
- Dashboard: `sales`, `payments`, `inventory_ledger`, `webhook_logs`
- POS: `sales`, `sale_items`, `payments`, `customers`
- Orders: `sales`, `refunds`, `customers`
- Inventory: `products`, `inventory_ledger`, `purchase_orders`, `suppliers`
- Customers: `customers`, `segments`, `campaign_events`
- Promotions: `campaigns`, `campaign_events`, `customers`
- Reports: `sales`, `payments`, `tax_profiles`, `invoices`
- Integrations: `integrations`, `webhook_logs`, `audit_logs`
- Settings: `businesses`, `stores`, `users`, `roles`, `invoice_series`

## Deploy To Vercel

This project has two parts:
- Static frontend (this repo root)
- API backend (mock server for dev, real backend for production)

### Option A: Deploy Frontend To Vercel + Use External API (recommended)

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. In project settings, configure:
  - Framework preset: Other
  - Build command: leave empty (or use `echo no-build`)
  - Output directory: `.`
4. Add public runtime config by generating `config.local.js` during build.

Use this Build Command in Vercel:

```bash
cat > config.local.js <<EOF
window.__ONECOUNTER_API_BASE_URL__ = "${ONECOUNTER_API_BASE_URL}";
window.__ONECOUNTER_BUSINESS_ID__ = "${ONECOUNTER_BUSINESS_ID}";
window.__ONECOUNTER_STORE_ID__ = "${ONECOUNTER_STORE_ID}";
window.__ONECOUNTER_SUPABASE_URL__ = "${ONECOUNTER_SUPABASE_URL}";
window.__ONECOUNTER_SUPABASE_ANON_KEY__ = "${ONECOUNTER_SUPABASE_ANON_KEY}";
EOF
```

5. Add these Vercel environment variables:
  - `ONECOUNTER_API_BASE_URL` (example: `https://your-api.example.com`)
  - `ONECOUNTER_BUSINESS_ID`
  - `ONECOUNTER_STORE_ID`
  - `ONECOUNTER_SUPABASE_URL`
  - `ONECOUNTER_SUPABASE_ANON_KEY`

Important:
- Do not place secret backend keys in frontend runtime config.
- `SUPABASE_SERVICE_ROLE_KEY`, WhatsApp private tokens, and Google service-account private keys must stay on your backend only.

### Option B: Keep Mock API For Local Testing Only

The file `mock-server/server.js` is a local long-running Node server meant for development.
For production on Vercel, use serverless routes or deploy your backend separately (Railway, Render, Fly.io, or Supabase Edge Functions) and point `ONECOUNTER_API_BASE_URL` to it.
