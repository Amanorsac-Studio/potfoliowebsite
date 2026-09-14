# Paystack — turning it on

Everything in the code is finished and deployed. Paystack is switched
**off** in `catalog.json`, so nothing about the site has changed yet: no
buyer sees a second payment button and the checkout endpoint refuses. It
stays that way until you do the six things below.

The whole switch is one word, at the end.

---

## 1 · Check which currency your account can charge

Paystack → **Settings → Preferences** (or ask support).

A Paystack account is registered in one country and can only take the
currencies enabled for it. A Ghanaian account does **GHS** as standard,
and **USD** if you ask them to enable it. A Nigerian account does NGN.

**Charge in the local currency, not USD.** Mobile money only settles in
it. A GHS charge can be paid with MTN, Telecel or AirtelTigo money; the
same charge in USD is card-only, which throws away the reason for being
on Paystack at all.

Whatever it is, put it in `catalog.json` → `paystack.currency`. It is set
to `GHS`.

---

## 2 · Set the rate

`catalog.json` → `paystack.rate_per_usd`, currently **15.8**.

This is the one number that turns each app's dollar price into a local
one, so there is a single figure to keep current instead of a second
price list. Set it a little **above** the mid-market rate — it has to
cover the spread, and a price that moves every week is worse than one
that is a few pesewas generous.

At 15.8 the collection reads:

| App | Dollar | Cedi |
|---|---|---|
| AETHER | $12 | ₵190 |
| AFD Gate | $12 | ₵190 |
| Chordlight 88 | $14 | ₵222 |
| SecondOut | $19 | ₵301 |
| AMB Analog | $39 | ₵617 |
| Align Pro | $39 | ₵617 |
| Nebula Tide 2 | $29 suggested | ₵459 suggested, ₵79 minimum |

`rate_set` is the day you last touched it — a note to yourself, nothing
reads it. If a round local figure matters more than matching the dollar
price for one app, give that app a `paystack_price` in **pesewas**
(`19900` is ₵199) and it wins over the rate.

---

## 3 · Get the secret key

Paystack → **Settings → API Keys & Webhooks** → Secret Key
(`sk_live_...`, or `sk_test_...` while you are trying it).

**This key can move money.** It goes in exactly one place, in step 4. It
must never be in this repository, in a page, in `catalog.json`, or in a
message. If it is ever pasted somewhere it should not be, roll it on that
same screen — the old one stops working immediately.

The *public* key is not needed. This is a server-side redirect, not an
inline popup.

---

## 4 · Add it to Supabase, twice

Supabase → **Edge Functions → Secrets**, add:

```
PAYSTACK_SECRET_KEY = sk_live_...
```

One secret, shared by both functions. Deploy them:

| Function | Verify JWT | Why |
|---|---|---|
| `create-app-paystack` | **ON** | only a signed-in account may start a checkout |
| `paystack-webhook` | **OFF** | Paystack is not a signed-in user; it proves who it is by signing the request |

Unlike Stripe there is no separate webhook secret — Paystack signs
webhooks with the secret key itself.

---

## 5 · Point the webhook at us

Paystack → **Settings → API Keys & Webhooks** → Webhook URL:

```
https://kdxckigyhpnwhwgjdgqq.supabase.co/functions/v1/paystack-webhook
```

**This is the only place a Paystack purchase actually completes.** The
buyer being redirected back to the site proves nothing, which is why the
page waits and asks the database rather than believing the redirect. If
the webhook is not set, people will pay and get nothing.

The endpoint checks twice before it records a sale: the signature proves
the request is really from Paystack, and then it calls Paystack back to
confirm the transaction is genuinely paid, for the amount and currency
claimed. A webhook body is the only thing between a stranger and a free
licence, so it is not trusted on its own even once it is proven
authentic.

---

## 6 · Test it, then switch it on

With `sk_test_...` in place, set `paystack.live` to `true`, push, and buy
something with a [Paystack test
card](https://paystack.com/docs/payments/test-payments/). Check that:

- the button on a product page reads in cedis
- Paystack's page offers mobile money, not only card
- after paying you land back on the app page and it turns into
  **Install in Amanorsac Hub**
- the licence key is in **My Apps**
- the row in `purchases` shows the cedi amount and `GHS`

Then swap the secret for `sk_live_...` and you are selling.

To switch it off again at any time: `paystack.live` back to `false`. The
buttons vanish and the checkout refuses, same minute.

---

## What buyers actually see

The country comes from Cloudflare, which already knows it from the
connection — no lookup service, no permission prompt, nothing an ad
blocker can break.

- **In a Paystack country** (Ghana, Nigeria, Kenya, South Africa and the
  rest of the `countries` list): the cedi price on the main button, with
  *Pay by card instead* as a quiet second door — somebody in Accra with
  an international card should not have to hunt for it.
- **Everywhere else**: Stripe only. Paystack's rails do not reach a card
  in London, and a button that fails slowly is worse than no button.

Because each product page writes its price into the prose in dollars, a
line under the button says which is which: *₵190 is $12 at today's rate.*

Nebula Tide 2 keeps naming its own price. Stripe has that box on its own
checkout page; Paystack has to be told a figure up front, so the box
appears on our page instead, and the function clamps whatever arrives to
the same minimum either way.

---

## Where the money lands, and what it does not change

A Paystack purchase writes the same `purchases` row a Stripe one does, so
My Apps, the licence key, the device limit, the Hub and the download
endpoint cannot tell the two apart and did not need changing.

The reference is stored in `stripe_session_id` prefixed with `paystack:`
— a slightly ugly column name for a second processor, but it means the
unique index already on that column keeps stopping a retried delivery
from selling the same payment twice, and one query still answers "has
this payment been recorded" whichever way it was made.

**One thing to know.** If a buyer somehow gets two payments away for the
same app, the second has nowhere to go — one licence per account per app
is the rule the table enforces. The webhook answers Paystack so it stops
retrying and writes `PAYSTACK DOUBLE PAYMENT - refund owed` to the
function log with the reference. Worth a glance at those logs
occasionally; it should never happen, and if it does somebody is owed
their money back. The Stripe side has the same gap and has always had it.
