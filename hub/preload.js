// The one bridge between the page and the machine. Everything the page
// can ask the main process for is listed here, by name; nothing else
// crosses the line.
const { contextBridge, ipcRenderer } = require('electron');

const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
const version = (process.argv.find((a) => a.startsWith('--hub-version=')) || '=').split('=')[1];

contextBridge.exposeInMainWorld('hub', {
  platform, arch: process.arch, version,
  device: () => ipcRenderer.invoke('hub:device'),
  site: (path, opts) => ipcRenderer.invoke('hub:site', { path, ...(opts || {}) }),
  download: (args) => ipcRenderer.invoke('hub:download', args),
  cancel: (app) => ipcRenderer.invoke('hub:cancel', app),
  install: (args) => ipcRenderer.invoke('hub:install', args),
  installed: () => ipcRenderer.invoke('hub:installed'),
  launch: (app) => ipcRenderer.invoke('hub:launch', app),
  uninstall: (app) => ipcRenderer.invoke('hub:uninstall', app),
  reveal: (which) => ipcRenderer.invoke('hub:reveal', which),
  external: (url) => ipcRenderer.invoke('hub:external', url),
  confirm: (args) => ipcRenderer.invoke('hub:confirm', args),
  onProgress: (cb) => { ipcRenderer.on('hub:progress', (e, p) => cb(p)); },
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron', platform);
});
