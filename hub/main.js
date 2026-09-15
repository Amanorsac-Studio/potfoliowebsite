// Amanorsac Hub - main process.
//
// The interface (app/) talks to Supabase directly with the same
// publishable key the website uses; Row Level Security decides what it
// may see. Everything that needs the operating system - downloading an
// installer, unpacking it, launching an app - or that needs to reach
// amanorsac.studio's Worker without a browser origin, happens here and
// is exposed to the page through preload.js.

const { app, BrowserWindow, Menu, shell, nativeTheme, ipcMain, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

// HUB_SITE points the Hub at another origin - a staging copy, or a
// local server - without a rebuild. Unset, it is the live site.
const SITE = (process.env.HUB_SITE && /^https?:\/\//.test(process.env.HUB_SITE))
  ? process.env.HUB_SITE.replace(/\/+$/, '')
  : 'https://amanorsac.studio';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/* The website links to amanorsac://install/<app> ("already have the Hub?
   Open it there") - see docs/hub-integration.md §7. Registering the
   scheme is what makes that link do anything; nothing breaks when it is
   not registered, the person just uses the download button instead. */
const PROTOCOL = 'amanorsac';
if (process.defaultApp) {
  // running from source: the argv dance is what tells Windows which
  // executable and script to hand the link to
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

/* Where a link waits until the page is up to receive it. */
let pendingDeepLink = null;
function handleDeepLink(url) {
  if (!url || url.indexOf(PROTOCOL + '://') !== 0) return;
  const rest = url.slice((PROTOCOL + '://').length).replace(/\/+$/, '');
  const m = rest.match(/^install\/(.+)$/);
  const payload = m ? { action: 'install', app: decodeURIComponent(m[1]).toLowerCase() } : { action: 'open' };
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { pendingDeepLink = payload; return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('hub:deep-link', payload);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows and Linux deliver the link as an argument to the second launch
  app.on('second-instance', (event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const link = argv.find((a) => a.startsWith(PROTOCOL + '://'));
    if (link) handleDeepLink(link);
  });
}

// macOS delivers it as an event, which can arrive before the window exists
app.on('open-url', (event, url) => { event.preventDefault(); handleDeepLink(url); });

nativeTheme.themeSource = 'dark';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 840, minWidth: 940, minHeight: 620,
    show: false, backgroundColor: '#0d0e10', title: 'Amanorsac Hub',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(isWin ? { titleBarOverlay: { color: '#141516', symbolColor: '#a8a9ad', height: 45 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--hub-version=${app.getVersion()}`],
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // a link that arrived before there was a window to send it to
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingDeepLink) { mainWindow.webContents.send('hub:deep-link', pendingDeepLink); pendingDeepLink = null; }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  return mainWindow;
}

function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    { role: 'help', submenu: [
      { label: 'App Store', click: () => shell.openExternal(SITE + '/apps') },
      { label: 'My Apps on the website', click: () => shell.openExternal(SITE + '/my-apps.html') },
      { label: 'Help & support', click: () => shell.openExternal(SITE + '/about#contact') },
    ] },
  ]));
}

/* ---------------------------------------------------------------------
   Where things live on this machine
   --------------------------------------------------------------------- */

const paths = {
  downloads: () => path.join(app.getPath('userData'), 'downloads'),
  installRoot: () => isWin
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Amanorsac')
    : isMac ? path.join(os.homedir(), 'Applications', 'Amanorsac')
    : path.join(os.homedir(), '.local', 'share', 'amanorsac'),
  records: () => path.join(app.getPath('userData'), 'installed.json'),
};

async function readRecords() {
  try { return JSON.parse(await fsp.readFile(paths.records(), 'utf8')) || {}; }
  catch (e) { return {}; }
}
async function writeRecords(records) {
  await fsp.mkdir(path.dirname(paths.records()), { recursive: true });
  await fsp.writeFile(paths.records(), JSON.stringify(records, null, 2));
}
function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }

/* ---------------------------------------------------------------------
   Usage notes

   What is counted: an app was opened, installed or updated, and which
   kind of machine it happened on. That is the whole of it. No file
   names, no folder names, no computer name, no keystrokes, nothing from
   inside an app - none of that is read here and none of it is sent.

   Nothing is counted until the person says yes. Until then `consent` is
   null and every record() is dropped on the floor. Saying no later
   empties the queue as well as stopping it.

   The queue is a file on this machine, so a week offline loses nothing:
   the page drains it the next time amanorsac.studio answers, and only
   removes what the server confirmed. `installId` is a random number
   belonging to this installation, not to a person - it is what makes
   "opened on two machines" different from "opened twice", and it is the
   only identifier stored beside an event.
   --------------------------------------------------------------------- */

const USAGE_LIMIT = 500; // a bounded file: the oldest go first
paths.usage = () => path.join(app.getPath('userData'), 'usage.json');

let usageCache = null;
async function readUsage() {
  if (usageCache) return usageCache;
  let u = null;
  try { u = JSON.parse(await fsp.readFile(paths.usage(), 'utf8')); } catch (e) {}
  if (!u || typeof u !== 'object') u = {};
  usageCache = {
    installId: typeof u.installId === 'string' && u.installId ? u.installId : crypto.randomUUID(),
    consent: u.consent === true ? true : u.consent === false ? false : null,
    decidedAt: u.decidedAt || null,
    queue: Array.isArray(u.queue) ? u.queue.slice(-USAGE_LIMIT) : [],
  };
  return usageCache;
}
async function writeUsage(u) {
  usageCache = u;
  try {
    await fsp.mkdir(path.dirname(paths.usage()), { recursive: true });
    await fsp.writeFile(paths.usage(), JSON.stringify(u, null, 2));
  } catch (e) { /* a note that cannot be written is a note not worth an error */ }
}

const USAGE_EVENTS = ['hub_open', 'app_open', 'app_install', 'app_update'];

async function recordUsage(event, appId, version) {
  if (!USAGE_EVENTS.includes(event)) return;
  const u = await readUsage();
  if (u.consent !== true) return;
  u.queue.push({
    event, app: appId || null, app_version: version || null,
    at: new Date().toISOString(),
    platform: shownPlatform, arch: process.arch, os_release: os.release(),
    hub_version: app.getVersion(),
  });
  if (u.queue.length > USAGE_LIMIT) u.queue = u.queue.slice(-USAGE_LIMIT);
  await writeUsage(u);
}

/* Installed apps, checked against the disk every time they are asked
   for: a folder the user deleted by hand is not an installed app. */
async function installedApps() {
  const records = await readRecords();
  let changed = false;
  for (const [id, r] of Object.entries(records)) {
    const alive = r.kind === 'installer' ? true : exists(r.dir);
    if (!alive) { delete records[id]; changed = true; }
  }
  if (changed) await writeRecords(records);
  return records;
}

/* ---------------------------------------------------------------------
   Talking to amanorsac.studio
   The Worker has no CORS headers - the website never needed them - so
   the page cannot call it from a file:// origin. This does it instead.
   --------------------------------------------------------------------- */

function siteRequest(pathname, { method = 'GET', token, body } = {}) {
  return new Promise((resolve) => {
    const req = net.request({ method, url: SITE + pathname });
    req.setHeader('accept', 'application/json');
    /* The catalog is sent with a five-minute max-age so browsers and
       the CDN can hold it, which is right for a website and wrong for a
       window that stays open for days: it would answer from Chromium's
       own cache and the studio's notice would arrive whenever the cache
       happened to expire. Asking for a revalidation costs one
       conditional request and makes "reload the collection" mean it. */
    req.setHeader('cache-control', 'no-cache');
    req.setHeader('user-agent', 'AmanorsacHub/' + app.getVersion() + ' (' + process.platform + ')');
    if (token) req.setHeader('authorization', 'Bearer ' + token);
    if (body !== undefined) req.setHeader('content-type', 'application/json');
    req.on('response', (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, text });
      });
      res.on('error', () => resolve({ ok: false, status: 0, json: null, text: '' }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, json: null, text: String(e && e.message) }));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ---------------------------------------------------------------------
   Downloads
   A ticket from /api/app-download is fetched to userData/downloads with
   progress reported to the page. One at a time per app.
   --------------------------------------------------------------------- */

const active = new Map(); // app id -> { req, cancel }

function progress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hub:progress', payload);
}

function fetchToFile(url, dest, appId, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' });
    req.setHeader('user-agent', 'AmanorsacHub/' + app.getVersion());
    let received = 0, total = 0, out = null, cancelled = false;
    const entry = {
      req,
      cancel: () => { cancelled = true; try { req.abort(); } catch (e) {} },
    };
    active.set(appId, entry);
    const done = (err) => {
      active.delete(appId);
      if (out) out.close();
      if (err) { fs.rm(dest, { force: true }, () => {}); reject(err); }
      else resolve({ received, total });
    };
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => done(new Error('The studio answered ' + res.statusCode + ' instead of the file.')));
        return;
      }
      const type = String(res.headers['content-type'] || '');
      if (/text\/html/i.test(type)) {
        res.on('data', () => {}); res.on('end', () => done(new Error('The download link did not return a file.')));
        return;
      }
      total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      out = fs.createWriteStream(dest);
      let last = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        out.write(chunk);
        const now = Date.now();
        if (now - last > 150) { last = now; onProgress(received, total); }
      });
      res.on('end', () => { out.end(() => done(cancelled ? new Error('cancelled') : null)); });
      res.on('error', (e) => done(e));
      out.on('error', (e) => done(e));
    });
    req.on('error', (e) => done(cancelled ? new Error('cancelled') : e));
    req.end();
  });
}

ipcMain.handle('hub:download', async (event, { app: appId, platform, token, title }) => {
  if (active.has(appId)) return { error: 'busy', message: 'That download is already running.' };
  // Ownership is decided by the Worker with this session's token, exactly
  // as the website does it; the Hub only asks.
  progress({ app: appId, state: 'preparing', received: 0, total: 0, percent: 0 });
  const ticket = await siteRequest('/api/app-download', { method: 'POST', token, body: { app: appId, platform } });
  if (!ticket.ok || !ticket.json || !ticket.json.url) {
    progress({ app: appId, state: 'error' });
    const j = ticket.json || {};
    return { error: j.error || 'download_failed', message: j.message || 'Could not start the download. Try again in a moment.' };
  }
  const file = String(ticket.json.file || (appId + '-' + platform + '.zip')).replace(/[\\/:*?"<>|]/g, '_');
  await fsp.mkdir(paths.downloads(), { recursive: true });
  const dest = path.join(paths.downloads(), file);
  const url = ticket.json.url.startsWith('http') ? ticket.json.url : SITE + ticket.json.url;
  try {
    const r = await fetchToFile(url, dest, appId, (received, total) => {
      progress({ app: appId, state: 'downloading', received, total, percent: total ? Math.round(received / total * 100) : 0, file, title });
    });
    progress({ app: appId, state: 'downloaded', received: r.received, total: r.total, percent: 100, file, title });
    return { ok: true, path: dest, file, version: ticket.json.version || null, bytes: r.received };
  } catch (e) {
    const cancelled = e && e.message === 'cancelled';
    progress({ app: appId, state: cancelled ? 'cancelled' : 'error' });
    return { error: cancelled ? 'cancelled' : 'download_failed', message: cancelled ? 'Download cancelled.' : (e && e.message) || 'The download failed.' };
  }
});

ipcMain.handle('hub:cancel', async (event, appId) => {
  const a = active.get(appId);
  if (a) a.cancel();
  return { ok: !!a };
});

/* ---------------------------------------------------------------------
   Installing
   .zip  -> unpacked into the Hub's own apps folder (ditto on macOS keeps
            .app bundles intact; bsdtar ships with Windows 10 and later)
   .exe / .pkg / .dmg -> the platform's own installer is run and the
            Hub records that it was, since the file decides where it goes
   --------------------------------------------------------------------- */

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim())); else resolve(stdout);
    });
  });
}

async function unzip(zip, dest) {
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });
  if (isMac) return run('ditto', ['-xk', zip, dest]);
  if (isWin) {
    try { return await run('tar', ['-xf', zip, '-C', dest]); }
    catch (e) {
      return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]);
    }
  }
  return run('unzip', ['-oq', zip, '-d', dest]);
}

/* What in the unpacked folder is the thing to open. */
async function findLaunchable(dir, appName, depth = 0) {
  const found = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return found; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const lower = ent.name.toLowerCase();
    if (isMac && ent.isDirectory() && lower.endsWith('.app')) { found.push({ path: full, kind: 'app' }); continue; }
    if (isWin && ent.isFile() && lower.endsWith('.exe')) {
      const installerish = /(^|[^a-z])(setup|install|unins|uninstall|vc_redist|vcredist|redist)/i.test(lower);
      found.push({ path: full, kind: installerish ? 'installer' : 'exe' });
      continue;
    }
    if (ent.isDirectory() && depth < 3 && !lower.endsWith('.app')) found.push(...await findLaunchable(full, appName, depth + 1));
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(appName);
  found.sort((a, b) => {
    const score = (f) => (f.kind === 'installer' ? 0 : 2) + (norm(path.basename(f.path)).includes(want) ? 1 : 0) - f.path.split(path.sep).length / 100;
    return score(b) - score(a);
  });
  return found;
}

function runInstaller(file) {
  return new Promise((resolve) => {
    if (isMac) {
      // .pkg / .dmg / .app: hand it to the system installer or Finder
      shell.openPath(file).then((err) => resolve({ ok: !err, error: err || null, detached: true }));
      return;
    }
    // A Windows setup program. It asks for elevation itself if it needs
    // it; the Hub waits for it to finish so it can record the outcome.
    let child;
    try {
      child = spawn(file, [], { detached: false, stdio: 'ignore', windowsHide: false });
    } catch (e) { resolve({ ok: false, error: e.message }); return; }
    child.on('error', (e) => {
      // EACCES here usually means UAC: fall back to the shell, which
      // shows the elevation prompt, and consider it started.
      shell.openPath(file).then((err) => resolve({ ok: !err, error: err || null, detached: true }));
    });
    child.on('exit', (code) => resolve({ ok: code === 0, code, error: code === 0 ? null : 'The installer closed with code ' + code + '.' }));
  });
}

ipcMain.handle('hub:install', async (event, { app: appId, name, path: file, version, kind, mode }) => {
  if (!exists(file)) return { error: 'missing', message: 'The downloaded file is no longer there. Download it again.' };
  const records = await readRecords();
  const lower = file.toLowerCase();
  try {
    if (lower.endsWith('.zip')) {
      const dir = path.join(paths.installRoot(), name.replace(/[\\/:*?"<>|]/g, ''));
      await unzip(file, dir);
      const launch = await findLaunchable(dir, name);
      const best = launch[0];
      if (best && best.kind === 'installer' && !launch.some((l) => l.kind !== 'installer')) {
        // The zip was a wrapper around a setup program.
        const r = await runInstaller(best.path);
        if (!r.ok) return { error: 'install_failed', message: r.error || 'The installer did not finish.' };
        records[appId] = { app: appId, name, kind: 'installer', version: version || null, installedAt: new Date().toISOString(), source: best.path };
      } else {
        records[appId] = { app: appId, name, kind: kind === 'plugin' ? 'plugin' : 'portable', dir, exe: best ? best.path : null,
          version: version || null, installedAt: new Date().toISOString() };
      }
    } else {
      const r = await runInstaller(file);
      if (!r.ok) return { error: 'install_failed', message: r.error || 'The installer did not finish.' };
      records[appId] = { app: appId, name, kind: kind === 'plugin' ? 'plugin' : 'installer', version: version || null,
        installedAt: new Date().toISOString(), source: file, pending: !!r.detached };
    }
    await writeRecords(records);
    await recordUsage(mode === 'update' ? 'app_update' : 'app_install', appId, records[appId].version);
    return { ok: true, record: records[appId] };
  } catch (e) {
    return { error: 'install_failed', message: (e && e.message) || 'Could not install.' };
  }
});

ipcMain.handle('hub:installed', async () => installedApps());

ipcMain.handle('hub:launch', async (event, appId) => {
  const records = await installedApps();
  const r = records[appId];
  if (!r) return { error: 'not_installed' };
  if (r.kind === 'plugin') return { error: 'plugin', message: r.name + ' is a plug-in: open it inside your DAW.' };
  if (!r.exe || !exists(r.exe)) return { error: 'no_launcher', message: 'Nothing to open was found for ' + r.name + '. Open it from your system as usual.' };
  try {
    if (isMac) await run('open', ['-a', r.exe]);
    else { const child = spawn(r.exe, [], { cwd: path.dirname(r.exe), detached: true, stdio: 'ignore' }); child.unref(); }
    await recordUsage('app_open', appId, r.version);
    return { ok: true };
  } catch (e) { return { error: 'launch_failed', message: e.message }; }
});

ipcMain.handle('hub:uninstall', async (event, appId) => {
  const records = await installedApps();
  const r = records[appId];
  if (!r) return { ok: true };
  if (r.kind === 'portable' && r.dir && r.dir.startsWith(paths.installRoot())) {
    await fsp.rm(r.dir, { recursive: true, force: true });
  } else if (isWin) {
    shell.openExternal('ms-settings:appsfeatures');
  } else if (isMac) {
    shell.openPath(path.join(os.homedir(), 'Applications'));
  }
  delete records[appId];
  await writeRecords(records);
  return { ok: true, removedFiles: r.kind === 'portable' };
});

ipcMain.handle('hub:reveal', async (event, which) => {
  const p = which === 'apps' ? paths.installRoot() : paths.downloads();
  await fsp.mkdir(p, { recursive: true });
  shell.openPath(p);
  return { ok: true, path: p };
});

ipcMain.handle('hub:site', async (event, { path: pathname, method, token, body }) => {
  if (!/^\/[a-z0-9\/_-]*$/i.test(pathname || '')) return { ok: false, status: 0, json: null };
  return siteRequest(pathname, { method, token, body });
});

// HUB_PLATFORM=windows|mac lets the interface be exercised on a machine
// that is neither (the automated checks run on Linux); it changes what
// the page offers, not what the installer steps above can do.
const shownPlatform = ['windows', 'mac'].includes(process.env.HUB_PLATFORM) ? process.env.HUB_PLATFORM : (isWin ? 'windows' : isMac ? 'mac' : 'linux');
ipcMain.handle('hub:device', async () => ({
  hostname: os.hostname(),
  platform: shownPlatform,
  arch: process.arch,
  os: shownPlatform === 'windows' ? 'Windows' : shownPlatform === 'mac' ? 'macOS' : 'Linux',
  release: os.release(),
  paths: { downloads: paths.downloads(), apps: paths.installRoot() },
}));

ipcMain.handle('hub:external', async (event, url) => {
  if (/^https?:\/\//i.test(url)) { await shell.openExternal(url); return { ok: true }; }
  return { ok: false };
});

/* The page owns the sending: it is the side with the account and the
   connection. Main owns the writing, so a note survives a crash and a
   week with no network. take() hands over a copy; ack(n) is what
   removes those n, and only the page's own success calls it. */
ipcMain.handle('hub:usage-state', async () => {
  const u = await readUsage();
  return { installId: u.installId, consent: u.consent, decidedAt: u.decidedAt, pending: u.queue.length };
});

ipcMain.handle('hub:usage-consent', async (event, yes) => {
  const u = await readUsage();
  u.consent = !!yes;
  u.decidedAt = new Date().toISOString();
  if (!yes) u.queue = []; // no is retrospective: what was waiting is dropped
  await writeUsage(u);
  return { consent: u.consent, pending: u.queue.length };
});

ipcMain.handle('hub:usage-record', async (event, { event: name, app: appId, version }) => {
  await recordUsage(name, appId, version);
  return { ok: true };
});

ipcMain.handle('hub:usage-take', async (event, max) => {
  const u = await readUsage();
  if (u.consent !== true) return { installId: u.installId, events: [] };
  return { installId: u.installId, events: u.queue.slice(0, Math.min(max || 100, 100)) };
});

ipcMain.handle('hub:usage-ack', async (event, n) => {
  const u = await readUsage();
  u.queue = u.queue.slice(Math.max(0, n | 0));
  await writeUsage(u);
  return { pending: u.queue.length };
});

ipcMain.handle('hub:confirm', async (event, { title, message, ok }) => {
  const r = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: [ok || 'Continue', 'Cancel'], defaultId: 0, cancelId: 1, title, message });
  return r.response === 0;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  // a cold start from the link itself, on Windows and Linux
  const link = process.argv.find((a) => a.startsWith(PROTOCOL + '://'));
  if (link) handleDeepLink(link);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
