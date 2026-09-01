const { findUserByEmail, verifyPassword } = require("../../lib/auth-db");
const { sbSelect, sbInsert, sbUpdate } = require("../../lib/supabase-rest");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Store-Id, X-Business-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, status, data) {
  setCors(res);
  res.status(status).json(data);
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfDaysAgoIso(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function startOfWeekIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}

function startOfMonthIso() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function encode(value) {
  return encodeURIComponent(String(value));
}

function getRouteSegments(req) {
  const rawRoute = req.query && req.query.route;
  if (Array.isArray(rawRoute)) {
    return rawRoute.filter(Boolean);
  }
  if (typeof rawRoute === "string" && rawRoute.trim()) {
    return rawRoute.split("/").filter(Boolean);
  }
  return [];
}

function titleCaseStatus(value) {
  const v = String(value || "");
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

function channelLabel(value) {
  return value === "in_store" ? "In-Store" : value === "online" ? "Online" : value || "";
}

function getStoreCode(req) {
  return req.headers["x-store-id"] || process.env.ONECOUNTER_STORE_ID || "store-main";
}

function getBusinessCode(req) {
  return req.headers["x-business-id"] || process.env.ONECOUNTER_BUSINESS_ID || "business-main";
}

// -------------------------------------------------------------------------
// Code -> UUID resolution (cached; the DB keys everything by UUID)
// -------------------------------------------------------------------------
const businessCache = new Map();
const storeCache = new Map();

async function resolveBusinessId(code) {
  if (businessCache.has(code)) {
    return businessCache.get(code);
  }
  const rows = await sbSelect("businesses", `select=id&code=eq.${encode(code)}&limit=1`);
  if (!rows.length) {
    throw new Error(`business_not_found:${code}`);
  }
  businessCache.set(code, rows[0].id);
  return rows[0].id;
}

async function resolveStoreId(code, businessId) {
  const key = `${businessId}:${code}`;
  if (storeCache.has(key)) {
    return storeCache.get(key);
  }
  const rows = await sbSelect("stores", `select=id&code=eq.${encode(code)}&business_id=eq.${encode(businessId)}&limit=1`);
  if (!rows.length) {
    throw new Error(`store_not_found:${code}`);
  }
  storeCache.set(key, rows[0].id);
  return rows[0].id;
}

async function resolveContext(req) {
  const businessCode = getBusinessCode(req);
  const storeCode = getStoreCode(req);
  const businessId = await resolveBusinessId(businessCode);
  const storeId = await resolveStoreId(storeCode, businessId);
  return { businessCode, storeCode, businessId, storeId };
}

// -------------------------------------------------------------------------
// Auth (Supabase or local mock fallback)
// -------------------------------------------------------------------------
function getAuthMode() {
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (process.env.AUTH_MODE) {
    return process.env.AUTH_MODE;
  }
  return process.env.SUPABASE_URL && pub ? "supabase" : "local_db";
}

const mockAuthSessions = {};
const mockAccessSessions = {};

function issueMockToken(user) {
  const refreshToken = `mock-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    access_token: `mock-access-${Date.now()}`,
    token_type: "bearer",
    expires_in: 900,
    refresh_token: refreshToken,
    user: { id: user.id || "user-mock-1", email: user.email || "", role: user.role || "manager" }
  };
  mockAuthSessions[refreshToken] = { id: payload.user.id, email: payload.user.email, role: payload.user.role, issued_at: nowIso() };
  mockAccessSessions[payload.access_token] = payload.user;
  return payload;
}

async function resolveActor(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (getAuthMode() === "local_db") {
    return mockAccessSessions[token] || null;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !pub) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: pub, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return {
    id: user.id,
    email: user.email || "",
    name: (user.user_metadata && user.user_metadata.full_name) || user.email || ""
  };
}

async function supabasePasswordLogin(email, password) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: pub },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    throw new Error("supabase_login_failed");
  }
  return res.json();
}

async function supabaseRefresh(refreshToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: pub },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!res.ok) {
    throw new Error("supabase_refresh_failed");
  }
  return res.json();
}

async function supabaseLogout(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  await fetch(`${supabaseUrl}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: pub, Authorization: `Bearer ${accessToken}` }
  });
}

// -------------------------------------------------------------------------
// User admin via Supabase Admin API (service role). Hardcoded gate code.
// -------------------------------------------------------------------------
const ADMIN_CODE = process.env.ADMIN_USER_CODE || "1521";

function adminHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function adminListUsers() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, { headers: adminHeaders() });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return Array.isArray(data.users) ? data.users : Array.isArray(data) ? data : [];
}

async function adminCreateUser(email, password, role) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: role ? { role } : {}
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { error: true, message: data.msg || data.error_description || data.error || "create_failed" };
  }
  return { error: false };
}

async function adminDeleteUser(userId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encode(userId)}`, {
    method: "DELETE",
    headers: adminHeaders()
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { error: true, message: data.msg || data.error || "delete_failed" };
  }
  return { error: false };
}

// -------------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.status(204).end();
    return;
  }

  const route = getRouteSegments(req).join("/");
  const pathname = `/v1/${route}`;

  try {
    // ------------------------- Auth -------------------------
    if (pathname === "/v1/auth/login" && req.method === "POST") {
      const body = await parseBody(req);
      if (getAuthMode() === "supabase") {
        sendJson(res, 200, await supabasePasswordLogin(body.email, body.password));
        return;
      }
      const user = findUserByEmail(body.email);
      if (!user || !verifyPassword(user, body.password)) {
        sendJson(res, 401, { error: "invalid_credentials" });
        return;
      }
      sendJson(res, 200, issueMockToken(user));
      return;
    }

    if (pathname === "/v1/auth/refresh" && req.method === "POST") {
      const body = await parseBody(req);
      if (getAuthMode() === "supabase") {
        sendJson(res, 200, await supabaseRefresh(body.refresh_token));
        return;
      }
      const session = mockAuthSessions[body.refresh_token];
      if (!session) {
        sendJson(res, 401, { error: "invalid_refresh_token" });
        return;
      }
      delete mockAuthSessions[body.refresh_token];
      sendJson(res, 200, issueMockToken(session));
      return;
    }

    if (pathname === "/v1/auth/logout" && req.method === "POST") {
      const body = await parseBody(req);
      if (getAuthMode() === "supabase") {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (token) {
          await supabaseLogout(token);
        }
      } else if (body.refresh_token) {
        delete mockAuthSessions[body.refresh_token];
      }
      setCors(res);
      res.status(204).end();
      return;
    }

    // ------------------------- User admin (add/remove) -------------------------
    // Gated by a hardcoded admin code. Uses the Supabase Admin API (service role).
    if (pathname === "/v1/admin/users" && req.method === "GET") {
      const users = await adminListUsers();
      sendJson(res, 200, {
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          role: (u.user_metadata && u.user_metadata.role) || ""
        }))
      });
      return;
    }

    if (pathname === "/v1/admin/users" && req.method === "POST") {
      const body = await parseBody(req);
      if (String(body.admin_code || "") !== ADMIN_CODE) {
        sendJson(res, 403, { error: "invalid_admin_code", message: "Invalid admin code." });
        return;
      }
      if (!body.email || !body.password) {
        sendJson(res, 400, { error: "email and password required" });
        return;
      }
      const result = await adminCreateUser(body.email, body.password, body.role);
      if (result.error) {
        sendJson(res, 400, { error: "create_failed", message: result.message });
        return;
      }
      sendJson(res, 201, { status: "created", email: body.email });
      return;
    }

    if (pathname === "/v1/admin/users/delete" && req.method === "POST") {
      const body = await parseBody(req);
      if (String(body.admin_code || "") !== ADMIN_CODE) {
        sendJson(res, 403, { error: "invalid_admin_code", message: "Invalid admin code." });
        return;
      }
      if (!body.user_id) {
        sendJson(res, 400, { error: "user_id required" });
        return;
      }
      const result = await adminDeleteUser(body.user_id);
      if (result.error) {
        sendJson(res, 400, { error: "delete_failed", message: result.message });
        return;
      }
      sendJson(res, 200, { status: "deleted" });
      return;
    }

    // Public e-bill: view a receipt by order number (no auth, no store headers).
    if (pathname === "/v1/receipt" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) {
        sendJson(res, 400, { error: "id required" });
        return;
      }
      const order = (await sbSelect(
        "orders",
        `select=id,order_no,customer_name,status,subtotal,tax_amount,discount_amount,total_amount,created_at,business_id,store_id&order_no=eq.${encode(id)}&limit=1`
      ))[0];
      if (!order) {
        sendJson(res, 404, { error: "receipt_not_found" });
        return;
      }
      const items = await sbSelect(
        "order_items",
        `select=sku,name,quantity,unit_price,line_total&order_id=eq.${order.id}`
      );
      const payments = await sbSelect(
        "order_payments",
        `select=mode,amount&order_id=eq.${order.id}`
      ).catch(() => []);
      const biz = (await sbSelect("businesses", `select=legal_name,gstin,pan&id=eq.${order.business_id}&limit=1`))[0] || {};
      const store = (await sbSelect("stores", `select=name,address_line,city,state,pincode&id=eq.${order.store_id}&limit=1`))[0] || {};
      sendJson(res, 200, {
        sale_id: order.order_no,
        customer_name: order.customer_name,
        status: order.status,
        created_at: order.created_at,
        totals: {
          subtotal: Number(order.subtotal || 0),
          tax: Number(order.tax_amount || 0),
          discount: Number(order.discount_amount || 0),
          total: Number(order.total_amount || 0)
        },
        payment_modes: payments.map((p) => p.mode),
        items: items.map((it) => ({
          sku: it.sku,
          name: it.name,
          quantity: Number(it.quantity || 0),
          unit_price: Number(it.unit_price || 0),
          line_total: Number(it.line_total || 0)
        })),
        business: { name: biz.legal_name || "", gstin: biz.gstin || "", pan: biz.pan || "" },
        store: {
          name: store.name || "",
          address_line: store.address_line || "",
          city: store.city || "",
          state: store.state || "",
          pincode: store.pincode || ""
        }
      });
      return;
    }

    // Everything below needs a resolved business/store context.
    const ctx = await resolveContext(req);

    // ------------------------- Dashboard -------------------------
    if (pathname === "/v1/reports/dashboard" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const period = url.searchParams.get("period") || "today";
      const todayStart = startOfTodayIso();
      const weekStart = startOfDaysAgoIso(6);
      const monthStart = startOfMonthIso();
      const periodStart = period === "week"
        ? weekStart
        : period === "month"
          ? monthStart
          : period === "90days"
            ? startOfDaysAgoIso(89)
            : todayStart;
      const periodLabel = period === "week" ? "This Week" : period === "month" ? "This Month" : period === "90days" ? "Last 90 Days" : "Today";
      const [periodOrders, balances, periodExpenses, priceRows, openCashSessions, latestSyncRuns] = await Promise.all([
        sbSelect(
          "orders",
          `select=id,status,subtotal,tax_amount,discount_amount,total_amount,created_at&store_id=eq.${ctx.storeId}&created_at=gte.${encode(periodStart)}`
        ),
        sbSelect(
          "inventory_balances",
          `select=qty_on_hand,reorder_level,products(name)&store_id=eq.${ctx.storeId}`
        ),
        sbSelect(
          "expenses",
          `select=amount&store_id=eq.${ctx.storeId}&expense_date=gte.${encode(periodStart.slice(0, 10))}`
        ).catch(() => []),
        sbSelect(
          "product_prices",
          `select=product_id,cost_price,effective_from&store_id=eq.${ctx.storeId}&order=effective_from.desc`
        ).catch(() => []),
        sbSelect(
          "cash_sessions",
          `select=opened_at&store_id=eq.${ctx.storeId}&status=eq.open&order=opened_at.asc&limit=1`
        ).catch(() => []),
        sbSelect(
          "google_sheets_sync_runs",
          `select=status,error_message,completed_at&business_id=eq.${ctx.businessId}&order=completed_at.desc&limit=1`
        ).catch(() => [])
      ]);
      const paid = periodOrders.filter((o) => o.status === "paid");
      const returned = periodOrders.filter((o) => o.status === "returned");
      const unpaid = periodOrders.filter((o) => o.status === "created");

      const totalSales = paid.reduce((a, o) => a + Number(o.total_amount || 0), 0);
      const discounts = paid.reduce((a, o) => a + Number(o.discount_amount || 0), 0);
      const taxCollected = paid.reduce((a, o) => a + Number(o.tax_amount || 0), 0);
      const returnsRefunds = returned.reduce((a, o) => a + Number(o.total_amount || 0), 0);
      const netSales = totalSales - returnsRefunds;
      const ordersCount = paid.length;
      const outstanding = unpaid.reduce((a, o) => a + Number(o.total_amount || 0), 0);
      const aov = ordersCount ? Math.round(totalSales / ordersCount) : 0;

      // Items sold + COGS for today's paid orders.
      let itemsSold = 0;
      let itemsRevenue = 0;
      let cogs = 0;
      const paidIds = paid.map((o) => o.id);
      if (paidIds.length) {
        const lineItems = await sbSelect(
          "order_items",
          `select=product_id,quantity,line_total&order_id=in.(${paidIds.join(",")})`
        ).catch(() => []);
        itemsSold = lineItems.reduce((a, it) => a + Number(it.quantity || 0), 0);
        itemsRevenue = lineItems.reduce((a, it) => a + Number(it.line_total || 0), 0);

        const costByProduct = {};
        priceRows.forEach((pr) => {
          if (!(pr.product_id in costByProduct)) {
            costByProduct[pr.product_id] = Number(pr.cost_price || 0);
          }
        });
        cogs = lineItems.reduce((a, it) => a + (Number(it.quantity || 0) * (costByProduct[it.product_id] || 0)), 0);
      }
      const grossProfit = itemsRevenue - cogs;
      const expenses = periodExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
      const netProfit = grossProfit - expenses;
      const profitMargin = netSales > 0 ? Math.round((netProfit / netSales) * 1000) / 10 : 0;

      const lowStock = balances.filter((b) => Number(b.qty_on_hand) <= Number(b.reorder_level));

      const weekOrders = periodOrders.filter((order) => order.created_at >= weekStart);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const trend = [];
      for (let i = 6; i >= 0; i -= 1) {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() - i);
        const total = weekOrders
          .filter((o) => o.status === "paid" && new Date(o.created_at).toDateString() === day.toDateString())
          .reduce((a, o) => a + Number(o.total_amount || 0), 0);
        trend.push([dayNames[day.getDay()], Math.round(total / 1000)]);
      }

      const alerts = lowStock.slice(0, 3).map((balance) => ({
        level: "warning",
        message: `Low stock: ${(balance.products && balance.products.name) || "SKU"} (${balance.qty_on_hand} left)`,
        action: "Review stock",
        tab: "inventory"
      }));
      if (unpaid.length) {
        alerts.push({
          level: "warning",
          message: `${unpaid.length} unpaid order${unpaid.length === 1 ? "" : "s"} totaling ${outstanding.toFixed(2)}`,
          action: "Review orders",
          tab: "orders"
        });
      }
      if (openCashSessions.length) {
        alerts.push({
          level: "info",
          message: `Cash drawer open since ${new Date(openCashSessions[0].opened_at).toLocaleString("en-IN")}`,
          action: "View cash report",
          tab: "reports"
        });
      }
      if (latestSyncRuns[0] && latestSyncRuns[0].status === "error") {
        alerts.push({
          level: "danger",
          message: `Google Sheets backup failed: ${latestSyncRuns[0].error_message || "check integration settings"}`,
          action: "View integration",
          tab: "integrations"
        });
      }

      const rangeStarts = {
        today: todayStart,
        last_3_days: startOfDaysAgoIso(2),
        this_week: startOfWeekIso(),
        this_month: monthStart
      };
      const rangeSales = {};
      Object.entries(rangeStarts).forEach(([key, start]) => {
        const paidOrders = periodOrders.filter((order) => order.created_at >= start && order.status === "paid");
        rangeSales[key] = {
          sales: paidOrders.reduce((total, order) => total + Number(order.total_amount || 0), 0),
          orders: paidOrders.length
        };
      });

      sendJson(res, 200, {
        period,
        period_label: periodLabel,
        kpis: {
          total_sales: totalSales,
          net_sales: netSales,
          gross_profit: grossProfit,
          net_profit: netProfit,
          profit_margin: profitMargin,
          orders: ordersCount,
          items_sold: itemsSold,
          aov,
          discounts: discounts,
          returns_refunds: returnsRefunds,
          tax_collected: taxCollected,
          outstanding: outstanding,
          expenses,
          low_stock_skus: lowStock.length
        },
        sales_periods: rangeSales,
        trend,
        alerts
      });
      return;
    }

    if (pathname === "/v1/reports/tax-summary" && req.method === "GET") {
      const month = new Date();
      month.setDate(1);
      month.setHours(0, 0, 0, 0);
      const rows = await sbSelect(
        "orders",
        `select=subtotal,tax_amount&store_id=eq.${ctx.storeId}&created_at=gte.${encode(month.toISOString())}`
      );
      const taxable = rows.reduce((a, o) => a + Number(o.subtotal || 0), 0);
      const tax = rows.reduce((a, o) => a + Number(o.tax_amount || 0), 0);
      sendJson(res, 200, {
        period: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
        taxable_value: taxable,
        cgst: Math.round((tax / 2) * 100) / 100,
        sgst: Math.round((tax / 2) * 100) / 100,
        igst: 0
      });
      return;
    }

    if (pathname === "/v1/reports/top-products" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const period = url.searchParams.get("period") || "month";
      const days = period === "day" ? 0 : period === "week" ? 6 : 30;
      const start = startOfDaysAgoIso(days);
      const items = await sbSelect(
        "order_items",
        `select=sku,name,quantity,line_total,orders!inner(store_id,created_at,status)&orders.store_id=eq.${ctx.storeId}&orders.created_at=gte.${encode(start)}&orders.status=eq.paid`
      );
      const bucket = new Map();
      items.forEach((it) => {
        const cur = bucket.get(it.sku) || { sku: it.sku, name: it.name, units_sold: 0, revenue: 0 };
        cur.units_sold += Number(it.quantity || 0);
        cur.revenue += Number(it.line_total || 0);
        bucket.set(it.sku, cur);
      });
      const top = Array.from(bucket.values()).sort((a, b) => b.units_sold - a.units_sold).slice(0, 10);
      sendJson(res, 200, { period, items: top, sold_skus: Array.from(bucket.keys()) });
      return;
    }

    if (pathname === "/v1/reports/sales-by-staff" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const period = url.searchParams.get("period") || "month";
      const days = period === "day" ? 0 : period === "week" ? 6 : 30;
      const rows = await sbSelect(
        "orders",
        `select=sold_by_user_id,sold_by_name,total_amount&store_id=eq.${ctx.storeId}&status=eq.paid&created_at=gte.${encode(startOfDaysAgoIso(days))}`
      );
      const staff = new Map();
      rows.forEach((order) => {
        const id = order.sold_by_user_id || "unattributed";
        const current = staff.get(id) || { user_id: order.sold_by_user_id || null, name: order.sold_by_name || "Unattributed", orders: 0, sales: 0 };
        current.orders += 1;
        current.sales += Number(order.total_amount || 0);
        staff.set(id, current);
      });
      sendJson(res, 200, { period, items: Array.from(staff.values()).sort((a, b) => b.sales - a.sales) });
      return;
    }

    if (pathname === "/v1/reports/stock-list" && req.method === "GET") {
      const [balances, prices] = await Promise.all([
        sbSelect(
          "inventory_balances",
          `select=product_id,qty_on_hand,reorder_level,products!inner(sku,name)&store_id=eq.${ctx.storeId}`
        ),
        sbSelect(
          "product_prices",
          `select=product_id,mrp,selling_price,cost_price,effective_from&store_id=eq.${ctx.storeId}&order=effective_from.desc`
        ).catch(() => [])
      ]);
      const priceByProduct = {};
      prices.forEach((price) => {
        if (!priceByProduct[price.product_id]) priceByProduct[price.product_id] = price;
      });
      const items = balances.map((balance) => {
        const price = priceByProduct[balance.product_id] || {};
        return {
          sku: balance.products && balance.products.sku,
          name: balance.products && balance.products.name,
          quantity: Number(balance.qty_on_hand || 0),
          reorder_level: Number(balance.reorder_level || 0),
          mrp: Number(price.mrp || 0),
          selling_price: Number(price.selling_price || 0),
          cost_price: Number(price.cost_price || 0),
          inventory_value: Number(balance.qty_on_hand || 0) * Number(price.cost_price || 0)
        };
      });
      sendJson(res, 200, { items, total_value: items.reduce((total, item) => total + item.inventory_value, 0) });
      return;
    }

    if (pathname === "/v1/reports/reconciliation" && req.method === "GET") {
      const rows = await sbSelect(
        "payment_reconciliation",
        `select=recon_date,gateway_amount,pos_amount,variance&store_id=eq.${ctx.storeId}&order=recon_date.desc`
      );
      sendJson(res, 200, {
        rows: rows.map((r) => ({
          date: r.recon_date,
          gateway_amount: Number(r.gateway_amount),
          pos_amount: Number(r.pos_amount),
          variance: Number(r.variance)
        }))
      });
      return;
    }

    if (pathname === "/v1/expenses" && req.method === "GET") {
      const rows = await sbSelect(
        "expenses",
        `select=id,expense_date,category,description,amount,payment_mode,recorded_by_name,created_at&store_id=eq.${ctx.storeId}&order=expense_date.desc,created_at.desc&limit=100`
      );
      sendJson(res, 200, { items: rows.map((row) => ({ ...row, amount: Number(row.amount || 0) })) });
      return;
    }

    if (pathname === "/v1/expenses" && req.method === "POST") {
      const body = await parseBody(req);
      const actor = await resolveActor(req);
      const amount = Number(body.amount || 0);
      const category = String(body.category || "").trim();
      if (!category || !(amount > 0)) {
        sendJson(res, 400, { error: "category and positive amount required" });
        return;
      }
      const inserted = await sbInsert("expenses", [{
        business_id: ctx.businessId,
        store_id: ctx.storeId,
        expense_date: body.expense_date || nowIso().slice(0, 10),
        category,
        description: String(body.description || "").trim() || null,
        amount,
        payment_mode: body.payment_mode || null,
        recorded_by_user_id: actor ? actor.id : null,
        recorded_by_name: actor ? (actor.name || actor.email) : null
      }]);
      sendJson(res, 201, { item: { ...inserted[0], amount: Number(inserted[0].amount || amount) } });
      return;
    }

    if (pathname === "/v1/cash-session" && req.method === "GET") {
      const sessions = await sbSelect(
        "cash_sessions",
        `select=*&store_id=eq.${ctx.storeId}&order=opened_at.desc&limit=1`
      ).catch(() => []);
      const session = sessions[0];
      if (!session) {
        sendJson(res, 200, { session: null });
        return;
      }
      const openedAt = session.opened_at || nowIso();
      const [cashPayments, cashExpenses] = await Promise.all([
        sbSelect(
          "order_payments",
          `select=amount,orders!inner(store_id,created_at,status)&mode=eq.cash&orders.store_id=eq.${ctx.storeId}&orders.created_at=gte.${encode(openedAt)}&orders.status=eq.paid`
        ).catch(() => []),
        sbSelect(
          "expenses",
          `select=amount&store_id=eq.${ctx.storeId}&payment_mode=eq.cash&expense_date=gte.${encode(openedAt.slice(0, 10))}`
        ).catch(() => [])
      ]);
      const cashSales = cashPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
      const cashExpensesTotal = cashExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
      const expected = Number(session.opening_amount || 0) + cashSales - cashExpensesTotal;
      sendJson(res, 200, {
        session: {
          ...session,
          opening_amount: Number(session.opening_amount || 0),
          closing_amount: session.closing_amount == null ? null : Number(session.closing_amount),
          cash_sales: cashSales,
          cash_expenses: cashExpensesTotal,
          expected_closing: expected,
          variance: session.closing_amount == null ? null : Number(session.closing_amount) - expected
        }
      });
      return;
    }

    if (pathname === "/v1/cash-session" && req.method === "POST") {
      const body = await parseBody(req);
      const actor = await resolveActor(req);
      const amount = Number(body.amount || 0);
      if (!(amount >= 0)) {
        sendJson(res, 400, { error: "valid amount required" });
        return;
      }
      const active = await sbSelect(
        "cash_sessions",
        `select=*&store_id=eq.${ctx.storeId}&status=eq.open&order=opened_at.desc&limit=1`
      ).catch(() => []);
      if (body.action === "open") {
        if (active.length) {
          sendJson(res, 409, { error: "cash_session_already_open" });
          return;
        }
        const inserted = await sbInsert("cash_sessions", [{
          business_id: ctx.businessId,
          store_id: ctx.storeId,
          opening_amount: amount,
          opened_by_user_id: actor ? actor.id : null,
          opened_by_name: actor ? (actor.name || actor.email) : null,
          status: "open"
        }]);
        sendJson(res, 201, { session: inserted[0] });
        return;
      }
      if (body.action === "close") {
        if (!active.length) {
          sendJson(res, 409, { error: "no_open_cash_session" });
          return;
        }
        const updated = await sbUpdate("cash_sessions", `id=eq.${active[0].id}`, {
          closing_amount: amount,
          closed_at: nowIso(),
          closed_by_user_id: actor ? actor.id : null,
          closed_by_name: actor ? (actor.name || actor.email) : null,
          status: "closed"
        });
        sendJson(res, 200, { session: updated[0] });
        return;
      }
      sendJson(res, 400, { error: "action must be open or close" });
      return;
    }

    // ------------------------- Orders -------------------------
    if (pathname === "/v1/orders" && req.method === "GET") {
      const rows = await sbSelect(
        "orders",
        `select=order_no,channel,customer_name,total_amount,status,created_at&or=(store_id.eq.${ctx.storeId},channel.eq.online)&order=created_at.desc`
      );
      sendJson(res, 200, {
        items: rows.map((o) => ({
          order_no: o.order_no,
          channel: channelLabel(o.channel),
          customer_name: o.customer_name,
          total_amount: Number(o.total_amount || 0),
          status: titleCaseStatus(o.status)
        }))
      });
      return;
    }

    if (pathname === "/v1/orders/void" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.order_no || !body.reason) {
        sendJson(res, 400, { error: "order_no and reason required" });
        return;
      }
      const found = await sbSelect("orders", `select=id&order_no=eq.${encode(body.order_no)}&business_id=eq.${ctx.businessId}&limit=1`);
      if (!found.length) {
        sendJson(res, 404, { error: "order_not_found" });
        return;
      }
      await sbUpdate("orders", `id=eq.${found[0].id}`, { status: "voided" });
      await sbInsert("order_void_logs", [
        { business_id: ctx.businessId, order_id: found[0].id, order_no: body.order_no, reason: String(body.reason) }
      ]);
      sendJson(res, 200, { status: "voided", order_no: body.order_no });
      return;
    }

    if (pathname === "/v1/orders/reprint" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.order_no) {
        sendJson(res, 400, { error: "order_no required" });
        return;
      }
      const found = await sbSelect("orders", `select=id&order_no=eq.${encode(body.order_no)}&business_id=eq.${ctx.businessId}&limit=1`);
      await sbInsert("order_reprint_logs", [
        { business_id: ctx.businessId, order_id: found[0] ? found[0].id : null, order_no: body.order_no }
      ]);
      sendJson(res, 200, { status: "queued", order_no: body.order_no });
      return;
    }

    // ------------------------- Inventory -------------------------
    if (pathname === "/v1/inventory/products" && req.method === "GET") {
      const rows = await sbSelect(
        "inventory_balances",
        `select=product_id,qty_on_hand,reorder_level,location,products(sku,name,hsn_code,tax_percent)&store_id=eq.${ctx.storeId}`
      );
      const prices = await sbSelect(
        "product_prices",
        `select=product_id,mrp,selling_price,cost_price,effective_from&store_id=eq.${ctx.storeId}&order=effective_from.desc`
      ).catch(() => []);
      const priceByProduct = {};
      prices.forEach((pr) => {
        if (!(pr.product_id in priceByProduct)) {
          priceByProduct[pr.product_id] = { mrp: Number(pr.mrp), offer: Number(pr.selling_price), cost: Number(pr.cost_price || 0) };
        }
      });
      sendJson(res, 200, {
        products: rows.map((r) => ({
          sku: r.products ? r.products.sku : "",
          name: r.products ? r.products.name : "",
          hsn: r.products ? r.products.hsn_code || "" : "",
          tax_percent: r.products ? Number(r.products.tax_percent || 0) : 0,
          qty: Number(r.qty_on_hand || 0),
          reorder_level: Number(r.reorder_level || 0),
          location: r.location || "",
          price: priceByProduct[r.product_id] ? priceByProduct[r.product_id].offer : 0,
          mrp: priceByProduct[r.product_id] ? priceByProduct[r.product_id].mrp : 0,
          cost_price: priceByProduct[r.product_id] ? priceByProduct[r.product_id].cost : 0
        }))
      });
      return;
    }

    if (pathname === "/v1/inventory/ledger" && req.method === "GET") {
      const rows = await sbSelect(
        "inventory_ledger",
        `select=created_at,direction,qty,source,reference_id,products(sku)&store_id=eq.${ctx.storeId}&order=created_at.desc&limit=100`
      );
      sendJson(res, 200, {
        entries: rows.map((e) => ({
          timestamp: e.created_at,
          sku: e.products ? e.products.sku : "",
          direction: e.direction,
          qty: Number(e.qty || 0),
          source: e.source,
          reference_id: e.reference_id
        }))
      });
      return;
    }

    if (pathname === "/v1/inventory/labels/print" && req.method === "POST") {
      const body = await parseBody(req);
      const row = {
        business_id: ctx.businessId,
        store_id: ctx.storeId,
        start_sku: body.start_sku || "",
        end_sku: body.end_sku || body.start_sku || "",
        copies: Number(body.copies || 1),
        status: "queued"
      };
      const inserted = await sbInsert("label_print_jobs", [row]);
      const jobId = inserted[0] ? inserted[0].id : `LBL-${Date.now()}`;
      sendJson(res, 202, { job_id: jobId, start_sku: row.start_sku, end_sku: row.end_sku, copies: row.copies, status: "queued" });
      return;
    }

    // Add stock: create/update the product, its store price, and inventory balance.
    if (pathname === "/v1/inventory/stock" && req.method === "POST") {
      const body = await parseBody(req);
      const sku = String(body.sku || "").trim();
      const name = String(body.name || "").trim();
      const qty = Number(body.qty || 0);
      const price = Number(body.price || 0); // MRP
      const offerPrice = Number(body.offer_price || 0) || price; // selling price
      const costPrice = Number(body.cost_price || 0);
      if (!sku || !name || !(qty > 0)) {
        sendJson(res, 400, { error: "sku, name and positive qty required" });
        return;
      }

      let product = (await sbSelect("products", `select=id&sku=eq.${encode(sku)}&business_id=eq.${ctx.businessId}&limit=1`))[0];
      if (!product) {
        product = (await sbInsert("products", [
          {
            business_id: ctx.businessId,
            sku,
            barcode: body.barcode || sku,
            name,
            hsn_code: body.hsn || null,
            category: body.category || null,
            unit: body.unit || "pcs",
            tax_percent: Number(body.tax_percent || 0),
            is_active: true
          }
        ]))[0];
      } else if (name) {
        await sbUpdate("products", `id=eq.${product.id}`, { name, tax_percent: Number(body.tax_percent || 0) });
      }

      if (price > 0 || offerPrice > 0) {
        await sbInsert("product_prices", [
          {
            business_id: ctx.businessId,
            store_id: ctx.storeId,
            product_id: product.id,
            mrp: price || offerPrice,
            selling_price: offerPrice,
            cost_price: costPrice,
            effective_from: nowIso()
          }
        ]);
      }

      const bal = (await sbSelect(
        "inventory_balances",
        `select=id,qty_on_hand&store_id=eq.${ctx.storeId}&product_id=eq.${product.id}&limit=1`
      ))[0];
      if (bal) {
        await sbUpdate("inventory_balances", `id=eq.${bal.id}`, {
          qty_on_hand: Number(bal.qty_on_hand || 0) + qty,
          reorder_level: Number(body.reorder_level || 0),
          location: body.location || null
        });
      } else {
        await sbInsert("inventory_balances", [
          {
            business_id: ctx.businessId,
            store_id: ctx.storeId,
            product_id: product.id,
            qty_on_hand: qty,
            reorder_level: Number(body.reorder_level || 0),
            location: body.location || null
          }
        ]);
      }

      await sbInsert("inventory_ledger", [
        {
          business_id: ctx.businessId,
          store_id: ctx.storeId,
          product_id: product.id,
          direction: "in",
          qty,
          source: "manual_stock_in",
          reference_type: "stock_in",
          reference_id: sku
        }
      ]);

      sendJson(res, 201, { sku, name, price, offer_price: offerPrice, qty, barcode: body.barcode || sku });
      return;
    }

    if (pathname === "/v1/inventory/product" && req.method === "POST") {
      const body = await parseBody(req);
      const sku = String(body.sku || "").trim();
      if (!sku) {
        sendJson(res, 400, { error: "sku required" });
        return;
      }
      const product = (await sbSelect("products", `select=id&sku=eq.${encode(sku)}&business_id=eq.${ctx.businessId}&limit=1`))[0];
      if (!product) {
        sendJson(res, 404, { error: "product_not_found" });
        return;
      }
      await sbUpdate("products", `id=eq.${product.id}`, {
        name: String(body.name || "").trim() || sku,
        hsn_code: String(body.hsn || "").trim() || null,
        tax_percent: Number(body.tax_percent || 0)
      });
      await sbInsert("product_prices", [{
        business_id: ctx.businessId,
        store_id: ctx.storeId,
        product_id: product.id,
        mrp: Number(body.mrp || 0),
        selling_price: Number(body.price || 0),
        cost_price: Number(body.cost_price || 0),
        effective_from: nowIso()
      }]);
      const balance = (await sbSelect("inventory_balances", `select=id&store_id=eq.${ctx.storeId}&product_id=eq.${product.id}&limit=1`))[0];
      if (balance) {
        const requestedQty = Number(body.qty);
        const nextQty = Number.isFinite(requestedQty) && requestedQty >= 0
          ? requestedQty
          : undefined;
        await sbUpdate("inventory_balances", `id=eq.${balance.id}`, {
          ...(nextQty === undefined ? {} : { qty_on_hand: nextQty }),
          reorder_level: Number(body.reorder_level || 0),
          location: String(body.location || "").trim() || null
        });
      }
      sendJson(res, 200, { status: "updated", sku });
      return;
    }

    // Look up a product by SKU or barcode for POS billing (validates stock).
    if (pathname === "/v1/pos/product-lookup" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const code = (url.searchParams.get("code") || "").trim();
      if (!code) {
        sendJson(res, 400, { error: "code required" });
        return;
      }
      const products = await sbSelect(
        "products",
        `select=id,sku,name,tax_percent,barcode&business_id=eq.${ctx.businessId}&or=(sku.eq.${encode(code)},barcode.eq.${encode(code)})&limit=1`
      );
      if (!products.length) {
        sendJson(res, 404, { error: "product_not_found" });
        return;
      }
      const p = products[0];
      const priceRow = (await sbSelect(
        "product_prices",
        `select=mrp,selling_price&product_id=eq.${p.id}&store_id=eq.${ctx.storeId}&order=effective_from.desc&limit=1`
      ))[0];
      const balRow = (await sbSelect(
        "inventory_balances",
        `select=qty_on_hand&product_id=eq.${p.id}&store_id=eq.${ctx.storeId}&limit=1`
      ))[0];
      sendJson(res, 200, {
        sku: p.sku,
        name: p.name,
        barcode: p.barcode,
        unit_price: priceRow ? Number(priceRow.selling_price) : 0,
        mrp: priceRow ? Number(priceRow.mrp) : 0,
        tax_percent: Number(p.tax_percent || 0),
        available_qty: balRow ? Number(balRow.qty_on_hand) : 0
      });
      return;
    }

    // Business + store details for printed receipts.
    if (pathname === "/v1/pos/receipt-context" && req.method === "GET") {
      const biz = (await sbSelect(
        "businesses",
        `select=legal_name,gstin,pan,invoice_prefix&id=eq.${ctx.businessId}&limit=1`
      ))[0] || {};
      const store = (await sbSelect(
        "stores",
        `select=name,address_line,city,state,pincode&id=eq.${ctx.storeId}&limit=1`
      ))[0] || {};
      sendJson(res, 200, {
        business: {
          name: biz.legal_name || "",
          gstin: biz.gstin || "",
          pan: biz.pan || "",
          invoice_prefix: biz.invoice_prefix || ""
        },
        store: {
          name: store.name || "",
          address_line: store.address_line || "",
          city: store.city || "",
          state: store.state || "",
          pincode: store.pincode || ""
        }
      });
      return;
    }

    // ------------------------- Customers / promotions -------------------------
    // NOTE: "place" is stored in the customers.segment free-text column
    // (the schema has no dedicated address/place column).
    if (pathname === "/v1/customers" && req.method === "GET") {
      const rows = await sbSelect(
        "customers",
        `select=id,customer_code,name,phone,segment,created_at&business_id=eq.${ctx.businessId}&order=created_at.desc`
      );
      sendJson(res, 200, {
        items: rows.map((c) => ({
          id: c.id,
          code: c.customer_code,
          name: c.name,
          phone: c.phone || "",
          place: c.segment || ""
        }))
      });
      return;
    }

    // Look up a customer by phone (POS + customers tab search).
    if (pathname === "/v1/customers/lookup" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const phone = (url.searchParams.get("phone") || "").trim();
      if (!phone) {
        sendJson(res, 400, { error: "phone required" });
        return;
      }
      const rows = await sbSelect(
        "customers",
        `select=id,customer_code,name,phone,segment&business_id=eq.${ctx.businessId}&phone=eq.${encode(phone)}&limit=1`
      );
      if (!rows.length) {
        sendJson(res, 200, { found: false });
        return;
      }
      const c = rows[0];
      sendJson(res, 200, { found: true, customer: { id: c.id, code: c.customer_code, name: c.name, phone: c.phone, place: c.segment || "" } });
      return;
    }

    // Create or update a customer (upsert by phone).
    if (pathname === "/v1/customers" && req.method === "POST") {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const place = String(body.place || "").trim();
      if (!name || !phone) {
        sendJson(res, 400, { error: "name and phone required" });
        return;
      }
      const existing = await sbSelect(
        "customers",
        `select=id&business_id=eq.${ctx.businessId}&phone=eq.${encode(phone)}&limit=1`
      );
      let saved;
      if (existing.length) {
        saved = (await sbUpdate("customers", `id=eq.${existing[0].id}`, { name, segment: place }))[0];
      } else {
        saved = (await sbInsert("customers", [
          { business_id: ctx.businessId, customer_code: `C-${Date.now()}`, name, phone, segment: place, is_active: true }
        ]))[0];
      }
      sendJson(res, 200, { id: saved.id, code: saved.customer_code, name: saved.name, phone: saved.phone, place: saved.segment || "" });
      return;
    }

    // Customer detail + order history.
    if (pathname === "/v1/customers/detail" && req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) {
        sendJson(res, 400, { error: "id required" });
        return;
      }
      const rows = await sbSelect(
        "customers",
        `select=id,customer_code,name,phone,segment,created_at&id=eq.${encode(id)}&business_id=eq.${ctx.businessId}&limit=1`
      );
      if (!rows.length) {
        sendJson(res, 404, { error: "customer_not_found" });
        return;
      }
      const c = rows[0];
      const orders = await sbSelect(
        "orders",
        `select=order_no,status,total_amount,created_at,channel&customer_id=eq.${encode(id)}&order=created_at.desc&limit=100`
      );
      const totalSpent = orders.reduce((a, o) => a + Number(o.total_amount || 0), 0);
      sendJson(res, 200, {
        customer: { id: c.id, code: c.customer_code, name: c.name, phone: c.phone || "", place: c.segment || "", since: c.created_at },
        stats: { orders: orders.length, total_spent: totalSpent },
        orders: orders.map((o) => ({
          order_no: o.order_no,
          status: titleCaseStatus(o.status),
          total_amount: Number(o.total_amount || 0),
          channel: channelLabel(o.channel),
          created_at: o.created_at
        }))
      });
      return;
    }

    if (pathname === "/v1/promotions/campaigns" && req.method === "GET") {
      const rows = await sbSelect(
        "campaigns",
        `select=id,name,status&business_id=eq.${ctx.businessId}&order=created_at.desc`
      );
      // Aggregate delivery metrics from campaign_events when present.
      const events = await sbSelect(
        "campaign_events",
        `select=campaign_id,event_type&business_id=eq.${ctx.businessId}`
      ).catch(() => []);
      const metrics = new Map();
      events.forEach((e) => {
        const m = metrics.get(e.campaign_id) || { delivered: 0, clicked: 0, converted: 0 };
        if (e.event_type === "delivered") m.delivered += 1;
        else if (e.event_type === "clicked") m.clicked += 1;
        else if (e.event_type === "converted") m.converted += 1;
        metrics.set(e.campaign_id, m);
      });
      sendJson(res, 200, {
        items: rows.map((c) => {
          const m = metrics.get(c.id) || { delivered: 0, clicked: 0, converted: 0 };
          return { id: c.id, name: c.name, delivered: m.delivered, clicked: m.clicked, converted: m.converted, revenue: 0 };
        })
      });
      return;
    }

    // ------------------------- Integrations -------------------------
    if (pathname === "/v1/integrations/status" && req.method === "GET") {
      const [rows, syncRuns] = await Promise.all([
        sbSelect("integrations", `select=provider,is_enabled,config&business_id=eq.${ctx.businessId}`),
        sbSelect(
          "google_sheets_sync_runs",
          `select=status,sales_rows,expense_rows,error_message,completed_at&business_id=eq.${ctx.businessId}&order=completed_at.desc&limit=1`
        ).catch(() => [])
      ]);
      const whatsapp = rows.find((r) => r.provider === "whatsapp");
      const sheets = rows.find((r) => r.provider === "google_sheets");
      const lastSync = syncRuns[0] || null;
      sendJson(res, 200, {
        whatsapp_status: whatsapp ? (whatsapp.is_enabled ? "Connected" : "Disabled") : "",
        whatsapp_templates: whatsapp && whatsapp.config ? whatsapp.config.templates : null,
        whatsapp_delivery_success: whatsapp && whatsapp.config ? whatsapp.config.delivery_success : "",
        sheet_name: sheets && sheets.config ? sheets.config.workbook : "",
        sheet_schedule: sheets && sheets.config ? sheets.config.schedule : "",
        sheet_last_run: lastSync ? lastSync.completed_at : (sheets && sheets.config ? sheets.config.last_run : ""),
        sheet_sync_status: lastSync ? lastSync.status : "not_run",
        sheet_sync_detail: lastSync
          ? (lastSync.status === "success"
            ? `${lastSync.sales_rows || 0} sales, ${lastSync.expense_rows || 0} expenses backed up`
            : (lastSync.error_message || "Backup failed"))
          : "No backup run recorded yet",
        webhook_retries: null,
        idempotency_conflicts: null,
        failed_signatures: null
      });
      return;
    }

    if (pathname === "/v1/integrations/whatsapp/events" && req.method === "GET") {
      const rows = await sbSelect(
        "whatsapp_events",
        `select=created_at,event_type,reference_id,status&business_id=eq.${ctx.businessId}&order=created_at.desc&limit=100`
      );
      sendJson(res, 200, {
        events: rows.map((e) => ({ timestamp: e.created_at, type: e.event_type, reference_id: e.reference_id, status: e.status }))
      });
      return;
    }

    if (pathname === "/v1/integrations/whatsapp/send-receipt" && req.method === "POST") {
      const body = await parseBody(req);
      const event = {
        business_id: ctx.businessId,
        store_id: ctx.storeId,
        event_type: "receipt",
        reference_id: body.reference_id || `SALE-${Date.now()}`,
        phone: body.phone || null,
        template_name: body.template || null,
        payload: body.message ? { message: body.message } : null,
        status: "sent"
      };
      await sbInsert("whatsapp_events", [event]);
      sendJson(res, 202, { status: "queued", event: { timestamp: nowIso(), type: "receipt", reference_id: event.reference_id, status: "sent" } });
      return;
    }

    // ------------------------- Business setup / storefront -------------------------
    if (pathname === "/v1/business/setup" && req.method === "GET") {
      const rows = await sbSelect(
        "businesses",
        `select=legal_name,gstin,pan,invoice_prefix&id=eq.${ctx.businessId}&limit=1`
      );
      const b = rows[0] || {};
      const store = (await sbSelect(
        "stores",
        `select=name,address_line,city,state,pincode&id=eq.${ctx.storeId}&limit=1`
      ))[0] || {};
      sendJson(res, 200, {
        business_name: b.legal_name || "",
        gstin: b.gstin || "",
        pan: b.pan || "",
        invoice_prefix: b.invoice_prefix || "",
        store_name: store.name || "",
        store_address: store.address_line || "",
        store_city: store.city || "",
        store_state: store.state || "",
        store_pincode: store.pincode || ""
      });
      return;
    }

    // Save editable business + current store details.
    if (pathname === "/v1/business/setup" && req.method === "POST") {
      const body = await parseBody(req);
      const bizPatch = {};
      if (body.business_name !== undefined) bizPatch.legal_name = String(body.business_name || "").trim();
      if (body.gstin !== undefined) bizPatch.gstin = String(body.gstin || "").trim();
      if (body.pan !== undefined) bizPatch.pan = String(body.pan || "").trim();
      if (body.invoice_prefix !== undefined) bizPatch.invoice_prefix = String(body.invoice_prefix || "").trim();
      if (Object.keys(bizPatch).length) {
        await sbUpdate("businesses", `id=eq.${ctx.businessId}`, bizPatch);
      }

      const storePatch = {};
      if (body.store_name !== undefined) storePatch.name = String(body.store_name || "").trim();
      if (body.store_address !== undefined) storePatch.address_line = String(body.store_address || "").trim();
      if (body.store_city !== undefined) storePatch.city = String(body.store_city || "").trim();
      if (body.store_state !== undefined) storePatch.state = String(body.store_state || "").trim();
      if (body.store_pincode !== undefined) storePatch.pincode = String(body.store_pincode || "").trim();
      if (Object.keys(storePatch).length) {
        await sbUpdate("stores", `id=eq.${ctx.storeId}`, storePatch);
      }

      sendJson(res, 200, { status: "saved" });
      return;
    }

    if (pathname === "/v1/storefront/placeholder" && req.method === "GET") {
      let onlineCount = 0;
      let pendingCount = 0;
      try {
        const onlineStoreId = await resolveStoreId("store-online", ctx.businessId);
        const online = await sbSelect("inventory_balances", `select=id&store_id=eq.${onlineStoreId}`);
        onlineCount = online.length;
      } catch (_) {
        onlineCount = 0;
      }
      const pending = await sbSelect(
        "orders",
        `select=id&business_id=eq.${ctx.businessId}&channel=eq.online&status=neq.delivered`
      );
      pendingCount = pending.length;
      sendJson(res, 200, {
        notice: "Storefront status computed from live inventory and orders.",
        published_skus: onlineCount,
        pending_orders: pendingCount,
        sync_lag_seconds: 0
      });
      return;
    }

    // ------------------------- POS sale -------------------------
    if (pathname === "/v1/pos/sales" && req.method === "POST") {
      const body = await parseBody(req);
      const actor = await resolveActor(req);
      const channel = body.channel === "online" ? "online" : "in_store";
      const totals = body.totals || {};
      const orderNo = `SALE-${Date.now()}`;

      // Resolve or create the customer from phone/name when provided.
      let customerId = null;
      const custName = (body.customer && body.customer.name) || "Walk-in";
      const custPhone = body.customer && body.customer.phone ? String(body.customer.phone).trim() : "";
      const custPlace = body.customer && body.customer.place ? String(body.customer.place).trim() : "";
      const markPaid = body.status !== "created";
      if (custPhone) {
        const existing = await sbSelect(
          "customers",
          `select=id&business_id=eq.${ctx.businessId}&phone=eq.${encode(custPhone)}&limit=1`
        ).catch(() => []);
        if (existing.length) {
          customerId = existing[0].id;
          await sbUpdate("customers", `id=eq.${existing[0].id}`, { name: custName, segment: custPlace }).catch(() => {});
        } else {
          const created = await sbInsert("customers", [
            {
              business_id: ctx.businessId,
              customer_code: `C-${Date.now()}`,
              name: custName,
              phone: custPhone,
              segment: custPlace,
              is_active: true
            }
          ]).catch(() => []);
          customerId = created[0] ? created[0].id : null;
        }
      }

      const insertedOrder = await sbInsert("orders", [
        {
          business_id: ctx.businessId,
          store_id: ctx.storeId,
          order_no: orderNo,
          channel,
          customer_id: customerId,
          customer_name: custName,
          status: markPaid ? "paid" : "created",
          subtotal: Number(totals.subtotal || 0),
          tax_amount: Number(totals.tax_amount || 0),
          discount_amount: Number(totals.discount_amount || 0),
          total_amount: Number(totals.total_amount || 0),
          sold_by_user_id: actor ? actor.id : null,
          sold_by_name: actor ? (actor.name || actor.email) : null
        }
      ]);
      const orderId = insertedOrder[0].id;

      const items = Array.isArray(body.items) ? body.items : [];
      for (const line of items) {
        let productId = null;
        const prod = await sbSelect("products", `select=id&sku=eq.${encode(line.sku)}&business_id=eq.${ctx.businessId}&limit=1`).catch(() => []);
        if (prod.length) {
          productId = prod[0].id;
        }
        await sbInsert("order_items", [
          {
            business_id: ctx.businessId,
            order_id: orderId,
            product_id: productId,
            sku: line.sku,
            name: line.name,
            quantity: Number(line.quantity || 0),
            unit_price: Number(line.unit_price || 0),
            line_total: Number(line.line_total || 0)
          }
        ]);

        if (productId) {
          const bal = await sbSelect(
            "inventory_balances",
            `select=id,qty_on_hand&store_id=eq.${ctx.storeId}&product_id=eq.${productId}&limit=1`
          );
          if (bal.length) {
            await sbUpdate("inventory_balances", `id=eq.${bal[0].id}`, {
              qty_on_hand: Math.max(0, Number(bal[0].qty_on_hand || 0) - Number(line.quantity || 0))
            });
          }
          await sbInsert("inventory_ledger", [
            {
              business_id: ctx.businessId,
              store_id: ctx.storeId,
              product_id: productId,
              direction: "out",
              qty: Number(line.quantity || 0),
              source: channel === "online" ? "online_order" : "sale",
              reference_type: "order",
              reference_id: orderNo
            }
          ]);
        }
      }

      const payments = markPaid && Array.isArray(body.payments) ? body.payments : [];
      for (const pay of payments) {
        await sbInsert("order_payments", [
          { business_id: ctx.businessId, order_id: orderId, mode: pay.mode, amount: Number(pay.amount || 0) }
        ]);
      }

      await sbInsert("whatsapp_events", [
        {
          business_id: ctx.businessId,
          store_id: ctx.storeId,
          event_type: "order_confirmation",
          reference_id: orderNo,
          phone: custPhone || null,
          status: "sent"
        }
      ]);

      sendJson(res, 201, { sale_id: orderNo, status: markPaid ? "paid" : "created" });
      return;
    }

    sendJson(res, 404, { error: "not_found", path: pathname });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (message === "supabase_not_configured") {
      sendJson(res, 503, { error: "database_not_configured", message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }
    if (message.startsWith("business_not_found") || message.startsWith("store_not_found")) {
      sendJson(res, 400, { error: "context_not_found", message });
      return;
    }
    sendJson(res, 500, { error: "server_error", message });
  }
};
