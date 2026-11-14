# biteFlow

Fast-food style order tracker.

Flow: **New → Ready → Delivered**. Create, edit, move forward/back, delete. Data is stored locally on the device.

- Web app: `app/` (plain HTML/JS, no build). Deployed to GitHub Pages by `.github/workflows/pages.yml` (runs on `main`).
- Desktop (Windows/Mac): Electron wrapper. `npm install && npm start` to run, `npm run dist` to build. The `Build desktop apps` workflow produces the installers.
