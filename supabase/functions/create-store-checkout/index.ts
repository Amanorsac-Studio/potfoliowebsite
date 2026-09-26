// =====================================================================
//  create-store-checkout  ·  Supabase Edge Function
//
//  Renting or buying a song from the store. Same shape as
//  create-app-checkout, with the price read from the version's row
//  rather than a fixed map, because creators set their own.
//
//  Deploy:  name it exactly  create-store-checkout   (Verify JWT ON)
//  Secrets: STRIPE_SECRET_KEY - the one create-app-checkout uses.
//
//  The browser calls this with { version: "<uuid>", kind: "rent" | "buy" }.
//  We check the version is on the shelf, that the account does not
//  already own it outright, open a Stripe Checkout Session with the
//  version, the kind and the account stamped into its metadata, and
//  hand back the URL. stripe-webhook reads that metadata back and
//  calls record_store_sale, which is where a rental gets its date.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SITE = "https://amanorsac.studio";
function returnOrigin(req: Request): string {
  const o = req.headers.get("origin") ?? "";
  if (o === SITE) return o;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+){1,2}\.workers\.dev$/.test(o)) return o;
  return SITE;
}

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"),
               "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message ?? "Stripe said no.");
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!Deno.env.get("STRIPE_SECRET_KEY")) return json({ error: "Stripe is not connected yet." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sign in first." }, 401);
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: { version?: string; kind?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  const version = String(body.version ?? "").toLowerCase();
  const kind = body.kind === "rent" ? "rent" : "buy";
  if (!/^[0-9a-f-]{36}$/.test(version)) return json({ error: "No such song." }, 404);

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  // On the shelf, and priced. The public view already filters status.
  const { data: v } = await admin.from("store_shelf")
    .select("id,title,creator_name,label,rent_cents,buy_cents,currency,status").eq("id", version).maybeSingle();
  if (!v) return json({ error: "No such song." }, 404);
  if (v.status !== "approved") return json({ error: "That one is coming soon." }, 409);

  // Bought outright already: nothing to sell. A live rental can still
  // be turned into a purchase, which is the point of offering both.
  const { data: owned } = await admin.from("store_purchases")
    .select("id").eq("user_id", user.id).eq("version_id", version).eq("kind", "buy").limit(1);
  if (owned && owned.length) return json({ already_owned: true });

  const amount = kind === "rent" ? v.rent_cents : v.buy_cents;
  if (!(amount >= 50)) return json({ error: "That song has no price set." }, 500);
  const back = returnOrigin(req);
  const name = v.title + " — " + v.creator_name + (v.label && v.label !== "Original" ? " (" + v.label + ")" : "")
             + (kind === "rent" ? " · 14-day rental" : " · full purchase");

  try {
    const session = await stripe("checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": String(v.currency || "usd"),
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": name,
      customer_email: user.email ?? "",
      "metadata[store_version]": version,
      "metadata[store_kind]": kind,
      "metadata[user_id]": user.id,
      success_url: back + "/store/success?cs={CHECKOUT_SESSION_ID}&v=" + version,
      cancel_url: back + "/store/cancelled",
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
