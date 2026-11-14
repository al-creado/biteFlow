// Run with the Firestore emulator listening (default 127.0.0.1:8080):
//   cd tests/rules && npm install && node --test rules.test.js
const test = require('node:test');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');

const HOST = '127.0.0.1', PORT = Number(process.env.FIRESTORE_EMULATOR_PORT || 8080);
const OWNER = 'owner@example.com';
let env;

const waitForEmulator = async () => {
  for (let i = 0; i < 60; i++) {
    const ok = await new Promise(r => { const s = net.connect(PORT, HOST); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
    if (ok) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Firestore emulator not reachable on ' + HOST + ':' + PORT);
};

test.before(async () => {
  await waitForEmulator();
  const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8').replace('OWNER_EMAIL', OWNER);
  env = await initializeTestEnvironment({ projectId: 'amylicious-rules', firestore: { rules, host: HOST, port: PORT } });
});
test.after(async () => { if (env) await env.cleanup(); });

const owner = () => env.authenticatedContext('u1', { email: OWNER }).firestore();
const other = () => env.authenticatedContext('u2', { email: 'other@example.com' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

for (const col of ['orders', 'products', 'meta']) {
  test(`signed-out visitors cannot read or write ${col}`, async () => {
    await assertFails(getDoc(doc(anon(), col, 'x')));
    await assertFails(setDoc(doc(anon(), col, 'x'), { a: 1 }));
    await assertFails(getDocs(collection(anon(), col)));
  });
  test(`a signed-in account that is not on the list cannot read or write ${col}`, async () => {
    await assertFails(getDoc(doc(other(), col, 'x')));
    await assertFails(setDoc(doc(other(), col, 'x'), { a: 1 }));
    await assertFails(getDocs(collection(other(), col)));
  });
  test(`the listed owner can read and write ${col}`, async () => {
    await assertSucceeds(setDoc(doc(owner(), col, 'x'), { a: 1 }));
    await assertSucceeds(getDoc(doc(owner(), col, 'x')));
    await assertSucceeds(getDocs(collection(owner(), col)));
  });
}

test('even the owner cannot use any other collection', async () => {
  await assertFails(setDoc(doc(owner(), 'secrets', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(owner(), 'secrets', 'x')));
});
