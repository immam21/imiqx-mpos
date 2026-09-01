# OneCounter Backend (Vercel)

This folder is a separate backend project that you can deploy independently on Vercel.

## What it provides

- Serverless APIs under `/api/*`
- Route-compatible endpoints for current frontend calls under `/api/v1/*`
- Auth mode options:
  - `AUTH_MODE=supabase` (recommended for deploy)
  - `AUTH_MODE=local_db` (development/testing only)

## Folder layout

- `api/health.js`
- `api/v1/[...route].js`
- `lib/auth-db.js`
- `lib/mock-state.js`
- `data/users.db.json`
- `.env.example`

## Deploy as separate Vercel project

1. Create a new Vercel project.
2. Select this same GitHub repo.
3. Set **Root Directory** to `backend-vercel`.
4. Add environment variables from `.env.example`.
5. Deploy.

Backend URL will be like:

`https://<your-backend-project>.vercel.app`

Set frontend env `ONECOUNTER_API_BASE_URL` to that URL.

## Local run

From repository root:

```bash
cd backend-vercel
vercel dev
```

Health check:

```bash
curl http://localhost:3000/api/health
```

Sample endpoint:

```bash
curl http://localhost:3000/api/v1/reports/dashboard
```

## Notes

- In serverless mode, in-memory state resets between cold starts.
- For production, replace mock state with Supabase table reads/writes.
- Do not store real secrets in committed files.

## Google Sheets backup

Vercel calls `/api/cron/backup` every two hours. Set `CRON_SECRET`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, and
`GOOGLE_SHEETS_SPREADSHEET_ID` in Vercel. Share the target spreadsheet with
the service-account email and create `Sales` and `Expenses` worksheets. The
cron appends newly created rows, including the staff member who recorded each
sale or expense.
