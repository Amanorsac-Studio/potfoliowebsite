# Amanorsac Hub · desktop app

The Hub launcher (`app/index.html`) packaged as a native desktop app for
Windows and macOS with [Electron](https://www.electronjs.org/) and
[electron-builder](https://www.electron.build/).

The page is entirely self-contained: fonts and artwork are inlined and
nothing is fetched from the network. `main.js` opens a frameless window
for it (the page draws its own title bar; the OS overlays the real
window controls), keeps navigation inside the app, and sends outside
links (the website, help) to your default browser.

## Run it locally

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
cd hub
npm install
npm start
```

## Build the Windows installer (on Windows)

```bash
cd hub
npm install
npm run build:win
```

Output in `hub/dist/`:

| File | What it is |
| --- | --- |
| `Amanorsac Hub-1.0.0-win-x64.exe` | Installer (choose install folder, desktop shortcut) |
| `Amanorsac Hub-1.0.0-win-x64.exe` in `portable` form | Runs without installing |

Windows SmartScreen will warn about an unsigned app the first time
("More info" → "Run anyway"). Code signing needs a certificate; when you
have one, set `CSC_LINK` and `CSC_KEY_PASSWORD` and electron-builder signs
automatically.

## Build for macOS (GitHub Actions)

A Mac is required to build the Mac app, so that is done by the
`Hub desktop app` workflow in `.github/workflows/hub-desktop.yml`:

- **Every push touching `hub/`** builds Windows and macOS installers and
  attaches them to the workflow run as artifacts (Actions tab → the run →
  Artifacts). Or run it by hand: Actions → Hub desktop app → Run workflow.
- **Pushing a tag `hub-v1.0.0`** (matching the version in `package.json`)
  also publishes them on a GitHub Release:

  ```bash
  git tag hub-v1.0.0
  git push origin hub-v1.0.0
  ```

macOS output: a `.dmg` and a `.zip` each for Apple Silicon (`arm64`) and
Intel (`x64`).

The Mac build is unsigned. On first launch macOS says the developer
cannot be verified: right-click the app → **Open**, or

```bash
xattr -dr com.apple.quarantine "/Applications/Amanorsac Hub.app"
```

Signing and notarising needs an Apple Developer account. Add the secrets
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
and `APPLE_TEAM_ID` to the repository and delete the
`CSC_IDENTITY_AUTO_DISCOVERY` line from the workflow.

## Layout

```
hub/
  app/index.html   the Hub interface (single file)
  main.js          Electron main process: window, menu, external links
  preload.js       tells the page which platform/version it runs on
  build/icon.png   1024×1024 source icon; .ico / .icns are generated from it
  package.json     app metadata and electron-builder configuration
```

## Releasing a new version

1. Bump `version` in `package.json`.
2. Commit, then tag `hub-v<version>` and push the tag.
