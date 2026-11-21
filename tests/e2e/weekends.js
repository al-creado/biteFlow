// Weekend bar, per-weekend menus and numbering in a real browser (local-only mode).
// Run: NODE_PATH=$(npm root -g) node tests/e2e/weekends.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serve } = require('../helpers/serve.js');

(async () => {
  const srv = await serve({ 'firebase-config.js': 'window.FIREBASE_CONFIG = null;' });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(srv.url);

  const text = s => p.textContent(s);
  const cards = () => p.locator('.col .card').count();
  const makeOrder = async name => {
    await p.click('#newBtn'); await p.fill('#fName', name);
    await p.click('#lines .line .dd-btn'); await p.click('.dd-list:not([hidden]) li:nth-child(1)');
    await p.click('#dlg button[type=submit]');
  };

  // 1. starts on this weekend, nothing earlier to go back to
  assert.equal(await text('#wkSmall'), 'This weekend');
  const thisDate = await text('#wkDate');
  assert.match(thisDate, /^Sun \d{1,2} [A-Z][a-z]{2}$/);
  assert.match(await text('#wkChip'), /^(Orders open until Sat|Delivery day)$/);
  assert.equal(await p.locator('#wkPrev').isDisabled(), true);
  assert.equal(await p.locator('#wkNext').isDisabled(), false);
  assert.equal(await p.locator('#menuChips .mchip').count(), 4);       // the seeded menu belongs to this weekend

  // 2. an order for this weekend updates the weekend totals
  await makeOrder('anna');
  assert.equal(await text('#wkOrders'), '1');
  assert.equal(await p.locator('.card .num').first().textContent(), '#1');
  assert.match(await text('#wkTotal'), /₹100/);

  // 3. next weekend: empty board, empty menu, copy last weekend's menu
  await p.click('#wkNext');
  assert.equal(await text('#wkSmall'), 'Next weekend');
  assert.notEqual(await text('#wkDate'), thisDate);
  assert.equal(await cards(), 0);
  assert.match(await text('#menuChips'), /No menu yet/);
  assert.equal(await p.locator('#wkNext').isDisabled(), true);          // only one weekend ahead
  await p.click('#prodBtn');
  assert.match(await text('#pTitle'), /^Menu for Sun/);
  assert.match(await text('#copyMenu'), /Copy last weekend's menu\s*\(4 items\)/);
  await p.click('#copyMenu');
  assert.equal(await p.locator('#plist li:not(.empty)').count(), 4);
  assert.equal(await p.locator('#copyMenu').isVisible(), false);
  await p.click('#pClose');
  assert.equal(await p.locator('#menuChips .mchip').count(), 4);

  // 4. numbers restart at #1 on the new weekend, and the order dialog says which weekend it is for
  await p.click('#newBtn');
  assert.equal(await text('#dlgWeek'), 'For ' + await text('#wkDate'));
  await p.click('#cancelBtn');
  await makeOrder('bella');
  assert.equal(await p.locator('.card .num').first().textContent(), '#1');
  assert.equal(await text('#wkOrders'), '1');

  // 5. the weekend list: switch back to this weekend, and its own order is still there
  await p.click('#wkTitle');
  assert.equal(await p.locator('#wkPop').isVisible(), true);
  assert.ok((await p.locator('#wkPop [data-week]').count()) >= 2);
  await p.click('#wkPop [aria-selected=false]');
  assert.equal(await text('#wkSmall'), 'This weekend');
  assert.equal(await p.locator('#wkPop').isVisible(), false);
  assert.match(await p.locator('.card').first().innerText(), /Anna/);
  await p.click('#wkNext'); await p.click('#wkPrev');                    // arrows go back and forth
  assert.equal(await text('#wkSmall'), 'This weekend');

  // 6. export covers the weekend being viewed
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
  assert.match(d.suggestedFilename(), /^amylicious-orders-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = fs.readFileSync(await d.path(), 'utf8');
  assert.match(csv, /"Weekend"/); assert.equal((csv.match(/\r\n/g) || []).length, 1);   // header + Anna only

  // 7. survives a reload
  await p.reload();
  assert.equal(await text('#wkSmall'), 'This weekend');
  assert.equal(await text('#wkOrders'), '1');

  // 8. phone: the bar fits without sideways scrolling
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 800 });
  await m.goto(srv.url);
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal scroll');

  // 9. products that only exist inside old orders are on the previous menu and can be added back
  const ctx2 = await b.newContext({ viewport: { width: 1100, height: 800 } });
  const r = await ctx2.newPage(); r.on('pageerror', e => errs.push(e.message));
  const longAgo = Date.now() - 40 * 24 * 3600 * 1000;
  await r.addInitScript(old => { if (!localStorage.getItem('biteflow.v1')) localStorage.setItem('biteflow.v1', old); }, JSON.stringify({
    products: [{ id: 'p1', name: 'Croquette', price: 100, c: 0 }],
    orders: [{ id: 'x1', num: 1, status: 'delivered', created: longAgo, name: 'Old', notes: '', items: [{ name: 'Mutton Samosa (3 nos)', qty: 2, price: 90, c: 4 }, { name: 'Croquette', qty: 1, price: 100, c: 0 }] }]
  }));
  await r.goto(srv.url);
  await r.click('#prodBtn');
  assert.equal(await r.locator('#plist li:not(.empty)').count(), 1);               // the menu itself is untouched
  assert.equal(await r.locator('#histWrap').isVisible(), true);
  assert.match(await r.locator('#hlist').innerText(), /Mutton Samosa \(3 nos\)/);
  assert.match(await r.locator('#hlist').innerText(), /₹90/);
  await r.click('#hlist li:has-text("Mutton Samosa") button[data-add]');
  assert.equal(await r.locator('#plist li:not(.empty)').count(), 2);
  assert.equal(await r.inputValue('#plist li:has-text("Mutton Samosa") input'), '90');

  assert.deepEqual(errs, []);
  await b.close(); srv.close();
  console.log('weekends OK');
})().catch(e => { console.error(e); process.exit(1); });
