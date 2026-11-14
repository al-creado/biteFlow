/* Data layer. All reads/writes go through a store (local or cloud).
   UMD: module.exports in node (tests), window.Store in the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY = 'biteflow.v1';
  const PALETTE_SIZE = 8;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = v => JSON.parse(JSON.stringify(v));
  const lc = s => String(s).toLowerCase();

  function assignColors(products) {
    const used = new Set(products.filter(p => Number.isInteger(p.c)).map(p => p.c));
    products.forEach(p => {
      if (Number.isInteger(p.c)) return;
      let c = -1;
      for (let i = 0; i < PALETTE_SIZE; i++) if (!used.has(i)) { c = i; break; }
      if (c < 0) c = products.indexOf(p) % PALETTE_SIZE;
      p.c = c; used.add(c);
    });
  }

  function normalizeLegacy(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const products = (Array.isArray(r.products) ? r.products : []).map((p, i) => {
      const o = typeof p === 'string' ? { name: p, price: 0 } : { name: p.name, price: Number(p.price) || 0, c: p.c };
      o.id = p && p.id ? String(p.id) : 'p-' + (i + 1);
      return o;
    });
    assignColors(products);
    const priceOf = n => (products.find(p => p.name === n) || {}).price || 0;
    const orders = (Array.isArray(r.orders) ? r.orders : []).map(o => ({
      id: String(o.id),
      num: Number(o.num) || 0,
      status: o.status === 'completed' ? 'delivered' : o.status,
      created: Number(o.created) || 0,
      name: o.name || '',
      notes: o.notes || '',
      items: (o.items || []).map(i => {
        if (typeof i === 'string') {
          const m = i.match(/^\s*(\d+)\s*x\s*(.+)$/i);
          i = m ? { name: m[2].trim(), qty: +m[1] } : { name: i, qty: 1 };
        }
        return { name: i.name, qty: Number(i.qty) || 1, price: typeof i.price === 'number' ? i.price : priceOf(i.name) };
      })
    }));
    const maxNum = orders.reduce((m, o) => Math.max(m, o.num), 0);
    return { next: Number(r.next) || maxNum + 1, orders, products };
  }

  const hashString = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
  const cleanItems = items => items.map(i => ({ name: i.name, qty: Math.max(1, Number(i.qty) || 1), price: Number(i.price) || 0 }));

  function createLocalStore({ storage, seed }) {
    let data;
    try { const raw = storage.getItem(KEY); data = raw ? normalizeLegacy(JSON.parse(raw)) : null; } catch (e) { data = null; }
    if (!data) data = normalizeLegacy({ next: 1, orders: [], products: (seed || []).map(p => ({ ...p })) });
    const listeners = new Set();
    const snapshot = () => ({ orders: clone(data.orders), products: clone(data.products), status: 'synced' });
    const commit = () => {
      try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
      listeners.forEach(cb => cb(snapshot()));
    };
    const findOrder = id => data.orders.find(o => o.id === String(id));

    const store = {
      kind: 'local',
      subscribe(cb) { listeners.add(cb); cb(snapshot()); return () => listeners.delete(cb); },
      async addOrder({ name, items, notes }) {
        const o = { id: uid(), num: data.next++, status: 'new', created: Date.now(), name: name || '', notes: notes || '', items: cleanItems(items) };
        data.orders.push(o); commit(); return clone(o);
      },
      async updateOrder(id, fields) {
        const o = findOrder(id); if (!o) return;
        if ('name' in fields) o.name = fields.name || '';
        if ('notes' in fields) o.notes = fields.notes || '';
        if ('items' in fields) o.items = cleanItems(fields.items);
        commit();
      },
      async setStatus(id, status) { const o = findOrder(id); if (o) { o.status = status; commit(); } },
      async deleteOrder(id) { data.orders = data.orders.filter(o => o.id !== String(id)); commit(); },
      async clearDelivered() { data.orders = data.orders.filter(o => o.status !== 'delivered'); commit(); },
      async upsertProduct({ name, price }) {
        let p = data.products.find(x => lc(x.name) === lc(name));
        if (p) p.price = Number(price) || 0;
        else { p = { id: uid(), name, price: Number(price) || 0 }; data.products.push(p); assignColors(data.products); }
        commit(); return clone(p);
      },
      async setProductPrice(id, price) { const p = data.products.find(x => x.id === id); if (p) { p.price = Math.max(0, Number(price) || 0); commit(); } },
      async removeProduct(id) { data.products = data.products.filter(p => p.id !== id); commit(); },
      async seedProducts(list) {
        list.forEach(s => {
          const p = data.products.find(x => lc(x.name) === lc(s.name));
          if (!p) data.products.push({ id: uid(), name: s.name, price: s.price });
          else if (!p.price) p.price = s.price;
        });
        assignColors(data.products); commit();
      },
      async importLegacy() { return { orders: 0, products: 0 }; }
    };
    return store;
  }

  // ---------------------------------------------------------------------------
  // Cloud backend (Firestore). `fb` is the Firestore function set, `db` the database.
  // Writes are applied locally at once and are NOT awaited for server acknowledgement,
  // so the UI never hangs offline. Only addOrder waits (for its number) while online.
  // ---------------------------------------------------------------------------
  const TX_TIMEOUT_MS = 4000;
  const BATCH_LIMIT = 500;

  function createCloudStore({ fb, db, onError }) {
    const orders = new Map(), products = new Map();
    const flags = { orders: null, products: null };   // metadata of the latest snapshot of each collection
    const listeners = new Set();
    let status = 'syncing', counterDirty = false, reconciling = false;
    const unsubs = [];

    const ordersCol = () => fb.collection(db, 'orders');
    const orderRef = id => fb.doc(db, 'orders', id);
    const productRef = id => fb.doc(db, 'products', id);
    const counterRef = () => fb.doc(db, 'meta', 'counter');
    const quiet = p => { Promise.resolve(p).catch(() => {}); };
    const highest = () => { let m = 0; orders.forEach(o => { if (o.num > m) m = o.num; }); return m; };

    function computeStatus() {
      const f = [flags.orders, flags.products].filter(Boolean);
      if (f.some(m => m.fromCache)) return 'offline';
      if (f.some(m => m.hasPendingWrites)) return 'syncing';
      return 'synced';
    }
    function snapshot() {
      return {
        orders: clone([...orders.values()].sort((a, b) => a.num - b.num)),
        products: clone([...products.values()]),
        status
      };
    }
    function emit() {
      if (!flags.orders || !flags.products) return;   // wait for the first data from both collections
      status = computeStatus();
      const snap = snapshot();
      listeners.forEach(cb => cb(snap));
      if (counterDirty && status === 'synced') reconcileCounter();
    }
    function load(map, snap) {
      map.clear();
      snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    }
    unsubs.push(fb.onSnapshot(ordersCol(), snap => { load(orders, snap); flags.orders = snap.metadata; emit(); }, err => onError && onError(err)));
    unsubs.push(fb.onSnapshot(fb.collection(db, 'products'), snap => { load(products, snap); flags.products = snap.metadata; emit(); }, err => onError && onError(err)));

    // After offline numbering the shared counter may lag behind the highest number in use.
    async function reconcileCounter() {
      if (reconciling) return;
      reconciling = true;
      try {
        await fb.runTransaction(db, async tx => {
          const snap = await tx.get(counterRef());
          const next = snap.exists() ? snap.data().next : 1;
          const want = highest() + 1;
          if (next < want) tx.set(counterRef(), { next: want });
        });
        counterDirty = false;
      } catch (e) { /* try again on the next synced snapshot */ }
      reconciling = false;
    }

    const withTimeout = (p, ms) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });

    function nextColor(name) {
      const tmp = [...products.values()].map(p => ({ id: p.id, name: p.name, price: p.price, c: p.c }));
      const fresh = { id: '_new', name, price: 0 };
      tmp.push(fresh); assignColors(tmp);
      return fresh.c;
    }
    const findProduct = name => [...products.values()].find(p => lc(p.name) === lc(name));

    return {
      kind: 'cloud',
      subscribe(cb) {
        listeners.add(cb);
        if (flags.orders && flags.products) cb(snapshot());
        return () => listeners.delete(cb);
      },
      destroy() { unsubs.forEach(u => u()); listeners.clear(); },

      async addOrder({ name, items, notes }) {
        const id = uid();
        const base = { status: 'new', created: Date.now(), name: name || '', notes: notes || '', items: cleanItems(items) };
        if (status !== 'offline') {
          try {
            const num = await withTimeout(fb.runTransaction(db, async tx => {
              const snap = await tx.get(counterRef());
              const n = Math.max(snap.exists() ? snap.data().next : 1, highest() + 1);
              tx.set(counterRef(), { next: n + 1 });
              tx.set(orderRef(id), { ...base, num: n });
              return n;
            }), TX_TIMEOUT_MS);
            return { id, ...base, num };
          } catch (e) { /* offline or slow: fall through to local numbering */ }
        }
        const num = highest() + 1;
        counterDirty = true;
        quiet(fb.setDoc(orderRef(id), { ...base, num }));
        return { id, ...base, num };
      },
      async updateOrder(id, fields) {
        const f = {};
        if ('name' in fields) f.name = fields.name || '';
        if ('notes' in fields) f.notes = fields.notes || '';
        if ('items' in fields) f.items = cleanItems(fields.items);
        if (Object.keys(f).length) quiet(fb.updateDoc(orderRef(id), f));
      },
      async setStatus(id, st) { quiet(fb.updateDoc(orderRef(id), { status: st })); },
      async deleteOrder(id) { quiet(fb.deleteDoc(orderRef(id))); },
      async clearDelivered() {
        const ids = [...orders.values()].filter(o => o.status === 'delivered').map(o => o.id);
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = fb.writeBatch(db);
          ids.slice(i, i + BATCH_LIMIT).forEach(id => batch.delete(orderRef(id)));
          quiet(batch.commit());
        }
      },
      async upsertProduct({ name, price }) {
        const p = Number(price) || 0, ex = findProduct(name);
        if (ex) { quiet(fb.updateDoc(productRef(ex.id), { price: p })); return { ...ex, price: p }; }
        const prod = { id: uid(), name, price: p, c: nextColor(name) };
        quiet(fb.setDoc(productRef(prod.id), { name: prod.name, price: prod.price, c: prod.c }));
        return prod;
      },
      async setProductPrice(id, price) { quiet(fb.updateDoc(productRef(id), { price: Math.max(0, Number(price) || 0) })); },
      async removeProduct(id) { quiet(fb.deleteDoc(productRef(id))); },
      async seedProducts(list) {
        const known = [...products.values()].map(p => ({ ...p }));
        for (const s of list) {
          const ex = known.find(p => lc(p.name) === lc(s.name));
          if (ex) { if (!ex.price) { ex.price = s.price; quiet(fb.updateDoc(productRef(ex.id), { price: s.price })); } continue; }
          const prod = { id: uid(), name: s.name, price: s.price };
          known.push(prod); assignColors(known);
          quiet(fb.setDoc(productRef(prod.id), { name: prod.name, price: prod.price, c: prod.c }));
        }
      },
      async importLegacy(legacy) {
        // products: merge by name (case-insensitive), fill an empty price, add the rest
        const known = [...products.values()].map(p => ({ ...p }));
        let createdProducts = 0;
        for (const lp of legacy.products || []) {
          const ex = known.find(p => lc(p.name) === lc(lp.name));
          if (ex) { if (!ex.price && lp.price) { ex.price = lp.price; quiet(fb.updateDoc(productRef(ex.id), { price: lp.price })); } continue; }
          const prod = { id: uid(), name: lp.name, price: lp.price || 0 };
          known.push(prod); assignColors(known); createdProducts++;
          quiet(fb.setDoc(productRef(prod.id), { name: prod.name, price: prod.price, c: prod.c }));
        }
        // orders: stable ids make a repeat import (or the same data from another device) a no-op
        const importId = o => 'legacy-' + hashString(o.id + '|' + o.created);
        const fresh = (legacy.orders || []).filter(o => !orders.has(importId(o)))
          .sort((a, b) => a.created - b.created || a.num - b.num);
        const keepNumbers = orders.size === 0;     // first device in: keep its numbers; otherwise number from the shared counter
        for (let i = 0; i < fresh.length; i += 400) {
          await fb.runTransaction(db, async tx => {
            const snap = await tx.get(counterRef());
            const counter = snap.exists() ? snap.data().next : 1;
            let n = keepNumbers ? counter : Math.max(counter, highest() + 1), top = 0;
            fresh.slice(i, i + 400).forEach(o => {
              const num = keepNumbers ? o.num : n++;
              top = Math.max(top, num);
              tx.set(orderRef(importId(o)), { num, status: o.status, created: o.created, name: o.name, notes: o.notes, items: cleanItems(o.items), importedFrom: String(o.id) });
            });
            tx.set(counterRef(), { next: keepNumbers ? Math.max(counter, top + 1) : n });
          });
        }
        return { orders: fresh.length, products: createdProducts };
      }
    };
  }

  return { KEY, PALETTE_SIZE, uid, clone, cleanItems, assignColors, normalizeLegacy, createLocalStore, createCloudStore };
});
