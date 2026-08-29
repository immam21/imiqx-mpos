const CACHE = 'onecounter-v9';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './config.js', './receipt.html', './vendor/JsBarcode.all.min.js', './vendor/qrcode.min.js', './vendor/jspdf.umd.min.js', './vendor/html5-qrcode.min.js'];
const OUTBOX_DB = 'onecounter-outbox';
const OUTBOX_STORE = 'requests';
const POS_SALES_PATH = '/v1/pos/sales';

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function outboxPut(value) {
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).add(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function outboxGetAll() {
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function outboxDelete(id) {
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queuePosRequest(request) {
  const clone = request.clone();
  const body = await clone.text();
  const headers = {};
  clone.headers.forEach((value, key) => {
    headers[key] = value;
  });

  await outboxPut({
    url: clone.url,
    method: clone.method,
    headers,
    body,
    createdAt: new Date().toISOString(),
  });
}

async function flushPosOutbox() {
  const queued = await outboxGetAll();
  for (const item of queued) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      if (res.ok) {
        await outboxDelete(item.id);
      }
    } catch (_) {
      break;
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => flushPosOutbox()).catch(() => {})
  );
  self.clients.claim();
});

// Network-first for navigation, cache-first for everything else — keeps
// billing/inventory screens usable if the connection drops mid-sale.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname.endsWith(POS_SALES_PATH)) {
    event.respondWith((async () => {
      try {
        return await fetch(request.clone());
      } catch (_) {
        await queuePosRequest(request);
        return new Response(JSON.stringify({
          queued: true,
          message: 'POS sale queued offline and will sync automatically.',
        }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'pos-outbox-sync') {
    event.waitUntil(flushPosOutbox());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_POS_QUEUE') {
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(flushPosOutbox());
      return;
    }
    flushPosOutbox();
  }
});
