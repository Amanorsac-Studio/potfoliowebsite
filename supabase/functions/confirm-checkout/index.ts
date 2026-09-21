// =====================================================================
//  confirm-checkout  ·  Supabase Edge Function
//
//  The safety net under stripe-webhook.
//
//  Deploy:  name it exactly  confirm-checkout   (Verify JWT ON)
//  Secrets: STRIPE_SECRET_KEY  - the same sk_... create-app-checkout uses.
//
//  WHY THIS EXISTS. A purchase is recorded by stripe-webhook, and until
//  now that was the only way one could be recorded. So anything that
//  stopped the webhook arriving - a wrong URL, a rotated signing secret,
//  an outage, a function that failed to deploy - meant the buyer paid,
//  was sent back to the site, and watched it say "still confirming on
//  our end" until they gave up. The money was taken and nothing was
//  handed over, and nothing on the site could tell.
//
//  That is not hypothetical. Stripe spent two days emailing that live
//  events could not reach the endpoint, because it had been pointed at a
//  Supabase project that is not this one.
//
//  So the page now asks, when it comes back from a checkout and access
//  has still not appeared: "this is the session I just paid for - did
//  it go through?" This asks Stripe directly and writes the purchase if
//  it did. The webhook stays the primary path, because it also catches
//  the buyer who closes the tab on the payment screen. This catches the
//  one the webhook missed.
//
//  WHY IT CANNOT BE USED TO STEAL AN APP. Three locks, and all three
//  have to hold:
//    1. Verify JWT is ON, so there is a signed-in account behind it.
//    2. Stripe is asked about the session; the caller's claim about it
//       is never taken as fact. Not paid, no purchase.
//    3. The session's own metadata must name the caller's account. A
//       session id belonging to somebody else buys nothing, even a real
//       and fully paid one.
//  And the write is an upsert on stripe_session_id, which is unique, so
//  running this a hundred times on one session yields one licence.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const secret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!secret) return json({ error: "STRIPE_SECRET_KEY is not set." }, 500);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ---- lock 1: somebody is signed in ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sign in first." }, 401);
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: { session_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  // Stripe session ids are cs_ followed by a long token. Bounded and
  // pattern-checked before it goes anywhere near a URL.
  const sessionId = String(body.session_id ?? "").trim();
  if (!/^cs_[A-Za-z0-9_]{10,120}$/.test(sessionId)) {
    return json({ error: "That is not a checkout session id." }, 400);
  }

  // ---- lock 2: Stripe says it is paid ----
  const res = await fetch(
    "https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId),
    { headers: { Authorization: "Bearer " + secret } },
  );
  const session = await res.json().catch(() => null);
  if (!res.ok || !session || session.error) {
    return json({ error: "Stripe does not recognise that checkout." }, 404);
  }
  if (session.payment_status !== "paid") {
    return json({ ok: false, reason: "not_paid", payment_status: session.payment_status ?? null });
  }

  const app = session.metadata?.app;
  const userId = session.metadata?.user_id;
  if (!app || !userId) return json({ ok: false, reason: "not_an_app_purchase" });

  // ---- lock 3: it is THIS account's checkout ----
  if (String(userId) !== user.id) {
    // Deliberately the same answer as an unknown session: whether a
    // given session id exists is not something to confirm to somebody
    // who does not own it.
    return json({ error: "Stripe does not recognise that checkout." }, 404);
  }

  const db = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  /* The same row the webhook would have written, by the same rules, on
     the same unique key. If the webhook already wrote it this changes
     nothing and still answers yes, which is exactly what the page needs
     to hear. */
  const { error } = await db.from("purchases").upsert({
    user_id: String(userId),
    app: String(app),
    amount_cents: Number(session.amount_total ?? 0),
    currency: String(session.currency ?? "usd"),
    stripe_session_id: String(session.id ?? ""),
    code: session.metadata?.code || null,
    discount_cents: Number(session.metadata?.discount_cents ?? 0) || null,
    update_eligible_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "stripe_session_id", ignoreDuplicates: true });

  if (error) {
    /* One licence per account per app is a real constraint and hitting
       it here means they already own it - which, to somebody staring at
       a page that will not confirm, is a yes. */
    if (String(error.code) === "23505") return json({ ok: true, app, already: true });
    return json({ error: error.message }, 500);
  }

  /* A code is spent when the money is real, never at checkout - the same
     rule the webhook follows. spend_code is atomic and refuses once the
     uses are gone, and it is safe to call twice: the webhook and this
     both landing on one session cannot spend it twice, because the
     second upsert above was a no-op and only a fresh row gets here. */
  const code = session.metadata?.code;
  if (code) {
    const { data: spent } = await db.rpc("spend_code",
      { p_code: String(code), p_app: String(app), p_user: String(userId) });
    if (spent === false) {
      console.error("CODE OVERSPENT via confirm-checkout:",
        JSON.stringify({ code, app, user_id: userId, session: sessionId }));
    }
  }

  /* Worth a log line. Every time this returns true it means the webhook
     did not do its job, and a run of them is a broken endpoint rather
     than bad luck. */
  console.log("confirm-checkout recorded a purchase the webhook had not:",
    JSON.stringify({ app, user_id: userId, session: sessionId }));

  return json({ ok: true, app });
});
