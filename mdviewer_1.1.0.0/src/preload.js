const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (e, data) => cb(data)),
  getInitialFile: () => ipcRenderer.invoke('app:getInitialFile'),
  onCheckUnsavedBeforeClose: (cb) => ipcRenderer.on('check-unsaved-before-close', () => cb()),
  confirmClose: () => ipcRenderer.send('confirm-close'),

  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  save: (data) => ipcRenderer.invoke('file:save', data),
  saveAs: (data) => ipcRenderer.invoke('file:saveAs', data),
  exportPdf: (data) => ipcRenderer.invoke('export:pdf', data),
  exportPrintPreview: (data) => ipcRenderer.invoke('export:printPreview', data),
  exportDocx: (data) => ipcRenderer.invoke('export:docx', data),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  saveClipboardImage: (data) => ipcRenderer.invoke('image:saveClipboard', data),

  // Folder / project (multi-file) support
  openFolder: () => ipcRenderer.invoke('folder:open'),
  refreshFolder: (rootPath) => ipcRenderer.invoke('folder:refresh', rootPath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  createFile: (data) => ipcRenderer.invoke('file:create', data),
  renameFile: (data) => ipcRenderer.invoke('file:rename', data),
  deleteFile: (filePath) => ipcRenderer.invoke('file:delete', filePath),
  createSubfolder: (data) => ipcRenderer.invoke('folder:createSubfolder', data)
});
