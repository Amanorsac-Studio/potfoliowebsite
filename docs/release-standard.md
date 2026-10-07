# Amanorsac Studio — Release Standard

**Version 1.0 · October 2026 · Applies to every Amanorsac app, plug-in and plug-in bundle, paid or free.**

This is how a build becomes a release on amanorsac.studio. It sits beside
the License Integration Standard (`license-integration-for-developers.md`)
and the Hub notes (`hub-integration.md`). Those say what a build must do;
this says how a finished build reaches the website, the Hub and the
buyers, and what it must bring with it.

The words **MUST** and **MUST NOT** mark requirements. Everything else is
explanation.

**The one rule.** An app is not released until its repo has run
`/release` and the website chat has received the release package. Nothing
is pushed to R2 by hand, no page is written from memory, and no version
number is typed into `catalog.json` by anyone but the website's receiver.

---

## 1. How it works

1. The app is built and tested **on the studio's own computer**. That is
   where it is recorded: the app is launched, each main screen is
   captured, and a short recording of it in use is taken.
2. The repo is pushed to GitHub, and GitHub's build makes the **final
   installers** (the signed Windows installer, the notarized Mac disk
   images). Mobile apps get their screenshots from the repo's own store
   assets instead of a recording.
3. In the repo's Claude Code chat, `/release <version>` gathers the
   installers, the screenshots, the recording, the product video and the
   hand-off notes into one **release package**, uploads it to the studio's
   R2 bucket under `releases/<app>/<version>/`, and tells the website chat.
4. The website chat's receiver picks the package up. It puts the
   installers under the catalog's exact names and confirms they are in the
   bucket, converts the screenshots for the web, places the video on the
   app's page, updates the catalog version and the page's "What's new" from
   the notes, and pushes the result to the website's working branch.
5. **Nothing goes live on its own.** The website chat reports what
   changed and asks for two things: the go-ahead, and the price (or a
   confirmation that the price is unchanged). Only after both does it
   fast-forward `main`.

---

## 2. What a release package MUST contain

Everything lives under `releases/<app>/<version>/` in the
`amanorsac-downloads` bucket. `<app>` is the catalog id (`chordlight88`,
`nebulatide2`, …) and `<version>` is the plain version (`2.0.4`).

| Path | What | Rule |
|---|---|---|
| `handoff.md` | the hand-off notes, §3 | MUST be present and complete |
| `installers/` | the final installers from GitHub, one per platform | MUST be the GitHub build's own files, not a local build; names as they came off the build |
| `screenshots/NN-<what>.png` | each main screen, numbered in the order a new user meets them | MUST be the real app, at its real size, no placeholder text, no developer paths on screen |
| `recording.mp4` | 30–90 seconds of the app in use, no narration, system audio only if the app makes sound | desktop apps MUST; mobile apps MAY |
| `brag/brag.mp4`, `brag/brag.jpg`, `brag/share-copy.txt` | the product video, its poster, the caption | MUST, made by `/brag` from the repo (§5) |

A package missing a MUST is not picked up; the receiver says what is
missing and waits.

---

## 3. The hand-off notes (`handoff.md`)

Written by the app's chat, read by the website's. Plain headings, no
prose padding. These sections, in this order:

```
# <App name> <version>

## Release
- app: <catalog id>
- version: <x.y.z>
- date: <YYYY-MM-DD>
- platforms: windows, mac-arm64, mac-x64   (or: windows, mac / android / ios)
- licensed: yes | no        (does this build ask for a key, per the licence standard)
- free: yes | no
- price: unchanged | <ask>   (the price is the studio's call; say "unchanged" or "ask")

## What's new
- one line per change a buyer would notice, in their words, most important first
- (an update email goes out only if the section below says so)

## Email owners
yes | no
<one sentence for the email, if yes>

## Installers
| platform  | file                              | bytes      | sha256 |
| windows   | ChordLight-88-2.0.4-Windows.exe   | 136092949  | …      |
| mac-arm64 | ChordLight-88-2.0.4-macOS-arm64.dmg | …        | …      |

## Screenshots
| file                 | shows                                   |
| 01-home.png          | Home: the drop zone and the library     |

## Website
- anything the page must say differently now (a renamed feature, a removed one, a new requirement)
- anything that MUST NOT appear in public yet (a name not cleared, a feature held back)

## Known issues
- what a buyer might hit, and what to tell them
```

The receiver reads `version`, `platforms`, `licensed`, `free` and the
Installers table mechanically. Everything else it reads as a person
would and turns into the page.

---

## 4. The `/release` command (in every app repo)

The repo's Claude Code mod registers `/release`. Given `/release 2.0.4`
it MUST, in order:

1. **Check the build.** Confirm the version in the code matches, the
   GitHub build for that tag succeeded, and the installers exist. Stop and
   say so if not.
2. **Fetch the installers** from the GitHub release (or the workflow's
   artifacts) into `release/<version>/installers/`. Record size and
   sha256 for each.
3. **Record the app** (desktop apps, on the studio's computer): launch the
   built app, capture every main screen to `screenshots/`, and record
   30–90 seconds of use to `recording.mp4`. Mobile apps: copy the store
   screenshots from the repo instead.
4. **Make the product video**: run `/brag` on the repo with the screenshots
   and recording as its material, into `brag/`. The brag video MUST use
   the real screens, never a mock-up.
5. **Write `handoff.md`** (§3) from the commit log since the last release
   and the repo's own README, then show it to the person for a read before
   it goes anywhere.
6. **Upload** the package to `r2:amanorsac-downloads/releases/<app>/<version>/`
   with rclone, then list the folder back and compare bytes to what was
   sent. Stop if anything differs.
7. **Tell the website chat**: send one message naming the app, the
   version and the R2 path. That message is the hand-off.

It MUST NOT upload anything under `<app>/` (the folder the catalog serves
from). That folder is the receiver's alone.

---

## 5. Product video and screenshots

`/brag` (github.com/latent-spaces/brag) is the studio's product-video
tool. Each release package carries a brag video so the page, the
announcement and the socials have something to show on day one.

- The video MUST be built from the release's own screenshots and
  recording, so what it shows is the build being shipped.
- 18–25 seconds, landscape 1920×1080. A vertical cut MAY be added as
  `brag/brag-vertical.mp4`.
- Every line on screen MUST be the app's own wording (its README, its
  page, its UI). No invented numbers, claims or testimonials.
- Nothing in the recording or screenshots may show a developer path, a
  licence key, an email address or test data a buyer would recognise as
  fake.
- Music is the mod's own or the studio's; nothing licensed from a library
  without the licence saved beside it.

---

## 6. What the website's receiver does with it

On the hand-off message, the website chat MUST:

1. Read `handoff.md`. Refuse the package, naming the gap, if §2 is not met.
2. Copy each installer to its catalog name under `<app>/` and list the
   bucket back. Only after the listing shows the files with the right
   byte counts does `catalog.json` change. The previous version's keys
   stay as `alt_keys`.
3. Convert screenshots to webp at 1600 and 800 wide into
   `images/apps/<app>/`, place the brag video in `video/`, and put the
   video on the page the way the Easy Stems page does: muted, looped, no
   controls, playing only while on screen.
4. Set the catalog `version`, add a "New in <version>" section to the page
   from What's new, add a `news` entry, and add a `notice` block only if
   `Email owners` says yes.
5. Push to the working branch and run the site checks.
6. Report to the person: what changed, the price question, and the
   go-ahead question. Fast-forward `main` only when both are answered.

It MUST NOT set a price, change a status to available, or push `main`
without those answers.

---

## 7. Checklist, one line each

- [ ] built and tested on the studio's computer
- [ ] pushed; GitHub build green; installers downloaded from that build
- [ ] screenshots of every main screen, real data, nothing private on screen
- [ ] recording made (desktop) or store screenshots copied (mobile)
- [ ] `/brag` run from the repo; video, poster and caption in `brag/`
- [ ] `handoff.md` written and read through
- [ ] package in `releases/<app>/<version>/`, listed back, bytes match
- [ ] website chat told
- [ ] website chat's report read; price given; go-ahead given
