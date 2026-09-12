# AMANORSAC STUDIO — Standards pack

Send this folder to anyone building an Amanorsac Studio product, at the
start of the work and again before they deliver.

| File | What it is | When they read it |
|---|---|---|
| `01_AMANORSAC_STUDIO_MASTER_STANDARD.md` | The company, what the platform provides, what the developer provides, the rules a build must meet | Before the first line of code |
| `02_AMANORSAC_PRODUCT_BUILD_STANDARD.md` | The engineering standard: the audio thread, plug-in behaviour, performance, accessibility, versions, secrets, and the start and end audits | Before the first line of code, and again before delivery |
| `03_AMANORSAC_PORTFOLIO_LAUNCH_AUDIT.md` | Where the company is: what is built, what is still open, where each product stands | Once, for context |
| `04_AMANORSAC_FOLDER_STRUCTURE.md` | Where a shipped product may read and write, naming, what to send for a release | When deciding where anything is stored |
| `05_AMANORSAC_LICENSE_INTEGRATION_STANDARD.md` | The licensing system, exactly. Requirements, API, proof verification, acceptance test | Before touching licensing, and again before delivery |

**These are internal documents.** They describe unreleased products,
open engineering gaps and commercial terms. They are excluded from the
website upload and should go to a developer directly, not be published.

**The two audits are the point.** `02` §10 is agreed in writing before
any code is written; `02` §11 is answered line by line and attached to
the delivery, together with the licensing report from `05` §9. Those two
lists are what "send it at the start and at the finish" means.

**Keeping them true.** Everything in `03` about prices, versions,
licensing and status is taken from the live store catalog. When that
changes, that table changes. The public key and the acceptance test in
`05` are proven against the live server and must not be edited casually:
if a byte of that key is wrong, no build activates.
