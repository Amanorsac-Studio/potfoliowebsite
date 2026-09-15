// =====================================================================
//  paystack-webhook  ·  Supabase Edge Function
//
//  Paystack calls this when someone pays. It is the one place a
//  Paystack App Store purchase actually completes - the buyer being
//  redirected back to the site proves nothing, which is why the page
//  polls for access rather than believing the redirect.
//
//  Deploy:  name it exactly  paystack-webhook  ·  Verify JWT OFF
//           (Paystack is not a signed-in user; it proves who it is with
//            the signature checked below.)
//
//  Secrets:
//    PAYSTACK_SECRET_KEY   the same sk_... create-app-paystack uses.
//                          Paystack signs webhooks with the secret key
//                          itself - there is no separate webhook secret
//                          the way Stripe has one.
//
//  At Paystack → Settings → API Keys & Webhooks, set the webhook URL to:
//    https://kdxckigyhpnwhwgjdgqq.supabase.co/functions/v1/paystack-webhook
//
//  Two checks, not one. The signature proves the request came from
//  Paystack; the verify call below proves the transaction really is
//  paid, for the amount and in the currency claimed, by asking Paystack
//  directly rather than believing a body. A webhook body is the only
//  thing between a stranger and a free licence, so it is not trusted on
//  its own even after it is proven authentic.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

/** Paystack signs the raw body with HMAC-SHA512 of the secret key and
 *  puts the hex digest in x-paystack-signature. Compared in constant
 *  time: a byte-by-byte comparison that returns early leaks, one
 *  character at a time, what the right answer would have been. */
async function verify(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const got = header.trim().toLowerCase();
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Ask Paystack what it thinks of this reference. The webhook body says
 *  it is paid; this is Paystack saying so when we asked. */
async function confirm(reference: string, secret: string) {
  const res = await fetch(
    "https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
    { headers: { Authorization: "Bearer " + secret } },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.status !== true) return null;
  return out.data ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  if (!secret) return json({ error: "PAYSTACK_SECRET_KEY not set." }, 500);

  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("x-paystack-signature"), secret))) {
    return json({ error: "Bad signature." }, 400);
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "Bad JSON." }, 400); }

  // Anything else Paystack sends is acknowledged and ignored. A webhook
  // that errors on an event it does not handle gets retried forever.
  if (event.event !== "charge.success") return json({ ignored: event.event });

  const reference = String(event.data?.reference ?? "");
  if (!reference) return json({ ignored: "no reference" });

  const tx = await confirm(reference, secret);
  if (!tx) return json({ error: "Could not verify that transaction with Paystack." }, 502);
  if (tx.status !== "success") return json({ ignored: "not successful: " + tx.status });

  const app = tx.metadata?.app;
  const userId = tx.metadata?.user_id;
  if (!app || !userId) return json({ ignored: "no app or user_id in metadata" });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  /* The reference is what stops a retried delivery selling the same
     payment twice, exactly as stripe_session_id does on the other side.
     It is stored in the same column, prefixed, so the unique index that
     is already there keeps doing its job and one query still answers
     "has this payment been recorded" whichever way it was made.
     amount_cents is what Paystack actually took, in the smallest unit
     of whatever currency it took it in, with the currency beside it -
     so a cedi purchase is never mistaken for a dollar one. */
  const { error } = await db.from("purchases").upsert({
    user_id: String(userId),
    app: String(app),
    amount_cents: Number(tx.amount ?? 0),
    currency: String(tx.currency ?? "GHS").toLowerCase(),
    stripe_session_id: "paystack:" + reference,
    update_eligible_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "stripe_session_id", ignoreDuplicates: true });

  /* One collision is not an error to retry. The purchases table also
     carries a unique (user_id, app) - one licence per account per app,
     which is the whole point of it - so a buyer who somehow got two
     payments away for the same app lands here with a real payment and
     nowhere to put it. Retrying forever would not fix that; a refund
     would. Answer Paystack so it stops, and say plainly in the log
     which reference is owed one. */
  if (error) {
    if (String(error.code) === "23505") {
      console.error("PAYSTACK DOUBLE PAYMENT - refund owed:",
        JSON.stringify({ reference, app, user_id: userId, amount: tx.amount, currency: tx.currency }));
      return json({ ok: true, duplicate: true, reference });
    }
    return json({ error: error.message }, 500);
  }
  /* Same as the Stripe side: the code is spent once the money is real,
     never at checkout, so an abandoned payment does not eat a use. */
  const code = tx.metadata?.code;
  if (code) {
    const { data: spent } = await db.rpc("spend_code",
      { p_code: String(code), p_app: String(app), p_user: String(userId) });
    if (spent === false) {
      console.error("CODE OVERSPENT - a discounted sale went through on a code with no uses left:",
        JSON.stringify({ code, app, user_id: userId, reference }));
    }
  }

  return json({ ok: true, app, user_id: userId, reference });
});
