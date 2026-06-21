const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let fileToOpen = null;

// Grab a markdown file path from argv (Windows file-association launch)
function getFileArg(argv) {
  const arg = argv.find(a => /\.(md|markdown)$/i.test(a));
  return arg && fs.existsSync(arg) ? arg : null;
}

fileToOpen = getFileArg(process.argv);

// Single-instance lock so double-clicking files reuses the same window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const file = getFileArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (file) loadFileIntoWindow(file);
    }
  });
}

function loadFileIntoWindow(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('open-file', { path: filePath, content });
  } catch (e) {
    dialog.showErrorBox('Error', 'Could not open file: ' + e.message);
  }
}

// Registers MDViewer.exe as the .md/.markdown handler under HKCU (per-user,
// no admin rights required). Runs once per install — a marker file avoids
// re-running (and re-prompting Explorer) on every launch.
function registerFileAssociationWindows() {
  if (!app.isPackaged) return; // skip in dev (npm start)
  const markerPath = path.join(app.getPath('userData'), '.assoc-registered');
  if (fs.existsSync(markerPath)) return;

  try {
    const exePath = process.execPath;
    const progId = 'MDViewer.Markdown';
    const psCommands = [
      `New-Item -Path 'HKCU:\\Software\\Classes\\${progId}' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\${progId}' -Name '(default)' -Value 'Markdown Document'`,
      `New-Item -Path 'HKCU:\\Software\\Classes\\${progId}\\shell\\open\\command' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\${progId}\\shell\\open\\command' -Name '(default)' -Value '"${exePath}" "%1"'`,
      `New-Item -Path 'HKCU:\\Software\\Classes\\${progId}\\DefaultIcon' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\${progId}\\DefaultIcon' -Name '(default)' -Value '${exePath},0'`
    ];
    for (const ext of ['.md', '.markdown']) {
      psCommands.push(`New-Item -Path 'HKCU:\\Software\\Classes\\${ext}' -Force | Out-Null`);
      psCommands.push(`Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\${ext}' -Name '(default)' -Value '${progId}'`);
      psCommands.push(`New-Item -Path 'HKCU:\\Software\\Classes\\${ext}\\OpenWithProgids' -Force | Out-Null`);
      psCommands.push(`New-ItemProperty -Path 'HKCU:\\Software\\Classes\\${ext}\\OpenWithProgids' -Name '${progId}' -PropertyType String -Value '' -Force | Out-Null`);
    }
    const { execFileSync } = require('child_process');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommands.join('; ')], { windowsHide: true });
    fs.writeFileSync(markerPath, 'ok');
  } catch (e) {
    // Non-fatal: association just won't be set automatically this run.
    console.error('File association registration failed:', e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Markdown links (http/https) must open in the user's real browser, not
  // navigate the app's own window. Two cases to cover:
  // 1. <a target="_blank"> or window.open() -> setWindowOpenHandler
  // 2. A plain click that tries to navigate this window away from index.html -> will-navigate
  const isOwnAppUrl = (url) => url.startsWith('file://') && url.includes('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOwnAppUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (fileToOpen) loadFileIntoWindow(fileToOpen);
  });

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  if (process.platform === 'win32') registerFileAssociationWindows();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// macOS-style open-file event (harmless on Windows, kept for portability)
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  fileToOpen = filePath;
  if (mainWindow) loadFileIntoWindow(filePath);
});

// ---- IPC handlers ----

ipcMain.handle('dialog:openFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { path: filePath, content };
});

ipcMain.handle('file:save', async (e, { path: filePath, content }) => {
  if (!filePath) {
    const res = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (res.canceled) return null;
    filePath = res.filePath;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
});

ipcMain.handle('file:saveAs', async (e, { content, defaultName, filters }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters
  });
  if (res.canceled) return null;
  fs.writeFileSync(res.filePath, content, 'utf-8');
  return res.filePath;
});

// Export to PDF using Chromium's built-in printToPDF (no extra deps)
ipcMain.handle('export:pdf', async (e, { html, defaultName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled) return null;

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdfData = await win.webContents.printToPDF({ printBackground: true, marginsType: 1 });
  fs.writeFileSync(res.filePath, pdfData);
  win.close();
  return res.filePath;
});

// Export to .docx (minimal valid OOXML, no external deps needed)
ipcMain.handle('export:docx', async (e, { paragraphs, defaultName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Word Document', extensions: ['docx'] }]
  });
  if (res.canceled) return null;
  const { buildDocx } = require('./docxBuilder');
  const buf = await buildDocx(paragraphs);
  fs.writeFileSync(res.filePath, buf);
  return res.filePath;
});

// Let the user pick an existing image file; returns its path so the
// renderer can insert ![alt](path) at the cursor. No file is copied —
// markdown just references wherever the image already lives.
ipcMain.handle('image:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const altSuggestion = path.basename(filePath).replace(/\.[^.]+$/, '');
  return { path: filePath.replace(/\\/g, '/'), altSuggestion };
});

// Save a pasted clipboard image (e.g. a screenshot) to disk next to the
// current markdown file, so the ![]() reference stays a relative-feeling
// path. Falls back to the OS temp dir if the document hasn't been saved yet.
ipcMain.handle('image:saveClipboard', async (e, { data, currentPath, ext }) => {
  const dir = currentPath ? path.dirname(currentPath) : app.getPath('temp');
  const filename = `pasted-image-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, Buffer.from(data));
  return { path: fullPath };
});
