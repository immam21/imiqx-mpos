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

async function replaceSheetRows(token, sheetName, rows) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("google_spreadsheet_not_configured");
  const range = `${sheetName}!A:Z`;
  const clearResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}"
    }
  );
  if (!clearResponse.ok) throw new Error(`google_sheet_clear_failed:${sheetName}:${clearResponse.status}`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A1`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
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
    customer_rows: details.customerRows || 0,
    error_message: details.errorMessage || null,
    completed_at: new Date().toISOString()
  }))).catch(() => {});
}

async function runBackup() {
  let businessIds = [];
  let salesRows = 0;
  let expenseRows = 0;
  let customerRows = 0;
  try {
    const [orders, expenses, customers] = await Promise.all([
      sbSelect("orders", "select=business_id,order_no,store_id,channel,customer_name,status,subtotal,tax_amount,discount_amount,total_amount,delivery_address,delivery_city,delivery_pincode,sold_by_user_id,sold_by_name,created_at&order=created_at.desc"),
      sbSelect("expenses", "select=business_id,id,store_id,expense_date,expense_at,category,description,amount,payment_mode,recorded_by_user_id,recorded_by_name,created_at&order=expense_at.desc"),
      sbSelect("customers", "select=business_id,customer_code,name,phone,place,full_address,city,pincode,created_at&order=created_at.desc")
    ]);
    businessIds = Array.from(new Set([...orders, ...expenses, ...customers].map((row) => row.business_id).filter(Boolean)));
    salesRows = orders.length;
    expenseRows = expenses.length;
    customerRows = customers.length;
    const backupAt = new Date().toISOString();
    const token = await googleAccessToken();
    await Promise.all([
      replaceSheetRows(token, "Sales", [
        ["Backup At", "Invoice No", "Store ID", "Channel", "Customer Name", "Status", "Subtotal", "Tax Amount", "Discount Amount", "Total Amount", "Delivery Address", "Delivery City", "Delivery Pincode", "Sold By User ID", "Sold By Name", "Sale Date & Time"],
        ...orders.map((order) => [backupAt, order.order_no, order.store_id, order.channel, order.customer_name, order.status, order.subtotal, order.tax_amount, order.discount_amount, order.total_amount, order.delivery_address, order.delivery_city, order.delivery_pincode, order.sold_by_user_id, order.sold_by_name, order.created_at])
      ]),
      replaceSheetRows(token, "Expenses", [
        ["Backup At", "Expense ID", "Store ID", "Expense Date", "Expense Date & Time", "Category", "Description", "Amount", "Payment Mode", "Recorded By User ID", "Recorded By Name", "Recorded At"],
        ...expenses.map((expense) => [backupAt, expense.id, expense.store_id, expense.expense_date, expense.expense_at, expense.category, expense.description, expense.amount, expense.payment_mode, expense.recorded_by_user_id, expense.recorded_by_name, expense.created_at])
      ]),
      replaceSheetRows(token, "Customers", [
        ["Backup At", "Customer Code", "Name", "Phone", "Place", "Full Address", "City", "Pincode", "Customer Created At"],
        ...customers.map((customer) => [backupAt, customer.customer_code, customer.name, customer.phone, customer.place, customer.full_address, customer.city, customer.pincode, customer.created_at])
      ])
    ]);
    await recordSyncRuns(businessIds, { status: "success", salesRows, expenseRows, customerRows });
    return { ok: true, mode: "full_snapshot", sales_rows: orders.length, expense_rows: expenses.length, customer_rows: customers.length };
  } catch (error) {
    const errorMessage = String(error.message || error).slice(0, 500);
    await recordSyncRuns(businessIds, { status: "error", salesRows, expenseRows, customerRows, errorMessage });
    throw new Error(errorMessage);
  }
}

async function backupHandler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    res.status(200).json(await runBackup());
  } catch (error) {
    res.status(500).json({ error: "backup_failed", message: String(error.message || error) });
  }
};

module.exports = backupHandler;
module.exports.runBackup = runBackup;