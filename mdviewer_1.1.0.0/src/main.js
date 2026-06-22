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
    width: 1300,
    height: 850,
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

  // DevTools toggle (F12 or Ctrl+Shift+I) — with the app menu removed there
  // was previously no way to see renderer-process JS errors at all, which
  // makes silent rendering failures impossible to diagnose. This is the
  // single most useful debugging tool for "double-click opens but shows
  // a blank page" style issues: open it and check the Console tab.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Surface renderer crashes/hangs instead of leaving a silent blank window
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    dialog.showErrorBox('MDViewer crashed', `The app's display process stopped unexpectedly (${details.reason}). Please reopen MDViewer.`);
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('Renderer became unresponsive');
  });

  // Markdown links (http/https) must open in the user's real browser, not
  // navigate the app's own window.
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
    // Initial-launch file delivery is handled by the renderer explicitly
    // pulling via app:getInitialFile once it's ready (see renderer.js) —
    // this avoids any dependency on event/listener timing on first launch.
  });

  // Warn before closing if there are unsaved changes (renderer tracks dirty state)
  mainWindow.on('close', (e) => {
    if (mainWindow.__forceClose) return;
    e.preventDefault();
    mainWindow.webContents.send('check-unsaved-before-close');
  });

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  if (process.platform === 'win32') registerFileAssociationWindows();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('open-file', (e, filePath) => {
  e.preventDefault();
  fileToOpen = filePath;
  if (mainWindow) loadFileIntoWindow(filePath);
});

// ---- IPC handlers ----

// Pull-based alternative to the did-finish-load push above: the renderer
// calls this once it has fully initialized and is guaranteed ready to
// receive a file, removing any dependency on event-timing/listener-order.
// Returns null if there's no launch file or it's already been delivered.
ipcMain.handle('app:getInitialFile', () => {
  if (!fileToOpen) return null;
  try {
    const content = fs.readFileSync(fileToOpen, 'utf-8');
    const result = { path: fileToOpen, content };
    fileToOpen = null; // consume — don't redeliver on subsequent calls
    return result;
  } catch (e) {
    fileToOpen = null;
    return null;
  }
});

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

// Renderer confirms whether it's safe to close (after warning the user about
// unsaved changes if needed) — main process then actually quits the window.
ipcMain.on('confirm-close', () => {
  if (mainWindow) {
    mainWindow.__forceClose = true;
    mainWindow.close();
  }
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

// Show a real print-preview window before exporting, using Chromium's
// native print dialog (lets the user adjust margins/scale/page range,
// preview the actual paginated layout, and choose "Save as PDF" or a
// physical printer) instead of silently writing straight to a file.
ipcMain.handle('export:printPreview', async (e, { html }) => {
  // Electron's webContents.print() opens the native OS print dialog, but
  // that dialog's own preview pane can't render arbitrary HTML loaded via
  // a data: URL — it only works for certain document types, which is why
  // Windows shows "This app doesn't support print preview" instead of an
  // actual preview. Showing our own visible window with the real rendered
  // HTML *is* the preview; the native dialog (with its broken preview
  // pane) is only invoked afterward, once the user clicks Print here.
  const printWin = new BrowserWindow({
    width: 900, height: 1000,
    title: 'MDViewer - Print Preview',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true }
  });
  const wrapped = html.replace(
    '</body>',
    `<div style="position:fixed;bottom:0;left:0;right:0;padding:12px;background:#2d2d2d;border-top:1px solid #444;text-align:right;font-family:sans-serif;">
      <button onclick="window.print()" style="padding:8px 18px;margin-right:8px;background:#4fa3ff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Print / Save as PDF</button>
      <button onclick="window.close()" style="padding:8px 18px;background:#555;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Close</button>
    </div>
    <style>@media print { div[style*="position:fixed"] { display: none !important; } }</style>
    </body>`
  );
  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(wrapped));
  return true;
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
// renderer can insert ![alt](path) at the cursor.
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
// current markdown file.
ipcMain.handle('image:saveClipboard', async (e, { data, currentPath, ext }) => {
  const dir = currentPath ? path.dirname(currentPath) : app.getPath('temp');
  const filename = `pasted-image-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, Buffer.from(data));
  return { path: fullPath };
});

// ---- Folder / project (multi-file) support ----

const TEXT_EXT = /\.(md|markdown|txt)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '.idea', '.vscode']);

// Recursively builds a lightweight tree of markdown files, images, and
// folders — used to populate the sidebar. Caps depth to avoid pathological
// folder structures (e.g. accidentally opening C:\).
function buildTree(dirPath, depth = 0) {
  if (depth > 8) return [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const children = buildTree(path.join(dirPath, entry.name), depth + 1);
      nodes.push({ type: 'folder', name: entry.name, path: path.join(dirPath, entry.name), children });
    } else if (TEXT_EXT.test(entry.name) || IMAGE_EXT.test(entry.name)) {
      nodes.push({
        type: IMAGE_EXT.test(entry.name) ? 'image' : 'file',
        name: entry.name,
        path: path.join(dirPath, entry.name)
      });
    }
  }
  // Folders first, then files, both alphabetical
  nodes.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

ipcMain.handle('folder:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const root = res.filePaths[0];
  return { root, tree: buildTree(root) };
});

ipcMain.handle('folder:refresh', async (e, rootPath) => {
  return { root: rootPath, tree: buildTree(rootPath) };
});

ipcMain.handle('file:read', async (e, filePath) => {
  try {
    return { path: filePath, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (err) {
    return null;
  }
});

ipcMain.handle('file:create', async (e, { dirPath, name }) => {
  const fullPath = path.join(dirPath, name);
  if (fs.existsSync(fullPath)) return { error: 'A file with that name already exists.' };
  fs.writeFileSync(fullPath, '');
  return { path: fullPath };
});

ipcMain.handle('file:rename', async (e, { oldPath, newName }) => {
  const newPath = path.join(path.dirname(oldPath), newName);
  if (fs.existsSync(newPath)) return { error: 'A file with that name already exists.' };
  fs.renameSync(oldPath, newPath);
  return { path: newPath };
});

ipcMain.handle('file:delete', async (e, filePath) => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0,
    message: `Delete "${path.basename(filePath)}"?`,
    detail: 'This moves the file to the Recycle Bin.'
  });
  if (res.response !== 1) return { canceled: true };
  try {
    await shell.trashItem(filePath);
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
    } catch (err2) {
      return { error: 'Could not delete file: ' + err2.message };
    }
  }
  return { deleted: true };
});

ipcMain.handle('folder:createSubfolder', async (e, { dirPath, name }) => {
  const fullPath = path.join(dirPath, name);
  if (fs.existsSync(fullPath)) return { error: 'A folder with that name already exists.' };
  fs.mkdirSync(fullPath);
  return { path: fullPath };
});
