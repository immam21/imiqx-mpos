const { findUserByEmail, verifyPassword } = require("../../lib/auth-db");
const { nowIso, getState, getStoreInventory, buildTopProducts } = require("../../lib/mock-state");

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

function getStoreId(req) {
  return req.headers["x-store-id"] || process.env.ONECOUNTER_STORE_ID || "store-main";
}

function getAuthMode() {
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (process.env.AUTH_MODE) {
    return process.env.AUTH_MODE;
  }
  return process.env.SUPABASE_URL && pub ? "supabase" : "local_db";
}

function issueMockToken(state, user) {
  const refreshToken = `mock-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    access_token: `mock-access-${Date.now()}`,
    token_type: "bearer",
    expires_in: 900,
    refresh_token: refreshToken,
    user: {
      id: user.id || "user-mock-1",
      email: user.email || "",
      role: user.role || "manager"
    }
  };
  state.authSessions[refreshToken] = {
    id: payload.user.id,
    email: payload.user.email,
    role: payload.user.role,
    issued_at: nowIso()
  };
  return payload;
}

async function supabasePasswordLogin(email, password) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const pub = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: pub
    },
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
    headers: {
      "Content-Type": "application/json",
      apikey: pub
    },
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
    headers: {
      apikey: pub,
      Authorization: `Bearer ${accessToken}`
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.status(204).end();
    return;
  }

  const route = Array.isArray(req.query.route) ? req.query.route.join("/") : "";
  const pathname = `/v1/${route}`;
  const state = getState();
  const storeId = getStoreId(req);

  try {
    if (pathname === "/v1/auth/login" && req.method === "POST") {
      const body = await parseBody(req);
      const authMode = getAuthMode();

      if (authMode === "supabase") {
        const payload = await supabasePasswordLogin(body.email, body.password);
        sendJson(res, 200, payload);
        return;
      }

      const user = findUserByEmail(body.email);
      if (!user || !verifyPassword(user, body.password)) {
        sendJson(res, 401, { error: "invalid_credentials" });
        return;
      }
      sendJson(res, 200, issueMockToken(state, user));
      return;
    }

    if (pathname === "/v1/auth/refresh" && req.method === "POST") {
      const body = await parseBody(req);
      const authMode = getAuthMode();

      if (authMode === "supabase") {
        const payload = await supabaseRefresh(body.refresh_token);
        sendJson(res, 200, payload);
        return;
      }

      const session = state.authSessions[body.refresh_token];
      if (!session) {
        sendJson(res, 401, { error: "invalid_refresh_token" });
        return;
      }
      delete state.authSessions[body.refresh_token];
      sendJson(res, 200, issueMockToken(state, session));
      return;
    }

    if (pathname === "/v1/auth/logout" && req.method === "POST") {
      const authMode = getAuthMode();
      const body = await parseBody(req);

      if (authMode === "supabase") {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (token) {
          await supabaseLogout(token);
        }
      } else if (body.refresh_token) {
        delete state.authSessions[body.refresh_token];
      }

      setCors(res);
      res.status(204).end();
      return;
    }

    if (pathname === "/v1/reports/dashboard" && req.method === "GET") {
      sendJson(res, 200, {
        kpis: {
          revenue_today: 341620,
          orders_today: 284,
          aov: 1203,
          low_stock_skus: 19,
          failed_sync_alerts: 2
        },
        trend: [["Mon", 56], ["Tue", 62], ["Wed", 48], ["Thu", 71], ["Fri", 82], ["Sat", 91], ["Sun", 77]],
        alerts: [
          "Low stock: Amul Butter 500g at Warehouse B",
          "Cashier variance exceeds threshold at Counter 2",
          "WhatsApp callback failed 2 times",
          "GSTR export scheduled at 23:30"
        ]
      });
      return;
    }

    if (pathname === "/v1/orders" && req.method === "GET") {
      sendJson(res, 200, { items: state.orders.filter((o) => o.store_id === storeId || o.channel === "Online") });
      return;
    }

    if (pathname === "/v1/orders/void" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.order_no || !body.reason) {
        sendJson(res, 400, { error: "order_no and reason required" });
        return;
      }
      const order = state.orders.find((o) => o.order_no === body.order_no);
      if (!order) {
        sendJson(res, 404, { error: "order_not_found" });
        return;
      }
      order.status = "Returned";
      state.voidLogs.unshift({ order_no: body.order_no, reason: String(body.reason), store_id: storeId, timestamp: nowIso() });
      sendJson(res, 200, { status: "voided", order_no: body.order_no });
      return;
    }

    if (pathname === "/v1/orders/reprint" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.order_no) {
        sendJson(res, 400, { error: "order_no required" });
        return;
      }
      state.reprintLogs.unshift({ order_no: body.order_no, store_id: storeId, timestamp: nowIso() });
      sendJson(res, 200, { status: "queued", order_no: body.order_no });
      return;
    }

    if (pathname === "/v1/inventory/products" && req.method === "GET") {
      sendJson(res, 200, { products: getStoreInventory(state, storeId) });
      return;
    }

    if (pathname === "/v1/inventory/ledger" && req.method === "GET") {
      sendJson(res, 200, { entries: state.stockLedger.filter((e) => e.store_id === storeId).slice(0, 100) });
      return;
    }

    if (pathname === "/v1/inventory/labels/print" && req.method === "POST") {
      const body = await parseBody(req);
      state.labelCounter += 1;
      sendJson(res, 202, {
        job_id: `LBL-${state.labelCounter}`,
        start_sku: body.start_sku || "",
        end_sku: body.end_sku || body.start_sku || "",
        copies: Number(body.copies || 1),
        status: "queued"
      });
      return;
    }

    if (pathname === "/v1/customers" && req.method === "GET") {
      sendJson(res, 200, { items: state.customers });
      return;
    }

    if (pathname === "/v1/promotions/campaigns" && req.method === "GET") {
      sendJson(res, 200, { items: state.campaigns });
      return;
    }

    if (pathname === "/v1/reports/tax-summary" && req.method === "GET") {
      sendJson(res, 200, {
        period: "2026-08",
        taxable_value: 2484200,
        cgst: 62355,
        sgst: 62355,
        igst: 18440
      });
      return;
    }

    if (pathname === "/v1/reports/top-products" && req.method === "GET") {
      sendJson(res, 200, { items: buildTopProducts(state, storeId) });
      return;
    }

    if (pathname === "/v1/reports/reconciliation" && req.method === "GET") {
      sendJson(res, 200, { rows: state.reconciliationRows });
      return;
    }

    if (pathname === "/v1/integrations/status" && req.method === "GET") {
      sendJson(res, 200, {
        whatsapp_status: "Connected",
        whatsapp_templates: 12,
        whatsapp_delivery_success: "98.8%",
        sheet_name: "Retail-ops-2026",
        sheet_schedule: "Every 30 min",
        sheet_last_run: "4 min ago",
        webhook_retries: 7,
        idempotency_conflicts: 0,
        failed_signatures: 2
      });
      return;
    }

    if (pathname === "/v1/integrations/whatsapp/events" && req.method === "GET") {
      sendJson(res, 200, { events: state.whatsappEvents.slice(0, 100) });
      return;
    }

    if (pathname === "/v1/integrations/whatsapp/send-receipt" && req.method === "POST") {
      const body = await parseBody(req);
      const event = {
        timestamp: nowIso(),
        type: "receipt",
        reference_id: body.reference_id || `SALE-${Date.now()}`,
        status: "sent"
      };
      state.whatsappEvents.unshift(event);
      sendJson(res, 202, { status: "queued", event });
      return;
    }

    if (pathname === "/v1/business/setup" && req.method === "GET") {
      sendJson(res, 200, state.businessSetup);
      return;
    }

    if (pathname === "/v1/storefront/placeholder" && req.method === "GET") {
      const onlineProducts = getStoreInventory(state, "store-online");
      const pendingOrders = state.orders.filter((o) => o.channel === "Online" && o.status !== "Delivered").length;
      sendJson(res, 200, {
        notice: "Storefront placeholder endpoint active. Replace with production storefront APIs.",
        published_skus: onlineProducts.length,
        pending_orders: pendingOrders,
        sync_lag_seconds: 7
      });
      return;
    }

    if (pathname === "/v1/pos/sales" && req.method === "POST") {
      const body = await parseBody(req);
      state.salesCounter += 1;
      const saleId = `SALE-${state.salesCounter}`;
      const saleStoreId = body.store_id || storeId;

      const order = {
        order_no: saleId,
        channel: body.channel === "in_store" ? "In-Store" : "Online",
        customer_name: body.customer?.name || "Walk-in",
        total_amount: body.totals?.total_amount || 0,
        status: "Paid",
        created_at: nowIso(),
        store_id: saleStoreId
      };

      state.sales.unshift({
        sale_id: saleId,
        store_id: saleStoreId,
        items: Array.isArray(body.items) ? body.items : []
      });

      const inventory = getStoreInventory(state, saleStoreId);
      (body.items || []).forEach((line) => {
        const inv = inventory.find((p) => p.sku === line.sku);
        if (inv) {
          inv.qty = Math.max(0, Number(inv.qty || 0) - Number(line.quantity || 0));
        }
        state.stockLedger.unshift({
          timestamp: nowIso(),
          sku: line.sku,
          direction: "out",
          qty: Number(line.quantity || 0),
          source: body.channel === "online" ? "online_order" : "sale",
          reference_id: saleId,
          store_id: saleStoreId
        });
      });

      state.orders.unshift(order);
      state.whatsappEvents.unshift({
        timestamp: nowIso(),
        type: "order_confirmation",
        reference_id: saleId,
        status: "sent"
      });

      sendJson(res, 201, { sale_id: saleId, status: "accepted" });
      return;
    }

    sendJson(res, 404, { error: "not_found", path: pathname });
  } catch (err) {
    sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
