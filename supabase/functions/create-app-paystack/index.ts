// =====================================================================
//  create-app-paystack  ·  Supabase Edge Function
//
//  The African half of the App Store checkout. Same job as
//  create-app-checkout - a signed-in visitor buys one app - but the
//  payment goes through Paystack instead of Stripe, which is what puts
//  mobile money, bank transfer and local cards on the page.
//
//  Deploy:  name it exactly  create-app-paystack   (Verify JWT ON)
//
//  Secrets:
//    PAYSTACK_SECRET_KEY   sk_live_... (or sk_test_... while testing),
//                          from Paystack → Settings → API Keys.
//                          This key can move money. It belongs here and
//                          nowhere else: never in the repository, never
//                          in a page, never in catalog.json. The public
//                          key is not needed - this is a server-side
//                          redirect flow, not an inline popup.
//
//  Flow: the browser calls this with { app: "aether" }. We check the
//  account does not already own it, work the price out from the
//  website's own catalog, initialise a Paystack transaction with the
//  app and the account id in its metadata, and hand back the
//  authorization_url to send the buyer to. paystack-webhook reads that
//  metadata back out once Paystack confirms - the same thread
//  stripe-webhook follows, so a purchase lands in the same table and
//  My Apps cannot tell which way somebody paid.
//
//  WHY THE LOCAL CURRENCY. Mobile money only settles in it. A GHS
//  charge can be paid with MTN, Telecel or AirtelTigo; the same charge
//  in USD is card-only, which throws away the reason for being here.
//  The currency is whichever single one the Paystack account is
//  registered for - it is set in catalog.json, not per buyer.
//
//  WHY THE PRICE IS NOT SENT BY THE PAGE. It is read from catalog.json
//  here, on the server, every time. The page is told a figure so it can
//  label a button; this file works it out again before charging, so a
//  request that names its own total is simply ignored. The exception is
//  a name-your-price app, where a typed amount is accepted and then
//  clamped to the minimum and maximum the catalog allows.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const SITE = "https://amanorsac.studio";

/** Where Paystack sends the buyer back to. Same reasoning as
 *  create-app-checkout: the live site, or a preview build's own
 *  workers.dev address, and anything else falls back to SITE rather
 *  than being echoed. An unchecked origin here is an open redirect
 *  with a payment attached to it. */
function returnOrigin(req: Request): string {
  const o = req.headers.get("origin") ?? "";
  if (o === SITE) return o;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+){1,2}\.workers\.dev$/.test(o)) return o;
  return SITE;
}

type App = {
  name?: string;
  free?: boolean;
  status?: string;
  price_cents?: number;
  price_min_cents?: number;
  pay_what_you_want?: boolean;
  paystack_price?: number;
};
type Pay = {
  live?: boolean;
  currency?: string;
  rate_per_usd?: number;
  round_to?: number;
};

/** The website's own catalog, read fresh. It is a public file, so this
 *  needs no key - and reading it rather than keeping a second price
 *  list in this file is the point: one place decides what an app
 *  costs, and it is the same place the shelf reads. */
async function catalog(): Promise<{ apps: Record<string, App>; paystack?: Pay }> {
  const res = await fetch(SITE + "/catalog.json", { cache: "no-store" });
  if (!res.ok) throw new Error("The catalog could not be read.");
  return await res.json();
}

/** The charge, in the smallest unit of the account's currency -
 *  pesewas, kobo, cents. Mirrors paystackAmount() in worker.js; if one
 *  changes the other has to, which is why both are three lines. */
function amountFor(pay: Pay, app: App, usdCents?: number): number | null {
  if (typeof app.paystack_price === "number" && usdCents === undefined) return app.paystack_price;
  const usd = usdCents ?? (app.free ? 0 : (app.price_cents ?? 0));
  if (!usd) return null;
  const rate = Number(pay.rate_per_usd);
  if (!isFinite(rate) || rate <= 0) return null;
  const step = Number(pay.round_to) > 0 ? Number(pay.round_to) : 1;
  return Math.ceil((usd / 100) * rate * 100 / step) * step;
}

/** A dollar figure turned into the account's currency, for a code that
 *  takes a fixed amount off rather than a percentage. */
function localFromUsd(pay: Pay, usdCents: number): number {
  const rate = Number(pay.rate_per_usd);
  if (!usdCents || !isFinite(rate) || rate <= 0) return 0;
  return Math.round((usdCents / 100) * rate * 100);
}

/** What to say when a code will not work. The same sentences the redeem
 *  page uses, because it is the same disappointment. */
function codeWords(err?: string): string {
  switch (err) {
    case "expired":             return "That code has passed its date.";
    case "all_used":            return "That code has been used as many times as it was meant to be.";
    case "already_used_by_you": return "You have already used that code.";
    case "wrong_app":           return "That code is not for this app.";
    default:                    return "No code like that. Check for a typo - codes never contain the letter O or the digit 0.";
  }
}

async function paystack(path: string, body: unknown) {
  const res = await fetch("https://api.paystack.co/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + Deno.env.get("PAYSTACK_SECRET_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.status === false) {
    // Paystack's own words are usually the useful ones here - an
    // unenabled currency, for instance, says so precisely.
    throw new Error(out?.message ?? "Paystack said no.");
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  if (!Deno.env.get("PAYSTACK_SECRET_KEY")) {
    return json({ error: "Paystack is not connected yet: add PAYSTACK_SECRET_KEY to this function's secrets." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ---- caller must be signed in - any account ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sign in first." }, 401);
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!user.email) return json({ error: "This account has no email address to send a receipt to." }, 400);

  let body: { app?: string; amount?: number; code?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  const app = String(body.app ?? "").toLowerCase().trim();
  const code = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);

  let c: Awaited<ReturnType<typeof catalog>>;
  try { c = await catalog(); } catch (e) { return json({ error: (e as Error).message }, 502); }

  const pay = c.paystack ?? {};
  if (!pay.live) return json({ error: "Paystack is not switched on." }, 400);
  if (!pay.currency) return json({ error: "No Paystack currency is set in the catalog." }, 500);

  const item = c.apps?.[app];
  if (!item) return json({ error: "No such app for sale." }, 404);
  if (item.free) return json({ error: "That app is free - there is nothing to pay." }, 400);
  // An app the studio has taken off the shelf sells nothing, the same
  // way /api/app-download hands nothing out for one.
  if (item.status && item.status !== "available") {
    return json({ error: (item.name ?? app) + " is not on sale right now." }, 403);
  }

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  /* A name-your-price app may be told what to charge; everything else
     may not. Either way the figure is clamped here, against the
     catalog's own minimum and a ceiling of a hundred times the
     suggested price - a typo with four extra zeros should not become a
     charge somebody has to ring their bank about. */
  let amount: number | null;
  if (item.pay_what_you_want && typeof body.amount === "number" && isFinite(body.amount)) {
    const floor = amountFor(pay, item, item.price_min_cents ?? 0) ?? 0;
    const suggested = amountFor(pay, item) ?? 0;
    amount = Math.min(Math.max(Math.round(body.amount), floor), suggested * 100 || Number.MAX_SAFE_INTEGER);
  } else {
    amount = amountFor(pay, item);
  }
  if (!amount || amount < 1) return json({ error: "That app has no Paystack price set up yet." }, 500);

  /* A discount code, if one came with the request. Looked up here and
     applied here: the page was told what it is worth so it could show a
     figure, and that figure is not trusted - this is worked out again
     from the code's own row. An invalid code is refused rather than
     quietly ignored, because somebody who typed one is expecting it to
     count and should be told if it did not. */
  let discount: { percent_off?: number; amount_off_cents?: number } | null = null;
  const fullAmount = amount;            // before any code, for the record
  if (code) {
    const { data: d } = await admin.rpc("code_value",
      { p_code: code, p_app: app, p_user: user.id });
    if (!d?.ok) return json({ error: codeWords(d?.error), code_error: d?.error ?? "no_such_code" }, 400);
    discount = d;
    const off = d.percent_off
      ? Math.round(amount * d.percent_off / 100)
      : Math.min(localFromUsd(pay, d.amount_off_cents ?? 0), amount);
    // Both processors refuse a tiny charge; 100% off is an access code's job.
    amount = Math.max(100, amount - off);
  }

  // Already owns it - do not sell it twice.
  const { data: existing } = await admin.from("purchases")
    .select("id").eq("user_id", user.id).eq("app", app).limit(1);
  if (existing && existing.length) return json({ already_owned: true });

  const back = returnOrigin(req);

  try {
    const out = await paystack("transaction/initialize", {
      email: user.email,
      amount,                                   // smallest unit, as Paystack wants it
      currency: pay.currency,
      // The thread paystack-webhook follows back to this account.
      metadata: {
        app,
        user_id: user.id,
        // What the webhook spends once the money is real, and what it
        // records. In the account's own currency, like the charge.
        code: code || null,
        discount_cents: Math.max(0, (fullAmount ?? 0) - (amount ?? 0)),
        // Shown on the Paystack dashboard next to the payment, so a
        // transaction is readable without looking anything up.
        custom_fields: [
          { display_name: "App", variable_name: "app", value: item.name ?? app },
          { display_name: "Account", variable_name: "email", value: user.email },
        ],
      },
      callback_url: back + "/" + app + "?purchased=1",
      channels: ["card", "mobile_money", "bank_transfer", "ussd", "bank", "qr"],
    });

    const auth = out?.data?.authorization_url;
    if (!auth) return json({ error: "Paystack did not return a checkout link." }, 502);
    return json({ url: auth, reference: out?.data?.reference ?? null, amount,
                  currency: pay.currency, discount });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
