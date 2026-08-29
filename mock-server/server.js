const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const USERS_DB_PATH = process.env.USERS_DB_PATH || path.join(__dirname, 'users.db.json');

function nowIso() {
  return new Date().toISOString();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function loadUsersDb() {
  try {
    const raw = fs.readFileSync(USERS_DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return parsed;
  } catch (_) {
    return { users: [] };
  }
}

function findUserByEmail(email) {
  const db = loadUsersDb();
  const normalized = String(email || '').trim().toLowerCase();
  return db.users.find((u) => String(u.email || '').toLowerCase() === normalized && u.active !== false) || null;
}

function verifyPassword(user, password) {
  if (!user || !user.password_hash) return false;
  return sha256(password) === String(user.password_hash);
}

const mockState = {
  salesCounter: 1000,
  labelCounter: 40,
  orders: [
    { order_no: 'ORD-10018', channel: 'Online', customer_name: 'Priya S', total_amount: 1450, status: 'Created', created_at: nowIso(), store_id: 'store-main' },
    { order_no: 'ORD-10017', channel: 'In-Store', customer_name: 'Walk-in', total_amount: 962, status: 'Paid', created_at: nowIso(), store_id: 'store-main' },
    { order_no: 'ORD-10016', channel: 'Online', customer_name: 'Rahul K', total_amount: 780, status: 'Packed', created_at: nowIso(), store_id: 'store-online' }
  ],
  sales: [],
  voidLogs: [],
  reprintLogs: [],
  whatsappEvents: [
    { timestamp: nowIso(), type: 'order_confirmation', reference_id: 'ORD-10018', status: 'sent' },
    { timestamp: nowIso(), type: 'low_stock_alert', reference_id: 'AMB-500', status: 'sent' }
  ],
  inventoryByStore: {
    'store-main': [
      { sku: 'TS-1KG', name: 'Tata Salt 1kg', qty: 48, reorder_level: 15, location: 'Main Floor' },
      { sku: 'AMB-500', name: 'Amul Butter 500g', qty: 8, reorder_level: 10, location: 'Cold Storage A' },
      { sku: 'MNB-200', name: 'Marie Biscuit 200g', qty: 91, reorder_level: 30, location: 'Aisle 3' }
    ],
    'store-north': [
      { sku: 'TS-1KG', name: 'Tata Salt 1kg', qty: 32, reorder_level: 12, location: 'Shelf 2' },
      { sku: 'AMB-500', name: 'Amul Butter 500g', qty: 5, reorder_level: 9, location: 'Cold Rack' },
      { sku: 'MNB-200', name: 'Marie Biscuit 200g', qty: 60, reorder_level: 24, location: 'Aisle 1' }
    ],
    'store-online': [
      { sku: 'TS-1KG', name: 'Tata Salt 1kg', qty: 27, reorder_level: 8, location: 'Online Bin A' },
      { sku: 'AMB-500', name: 'Amul Butter 500g', qty: 4, reorder_level: 6, location: 'Online Cold Bin' },
      { sku: 'MNB-200', name: 'Marie Biscuit 200g', qty: 44, reorder_level: 20, location: 'Online Bin C' }
    ]
  },
  stockLedger: [
    { timestamp: nowIso(), sku: 'AMB-500', direction: 'out', qty: 2, source: 'sale', reference_id: 'ORD-10017', store_id: 'store-main' },
    { timestamp: nowIso(), sku: 'TS-1KG', direction: 'in', qty: 20, source: 'grn', reference_id: 'PO-9081', store_id: 'store-main' }
  ],
  reconciliationRows: [
    { date: '2026-08-27', gateway_amount: 210240, pos_amount: 210240, variance: 0 },
    { date: '2026-08-28', gateway_amount: 224870, pos_amount: 224450, variance: 420 },
    { date: '2026-08-29', gateway_amount: 198320, pos_amount: 198320, variance: 0 }
  ],
  authSessions: {},
  customers: [
    { id: 'CUST-1', name: 'Priya S', segment: 'Loyal' },
    { id: 'CUST-2', name: 'Rahul K', segment: 'Dormant' },
    { id: 'CUST-3', name: 'Nivetha M', segment: 'New' }
  ],
  campaigns: [
    { id: 'CMP-1', name: 'Weekend Essentials', delivered: 2304, clicked: 942, converted: 296, revenue: 182500 },
    { id: 'CMP-2', name: 'Monsoon Offers', delivered: 1108, clicked: 355, converted: 102, revenue: 64120 }
  ],
  businessSetup: {
    business_name: 'Anitha General Stores Pvt Ltd',
    gstin: '33ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    invoice_prefix: 'AGS/26-27/'
  }
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Store-Id, X-Business-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Store-Id, X-Business-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
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
    req.on('error', reject);
  });
}

function tokenPayload(userOrEmail) {
  const isObj = typeof userOrEmail === 'object' && userOrEmail !== null;
  const email = isObj ? userOrEmail.email : userOrEmail;
  const payload = {
    access_token: `mock-access-${Date.now()}`,
    token_type: 'bearer',
    expires_in: 900,
    refresh_token: `mock-refresh-${Date.now()}`,
    user: {
      id: (isObj && userOrEmail.id) || 'user-mock-1',
      email: email || '',
      role: (isObj && userOrEmail.role) || 'manager'
    }
  };
  mockState.authSessions[payload.refresh_token] = {
    id: payload.user.id,
    email: payload.user.email,
    role: payload.user.role,
    issued_at: nowIso()
  };
  return payload;
}

function getStoreId(req) {
  return req.headers['x-store-id'] || 'store-main';
}

function getStoreInventory(storeId) {
  if (!mockState.inventoryByStore[storeId]) {
    mockState.inventoryByStore[storeId] = clone(mockState.inventoryByStore['store-main']);
  }
  return mockState.inventoryByStore[storeId];
}

function buildTopProducts(storeId) {
  const bucket = new Map();
  const scoped = mockState.sales.filter((sale) => sale.store_id === storeId);
  scoped.forEach((sale) => {
    (sale.items || []).forEach((line) => {
      const current = bucket.get(line.sku) || {
        sku: line.sku,
        name: line.name,
        units_sold: 0,
        revenue: 0
      };
      current.units_sold += Number(line.quantity || 0);
      current.revenue += Number(line.line_total || 0);
      bucket.set(line.sku, current);
    });
  });
  return Array.from(bucket.values()).sort((a, b) => b.units_sold - a.units_sold).slice(0, 10);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = requestUrl;
  const storeId = getStoreId(req);

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  try {
    if (pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'onecounter-mock-api' });
      return;
    }

    if (pathname === '/v1/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const user = findUserByEmail(body.email);
      if (!user || !verifyPassword(user, body.password)) {
        sendJson(res, 401, { error: 'invalid_credentials' });
        return;
      }
      sendJson(res, 200, tokenPayload(user));
      return;
    }

    if (pathname === '/v1/auth/refresh' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.refresh_token) {
        sendJson(res, 400, { error: 'refresh_token required' });
        return;
      }
      const session = mockState.authSessions[body.refresh_token];
      if (!session) {
        sendJson(res, 401, { error: 'invalid_refresh_token' });
        return;
      }
      delete mockState.authSessions[body.refresh_token];
      sendJson(res, 200, tokenPayload(session));
      return;
    }

    if (pathname === '/v1/auth/logout' && req.method === 'POST') {
      const body = await parseBody(req);
      if (body.refresh_token) {
        delete mockState.authSessions[body.refresh_token];
      }
      sendNoContent(res);
      return;
    }

    if (pathname === '/v1/reports/dashboard' && req.method === 'GET') {
      sendJson(res, 200, {
        kpis: {
          revenue_today: 341620,
          orders_today: 284,
          aov: 1203,
          low_stock_skus: 19,
          failed_sync_alerts: 2
        },
        trend: [
          ['Mon', 56], ['Tue', 62], ['Wed', 48], ['Thu', 71], ['Fri', 82], ['Sat', 91], ['Sun', 77]
        ],
        alerts: [
          'Low stock: Amul Butter 500g at Warehouse B',
          'Cashier variance exceeds threshold at Counter 2',
          'WhatsApp callback failed 2 times',
          'GSTR export scheduled at 23:30'
        ]
      });
      return;
    }

    if (pathname === '/v1/orders' && req.method === 'GET') {
      sendJson(res, 200, { items: mockState.orders.filter((it) => it.store_id === storeId || it.channel === 'Online') });
      return;
    }

    if (pathname === '/v1/orders/void' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.order_no || !body.reason) {
        sendJson(res, 400, { error: 'order_no and reason required' });
        return;
      }
      const order = mockState.orders.find((it) => it.order_no === body.order_no);
      if (!order) {
        sendJson(res, 404, { error: 'order_not_found' });
        return;
      }
      order.status = 'Returned';
      mockState.voidLogs.unshift({
        order_no: body.order_no,
        reason: String(body.reason),
        store_id: storeId,
        timestamp: nowIso()
      });
      sendJson(res, 200, { status: 'voided', order_no: body.order_no });
      return;
    }

    if (pathname === '/v1/orders/reprint' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.order_no) {
        sendJson(res, 400, { error: 'order_no required' });
        return;
      }
      mockState.reprintLogs.unshift({
        order_no: body.order_no,
        store_id: storeId,
        timestamp: nowIso()
      });
      sendJson(res, 200, { status: 'queued', order_no: body.order_no });
      return;
    }

    if (pathname === '/v1/inventory/products' && req.method === 'GET') {
      const products = getStoreInventory(storeId);
      sendJson(res, 200, {
        products
      });
      return;
    }

    if (pathname === '/v1/inventory/ledger' && req.method === 'GET') {
      sendJson(res, 200, {
        entries: mockState.stockLedger.filter((e) => e.store_id === storeId).slice(0, 100)
      });
      return;
    }

    if (pathname === '/v1/inventory/labels/print' && req.method === 'POST') {
      const body = await parseBody(req);
      mockState.labelCounter += 1;
      sendJson(res, 202, {
        job_id: `LBL-${mockState.labelCounter}`,
        start_sku: body.start_sku || '',
        end_sku: body.end_sku || body.start_sku || '',
        copies: Number(body.copies || 1),
        status: 'queued'
      });
      return;
    }

    if (pathname === '/v1/customers' && req.method === 'GET') {
      sendJson(res, 200, {
        items: mockState.customers
      });
      return;
    }

    if (pathname === '/v1/promotions/campaigns' && req.method === 'GET') {
      sendJson(res, 200, {
        items: mockState.campaigns
      });
      return;
    }

    if (pathname === '/v1/reports/tax-summary' && req.method === 'GET') {
      sendJson(res, 200, {
        period: '2026-08',
        taxable_value: 2484200,
        cgst: 62355,
        sgst: 62355,
        igst: 18440
      });
      return;
    }

    if (pathname === '/v1/reports/top-products' && req.method === 'GET') {
      sendJson(res, 200, { items: buildTopProducts(storeId) });
      return;
    }

    if (pathname === '/v1/reports/reconciliation' && req.method === 'GET') {
      sendJson(res, 200, { rows: mockState.reconciliationRows });
      return;
    }

    if (pathname === '/v1/integrations/status' && req.method === 'GET') {
      sendJson(res, 200, {
        whatsapp_status: 'Connected',
        whatsapp_templates: 12,
        whatsapp_delivery_success: '98.8%',
        sheet_name: 'Retail-ops-2026',
        sheet_schedule: 'Every 30 min',
        sheet_last_run: '4 min ago',
        webhook_retries: 7,
        idempotency_conflicts: 0,
        failed_signatures: 2
      });
      return;
    }

    if (pathname === '/v1/integrations/whatsapp/events' && req.method === 'GET') {
      sendJson(res, 200, { events: mockState.whatsappEvents.slice(0, 100) });
      return;
    }

    if (pathname === '/v1/integrations/whatsapp/send-receipt' && req.method === 'POST') {
      const body = await parseBody(req);
      const event = {
        timestamp: nowIso(),
        type: 'receipt',
        reference_id: body.reference_id || `SALE-${Date.now()}`,
        status: 'sent'
      };
      mockState.whatsappEvents.unshift(event);
      sendJson(res, 202, { status: 'queued', event });
      return;
    }

    if (pathname === '/v1/business/setup' && req.method === 'GET') {
      sendJson(res, 200, mockState.businessSetup);
      return;
    }

    if (pathname === '/v1/storefront/placeholder' && req.method === 'GET') {
      const products = getStoreInventory('store-online');
      const pendingOrders = mockState.orders.filter((o) => o.channel === 'Online' && o.status !== 'Delivered').length;
      sendJson(res, 200, {
        notice: 'Storefront placeholder endpoint active. Replace with production storefront APIs.',
        published_skus: products.length,
        pending_orders: pendingOrders,
        sync_lag_seconds: 7
      });
      return;
    }

    if (pathname === '/v1/pos/sales' && req.method === 'POST') {
      const body = await parseBody(req);
      mockState.salesCounter += 1;
      const saleId = `SALE-${mockState.salesCounter}`;
      const saleStoreId = body.store_id || storeId;
      const order = {
        order_no: saleId,
        channel: body.channel === 'in_store' ? 'In-Store' : 'Online',
        customer_name: body.customer?.name || 'Walk-in',
        total_amount: body.totals?.total_amount || 0,
        status: 'Paid',
        created_at: nowIso(),
        store_id: saleStoreId
      };
      mockState.sales.unshift({
        sale_id: saleId,
        store_id: saleStoreId,
        items: Array.isArray(body.items) ? body.items : []
      });

      const inventory = getStoreInventory(saleStoreId);
      (body.items || []).forEach((line) => {
        const inv = inventory.find((it) => it.sku === line.sku);
        if (inv) {
          inv.qty = Math.max(0, Number(inv.qty || 0) - Number(line.quantity || 0));
        }
        mockState.stockLedger.unshift({
          timestamp: nowIso(),
          sku: line.sku,
          direction: 'out',
          qty: Number(line.quantity || 0),
          source: body.channel === 'online' ? 'online_order' : 'sale',
          reference_id: saleId,
          store_id: saleStoreId
        });
      });

      mockState.orders.unshift(order);
      mockState.whatsappEvents.unshift({
        timestamp: nowIso(),
        type: 'order_confirmation',
        reference_id: saleId,
        status: 'sent'
      });

      sendJson(res, 201, { sale_id: saleId, status: 'accepted' });
      return;
    }

    sendJson(res, 404, { error: 'not_found', path: pathname });
  } catch (err) {
    sendJson(res, 500, { error: 'server_error', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`OneCounter mock API listening on http://localhost:${PORT}`);
});
