// =====================================================================
//  create-app-checkout  ·  Supabase Edge Function
//
//  Buying an app from the App Store, not a mixing invoice - so unlike
//  create-payment-link this is callable by any signed-in visitor, not
//  just an admin, and the price comes from a fixed catalog in this
//  file rather than a row someone already typed a number into.
//
//  Deploy:  name it exactly  create-app-checkout   (Verify JWT can stay
//  ON - callers are any signed-in account, checked below same as
//  create-payment-link checks for an admin one.)
//
//  Secrets:
//    STRIPE_SECRET_KEY   sk_live_... (or sk_test_... while testing) -
//                        the same secret create-payment-link already
//                        uses; nothing new to add if that one works.
//
//  Flow: the browser calls this with { app: "secondout" }. We check the
//  account doesn't already own it, open a Stripe Checkout Session with
//  the app and the account's id stamped into its metadata, and hand
//  back the URL to redirect to. stripe-webhook reads that same
//  metadata back out once Stripe confirms payment - that is the
//  thread the purchase finds its way home on, same idea as the
//  invoice_id thread create-payment-link leaves for itself.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });

const SITE = "https://amanorsac.studio";

/** Where Stripe sends the buyer back to once they have paid.
 *
 *  Normally the live site. On a preview build it is that build's own
 *  workers.dev address, so a test purchase lands back on the page it
 *  started from instead of on a live URL that may not exist yet.
 *
 *  Anything else falls back to SITE and is never echoed: an unchecked
 *  origin here would be an open redirect with a payment attached to it. */
function returnOrigin(req: Request): string {
  const o = req.headers.get("origin") ?? "";
  if (o === SITE) return o;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+){1,2}\.workers\.dev$/.test(o)) return o;
  return SITE;
}

/** Every app anyone can actually buy, and what it costs. A fixed map,
 *  the same reasoning worker.js's INSTALLERS map uses: no request can
 *  invent a price or a product name that is not on this list.
 *
 *  An entry carries either a fixed amount_cents, or a stripe_price: the
 *  id of a Price created in Stripe. The second form is what makes "pay
 *  what you want" possible - a Price with "customers choose what to
 *  pay" turned on has the minimum, maximum and suggested figure stored
 *  on Stripe's side, and Checkout shows the buyer a box to type in.
 *  Either way the buyer cannot name a figure this file did not allow:
 *  with amount_cents the number is here, and with stripe_price the
 *  bounds are on the Price. stripe-webhook records what was actually
 *  paid, so a purchase row is always the real amount. */
const APP_CATALOG: Record<string, { amount_cents?: number; stripe_price?: string; label: string }> = {
  secondout: {
    amount_cents: 1900,
    label: "SecondOut — lifetime license, one year of updates included",
  },
  stemsorter: {
    amount_cents: 1900,
    label: "Stem Sorter — lifetime license for two computers, one year of updates included",
  },
  afdgate: {
    amount_cents: 1200,
    label: "AFD Gate — lifetime licence, no activation",
  },
  aether: {
    amount_cents: 1200,
    label: "AETHER — lifetime licence for two computers, one year of updates included",
  },
  ambanalog: {
    amount_cents: 3900,
    label: "AMB Analog — ten plug-ins, lifetime licence for two computers",
  },
  alignpro: {
    amount_cents: 3900,
    label: "Align Pro — lifetime licence for two computers, one year of updates included",
  },
  nebulatide2: {
    // Pay what you want. The figures live on the Price in Stripe -
    // $5 minimum, $100 maximum, $29 suggested - so changing what people
    // may pay is done there and needs no deploy here.
    stripe_price: "price_1UEF1E06LBP0UxjsM9VMPGux",
    label: "Nebula Tide 2 — lifetime license for two machines, one year of updates included",
  },
};

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message ?? "Stripe said no.");
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  if (!Deno.env.get("STRIPE_SECRET_KEY")) {
    return json({ error: "Stripe is not connected yet: add STRIPE_SECRET_KEY to this function's secrets." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ---- caller must be signed in - any account, not just an admin ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sign in first." }, 401);
  const asCaller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: { app?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  const app = String(body.app ?? "").toLowerCase().trim();
  const item = APP_CATALOG[app];
  if (!item) return json({ error: "No such app for sale." }, 404);
  if (!item.stripe_price && typeof item.amount_cents !== "number") {
    return json({ error: "That app has no price set up yet." }, 500);
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Already bought it - do not sell it to them twice. Checked with the
  // service key because RLS on purchases only ever lets someone read
  // their own row anyway, but this is explicit rather than incidental.
  const { data: existing } = await admin.from("purchases")
    .select("id").eq("user_id", user.id).eq("app", app).limit(1);
  if (existing && existing.length) return json({ already_owned: true });

  const back = returnOrigin(req);

  try {
    // One line item, priced one of the two ways above.
    const priced: Record<string, string> = item.stripe_price
      ? { "line_items[0][price]": item.stripe_price }
      : {
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(item.amount_cents),
        "line_items[0][price_data][product_data][name]": item.label,
      };

    const session = await stripe("checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      ...priced,
      customer_email: user.email ?? "",
      // This is the thread stripe-webhook follows back to this account.
      "metadata[app]": app,
      "metadata[user_id]": user.id,
      // Back to the app's own page, not the portal - there is no "My
      // Apps" section there yet for this to land in usefully.
      success_url: back + "/" + app + "?purchased=1",
      cancel_url: back + "/" + app + "?checkout=cancelled",
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
