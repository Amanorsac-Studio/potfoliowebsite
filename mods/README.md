# Studio mods

Claude Code mods for the release flow in `docs/release-standard.md`.

| Mod | Goes in | Adds |
|---|---|---|
| `app-release` | every app repo | `/release <version>`, `/release upload`, `/release status` |
| `release-receiver` | this website repo | `/receive`, `/receive list`, `/receive <app> <version>` |

## Install (in a terminal Claude Code session, inside the repo)

App repo:

```
/plugin install app-release --marketplace Amanorsac-Studio/potfoliowebsite
```

Answer `y` to add the marketplace, choose a scope (project, so it travels with the repo), then set
**Catalog id** to the app's id in `catalog.json` (`chordlight88`, `nebulatide2`, ...). Leave the
remote as `r2` and the bucket as `amanorsac-downloads` unless they differ on that machine.

Website repo:

```
/plugin install release-receiver --marketplace Amanorsac-Studio/potfoliowebsite
```

Both need `rclone` configured with the `r2:` remote, and the app repo needs `gh` signed in.

## The flow

1. In the app repo: build and test locally, push, let GitHub make the installers, tag the release.
2. `/release 2.0.4`: checks the version and the GitHub release, downloads and sums the installers,
   lays out `release/2.0.4/` with a `handoff.md` skeleton, and hands the model the recording,
   `/brag` and notes steps. The model stops for anything that needs your screen.
3. Read `handoff.md`. When it is right: `/release upload`. The package goes to
   `releases/<app>/<version>/` in R2, is listed back and byte-checked, and the website chat is told.
4. In the website chat: `/receive <app> <version>` pulls it down and hands over the notes. The model
   does the page work on the working branch, then asks for the price and the go-ahead.
5. Nothing goes live until both are answered.

## Developing

`claude plugin validate mods/<mod>` and `claude plugin test mods/<mod>`. Edit under `mods/` and run
`/reload-plugins` in a session that installed from this folder as a marketplace.
