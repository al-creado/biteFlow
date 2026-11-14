# Firebase Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make orders, products, prices and order numbers identical on the website, the Windows app and the Mac app, loaded automatically after a one-time sign-in.

**Architecture:** All reads and writes go through one data-layer interface (`app/store.js`) with two backends: a local one (today's behaviour, used when Firebase is not configured) and a Firestore one. The UI renders from snapshots the store emits. A thin auth layer (`app/auth.js`) shows the login screen and chooses the backend. The Firebase SDK is vendored as one prebuilt file.

**Tech Stack:** Plain HTML/JS (no framework, no build step for the app), Firebase JS SDK v10 (auth + firestore, modular, bundled to an IIFE with esbuild), Electron 33, `node:test` + Playwright for tests.

**Spec:** `docs/superpowers/specs/2026-11-14-firebase-sync-design.md`

## Global Constraints

- Firebase project: `bite-flow`; Firestore region `asia-south1`; Spark (free) plan only.
- Config lives in `app/firebase-config.js` as `window.FIREBASE_CONFIG = {apiKey:"AIzaSyAl_5Nwk2eA_2JwnqjXYqYs086lhK7Hg40", authDomain:"bite-flow.firebaseapp.com", projectId:"bite-flow", storageBucket:"bite-flow.firebasestorage.app", messagingSenderId:"223875381902", appId:"1:223875381902:web:40ca94a856fce03a3527df"}`. No analytics, no `measurementId`.
- Data: collections `orders/{id}`, `products/{id}`, doc `meta/counter {next}`. Order `{num,status,created,name,notes,items:[{name,qty,price}]}`; product `{name,price,c}`.
- SDK is vendored (`app/vendor/firebase.js`), never loaded from a CDN. Works offline in browser and Electron.
- App with empty `FIREBASE_CONFIG` must behave exactly as today (local only).
- Branding rules unchanged: Amylicious theme, Montserrat, SVG icons from the `ICONS` map in `app/app.js`, no emojis, money shown with the rupee sign.
- Asset cache-busting: bump the `?v=` query on `style.css`/`app.js`/new scripts in `app/index.html` every task that changes them.
- Commit on branch `testing`; never push to `main` without the owner asking. Commit message ends with the two attribution lines from the session reminder.
- Tests: `node --test tests/` (pure logic and fake Firestore); browser tests in `tests/e2e/*.js` run with `NODE_PATH=$(npm root -g) node tests/e2e/<file>`.

## Review Focus

1. Two devices add an order at the same moment: numbers must differ (Task 2).
2. Adding an order while offline must not hang or fail; it appears at once and gets a unique number after reconnect (Task 2).
3. Uploading this device's old orders twice, or from two devices, must not duplicate orders (Task 4).
4. Wrong password, an account not on the allowlist, and being offline at sign-in each show a clear message, never a blank screen (Task 3).
5. "Clear delivered" with more than 500 delivered orders must delete all of them (Firestore batches cap at 500) (Task 2).

## File Structure

- Create `app/store.js`: UMD module (`module.exports` in node, `window.Store` in browser). Owns data shapes, legacy normalisation, colour assignment, `createLocalStore`, `createCloudStore`.
- Create `app/auth.js`: login overlay, account dialog, sync pill, `Auth.start()`.
- Create `app/firebase-config.js`: the config global.
- Create `vendor-src/entry.js` + npm script `build:vendor` → `app/vendor/firebase.js` (sets `window.FB`).
- Modify `app/app.js`: render from snapshots, call store methods, string ids.
- Modify `app/index.html`, `app/style.css`: login overlay, account dialog, sync pill, script tags.
- Create `firestore.rules`, `docs/firebase-setup.md`.
- Create `tests/store.test.js`, `tests/helpers/fake-fb.js`, `tests/e2e/*.js`.

---

### Task 1: Store interface, local backend, and UI refactor onto it

**Files:**
- Create: `app/store.js`, `tests/store.test.js`, `tests/e2e/local-flow.js`
- Modify: `app/app.js` (whole file touches: state, save, handlers), `app/index.html` (script tag, `?v=`)

**Interfaces:**
- Produces (used by every later task):
  - `Order = {id:string, num:number, status:'new'|'ready'|'delivered', created:number, name:string, notes:string, items:{name:string,qty:number,price:number}[]}`
  - `Product = {id:string, name:string, price:number, c:number}`
  - `Snapshot = {orders:Order[], products:Product[], status:'synced'|'syncing'|'offline'}`
  - `store = {kind:'local'|'cloud', subscribe(cb:(s:Snapshot)=>void):()=>void, addOrder(o:{name,items,notes}):Promise<Order>, updateOrder(id,fields:Partial<{name,items,notes}>):Promise<void>, setStatus(id,status):Promise<void>, deleteOrder(id):Promise<void>, clearDelivered():Promise<void>, upsertProduct(p:{name,price}):Promise<Product>, setProductPrice(id,price):Promise<void>, removeProduct(id):Promise<void>, seedProducts(seed:{name,price}[]):Promise<void>, importLegacy(legacy:LegacyState):Promise<{orders:number,products:number}>}`
  - Pure exports: `normalizeLegacy(raw:any):{next:number,orders:Order[],products:Product[]}` (today's migration: string items → `{name,qty,price}`, `completed`→`delivered`, string products → `{name,price}`; ids become strings), `assignColors(products:Product[]):void` (stable palette index `c`, lowest unused first), `createLocalStore({storage:Storage-like, seed:{name,price}[]}):store`.

- [ ] **Step 1: Write failing tests in `tests/store.test.js`**: `normalizeLegacy converts string items and completed status`, `assignColors gives distinct c to first 8 products and keeps existing c`, `local store addOrder numbers sequentially from 1`, `local store setStatus moves new->ready only changes status`, `local store upsertProduct matches name case-insensitively and updates price`, `local store persists to storage and reloads`, `local store subscribe emits immediately and after each write`. Use an in-memory `storage` object with `getItem/setItem`.
- [ ] **Step 2: Run** `node --test tests/store.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `app/store.js`** with the signatures above; local backend keeps the existing `localStorage` key `biteflow.v1` and shape `{next,orders,products}`; `status` is always `'synced'`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Write `tests/e2e/local-flow.js`** (Playwright): create order via dialog, move New→Ready→Delivered, edit quantity, add product with price, export CSV contains `Total`, reload keeps data, `?v=` assets load. Assertions copied from the existing manual checks (`#dtotal` text `₹435` for 3×120+1×75 etc.).
- [ ] **Step 6: Refactor `app/app.js`**: remove `load()/save()/state` mutation; keep a module-level `data = {orders, products}` set by `store.subscribe` which then calls `render()`; every handler calls the matching store method; dataset ids stay strings (drop `Number(...)`); `productPrice/colorOf/orderTotal` read `data`. Export, CSV and card markup unchanged. Choose the store at boot: `Store.createLocalStore({storage: localStorage, seed: SEED})` for now.
- [ ] **Step 7: Run** `node --test tests/` and `NODE_PATH=$(npm root -g) node tests/e2e/local-flow.js` → PASS, no console errors.
- [ ] **Step 8: Commit** `git add app tests && git commit -m "Route all data through a store interface (local backend)"`.

### Task 2: Firestore backend with a fake Firestore

**Files:**
- Modify: `app/store.js` (add `createCloudStore`, helpers)
- Create: `tests/helpers/fake-fb.js`
- Test: `tests/store.test.js` (append)

**Interfaces:**
- Consumes: Task 1 `store` interface, `assignColors`.
- Produces: `createCloudStore({fb:FbApi, db:any}):store` where `FbApi = {collection(db,path), doc(db,path,id?), onSnapshot(ref,next,error?), setDoc(ref,data), updateDoc(ref,fields), deleteDoc(ref), writeBatch(db):{set,update,delete,commit}, runTransaction(db,fn)}` (the real Firebase function names/signatures); `fake-fb.js` exports `createFakeFirestore({online:boolean}) → {fb, db, setOnline(b), docs}` simulating snapshots, batches capped at 500 ops (throws beyond), transactions failing while offline, and writes queued while offline.

- [ ] **Step 1: Write failing tests**: `cloud addOrder from two stores gets distinct nums` (two stores sharing one fake db, concurrent `addOrder`), `cloud setStatus writes only the status field`, `cloud updateOrder fields do not overwrite other fields edited by another store`, `cloud addOrder while offline resolves immediately with num = highest known + 1`, `cloud counter catches up after reconnect (next >= highest num + 1)`, `cloud clearDelivered with 1200 delivered orders deletes all` (chunks of ≤500), `cloud subscribe reports status offline/syncing/synced`, `cloud removeProduct leaves old orders readable`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `createCloudStore`**: `onSnapshot` on `orders` and `products` feeding one merged `Snapshot` (orders sorted by `num`); `addOrder` allocates `num` via `runTransaction` on `meta/counter` and writes the order in it; on transaction failure (offline/timeout 4 s) fall back to highest known `num + 1` with plain `setDoc` (never await server acknowledgement for UI); `reconcileCounter()` runs after each snapshot while online and raises `next` to `max(next, highestNum+1)` in a transaction; writes are not awaited for network acknowledgement (resolve once applied locally); `clearDelivered` uses `writeBatch` in chunks of 500.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `git commit -am "Add Firestore store backend with offline-safe numbering"` (include new files).

### Task 3: Vendored SDK, login screen, account dialog, sync indicator

**Files:**
- Create: `vendor-src/entry.js`, `app/vendor/firebase.js` (generated), `app/firebase-config.js`, `app/auth.js`, `tests/e2e/auth-ui.js`
- Modify: `package.json` (devDeps `firebase@^10.14.0`, `esbuild@^0.24.0`; script `build:vendor`), `app/index.html` (overlay `#login`, dialog `#adlg`, pill `#syncPill`, script order: config, vendor, store, auth, app), `app/style.css`, `app/app.js` (call `Auth.start`)

**Interfaces:**
- Consumes: Task 1 store interface, Task 2 `createCloudStore`.
- Produces: `window.FB` = `{initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction}`; `Auth.start({localFactory:()=>store, onStore:(store, user|null)=>void}):void`; `Auth.errorMessage(code:string):string`.

- [ ] **Step 1: Write failing node test** `auth error messages map` in `tests/store.test.js`-style file `tests/auth.test.js`: `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found` → "Wrong email or password."; `auth/network-request-failed` → "No internet connection. Check your network and try again."; `permission-denied` → "This account is not allowed to use Amylicious."; `auth/too-many-requests` → "Too many attempts. Try again in a few minutes."; unknown code → "Could not sign in. Please try again."
- [ ] **Step 2: Run** `node --test tests/auth.test.js` → FAIL.
- [ ] **Step 3: Implement `Auth.errorMessage` in `app/auth.js`** (UMD export for node).
- [ ] **Step 4: Implement the vendor build**: `vendor-src/entry.js` re-exports the listed functions onto `window.FB`; `npm run build:vendor` runs `esbuild vendor-src/entry.js --bundle --minify --format=iife --outfile=app/vendor/firebase.js`; commit the generated file. Add `app/vendor/firebase.js` to Electron `build.files` (already covered by `app/**/*`).
- [ ] **Step 5: Implement `Auth.start`**: if `window.FIREBASE_CONFIG` missing/empty or `window.FB` absent → `onStore(localFactory(), null)`. Else initialise app, Firestore with `persistentLocalCache({tabManager: persistentMultipleTabManager()})`, and `onAuthStateChanged`: signed-in → `onStore(createCloudStore(...), user)` and hide `#login`; signed-out → show `#login`. Login form: email, password, "Sign in" (Amylicious theme, same inputs/buttons), inline error from `errorMessage`; "Sign in with Google" button (`signInWithPopup`) hidden when `location.protocol === 'file:'`. A first-read `permission-denied` from the store signs the user out and shows the not-allowed message. `#syncPill` shows Synced / Syncing / Offline / Local only (dot only on mobile); tapping opens `#adlg` with the email, status and a Sign out button (hidden in local mode).
- [ ] **Step 6: Write `tests/e2e/auth-ui.js`**: with config empty the page loads in local mode and pill reads "Local only"; with a stubbed `window.FB`/config injected via `page.addInitScript`, the login screen shows, a rejected sign-in shows "Wrong email or password.", Google button is absent when loaded from `file://`, a stubbed successful sign-in hides the overlay and shows the board.
- [ ] **Step 7: Run** all tests → PASS. Manual check noted for the owner: real sign-in on the website and in the Windows app (cannot be run here).
- [ ] **Step 8: Commit** `git add -A && git commit -m "Add Firebase login, vendored SDK and sync indicator"`.

### Task 4: Upload this device's existing data

**Files:**
- Modify: `app/store.js` (`importLegacy` on both backends), `app/auth.js` (prompt after first sign-in), `app/index.html` (prompt dialog `#idlg`)
- Test: `tests/store.test.js` (append), `tests/e2e/import-prompt.js`

**Interfaces:**
- Consumes: Task 1 `normalizeLegacy`, Task 2 cloud store, Task 3 `Auth.start` signed-in hook.
- Produces: `importLegacy(legacy):Promise<{orders:number,products:number}>` on the cloud store (local store returns `{orders:0,products:0}`).

- [ ] **Step 1: Write failing tests**: `import into empty cloud keeps legacy order numbers and sets counter to highest+1`, `import into non-empty cloud renumbers imported orders from the counter in created order`, `import merges products by name case-insensitively without duplicates`, `second import of the same legacy data is a no-op` (imported orders carry `importedFrom` = stable hash of legacy id + created; skip existing), `two devices importing the same shop data do not duplicate` (same hash rule).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `importLegacy` in `createCloudStore`** per the tests (order doc id = `legacy-<hash>`, so repeats overwrite harmlessly).
- [ ] **Step 4: UI**: after the first signed-in snapshot, if `localStorage['biteflow.v1']` has orders or products and `localStorage['biteflow.imported.<uid>']` is unset, show `#idlg`: "Upload the N orders and M products saved on this device?" with Upload / Not now; on Upload call `importLegacy(normalizeLegacy(...)).then` set the flag; local data is left untouched.
- [ ] **Step 5: e2e**: seeded local data + stubbed signed-in cloud shows the prompt once, Upload calls `importLegacy`, flag prevents a second prompt.
- [ ] **Step 6: Run** all tests → PASS; **Commit** `git commit -am "Offer to upload this device's existing orders"`.

### Task 5: Security rules, setup guide, release checks

**Files:**
- Create: `firestore.rules`, `docs/firebase-setup.md`
- Modify: `README.md` (one paragraph linking the guide)

**Interfaces:**
- Consumes: nothing from code; rules guard `orders`, `products`, `meta`.

- [ ] **Step 1: Write `firestore.rules`**: `allow read, write` on `/orders/{id}`, `/products/{id}`, `/meta/{id}` only if `request.auth != null && request.auth.token.email in ['OWNER_EMAIL']`; deny everything else (`match /{document=**} { allow read, write: if false; }`). `OWNER_EMAIL` is replaced with the owner's address(es) before publishing, and the file says so in a comment.
- [ ] **Step 2: Write `docs/firebase-setup.md`**: the numbered console steps already given to the owner (Auth providers, add user, sign-up off, authorized domain `al-creado.github.io`, Firestore in `asia-south1`, publish rules, register web app), plus a two-device check (add on one device, appears on the other; airplane mode add then reconnect) and the free-tier note.
- [ ] **Step 3: If Java is available, run the rules in the Firestore emulator** (signed-out denied, other email denied, allowlisted email allowed); otherwise record in the setup guide that rules must be verified in the console Rules Playground and list the three cases.
- [ ] **Step 4: Final verification**: `node --test tests/` PASS, all e2e files PASS, `node --check` on `main.js` and `updater.js`, then manual website check by the owner.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Add Firestore rules and setup guide"`.
