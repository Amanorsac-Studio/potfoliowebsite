# Amanorsac Hub — how it talks to amanorsac.studio

The Hub is the one door to every app. The website sells, shows keys and
devices, and hands out the Hub itself; the Hub signs the person in with
the **same account**, shows what they own, downloads and installs it,
and (for licensed plugins) can hand the license key straight to the app.
Everything below already exists on the server — nothing here needs
building on the website side.

## 1. Sign in — same Supabase project as the website

```
Supabase URL:        https://kdxckigyhpnwhwgjdgqq.supabase.co
Publishable key:     sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp
```

Use `@supabase/supabase-js` (Electron main or renderer, either works) with
`signInWithPassword({ email, password })`. This is the account people
create at `https://amanorsac.studio/client`. A "Create account" link in
the Hub should open that page in the browser rather than reimplementing
sign-up — email confirmation, password reset and the branded emails all
live there already.

The publishable key is safe to ship in the Hub. Row Level Security is
what protects the data: a signed-in session can only ever read its own
rows.

## 2. What exists — `GET https://amanorsac.studio/api/catalog`

Public, no auth, CORS open. Returns:

```json
{
  "hub":  { "name": "Amanorsac Hub", "version": "1.1.0", "protocol": "amanorsac",
            "platforms": ["windows","mac-arm64","mac-x64"] },
  "apps": {
    "secondout": { "name": "SecondOut", "vendor": "Aquarii Audio", "kind": "plugin",
                   "status": "available", "tagline": "…", "icon": "https://amanorsac.studio/images/apps/secondout-icon.png",
                   "page": "https://amanorsac.studio/secondout.html", "color": "#3fe083",
                   "free": false, "price_cents": 1900, "licensed": true, "version": "1.3.0",
                   "platforms": ["windows"] },
    "pulseroom":  { "…": "free: true, licensed: false, platforms: [windows, mac]" },
    "performlive": { "status": "coming_soon", "platforms": [] }
  }
}
```

It also carries `news`, newest first, capped at 30:

```json
"news": [
  { "id": "secondout-1-3-1", "date": "2026-08-21", "tag": "Release",
    "app": "secondout", "title": "SecondOut 1.3.1", "body": "…",
    "url": "https://amanorsac.studio/secondout.html" }
]
```

`app` and `url` may be null. `id` is what the Hub remembers as read, so
an id is never reused for a different post — editing a post in place
does not mark it unread again, which is usually what you want.

Poll it on launch (and maybe hourly): a new app, a new version or a new
post appears here the moment it is published — no Hub update needed.
`hub.version` is the current Hub release, for a "you're on an older
Hub" notice.

The Hub compares the app ids against the ones it saw last time and
announces anything new by itself, so an entry in `news` is only needed
when there is something to say beyond "this exists".

- `kind`: `app` (standalone) or `plugin` (VST3/standalone installer).
- `licensed`: the app asks for a license key on first run (see §5).
- `free`: anyone signed in owns it; otherwise it must be bought (§6).
- `platforms` for an app are `windows` and/or `mac` (one universal Mac
  build). The Hub's own installers are split `mac-arm64` / `mac-x64`.

## 3. What this account owns — straight from Supabase

With the signed-in client:

```js
const { data: owned } = await sb.from('purchases')
  .select('app, license_key, max_devices, purchased_at, update_eligible_until');
const { data: devices } = await sb.from('device_activations')
  .select('license_id, device_name, device_id, last_seen, revoked_at').is('revoked_at', null);
```

RLS returns only this account's rows. Free apps appear here once
claimed — call `await sb.rpc('claim_license', { p_app: 'pulseroom' })`
for each free app in the catalog that is missing from `purchases` (it is
idempotent; My Apps on the website does exactly this on load).

## 4. Downloading an installer — `POST https://amanorsac.studio/api/app-download`

```
Authorization: Bearer <the session's access_token>
Content-Type: application/json

{ "app": "secondout", "platform": "windows" }
```

- `200 { "url": "/download/secondout/windows?e=…&s=…", "file": "SecondOut-1.3.0-Setup.exe", "version": "1.3.0", "title": "SecondOut for Windows" }`
  `url` is a **signed ticket, valid 15 minutes, relative to
  https://amanorsac.studio**. `GET` it to stream the file; it supports
  `Range`, so resumable downloads work.
- `401 { "error": "sign_in" }` — no or expired token: refresh the session and retry.
- `403 { "error": "not_owned" }` — this account does not own the app.
- `404 { "error": "no_such_download" }` — unknown app/platform.

The server re-checks ownership on every call; the Hub never decides who
owns what.

## 5. Licensed plugins — activation from the Hub (optional, recommended)

For `licensed: true` apps the Hub already knows the key from §3. It can
either show it for the person to paste, or skip the plugin's activation
screen entirely by activating on the app's behalf, using the same API
the plugin uses:

```
POST https://amanorsac.studio/licenses/activate
{ "licenseKey": "SECO-…", "deviceKey": "<the device id the plugin uses>", "deviceLabel": "STUDIO-PC" }
→ 200 { "proof": "<base64url json>.<base64url signature>" }
```

For that to unlock the plugin, the Hub has to use the **plugin's own
device key** and store the proof where the plugin looks for it
(`%LOCALAPPDATA%\Aquarii Audio\SecondOut\device.id`, `license-proof.dat`
and `license-key.dat`, DPAPI-protected — see `LicenseClient.h`). That
is a per-plugin agreement between the Hub and the plugin; the server
does not care which of them calls.

Two devices per key. `POST /licenses/deactivate { licenseKey, deviceKey }`
frees this device's seat. Errors come back as
`{ "error": "no_such_license" | "device_limit_reached" }`.

## 6. Buying — send them to the website

The Hub does not take payment. For an app with `free: false` that the
account does not own, open `https://amanorsac.studio/<page>` in the
browser (the `page` field in the catalog). Signed in there, the person
buys with Stripe and the purchase appears in §3 within seconds; the Hub
can re-read `purchases` when it regains focus.

## 7. The `amanorsac://` protocol — the website opens the Hub

The website links to `amanorsac://install/<app>` ("Already have the
Hub? Open SecondOut there"). Register the `amanorsac` scheme in the Hub
(Electron: `app.setAsDefaultProtocolClient('amanorsac')` plus the
`protocols` entry in electron-builder config) and handle:

```
amanorsac://install/<app>     open the Hub, focus <app>, start install if owned
amanorsac://open              just bring the Hub to the front
```

Nothing breaks if it is not registered — the link simply does nothing
and the person clicks the download button instead.

## 8. Where the Hub's own installers live

The website hands out the Hub from
`https://amanorsac.studio/download/hub/<platform>` where platform is
`windows`, `mac-arm64` or `mac-x64` (`mac` is accepted as Apple
silicon). These stream from the R2 bucket under **stable names**, so
the links never change between releases:

| platform    | R2 object                        |
|-------------|----------------------------------|
| windows     | `hub/AmanorsacHub-Setup.exe`     |
| mac-arm64   | `hub/AmanorsacHub-mac-arm64.dmg` |
| mac-x64     | `hub/AmanorsacHub-mac-x64.dmg`   |

A Hub release = upload the three files under those exact names and set
`hub.version` in `catalog.json`. GitHub Releases can stay as the source
for electron-updater's own auto-update; the two do not conflict.

## 9. Adding an app later

One entry in `catalog.json` + the installer uploaded to R2. The Hub
picks it up from `/api/catalog` on its next poll, announces it under
What's new and marks the sidebar. If it is paid, its price must also be
added to `supabase/functions/create-app-checkout` (that function is
what actually charges the card).

## 10. Usage notes — `record_hub_usage`

Off until the person turns it on. The Hub asks once, on the library
page, and `consent` stays `null` — meaning off — until they answer.

What a note contains: the event (`hub_open`, `app_open`, `app_install`,
`app_update`), which app, the app and Hub versions, `windows` or `mac`,
the architecture and the OS release string. Nothing else is read, so
nothing else can be sent: no file names, no folder names, no computer
name, nothing from inside an app.

Notes are written to `usage.json` in the Hub's user-data folder and sent
in batches of up to 100 through the `record_hub_usage(p_install_id,
p_events)` RPC. Main only forgets a note once the page confirms it
arrived, so a month offline sends the whole month later. `install_id` is
a UUID made on first run; it distinguishes machines, and is not derived
from anything about the machine or the person.

Turning it off empties whatever is waiting locally. `revoke_hub_usage()`
erases everything the account has already sent, on every machine.

The tables and functions are in `supabase-hub-usage.sql`. Reporting is
admin-only: `hub_usage_summary(days)`, `hub_usage_by_app(days)`,
`hub_usage_daily(days)`.
