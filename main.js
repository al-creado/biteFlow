const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { startUpdates } = require('./updater');

let win;
function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 800, title: 'Amylicious', backgroundColor: '#FFC2DE', icon: path.join(__dirname, 'build', 'icon.png') });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}
app.whenReady().then(() => {
  createWindow();
  startUpdates(() => win);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
