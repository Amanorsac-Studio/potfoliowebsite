// =====================================================================
//  stripe-webhook  ·  Supabase Edge Function
//
//  Stripe calls this when someone pays. Two different things can be
//  getting paid for, told apart by which metadata key the checkout
//  session carries:
//
//    metadata.invoice_id            a mixing-client invoice, created by
//                                    create-payment-link. Marks it paid;
//                                    the existing notify_on_invoice
//                                    trigger sends the client their
//                                    receipt automatically.
//    metadata.app + metadata.user_id   an App Store purchase, created
//                                    by create-app-checkout. Records a
//                                    row in purchases for that account.
//
//  Nobody clicks anything either way - this is the one place both
//  purchases actually complete.
//
//  Deploy:  name it exactly  stripe-webhook  ·  Verify JWT OFF
//           (Stripe is not a signed-in user; authenticity is proven by
//            the signature check below instead.)
//
//  Secrets:
//    STRIPE_WEBHOOK_SECRET   whsec_... — shown once when you add the
//                            endpoint at Stripe (Developers → Webhooks)
//
//  At Stripe, point the endpoint at:
//    https://kdxckigyhpnwhwgjdgqq.supabase.co/functions/v1/stripe-webhook
//  and send it just one event:  checkout.session.completed
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

/** Verify Stripe's signature: HMAC-SHA256 of `${t}.${rawBody}` with the
 *  webhook secret must match one of the v1 signatures in the header.
 *  Without this check, anyone who found the URL could mark invoices
 *  paid with a curl command. */
async function verify(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string]),
  );
  const t = parts["t"];
  if (!t) return false;
  // Reject stale events: a captured request should not replay next week.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${t}.${raw}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  // The header may carry several v1 entries; any match passes.
  return header.split(",").some((p) => {
    const [k, v] = p.split("=");
    return k === "v1" && v === expected;
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (!secret) return json({ error: "STRIPE_WEBHOOK_SECRET not set." }, 500);

  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("Stripe-Signature"), secret))) {
    return json({ error: "Bad signature." }, 400);
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "Bad JSON." }, 400); }

  // Everything else Stripe might send is acknowledged and ignored —
  // a webhook that errors on unknown events just gets retried forever.
  if (event.type !== "checkout.session.completed") return json({ ignored: event.type });

  const session = event.data?.object ?? {};
  if (session.payment_status && session.payment_status !== "paid") {
    return json({ ignored: "not paid yet: " + session.payment_status });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const invoiceId = session.metadata?.invoice_id;
  const app = session.metadata?.app;
  const userId = session.metadata?.user_id;

  if (app && userId) {
    // An App Store purchase. unique(stripe_session_id) is the real
    // guard against a retried delivery double-selling the same
    // checkout - this on-conflict just keeps a retry from erroring.
    const lineItem = (session.amount_total ?? 0) as number;
    const { error } = await db.from("purchases").upsert({
      user_id: String(userId),
      app: String(app),
      amount_cents: lineItem,
      currency: String(session.currency ?? "usd"),
      stripe_session_id: String(session.id ?? ""),
      code: session.metadata?.code || null,
      discount_cents: Number(session.metadata?.discount_cents ?? 0) || null,
      update_eligible_until: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }, { onConflict: "stripe_session_id", ignoreDuplicates: true });

    if (error) return json({ error: error.message }, 500);

    /* The discount code is spent here and nowhere earlier. A code marked
       spent for a checkout somebody abandoned is a code the next person
       cannot use, so it is only counted once the money has arrived.
       spend_code is atomic and refuses when the uses have run out - if
       that happens the sale still stands, because the buyer paid the
       discounted price in good faith and the shortfall is the studio's
       to wear, not theirs. */
    const code = session.metadata?.code;
    if (code) {
      const { data: spent } = await db.rpc("spend_code",
        { p_code: String(code), p_app: String(app), p_user: String(userId) });
      if (spent === false) {
        console.error("CODE OVERSPENT - a discounted sale went through on a code with no uses left:",
          JSON.stringify({ code, app, user_id: userId, session: session.id }));
      }
    }

    return json({ ok: true, app, user_id: userId });
  }

  if (!invoiceId) return json({ ignored: "no invoice_id or app in metadata" });

  // neq guard: Stripe retries deliveries, and a second "paid" must not
  // re-fire the receipt email.
  const { data, error } = await db.from("invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_session_id: String(session.id ?? ""),
    })
    .eq("id", invoiceId).neq("status", "paid").select("id");

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, updated: (data ?? []).length });
});
