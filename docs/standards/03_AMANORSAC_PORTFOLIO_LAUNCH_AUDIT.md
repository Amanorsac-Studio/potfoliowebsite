# AMANORSAC STUDIO — Launch Readiness

**Version 2.0 · September 2026 · Supersedes the 2026-09-04 audit.**

Context for a developer joining a product: what the company has already
built, what is genuinely still open, and where your product sits.

---

## 1. The company-level work is done

The 2026-09-04 audit listed six company-level blockers, each of which
stopped every product from being sellable. All six are closed.

| Blocker, September 4 | Where it stands now |
|---|---|
| No Privacy Policy, Terms or EULA anywhere | All three published. `amanorsac.studio/legal` carries the EULA and Terms; `amanorsac.studio/privacy` is the privacy policy, at its own address because the app stores ask for one by URL and check it |
| Every installer unsigned | Signing and notarisation in place. Every product in the store is signed on Windows and notarised on macOS |
| No unified account | One account across the website, My Apps and Amanorsac Hub |
| No licensing or entitlement scheme | Live and proven. ECDSA P-256 signed proofs from the studio's own server, two devices per key, 30-day offline grace. Specified in the License Integration Standard and shipping in SecondOut, AETHER, AMB Analog, Align Pro |
| No About screen or settings surface | Required by the Master Standard §6. Still to be built per product — this is the one item that only partly closed |
| "Aquarii Audio" still live in two products | Retired from everything customer-facing. Treat any remaining occurrence in a codebase as a defect to remove |

Two things were built that the old audit did not anticipate:

- **Amanorsac Hub.** One desktop app that installs, updates and opens
  every product. It replaced the per-product updater that eleven separate
  briefs each listed as missing. **No product needs its own updater.**
- **The store itself.** Catalog-driven: one entry per product controls its
  price, its status, its platforms and its installer. Adding a product is
  one entry and an upload.

---

## 2. What is still open, company-wide

| Item | State |
|---|---|
| **About screen** | Specified, not yet built in any product. Whoever ships next builds it and it becomes the template |
| **Shared UI kit as code** | Still a written contract, not a library. Every product implements the behaviour itself |
| **Crash reporting** | Nothing, anywhere. Deliberate for now: it cannot be added without changing the published privacy policy, so it is a studio decision, not a product one |
| **Accessibility** | Uneven across the portfolio. The baseline in Master Standard §8 is the bar for new work |
| **Preset and settings browser** | No shared implementation. Per product for now |
| **Trademark clearance** | Outstanding on at least one working title. Do not put a name into customer-facing material before the studio confirms it is cleared |

Secrets handling is settled and worth stating, because it constrains you:
the licence **private** key exists only as a secret on the studio's
server. It is in no file, no repository and no build. The only key that
goes into a product is the **public** key in the License Integration
Standard. If you are ever handed a private key, something has gone wrong.

---

## 3. Where the products stand

Verified from the live store catalog.

| Product | Price | Licensing | Platforms | Status |
|---|---|---|---|---|
| SecondOut 1.3.2 | $19 | Licensed | Windows, macOS | On sale |
| AMB Analog 1.0.0 | $39 | Licensed, one key for ten plug-ins | Windows, macOS | On sale |
| Align Pro 1.0.0 | $39 | Licensed | Windows, macOS | On sale |
| AETHER 1.0.0 | $12 | Licensed | Windows, macOS | On sale |
| PulseRoom 1.0 | Free | None | Windows, macOS | On sale |
| Nebula Tide 1.2.2 | Free | None | Windows, macOS | On sale |
| Nebula Tide 2 | Pay what you want | Licensed | Windows, macOS | Built, not yet public |
| AFD Gate 1.3.0 | $12 | **None by design** | Windows, macOS | Built, not yet public |
| Stem Sorter 0.6.0 | $19 | Licensed | Windows, macOS | In development |
| PerformLive | Paid | Licensed | — | In development |
| HarmonieMD | Paid | Licensed | — | In development |

AFD Gate is worth noticing: **a product is allowed to ship with no
licensing at all.** It never contacts a server, works with no network
connection and asks nobody who they are. If that is the right answer for
your product, say so at the start and the store says so on the page.

Any product not in that table is tracked by its own brief, not here. This
document does not carry statuses it cannot verify — if you need the
current state of one, ask the studio rather than trusting a list.

---

## 4. What this means for your build

1. **Do not build infrastructure.** Accounts, licensing, payment,
   downloads, updates and legal are done. Master Standard §2 is the list.
   A second implementation of any of them is a defect, not a feature.
2. **Licensing is not negotiable in its details.** It is live and proven;
   a build that departs from the standard does not activate for buyers.
   The two faults that shipped once are written into that document, along
   with the requirements that exist because of them.
3. **The published privacy policy binds you.** Master Standard §7. It is
   public, so breaking it makes the company's own policy untrue.
4. **Signing and notarisation are release gates**, not polish.
5. **Build the About screen.** It is the last company-level piece
   outstanding, it is small, and the first product to do it sets the
   pattern for everything after.
