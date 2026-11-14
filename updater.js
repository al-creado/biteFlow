const { app, dialog, shell, net } = require('electron');

const REPO = 'al-creado/biteFlow';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// true when version a is newer than b (plain x.y.z numbers)
function isNewer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Windows: download in the background, then offer a restart.
function setupWindows(getWin) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    dialog.showMessageBox(getWin(), {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready', message: `Amylicious ${info.version} is ready to install.`,
      detail: 'Restart the app to finish updating. Your orders are kept.'
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', () => {});
  return () => autoUpdater.checkForUpdates().catch(() => {});
}

// Mac (and others): the app is not code-signed, so macOS cannot install updates
// silently. Tell the user a new version exists and open the download page.
function setupNotifyOnly(getWin) {
  let told = '';
  return async () => {
    try {
      const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return;
      const rel = await res.json();
      const latest = rel.tag_name;
      if (!latest || !isNewer(latest, app.getVersion()) || told === latest) return;
      told = latest;
      const r = await dialog.showMessageBox(getWin(), {
        type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
        title: 'Update available', message: `Amylicious ${latest.replace(/^v/, '')} is available.`,
        detail: 'Download the new version and drag it into Applications to replace the old one. Your orders are kept.'
      });
      if (r.response === 0) shell.openExternal(rel.html_url || RELEASES_URL);
    } catch (e) { /* offline or rate limited: try again later */ }
  };
}

function startUpdates(getWin) {
  if (!app.isPackaged) return;
  const check = process.platform === 'win32' ? setupWindows(getWin) : setupNotifyOnly(getWin);
  setTimeout(check, 10 * 1000);
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { startUpdates, isNewer };
