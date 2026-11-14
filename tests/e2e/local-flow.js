// Browser regression test for local-only mode. Run: NODE_PATH=$(npm root -g) node tests/e2e/local-flow.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + path.resolve(__dirname, '../../app/index.html'));

  const count = s => p.locator(`.col[data-status=${s}] .card`).count();
  // seeded menu on a fresh device
  await p.click('#prodBtn');
  assert.equal(await p.locator('#plist li').count(), 4);
  await p.fill('#pName', 'Brownie'); await p.fill('#pPrice', '60'); await p.press('#pPrice', 'Enter');
  await p.fill('#plist li:nth-child(1) input', '110'); await p.press('#plist li:nth-child(1) input', 'Tab');
  await p.click('#pClose');

  // create an order: 3 x first product (110) + 1 x Brownie (60) = 390
  await p.click('#newBtn'); await p.fill('#fName', 'priya'); await p.press('#fName', 'Tab');
  await p.click('#lines .line .dd-btn'); await p.click('.dd-list:not([hidden]) li:nth-child(1)');
  await p.click('.step[data-d="1"]'); await p.click('.step[data-d="1"]');
  await p.click('#addLine'); await p.click('#lines .line:nth-child(2) .dd-btn');
  await p.click('.dd-list:not([hidden]) li:has-text("Brownie")');
  assert.equal((await p.textContent('#dtotal')).replace(/\s/g, ''), '₹390');
  await p.click('button[type=submit]');
  assert.equal(await count('new'), 1);
  const txt = await p.locator('.col[data-status=new] .card').innerText();
  assert.match(txt, /Priya/); assert.match(txt, /₹390/);

  // move forward New -> Ready -> Delivered
  await p.click('.col[data-status=new] [data-act=next]');
  assert.equal(await count('ready'), 1);
  await p.click('.col[data-status=ready] [data-act=next]');
  assert.equal(await count('delivered'), 1);

  // edit quantity on the delivered order: 3 -> 4 gives 500
  await p.click('.col[data-status=delivered] [data-act=edit]');
  await p.click('#lines .line:nth-child(1) .step[data-d="1"]');
  assert.equal((await p.textContent('#dtotal')).replace(/\s/g, ''), '₹500');
  await p.click('button[type=submit]');
  assert.match(await p.locator('.col[data-status=delivered] .card').innerText(), /₹500/);

  // persistence
  await p.reload();
  assert.equal(await count('delivered'), 1);

  // export
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
  const csv = fs.readFileSync(await d.path(), 'utf8');
  assert.match(csv, /"Total"/); assert.match(csv, /,500,/);

  assert.deepEqual(errs, []);
  await b.close();
  console.log('local-flow OK');
})().catch(e => { console.error(e); process.exit(1); });
