# Sending the PerformLive announcement

Two files, one message:

- `performlive-announce.html` — the email
- `performlive-announce.txt` — the plain-text alternative

**Send both.** A message with no text part looks like spam to every
filter there is, and it is what a watch, a screen reader and a text-only
client fall back to.

---

## Before you send anything to 1,200 people

**1. Your domain must be verified in Resend.** Resend → Domains →
`amanorsac.studio` must show SPF and DKIM verified. Without them, a
1,200-address send goes to spam *and* damages the domain your licence
keys and receipts are sent from. That is the expensive failure here: the
marketing email not landing costs you a campaign, the transactional mail
not landing costs you customers.

Add DMARC too if it is not there — a TXT record at `_dmarc.amanorsac.studio`
with `v=DMARC1; p=none; rua=mailto:you@amanorsac.studio`. `p=none` only
watches; it rejects nothing.

**2. Put a real postal address in both files.** Search for
`[YOUR POSTAL ADDRESS]`. Commercial email legally requires one in most
countries, and filters look for it. A PO box is fine.

**3. Know where the list came from.** Every address should have asked to
hear from you — signed up on the site, bought something, or opted in.
If part of the 1,200 came from somewhere else, send only to the part
that did. Resend suspends accounts over complaint rates, and a
suspension takes your licence-key emails down with it.

---

## Sending it — Resend Broadcasts

Easiest and safest, because Resend handles unsubscribes, throttling and
the List-Unsubscribe header for you.

1. Resend → **Audiences** → make sure the 1,200 are in one.
2. Resend → **Broadcasts** → New broadcast → that audience.
3. Subject — pick one and A/B it if Resend lets you:
   - `Your stems, untouched, under your fingers`
   - `PerformLive is ready — free for 30 days`
   - `The thing between a DAW and a stereo bounce`
4. Paste `performlive-announce.html` into the HTML view.
5. Paste `performlive-announce.txt` into the plain-text view.
6. **Send a test to yourself first.** Open it on a phone and on a
   desktop, and once with images off.
7. Send.

`{{{RESEND_UNSUBSCRIBE_URL}}}` is already in both files. Broadcasts
swaps it for a working link. Leave it exactly as it is, triple braces
and all.

### Do not send all 1,200 at once

A domain that has only ever trickled out licence keys suddenly sending
1,200 marketing emails looks exactly like a compromised account, and
inbox providers treat it that way. Spread it:

| Day | Send to | Then |
|-----|---------|------|
| 1 | 100 | check opens, bounces, complaints |
| 2 | 200 | stop if bounces are over 3% or complaints over 0.1% |
| 3 | 400 | |
| 4 | the rest | |

Resend shows all three numbers. A high bounce rate means the list is
stale, and continuing makes it worse.

---

## Sending it from the Worker instead

Only worth it if the 1,200 are not in a Resend audience. The Worker
already talks to Resend (`sendUpdateNotice` in `worker.js`) and already
has a signed opt-out at `/notices/stop`, so the parts exist.

Two things would have to be added, and neither is optional:

- Replace `{{{RESEND_UNSUBSCRIBE_URL}}}` with the signed stop link the
  notice emails already build:
  `SITE + '/notices/stop?e=' + encodeURIComponent(email) + '&s=' + sig`
- Send a `List-Unsubscribe` header as well, or Gmail will not show the
  one-click unsubscribe and more people will press Spam instead.

Resend's batch endpoint takes 100 messages per call, so 1,200 is twelve
calls, and `notice_optouts` must be checked before each one.

Ask and I will build it.
