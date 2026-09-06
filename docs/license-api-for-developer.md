# SecondOut license activation — API contract

Two endpoints, both already live at `amanorsac.studio`. No API key, no
account, no CORS — just the license key the customer already has. This
is the entire integration; nothing else needs to be built server-side.

## 1. Generate and store a device ID — do this first, once

Before calling either endpoint, the app needs a **device ID**: a random
identifier generated once on first launch and saved to local disk (a
config file, the registry, wherever the app already keeps settings).
**It must stay the same across every future launch on that machine.**

If a new random ID were generated every time the app starts, every
launch would look like a brand-new device to the server, and the
two-device limit would be exhausted almost immediately. Generate it
once, save it, reuse it forever (or until the app is uninstalled).

A UUID v4 is fine. Example (any language):

```
device_id = uuid.uuid4().toString()   // generate once, save to disk
```

## 2. `POST https://amanorsac.studio/api/license/activate`

Call this the first time someone enters their license key, and again
on every app launch after that (it's safe to call repeatedly — calling
it again from a device already activated just updates a "last seen"
timestamp, it doesn't use up a second slot).

**Request body (JSON):**
```json
{
  "license_key": "SECO-XXXX-XXXX-XXXX",
  "device_id": "the-uuid-you-generated-and-saved",
  "device_name": "STEPHEN-PC"
}
```
`device_name` is optional but recommended — it's what shows up in the
customer's account page when they look at which devices are using
their key, so a real computer name is much friendlier than a raw UUID.

**Response on success:**
```json
{ "ok": true, "app": "secondout" }
```
Unlock the app / store a local "activated" flag and proceed normally.

**Response when the license key doesn't exist:**
```json
{ "ok": false, "error": "Not a recognised license key." }
```
Show the customer this message and let them re-enter the key.

**Response when the two-device limit is already used up:**
```json
{
  "ok": false,
  "error": "Device limit reached.",
  "max_devices": 2,
  "devices": [
    { "device_name": "STUDIO-PC", "last_seen": "2026-09-06T00:00:00Z" },
    { "device_name": "LAPTOP",    "last_seen": "2026-09-05T00:00:00Z" }
  ]
}
```
Show the customer this message, and tell them: *"Sign in at
amanorsac.studio/client, open My Apps, and remove a device to free up
a slot."* The app itself has no way to remove a device — that's
deliberately only done from the account portal, so a lost or stolen
device can't remove itself to make room for whoever has it.

## 3. `POST https://amanorsac.studio/api/license/check`

Call this periodically after activation (e.g. once per launch, or on a
timer every few days) to make sure the license/device pairing is still
valid — a customer may have removed this exact device from their
portal since it last activated.

**Request body:**
```json
{ "license_key": "SECO-XXXX-XXXX-XXXX", "device_id": "the-same-uuid" }
```

**Response:**
```json
{ "valid": true }
```
or
```json
{ "valid": false }
```

If `false`, the app should call `/api/license/activate` again (it'll
either succeed — a slot opened up — or come back with the device-limit
message above).

## 4. One important note on being offline

Don't make a failed network request lock a paying customer out
instantly — someone on a plane or a bad connection shouldn't lose
access to something they own. A common, sensible approach: cache the
last known-valid state locally, and only require a fresh successful
`/check` after some grace period (a week is reasonable) of being
unable to reach the server at all.

## 5. What NOT to build

No login, no account system, no separate Stripe integration, no API
key of your own — the license key the customer already has is the only
credential this needs. If either endpoint ever needs to change, we'll
send an updated version of this document.
