// In-memory stand-in for the subset of Firebase Firestore the app uses.
// One server, many clients (devices). A client that goes offline sees a frozen copy of the
// server, queues its writes, and flushes them when it comes back (like the real SDK cache).
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function createFakeServer() {
  const data = new Map();
  const clients = new Set();
  const log = [];
  const server = {
    data, log, lock: Promise.resolve(),
    get: p => clone(data.get(p)),
    apply(op) {
      log.push(clone(op));
      if (op.type === 'set') data.set(op.path, clone(op.data));
      else if (op.type === 'update') {
        if (!data.has(op.path)) throw new Error('not-found: ' + op.path);
        data.set(op.path, { ...data.get(op.path), ...clone(op.data) });
      } else if (op.type === 'delete') data.delete(op.path);
    },
    notify() { clients.forEach(c => c._emit()); },
    count(col) { return [...data.keys()].filter(k => k.startsWith(col + '/')).length; },
    createClient({ online = true } = {}) {
      let isOnline = online, hold = false, frozen = null;
      const pending = [];
      const subs = new Set();
      const base = () => (isOnline ? data : frozen || data);
      const view = () => {
        const m = new Map([...base()].map(([k, v]) => [k, clone(v)]));
        pending.forEach(g => g.ops.forEach(op => {
          if (op.type === 'set') m.set(op.path, clone(op.data));
          else if (op.type === 'update') { if (m.has(op.path)) m.set(op.path, { ...m.get(op.path), ...clone(op.data) }); }
          else if (op.type === 'delete') m.delete(op.path);
        }));
        return m;
      };
      const write = ops => new Promise((resolve, reject) => {
        if (isOnline && !hold) {
          try { ops.forEach(op => server.apply(op)); } catch (e) { return reject(e); }
          server.notify(); resolve();
        } else { pending.push({ ops, resolve, reject }); client._emit(); }
      });
      const flush = () => {
        const groups = pending.splice(0);
        groups.forEach(g => { try { g.ops.forEach(op => server.apply(op)); g.resolve(); } catch (e) { g.reject(e); } });
      };
      const client = {
        db: { client: true },
        setOnline(b) {
          if (b === isOnline) return;
          if (!b) frozen = new Map([...data].map(([k, v]) => [k, clone(v)]));
          isOnline = b;
          if (b) { frozen = null; if (!hold) flush(); }
          server.notify();
        },
        failSnapshots(err) { subs.forEach(s => s.error && s.error(err)); },
        holdAcks(b) { hold = b; if (!b && isOnline) { flush(); server.notify(); } },
        _emit() {
          const v = view();
          subs.forEach(s => {
            if (s.ref.type === 'col') {
              const prefix = s.ref.path + '/';
              const docs = [...v].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map(([k, val]) => ({ id: k.slice(prefix.length), data: () => clone(val) }));
              s.next({ docs, metadata: { fromCache: !isOnline, hasPendingWrites: pending.length > 0 } });
            }
          });
        },
        fb: {
          collection: (db, path) => ({ type: 'col', path }),
          doc: (db, path, id) => ({ type: 'doc', path: id ? path + '/' + id : path }),
          onSnapshot(ref, next, error) {
            const s = { ref, next, error }; subs.add(s);
            queueMicrotask(() => subs.has(s) && client._emit());
            return () => subs.delete(s);
          },
          setDoc: (ref, d) => write([{ type: 'set', path: ref.path, data: d }]),
          updateDoc: (ref, f) => write([{ type: 'update', path: ref.path, data: f }]),
          deleteDoc: ref => write([{ type: 'delete', path: ref.path }]),
          writeBatch() {
            const ops = [];
            return {
              set(ref, d) { ops.push({ type: 'set', path: ref.path, data: d }); },
              update(ref, f) { ops.push({ type: 'update', path: ref.path, data: f }); },
              delete(ref) { ops.push({ type: 'delete', path: ref.path }); },
              commit() { return ops.length > 500 ? Promise.reject(new Error('batch exceeds 500 operations')) : write(ops); }
            };
          },
          runTransaction(db, fn) {
            if (!isOnline) return Promise.reject(new Error('client is offline'));
            const run = server.lock.then(async () => {
              const writes = [];
              const tx = {
                get: async ref => { const d = server.get(ref.path); return { exists: () => d !== undefined, data: () => d }; },
                set: (ref, d) => { writes.push({ type: 'set', path: ref.path, data: d }); },
                update: (ref, f) => { writes.push({ type: 'update', path: ref.path, data: f }); }
              };
              const r = await fn(tx);
              writes.forEach(op => server.apply(op));
              server.notify();
              return r;
            });
            server.lock = run.catch(() => {});
            return run;
          }
        }
      };
      clients.add(client);
      return client;
    }
  };
  return server;
}

module.exports = { createFakeServer };
