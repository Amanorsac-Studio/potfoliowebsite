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
  // A folder name ("apps" / "downloads"), or a file path to point at.
  reveal: (which) => ipcRenderer.invoke('hub:reveal', which),
  // Re-run an installer already sitting in the downloads folder.
  runInstaller: (file) => ipcRenderer.invoke('hub:run-installer', file),
  // Forget an app the Hub only THINKS is installed. Deletes nothing.
  forget: (app) => ipcRenderer.invoke('hub:forget', app),
  external: (url) => ipcRenderer.invoke('hub:external', url),
  confirm: (args) => ipcRenderer.invoke('hub:confirm', args),
  // Usage notes. state() says whether the person has been asked and what
  // they said; nothing is recorded or sent until consent is true.
  usage: {
    state: () => ipcRenderer.invoke('hub:usage-state'),
    consent: (yes) => ipcRenderer.invoke('hub:usage-consent', yes),
    record: (event, app, version) => ipcRenderer.invoke('hub:usage-record', { event, app, version }),
    take: (max) => ipcRenderer.invoke('hub:usage-take', max),
    ack: (n) => ipcRenderer.invoke('hub:usage-ack', n),
  },
  onProgress: (cb) => { ipcRenderer.on('hub:progress', (e, p) => cb(p)); },
  onDeepLink: (cb) => { ipcRenderer.on('hub:deep-link', (e, p) => cb(p)); },
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron', platform);
});
