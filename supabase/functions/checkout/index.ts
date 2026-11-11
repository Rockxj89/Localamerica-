// Local America checkout: $4.99 one-time GPS unlock per paid place, via Stripe Checkout (live mode).
// The $4.99 price comes from the Stripe product below. The Stripe secret key is NEVER in this file:
// it lives in Supabase Edge Function Secrets under the name STRIPE_SECRET_KEY.
// The browser keeps a random 64-hex access token; only its SHA-256 hash is stored.
// Actions: start (create Stripe session), complete (verify with Stripe after return), unlocked (list unlocked GPS).
import { createClient } from "npm:@supabase/supabase-js@2";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const PRODUCT_ID = "prod_VKHfckosYeFLyO"; // "GPS Unlock" product in the live Stripe account
const PRICE_CENTS = 499;
const CURRENCY = "usd";
const APP_TAG = "local-america-pwa";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function stripe(method: "GET" | "POST", path: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

// Find the active one-time $4.99 USD price on the GPS Unlock product (remembered while the function stays warm).
let cachedPriceId: string | null = null;
async function unlockPriceId() {
  if (cachedPriceId) return cachedPriceId;
  const list = await stripe(
    "GET",
    `prices?product=${encodeURIComponent(PRODUCT_ID)}&active=true&type=one_time&limit=100`,
  );
  const match = (list.data ?? []).find((p: any) => p.unit_amount === PRICE_CENTS && p.currency === CURRENCY);
  if (!match) throw new Error(`No active one-time $4.99 USD price found on product ${PRODUCT_ID}`);
  cachedPriceId = match.id;
  return cachedPriceId!;
}

function safeReturnBase(raw: unknown, req: Request) {
  const candidates = [String(raw ?? ""), req.headers.get("origin") ?? ""];
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (u.protocol === "https:" || u.hostname === "localhost") return `${u.origin}${u.pathname}`;
    } catch { /* try next */ }
  }
  return null;
}

// Ask Stripe whether this checkout was really paid. Unlocks only if Stripe says so.
async function verifyRow(row: any, tokenHash: string) {
  const s = await stripe("GET", `checkout/sessions/${encodeURIComponent(row.stripe_checkout_session_id)}`);
  const m = s.metadata ?? {};
  const matches =
    m.app === APP_TAG &&
    m.browser_token_hash === tokenHash &&
    String(m.location_id ?? "") === String(row.location_id ?? "") &&
    s.mode === "payment";
  if (!matches) return false;
  if (s.status === "expired") {
    await db.from("poi_customer_access").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", row.id);
    return false;
  }
  if (s.status !== "complete" || s.payment_status !== "paid") return false;
  // Belt and braces: the amount Stripe actually collected must be the $4.99 unlock price.
  if (s.amount_total !== PRICE_CENTS || String(s.currency).toLowerCase() !== CURRENCY) {
    console.error("Paid session with unexpected amount", s.id, s.amount_total, s.currency);
    return false;
  }
  await db.from("poi_customer_access").update({
    status: "active",
    user_email: s.customer_details?.email ?? row.user_email ?? null,
    stripe_customer_id: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
    stripe_payment_intent_id: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
    granted_at: row.granted_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action ?? "");
  const token = String(body.token ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return json({ ok: false, error: "This browser cannot save purchases. Turn on site storage and try again." }, 400);
  }
  const tokenHash = await sha256(token.toLowerCase());

  try {
    // ---------- List unlocked GPS for this browser ----------
    if (action === "unlocked") {
      if (STRIPE_KEY) {
        // Catch purchases where the buyer closed the page before coming back.
        const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
        const { data: pending } = await db.from("poi_customer_access")
          .select("*").eq("browser_token_hash", tokenHash).eq("status", "pending")
          .gte("created_at", since).order("id", { ascending: false }).limit(5);
        for (const row of pending ?? []) { try { await verifyRow(row, tokenHash); } catch (e) { console.error(e); } }
      }
      const { data: rows, error } = await db.from("poi_customer_access")
        .select("location_id").eq("browser_token_hash", tokenHash)
        .eq("status", "active").eq("access_type", "location");
      if (error) throw error;
      const ids = [...new Set((rows ?? []).map((r: any) => r.location_id).filter((x: any) => x != null))];
      if (!ids.length) return json({ ok: true, places: [] });
      const { data: locs, error: e2 } = await db.from("poi_locations")
        .select("id, latitude, longitude").in("id", ids);
      if (e2) throw e2;
      return json({ ok: true, places: locs ?? [] });
    }

    if (!STRIPE_KEY) return json({ ok: false, error: "Checkout isn't switched on yet. Please check back soon." }, 503);

    // ---------- Start checkout ----------
    if (action === "start") {
      const locationId = Number(body.locationId);
      if (!Number.isInteger(locationId) || locationId <= 0) return json({ ok: false, error: "Place not found." }, 400);
      const { data: loc } = await db.from("poi_locations")
        .select("id, name, access, status").eq("id", locationId).maybeSingle();
      if (!loc || String(loc.status ?? "").toLowerCase() === "archived") return json({ ok: false, error: "Place not found." }, 404);
      if (String(loc.access).toLowerCase() !== "paid") return json({ ok: false, error: "This place is already free." }, 400);

      const { data: existing } = await db.from("poi_customer_access")
        .select("id").eq("browser_token_hash", tokenHash).eq("location_id", locationId)
        .eq("access_type", "location").eq("status", "active").limit(1);
      if (existing && existing.length) return json({ ok: true, alreadyActive: true });

      const base = safeReturnBase(body.returnUrl, req);
      if (!base) return json({ ok: false, error: "Could not work out where to send you back." }, 400);
      const back = `#/p/${locationId}`;

      const priceId = await unlockPriceId();
      const session = await stripe("POST", "checkout/sessions", {
        mode: "payment",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "metadata[app]": APP_TAG,
        "metadata[access_type]": "location",
        "metadata[location_id]": String(locationId),
        "metadata[browser_token_hash]": tokenHash,
        // Shows up on the payment in the Stripe dashboard so you can tell which place was bought
        "payment_intent_data[description]": `GPS Unlock: ${loc.name} (place #${locationId})`,
        "payment_intent_data[metadata][app]": APP_TAG,
        "payment_intent_data[metadata][location_id]": String(locationId),
        client_reference_id: `la:${tokenHash.slice(0, 16)}:location:${locationId}`,
        success_url: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}${back}`,
        cancel_url: `${base}?checkout=cancelled${back}`,
      });

      const { error } = await db.from("poi_customer_access").insert({
        browser_token_hash: tokenHash,
        location_id: locationId,
        access_type: "location",
        status: "pending",
        stripe_checkout_session_id: session.id,
      });
      if (error) throw error;
      return json({ ok: true, url: session.url });
    }

    // ---------- Confirm after returning from Stripe ----------
    if (action === "complete") {
      const sessionId = String(body.sessionId ?? "").trim();
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({ ok: false, error: "Checkout session is missing." }, 400);
      const { data: row } = await db.from("poi_customer_access")
        .select("*").eq("stripe_checkout_session_id", sessionId)
        .eq("browser_token_hash", tokenHash).in("status", ["pending", "active"]).maybeSingle();
      if (!row) return json({ ok: false, error: "This checkout was started on a different browser." }, 403);
      if (row.status === "active") return json({ ok: true, locationId: row.location_id });
      const paid = await verifyRow(row, tokenHash);
      if (!paid) return json({ ok: false, error: "Payment isn't complete yet." }, 400);
      return json({ ok: true, locationId: row.location_id });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "Checkout had a problem. Please try again." }, 502);
  }
});
