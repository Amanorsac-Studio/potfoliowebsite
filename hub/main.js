// Amanorsac Hub - desktop shell.
//
// The whole interface lives in app/index.html, a single self-contained
// page (fonts and artwork are inlined, nothing is fetched from the
// network). This file only opens a window for it, keeps navigation
// inside the app, and sends outside links to the system browser.

const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('path');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// One instance at a time; a second launch just focuses the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

nativeTheme.themeSource = 'dark';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0e10',
    title: 'Amanorsac Hub',
    // The page draws its own title bar. On macOS the native traffic
    // lights are overlaid on it; on Windows the native minimise /
    // maximise / close buttons are, coloured to match the page.
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(isWin
      ? {
          titleBarOverlay: {
            color: '#141516',
            symbolColor: '#a8a9ad',
            height: 45,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--hub-version=${app.getVersion()}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Links marked target="_blank" (the website, help, product pages)
  // open in the user's default browser, never in a second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Keep the window on the bundled page.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  return win;
}

function buildMenu() {
  if (!isMac) {
    // Windows / Linux: no menu bar. The page is the whole interface.
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Explore all apps',
          click: () => shell.openExternal('https://amanorsac.studio/apps'),
        },
        {
          label: 'Help & support',
          click: () => shell.openExternal('https://amanorsac.studio/about#contact'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
