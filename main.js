'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { readHeader } = require('./lib/csv');
const { detect, describe } = require('./lib/detect');
const { runBatch } = require('./lib/pipeline');

const DEFAULTS = {
  outputFolder: '',
  formatCsv: true,
  formatXlsx: false,
  scrubDnc: false,        // off by default: DNC numbers are kept
  requirePhone: true,     // rows with no phone are dropped
  dedupePhone: true,      // same number twice -> keep the first row only
  dedupeAcrossFiles: true,
  borrowEmail: false,     // don't pull an email off a different contact
  phoneFormat: 'e164',
};

let settingsPath;
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  const merged = { ...loadSettings(), ...s };
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  return merged;
}

const isDataFile = (p) => typeof p === 'string' && /\.(csv|tsv|txt)$/i.test(p) && fs.existsSync(p);
let pendingFiles = process.argv.slice(1).filter(isDataFile);

let win;
function sendPending() {
  if (win && pendingFiles.length) { win.webContents.send('open-files', pendingFiles); pendingFiles = []; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 560, height: 540, minWidth: 470, minHeight: 420,
    title: 'Lead Cleaner',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', sendPending);
}

// macOS delivers "Open With" / icon drops through this event, not argv.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (!isDataFile(p)) return;
  pendingFiles.push(p);
  if (win) { win.show(); sendPending(); }
});

app.whenReady().then(() => {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  if (!loadSettings().outputFolder) {
    saveSettings({ outputFolder: app.getPath('downloads') });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('set-settings', (_e, s) => saveSettings(s));
ipcMain.handle('reveal', (_e, p) => { shell.showItemInFolder(p); });

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose the export files to clean',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Spreadsheets', extensions: ['csv', 'tsv', 'txt'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose the default output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? '' : r.filePaths[0];
});

/** Read just the headers so the UI can show what each file contains before running. */
ipcMain.handle('inspect', async (_e, paths) => {
  const out = [];
  for (const p of paths) {
    try {
      const header = await readHeader(p);
      const info = describe(detect(header));
      const { size } = fs.statSync(p);
      out.push({ path: p, name: path.basename(p), size, ...info, error: null });
    } catch (err) {
      out.push({ path: p, name: path.basename(p), error: err.message, usable: false });
    }
  }
  return out;
});

ipcMain.handle('run', async (_e, job) =>
  runBatch(job.files, job.opts, (p) => win.webContents.send('progress', p)));
