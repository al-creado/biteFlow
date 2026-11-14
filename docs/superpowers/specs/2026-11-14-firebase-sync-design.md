# Amylicious order tracker: cloud sync (Firebase) design

Status: draft for approval. Date: 2026-11-14.

## Intent and why
The owner runs a small homemade-food business (Amylicious) and uses the app on several
devices (Windows, Mac, phone browser). Today each device keeps its own data in local storage,
so orders, products and prices differ per device. Goal: every device shows the same orders,
products, prices and order numbers, loaded automatically when the app opens, with no manual
export/import.

## Goals
- One shared data set across the website, the Windows app and the Mac app.
- Opens straight to current data. Changes on one device appear on the others within a few seconds.
- Works offline (shows last known data, queues edits, syncs on reconnect). Important for a
  kitchen with flaky internet.
- Private: customer names must not be readable by strangers, even though the site is public.
- Free: stays within Firebase's free (Spark) tier at this business's volume.
- No data loss: existing orders on a device can be uploaded the first time.

## Non-goals
- Multiple users with separate roles or per-user data. One shared shop login.
- Push notifications, presence ("who is online"), audit history, price history.
- Payments, customer-facing ordering.
- Replacing the Excel (CSV) export. It stays and exports the synced orders.

## Anti-goals (failure even if it "works")
- Orders disappearing or duplicating when two devices edit at once, or two devices
  getting the same order number.
- Strangers able to read or write data using the public site's Firebase config.
- The app becoming unusable offline, or blank while it waits for the network.
- A forced sign-in on every launch.

## Approaches considered
1. **Firebase Firestore + Auth (chosen)**: live sync and offline cache built in; free tier is
   ample; one shared email login. Cost: needs a Google account and ~5 min of console setup.
2. Supabase: realtime Postgres, but free projects pause after about a week idle.
3. Cloudflare Worker + D1: free and no Google account, but custom API, no offline mode,
   more to build and maintain.
The owner picked Firebase with a login (not a shop code).

## Design

### Data model (Firestore, one shop)
- `orders/{orderId}`: `{ num, status('new'|'ready'|'delivered'), created(ms), name, notes,
  items:[{name, qty, price}] }`. One document per order.
- `products/{productId}`: `{ name, price, c(colour index) }`.
- `meta/counter`: `{ next }`. New order numbers come from a Firestore transaction that reads
  and increments `next`, so two devices never get the same number.
- Edits use field-level updates (a status move only writes `status`), so concurrent edits to
  different fields do not overwrite each other. Same field edited twice: last write wins.

### Access control
- Firebase Auth, email + password provider. A single shop account is created by the owner in
  the console. Self sign-up is disabled in Auth settings.
- `firestore.rules` (committed) allow read/write only when `request.auth != null` AND
  `request.auth.token.email` is in an allowlist (the shop email). This holds even if sign-up
  were left on. Everything else is denied.
- The Firebase web config (apiKey etc.) is public by design and is committed in
  `app/firebase-config.js`; security comes from the rules, not from hiding it.

### Client
- Replace the single `state` + `localStorage` persistence with a small data layer
  (`app/store.js`) exposing: subscribe, addOrder, updateOrder, setStatus, deleteOrder,
  clearDelivered, upsertProduct, setProductPrice, removeProduct, seedProducts. The existing
  UI keeps rendering from an in-memory `state` that the data layer fills from Firestore
  snapshots (`onSnapshot`), then calls `render()`.
- Firestore offline persistence enabled (IndexedDB, multi-tab) so the cache works in browsers
  and in Electron.
- Sign-in screen in the Amylicious theme (email, password, error text). Session persisted
  (Firebase local persistence) so it appears only once per device. A sign-out control is added
  to the header. A small sync indicator (synced / offline / syncing).
- First sign-in on a device that has legacy local data: offer "Upload this device's orders and
  products", merging products by name and adding orders with fresh order numbers; then keep
  the local copy untouched as a backup and stop using it.
- If `firebase-config.js` is empty (not yet configured), the app falls back to today's
  local-only mode, so nothing breaks before setup and tests can run without a backend.
- Firebase SDK is vendored as one pre-bundled, minified file (`app/vendor/firebase.js`, auth +
  firestore only, built with esbuild by an npm script and committed). Not loaded from a CDN, so
  the website and the Electron app both work offline and with no CSP/network surprises.
- Electron app and updater are unchanged apart from needing no extra permissions.
- Export to Excel reads the synced orders.

### Setup the owner performs (guided step by step by me)
1. Create a Firebase project (Spark plan).
2. Create a Firestore database in production mode, region `asia-south1` (Mumbai).
3. Enable Authentication, Email/Password; add one user (the shop login); turn off sign-up.
4. Paste the committed `firestore.rules` (with the shop email filled in) into Firestore rules.
5. Register a Web app, copy its config object, and send it to me (not a secret).
6. Authorized domain: add `al-creado.github.io` in Auth settings.

### Free-tier limits and known risk
- Spark limits: 50k reads and 20k writes per day, 1 GiB stored. Fine for this volume, but every
  fresh install/cache clear re-reads all documents. Delivered orders accumulate; Clear removes
  them. If volume grows, add an archive or date window later (not in this version).

### Testing
- Automated browser tests against local-only mode (existing behaviour unchanged) and against a
  fake in-memory store implementing the same data-layer interface, covering sync logic
  (counter, concurrent field edits, migration of legacy data, offline queue behaviour).
- Firestore emulator tests for the rules if Java is available in the build environment;
  otherwise rules are verified manually in the console Rules Playground and this is stated.
- A real two-device check by the owner after setup (add an order on one device, see it on the
  other).

## Left to the builder
Exact file layout, UI details of the login screen and sync indicator, error messages, the
esbuild script, and test harness details, within the decisions above.

## Calls I made (flagged)
- Order numbers continue from the highest existing number when migrating legacy data.
- Email allowlist in the rules is in addition to disabled sign-up.
- No per-device settings screen; the only config is `firebase-config.js`.
