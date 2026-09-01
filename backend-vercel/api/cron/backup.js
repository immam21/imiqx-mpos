const crypto = require("crypto");
const { sbSelect, sbInsert } = require("../../lib/supabase-rest");

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("google_service_account_not_configured");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${signer.sign(privateKey, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  if (!response.ok) throw new Error(`google_token_failed:${response.status}`);
  return (await response.json()).access_token;
}

async function appendRows(token, sheetName, rows) {
  if (!rows.length) return;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("google_spreadsheet_not_configured");
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows })
    }
  );
  if (!response.ok) throw new Error(`google_sheet_append_failed:${sheetName}:${response.status}`);
}

async function recordSyncRuns(businessIds, details) {
  if (!businessIds.length) return;
  await sbInsert("google_sheets_sync_runs", businessIds.map((businessId) => ({
    business_id: businessId,
    status: details.status,
    sales_rows: details.salesRows || 0,
    expense_rows: details.expenseRows || 0,
    error_message: details.errorMessage || null,
    completed_at: new Date().toISOString()
  }))).catch(() => {});
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  let businessIds = [];
  let salesRows = 0;
  let expenseRows = 0;
  try {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const [orders, expenses] = await Promise.all([
      sbSelect("orders", `select=business_id,order_no,store_id,customer_name,status,subtotal,tax_amount,total_amount,sold_by_user_id,sold_by_name,created_at&created_at=gte.${encodeURIComponent(since)}`),
      sbSelect("expenses", `select=business_id,id,store_id,expense_date,category,description,amount,payment_mode,recorded_by_user_id,recorded_by_name,created_at&created_at=gte.${encodeURIComponent(since)}`)
    ]);
    businessIds = Array.from(new Set([...orders, ...expenses].map((row) => row.business_id).filter(Boolean)));
    salesRows = orders.length;
    expenseRows = expenses.length;
    const backupAt = new Date().toISOString();
    const token = await googleAccessToken();
    await Promise.all([
      appendRows(token, "Sales", orders.map((order) => [backupAt, order.order_no, order.store_id, order.customer_name, order.status, order.subtotal, order.tax_amount, order.total_amount, order.sold_by_user_id, order.sold_by_name, order.created_at])),
      appendRows(token, "Expenses", expenses.map((expense) => [backupAt, expense.id, expense.store_id, expense.expense_date, expense.category, expense.description, expense.amount, expense.payment_mode, expense.recorded_by_user_id, expense.recorded_by_name, expense.created_at]))
    ]);
    await recordSyncRuns(businessIds, { status: "success", salesRows, expenseRows });
    res.status(200).json({ ok: true, since, sales_rows: orders.length, expense_rows: expenses.length });
  } catch (error) {
    const errorMessage = String(error.message || error).slice(0, 500);
    await recordSyncRuns(businessIds, { status: "error", salesRows, expenseRows, errorMessage });
    res.status(500).json({ error: "backup_failed", message: errorMessage });
  }
};