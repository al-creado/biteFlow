const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../app/store.js');

const memStorage = (init) => {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};
const SEED = [{ name: 'Croquette', price: 100 }, { name: 'Sandwich', price: 75 }];
const FIXED = new Date(2026, 10, 21, 12, 0).getTime();      // Saturday 21 Nov 2026
const WEEK = '2026-11-22', PREV = '2026-11-15', NEXT = '2026-11-29';
const mk = (init, now = FIXED) => Store.createLocalStore({ storage: memStorage(init), seed: SEED, now: () => now });
const last = () => { let s; return { cb: x => { s = x; }, get: () => s }; };

test('normalizeLegacy converts string items and completed status', () => {
  const n = Store.normalizeLegacy({
    next: 3,
    products: ['Croquette', { name: 'Sandwich', price: 75 }],
    orders: [{ id: 7, num: 2, status: 'completed', created: 5, name: 'Ann', notes: '', items: ['2x Croquette', 'Cola'] }]
  });
  assert.equal(n.orders[0].status, 'delivered');
  assert.equal(n.orders[0].id, '7');
  assert.deepEqual(n.orders[0].items, [{ name: 'Croquette', qty: 2, price: 0 }, { name: 'Cola', qty: 1, price: 0 }]);
  assert.equal(n.products[0].name, 'Croquette');
  assert.equal(typeof n.products[0].id, 'string');
  assert.equal(n.products[1].price, 75);
  assert.equal(n.next, 3);
});

test('assignColors gives distinct c to the first 8 products and keeps existing c', () => {
  const ps = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, price: 0 }));
  ps[3].c = 5;
  Store.assignColors(ps);
  assert.equal(ps[3].c, 5);
  assert.equal(new Set(ps.map(p => p.c)).size, 8);
});

test('local store addOrder numbers sequentially from 1', async () => {
  const s = mk();
  const a = await s.addOrder({ name: 'A', items: [{ name: 'Croquette', qty: 2, price: 100 }], notes: '' });
  const b = await s.addOrder({ name: 'B', items: [{ name: 'Sandwich', qty: 1, price: 75 }], notes: '' });
  assert.deepEqual([a.num, b.num], [1, 2]);
  assert.equal(a.status, 'new');
  assert.equal(typeof a.id, 'string');
});

test('local store setStatus moves new->ready and only changes status', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  const o = await s.addOrder({ name: 'A', items: [{ name: 'Croquette', qty: 2, price: 100 }], notes: 'x' });
  await s.setStatus(o.id, 'ready');
  const got = l.get().orders[0];
  assert.equal(got.status, 'ready');
  assert.deepEqual({ ...got, status: 'new' }, o);
});

test('local store upsertProduct matches name case-insensitively and updates price', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  await s.upsertProduct({ name: 'croquette', price: 120 });
  const ps = l.get().products;
  assert.equal(ps.filter(p => p.name.toLowerCase() === 'croquette').length, 1);
  assert.equal(ps.find(p => p.name === 'Croquette').price, 120);
  const created = await s.upsertProduct({ name: 'Brownie', price: 60 });
  assert.equal(typeof created.c, 'number');
});

test('local store persists to storage and reloads', async () => {
  const storage = memStorage();
  const s1 = Store.createLocalStore({ storage, seed: SEED, now: () => FIXED });
  await s1.addOrder({ name: 'A', items: [{ name: 'Croquette', qty: 1, price: 100 }], notes: '' });
  const s2 = Store.createLocalStore({ storage, seed: SEED, now: () => FIXED }); const l = last(); s2.subscribe(l.cb);
  assert.equal(l.get().orders.length, 1);
  assert.equal(l.get().products.length, 2);
  const o2 = await s2.addOrder({ name: 'B', items: [{ name: 'Sandwich', qty: 1, price: 75 }], notes: '' });
  assert.equal(o2.num, 2);
});

test('local store subscribe emits immediately and after each write', async () => {
  const s = mk(); const seen = [];
  const un = s.subscribe(x => seen.push(x.orders.length));
  await s.addOrder({ name: 'A', items: [{ name: 'Croquette', qty: 1, price: 100 }], notes: '' });
  await s.addOrder({ name: 'B', items: [{ name: 'Croquette', qty: 1, price: 100 }], notes: '' });
  un();
  await s.addOrder({ name: 'C', items: [{ name: 'Croquette', qty: 1, price: 100 }], notes: '' });
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(s.kind, 'local');
});

// ---------- cloud store (against the in-memory Firestore) ----------
const { createFakeServer } = require('./helpers/fake-fb.js');
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cloud = (server, opts) => {
  const client = server.createClient(opts);
  const store = Store.createCloudStore({ fb: client.fb, db: client.db, now: () => (opts && opts.now) || FIXED });
  const l = last(); store.subscribe(l.cb);
  return { client, store, snap: l.get };
};
const item = (name = 'Croquette', qty = 1, price = 100) => ({ name, qty, price });

test('cloud addOrder from two stores gets distinct numbers', async () => {
  const server = createFakeServer();
  const A = cloud(server), B = cloud(server);
  await tick();
  const [a, b] = await Promise.all([
    A.store.addOrder({ name: 'A', items: [item()], notes: '' }),
    B.store.addOrder({ name: 'B', items: [item()], notes: '' })
  ]);
  await tick(10);
  assert.deepEqual(A.snap().orders.map(o => o.num), [1, 2]);
  assert.ok(A.snap().orders.every(o => !o.provisional));
  assert.equal(server.get('meta/counter-' + WEEK).next, 3);
  assert.ok(a.id !== b.id);
});

test('cloud setStatus writes only the status field', async () => {
  const server = createFakeServer();
  const A = cloud(server); await tick();
  const o = await A.store.addOrder({ name: 'A', items: [item()], notes: 'n' });
  await tick(10);                                   // let the background numbering finish first
  await A.store.setStatus(o.id, 'ready'); await tick();
  const op = server.log[server.log.length - 1];
  assert.deepEqual(op, { type: 'update', path: 'orders/' + o.id, data: { status: 'ready' } });
});

test('cloud updateOrder fields do not overwrite other fields edited by another store', async () => {
  const server = createFakeServer();
  const A = cloud(server), B = cloud(server); await tick();
  const o = await A.store.addOrder({ name: 'A', items: [item()], notes: '' });
  await tick();
  await Promise.all([B.store.updateOrder(o.id, { name: 'Renamed' }), A.store.setStatus(o.id, 'ready')]);
  await tick();
  const doc = server.get('orders/' + o.id);
  assert.equal(doc.name, 'Renamed'); assert.equal(doc.status, 'ready');
});

test('cloud addOrder while offline resolves immediately with number = highest known + 1', async () => {
  const server = createFakeServer();
  const A = cloud(server); await tick();
  await A.store.addOrder({ name: '1', items: [item()], notes: '' });
  await A.store.addOrder({ name: '2', items: [item()], notes: '' });
  await tick();
  A.client.setOnline(false); await tick();
  const o = await A.store.addOrder({ name: 'offline', items: [item()], notes: '' });
  assert.equal(o.num, 3);
  await tick();
  assert.equal(A.snap().orders.length, 3);
  assert.equal(server.count('orders'), 2);
  assert.equal(A.snap().orders.find(x => x.name === 'offline').provisional, true);
});

test('cloud counter catches up after reconnect (next >= highest number + 1)', async () => {
  const server = createFakeServer();
  const A = cloud(server); await tick();
  await A.store.addOrder({ name: '1', items: [item()], notes: '' });
  await tick();
  A.client.setOnline(false); await tick();
  await A.store.addOrder({ name: 'off1', items: [item()], notes: '' });
  await A.store.addOrder({ name: 'off2', items: [item()], notes: '' });
  A.client.setOnline(true); await tick(8);
  assert.equal(server.count('orders'), 3);
  assert.ok(server.get('meta/counter-' + WEEK).next >= 4, 'counter was ' + JSON.stringify(server.get('meta/counter-' + WEEK)));
  const nxt = await A.store.addOrder({ name: 'after', items: [item()], notes: '' }); await tick(10);
  assert.equal(A.snap().orders.find(x => x.name === 'after').num, 4);
});

test('cloud clearDelivered with 1200 delivered orders deletes all of them', async () => {
  const server = createFakeServer();
  for (let i = 1; i <= 1200; i++) server.data.set('orders/d' + i, { num: i, status: 'delivered', created: FIXED, name: '', notes: '', items: [] });
  for (let i = 0; i < 3; i++) server.data.set('orders/n' + i, { num: 2000 + i, status: 'new', created: FIXED, name: '', notes: '', items: [] });
  const A = cloud(server); await tick();
  assert.equal(A.snap().orders.length, 1203);
  await A.store.clearDelivered(); await tick(8);
  assert.equal(server.count('orders'), 3);
  assert.equal(A.snap().orders.length, 3);
});

test('cloud subscribe reports status offline then synced, and syncing while writes are unacknowledged', async () => {
  const server = createFakeServer();
  const A = cloud(server); const seen = [];
  A.store.subscribe(s => seen.push(s.status)); await tick();
  assert.equal(A.snap().status, 'synced');
  const o = await A.store.addOrder({ name: 'x', items: [item()], notes: '' }); await tick();
  A.client.holdAcks(true);
  await A.store.setStatus(o.id, 'ready'); await tick();
  assert.equal(A.snap().status, 'syncing');
  A.client.holdAcks(false); await tick();
  assert.equal(A.snap().status, 'synced');
  A.client.setOnline(false); await tick();
  assert.equal(A.snap().status, 'offline');
  A.client.setOnline(true); await tick(6);
  assert.equal(A.snap().status, 'synced');
  assert.ok(seen.includes('offline') && seen.includes('synced'));
});

test('cloud removeProduct leaves old orders readable', async () => {
  const server = createFakeServer();
  const A = cloud(server); await tick();
  const p = await A.store.upsertProduct({ name: 'Croquette', price: 100 });
  await A.store.addOrder({ name: 'A', items: [item('Croquette', 2, 100)], notes: '' });
  await A.store.removeProduct(p.id); await tick();
  assert.equal(A.snap().products.length, 0);
  assert.deepEqual(A.snap().orders[0].items, [item('Croquette', 2, 100)]);
});

test('cloud products get distinct colours and case-insensitive upsert', async () => {
  const server = createFakeServer();
  const A = cloud(server); await tick();
  await A.store.seedProducts(SEED); await tick();
  await A.store.upsertProduct({ name: 'CROQUETTE', price: 150 }); await tick();
  const ps = A.snap().products;
  assert.equal(ps.length, 2);
  assert.equal(ps.find(p => p.name === 'Croquette').price, 150);
  assert.equal(new Set(ps.map(p => p.c)).size, 2);
});

test('cloud store reports snapshot errors through onError', async () => {
  const server = createFakeServer(); const client = server.createClient(); const errs = [];
  Store.createCloudStore({ fb: client.fb, db: client.db, now: () => FIXED, onError: e => errs.push(e.code) });
  await tick();
  client.failSnapshots({ code: 'permission-denied' });
  assert.deepEqual(errs, ['permission-denied', 'permission-denied', 'permission-denied']);
});

// ---------- importing a device's old local data ----------
const legacyData = () => Store.normalizeLegacy({
  next: 6,
  products: [{ name: 'Croquette', price: 100 }, { name: 'sandwich', price: 75 }],
  orders: [
    { id: 11, num: 4, status: 'ready', created: FIXED - 1000, name: 'B', notes: '', items: [{ name: 'Croquette', qty: 2, price: 100 }] },
    { id: 10, num: 3, status: 'new', created: FIXED - 2000, name: 'A', notes: 'x', items: [{ name: 'sandwich', qty: 1, price: 75 }] }
  ]
});

test('import into an empty cloud keeps legacy order numbers and sets the counter above them', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const r = await A.store.importLegacy(legacyData()); await tick();
  assert.deepEqual(r, { orders: 2, products: 2 });
  assert.deepEqual(A.snap().orders.map(o => o.num), [3, 4]);
  assert.ok(server.get('meta/counter-' + WEEK).next >= 5);
  const next = await A.store.addOrder({ name: 'new', items: [item()], notes: '' });
  assert.equal(next.num, 5);
});

test('import into a cloud that already has orders renumbers the imported ones from the counter in created order', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  await A.store.addOrder({ name: 'existing', items: [item()], notes: '' });
  await A.store.addOrder({ name: 'existing2', items: [item()], notes: '' }); await tick();
  await A.store.importLegacy(legacyData()); await tick();
  const byName = Object.fromEntries(A.snap().orders.map(o => [o.name, o.num]));
  assert.deepEqual([byName.existing, byName.existing2, byName.A, byName.B], [1, 2, 3, 4]);
  assert.ok(server.get('meta/counter-' + WEEK).next >= 5);
});

test('import merges products by name case-insensitively without duplicates', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  await A.store.upsertProduct({ name: 'SANDWICH', price: 0 }); await tick();
  const r = await A.store.importLegacy(legacyData()); await tick();
  assert.equal(A.snap().products.length, 2);
  assert.equal(r.products, 1);
  assert.equal(A.snap().products.find(p => p.name === 'SANDWICH').price, 75);   // empty price filled from the device
});

test('importing the same legacy data twice, or from two devices, does not duplicate orders', async () => {
  const server = createFakeServer(); const A = cloud(server), B = cloud(server); await tick();
  await A.store.importLegacy(legacyData()); await tick();
  const again = await A.store.importLegacy(legacyData()); await tick();
  await B.store.importLegacy(legacyData()); await tick();
  assert.deepEqual(again, { orders: 0, products: 0 });
  assert.equal(server.count('orders'), 2);
  assert.equal(server.count('products'), 2);
});

test('cloud addOrder returns at once and shows the order even when transactions never finish', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  A.client.hangTransactions(true);
  const o = await Promise.race([A.store.addOrder({ name: 'x', items: [item()], notes: '' }), new Promise(r => setTimeout(() => r('hung'), 200))]);
  assert.notEqual(o, 'hung');
  await tick();
  assert.equal(A.snap().orders.length, 1);
});

test('an order numbered offline is renumbered after reconnect when another device took the same number', async () => {
  const server = createFakeServer(); const A = cloud(server), B = cloud(server); await tick();
  await A.store.addOrder({ name: 'first', items: [item()], notes: '' }); await tick(8);
  A.client.setOnline(false); await tick();
  const off = await A.store.addOrder({ name: 'offline', items: [item()], notes: '' });
  const on = await B.store.addOrder({ name: 'online', items: [item()], notes: '' }); await tick(8);
  assert.equal(off.num, on.num);                       // both picked the next number while A could not see B
  A.client.setOnline(true); await tick(12);
  const nums = A.snap().orders.map(o => o.num).sort();
  assert.deepEqual(nums, [1, 2, 3]);
  assert.ok(A.snap().orders.every(o => !o.provisional));
  assert.ok(server.get('meta/counter-' + WEEK).next >= 4);
});

test('cloud store status follows connectivity even when no document changes (needs metadata events)', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  await A.store.addOrder({ name: 'x', items: [item()], notes: '' }); await tick(8);
  assert.equal(A.snap().status, 'synced');
  A.client.setOnline(false); await tick();
  assert.equal(A.snap().status, 'offline');
  A.client.setOnline(true); await tick(8);
  assert.equal(A.snap().status, 'synced');
});

test('cloud store restart() listens again after a snapshot error', async () => {
  const server = createFakeServer(); const client = server.createClient(); const errs = [];
  const store = Store.createCloudStore({ fb: client.fb, db: client.db, now: () => FIXED, onError: e => errs.push(e.code) });
  const l = last(); store.subscribe(l.cb); await tick();
  client.failSnapshots({ code: 'resource-exhausted' });
  server.data.set('orders/z', { num: 1, status: 'new', created: FIXED, name: 'late', notes: '', items: [] }); server.notify(); await tick();
  assert.equal(l.get().orders.length, 0);              // listener is dead, board is stale
  store.restart(); await tick();
  assert.equal(l.get().orders.length, 1);
  assert.deepEqual(errs, ['resource-exhausted', 'resource-exhausted', 'resource-exhausted']);
});

test('imported orders get readable ids built from the device id and creation time (no hash collisions)', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  await A.store.importLegacy(legacyData()); await tick();
  const ids = [...server.data.keys()].filter(k => k.startsWith('orders/')).sort();
  assert.deepEqual(ids, ['orders/legacy-10-' + (FIXED - 2000), 'orders/legacy-11-' + (FIXED - 1000)]);
});


// ---------- previous menu (history of every product ever added) ----------
const onMenu = (snap, name) => snap.products.some(p => p.name === name);
const inHistory = (snap, name) => snap.history.find(h => h.name === name);

test('historyId is stable, case-insensitive and safe for document ids', () => {
  assert.equal(Store.historyId('Chicken (3 nos)'), 'menu-chicken%20(3%20nos)');
  assert.equal(Store.historyId('CROQUETTE'), Store.historyId('croquette'));
  assert.ok(!Store.historyId('A/B').slice(5).includes('/'));
});

test('local store keeps every product in the previous menu with its latest price after it is removed', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  const b = await s.upsertProduct({ name: 'Brownie', price: 60 });
  await s.setProductPrice(b.id, 70);
  await s.removeProduct(b.id);
  assert.equal(onMenu(l.get(), 'Brownie'), false);
  assert.equal(inHistory(l.get(), 'Brownie').price, 70);
  assert.ok(inHistory(l.get(), 'Croquette'), 'products already on the menu are in the list too');
});

test('local restoreProduct keeps the saved price and colour when the colour is free, else picks a unique one', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  const b = await s.upsertProduct({ name: 'Brownie', price: 60 });
  await s.removeProduct(b.id);
  const back = await s.restoreProduct(inHistory(l.get(), 'Brownie').id);          // nothing took its colour meanwhile
  assert.equal(back.name, 'Brownie'); assert.equal(back.price, 60); assert.equal(back.c, b.c);
  await s.removeProduct(back.id);
  const cake = await s.upsertProduct({ name: 'Cake', price: 10 });                // takes the colour Brownie had
  assert.equal(cake.c, b.c);
  await s.restoreProduct(inHistory(l.get(), 'Brownie').id);
  assert.equal(new Set(l.get().products.map(p => p.c)).size, l.get().products.length);
  assert.equal(await s.restoreProduct(inHistory(l.get(), 'Brownie').id), null);   // already on the menu: nothing to do
});

test('local restoreAll restores only what is missing, and forgetHistory drops a removed entry', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  for (const p of [...l.get().products]) await s.removeProduct(p.id);
  assert.equal(l.get().products.length, 0);
  assert.equal(await s.restoreAll(), 2);
  assert.equal(l.get().products.length, 2);
  assert.equal(await s.restoreAll(), 0);
  const p = l.get().products[0];
  await s.removeProduct(p.id);
  await s.forgetHistory(inHistory(l.get(), p.name).id);
  assert.equal(inHistory(l.get(), p.name), undefined);
  await s.forgetHistory(inHistory(l.get(), l.get().products[0].name).id);   // on the menu: kept
  assert.ok(inHistory(l.get(), l.get().products[0].name));
});

test('local store builds the previous menu for products saved before this feature existed', () => {
  const s = mk({ 'biteflow.v1': JSON.stringify({ next: 1, orders: [], products: [{ id: 'p1', name: 'Old Item', price: 5, c: 2 }] }) });
  const l = last(); s.subscribe(l.cb);
  assert.deepEqual(l.get().history.map(h => [h.name, h.price, h.c]), [['Old Item', 5, 2]]);
});

test('cloud adding a product records it in the previous menu and removing it keeps the entry', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const p = await A.store.upsertProduct({ name: 'Brownie', price: 60 }); await tick();
  assert.deepEqual(server.get('meta/' + Store.historyId('Brownie')), { name: 'Brownie', price: 60, c: p.c });
  await A.store.removeProduct(p.id); await tick();
  assert.equal(onMenu(A.snap(), 'Brownie'), false);
  assert.equal(inHistory(A.snap(), 'Brownie').price, 60);
});

test('cloud restoreProduct keeps the saved price and colour when the colour is free, else picks a unique one', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const p = await A.store.upsertProduct({ name: 'Brownie', price: 60 }); await tick();
  await A.store.removeProduct(p.id); await tick();
  const back = await A.store.restoreProduct(inHistory(A.snap(), 'Brownie').id); await tick();
  assert.equal(back.price, 60); assert.equal(back.c, p.c);
  await A.store.removeProduct(back.id); await tick();
  const cake = await A.store.upsertProduct({ name: 'Cake', price: 10 }); await tick();
  assert.equal(cake.c, p.c);
  await A.store.restoreProduct(inHistory(A.snap(), 'Brownie').id); await tick();
  assert.equal(A.snap().products.length, 2);
  assert.equal(new Set(A.snap().products.map(x => x.c)).size, 2);
});

test('cloud products saved before this feature are added to the previous menu once', async () => {
  const server = createFakeServer();
  server.data.set('products/a', { name: 'Alpha', price: 1, c: 0 });
  server.data.set('products/b', { name: 'Beta', price: 2, c: 1 });
  const A = cloud(server); await tick(10);
  assert.deepEqual(A.snap().history.map(h => h.name).sort(), ['Alpha', 'Beta']);
  const writes = server.log.filter(op => op.path.startsWith('meta/menu-')).length;
  await tick(10);
  assert.equal(server.log.filter(op => op.path.startsWith('meta/menu-')).length, writes);   // not rewritten on every snapshot
  assert.equal(writes, 2);
});

test('cloud setProductPrice also updates the price in the previous menu', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const p = await A.store.upsertProduct({ name: 'Brownie', price: 60 }); await tick();
  await A.store.setProductPrice(p.id, 75); await tick();
  assert.equal(inHistory(A.snap(), 'Brownie').price, 75);
});

test('cloud forgetHistory removes an entry that is off the menu but keeps one that is on it', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const a = await A.store.upsertProduct({ name: 'Alpha', price: 1 });
  const b = await A.store.upsertProduct({ name: 'Beta', price: 2 }); await tick();
  await A.store.removeProduct(b.id); await tick();
  await A.store.forgetHistory(inHistory(A.snap(), 'Beta').id);
  await A.store.forgetHistory(inHistory(A.snap(), 'Alpha').id); await tick();
  assert.equal(inHistory(A.snap(), 'Beta'), undefined);
  assert.ok(inHistory(A.snap(), 'Alpha'));
});

test('cloud restoreAll restores only the products that are missing from the menu', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const a = await A.store.upsertProduct({ name: 'Alpha', price: 1 });
  const b = await A.store.upsertProduct({ name: 'Beta', price: 2 });
  const c = await A.store.upsertProduct({ name: 'Gamma', price: 3 }); await tick();
  await A.store.removeProduct(a.id); await A.store.removeProduct(c.id); await tick();
  assert.equal(await A.store.restoreAll(), 2); await tick();
  assert.deepEqual(A.snap().products.map(p => p.name).sort(), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(await A.store.restoreAll(), 0);
});


// ---------- weekends ----------
const sat = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('weekKeyOf puts every day of Mon-Sun into the weekend that ends on Sunday', () => {
  assert.equal(Store.weekKeyOf(sat(2026, 11, 21)), WEEK);            // Saturday
  assert.equal(Store.weekKeyOf(sat(2026, 11, 22, 23, 30)), WEEK);    // Sunday night is still that Sunday
  assert.equal(Store.weekKeyOf(sat(2026, 11, 23, 0, 5)), NEXT);      // Monday just after midnight starts the next weekend
  assert.equal(Store.weekKeyOf(sat(2026, 11, 16)), WEEK);            // Monday of the same week
  assert.equal(Store.weekKeyOf(sat(2026, 12, 31)), '2027-01-03');    // crosses the year
});

test('addWeeks and weekLabel work on weekend keys', () => {
  assert.equal(Store.addWeeks(WEEK, -1), PREV);
  assert.equal(Store.addWeeks(WEEK, 1), NEXT);
  assert.equal(Store.addWeeks('2026-12-27', 1), '2027-01-03');
  assert.equal(Store.weekLabel(WEEK), 'Sun 22 Nov');
});

test('local store: orders belong to the selected weekend and numbers restart each weekend', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  assert.equal(l.get().week, WEEK); assert.equal(l.get().currentWeek, WEEK);
  const a = await s.addOrder({ name: 'A', items: [item()], notes: '' });
  const b = await s.addOrder({ name: 'B', items: [item()], notes: '' });
  assert.deepEqual([a.num, b.num], [1, 2]); assert.equal(a.week, WEEK);
  s.setWeek(NEXT);
  assert.equal(l.get().week, NEXT); assert.equal(l.get().orders.length, 0);
  const c = await s.addOrder({ name: 'C', items: [item()], notes: '' });
  assert.equal(c.num, 1); assert.equal(c.week, NEXT);
  s.setWeek(WEEK);
  assert.deepEqual(l.get().orders.map(o => o.name), ['A', 'B']);
});

test('local store: every weekend has its own menu, and the weekends list summarises orders and totals', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  await s.addOrder({ name: 'A', items: [item('Croquette', 2, 100)], notes: '' });
  s.setWeek(NEXT);
  assert.deepEqual(l.get().products, []);                               // nothing on next weekend's menu yet
  await s.upsertProduct({ name: 'Brownie', price: 60 });
  assert.deepEqual(l.get().products.map(p => p.name), ['Brownie']);
  s.setWeek(WEEK);
  assert.deepEqual(l.get().products.map(p => p.name).sort(), ['Croquette', 'Sandwich']);
  const w = Object.fromEntries(l.get().weeks.map(x => [x.key, x]));
  assert.deepEqual([w[WEEK].orders, w[WEEK].total], [1, 200]);
  assert.deepEqual(l.get().weeks.map(x => x.key), [NEXT, WEEK]);        // newest first
});

test('local store: copyPreviousMenu copies the latest earlier menu once, keeping price and colour', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  const before = l.get().products.map(p => [p.name, p.price, p.c]).sort();
  s.setWeek(NEXT);
  assert.equal(l.get().prevMenu.week, WEEK);
  assert.equal(await s.copyPreviousMenu(), 2);
  assert.deepEqual(l.get().products.map(p => [p.name, p.price, p.c]).sort(), before);
  assert.equal(await s.copyPreviousMenu(), 0);
  assert.equal(l.get().products.every(p => p.week === NEXT), true);
});

test('local store: data saved before weekends are placed by order date, and the old menu becomes this weekend\'s menu', () => {
  const old = { next: 9, products: [{ id: 'p1', name: 'Old Item', price: 5, c: 2 }],
    orders: [{ id: 1, num: 3, status: 'delivered', created: sat(2026, 11, 10), name: 'Past', notes: '', items: [{ name: 'Old Item', qty: 1, price: 5 }] },
             { id: 2, num: 4, status: 'new', created: sat(2026, 11, 19), name: 'Now', notes: '', items: [{ name: 'Old Item', qty: 2, price: 5 }] }] };
  const s = mk({ 'biteflow.v1': JSON.stringify(old) }); const l = last(); s.subscribe(l.cb);
  assert.deepEqual(l.get().orders.map(o => o.name), ['Now']);
  assert.deepEqual(l.get().products.map(p => p.name), ['Old Item']);
  s.setWeek('2026-11-15');
  assert.deepEqual(l.get().orders.map(o => o.name), ['Past']);
  assert.equal(l.get().orders[0].num, 3);                                // old numbers are kept
});

test('local store: a product removed from this weekend stays in the previous menu and can be added to any weekend', async () => {
  const s = mk(); const l = last(); s.subscribe(l.cb);
  const c = l.get().products.find(p => p.name === 'Croquette');
  await s.removeProduct(c.id);
  s.setWeek(NEXT);
  assert.ok(l.get().history.find(h => h.name === 'Croquette'));
  await s.restoreProduct(l.get().history.find(h => h.name === 'Croquette').id);
  assert.deepEqual(l.get().products.map(p => [p.name, p.week]), [['Croquette', NEXT]]);
});

test('cloud: order numbers restart for each weekend and each weekend has its own counter', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  await A.store.addOrder({ name: 'a1', items: [item()], notes: '' });
  await A.store.addOrder({ name: 'a2', items: [item()], notes: '' }); await tick(10);
  A.store.setWeek(NEXT); await tick();
  const n1 = await A.store.addOrder({ name: 'n1', items: [item()], notes: '' }); await tick(10);
  assert.equal(n1.num, 1); assert.equal(n1.week, NEXT);
  assert.equal(server.get('meta/counter-' + WEEK).next, 3);
  assert.equal(server.get('meta/counter-' + NEXT).next, 2);
  A.store.setWeek(WEEK); await tick();
  assert.deepEqual(A.snap().orders.map(o => o.num), [1, 2]);
});

test('cloud: two devices adding to the same weekend still get different numbers', async () => {
  const server = createFakeServer(); const A = cloud(server), B = cloud(server); await tick();
  await Promise.all([A.store.addOrder({ name: 'A', items: [item()], notes: '' }), B.store.addOrder({ name: 'B', items: [item()], notes: '' })]);
  await tick(12);
  assert.deepEqual(A.snap().orders.map(o => o.num), [1, 2]);
  assert.ok(A.snap().orders.every(o => !o.provisional && o.week === WEEK));
});

test('cloud: orders without a weekend (saved before this feature) are placed by date and numbering continues in that weekend', async () => {
  const server = createFakeServer();
  server.data.set('orders/o1', { num: 7, status: 'delivered', created: sat(2026, 11, 10), name: 'Past', notes: '', items: [] });
  server.data.set('orders/o2', { num: 8, status: 'new', created: sat(2026, 11, 19), name: 'Now', notes: '', items: [] });
  const A = cloud(server); await tick();
  assert.deepEqual(A.snap().orders.map(o => o.name), ['Now']);
  const o = await A.store.addOrder({ name: 'next', items: [item()], notes: '' }); await tick(10);
  assert.equal(A.snap().orders.find(x => x.name === 'next').num, 9);
  A.store.setWeek('2026-11-15'); await tick();
  assert.deepEqual(A.snap().orders.map(x => x.num), [7]);
});

test('cloud: products saved before weekends move into this weekend\'s menu once, and later weekends start empty', async () => {
  const server = createFakeServer();
  server.data.set('products/a', { name: 'Alpha', price: 1, c: 0 });
  server.data.set('products/b', { name: 'Beta', price: 2, c: 1 });
  const A = cloud(server); await tick(10);
  assert.deepEqual(A.snap().products.map(p => p.name).sort(), ['Alpha', 'Beta']);
  assert.equal(server.get('products/a').week, WEEK);
  A.store.setWeek(NEXT); await tick();
  assert.deepEqual(A.snap().products, []);
  assert.deepEqual(A.snap().history.map(h => h.name).sort(), ['Alpha', 'Beta']);
});

test('cloud: copyPreviousMenu fills a new weekend from the latest earlier menu', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  const a = await A.store.upsertProduct({ name: 'Alpha', price: 10 });
  await A.store.upsertProduct({ name: 'Beta', price: 20 }); await tick();
  A.store.setWeek(NEXT); await tick();
  assert.equal(A.snap().prevMenu.week, WEEK);
  assert.equal(await A.store.copyPreviousMenu(), 2); await tick();
  assert.deepEqual(A.snap().products.map(p => [p.name, p.price, p.week]).sort(), [['Alpha', 10, NEXT], ['Beta', 20, NEXT]]);
  assert.equal(A.snap().products.find(p => p.name === 'Alpha').c, a.c);
  assert.equal(await A.store.copyPreviousMenu(), 0);
});

test('cloud: a number picked offline uses the highest number of that weekend', async () => {
  const server = createFakeServer(); const A = cloud(server); await tick();
  await A.store.addOrder({ name: '1', items: [item()], notes: '' }); await tick(10);
  A.store.setWeek(NEXT); await tick();
  A.client.setOnline(false); await tick();
  const o = await A.store.addOrder({ name: 'offline next weekend', items: [item()], notes: '' });
  assert.equal(o.num, 1);                                                  // not 2: it belongs to the other weekend
});


// ---------- previous menu recovered from past orders ----------
const pastOrders = () => [
  { id: 'o1', num: 1, status: 'delivered', created: sat(2026, 11, 3), week: '2026-11-08', name: 'A', notes: '', items: [{ name: 'Puff', qty: 2, price: 50, c: 3 }, { name: 'Croquette', qty: 1, price: 90, c: 0 }] },
  { id: 'o2', num: 2, status: 'delivered', created: sat(2026, 11, 10), week: '2026-11-15', name: 'B', notes: '', items: [{ name: 'Puff', qty: 1, price: 60, c: 3 }, { name: 'Samosa', qty: 3, price: 90 }] },
  { id: 'o3', num: 3, status: 'delivered', created: sat(2026, 11, 11), week: '2026-11-15', name: 'C', notes: '', items: [{ name: 'puff', qty: 1, price: 0 }] }
];

test('historyFromOrders lists each product used in orders once, newest price and colour winning, skipping known ones', () => {
  const known = [{ id: Store.historyId('Croquette'), name: 'Croquette', price: 100, c: 0 }];
  const out = Store.historyFromOrders(pastOrders(), known);
  assert.deepEqual(out.map(e => e.name).sort(), ['Puff', 'Samosa']);
  const puff = out.find(e => e.name === 'Puff');
  assert.equal(puff.price, 60);                       // newest non-zero price
  assert.equal(puff.c, 3);
  const samosa = out.find(e => e.name === 'Samosa');
  assert.equal(samosa.price, 90);
  assert.ok(Number.isInteger(samosa.c) && samosa.c !== 0 && samosa.c !== 3, 'a free colour was chosen');
});

test('local store adds products from past orders to the previous menu once, and forgetting one sticks', async () => {
  const init = { 'biteflow.v1': JSON.stringify({ next: 4, products: [{ id: 'p1', name: 'Croquette', price: 100, c: 0, week: WEEK }], orders: pastOrders() }) };
  const storage = memStorage(init);
  const mkStore = () => Store.createLocalStore({ storage, seed: SEED, now: () => FIXED });
  let s = mkStore(); let l = last(); s.subscribe(l.cb);
  assert.deepEqual(l.get().history.map(h => h.name.toLowerCase()).sort(), ['croquette', 'puff', 'samosa']);
  assert.equal(l.get().products.length, 1);                                  // the menu itself is untouched
  const puff = l.get().history.find(h => h.name.toLowerCase() === 'puff');
  await s.forgetHistory(puff.id);
  s = mkStore(); l = last(); s.subscribe(l.cb);
  assert.deepEqual(l.get().history.map(h => h.name.toLowerCase()).sort(), ['croquette', 'samosa']);   // not brought back
});

test('cloud adds products from past orders to the previous menu once, and forgetting one sticks', async () => {
  const server = createFakeServer();
  pastOrders().forEach(o => { const { id, ...rest } = o; server.data.set('orders/' + id, rest); });
  server.data.set('products/p1', { name: 'Croquette', price: 100, c: 0, week: WEEK });
  const A = cloud(server); await tick(12);
  assert.deepEqual(A.snap().history.map(h => h.name.toLowerCase()).sort(), ['croquette', 'puff', 'samosa']);
  assert.ok(server.get('meta/backfill-orders-v1'));
  const writes = () => server.log.filter(op => op.path.startsWith('meta/')).length;
  const before = writes();
  const B = cloud(server); await tick(12);                                      // another device: nothing more to write
  assert.equal(writes(), before);
  const puff = A.snap().history.find(h => h.name.toLowerCase() === 'puff');
  await A.store.forgetHistory(puff.id); await tick(12);
  const C = cloud(server); await tick(12);
  assert.equal(C.snap().history.some(h => h.name.toLowerCase() === 'puff'), false);
});

test('cloud does not recover products from orders while offline (the orders it sees may be incomplete)', async () => {
  const server = createFakeServer();
  pastOrders().forEach(o => { const { id, ...rest } = o; server.data.set('orders/' + id, rest); });
  const A = cloud(server, { online: false }); await tick(12);
  assert.equal(server.get('meta/backfill-orders-v1'), undefined);
  A.client.setOnline(true); await tick(12);
  assert.ok(server.get('meta/backfill-orders-v1'));
});
