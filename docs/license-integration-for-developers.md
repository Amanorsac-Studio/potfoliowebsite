# Amanorsac Studio — License Integration Standard

**Version 1.0 · September 2026 · Applies to every paid Amanorsac app, plugin and plugin bundle.**

This is the one licensing system for every product sold on amanorsac.studio.
It is already live and proven end to end with SecondOut 1.3.1. A build that
follows this document will activate for every buyer. A build that departs
from it will not be accepted.

The words **MUST** and **MUST NOT** mark requirements. Everything else is
explanation.

---

## 1. How it works

1. A customer buys the app on amanorsac.studio. The site creates a **license
   key** and shows it under *My Apps*. Amanorsac Hub shows the same key.
2. The customer installs the app and types the key in once.
3. The app sends the key and its own **device id** to the license server.
4. The server checks the key, counts the device against the seat limit, and
   answers with a **signed proof**.
5. The app verifies the proof's signature with a **public key compiled into
   the binary**, stores it, and is licensed. It repeats step 3 quietly about
   once an hour while open to refresh the proof.
6. With no internet, the stored proof keeps the app working for 30 days.

The private signing key exists only on the server. Nothing a customer or a
cracker can do on their machine produces a valid proof. That signature check
is the whole security model, so it is the part that MUST be exact.

---

## 2. Requirements

| #   | Requirement |
|-----|-------------|
| R1  | The shipped build MUST use `https://amanorsac.studio` as the license server. An environment-variable override is allowed for development only. The default in the shipped binary MUST NOT be localhost or any other address. |
| R2  | The build MUST contain the studio public key from §5, byte for byte. It MUST NOT contain any other signing key, including a development key. |
| R3  | The app MUST verify the proof's signature before using anything in it. The server's HTTP 200 is not proof of a license. Only a verified signature is. |
| R4  | The app MUST report "activated" to the user only after a proof verified. If the server answered but the signature failed, the app MUST say the license could not be verified and MUST NOT say it succeeded. |
| R5  | The app MUST check that the proof's `deviceKey` equals its own device id and `licenseKey` equals the key that was sent. A proof for another device or key MUST be rejected. |
| R6  | The device id MUST be a random value generated once on first run and stored on disk. It MUST NOT be a hardware serial, MAC address or anything personal. |
| R7  | The key and the latest proof MUST be stored encrypted with the OS key store (DPAPI on Windows, Keychain on macOS) so a copied file does not work on another machine. |
| R8  | The app MUST work with no internet while `now <= graceUntil`, and MUST refuse to run after that until a new proof is obtained. |
| R9  | The app MUST re-activate (heartbeat) about once an hour while open, and at startup when it has a key but no proof. A failed heartbeat MUST NOT delete a valid stored proof. |
| R10 | The app MUST offer "Deactivate this device", which calls `/licenses/deactivate` and then deletes the stored key and proof. Buyers need this to move to a new computer. |
| R11 | For a **bundle**, every plugin MUST share one device id, one stored key and one stored proof. Activating any plugin activates the bundle on that machine. One machine MUST use one seat, never one per plugin. |
| R12 | Before delivery, the build MUST pass every check in §9 against the live server, and the test report MUST be sent with the build. |

---

## 3. The license key

```
XXXX-XXXX-XXXX-XXXX        example: SECO-610E-6070-3493
```

- Four blocks of four, separated by hyphens, uppercase.
- Block 1 is the first four letters of the app id (`secondout` → `SECO`).
- Blocks 2 to 4 are random hex characters (`0-9`, `A-F`).
- The app should `trim()` and uppercase whatever the customer typed before
  sending. The server does the same, so a lowercase key still works.
- The key is not secret in the cryptographic sense. What protects the
  product is the seat limit and the signed proof, not the key's secrecy.

One purchase produces one key. For a bundle, that one key covers every
plugin in the bundle (R11).

---

## 4. The server API

Base URL: `https://amanorsac.studio` (R1). Plain HTTPS, JSON in, JSON out.
No authentication header. No cookies. No CORS. The app talks to it
directly; a browser page cannot.

### 4.1 Activate — `POST /licenses/activate`

Request body:

```json
{ "licenseKey": "SECO-610E-6070-3493",
  "deviceKey":  "3f7c2a9e-6b1d-4e2f-9a8c-1d2e3f4a5b6c",
  "deviceLabel": "STUDIO-PC" }
```

`deviceLabel` is optional, up to 120 characters, shown to the customer in
*My Apps* so they can recognise the machine. Use the computer name.

Responses:

| Status | Body | Meaning | What the app does |
|--------|------|---------|-------------------|
| 200 | `{ "proof": "<body>.<signature>" }` | Licensed. | Verify the proof (§5), store it, unlock. |
| 400 | `{ "error": "invalid_request", "message": "…" }` | Missing key or device id. | Programming error; fix the request. |
| 404 | `{ "error": "no_such_license" }` | The key is not one of ours. | Tell the customer to check the key in *My Apps*. |
| 409 | `{ "error": "device_limit_reached", "max_devices": 2, "devices": [ { "device_name": "STUDIO-PC", "last_seen": "…" } ] }` | All seats used. | Show the device names; tell the customer to remove one in *My Apps* or deactivate on the other machine. |
| 502 | `{ "error": "upstream_error", "message": "…" }` | Server could not reach the database. | Show `message`; keep any stored proof; retry later. |
| 503 | `{ "error": "licensing_unavailable", "message": "…" }` | Server not configured. | Same as 502. |

Rules:
- Any 2xx is success. Any other status is failure. `error` is the
  machine-readable code; `message`, when present, is safe to show.
- Calling activate again from a device that already holds a seat is a
  **heartbeat**: it refreshes the proof and does not use another seat.
- A device that was removed in *My Apps* and calls activate again simply
  takes a free seat again.

### 4.2 Deactivate — `POST /licenses/deactivate`

Request body:

```json
{ "licenseKey": "SECO-610E-6070-3493",
  "deviceKey":  "3f7c2a9e-6b1d-4e2f-9a8c-1d2e3f4a5b6c" }
```

| Status | Body | What the app does |
|--------|------|-------------------|
| 200 | `{ "ok": true }` | Seat freed. Delete the stored key and proof; show the activation screen. |
| 404 | `{ "error": "no_such_license" }` | Key unknown. Delete local state anyway. |
| 400 / 502 / 503 | as above | Tell the customer it did not go through; try again later. |

There is no separate "check" or "validate" endpoint. Re-activation is the
check.

---

## 5. The proof — verify it exactly like this

The proof is one string: `base64url(body) + "." + base64url(signature)`.

**Algorithm**

1. Split on the **first** `.`.
2. Base64url-decode both parts. Base64url means `-` instead of `+`, `_`
   instead of `/`, and no `=` padding; add padding back before decoding.
3. The signature MUST be exactly **64 bytes**: raw `r ‖ s` (IEEE P1363),
   **not** DER. Reject any other length.
4. Verify: **ECDSA, curve P-256 (secp256r1 / prime256v1), hash SHA-256**,
   over the **decoded body bytes exactly as received**. Do not parse and
   re-serialise the JSON first; the bytes would differ and verification
   would fail.
5. Only after the signature verifies, parse the body as JSON:

```json
{ "deviceKey":  "<the device id that was sent>",
  "licenseKey": "<the key that was sent>",
  "issuedAt":   1757289600000,
  "expiresAt":  1757462400000,
  "graceUntil": 1759881600000 }
```

   All three times are **milliseconds since the Unix epoch**, 64-bit.
   `expiresAt` is `issuedAt` + 48 hours. `graceUntil` is `issuedAt` + 30 days.

6. Check `deviceKey` and `licenseKey` match this device and this key (R5).

**Licensed means all of:** signature verified, device and key match,
`now <= graceUntil`, and the clock has not been turned back more than 48
hours before `issuedAt`.

Between `expiresAt` and `graceUntil` the app keeps working and may show a
quiet "connect to the internet soon" notice. After `graceUntil` with no
new proof it stops until it can activate again (R8).

**The studio public key** — the same for every product, raw SEC1
uncompressed point, 65 bytes (`0x04` + X + Y):

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

Platform notes:
- **Windows (CNG):** import as `BCRYPT_ECCPUBLIC_BLOB` with
  `BCRYPT_ECDSA_PUBLIC_P256_MAGIC`, X and Y being bytes 1–32 and 33–64
  (skip the leading `0x04`). `BCryptVerifySignature` takes the raw 64-byte
  signature directly.
- **macOS (Security.framework):** `SecKeyCreateWithData` with
  `kSecAttrKeyTypeECSECPrimeRandom` accepts the 65 bytes as they are.
  `kSecKeyAlgorithmECDSASignatureMessageX962SHA256` expects DER, so
  convert `r ‖ s` to DER first, or use the `RFC4754` variant where available.

This key has been checked against a real proof from the live server, and
SecondOut 1.3.1 ships it and activates with it.

---

## 6. Device id and local storage

**Device id (R6).** A UUID generated on first run, stored on disk, reused
forever. Between 16 and 128 characters. If the file is missing, generate a
new one; the customer will use a seat again, which is the correct outcome
for a wiped machine.

**Storage location.** One folder per product or bundle, shared by every
plugin in it (R11):

| Platform | Folder |
|----------|--------|
| Windows | `%LOCALAPPDATA%\Amanorsac Studio\<product>\` |
| macOS | `~/Library/Application Support/Amanorsac Studio/<product>/` |

Files: `device.id` (plain), `license-key.dat` (encrypted), `license-proof.dat`
(encrypted). `license-proof.dat` MUST be written only after a proof verified
(R3); its presence is the evidence that activation truly succeeded.

**Encryption (R7).** Windows: `CryptProtectData`, current-user scope, a fixed
entropy string per product, `CRYPTPROTECT_UI_FORBIDDEN`. macOS: Keychain, or
`Security.framework` data protection. If a blob will not decrypt (profile
moved, password reset), delete it and show the activation screen quietly.
Never crash and never interrupt audio.

---

## 7. Behaviour rules

- **Startup:** load the stored proof. If it verifies and `now <= graceUntil`,
  unlock immediately, then heartbeat in the background. If there is a key
  but no proof, activate at startup (R9). If there is neither, show the
  activation screen.
- **Heartbeat:** about hourly while the app is open, silent. On success,
  replace the stored proof. On any failure, keep the old proof (R9).
- **Stale proof:** a stored proof past `graceUntil` is deleted, and the app
  behaves as "key but no proof".
- **Audio thread:** `isLicensed()` is an atomic flag read by the audio
  thread; all network work happens off it.
- **The interface follows the flag.** The main view appears when
  `isLicensed()` becomes true, whether that happened at startup or after
  the customer typed a key. Polling the flag a few times a second from the
  UI is fine.
- **Messages:** use the codes in §4 to choose wording. Never show a raw
  HTTP status or JSON to a customer.

---

## 8. Reference implementation

SecondOut 1.3.1's `LicenseClient.h` and `LicenseCrypto.h` implement §4 to §7
completely in plain JUCE/C++ with no other dependencies. Ask the studio for
both files. For a new product, change only these:

| Constant | SecondOut | Your product |
|----------|-----------|--------------|
| Storage folder | `Aquarii Audio\SecondOut` | `Amanorsac Studio\<product>` |
| DPAPI entropy string | `"SecondOut/license/v1"` | `"<product>/license/v1"` |
| DPAPI description | `L"SecondOut"` | `L"<product>"` |
| Default base URL | `https://amanorsac.studio` | **same** (R1) |
| `kLicenseSigningKey` | §5 | **same bytes** (R2) |

Keep everything else: request and response handling, proof verification,
the hourly timer, the atomic flag.

If you write your own client instead, it MUST behave identically to this
document, and §9 is how that is proven.

---

## 9. Acceptance test — MUST pass before delivery (R12)

Run every check against the **live server** with the **release build**. Use
a real key from the studio's *My Apps* (ask for a test key). Record the
result of each line and send the report with the build.

| # | Check | Expected |
|---|-------|----------|
| A1 | Fresh machine (delete the storage folder), open the app | Activation screen appears |
| A2 | Enter a wrong key such as `SECO-0000-0000-0000` | "Key not found" style message; nothing stored |
| A3 | Enter the real key | Main interface appears **without reopening the app**; `license-proof.dat` now exists |
| A4 | Open *My Apps* on the website | This machine is listed under Devices with the label you sent |
| A5 | Quit, disconnect the internet, reopen | Main interface appears; no error |
| A6 | Reconnect, wait for one heartbeat or restart | *My Apps* shows a fresh "last seen" |
| A7 | On the website, remove this device, then restart the app | App re-activates and the device reappears (seat was free) |
| A8 | Fill both seats with two other device ids (use the curl below), then activate | "Device limit" message listing the two device names |
| A9 | Use "Deactivate this device" in the app | Activation screen returns; key and proof files gone; device gone from *My Apps* |
| A10 | Bundles only: activate in one plugin, open another plugin from the bundle | Second plugin is licensed with no prompt; *My Apps* shows one device |
| A11 | Confirm the release binary contains the §5 key and no other | Search the binary for the byte sequence `cd a5 7d 1c c8 a6 e2 71`; exactly one hit |
| A12 | Confirm the release binary's default URL | Search the binary for `amanorsac.studio`; no `127.0.0.1` or `localhost` fallback in the license path |

**Tools for A8 and for checking the proof by hand.** Activate a throwaway
device from a terminal (this uses a seat; free it afterwards with the
deactivate call or in *My Apps*):

```
curl -X POST -H "content-type: application/json" \
  -d "{\"licenseKey\":\"<real key>\",\"deviceKey\":\"test-device-0001\",\"deviceLabel\":\"CURL-TEST\"}" \
  https://amanorsac.studio/licenses/activate
```

Expect `{"proof":"…"}`. Verify that proof in Node with the studio key;
`true` means your understanding of §5 matches the server:

```js
const crypto = require('crypto');
const proof = '<paste the proof>';
const PUB = Buffer.from([
  0x04,0xcd,0xa5,0x7d,0x1c,0xc8,0xa6,0xe2,0x71,0xd5,0x48,0x49,0xce,0x55,0xd5,0x03,
  0x77,0x56,0x66,0x90,0xfd,0xb6,0x95,0x45,0xa4,0x1a,0x92,0xc4,0x77,0xda,0xcb,0x00,
  0x0d,0x2c,0x06,0x0b,0xa8,0x3f,0xbd,0x9b,0x70,0x85,0xaf,0xff,0xc0,0x42,0xd4,0x00,
  0x7e,0x5b,0x96,0xfe,0x68,0xff,0xec,0x91,0x11,0xf6,0x21,0x00,0x79,0xfc,0x43,0x59,0x52]);
const [b, s] = proof.split('.');
const u = x => Buffer.from(x.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - x.length % 4) % 4), 'base64');
const key = crypto.createPublicKey({ format:'jwk', key:{ kty:'EC', crv:'P-256',
  x: PUB.subarray(1,33).toString('base64url'), y: PUB.subarray(33,65).toString('base64url') } });
console.log(crypto.verify('sha256', u(b), { key, dsaEncoding:'ieee-p1363' }, u(s)));  // true
console.log(JSON.parse(u(b).toString()));
```

Free the throwaway seat:

```
curl -X POST -H "content-type: application/json" \
  -d "{\"licenseKey\":\"<real key>\",\"deviceKey\":\"test-device-0001\"}" \
  https://amanorsac.studio/licenses/deactivate
```

---

## 10. Delivery to the studio

Send, with the release build:

1. The **app id** for the key prefix (letters only, e.g. `studiobundle`
   gives keys starting `STUD-`), the display name, the price, and the
   platforms shipped.
2. The completed §9 report, A1 to A12, with the key used.
3. For a bundle, the list of plugins it contains.

The studio then adds one catalog entry and the price, uploads the installer,
and the product is on sale. The license server needs no change for a new
product.

---

## 11. Mistakes that have already happened once

SecondOut 1.3.0 shipped with two faults, and either alone blocked every sale:

- Its default server address was `http://127.0.0.1:4790`, so every customer's
  activation went to a server that only existed on the developer's machine.
  That is why R1 exists.
- Its compiled-in public key was a development key, so the live server's
  proofs failed verification. The app still said "Activated." because it
  reported the server's 200 rather than a verified proof, and the customer
  stayed locked out. That is why R2, R3 and R4 exist, and why A3, A11 and
  A12 are in the acceptance test.

Both were fixed in 1.3.1, which activates correctly against the live server.

---

## Appendix — quick reference

| Item | Value |
|------|-------|
| Server | `https://amanorsac.studio` |
| Activate | `POST /licenses/activate` → `{ "proof": … }` |
| Deactivate | `POST /licenses/deactivate` → `{ "ok": true }` |
| Signature | ECDSA P-256, SHA-256, raw 64-byte `r‖s`, base64url |
| Proof fields | `deviceKey`, `licenseKey`, `issuedAt`, `expiresAt` (+48 h), `graceUntil` (+30 d), all ms |
| Seats | 2 devices per key (server-side, can be set per product) |
| Heartbeat | hourly while open; at startup if key but no proof |
| Error codes | `invalid_request`, `no_such_license`, `device_limit_reached`, `upstream_error`, `licensing_unavailable` |
