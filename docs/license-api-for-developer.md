# SecondOut licensing — what to configure in the app

Superseded version of this document: the previous one described a
contract that didn't match `LicenseClient.h`/`LicenseCrypto.h`, and
dropped the signature check your code already does. That's fixed now —
the server was rewritten to match your existing client exactly, not the
other way around. Nothing in `LicenseClient.h` or `LicenseCrypto.h`
needs to change. Two things to configure:

## 1. Base URL

`LicenseClient::defaultBaseUrl()` already reads `AMANORSAC_LICENSE_URL`,
falling back to `http://127.0.0.1:4790` for local dev. In the production
build, set:

```
AMANORSAC_LICENSE_URL=https://amanorsac.studio
```

`POST https://amanorsac.studio/licenses/activate` and
`POST https://amanorsac.studio/licenses/deactivate` are both live now.
There is no separate `/check` or `/status` endpoint — your hourly
`Timer` re-activation via `/licenses/activate` is the only re-validation
call, exactly as `LicenseClient.h` already does it.

## 2. Public key for `LicenseKeys.h`

```cpp
constexpr uint8_t kLicenseSigningKey[65] = {
  0x04, 0xcd, 0xa5, 0x7d, 0x1c, 0xc8, 0xa6, 0xe2, 0x71, 0xd5, 0x48, 0x49,
  0xce, 0x55, 0xd5, 0x03, 0x77, 0x56, 0x66, 0x90, 0xfd, 0xb6, 0x95, 0x45,
  0xa4, 0x1a, 0x92, 0xc4, 0x77, 0xda, 0xcb, 0x00, 0x0d, 0x2c, 0x06, 0x0b,
  0xa8, 0x3f, 0xbd, 0x9b, 0x70, 0x85, 0xaf, 0xff, 0xc0, 0x42, 0xd4, 0x00,
  0x7e, 0x5b, 0x96, 0xfe, 0x68, 0xff, 0xec, 0x91, 0x11, 0xf6, 0x21, 0x00,
  0x79, 0xfc, 0x43, 0x59, 0x52
};
constexpr bool kLicenseSigningKeyConfigured = true;
```

This is a public key — safe to compile into the binary, safe to have in
this file. The matching private key lives only as a Cloudflare Worker
secret (`LICENSE_SIGNING_KEY`), never in any repo.

## What the server actually does now (for reference — you don't need to change anything)

- `POST /licenses/activate` — body `{licenseKey, deviceKey, deviceLabel}`.
  On success (2xx): `{"proof": "base64url(json).base64url(sig)"}`, a
  P-256/SHA-256 signature over the raw JSON bytes, raw IEEE-P1363 (64
  bytes, r‖s) — exactly what `parseAndVerifySignedBlob` expects. The
  signed JSON carries `deviceKey`, `licenseKey`, `issuedAt`, `expiresAt`
  (+48h), `graceUntil` (+30 days from issue).
  On failure (non-2xx): `{"error": "<code>"}`, where `<code>` is one of
  the exact strings `friendlyMessageFor` already switches on —
  `no_such_license`, `device_limit_reached` (with `max_devices` and
  `devices` alongside it) — plus a couple of new ones your client
  already handles generically via its status-code fallback:
  `invalid_request` (400, malformed body), `licensing_unavailable` (503,
  server misconfigured), `upstream_error` (502, database unreachable).
- `POST /licenses/deactivate` — body `{licenseKey, deviceKey}`. Success:
  `{"ok": true}`. Failure: `{"error": "no_such_license"}`.

## Device limit and removing a device

Two devices per license, same as before. A customer who's used both
slots sees `device_limit_reached` from the app; tell them to sign in at
amanorsac.studio/client, open **My Apps**, and remove a device there to
free a slot. The app itself has no way to remove a device other than
its own `deactivateThisDevice()` — removing a *different* device is
deliberately only ever done from the account portal, so a lost or
stolen device can't free up its own slot for whoever has it.

## Verification note

This contract was checked by re-implementing your exact verification
algorithm (P-256 / SHA-256 / raw IEEE-P1363 / base64url blob split
before parsing) against the server's actual signing code, including
negative controls — tampered body, wrong public key, garbage input all
correctly rejected. It has not been run against the real compiled
binary, since that isn't possible from here; if anything doesn't
verify on your end, the most likely culprit is the public key in
`LicenseKeys.h` not matching the one above exactly.
