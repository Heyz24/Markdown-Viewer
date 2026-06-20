const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (e, data) => cb(data)),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  save: (data) => ipcRenderer.invoke('file:save', data),
  saveAs: (data) => ipcRenderer.invoke('file:saveAs', data),
  exportPdf: (data) => ipcRenderer.invoke('export:pdf', data),
  exportDocx: (data) => ipcRenderer.invoke('export:docx', data),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  saveClipboardImage: (data) => ipcRenderer.invoke('image:saveClipboard', data)
});
