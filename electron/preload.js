const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  version: () => ipcRenderer.invoke('version'),
  takePendingFiles: () => ipcRenderer.invoke('take-files'),
  onOpenFile: cb => { ipcRenderer.removeAllListeners('open-file'); ipcRenderer.on('open-file', () => cb()); },
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readPath: p => ipcRenderer.invoke('read-path', p),
  fileMtime: p => ipcRenderer.invoke('file-mtime', p),
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  savePdf: (p, data) => ipcRenderer.invoke('save-pdf', p, data),
  saveAs: (name, data, kind) => ipcRenderer.invoke('save-as', name, data, kind),
  openJson: () => ipcRenderer.invoke('open-json'),
  showInFolder: p => ipcRenderer.invoke('show-in-folder', p),
  onCloseRequest: cb => { ipcRenderer.removeAllListeners('close-request'); ipcRenderer.on('close-request', () => cb()); },
  closeNow: () => ipcRenderer.invoke('close-now'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  notifyUpdate: (ver, notes) => ipcRenderer.invoke('notify-update', ver, notes),
  onUpdateClicked: cb => { ipcRenderer.removeAllListeners('update-clicked'); ipcRenderer.on('update-clicked', (_e, v) => cb(v)); },
  onUpdateProgress: cb => { ipcRenderer.removeAllListeners('update-progress'); ipcRenderer.on('update-progress', (_e, p) => cb(p)); }
});
