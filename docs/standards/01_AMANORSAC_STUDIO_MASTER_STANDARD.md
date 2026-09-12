# AMANORSAC STUDIO — Master Standard

**Version 2.0 · September 2026 · Supersedes the 2026-09-04 edition.**

This is the document sent to every developer building an Amanorsac Studio
product, at the start of the work and again before delivery. It says what
the company is, what the platform already does for you, what you are
responsible for, and the standards a build has to meet to be accepted.

It is deliberately short. Everything in it is either a rule you must
follow or a fact you need in order to follow one.

**What changed in version 2.0.** The previous edition was written when
none of the company infrastructure existed and every product was
expected to solve accounts, licensing, payment and delivery for itself.
All of that is now built, live and proven. Most of the old document was a
list of things to build; this one is a list of things you may rely on.

---

## 0. How to use this pack

| Document | Read it |
|---|---|
| **01 Master Standard** (this file) | Before you write a line |
| **02 Product Build Standard** | Before you write a line |
| **03 Launch Readiness** | Once, for context on where the company is |
| **04 File & Data Conventions** | When you decide where anything is written |
| **License Integration Standard** | Before you touch licensing, and again before delivery |

At the **start** of a build, confirm in writing: the product name, the app
id, the platforms, the plugin formats, whether it is licensed or free, and
whether it is a single product or a bundle. The studio needs those to
create the catalog entry and the key prefix.

At the **finish**, deliver what §10 of this document lists. A build that
arrives without the licensing acceptance report is not a delivery.

---

## 1. What Amanorsac Studio is

Amanorsac Studio is Stephen Amanor Sackey's studio in Charlottesville,
Virginia. It does three things:

- **Records and mixes music.** Mixing, mastering, worship music direction,
  songwriting. This is the work the software exists to serve.
- **Builds audio software.** Plug-ins, standalones and desktop apps sold
  and given away at amanorsac.studio.
- **Runs the platform** those products are sold through: the store, the
  accounts, the licence server, the downloads and Amanorsac Hub.

Every product ships under the one name. There is no sub-brand, no label,
no second identity. **"Aquarii Audio" is retired** and must not appear in
a product identity string, an installer, a storage path, an About screen
or any customer-facing text. If you are working from an older codebase
that still carries it, removing it is part of the job.

The tone of the whole company is the same in software as it is in the
studio: say what the thing does, show the real interface, don't oversell.
Every control does something. Nothing is decoration.

---

## 2. What the studio already provides

**Do not build any of this. It exists, it is live, and a second
implementation is a bug.**

| Capability | What you can rely on |
|---|---|
| **Accounts** | One Amanorsac account covers the website, My Apps and Amanorsac Hub. Email and password, hosted on Supabase. Your app never handles a password and never shows a sign-in form. |
| **Licensing** | A live licence server at `https://amanorsac.studio`. ECDSA P-256 signed proofs, two devices per key by default, 30-day offline grace. Fully specified in the License Integration Standard. |
| **Payment** | Stripe Checkout, driven by the store. Your app never sees a price, a card or a payment. |
| **Store page** | The studio writes and hosts the product page, the screenshots, the copy and the structured data. You supply the assets and the facts. |
| **Downloads** | Installers live in the studio's object storage and are served through signed, expiring links tied to the buyer's account. You upload a file; the studio wires the rest. |
| **Installation and updates** | Amanorsac Hub installs, updates and opens every product from one place. **Your product does not need its own updater or version check.** |
| **Legal** | One EULA, one Terms of Service and one Privacy Policy cover every product: `amanorsac.studio/legal` and `amanorsac.studio/privacy`. Do not write your own. Link to those. |
| **Support** | One address, `hello@amanorsac.studio`. Put it in the About screen and nowhere else. |
| **Reviews and download counts** | Handled by the store. Your app does not collect feedback. |

---

## 3. What you provide

- The product itself: DSP, engine, interface, file formats, presets.
- An installer per platform, signed and notarised (§9).
- Licensing integrated exactly as the License Integration Standard says,
  or a written statement that the product ships with no licensing.
- An About screen (§6).
- The assets and facts the store page needs: real screenshots of the
  running product at full resolution, an icon, the version number, the
  formats, the platforms, the system requirements, and a short honest
  description of what it does.
- The acceptance report from §9 of the License Integration Standard.

---

## 4. Brand: what is fixed, what is yours

**Permanently Amanorsac. Not yours to change.**

- The company name, the logo lockup and the wordmark.
- The account system, the licensing model and the legal documents.
- The installer and About-screen layout, and the signing identity.
- The data path convention: `Documents/Amanorsac Studio/<Product>/` (see doc 04).
- The behaviour contract of the shared UI primitives (§6) — the states a
  control has and how it responds, not the colour of it.

**Yours.**

- The product's accent colour and palette.
- Its character. The portfolio deliberately does not look uniform:
  AMB Analog is photoreal hardware, Align Pro is a measurement tool,
  AETHER is clinical and bright, Nebula Tide is cinematic, SecondOut is a
  broadcast monitor. That range is intentional.
- Its DSP, its engine architecture and its file formats.

The rule throughout: **standardise the skeleton, keep the skin.**

**Logo use, until a full usage guide exists.** Use the supplied lockup
only on black or near-black, at header, splash or About-screen scale.
Never shrink it below the size where "STUDIO" is legible. Never recolour
the wordmark. Never put a product's accent colour inside the logo.

---

## 5. Type and colour

- **Interface and body text:** Inter.
- **Numbers, meters, technical readouts:** JetBrains Mono.
- **Display and headings:** the product may choose its own face for
  character. Company chrome (About screen, installer) uses Inter.

**Ship every font inside the product.** Never fetch a font from a CDN at
runtime. The website already serves its own fonts locally for this exact
reason: a runtime font request is an offline failure, a privacy leak and a
delay on first paint, all at once.

**Colour is defined by role, not by hex.** Fill these tokens with your own
palette: `bg`, `panel`, `raised`, `border`, `accent`, `accent-secondary`,
`text-primary`, `text-muted`, `success`, `warning`, `danger`. Every
product in the portfolio independently landed on a near-black ground with
one or two accents. That convergence is the company's visual identity;
there is no company hex value to match.

---

## 6. The shared interface contract

These are the behaviours a control must have. They are a contract, not yet
a shipped library — write your own implementation, match the behaviour.

- **Knob:** drag, scroll wheel and keyboard. Value arc. Double-click
  resets to default. Shift gives fine adjustment.
- **Fader:** linear, dB-aware where it represents level. No allocation in
  the render path.
- **Dropdown:** styled by the product. Never the native OS control.
- **Tabs:** a segmented control with an accent underline or fill.
- **Toast:** timed, non-blocking, 1.5 to 3 seconds.
- **Modal:** one dismiss pattern, backdrop separated from the page behind.
- **States on everything:** hover, pressed, active, disabled, and
  **focus-visible**. Focus is the state most often missing across the
  portfolio. A control you can reach by keyboard and cannot see is a bug.
- **Settings:** one gear, one surface.
- **About screen:** required in every product. It carries the product
  name and version, the Amanorsac Studio lockup, a link to
  `amanorsac.studio/legal` and `amanorsac.studio/privacy`, the support
  address, the licence status with a **Deactivate this device** button
  where the product is licensed, and the third-party and open-source
  notices for anything you linked.

---

## 7. Privacy: the promise your build must not break

The studio publishes a privacy policy at **`amanorsac.studio/privacy`**
and it makes specific promises about what a product does. Those promises
are now public. A build that breaks one makes the company's published
policy false, which is a far worse problem than a missing feature.

**What your product may send:**

- The licence key and its device id, to the licence server, exactly as the
  License Integration Standard specifies. Nothing else.

**What your product must never do:**

- Send, upload, stream or analyse the user's audio anywhere off their
  machine.
- Read, index or report on their sessions, projects or presets.
- Carry analytics of any kind. Which controls were touched, which presets
  were loaded, how long the product was open, how often it was opened:
  none of it is collected, and the policy says so.
- Collect a location, a contact, a browsing history or an advertising
  identifier.
- Use a hardware serial, a MAC address or anything else personal as the
  device id. It is a random value generated on first run (R6).
- Phone home for any reason other than licensing. A product with no
  licensing makes no network requests at all.

If a product genuinely needs to send something new, that is a change to
the published policy and a decision for the studio, before you build it.

---

## 8. Accessibility baseline

Not optional, and cheap if you do it as you go rather than at the end.

- Every control reachable by keyboard, in a sensible order.
- A visible focus indicator on every focusable thing.
- Text contrast at least 4.5:1 against its background; large display text
  at least 3:1. Check the accent colour on the panel colour specifically —
  that is where it usually fails.
- Honour `prefers-reduced-motion` (or the OS equivalent): no animation
  that is decorative only.
- Every control has an accessible name. An icon-only button needs a label.
- Never use colour as the only carrier of meaning.

---

## 9. Signing, and what a release build must be

- **Windows:** Authenticode signed. An unsigned installer triggers
  SmartScreen and reads as malware to a first-time buyer.
- **macOS:** signed with a Developer ID and **notarised**, and the
  notarisation stapled. Test the download path a real customer takes —
  a zip fetched from a browser, not a local build.
- Every shipped product in the store today is signed and notarised. An
  unsigned build is not a release candidate.
- The release binary must contain the studio public key from the License
  Integration Standard and **no other signing key**, and must default to
  `https://amanorsac.studio` with no localhost fallback anywhere in the
  licence path. Both are verified at delivery.

---

## 10. Delivery

Send, with the release build:

1. **The facts for the catalog entry:** app id, display name, version,
   platforms, plugin formats, whether it is licensed or unlicensed, and
   whether it is a bundle and what it contains.
2. **The installers**, one per platform, signed and notarised, with their
   exact filenames and sizes.
3. **The licensing acceptance report** — §9 of the License Integration
   Standard, A1 to A12, with the key you tested against. Or, for an
   unlicensed product, a written statement that it ships with no
   licensing and makes no network requests.
4. **Store assets:** screenshots of the running product at full
   resolution and unscaled, the icon, and the description, requirements
   and formats as text.
5. **Third-party notices** for anything you linked, and a note on any
   licence that restricts commercial use. A non-commercial dependency
   discovered after release is a recall.

The studio adds the catalog entry, uploads the installer, sets the price
and the product is on sale. The licence server needs no change for a new
product.

---

## 11. Governance

- **This document is the source of truth for shared standards.** A
  product's own brief is the source of truth for what that product
  currently does. When the two disagree, this one wins and the product
  gets fixed.
- Anything listed in §4 as permanently Amanorsac changes only as a
  deliberate decision, never as a side effect of one product's redesign.
- Where a product's needs genuinely conflict with a rule here, raise it
  before you build around it. A documented exception is fine. An
  undocumented one is found at delivery and sent back.
