/* Data layer. All reads/writes go through a store (local or cloud).
   UMD: module.exports in node (tests), window.Store in the browser.

   Orders belong to a "weekend": the Sunday (delivery day) they are for. Each weekend has its own menu
   (products) and its own order numbers. The store always exposes ONE selected weekend in its snapshot. */
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

  // ---- weekends: a weekend key is the date of its Sunday, 'YYYY-MM-DD' (local time) ----
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function weekKeyOf(ms) {                                  // Monday..Sunday all belong to the Sunday that ends that week
    const d = new Date(ms); d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + (7 - d.getDay()) % 7);
    return fmtDate(d);
  }
  function addWeeks(key, n) { const d = parseKey(key); d.setDate(d.getDate() + 7 * n); return fmtDate(d); }
  function weekLabel(key) { const d = parseKey(key); return 'Sun ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  const orderWeek = o => o.week || weekKeyOf(o.created);
  const orderTotal = o => o.items.reduce((t, i) => t + i.qty * (i.price || 0), 0);

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
      if (p && p.week) o.week = p.week;
      o.id = p && p.id ? String(p.id) : 'p-' + (i + 1);
      return o;
    });
    assignColors(products);
    const priceOf = n => (products.find(p => p.name === n) || {}).price || 0;
    const orders = (Array.isArray(r.orders) ? r.orders : []).map(o => {
      const created = Number(o.created) || 0;
      return {
        id: String(o.id),
        num: Number(o.num) || 0,
        status: o.status === 'completed' ? 'delivered' : o.status,
        created,
        week: o.week || weekKeyOf(created),
        name: o.name || '',
        notes: o.notes || '',
        items: (o.items || []).map(i => {
          if (typeof i === 'string') {
            const m = i.match(/^\s*(\d+)\s*x\s*(.+)$/i);
            i = m ? { name: m[2].trim(), qty: +m[1] } : { name: i, qty: 1 };
          }
          const it = { name: i.name, qty: Number(i.qty) || 1, price: typeof i.price === 'number' ? i.price : priceOf(i.name) };
          if (Number.isInteger(i.c)) it.c = i.c;
          return it;
        })
      };
    });
    const history = (Array.isArray(r.history) ? r.history : []).filter(h => h && h.name).map(h => ({ id: historyId(h.name), name: h.name, price: Number(h.price) || 0, c: h.c }));
    const maxNum = orders.reduce((m, o) => Math.max(m, o.num), 0);
    return { next: Number(r.next) || maxNum + 1, orders, products, history };
  }

  const cleanItems = items => items.map(i => {
    const it = { name: i.name, qty: Math.max(1, Number(i.qty) || 1), price: Number(i.price) || 0 };
    if (Number.isInteger(i.c)) it.c = i.c;          // the product colour at the time, so old orders keep their look
    return it;
  });

  // The one shape both stores hand to the UI. Products without a weekend (saved before weekends) count for `current`.
  function buildSnapshot({ orders, products, history, selected, current, status }) {
    const withWeek = orders.map(o => (o.week ? o : { ...o, week: orderWeek(o) }));
    const prods = products.map(p => (p.week ? p : { ...p, week: current }));
    const byWeek = new Map();
    const bump = k => { if (!byWeek.has(k)) byWeek.set(k, { key: k, orders: 0, total: 0 }); return byWeek.get(k); };
    withWeek.forEach(o => { const w = bump(o.week); w.orders++; w.total += orderTotal(o); });
    prods.forEach(p => bump(p.week));
    bump(current); bump(selected);
    const weeks = [...byWeek.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
    let prev = null;
    prods.forEach(p => { if (p.week < selected && (!prev || p.week > prev)) prev = p.week; });
    return {
      week: selected, currentWeek: current,
      orders: withWeek.filter(o => o.week === selected),
      products: prods.filter(p => p.week === selected),
      history, weeks,
      prevMenu: prev ? { week: prev, items: prods.filter(p => p.week === prev).map(p => ({ name: p.name, price: p.price, c: p.c })) } : null,
      status
    };
  }

  function createLocalStore({ storage, seed, now }) {
    const clock = now || Date.now;
    let data;
    try { const raw = storage.getItem(KEY); data = raw ? normalizeLegacy(JSON.parse(raw)) : null; } catch (e) { data = null; }
    const current = () => weekKeyOf(clock());
    let selected = current();
    if (!data) data = normalizeLegacy({ next: 1, orders: [], products: (seed || []).map(p => ({ ...p })) });
    data.products.forEach(p => { if (!p.week) p.week = selected; });      // menu saved before weekends belongs to this weekend
    const listeners = new Set();
    const menu = () => data.products.filter(p => p.week === selected);
    // every product that has ever been on a menu stays in `history` (the "previous menu")
    const touchHistory = p => {
      const id = historyId(p.name);
      let h = data.history.find(x => x.id === id);
      if (!h) { h = { id }; data.history.push(h); }
      h.name = p.name; h.price = p.price; h.c = p.c;
    };
    const onMenu = name => menu().some(p => lc(p.name) === lc(name));
    const colourFree = c => Number.isInteger(c) && !menu().some(p => p.c === c);
    const bringBack = h => {
      const p = { id: uid(), name: h.name, price: h.price || 0, c: colourFree(h.c) ? h.c : undefined, week: selected };
      data.products.push(p); assignColors(menu()); return p;
    };
    data.products.forEach(touchHistory);
    const snapshot = () => clone(buildSnapshot({ orders: data.orders, products: data.products, history: data.history, selected, current: current(), status: 'synced' }));
    const emit = () => { const snap = snapshot(); listeners.forEach(cb => cb(snap)); };
    const commit = () => {
      menu().forEach(touchHistory);
      try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
      emit();
    };
    const findOrder = id => data.orders.find(o => o.id === String(id));
    const highestIn = week => data.orders.reduce((m, o) => (orderWeek(o) === week ? Math.max(m, o.num) : m), 0);

    const store = {
      kind: 'local',
      subscribe(cb) { listeners.add(cb); cb(snapshot()); return () => listeners.delete(cb); },
      setWeek(key) { selected = key; emit(); },
      async addOrder({ name, items, notes }) {
        const o = { id: uid(), num: highestIn(selected) + 1, status: 'new', created: clock(), week: selected, name: name || '', notes: notes || '', items: cleanItems(items) };
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
      async clearDelivered() { data.orders = data.orders.filter(o => !(orderWeek(o) === selected && o.status === 'delivered')); commit(); },
      async upsertProduct({ name, price }) {
        let p = menu().find(x => lc(x.name) === lc(name));
        if (p) p.price = Number(price) || 0;
        else { p = { id: uid(), name, price: Number(price) || 0, week: selected }; data.products.push(p); assignColors(menu()); }
        commit(); return clone(p);
      },
      async setProductPrice(id, price) { const p = data.products.find(x => x.id === id); if (p) { p.price = Math.max(0, Number(price) || 0); commit(); } },
      async removeProduct(id) { data.products = data.products.filter(p => p.id !== id); commit(); },
      async seedProducts(list) {
        list.forEach(s => {
          const p = menu().find(x => lc(x.name) === lc(s.name));
          if (!p) data.products.push({ id: uid(), name: s.name, price: s.price, week: selected });
          else if (!p.price) p.price = s.price;
        });
        assignColors(menu()); commit();
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
      async copyPreviousMenu() {
        const prev = snapshot().prevMenu;
        if (!prev) return 0;
        const missing = prev.items.filter(it => !onMenu(it.name));
        missing.forEach(it => bringBack(it));
        if (missing.length) commit();
        return missing.length;
      },
      async importLegacy() { return { orders: 0, products: 0 }; }
    };
    return store;
  }

  // ---------------------------------------------------------------------------
  // Cloud backend (Firestore). `fb` is the Firestore function set, `db` the database.
  // Writes are applied locally at once and are NOT awaited for server acknowledgement,
  // so the UI never hangs offline.
  // ---------------------------------------------------------------------------
  const BATCH_LIMIT = 500;

  function createCloudStore({ fb, db, onError, now }) {
    const clock = now || Date.now;
    const orders = new Map(), products = new Map(), history = new Map();
    const flags = { orders: null, products: null, meta: null };   // metadata of the latest snapshot of each collection
    const listeners = new Set();
    let status = 'syncing';
    let selected = weekKeyOf(clock());
    const unsubs = [];

    const current = () => weekKeyOf(clock());
    const ordersCol = () => fb.collection(db, 'orders');
    const orderRef = id => fb.doc(db, 'orders', id);
    const productRef = id => fb.doc(db, 'products', id);
    const counterRef = week => fb.doc(db, 'meta', 'counter-' + week);     // each weekend numbers its own orders
    const quiet = p => { Promise.resolve(p).catch(() => {}); };
    const inWeek = week => [...orders.values()].filter(o => orderWeek(o) === week);
    const highest = week => inWeek(week).reduce((m, o) => Math.max(m, o.num), 0);
    const finalHighest = week => inWeek(week).reduce((m, o) => (o.provisional ? m : Math.max(m, o.num)), 0);
    const menu = () => [...products.values()].filter(p => (p.week || current()) === selected);

    function computeStatus() {
      const f = [flags.orders, flags.products, flags.meta].filter(Boolean);
      if (f.some(m => m.fromCache)) return 'offline';
      if (f.some(m => m.hasPendingWrites)) return 'syncing';
      return 'synced';
    }
    function snapshot() {
      return clone(buildSnapshot({
        orders: [...orders.values()].sort((a, b) => a.num - b.num),
        products: [...products.values()], history: [...history.values()],
        selected, current: current(), status
      }));
    }
    function emit() {
      if (!flags.orders || !flags.products || !flags.meta) return;   // wait for the first data from every collection
      status = computeStatus();
      migrateOldProducts();
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
    // Products saved before weekends have no `week`: they become this weekend's menu (and enter the previous menu) once.
    const migrated = new Set();
    function migrateOldProducts() {
      products.forEach(p => {
        if (p.week || migrated.has(p.id)) return;
        migrated.add(p.id);
        quiet(fb.updateDoc(productRef(p.id), { week: current() }));
        if (!history.has(historyId(p.name))) writeHistory(p);
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
    // connection is healthy, each provisional order is given its final number from its weekend's counter.
    let assigning = false, again = false;
    async function assignNumbers() {
      if (assigning) { again = true; return; }      // a snapshot arrived mid-run: look again when this run ends
      assigning = true;
      try {
        do {
          again = false;
          const todo = [...orders.values()].filter(o => o.provisional).sort((a, b) => a.created - b.created).map(o => ({ id: o.id, week: orderWeek(o) }));
          for (const { id, week } of todo) {
            await fb.runTransaction(db, async tx => {
              const o = await tx.get(orderRef(id));
              if (!o.exists() || !o.data().provisional) return;
              const c = await tx.get(counterRef(week));
              const n = Math.max(c.exists() ? c.data().next : 1, finalHighest(week) + 1);
              tx.set(counterRef(week), { next: n + 1 });
              tx.update(orderRef(id), { num: n, provisional: false });
            });
          }
        } while (again);
      } catch (e) { /* offline or busy: tried again on the next synced snapshot */ }
      assigning = false;
    }

    function nextColor(name) {
      const tmp = menu().map(p => ({ id: p.id, name: p.name, price: p.price, c: p.c }));
      const fresh = { id: '_new', name, price: 0 };
      tmp.push(fresh); assignColors(tmp);
      return fresh.c;
    }
    const findProduct = name => menu().find(p => lc(p.name) === lc(name));
    const newProduct = (name, price, c) => ({ id: uid(), name, price, c, week: selected });
    const writeProduct = p => quiet(fb.setDoc(productRef(p.id), { name: p.name, price: p.price, c: p.c, week: p.week }));

    return {
      kind: 'cloud',
      subscribe(cb) {
        listeners.add(cb);
        if (flags.orders && flags.products && flags.meta) cb(snapshot());
        return () => listeners.delete(cb);
      },
      setWeek(key) { selected = key; emit(); },
      destroy() { unsubs.forEach(u => u()); unsubs.length = 0; listeners.clear(); },
      restart() { unsubs.forEach(u => u()); unsubs.length = 0; flags.orders = flags.products = flags.meta = null; migrated.clear(); attach(); },

      async addOrder({ name, items, notes }) {
        const id = uid();
        const order = { status: 'new', created: clock(), week: selected, name: name || '', notes: notes || '', items: cleanItems(items), num: highest(selected) + 1, provisional: true };
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
        const ids = inWeek(selected).filter(o => o.status === 'delivered').map(o => o.id);
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = fb.writeBatch(db);
          ids.slice(i, i + BATCH_LIMIT).forEach(id => batch.delete(orderRef(id)));
          quiet(batch.commit());
        }
      },
      async upsertProduct({ name, price }) {
        const p = Number(price) || 0, ex = findProduct(name);
        if (ex) { quiet(fb.updateDoc(productRef(ex.id), { price: p })); writeHistory({ ...ex, price: p }); return { ...ex, price: p }; }
        const prod = newProduct(name, p, nextColor(name));
        writeProduct(prod); writeHistory(prod);
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
        const free = Number.isInteger(h.c) && !menu().some(p => p.c === h.c);
        const prod = newProduct(h.name, h.price || 0, free ? h.c : nextColor(h.name));
        writeProduct(prod);
        return prod;
      },
      async restoreAll() {
        const known = menu().map(p => ({ ...p }));
        let n = 0;
        for (const h of history.values()) {
          if (known.some(p => lc(p.name) === lc(h.name))) continue;
          const prod = newProduct(h.name, h.price || 0, Number.isInteger(h.c) && !known.some(p => p.c === h.c) ? h.c : undefined);
          known.push(prod); assignColors(known); n++;
          writeProduct(prod);
        }
        return n;
      },
      async forgetHistory(id) {
        const h = history.get(id);
        if (!h || findProduct(h.name)) return;
        quiet(fb.deleteDoc(fb.doc(db, 'meta', id)));
      },
      async copyPreviousMenu() {
        const prev = snapshot().prevMenu;
        if (!prev) return 0;
        const known = menu().map(p => ({ ...p }));
        let n = 0;
        for (const it of prev.items) {
          if (known.some(p => lc(p.name) === lc(it.name))) continue;
          const prod = newProduct(it.name, it.price || 0, Number.isInteger(it.c) && !known.some(p => p.c === it.c) ? it.c : undefined);
          known.push(prod); assignColors(known); n++;
          writeProduct(prod);
        }
        return n;
      },
      async seedProducts(list) {
        const known = menu().map(p => ({ ...p }));
        for (const s of list) {
          const ex = known.find(p => lc(p.name) === lc(s.name));
          if (ex) { if (!ex.price) { ex.price = s.price; quiet(fb.updateDoc(productRef(ex.id), { price: s.price })); } continue; }
          const prod = newProduct(s.name, s.price, undefined);
          known.push(prod); assignColors(known);
          writeProduct(prod);
        }
      },
      async importLegacy(legacy) {
        // products: merge by name (case-insensitive) into the selected weekend's menu, fill an empty price, add the rest
        const known = menu().map(p => ({ ...p }));
        let createdProducts = 0;
        for (const lp of legacy.products || []) {
          const ex = known.find(p => lc(p.name) === lc(lp.name));
          if (ex) { if (!ex.price && lp.price) { ex.price = lp.price; quiet(fb.updateDoc(productRef(ex.id), { price: lp.price })); } continue; }
          const prod = newProduct(lp.name, lp.price || 0, undefined);
          known.push(prod); assignColors(known); createdProducts++;
          writeProduct(prod);
        }
        // orders: go to the weekend of their date; stable ids make a repeat import (or the same data from another device) a no-op
        const importId = o => 'legacy-' + String(o.id).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + o.created;
        const weekOf = o => weekKeyOf(o.created);
        const fresh = (legacy.orders || []).filter(o => !orders.has(importId(o)))
          .sort((a, b) => a.created - b.created || a.num - b.num);
        const keepNumbers = orders.size === 0;     // first device in: keep its numbers; otherwise number from each weekend's counter
        for (let i = 0; i < fresh.length; i += 400) {
          await fb.runTransaction(db, async tx => {
            const chunk = fresh.slice(i, i + 400);
            const weeks = [...new Set(chunk.map(weekOf))];
            const counter = {}, next = {}, top = {};
            for (const w of weeks) {
              const snap = await tx.get(counterRef(w));
              counter[w] = snap.exists() ? snap.data().next : 1;
              next[w] = keepNumbers ? counter[w] : Math.max(counter[w], highest(w) + 1);
              top[w] = 0;
            }
            chunk.forEach(o => {
              const w = weekOf(o), num = keepNumbers ? o.num : next[w]++;
              top[w] = Math.max(top[w], num);
              tx.set(orderRef(importId(o)), { num, week: w, status: o.status, created: o.created, name: o.name, notes: o.notes, items: cleanItems(o.items), importedFrom: String(o.id) });
            });
            weeks.forEach(w => tx.set(counterRef(w), { next: keepNumbers ? Math.max(counter[w], top[w] + 1) : next[w] }));
          });
        }
        return { orders: fresh.length, products: createdProducts };
      }
    };
  }

  return { KEY, PALETTE_SIZE, historyId, weekKeyOf, addWeeks, weekLabel, orderTotal, uid, clone, cleanItems, assignColors, normalizeLegacy, createLocalStore, createCloudStore };
});
