function nowIso() {
  return new Date().toISOString();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createInitialState() {
  return {
    salesCounter: 1000,
    labelCounter: 40,
    orders: [
      { order_no: "ORD-10018", channel: "Online", customer_name: "Priya S", total_amount: 1450, status: "Created", created_at: nowIso(), store_id: "store-main" },
      { order_no: "ORD-10017", channel: "In-Store", customer_name: "Walk-in", total_amount: 962, status: "Paid", created_at: nowIso(), store_id: "store-main" },
      { order_no: "ORD-10016", channel: "Online", customer_name: "Rahul K", total_amount: 780, status: "Packed", created_at: nowIso(), store_id: "store-online" }
    ],
    sales: [],
    voidLogs: [],
    reprintLogs: [],
    authSessions: {},
    whatsappEvents: [
      { timestamp: nowIso(), type: "order_confirmation", reference_id: "ORD-10018", status: "sent" },
      { timestamp: nowIso(), type: "low_stock_alert", reference_id: "AMB-500", status: "sent" }
    ],
    inventoryByStore: {
      "store-main": [
        { sku: "TS-1KG", name: "Tata Salt 1kg", qty: 48, reorder_level: 15, location: "Main Floor" },
        { sku: "AMB-500", name: "Amul Butter 500g", qty: 8, reorder_level: 10, location: "Cold Storage A" },
        { sku: "MNB-200", name: "Marie Biscuit 200g", qty: 91, reorder_level: 30, location: "Aisle 3" }
      ],
      "store-north": [
        { sku: "TS-1KG", name: "Tata Salt 1kg", qty: 32, reorder_level: 12, location: "Shelf 2" },
        { sku: "AMB-500", name: "Amul Butter 500g", qty: 5, reorder_level: 9, location: "Cold Rack" },
        { sku: "MNB-200", name: "Marie Biscuit 200g", qty: 60, reorder_level: 24, location: "Aisle 1" }
      ],
      "store-online": [
        { sku: "TS-1KG", name: "Tata Salt 1kg", qty: 27, reorder_level: 8, location: "Online Bin A" },
        { sku: "AMB-500", name: "Amul Butter 500g", qty: 4, reorder_level: 6, location: "Online Cold Bin" },
        { sku: "MNB-200", name: "Marie Biscuit 200g", qty: 44, reorder_level: 20, location: "Online Bin C" }
      ]
    },
    stockLedger: [
      { timestamp: nowIso(), sku: "AMB-500", direction: "out", qty: 2, source: "sale", reference_id: "ORD-10017", store_id: "store-main" },
      { timestamp: nowIso(), sku: "TS-1KG", direction: "in", qty: 20, source: "grn", reference_id: "PO-9081", store_id: "store-main" }
    ],
    reconciliationRows: [
      { date: "2026-08-27", gateway_amount: 210240, pos_amount: 210240, variance: 0 },
      { date: "2026-08-28", gateway_amount: 224870, pos_amount: 224450, variance: 420 },
      { date: "2026-08-29", gateway_amount: 198320, pos_amount: 198320, variance: 0 }
    ],
    customers: [
      { id: "CUST-1", name: "Priya S", segment: "Loyal" },
      { id: "CUST-2", name: "Rahul K", segment: "Dormant" },
      { id: "CUST-3", name: "Nivetha M", segment: "New" }
    ],
    campaigns: [
      { id: "CMP-1", name: "Weekend Essentials", delivered: 2304, clicked: 942, converted: 296, revenue: 182500 },
      { id: "CMP-2", name: "Monsoon Offers", delivered: 1108, clicked: 355, converted: 102, revenue: 64120 }
    ],
    businessSetup: {
      business_name: "Anitha General Stores Pvt Ltd",
      gstin: "33ABCDE1234F1Z5",
      pan: "ABCDE1234F",
      invoice_prefix: "AGS/26-27/"
    }
  };
}

function getState() {
  if (!globalThis.__ONECOUNTER_VERCEL_STATE__) {
    globalThis.__ONECOUNTER_VERCEL_STATE__ = createInitialState();
  }
  return globalThis.__ONECOUNTER_VERCEL_STATE__;
}

function getStoreInventory(state, storeId) {
  if (!state.inventoryByStore[storeId]) {
    state.inventoryByStore[storeId] = clone(state.inventoryByStore["store-main"]);
  }
  return state.inventoryByStore[storeId];
}

function buildTopProducts(state, storeId) {
  const bucket = new Map();
  const scoped = state.sales.filter((sale) => sale.store_id === storeId);
  scoped.forEach((sale) => {
    (sale.items || []).forEach((line) => {
      const cur = bucket.get(line.sku) || { sku: line.sku, name: line.name, units_sold: 0, revenue: 0 };
      cur.units_sold += Number(line.quantity || 0);
      cur.revenue += Number(line.line_total || 0);
      bucket.set(line.sku, cur);
    });
  });
  return Array.from(bucket.values()).sort((a, b) => b.units_sold - a.units_sold).slice(0, 10);
}

module.exports = {
  nowIso,
  getState,
  getStoreInventory,
  buildTopProducts
};
