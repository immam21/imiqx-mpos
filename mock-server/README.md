# OneCounter Mock API

Run the local mock API server:

```bash
node mock-server/server.js
```

Default base URL: `http://localhost:8787`

Credential DB file:
- `mock-server/users.db.json`

Credentials are validated only from this DB file.
Do not hardcode credentials in frontend code or env files.

Health check:

```bash
curl http://localhost:8787/health
```

Auth endpoints:
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`

Data endpoints:
- `GET /v1/reports/dashboard`
- `GET /v1/orders`
- `POST /v1/orders/void`
- `POST /v1/orders/reprint`
- `GET /v1/inventory/products`
- `GET /v1/inventory/ledger`
- `POST /v1/inventory/labels/print`
- `GET /v1/customers`
- `GET /v1/promotions/campaigns`
- `GET /v1/reports/tax-summary`
- `GET /v1/reports/top-products`
- `GET /v1/reports/reconciliation`
- `GET /v1/integrations/status`
- `GET /v1/integrations/whatsapp/events`
- `POST /v1/integrations/whatsapp/send-receipt`
- `GET /v1/business/setup`
- `GET /v1/storefront/placeholder`
- `POST /v1/pos/sales`

## Vercel Deployment Notes

This mock server is designed for local development and runs as a long-lived Node process.

- Good for local: `node mock-server/server.js`
- Not recommended as-is for Vercel production runtime

For Vercel deployment:
- Deploy the static frontend from project root.
- Deploy your real backend separately, then set the frontend API base URL to that backend.

If you want this mock behavior on Vercel, migrate endpoints into Vercel serverless functions under an `api/` folder.

## Update Password Hashes

`users.db.json` stores `sha256` password hashes.

Generate a hash:

```bash
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('YourPassword').digest('hex'))"
```

Replace `password_hash` for the user in `users.db.json`.
