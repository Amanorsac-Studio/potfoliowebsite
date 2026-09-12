# AMANORSAC STUDIO — Product Build Standard

**Version 2.0 · September 2026 · Supersedes the one-page 1.0 of 3 September.**

The engineering standard for an Amanorsac Studio product. Read with
`01_AMANORSAC_STUDIO_MASTER_STANDARD.md`, which says what the platform
provides and what the brand rules are. This document is about the build.

**MUST** is a requirement: a build that fails one is sent back.
**SHOULD** is a strong default: depart from it and say why in writing.

Every requirement here is numbered so a review can pass or fail it by
number. §10 and §11 are the start and end audits — the two points at
which this document is actually used.

---

## 1. The real-time audio thread

The rule that separates working audio software from software that clicks.

| # | Requirement |
|---|---|
| B1 | **MUST NOT** allocate or free memory on the audio thread. Every buffer is sized in `prepareToPlay` or its equivalent. |
| B2 | **MUST NOT** take a lock the UI or a network thread can hold. Cross-thread state moves by atomics, a lock-free FIFO, or a double buffer swapped by an atomic pointer. |
| B3 | **MUST NOT** do file or network I/O, log, or touch the UI from the audio thread. |
| B4 | **MUST NOT** contain an unbounded loop. Every iteration count is a function of the block size or a fixed maximum. |
| B5 | **MUST** be denormal-safe: flush-to-zero set, or denormals avoided by construction. A filter that decays into denormals costs more CPU than the plug-in does. |
| B6 | **MUST** survive a sample-rate or block-size change at any time, including a block size of 1 and a block larger than the host's stated maximum. |
| B7 | **MUST** produce bit-identical output for identical input and parameters at a given sample rate. Nothing on the audio path depends on wall-clock time or an uninitialised value. |

---

## 2. Plug-in behaviour

This is the part most often skipped, and it is where the support email
comes from. Every item below is a bug class that has shipped in
commercial plug-ins.

| # | Requirement |
|---|---|
| B8 | **MUST** save and restore complete state. Close the project, reopen it, and every control, preset name and internal mode is exactly as it was. |
| B9 | **MUST** keep parameter identifiers stable for the life of the product. A saved session made with version 1.0 must load correctly in every later version. Add parameters; never renumber or reuse an identifier. |
| B10 | **MUST** report its latency to the host if it has any, and update the report if the latency changes. |
| B11 | **MUST** honour host bypass: silent-but-passing audio, delay-compensated, with no click on entering or leaving bypass. |
| B12 | **MUST** render correctly offline, faster than real time, during a bounce or export. A product that only works while playing live is broken. |
| B13 | **MUST** work with several instances in one project, on different sample rates across projects, and with its editor closed. |
| B14 | **MUST** pass **pluginval** at strictness level 8 or higher on Windows, and `auval` on macOS for any AU build. Attach both outputs to the delivery. |
| B15 | **MUST** be loaded and used in at least two real hosts before delivery, one of which is not the developer's daily DAW. Name them in the delivery. A format that "compiles and should work" has never worked. |
| B16 | **SHOULD** be tested in the host the product is aimed at. A product described as "made for Studio One" is tested in Studio One. |

---

## 3. Performance budget

State the measured numbers in the delivery. There is no single pass mark
across such different products, but an unmeasured product cannot be
judged at all.

| # | Requirement |
|---|---|
| B17 | **MUST** report measured CPU for one instance at 48 kHz and a 128-sample block, on a machine you name. |
| B18 | **MUST** report steady-state memory for one instance, and for the largest library or preset the product can load. |
| B19 | **SHOULD** hold the editor at 60 frames per second on a five-year-old integrated GPU, and **MUST NOT** consume CPU for animation while the editor is closed. |
| B20 | **MUST NOT** grow in memory over an hour of continuous playback. Run it for an hour and watch. |

---

## 4. Interface and accessibility

The behaviour contract is in Master Standard §6. These are the checkable
parts.

| # | Requirement |
|---|---|
| B21 | **MUST** be fully operable by keyboard, in a sensible tab order. |
| B22 | **MUST** show a visible focus indicator on every focusable control. This is the single most commonly missing state across the portfolio. |
| B23 | **MUST** give every control hover, pressed, active, disabled and error states where each applies. |
| B24 | **MUST** meet 4.5:1 text contrast, and 3:1 for large display text. Check the accent colour on the panel colour — that is where it fails. |
| B25 | **MUST** give every control an accessible name. An icon-only button needs a label. |
| B26 | **MUST** honour `prefers-reduced-motion` or the OS equivalent for any animation that is decorative. |
| B27 | **MUST NOT** use colour as the only carrier of meaning. |
| B28 | **MUST** be usable at the smallest editor size the product allows, and at 125%, 150% and 200% OS scaling. |

---

## 5. Identity

| # | Requirement |
|---|---|
| B29 | **MUST** name Amanorsac Studio as the manufacturer in the plug-in's metadata, the installer's metadata, and the package or bundle identifier. |
| B30 | **MUST NOT** contain the string `Aquarii` anywhere: not in a path, an identifier, a metadata field or a comment. |
| B31 | **MUST** ship an About screen carrying the product name and version, the Amanorsac Studio lockup, links to `amanorsac.studio/legal` and `amanorsac.studio/privacy`, `hello@amanorsac.studio`, the licence status with a **Deactivate this device** button where the product is licensed, and third-party notices. |
| B32 | **MUST** use a stable manufacturer code and a unique plug-in code, both confirmed with the studio before the first release. Changing either afterwards breaks every saved session. |

---

## 6. Versions and releases

| # | Requirement |
|---|---|
| B33 | **MUST** use `MAJOR.MINOR.PATCH`, three parts, always. `2.0` is not a version string; `2.0.0` is. The live catalog carries a few two-part versions from before this rule and they are being normalised. |
| B34 | **MUST** report the same version in the plug-in, the installer, the About screen and the delivery note. One of them disagreeing is how a customer gets told they have the wrong build. |
| B35 | **MUST** keep a `CHANGELOG.md`, written for a customer, not a commit log. |
| B36 | **MUST NOT** implement a version check, an updater, or a "new version available" notice. Amanorsac Hub does installation and updates for every product. |
| B37 | **MUST** ship the installer signed on Windows and signed, notarised and stapled on macOS, and **MUST** be verified from a download in a browser rather than a local build. |

---

## 7. Secrets and supply chain

| # | Requirement |
|---|---|
| B38 | **MUST NOT** contain a secret in source, a log, a binary or a build script. The only key that belongs in a product is the **public** licence key from the License Integration Standard. |
| B39 | **MUST** keep a `THIRD_PARTY_NOTICES` file listing every dependency and its licence. |
| B40 | **MUST** flag any dependency whose licence restricts commercial use, or requires source disclosure, **before** it is linked. A non-commercial dependency found after release is a recall. |
| B41 | **MUST** pin every dependency to a version. No floating tags on a release branch. |
| B42 | **MUST** use TLS for every network request, with certificate validation on. Never disable verification, not even for a development server. |

---

## 8. Privacy

Restating the rule from Master Standard §7 because it is a build
requirement, not a policy preference. The privacy policy is published at
`amanorsac.studio/privacy`, so breaking one of these makes a public
document false.

| # | Requirement |
|---|---|
| B43 | **MUST NOT** send, upload, stream or analyse the user's audio anywhere off their machine. |
| B44 | **MUST NOT** read, index or report on sessions, projects or presets. |
| B45 | **MUST NOT** contain analytics, telemetry or usage counting of any kind. |
| B46 | **MUST NOT** make any network request other than licensing. A product with no licensing makes none at all. |
| B47 | **MUST** use a random device id generated on first run — never a hardware serial, a MAC address or anything personal. |

---

## 9. Files, data and the repository

Paths are fixed by `04_AMANORSAC_FOLDER_STRUCTURE.md`.

| # | Requirement |
|---|---|
| B48 | **MUST** write user content only to `Documents/Amanorsac Studio/<Product>/` and machine state only to the platform's application-support folder for `Amanorsac Studio/<Product>/`. |
| B49 | **MUST NOT** write beside the binary, under `Program Files`, at the root of a drive, or into another product's folder. |
| B50 | **MUST** survive its own data being missing, truncated or corrupt: fall back to defaults, never crash, and never interrupt audio. |
| B51 | **SHOULD** lay the repository out as `/src`, `/tests`, `/assets`, `/scripts`, `/third_party`, `/release`, `/docs`, with `README.md`, `CHANGELOG.md`, `LICENSE`, `THIRD_PARTY_NOTICES` and `SECURITY.md` at the root. |
| B52 | **SHOULD** record design decisions in `/docs/decisions.md` — what was chosen and what it was chosen over. This is how the next person avoids undoing it. |

---

## 10. Start audit — before the first line of code

Agree all of this in writing with the studio. It takes one message and
prevents most of what goes wrong later.

1. Product name, and the **app id and key prefix** as assigned by the studio.
2. Platforms, plug-in formats, and the minimum OS version for each.
3. **Licensed or unlicensed**, and whether it is a bundle. If a bundle, the list of plug-ins.
4. Manufacturer and plug-in codes (B32).
5. The target host, and the two hosts it will be validated in (B15).
6. Where the product's data lives, by exact path (B48).
7. Every third-party dependency and its licence (B39, B40).
8. What the product does **not** do — the scope you are not building.
9. Anything in this document you intend to depart from, and why.

---

## 11. End audit — before delivery

Every line answered, attached to the build. An unanswered line is an
incomplete delivery.

| Check | Evidence to attach |
|---|---|
| Audio thread clean (B1–B7) | A statement of how cross-thread state moves, and the denormal handling |
| State save and restore (B8, B9) | Close and reopen a project in each validated host; confirm total recall |
| Bypass, latency, offline render (B10–B12) | Confirmed in each validated host |
| Multiple instances, editor closed (B13) | Confirmed |
| pluginval ≥ 8, auval (B14) | The full output of each |
| Two real hosts (B15, B16) | Names and versions |
| Performance (B17–B20) | The measured numbers and the machine they were measured on |
| Accessibility (B21–B28) | A pass or fail per line, not a general assurance |
| Identity and About screen (B29–B32) | A screenshot of the About screen |
| Versions agree (B33, B34) | The version string as it appears in all four places |
| No updater (B36) | Confirmed |
| Signed and notarised (B37) | Verified from a browser download, on a machine that never built it |
| Secrets and dependencies (B38–B42) | `THIRD_PARTY_NOTICES`, and confirmation of no commercial-use restriction |
| Privacy (B43–B47) | A statement of every network request the product can make |
| Data paths (B48–B50) | The exact paths, and behaviour with the data deleted |
| Licensing | The A1–A12 report from the License Integration Standard §9, or the written statement that the product ships unlicensed |

Sign-off is the studio's, against this list. Nothing goes on sale with an
open line on it.
