# AMANORSAC STUDIO — File & Data Conventions

**Version 2.0 · September 2026 · Supersedes the 2026-09-04 folder standard.**

Where things live: on the studio's machines, and — the part that binds
your build — where a **shipped product** is allowed to read and write.

The previous edition was mostly a map of one computer. This one keeps
only the conventions a build has to obey, because those are the ones that
break a customer's installation when they are ignored.

---

## 1. What a shipped product may write, and where

**Two locations. Nothing anywhere else.**

### 1.1 The user's own content

```
Windows   %USERPROFILE%\Documents\Amanorsac Studio\<Product>\
macOS     ~/Documents/Amanorsac Studio/<Product>/
```

User presets, libraries, recordings, exports, anything the customer would
expect to find, copy or back up. One folder per product, named as the
product is named. A product reads and writes **only its own folder** and
never another product's.

### 1.2 Machine state

```
Windows   %LOCALAPPDATA%\Amanorsac Studio\<Product>\
macOS     ~/Library/Application Support/Amanorsac Studio/<Product>/
```

The device id, the encrypted licence key and proof, caches, window
positions, logs. Things a customer would not miss if they were deleted,
and would not want in Documents.

Three filenames in here are fixed by the License Integration Standard:
`device.id` (plain), `license-key.dat` (encrypted), `license-proof.dat`
(encrypted). For a **bundle**, every plug-in shares one folder, one
device id and one proof — one machine is one seat, never one per plug-in.

### 1.3 Not allowed

- Anywhere under `Program Files`, or beside the plug-in binary.
- The registry, beyond what an installer legitimately needs.
- A folder at the root of `C:\`.
- `Aquarii Audio` in any path. If an older build wrote there, migrate it
  on first run and stop using it.
- Another product's folder, for any reason.

---

## 2. Naming

- **Product name** as the studio writes it, spaces and all: `AMB Analog`,
  `Align Pro`, `Nebula Tide 2`. This is what appears in a path, an
  installer and an About screen.
- **App id** is lowercase, letters only, no spaces: `ambanalog`,
  `alignpro`, `nebulatide2`. It is the key in the store catalog and the
  source of the licence-key prefix, and **the studio assigns it.** It is
  not always the obvious contraction of the product name — the prefix is
  four letters that get printed on a customer's key, and some
  contractions are not printable. Ask rather than assume.
- **Installer filenames** are agreed with the studio at delivery and then
  fixed, because the store looks a file up by name. A file uploaded under
  a different name than the catalog expects is invisible to the site, and
  that has already caused one release to hand out the previous version.
  Do not rename an installer after delivery without telling the studio.

---

## 3. The studio's own layout

Useful if you are handed a machine or a repository, not something a
shipped product touches.

```
C:\Amanorsac Studio\            source code, everything that gets built
│
├── _shared\                    company-level. Read from it; write to it only
│   ├── standards\              when the task IS "change the standard"
│   ├── ui-kit\
│   ├── brand\                  logo files, fonts to bundle, palette tokens
│   └── licensing\
│
├── sdks\                       JUCE, ARA and friends, if centralised
├── products\<product>\         one folder per product
└── archive\                    retired and superseded work
```

```
Documents\Amanorsac Studio\     everything that is not source code
│
├── Briefs\                     one-page brief per product
├── Standards\                  a readable copy of this pack
├── Brand\                      design sources: AI, Figma, PSD
├── Legal\                      contracts, licence inventories, trademark notes
├── <Product>\                  runtime data, per §1.1 — what the app writes
└── Archive\
```

**The rule for an agent or a developer working in `products\<x>\`:** read
from `_shared\` and from your own product folder. Never read another
product's folder. Never write into `_shared\` unless the task is
explicitly to change the shared standard or kit — that is a deliberate
cross-product decision, not a side effect of one build.

---

## 4. Third-party SDKs

Leave existing per-repository JUCE and ARA references where they are.
Centralising a build dependency is a decision to take once, on purpose,
with a check of everything that points at it. A half-migrated SDK is
worse than either arrangement.

---

## 5. What you send the studio for a release

Not a folder to copy. A short list, so the catalog entry can be written
in one pass:

1. The installers, one per platform, signed and notarised, with their
   **exact filenames and byte sizes**.
2. The app id, the display name and the version string, exactly as they
   should appear.
3. The platforms and plugin formats.
4. Screenshots of the running product, full resolution, unscaled and
   uncropped. The store frames them itself; a picture that has already
   been resized once cannot be un-resized.
5. The icon, as vector if it exists.
6. The licensing acceptance report, or the statement that the product
   ships unlicensed.
