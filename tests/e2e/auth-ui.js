// Sign-in flow in a real browser with a stubbed Firebase SDK backed by the in-memory Firestore.
// Run: NODE_PATH=$(npm root -g) node tests/e2e/auth-ui.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');

const fake = fs.readFileSync(path.resolve(__dirname, '../helpers/fake-fb.js'), 'utf8');
const STUB = `(function(){ const module={exports:{}}; ${fake}
  const server = module.exports.createFakeServer(); const client = server.createClient();
  window.__server = server; window.__client = client; let cb = null, user = null;
  window.FB = Object.assign({}, client.fb, {
    initializeApp: () => ({}), getAuth: () => ({}),
    onAuthStateChanged: (a, f) => { cb = f; setTimeout(() => f(user), 0); return () => {}; },
    signInWithEmailAndPassword: async (a, e, p) => { if (p !== 'good') { const x = new Error('bad'); x.code = 'auth/invalid-credential'; throw x; } user = { email: e }; cb(user); },
    GoogleAuthProvider: function () {}, signInWithPopup: async () => { user = { email: 'g@example.com' }; cb(user); },
    signOut: async () => { user = null; cb(null); },
    initializeFirestore: () => client.db, getFirestore: () => client.db,
    persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({})
  });
})();`;

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const open = async (overrides, ctxOpts) => {
    const srv = await serve(overrides);
    const ctx = await b.newContext({ viewport: { width: 1100, height: 800 }, ...ctxOpts });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(srv.url);
    return { p, srv };
  };

  // 1. no config: local-only mode, no login screen
  let t = await open({ 'firebase-config.js': 'window.FIREBASE_CONFIG = null;' });
  assert.equal(await t.p.locator('#login').isVisible(), false);
  assert.equal(await t.p.textContent('#syncPill .pill-t'), 'Local only');
  t.srv.close();

  // 2. configured: login screen, wrong password, then success
  t = await open({ 'firebase-config.js': "window.FIREBASE_CONFIG = {apiKey:'k', projectId:'p'};", 'vendor/firebase.js': STUB });
  const p = t.p;
  await p.waitForSelector('#loginForm', { state: 'visible' });
  assert.equal(await p.locator('#googleBtn').isVisible(), true);   // http page: Google offered
  await p.fill('#loginEmail', 'shop@example.com'); await p.fill('#loginPass', 'nope'); await p.click('#loginSubmit');
  await p.waitForFunction(() => document.querySelector('#loginErr').textContent.length > 0);
  assert.equal(await p.textContent('#loginErr'), 'Wrong email or password.');
  await p.fill('#loginPass', 'good'); await p.click('#loginSubmit');
  await p.waitForSelector('#login', { state: 'hidden' });
  await p.waitForFunction(() => document.querySelector('#syncPill .pill-t').textContent === 'Synced');

  // 3. an order made while signed in lands in the (fake) cloud and survives sign-out / sign-in
  await p.evaluate(() => window.__client.fb.setDoc(window.__client.fb.doc(null, 'products', 'p1'), { name: 'Croquette', price: 100, c: 0 }));
  await p.click('#newBtn'); await p.click('#lines .line .dd-btn'); await p.click('.dd-list:not([hidden]) li:nth-child(1)');
  await p.click('#dlg button[type=submit]');
  await p.waitForSelector('.col[data-status=new] .card');
  assert.equal(await p.evaluate(() => window.__server.count('orders')), 1);
  await p.click('#syncPill'); assert.match(await p.textContent('#aEmail'), /shop@example.com/);
  await p.click('#signOutBtn');
  await p.waitForSelector('#loginForm', { state: 'visible' });
  assert.equal(await p.locator('.card').count(), 0);                // board cleared when signed out
  await p.fill('#loginEmail', 'shop@example.com'); await p.fill('#loginPass', 'good'); await p.click('#loginSubmit');
  await p.waitForSelector('.col[data-status=new] .card');

  // 4. a rejected (not allowlisted) account is signed out with a clear message
  await p.evaluate(() => window.__client.failSnapshots({ code: 'permission-denied' }));
  await p.waitForSelector('#loginForm', { state: 'visible' });
  assert.equal(await p.textContent('#loginErr'), 'This account is not allowed to use Amylicious.');

  // 5. offline sign-in message
  await p.evaluate(() => { window.FB.signInWithEmailAndPassword = async () => { const x = new Error('n'); x.code = 'auth/network-request-failed'; throw x; }; });
  await p.fill('#loginPass', 'good'); await p.click('#loginSubmit');
  await p.waitForFunction(() => /No internet/.test(document.querySelector('#loginErr').textContent));
  t.srv.close();

  assert.deepEqual(errs, []);
  await b.close();
  console.log('auth-ui OK');
})().catch(e => { console.error(e); process.exit(1); });
