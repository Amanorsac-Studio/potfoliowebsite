# PerformLive ↔ Amanorsac Store

The shared, current copy of this contract is the Claude doc
"PerformLive ↔ Amanorsac Store integration"; this file mirrors its
install half. The publish half (uploading from inside PerformLive)
is in the doc and, in code, in store/upload.js and storeRoutes in
worker.js.

What PerformLive needs to do so that a song rented or bought on
amanorsac.studio/store opens inside it with the tracks on the right
lanes and the sections on the timeline.

Everything on the web side exists and is live on the Worker. This page
is the contract; the shapes here do not change without this page
changing first.

## 1. The user

Same accounts as the website. PerformLive signs the person in against
the studio's Supabase project (email + password, or the magic link
the site already uses) and keeps the session:

    project   https://kdxckigyhpnwhwgjdgqq.supabase.co
    anon key  sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp   (public; it is in every page)

Every call below carries the session's access token:

    Authorization: Bearer <access_token>

Tokens expire after an hour; refresh with the refresh token as the
Supabase SDK does. A 401 from any endpoint means "sign in again".

## 2. The link that opens PerformLive

The website hands the operating system this when the person clicks
**Open in PerformLive**:

    performlive://install/<version_id>

`version_id` is a UUID. PerformLive registers the `performlive://`
scheme (Windows: registry under HKCU\Software\Classes\performlive;
macOS: CFBundleURLTypes) and, on receiving it, does §3.

If the person is not signed in inside PerformLive, sign them in first,
then continue with the same id.

## 3. Fetching a song

    GET https://amanorsac.studio/api/store/manifest/<version_id>
    Authorization: Bearer <access_token>

Answers `200` with the manifest (§4) when the account may have the
song: bought it, rented it and the rental is still running, made it,
or is the studio. Otherwise:

    401  { "error": "sign_in" }       no or expired token
    403  { "error": "not_owned" }     this account does not have it
    404  { "error": "no_such_version" }

Then download each `tracks[].url` (§5), write the files into the
song's folder, and build the song from the manifest. Keep the manifest
alongside the files; it is the record of what was fetched.

## 4. The manifest

```json
{
  "manifest_version": 1,
  "version_id": "0d6b1e5c-…",
  "song":    { "id": "…", "slug": "kingsley-anyenor-praise-the-lord", "title": "Praise The Lord", "writers": "Kingsley Anyenor" },
  "version": { "label": "Original", "is_original": true, "kind": "song", "lane": "songs",
               "key": "Eb", "bpm": 72, "time_sig": "4/4", "length_seconds": 412,
               "year": 2026, "album": null, "feat": null, "youtube": "b2L8O7DAJtA",
               "art": "https://amanorsac.studio/store-art/0d6b1e5c-…" },
  "creator": { "slug": "kingsley-anyenor", "name": "Kingsley Anyenor", "kind": "artist" },
  "licence": { "kind": "rent", "purchased_at": "2026-09-27T10:00:00Z", "expires_at": "2026-10-11T10:00:00Z" },
  "slots":   ["click","guide","drums","bass","keys","guitars","piano","aux_keys","horns","bgv"],
  "tracks": [
    { "slot": "click",  "order": 0, "format": "wav", "url": "https://amanorsac.studio/download/store/0d6b…/click?e=…&s=…",
      "bytes": 72643244, "etag": "\"…\"", "sample_rate": 48000, "channels": 2, "duration_seconds": 412.4 },
    { "slot": "guide",  "order": 1, "url": "…" },
    …
    { "slot": "bgv",    "order": 9, "url": "…" }
  ],
  "sections": [
    { "position": 1, "name": "Intro",  "seconds": 0.0,   "bar": 1  },
    { "position": 2, "name": "Verse",  "seconds": 13.33, "bar": 5  },
    { "position": 3, "name": "Chorus", "seconds": 40.0,  "bar": 13 }
  ],
  "links_expire_at": "2026-09-27T11:00:00Z",
  "page": "https://amanorsac.studio/store/item?p=kingsley-anyenor-praise-the-lord"
}
```

Notes:

- **Slots.** Always these ten, always in this order. `click` and
  `guide` are the two the band hears in their ears; the other eight
  are the music. `click`, `guide`, `drums`, `bass`, `keys` and `bgv`
  (backing vocals) are always present; `guitars`, `piano`,
  `aux_keys` and `horns` are absent when the song has none. There is
  no lead vocal lane: the guide is the voice in the ear. Lay out the lanes from
  `slots`, fill the ones present in `tracks`, and leave the others
  empty rather than shifting everything up.
- **Tracks** carry `format`, today always `wav` (PCM). If a lossless
  `flac` ever appears it will say so here and in that field. All the
  same length, all starting at the
  same sample, 44.1 or 48 kHz (88.2 and 96 are allowed but rare).
  `duration_seconds` and `sample_rate` are what the creator's browser
  read from the file header; trust the file over the number.
- **Sections** are sorted by `seconds`. `bar` was computed from the
  tempo and can be corrected by the creator, so if `seconds` and `bar`
  disagree, `seconds` is the one measured against the audio.
- `licence.kind` is `buy`, `rent` or `owner` (the creator opening
  their own work). Only `rent` has an `expires_at`.
- `youtube` is a video id; the website shows it, PerformLive need not.

## 5. Downloading

Every `tracks[].url` is a signed link, good for one hour
(`links_expire_at`). Fetch each with a plain GET, no Authorization
header needed on the download itself. The server supports `Range`
requests, so a dropped download can resume from where it stopped.

If the hour passes mid-download, ask for the manifest again — new
links, same files — and resume.

Downloads must not be shared or written to disk in a way another user
of the machine can reach: the licence is the account's, not the
computer's.

## 6. Rentals

A rented song works until `licence.expires_at`. PerformLive should:

- show "Rental · N days left" on the song;
- check the date when the song is opened. If the machine is offline,
  allow the song for up to 3 days past `expires_at` on the strength of
  the last manifest it saved, then stop;
- when it has expired, keep the files but refuse to load the song,
  with a button to `page` where the person can rent again or buy;
- when it can, re-fetch the manifest on open: a rental that was turned
  into a purchase comes back as `licence.kind = "buy"` and the clock
  goes away.

## 7. The library

    GET https://amanorsac.studio/api/store/library
    Authorization: Bearer <access_token>

```json
{ "items": [
  { "version_id": "…", "kind": "rent", "expires_at": "…", "purchased_at": "…",
    "title": "Praise The Lord", "creator_name": "Kingsley Anyenor", "creator_slug": "kingsley-anyenor",
    "label": "Original", "song_slug": "kingsley-anyenor-praise-the-lord",
    "manifest": "https://amanorsac.studio/api/store/manifest/…",
    "art": "https://amanorsac.studio/store-art/…", "lane": "songs", "version_kind": "song" }
] }
```

Use it for a "My songs" page inside PerformLive, and to notice a
purchase made on the website while the app was open (poll it on
focus, not on a timer).

## 8. Errors and edge cases

- `503 unavailable` — the Worker is not configured (no bucket or no
  secret). Show "the store is not available right now" and stop.
- A track URL answering `404` — the link expired, or the signature is
  wrong. Re-fetch the manifest once; if it is still missing, the file
  is not in the bucket, which is the studio's problem: show the song's
  `page` link and say so.
- The same `version_id` can be installed again at any time; use the
  `etag` per track to skip files already on disk unchanged.
- Two versions of one song (the artist's original and a creator's
  arrangement) are two `version_id`s with the same `song.slug`. Treat
  them as two songs in the library; show `version.label` after the
  title when it is not "Original".

## 9. Trying it

1. Sign in on the website with the account PerformLive will use.
2. Rent something on `/store/` (once the shelf has an approved song),
   or ask the studio to give the account one.
3. `curl -H "Authorization: Bearer <token>" https://amanorsac.studio/api/store/manifest/<id>`
   returns the manifest above. The token is in the browser: Application
   → Local Storage → `sb-kdxckigyhpnwhwgjdgqq-auth-token` → `access_token`.

## 10. What the studio still has to do before creators go live

- Run `supabase-store.sql` in the SQL editor.
- Deploy `create-store-checkout` (Verify JWT on, `STRIPE_SECRET_KEY`)
  and redeploy `stripe-webhook`.
- Make sure the Worker has `DOWNLOAD_SECRET` and `SUPABASE_SERVICE_KEY`
  (it does; the app installers use them).
