// Runs before the page, in an isolated world. Tells the page which
// platform it is on (so it can hide the mock window controls where the
// real ones are drawn) and which version of the Hub this is.

const { contextBridge } = require('electron');

const platform =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';

contextBridge.exposeInMainWorld('hub', {
  platform,
  arch: process.arch,
  version: (process.argv.find((a) => a.startsWith('--hub-version=')) || '=').split('=')[1],
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron', platform);
});
