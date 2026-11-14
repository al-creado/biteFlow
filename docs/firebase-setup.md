# Firebase setup (one time)

The app syncs orders, products and prices through your Firebase project `bite-flow`.
Everything below is done once in https://console.firebase.google.com (project `bite-flow`).

## 1. Sign-in methods
Build > Authentication > Sign-in method: switch on **Email/Password** (first toggle only) and **Google**.

## 2. Your account
- Authentication > Users > **Add user**: your email and a password. Use the same address you use for Google;
  Firebase treats both as one person. The Windows and Mac apps sign in with this email and password
  (Google sign-in is blocked inside desktop apps).
- Authentication > Settings > User actions: untick **Enable create (sign-up)** and save.
- Authentication > Settings > Authorized domains: **Add domain** `al-creado.github.io`.

## 3. Database
Build > Firestore Database > **Create database**, location **asia-south1 (Mumbai)**, **production mode**.

## 4. Security rules (this is what keeps your customers' names private)
1. Open Firestore Database > **Rules**.
2. Paste the contents of `firestore.rules` from this repository.
3. Replace `OWNER_EMAIL` with your email in quotes. For more than one person use
   `['you@gmail.com', 'helper@gmail.com']`.
4. **Publish**. Do not commit your real email into the repository (it is public).

Check the rules in the **Rules Playground** (Rules tab) with the "Firestore" simulator and a `get` on
`/databases/(default)/documents/orders/x`:
- Authenticated **off** -> must be **denied**.
- Authenticated **on**, provider `password`, email `someone-else@example.com` -> must be **denied**.
- Authenticated **on**, email = your email -> must be **allowed**.

(`tests/rules/` holds the same checks as an automated test for the Firestore emulator:
`cd tests/rules && npm install && node --test rules.test.js` with the emulator running on port 8080.
It needs Java and was not run when the feature was built.)

## 5. First sign-in on each device
Open the website or the app and sign in. If the device already has orders saved from before, you are
asked once whether to upload them; choose **Upload**. Your old copy stays on the device.

## Two-device check
1. Sign in on two devices. Add an order on one: it appears on the other within a few seconds.
2. Turn on airplane mode on one device, add an order (the pill shows **Offline**), turn it off:
   the order appears on the other device and the pill returns to **Synced**.

## Limits and notes
- Free (Spark) plan: 50,000 reads and 20,000 writes per day, 1 GiB stored. Plenty for this business.
  Every fresh install re-reads all orders; use **Clear** to remove delivered orders you no longer need.
- Two devices that are both offline can give the same order number to different orders; the shared
  counter catches up when they reconnect, but the numbers are not rewritten.
- The Firebase code the app uses is bundled in `app/vendor/firebase.js`. To rebuild it:
  `npm run build:vendor`.
