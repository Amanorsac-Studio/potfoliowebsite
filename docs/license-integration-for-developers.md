# Licensing any Amanorsac app or plugin bundle — developer notes

This is the one license system for every Amanorsac product: SecondOut
uses it today, and any new plugin or bundle plugs into the same server
with **no server changes**. The reference implementation is SecondOut's
`LicenseClient.h` and `LicenseCrypto.h` — reuse them; only the
app-specific constants change (§6).

The short version: a customer buys on amanorsac.studio and gets a
license key. The app posts that key plus a device id to the server. The
server answers with a **signed proof**; the app verifies the signature
against a public key compiled into the binary, caches the proof, and is
licensed offline until the proof's grace date. A patched binary or a
fake server cannot produce a valid signature without the studio's
private key, which never leaves the server.

---

## 1. The key

```
XXXX-XXXX-XXXX-XXXX     e.g.  SECO-610E-6070-3493
```
Uppercase, 4×4, first block derived from the app id. The app should
`trim()` and `toUpperCase()` whatever the person types before sending.
The person finds it at **amanorsac.studio → My Apps**, and Amanorsac
Hub can hand it to the app directly (see `docs/hub-integration.md`).

**For a bundle**: one purchase = one key = one device allowance for the
whole bundle. Every plugin in the bundle shares that key and, on a given
machine, the **same device id and proof cache** (§4). Activating one
plugin activates the bundle on that machine; it must never cost one
device seat per plugin.

## 2. The API — base URL `https://amanorsac.studio`

Hardcode the base URL for the shipped build. An environment variable
override (`AMANORSAC_LICENSE_URL`) is fine for development, but the
release build must not default to localhost — SecondOut's first build
did, and every real activation went to a server that did not exist.

### `POST /licenses/activate`
```json
{ "licenseKey": "SECO-610E-6070-3493", "deviceKey": "<see §3>", "deviceLabel": "STUDIO-PC" }
```
- **200** `{ "proof": "<base64url json>.<base64url signature>" }` — licensed. Adopt the proof (§5).
- **404** `{ "error": "no_such_license" }` — the key is not one of ours.
- **409** `{ "error": "device_limit_reached", "max_devices": 2, "devices": [...] }` — both seats used. Tell the person to free one in My Apps or deactivate inside the plugin on the other machine.
- **401 / 400 / 502 / 503** `{ "error": "<code>", "message": "<text>" }` — show `message` if present, else something generic.

Any 2xx is success; any non-2xx is failure with `error` as a
machine-readable code. Calling activate again from an already-activated
device is a heartbeat: it refreshes the proof and does **not** use a
second seat. Do it roughly hourly while the app is open, silently.

### `POST /licenses/deactivate`
```json
{ "licenseKey": "SECO-…", "deviceKey": "<this device's id>" }
```
- **200** `{ "ok": true }` — seat freed; clear the local key and proof.
- **404** `{ "error": "no_such_license" }`.

There is no separate "check" endpoint. Re-activation is the check.

## 3. The device id

A random id (UUID is fine, 16–128 chars) generated **once** on first run
and stored on disk, reused forever. Not a hardware serial or MAC
address: those are personal data, break when a drive is swapped, and a
determined sharer defeats either kind. The goal is to limit casual
sharing, not to be unbreakable.

For a bundle, store it once per **vendor/bundle**, not per plugin, e.g.
`%LOCALAPPDATA%\Amanorsac Studio\<bundle>\device.id` on Windows,
`~/Library/Application Support/Amanorsac Studio/<bundle>/device.id` on
macOS. Every plugin in the bundle reads the same file.

## 4. Local storage of secrets

Cache the license key and the latest proof on disk so the plugin opens
with no network. Encrypt both with the OS keystore so a copied file is
useless elsewhere: **DPAPI** (`CryptProtectData`, current-user scope, a
fixed entropy string, `CRYPTPROTECT_UI_FORBIDDEN`) on Windows;
**Keychain** or `Security.framework` data protection on macOS. If the
blob will not decrypt (profile moved, password reset), delete it and
quietly show the activation screen again — never crash, never alarm
someone mid-session in their DAW.

## 5. Verifying the proof — this is the whole security model

The proof is `base64url(json) + "." + base64url(signature)`.

1. Split on the **first** `.`. Base64url-decode both halves (`-`→`+`,
   `_`→`/`, re-pad with `=`).
2. Signature must be exactly **64 bytes**: raw IEEE P1363 `r‖s`, **not
   DER**. Hash: **SHA-256** over the **exact decoded JSON bytes**.
   Curve: **P-256** (secp256r1 / prime256v1).
3. Verify **before** parsing the JSON. Never re-serialise and verify the
   re-serialised form — whitespace and key order would differ and the
   check would fail.
4. Only then parse. Fields, all present:
   - `deviceKey` (string) — must equal **this device's** id, or reject.
   - `licenseKey` (string) — must equal the key that was activated, or reject.
   - `issuedAt`, `expiresAt`, `graceUntil` — `int64` **milliseconds since epoch**.
     `expiresAt` = issue + 48 h, `graceUntil` = issue + 30 days.

Licensed means: proof verified, bound to this device and key, and
`now <= graceUntil`, and the clock has not been rolled back more than
48 h before `issuedAt`. Between `expiresAt` and `graceUntil` the app
still works and may show a soft "reconnect soon" notice. After
`graceUntil` with no successful re-activation, it stops.

The public key, the same for every Amanorsac product:

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

Raw SEC1 uncompressed point: `0x04` + 32-byte X + 32-byte Y. On
Windows this drops straight into `BCryptImportKeyPair` as a
`BCRYPT_ECCPUBLIC_BLOB` with `BCRYPT_ECDSA_PUBLIC_P256_MAGIC` (skip the
`0x04`). On macOS, `SecKeyCreateWithData` with `kSecAttrKeyTypeECSECPrimeRandom`
accepts the 65 bytes as-is; verify with `kSecKeyAlgorithmECDSASignatureDigestX962SHA256`
after converting `r‖s` to DER, or use `...RFC4754` where available for raw.

**Verified against the live server**: a real proof issued for
`SECO-610E-6070-3493` checks out with this key using exactly the
algorithm above.

## 6. Reusing SecondOut's client — what to change

`LicenseClient.h` / `LicenseCrypto.h` implement §2–§5 completely.
For a new product change only:

| Constant / place                    | SecondOut value                    | New product                          |
|-------------------------------------|------------------------------------|--------------------------------------|
| storage folder (`appDataDir()`)     | `Aquarii Audio\SecondOut`          | `Amanorsac Studio\<bundle>` — shared by all plugins in the bundle |
| DPAPI entropy string                | `"SecondOut/license/v1"`           | `"<bundle>/license/v1"`               |
| DPAPI description string            | `L"SecondOut"`                     | `L"<bundle>"`                         |
| `defaultBaseUrl()` fallback         | `http://127.0.0.1:4790`            | **`https://amanorsac.studio`**        |
| `kLicenseSigningKey`                | (above)                            | **same bytes** — one studio key       |

Everything else stays: request shapes, error codes, proof handling,
the hourly timer, the atomic `isLicensed()` flag for the audio thread.

## 7. The UI must react to activation — a bug to not repeat

SecondOut 1.3.0 showed "Activated." and then stayed on the activation
screen; the main interface never appears until the plugin is reopened.
Cause: the editor decides which view to show once, when it is
constructed, and nothing tells it to re-decide after `activate()`
succeeds.

Required behaviour: **when the `activate()` completion callback fires
with `r.ok == true`, switch to the main view right there** — the same
code path that runs when a cached, still-valid proof loads on startup.
`isLicensed()` is already `true` at that moment (`adoptProof()` sets the
flag before the callback runs). A belt-and-braces alternative: while the
activation view is showing, a `juce::Timer` at ~500 ms checks
`isLicensed()` and swaps views the first time it is true. Do one or the
other; both is fine.

## 8. Test it without the plugin

```
curl -X POST -H "content-type: application/json" \
  -d "{\"licenseKey\":\"<a real key from My Apps>\",\"deviceKey\":\"dev-test-0001\",\"deviceLabel\":\"CURL\"}" \
  https://amanorsac.studio/licenses/activate
```
Expect `{"proof":"…"}`. (That uses a device seat — free it in My Apps
afterwards, or `POST /licenses/deactivate` with the same deviceKey.)

Verify the proof in Node with the public key above:

```js
const crypto = require('crypto');
const PUB = Buffer.from([0x04,0xcd,0xa5, /* …the 65 bytes… */ 0x59,0x52]);
const [b, s] = proof.split('.');
const u = x => Buffer.from(x.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - x.length % 4) % 4), 'base64');
const key = crypto.createPublicKey({ format:'jwk', key:{ kty:'EC', crv:'P-256',
  x: PUB.subarray(1,33).toString('base64url'), y: PUB.subarray(33,65).toString('base64url') } });
console.log(crypto.verify('sha256', u(b), { key, dsaEncoding:'ieee-p1363' }, u(s)));   // true
console.log(JSON.parse(u(b).toString()));
```

## 9. What the studio adds on its side for a new product

Nothing in the license server. Only:
- the product's id, name, price and platforms in `catalog.json` and the
  checkout function, and
- the installer uploaded to the R2 bucket.

Send the studio: the **app id** you want on the key prefix (letters,
e.g. `studiobundle` → keys start `STUD-`), the display name, the price,
and which platforms you ship.
