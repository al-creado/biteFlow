/* Sign-in screen, account dialog and sync indicator.
   Pure helpers are exported for node tests; the UI part only runs in the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Auth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WRONG = 'Wrong email or password.';
  const MESSAGES = {
    'auth/invalid-credential': WRONG, 'auth/wrong-password': WRONG, 'auth/user-not-found': WRONG, 'auth/invalid-email': WRONG,
    'auth/network-request-failed': 'No internet connection. Check your network and try again.',
    'permission-denied': 'This account is not allowed to use Amylicious.',
    'auth/admin-restricted-operation': 'This account is not allowed to use Amylicious.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.'
  };
  const errorMessage = code => MESSAGES[code] || 'Could not sign in. Please try again.';
  // Google blocks sign-in inside the desktop app (file:// pages), so only offer it on http(s).
  const googleAvailable = loc => !!loc && (loc.protocol === 'http:' || loc.protocol === 'https:');

  const PILL = {
    local: ['local', 'Local only'], synced: ['ok', 'Synced'], syncing: ['busy', 'Syncing'], offline: ['warn', 'Offline'], error: ['warn', 'Sync problem']
  };
  let ctx = null;          // { FB, auth, user } once signed in to the cloud
  let mode = 'local';
  let status = 'syncing';
  let pendingMessage = '';
  const RETRY_MS = [10000, 30000, 60000];
  const FIRST_DATA_TIMEOUT_MS = 15000;

  const $ = s => document.querySelector(s);

  function paintPill() {
    const [cls, text] = mode === 'local' ? PILL.local : (PILL[status] || PILL.synced);
    const pill = $('#syncPill'); if (!pill) return;
    pill.dataset.state = cls;
    $('.pill-t', pill).textContent = text;
    const a = $('#aStatus'); if (a) a.textContent = mode === 'local'
      ? 'Orders are saved on this device only. Sign-in and sync are not set up yet.'
            : text === 'Synced' ? 'Everything is saved and up to date.' : text === 'Syncing' ? 'Sending your latest changes…'
      : text === 'Sync problem' ? 'Syncing stopped. Close and reopen the app to try again. Your changes on this device are kept.'
      : 'No connection. Your changes are kept and will sync when you are back online.';
    const e = $('#aEmail'); if (e) e.textContent = ctx && ctx.user ? ctx.user.email : '';
    const so = $('#signOutBtn'); if (so) so.hidden = mode === 'local';
  }
  function setSyncStatus(next, kind) { status = next; if (kind) mode = kind === 'cloud' ? 'cloud' : 'local'; paintPill(); }

  function showLogin(state) {
    const el = $('#login'); if (!el) return;
    el.hidden = false; el.dataset.state = state || 'form';
    const err = $('#loginErr'); err.textContent = pendingMessage; pendingMessage = '';
    if (state !== 'loading') { const f = $('#loginEmail'); if (f && !f.value) f.focus(); }
  }
  // ---- offer to upload the orders/products saved on this device (local-only mode) ----
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function readLegacy() {
    try {
      const raw = window.localStorage.getItem(Store.KEY); if (!raw) return null;
      const l = Store.normalizeLegacy(JSON.parse(raw));
      return l.orders.length || l.products.length ? l : null;
    } catch (e) { return null; }
  }
  function offerImport(store, user) {
    const key = 'biteflow.import.' + (user.uid || user.email);
    try { if (window.localStorage.getItem(key)) return; } catch (e) { return; }
    const legacy = readLegacy(); if (!legacy) return;
    const dlg = $('#idlg'), err = $('#iErr'), up = $('#iUpload');
    const mark = v => { try { window.localStorage.setItem(key, v); } catch (e) {} };
    $('#iText').textContent = plural(legacy.orders.length, 'order') + ' and ' + plural(legacy.products.length, 'product') +
      ' are saved on this device. Upload them to your shop account so every device shows them? Nothing is deleted from this device.';
    err.textContent = ''; up.disabled = false;
    up.onclick = () => {
      up.disabled = true; err.textContent = '';
      store.importLegacy(legacy).then(() => { mark('done'); dlg.close(); })
        .catch(() => { err.textContent = 'Could not upload. Check your connection and try again.'; up.disabled = false; });
    };
    $('#iLater').onclick = () => dlg.close();
    $('#iNever').onclick = () => { mark('never'); dlg.close(); };
    if (!dlg.open) dlg.showModal();
  }
  function offerWhenSynced(store, user) {
    let offered = false;
    const un = store.subscribe(snap => {
      if (offered || snap.status !== 'synced') return;
      offered = true; Promise.resolve().then(() => un());
      offerImport(store, user);
    });
  }

  function hideLogin() { const el = $('#login'); if (el) el.hidden = true; }

  function start({ localFactory, onStore }) {
    const cfg = window.FIREBASE_CONFIG, FB = window.FB;
    const dlg = $('#adlg');
    $('#syncPill').onclick = () => { paintPill(); dlg.showModal(); };
    $('#aClose').onclick = () => dlg.close();

    if (!cfg || !cfg.apiKey || !FB) { mode = 'local'; paintPill(); onStore(localFactory(), null); return; }

    mode = 'cloud'; showLogin('loading');
    const app = FB.initializeApp(cfg);
    const auth = FB.getAuth(app);
    let db;
    try { db = FB.initializeFirestore(app, { localCache: FB.persistentLocalCache({ tabManager: FB.persistentMultipleTabManager() }) }); }
    catch (e) { db = FB.getFirestore(app); }     // browsers without IndexedDB: memory cache only

    const googleBtn = $('#googleBtn');
    googleBtn.hidden = !googleAvailable(window.location);
    $('.or').hidden = googleBtn.hidden;
    const submit = $('#loginSubmit');
    const fail = e => { $('#loginErr').textContent = errorMessage(e && e.code); };
    const busy = b => { submit.disabled = b; googleBtn.disabled = b; };
    $('#loginForm').onsubmit = e => {
      e.preventDefault(); $('#loginErr').textContent = ''; $('#loginInfo').textContent = ''; busy(true);
      FB.signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPass').value)
        .catch(fail).finally(() => busy(false));
    };
    googleBtn.onclick = () => {
      $('#loginErr').textContent = ''; busy(true);
      FB.signInWithPopup(auth, new FB.GoogleAuthProvider())
        .catch(e => { if (!e || e.code !== 'auth/popup-closed-by-user') fail(e); }).finally(() => busy(false));
    };
    $('#forgotBtn').onclick = () => {
      const email = $('#loginEmail').value.trim(), info = $('#loginInfo'), err = $('#loginErr');
      const sent = 'If that email has an account, a reset link is on its way. Check your inbox.';
      info.textContent = ''; err.textContent = '';
      if (!email) { err.textContent = 'Type your email above first.'; return; }
      FB.sendPasswordResetEmail(auth, email)
        .then(() => { info.textContent = sent; })
        .catch(e => { if (e && e.code === 'auth/network-request-failed') fail(e); else info.textContent = sent; });
    };
    $('#signOutBtn').onclick = () => { dlg.close(); FB.signOut(auth); };

    let store = null;
    FB.onAuthStateChanged(auth, user => {
      if (store) { store.destroy(); store = null; }
      ctx = { FB, auth, user };
      if (!user) { onStore(null, null); showLogin('form'); return; }
      let retries = 0;
      const mine = Store.createCloudStore({
        fb: FB, db,
        onError: err => {
          if (store !== mine) return;
          if (err && err.code === 'permission-denied') { pendingMessage = errorMessage('permission-denied'); FB.signOut(auth); return; }
          // quota or network trouble ended the live connection: say so and try again a few times
          setSyncStatus('error');
          if (retries < RETRY_MS.length) setTimeout(() => { if (store === mine) mine.restart(); }, RETRY_MS[retries++]);
        }
      });
      store = mine;
      status = 'syncing'; paintPill();
      showLogin('loading');                          // keep "Loading your orders…" until the first data arrives
      onStore(store, user);
      let shown = false;
      const reveal = () => { if (shown) return; shown = true; hideLogin(); offerWhenSynced(store, user); };
      let first = null;
      first = store.subscribe(() => { if (first) first(); reveal(); });
      if (shown) first();
      setTimeout(reveal, FIRST_DATA_TIMEOUT_MS);      // never leave the screen stuck
    });
  }

  return { errorMessage, googleAvailable, start, setSyncStatus };
});
