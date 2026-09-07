# Amanorsac Hub · desktop app

The desktop companion to amanorsac.studio, for Windows and macOS: one
account, one library, one place to install, update and open the
Amanorsac apps, see license keys, manage device activations and look up
purchases. Built with [Electron](https://www.electronjs.org/) and
packaged with [electron-builder](https://www.electron.build/).

## What it reuses from the website

Nothing here has its own copy of account or ownership data. The Hub is a
second front end on the systems the site already runs:

| Concern | Where it lives | How the Hub uses it |
| --- | --- | --- |
| Sign in, create account, reset password | Supabase Auth, same project and publishable key as `assets/site-auth.js` | `supabase-js` in the page; sessions persist between launches |
| What the account owns | `public.purchases` under Row Level Security (`supabase-purchases.sql`, `supabase-licenses.sql`) | read directly; free apps claimed with `claim_license`, as My Apps does |
| License keys and devices | `purchases.license_key`, `public.device_activations`, `revoke_device()` | shown under License keys and My devices; Remove calls `revoke_device` |
| Downloads | the Worker's `POST /api/app-download` (ownership re-checked with the session token) and the signed ticket it returns | requested from the main process, downloaded with progress, then installed |
| Purchases and receipts | the same `purchases` rows | listed under Purchases, with the order id and license terms |
| The collection itself | `GET /api/hub/catalog`, built by `worker.js` from its own `INSTALLERS` table | fetched on every sync; `app/catalog.js` is the offline copy |

Availability therefore follows the website automatically: an app has a
Windows or Mac build in the Hub exactly when `INSTALLERS` in `worker.js`
has one, and apps without a build are shown as coming soon.

## Layout

```
hub/
  main.js          Electron main process: window, download, unpack, launch, uninstall
  preload.js       the bridge the page talks to (window.hub)
  app/index.html   the interface shell
  app/styles.css   the look: graphite surfaces, amber accent, Sora and Inter
  app/hub.js       the page: auth, library, downloads, updates, keys, devices, purchases
  app/catalog.js   offline copy of the collection (the Worker's copy wins)
  app/vendor/      supabase-js (UMD build, copied from node_modules)
  app/assets/      product artwork from the site
  build/icon.png   1024×1024 source icon; .ico / .icns are generated from it
```

Where things land on a customer's machine:

- downloaded installers: the Hub's user-data folder, `downloads/`
- apps the Hub unpacks from a `.zip`: `%LOCALAPPDATA%\Programs\Amanorsac\<App>` on Windows,
  `~/Applications/Amanorsac/<App>` on macOS
- apps that ship as a setup program (`.exe`, `.pkg`): wherever their installer puts them;
  the Hub records that it ran and points to the system uninstaller for removal

## Run it locally

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
cd hub
npm install
npm start
```

`HUB_PLATFORM=windows npm start` (or `mac`) makes the page behave as if
it were on that platform, which is how the interface is exercised on a
Linux build machine. It changes what is offered, not what can actually
be unpacked or launched.

## Build the Windows installer (on Windows)

```bash
cd hub
npm install
npm run build:win
```

`hub/dist/` then holds `Amanorsac Hub-<version>-win-x64.exe` (installer)
and `Amanorsac Hub-<version>-win-x64-portable.exe` (runs without
installing). Windows SmartScreen warns about an unsigned app the first
time: More info → Run anyway. With a code-signing certificate, set
`CSC_LINK` and `CSC_KEY_PASSWORD` and electron-builder signs on its own.

## Build for macOS (GitHub Actions)

A Mac is required to build the Mac app, so the `Hub desktop app`
workflow (`.github/workflows/hub-desktop.yml`) does it:

- every push touching `hub/` builds both platforms (artifacts are kept
  when the account's Actions storage quota allows);
- pushing a tag `hub-v<version>`, or running the workflow by hand with a
  release tag, publishes the installers on a GitHub Release: a `.dmg` and
  `.zip` each for Apple Silicon (`arm64`) and Intel (`x64`), plus the
  Windows installer and portable build.

The Mac build is unsigned. On first launch: right-click the app → Open, or

```bash
xattr -dr com.apple.quarantine "/Applications/Amanorsac Hub.app"
```

Signing and notarising needs an Apple Developer account: add
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
and `APPLE_TEAM_ID` as repository secrets and delete the
`CSC_IDENTITY_AUTO_DISCOVERY` line from the workflow.

## Releasing a new version

1. Bump `version` in `package.json`.
2. Commit, then either push a tag `hub-v<version>` or run the workflow by
   hand with that tag as the release tag.

## Deploying the Worker change

`worker.js` gained `GET /api/hub/catalog`. Until the Worker is deployed,
the Hub falls back to `app/catalog.js` and says so in its footer.
