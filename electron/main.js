// Plan Desk for Windows (Electron)
const { app, BrowserWindow, Menu, protocol, ipcMain, dialog, shell, net, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const WWW = path.join(__dirname, '..', 'www');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const PDF = /\.pdf$/i;
let win = null;
let allowClose = false;
const pending = [];
const allowedPaths = new Set(); // files the person opened or chose; only these can be written

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

function filesFromArgs(argv) {
  return argv.filter(a => a && !a.startsWith('-') && PDF.test(a) && fs.existsSync(a));
}
function queueFiles(list) {
  for (const f of list) if (!pending.includes(f)) pending.push(f);
  if (win && list.length) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('open-file');
  }
}

if (process.platform === 'win32') app.setAppUserModelId('com.usama.plandesk');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => queueFiles(filesFromArgs(argv)));
  queueFiles(filesFromArgs(process.argv.slice(1)));
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      const u = new URL(req.url);
      let p = decodeURIComponent(u.pathname);
      if (!p || p === '/') p = '/index.html';
      const file = path.normalize(path.join(WWW, p));
      if (!file.startsWith(WWW)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    Menu.setApplicationMenu(null); // every key goes to Plan Desk's own shortcuts
    createWindow();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Plan Desk', backgroundColor: '#1B2129', autoHideMenuBar: true, show: false,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.on('close', e => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('close-request');
  });
  win.loadURL('app://plandesk/index.html');
}
app.on('window-all-closed', () => app.quit());

ipcMain.handle('close-now', () => { allowClose = true; if (win) win.close(); });
ipcMain.handle('version', () => app.getVersion());

function readPdf(p) {
  const data = new Uint8Array(fs.readFileSync(p));
  const st = fs.statSync(p);
  allowedPaths.add(path.resolve(p));
  return { path: p, name: path.basename(p), data, mtime: st.mtimeMs };
}
ipcMain.handle('take-files', () => {
  const out = [];
  while (pending.length) { try { out.push(readPdf(pending.shift())); } catch (e) { /* unreadable */ } }
  return out;
});
ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open drawings', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF drawings', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) { try { out.push(readPdf(p)); } catch (e) { /* unreadable */ } }
  return out;
});
ipcMain.handle('read-path', (_e, p) => {
  try { if (!PDF.test(p) || !fs.existsSync(p)) return null; return readPdf(p); } catch (e) { return null; }
});
ipcMain.handle('file-mtime', (_e, p) => { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } });

function writeSafely(p, data) {
  const tmp = p + '.plandesk-saving';
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, p);
  return fs.statSync(p).mtimeMs;
}
ipcMain.handle('save-pdf', (_e, p, data) => {
  const full = path.resolve(p);
  if (!allowedPaths.has(full)) return { saved: false, error: 'This file was not opened in Plan Desk.' };
  try { return { saved: true, path: p, mtime: writeSafely(full, data) }; }
  catch (e) { return { saved: false, error: e.code === 'EBUSY' || e.code === 'EPERM' ? 'The file is open in another program or is read-only.' : e.message }; }
});
ipcMain.handle('save-as', async (_e, name, data, kind) => {
  const filters = kind === 'csv' ? [{ name: 'CSV (Excel)', extensions: ['csv'] }]
    : kind === 'json' ? [{ name: 'Plan Desk tools', extensions: ['json'] }]
    : [{ name: 'PDF', extensions: ['pdf'] }];
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (r.canceled || !r.filePath) return { saved: false };
  try {
    const mtime = writeSafely(r.filePath, data);
    if (PDF.test(r.filePath)) allowedPaths.add(path.resolve(r.filePath));
    return { saved: true, path: r.filePath, name: path.basename(r.filePath), mtime };
  } catch (e) { return { saved: false, error: e.message }; }
});
ipcMain.handle('open-json', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Plan Desk tools', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { return fs.readFileSync(r.filePaths[0], 'utf8'); } catch (e) { return null; }
});
ipcMain.handle('show-in-folder', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });

// ---- updates from GitHub Releases
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return { available: false, dev: true };
  const r = await autoUpdater.checkForUpdates();
  const v = r && r.updateInfo && r.updateInfo.version;
  const newer = v && v !== app.getVersion() && v.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
  let notes = r && r.updateInfo && r.updateInfo.releaseNotes;
  if (Array.isArray(notes)) notes = notes.map(n => n.note).join('\n');
  if (typeof notes === 'string') notes = notes.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/li>/gi, '\n').replace(/<li>/gi, '• ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return { available: !!newer, version: v, notes: (notes || '').trim() };
});
ipcMain.handle('update-download', async () => {
  autoUpdater.removeAllListeners('download-progress');
  autoUpdater.on('download-progress', p => { if (win) win.webContents.send('update-progress', p.percent || 0); });
  await autoUpdater.downloadUpdate();
  return true;
});
ipcMain.handle('update-install', () => { allowClose = true; setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; });

let lastNote = null;
ipcMain.handle('notify-update', (_e, ver, notes) => {
  if (!Notification.isSupported()) return false;
  const first = String(notes || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || 'Click to see what\'s new.';
  const n = new Notification({ title: `Plan Desk ${ver} is available`, body: first.slice(0, 180), icon: ICON });
  n.on('click', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send('update-clicked', ver); }
  });
  n.show();
  lastNote = n;
  return true;
});
