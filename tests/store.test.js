const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../app/store.js');

const memStorage = (init) => {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};
const SEED = [{ name: 'Croquette', price: 100 }, { name: 'Sandwich', price: 75 }];
const mk = (init) => Store.createLocalStore({ storage: memStorage(init), seed: SEED });
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
  const s1 = Store.createLocalStore({ storage, seed: SEED });
  await s1.addOrder({ name: 'A', items: [{ name: 'Croquette', qty: 1, price: 100 }], notes: '' });
  const s2 = Store.createLocalStore({ storage, seed: SEED }); const l = last(); s2.subscribe(l.cb);
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
  const store = Store.createCloudStore({ fb: client.fb, db: client.db });
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
  assert.deepEqual([a.num, b.num].sort(), [1, 2]);
  await tick();
  assert.deepEqual(A.snap().orders.map(o => o.num), [1, 2]);
  assert.equal(server.get('meta/counter').next, 3);
});

test('cloud setStatus writes only the status field', async () => {
  const server = createFakeServer();
  const A = cloud(server); await tick();
  const o = await A.store.addOrder({ name: 'A', items: [item()], notes: 'n' });
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
  assert.ok(server.get('meta/counter').next >= 4, 'counter was ' + JSON.stringify(server.get('meta/counter')));
  const nxt = await A.store.addOrder({ name: 'after', items: [item()], notes: '' });
  assert.equal(nxt.num, 4);
});

test('cloud clearDelivered with 1200 delivered orders deletes all of them', async () => {
  const server = createFakeServer();
  for (let i = 1; i <= 1200; i++) server.data.set('orders/d' + i, { num: i, status: 'delivered', created: i, name: '', notes: '', items: [] });
  for (let i = 0; i < 3; i++) server.data.set('orders/n' + i, { num: 2000 + i, status: 'new', created: 1, name: '', notes: '', items: [] });
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
