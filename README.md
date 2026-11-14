# Amylicious

Fast-food style order tracker.

Flow: **New → Ready → Delivered**. Create, edit, move forward/back, delete. Data is stored locally on the device.

- Web app: `app/` (plain HTML/JS, no build). Deployed to GitHub Pages by `.github/workflows/pages.yml` (runs on `main`).
- Desktop (Windows/Mac): Electron wrapper. `npm install && npm start` to run, `npm run dist` to build. The `Build desktop apps` workflow produces the installers.

Export: the **Export to Excel** button downloads all orders as a `.csv` that opens directly in Excel.

Products: save your menu under **Products**, then build orders by picking a product and a quantity for each line.

Sync: orders and products are shared across devices through Firebase after a one-time sign-in. Setup steps: [docs/firebase-setup.md](docs/firebase-setup.md).
