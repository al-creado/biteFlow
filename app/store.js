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
  // Previous-menu entries are keyed by product name (case-insensitive). The key is a valid Firestore document id.
  const historyId = name => 'menu-' + encodeURIComponent(lc(name));

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
    const history = (Array.isArray(r.history) ? r.history : []).filter(h => h && h.name).map(h => ({ id: historyId(h.name), name: h.name, price: Number(h.price) || 0, c: h.c }));
    const maxNum = orders.reduce((m, o) => Math.max(m, o.num), 0);
    return { next: Number(r.next) || maxNum + 1, orders, products, history };
  }

  const cleanItems = items => items.map(i => ({ name: i.name, qty: Math.max(1, Number(i.qty) || 1), price: Number(i.price) || 0 }));

  function createLocalStore({ storage, seed }) {
    let data;
    try { const raw = storage.getItem(KEY); data = raw ? normalizeLegacy(JSON.parse(raw)) : null; } catch (e) { data = null; }
    if (!data) data = normalizeLegacy({ next: 1, orders: [], products: (seed || []).map(p => ({ ...p })) });
    const listeners = new Set();
    // every product that has ever been on the menu stays in `history` (the "previous menu")
    const touchHistory = p => {
      const id = historyId(p.name);
      let h = data.history.find(x => x.id === id);
      if (!h) { h = { id }; data.history.push(h); }
      h.name = p.name; h.price = p.price; h.c = p.c;
    };
    const onMenu = name => data.products.some(p => lc(p.name) === lc(name));
    const colourFree = c => Number.isInteger(c) && !data.products.some(p => p.c === c);
    const bringBack = h => {
      const p = { id: uid(), name: h.name, price: h.price || 0, c: colourFree(h.c) ? h.c : undefined };
      data.products.push(p); assignColors(data.products); return p;
    };
    data.products.forEach(touchHistory);
    const snapshot = () => ({ orders: clone(data.orders), products: clone(data.products), history: clone(data.history), status: 'synced' });
    const commit = () => {
      data.products.forEach(touchHistory);
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
      async restoreProduct(id) {
        const h = data.history.find(x => x.id === id);
        if (!h || onMenu(h.name)) return null;
        const p = bringBack(h); commit(); return clone(p);
      },
      async restoreAll() {
        const missing = data.history.filter(h => !onMenu(h.name));
        missing.forEach(bringBack);
        if (missing.length) commit();
        return missing.length;
      },
      async forgetHistory(id) {
        const h = data.history.find(x => x.id === id);
        if (!h || onMenu(h.name)) return;
        data.history = data.history.filter(x => x.id !== id); commit();
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
  const BATCH_LIMIT = 500;

  function createCloudStore({ fb, db, onError }) {
    const orders = new Map(), products = new Map(), history = new Map();
    const flags = { orders: null, products: null, meta: null };   // metadata of the latest snapshot of each collection
    const listeners = new Set();
    let status = 'syncing';
    const unsubs = [];

    const ordersCol = () => fb.collection(db, 'orders');
    const orderRef = id => fb.doc(db, 'orders', id);
    const productRef = id => fb.doc(db, 'products', id);
    const counterRef = () => fb.doc(db, 'meta', 'counter');
    const quiet = p => { Promise.resolve(p).catch(() => {}); };
    const highest = () => { let m = 0; orders.forEach(o => { if (o.num > m) m = o.num; }); return m; };

    function computeStatus() {
      const f = [flags.orders, flags.products, flags.meta].filter(Boolean);
      if (f.some(m => m.fromCache)) return 'offline';
      if (f.some(m => m.hasPendingWrites)) return 'syncing';
      return 'synced';
    }
    function snapshot() {
      return {
        orders: clone([...orders.values()].sort((a, b) => a.num - b.num)),
        products: clone([...products.values()]),
        history: clone([...history.values()]),
        status
      };
    }
    function emit() {
      if (!flags.orders || !flags.products || !flags.meta) return;   // wait for the first data from every collection
      status = computeStatus();
      backfillHistory();
      const snap = snapshot();
      listeners.forEach(cb => cb(snap));
      if (status === 'synced' && [...orders.values()].some(o => o.provisional)) assignNumbers();
    }
    function load(map, snap) {
      map.clear();
      snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    }
    // The previous menu lives in the `meta` collection as `menu-<name>` documents (already allowed by the rules).
    const histRef = name => fb.doc(db, 'meta', historyId(name));
    const histDoc = p => ({ name: p.name, price: Number(p.price) || 0, ...(Number.isInteger(p.c) ? { c: p.c } : {}) });
    const writeHistory = p => quiet(fb.setDoc(histRef(p.name), histDoc(p)));
    const backfilled = new Set();       // ids already written by the backfill, so it never loops on slow snapshots
    function backfillHistory() {
      products.forEach(p => {
        const id = historyId(p.name);
        if (history.has(id) || backfilled.has(id)) return;
        backfilled.add(id); writeHistory(p);
      });
    }
    const listenOpts = { includeMetadataChanges: true };   // without this the SDK never reports offline/synced changes
    const attach = () => {
      unsubs.push(fb.onSnapshot(ordersCol(), listenOpts, snap => { load(orders, snap); flags.orders = snap.metadata; emit(); }, err => onError && onError(err)));
      unsubs.push(fb.onSnapshot(fb.collection(db, 'products'), listenOpts, snap => { load(products, snap); flags.products = snap.metadata; emit(); }, err => onError && onError(err)));
      unsubs.push(fb.onSnapshot(fb.collection(db, 'meta'), listenOpts, snap => {
        history.clear();
        snap.docs.forEach(d => { if (d.id.startsWith('menu-')) history.set(d.id, { id: d.id, ...d.data() }); });
        flags.meta = snap.metadata; emit();
      }, err => onError && onError(err)));
    };
    attach();

    // New orders are written at once with a provisional number (so the UI never waits). Whenever the
    // connection is healthy, each provisional order is given its final number from the shared counter.
    const finalHighest = () => { let m = 0; orders.forEach(o => { if (!o.provisional && o.num > m) m = o.num; }); return m; };
    let assigning = false, again = false;
    async function assignNumbers() {
      if (assigning) { again = true; return; }      // a snapshot arrived mid-run: look again when this run ends
      assigning = true;
      try {
        do {
          again = false;
          const todo = [...orders.values()].filter(o => o.provisional).sort((a, b) => a.created - b.created).map(o => o.id);
          for (const id of todo) {
            await fb.runTransaction(db, async tx => {
              const o = await tx.get(orderRef(id));
              if (!o.exists() || !o.data().provisional) return;
              const c = await tx.get(counterRef());
              const n = Math.max(c.exists() ? c.data().next : 1, finalHighest() + 1);
              tx.set(counterRef(), { next: n + 1 });
              tx.update(orderRef(id), { num: n, provisional: false });
            });
          }
        } while (again);
      } catch (e) { /* offline or busy: tried again on the next synced snapshot */ }
      assigning = false;
    }

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
        if (flags.orders && flags.products && flags.meta) cb(snapshot());
        return () => listeners.delete(cb);
      },
      destroy() { unsubs.forEach(u => u()); unsubs.length = 0; listeners.clear(); },
      restart() { unsubs.forEach(u => u()); unsubs.length = 0; flags.orders = flags.products = flags.meta = null; backfilled.clear(); attach(); },

      async addOrder({ name, items, notes }) {
        const id = uid();
        const order = { status: 'new', created: Date.now(), name: name || '', notes: notes || '', items: cleanItems(items), num: highest() + 1, provisional: true };
        quiet(fb.setDoc(orderRef(id), order));      // shown at once; the final number is assigned once the write is confirmed
        return { id, ...order };
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
        if (ex) { quiet(fb.updateDoc(productRef(ex.id), { price: p })); writeHistory({ ...ex, price: p }); return { ...ex, price: p }; }
        const prod = { id: uid(), name, price: p, c: nextColor(name) };
        quiet(fb.setDoc(productRef(prod.id), { name: prod.name, price: prod.price, c: prod.c }));
        writeHistory(prod);
        return prod;
      },
      async setProductPrice(id, price) {
        const p = Math.max(0, Number(price) || 0), ex = products.get(id);
        quiet(fb.updateDoc(productRef(id), { price: p }));
        if (ex) writeHistory({ ...ex, price: p });
      },
      async removeProduct(id) { quiet(fb.deleteDoc(productRef(id))); },
      async restoreProduct(id) {
        const h = history.get(id);
        if (!h || findProduct(h.name)) return null;
        const free = Number.isInteger(h.c) && ![...products.values()].some(p => p.c === h.c);
        const prod = { id: uid(), name: h.name, price: h.price || 0, c: free ? h.c : nextColor(h.name) };
        quiet(fb.setDoc(productRef(prod.id), { name: prod.name, price: prod.price, c: prod.c }));
        return prod;
      },
      async restoreAll() {
        const known = [...products.values()].map(p => ({ ...p }));
        let n = 0;
        for (const h of history.values()) {
          if (known.some(p => lc(p.name) === lc(h.name))) continue;
          const prod = { id: uid(), name: h.name, price: h.price || 0, c: Number.isInteger(h.c) && !known.some(p => p.c === h.c) ? h.c : undefined };
          known.push(prod); assignColors(known); n++;
          quiet(fb.setDoc(productRef(prod.id), { name: prod.name, price: prod.price, c: prod.c }));
        }
        return n;
      },
      async forgetHistory(id) {
        const h = history.get(id);
        if (!h || findProduct(h.name)) return;
        quiet(fb.deleteDoc(fb.doc(db, 'meta', id)));
      },
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
        const importId = o => 'legacy-' + String(o.id).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + o.created;
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

  return { KEY, PALETTE_SIZE, historyId, uid, clone, cleanItems, assignColors, normalizeLegacy, createLocalStore, createCloudStore };
});
