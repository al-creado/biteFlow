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
