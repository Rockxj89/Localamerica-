// Tests for the checkout function exactly as it is deployed (supabase/functions/checkout/index.ts).
// It runs here against a pretend Stripe and a pretend database, so no money moves and nothing live is touched.
// Run from the repo root: deno test --allow-env tests/unit/checkout.test.ts
import nodeAssert from "node:assert/strict";

const assert = (cond: unknown, msg?: string) => nodeAssert.ok(cond, msg);
const assertEquals = (actual: unknown, expected: unknown, msg?: string) => nodeAssert.deepStrictEqual(actual, expected, msg);

type Row = Record<string, any>;
const PRODUCT = "prod_VKHfckosYeFLyO";
const DB_URL = "http://pretend-database.test";
const HOUR = 3600 * 1000;

// ---------- pretend world ----------
let db: Record<string, Row[]> = {};
let stripeCalls: { method: string; path: string; params: URLSearchParams }[] = [];
let prices: Row[] = [];
let sessions: Record<string, Row> = {};
let nextId = 1;
let sessionCount = 0;

function reset() {
  db = {
    poi_locations: [
      { id: 10, name: "Campsite #8", access: "Paid", status: "Draft", latitude: 37.1, longitude: -92.2 },
      { id: 11, name: "Dead End #1", access: "Free", status: "Draft", latitude: 37.5, longitude: -92.3 },
      { id: 12, name: "Old place", access: "Paid", status: "Archived", latitude: 37.3, longitude: -92.4 },
      { id: 13, name: "Bluff #2", access: "Paid", status: "Draft", latitude: 36.9, longitude: -92.1 },
    ],
    poi_customer_access: [],
  };
  stripeCalls = [];
  prices = [{ id: "price_499", unit_amount: 499, currency: "usd" }, { id: "price_eur", unit_amount: 499, currency: "eur" }];
  sessions = {};
  nextId = 1;
}

// Only the database calls the checkout function makes (supabase-js talking to PostgREST)
function matches(row: Row, sp: URLSearchParams) {
  for (const [key, raw] of sp) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot), val = decodeURIComponent(raw.slice(dot + 1));
    const v = row[key];
    if (op === "eq" && String(v) !== val) return false;
    if (op === "gte" && !(String(v) >= val)) return false;
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      if (!list.includes(String(v))) return false;
    }
    if (!["eq", "gte", "in"].includes(op)) throw new Error("Pretend database can't do " + op);
  }
  return true;
}
function pretendDatabase(url: URL, method: string, headers: Headers, body: string | null): Response {
  const table = url.pathname.replace("/rest/v1/", "");
  if (!(table in db)) throw new Error("Unexpected table " + table);
  const rows = db[table];
  const sp = url.searchParams;
  if (method === "GET" || method === "HEAD") {
    let out = rows.filter((r) => matches(r, sp));
    const order = sp.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      out = out.slice().sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1));
    }
    const limit = sp.get("limit");
    if (limit) out = out.slice(0, Number(limit));
    const select = sp.get("select");
    if (select && select !== "*") {
      const cols = select.split(",");
      out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }
    const h = new Headers({ "content-type": "application/json", "content-range": `0-${Math.max(out.length - 1, 0)}/${out.length}` });
    if (method === "HEAD") return new Response(null, { status: 200, headers: h });
    if ((headers.get("accept") || "").includes("vnd.pgrst.object")) {
      if (out.length !== 1) return new Response(JSON.stringify({ code: "PGRST116", message: "not one row" }), { status: 406, headers: h });
      return new Response(JSON.stringify(out[0]), { status: 200, headers: h });
    }
    return new Response(JSON.stringify(out), { status: 200, headers: h });
  }
  if (method === "POST") {
    const add = JSON.parse(body || "{}");
    for (const r of Array.isArray(add) ? add : [add]) rows.push({ id: nextId++, created_at: new Date().toISOString(), ...r });
    return new Response(null, { status: 201 });
  }
  if (method === "PATCH") {
    const change = JSON.parse(body || "{}");
    rows.filter((r) => matches(r, sp)).forEach((r) => Object.assign(r, change));
    return new Response(null, { status: 204 });
  }
  throw new Error("Unexpected database call " + method);
}

function pretendStripe(url: URL, method: string, body: URLSearchParams): Response {
  const path = url.pathname.replace("/v1/", "");
  stripeCalls.push({ method, path, params: body });
  const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
  if (method === "GET" && path === "prices") {
    assertEquals(url.searchParams.get("product"), PRODUCT);
    return ok({ data: prices });
  }
  if (method === "POST" && path === "checkout/sessions") {
    const id = `cs_test_pretend${++sessionCount}`;
    sessions[id] = { id, url: `https://checkout.stripe.com/c/pay/${id}`, params: Object.fromEntries(body) };
    return ok({ id, url: sessions[id].url });
  }
  const m = /^checkout\/sessions\/(.+)$/.exec(path);
  if (method === "GET" && m) {
    const s = sessions[decodeURIComponent(m[1])];
    if (!s) return new Response(JSON.stringify({ error: { message: "No such session" } }), { status: 404 });
    return ok(s);
  }
  throw new Error("Unexpected Stripe call " + method + " " + path);
}

// Every outside call the function makes lands in the pretend world. Nothing reaches the internet.
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  const method = (init?.method || req?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers || req?.headers);
  if (url.origin === DB_URL) {
    const body = init?.body == null ? null : String(init.body);
    return pretendDatabase(url, method, headers, body);
  }
  if (url.hostname === "api.stripe.com") {
    assertEquals(headers.get("authorization"), "Bearer sk_test_pretend");
    return pretendStripe(url, method, new URLSearchParams(init?.body ? String(init.body) : ""));
  }
  throw new Error("The checkout function tried to reach " + url.href);
};

Deno.env.set("STRIPE_SECRET_KEY", "sk_test_pretend");
Deno.env.set("SUPABASE_URL", DB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "pretend-service-key");
let handler: (req: Request) => Promise<Response>;
// The function starts its own web server when loaded; here we just keep its request handler.
Object.defineProperty(Deno, "serve", {
  configurable: true, writable: true,
  value: (h: any) => { handler = typeof h === "function" ? h : h.handler; return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {} }; },
});
await import("../../supabase/functions/checkout/index.ts");

// ---------- helpers ----------
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function call(body: Row, extraHeaders: Record<string, string> = {}) {
  const res = await handler(new Request("http://localhost/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://localamerica.us", ...extraHeaders },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}
const start = (t: string, locationId: unknown, extra: Row = {}) =>
  call({ action: "start", token: t, locationId, returnUrl: "https://localamerica.us/", ...extra });
const purchases = () => db.poi_customer_access;
const sessionCalls = () => stripeCalls.filter((c) => c.method === "POST" && c.path === "checkout/sessions");

// A Stripe session as Stripe reports it after a real $4.99 payment
async function paidSession(id: string, t: string, locationId: number, change: Row = {}) {
  const base = sessions[id];
  sessions[id] = {
    ...base, id, mode: "payment", status: "complete", payment_status: "paid", amount_total: 499, currency: "usd",
    metadata: { app: "local-america-pwa", access_type: "location", location_id: String(locationId), browser_token_hash: await sha256(t) },
    customer_details: { email: "buyer@example.com" }, customer: "cus_pretend", payment_intent: "pi_pretend", ...change,
  };
}

// ---------- tests (they run in this order) ----------
Deno.test({ name: "won't sell anything if Stripe has no $4.99 USD price", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  prices = [{ id: "price_999", unit_amount: 999, currency: "usd" }];
  const r = await start(token(), 10);
  assertEquals(r.json.ok, false);
  assertEquals(sessionCalls().length, 0);
  assertEquals(purchases().length, 0);
} });

Deno.test({ name: "starts a $4.99 Stripe checkout for a paid place, tied to this browser", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token();
  const r = await start(t, 10);
  assertEquals(r.status, 200);
  assertEquals(r.json.ok, true);
  assert(String(r.json.url).startsWith("https://checkout.stripe.com/"));
  const [s] = sessionCalls();
  const p = Object.fromEntries(s.params);
  assertEquals(p["mode"], "payment");
  assertEquals(p["line_items[0][price]"], "price_499");
  assertEquals(p["line_items[0][quantity]"], "1");
  assertEquals(p["metadata[app]"], "local-america-pwa");
  assertEquals(p["metadata[location_id]"], "10");
  assertEquals(p["metadata[browser_token_hash]"], await sha256(t));
  assert(p["success_url"].startsWith("https://localamerica.us/?checkout=success&session_id={CHECKOUT_SESSION_ID}"));
  assert(p["success_url"].endsWith("#/p/10"));
  assert(p["cancel_url"].startsWith("https://localamerica.us/?checkout=cancelled"));
  assert(!JSON.stringify(s.params.toString()).includes(t), "the browser's private token was sent to Stripe");
  assertEquals(purchases().length, 1);
  assertEquals(purchases()[0].status, "pending");
  assertEquals(purchases()[0].browser_token_hash, await sha256(t));
  assert(!JSON.stringify(db).includes(t), "the browser's private token was saved instead of its hash");
} });

Deno.test({ name: "won't sell a free place, an archived place or a place that doesn't exist", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  for (const [id, status] of [[11, 400], [12, 404], [999, 404], [0, 400], [-3, 400], ["abc", 400]] as const) {
    const r = await start(token(), id);
    assertEquals(r.json.ok, false, `place ${id}`);
    assertEquals(r.status, status, `place ${id}`);
  }
  assertEquals(sessionCalls().length, 0);
  assertEquals(purchases().length, 0);
} });

Deno.test({ name: "every step needs this browser's private token", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  for (const bad of ["", "abc", "z".repeat(64), token().slice(1)]) {
    for (const action of ["start", "complete", "unlocked"]) {
      const r = await call({ action, token: bad, locationId: 10, sessionId: "cs_test_x" });
      assertEquals(r.status, 400, `${action} with token "${bad.slice(0, 8)}"`);
    }
  }
  assertEquals(stripeCalls.length, 0);
} });

Deno.test({ name: "a place already bought in this browser isn't sold again", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token();
  db.poi_customer_access.push({ id: 900, browser_token_hash: await sha256(t), location_id: 10, access_type: "location", status: "active", created_at: new Date().toISOString() });
  const r = await start(t, 10);
  assertEquals(r.json, { ok: true, alreadyActive: true });
  assertEquals(sessionCalls().length, 0);
} });

Deno.test({ name: "limits: 6 unpaid checkouts an hour per browser, 150 an hour for the whole site", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token(), h = await sha256(t), recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  for (let i = 0; i < 6; i++) db.poi_customer_access.push({ id: 100 + i, browser_token_hash: h, location_id: 13, access_type: "location", status: "pending", created_at: recent });
  let r = await start(t, 10);
  assertEquals(r.status, 429);
  // Old unpaid tries (over an hour ago) don't count
  for (const row of db.poi_customer_access) row.created_at = new Date(Date.now() - 2 * HOUR).toISOString();
  r = await start(t, 10);
  assertEquals(r.json.ok, true);
  reset();
  for (let i = 0; i < 150; i++) db.poi_customer_access.push({ id: 1000 + i, browser_token_hash: `other${i}`, location_id: 13, access_type: "location", status: "pending", created_at: recent });
  r = await start(token(), 10);
  assertEquals(r.status, 429);
  assertEquals(sessionCalls().length, 0);
} });

Deno.test({ name: "unlocks only after Stripe says the $4.99 was paid", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token();
  await start(t, 10);
  const id = Object.keys(sessions)[0];
  let r = await call({ action: "complete", token: t, sessionId: id }); // not paid yet
  assertEquals(r.json.ok, false);
  assertEquals((await call({ action: "unlocked", token: t })).json.places, []);
  await paidSession(id, t, 10);
  r = await call({ action: "complete", token: t, sessionId: id });
  assertEquals(r.json, { ok: true, locationId: 10 });
  assertEquals(purchases()[0].status, "active");
  const u = await call({ action: "unlocked", token: t });
  assertEquals(u.json.places, [{ id: 10, latitude: 37.1, longitude: -92.2 }]);
} });

Deno.test({ name: "doesn't unlock when anything about the payment is off", sanitizeOps: false, sanitizeResources: false, async fn() {
  const bad: [string, Row | null][] = [
    ["unpaid", { payment_status: "unpaid" }], ["still open", { status: "open" }], ["wrong amount", { amount_total: 100 }],
    ["wrong currency", { currency: "eur" }], ["subscription", { mode: "subscription" }],
    ["another app", { metadata: { app: "something-else", location_id: "10", browser_token_hash: "" } }],
    ["another place", null], ["another browser", null],
  ];
  for (const [label, change] of bad) {
    reset();
    const t = token();
    await start(t, 10);
    const id = Object.keys(sessions)[0];
    if (label === "another place") await paidSession(id, t, 13);
    else if (label === "another browser") await paidSession(id, token(), 10);
    else await paidSession(id, t, 10, change!);
    const r = await call({ action: "complete", token: t, sessionId: id });
    assertEquals(r.json.ok, false, label);
    assertEquals(purchases()[0].status, "pending", label);
    assertEquals((await call({ action: "unlocked", token: t })).json.places, [], label);
  }
} });

Deno.test({ name: "an expired checkout is marked expired and never unlocks", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token();
  await start(t, 10);
  const id = Object.keys(sessions)[0];
  await paidSession(id, t, 10, { status: "expired", payment_status: "unpaid" });
  const r = await call({ action: "complete", token: t, sessionId: id });
  assertEquals(r.json.ok, false);
  assertEquals(purchases()[0].status, "expired");
} });

Deno.test({ name: "a checkout started in another browser can't be finished here", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const buyer = token(), other = token();
  await start(buyer, 10);
  const id = Object.keys(sessions)[0];
  await paidSession(id, buyer, 10);
  const r = await call({ action: "complete", token: other, sessionId: id });
  assertEquals(r.status, 403);
  assertEquals(purchases()[0].status, "pending");
  assertEquals((await call({ action: "unlocked", token: other })).json.places, []);
} });

Deno.test({ name: "a made-up session is refused without asking Stripe", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token();
  assertEquals((await call({ action: "complete", token: t, sessionId: "nope" })).status, 400);
  assertEquals((await call({ action: "complete", token: t, sessionId: "cs_live_madeup123" })).status, 403);
  assertEquals(stripeCalls.length, 0);
} });

Deno.test({ name: "each browser only gets the GPS it paid for", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const a = token(), b = token();
  db.poi_customer_access.push(
    { id: 1, browser_token_hash: await sha256(a), location_id: 10, access_type: "location", status: "active", created_at: new Date().toISOString() },
    { id: 2, browser_token_hash: await sha256(b), location_id: 13, access_type: "location", status: "active", created_at: new Date().toISOString() },
    { id: 3, browser_token_hash: await sha256(b), location_id: 12, access_type: "location", status: "expired", created_at: new Date().toISOString() },
  );
  assertEquals((await call({ action: "unlocked", token: a })).json.places.map((p: Row) => p.id), [10]);
  assertEquals((await call({ action: "unlocked", token: b })).json.places.map((p: Row) => p.id), [13]);
  assertEquals((await call({ action: "unlocked", token: token() })).json.places, []);
} });

Deno.test({ name: "a paid checkout the buyer never came back from still unlocks on the next visit", sanitizeOps: false, sanitizeResources: false, async fn() {
  reset();
  const t = token();
  await start(t, 13);
  const id = Object.keys(sessions)[0];
  await paidSession(id, t, 13);
  const u = await call({ action: "unlocked", token: t });
  assertEquals(u.json.places.map((p: Row) => p.id), [13]);
  assertEquals(purchases()[0].status, "active");
} });

Deno.test({ name: "only POST is accepted", sanitizeOps: false, sanitizeResources: false, async fn() {
  const res = await handler(new Request("http://localhost/checkout", { method: "GET" }));
  assertEquals(res.status, 405);
  await res.body?.cancel();
} });
