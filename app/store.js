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

  return { KEY, PALETTE_SIZE, uid, clone, cleanItems, assignColors, normalizeLegacy, createLocalStore };
});
