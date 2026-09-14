# catalog.json — how it works

These notes used to sit inside catalog.json itself, which is fetched
by every page and therefore public. They are documentation, not data,
and a public file should not carry a description of the internals.
docs/ is excluded from the website upload.

THE ONE LIST OF APPS. Everything reads this file: the Worker (which files it may hand out
and to whom), the App Store pages, My Apps, and Amanorsac Hub via GET /api/catalog.
Adding an app = one entry here + uploading its installer to the amanorsac-downloads R2 bucket.
A new release = upload the new file under the same key, bump `version`. Nothing else changes.

Per app: free (true = anyone signed in owns it; false = must be bought, price shown from
price_cents but CHARGED by supabase/functions/create-app-checkout - keep the two in step),
  list_price_cents is what the app costs when no sale is on. It is only ever shown
  crossed out next to price_cents, and only while the top-level promo block below
  exists - delete that block and every sale line on the site disappears by itself.
  status is what the live site shows. preview_status, when present, is what a
  workers.dev preview build shows instead - so something can be coming_soon in
  public and fully on sale on a preview link, from one entry rather than two.
licensed (true = the app itself asks for a license key), kind (app | plugin), status
(available | coming_soon), installers keyed by platform: windows | mac | mac-arm64 | mac-x64.
Each installer: key (R2 object), alt_keys (older locations tried after key), as (filename
handed to the browser), type (content-type), size (shown to people), fallback_url (optional,
fetched server-side only if R2 has no such object).

direct_download_fallback: true keeps a plain 'download the installer' link inside My Apps for
signed-in owners, under 'Trouble with the Hub?'. Set false once the Hub is the only door.

The Hub's alt_keys are the names the first release was uploaded under, before the stable
hub/AmanorsacHub-* names existed. They are tried after `key`, so re-uploading under the
stable name is enough to retire them - no link on the site ever changes.
