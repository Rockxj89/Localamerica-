// pin-review: the owner's private Pins page uses this to see emailed pins and approve or reject them.
// Only the owner can use it (same check as the Traffic page: is_traffic_admin()).
// Approving copies the pin into the app as a Paid place with its photos. Nothing else is changed.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ORIGINS = ["https://localamerica.us", "https://www.localamerica.us", "https://localamerica.vercel.app"];
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  const ok = ORIGINS.includes(o) || /^https:\/\/localamerica-[a-z0-9-]+\.vercel\.app$/.test(o);
  return {
    "Access-Control-Allow-Origin": ok ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

// Place types a pin can become (same names as the app's database).
const CATEGORIES = [
  "Caves", "Established campsites", "Swimming holes", "Scenic views", "Rappelling bluffs",
  "Forgotten grounds", "Frog ponds", "Legends/lore", "Dead end trails", "Mud holes/trails",
  "Hiking Trails", "Unmarked trails", "Long Shot Fields", "Rocks/Flex", "Water crossings",
  "Popular locations", "Open Stores",
];

// Name prefix when a type has no places yet to copy from
const PREFIX: Record<string, string> = {
  "Caves": "Cave", "Established campsites": "Campsite", "Swimming holes": "Swimming",
  "Scenic views": "Scenic View", "Rappelling bluffs": "Bluff", "Forgotten grounds": "Forgotten Grounds",
  "Frog ponds": "Pond", "Legends/lore": "Legends and Lore", "Dead end trails": "Dead End",
  "Mud holes/trails": "Mud Hole", "Hiking Trails": "Hike", "Unmarked trails": "Trail",
  "Long Shot Fields": "Long Shot", "Rocks/Flex": "Flex", "Water crossings": "Water",
  "Popular locations": "Popular Location",
};

// Guess the place type from the email's subject and notes. Order matters (mud hole before swimming hole).
const GUESS: [RegExp, string][] = [
  [/\bcaves?\b|\bcavern/i, "Caves"],
  [/\bmud\b/i, "Mud holes/trails"],
  [/dead[\s-]*end/i, "Dead end trails"],
  [/\bswim|swimming hole|\bblue hole\b/i, "Swimming holes"],
  [/\bcamp(site|ing|s)?\b/i, "Established campsites"],
  [/\bbluffs?\b|rappel/i, "Rappelling bluffs"],
  [/\bfrogs?\b|\bponds?\b/i, "Frog ponds"],
  [/\bscenic\b|\bview\b|overlook|vista/i, "Scenic views"],
  [/forgotten|cemetery|graveyard|ruins|homestead|abandoned|old foundation/i, "Forgotten grounds"],
  [/legend|\blore\b|haunted/i, "Legends/lore"],
  [/long[\s-]*shot|\bshooting\b|\bfield\b/i, "Long Shot Fields"],
  [/water crossing|low water|\bford\b|creek crossing/i, "Water crossings"],
  [/\bflex\b|\brocks?\b|boulder/i, "Rocks/Flex"],
  [/\bhik(e|ing)\b|foot trail|walking trail/i, "Hiking Trails"],
  [/unmarked|\btrail\b/i, "Unmarked trails"],
  [/\bstore\b|\bshop\b/i, "Open Stores"],
];
function guessCategory(text: string): string | null {
  for (const [re, c] of GUESS) if (re.test(text)) return c;
  return null;
}

// The email body, minus pasted coordinates and phone/email sign-offs. This is the owner's own wording.
function cleanNotes(notes: string | null): string {
  if (!notes) return "";
  const lines = notes.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (/^(sent from|get outlook|sent via|-- ?$|on .+ wrote:$)/i.test(l)) break;
    if (/^-?\d{1,3}\.\d+\s*[, ]\s*-?\d{1,3}\.\d+\s*$/.test(l)) continue; // just coordinates
    out.push(raw.replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function miles(a: number, b: number, c: number, d: number) {
  const r = (x: number) => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const okCoords = (lat: unknown, lon: unknown) =>
  typeof lat === "number" && typeof lon === "number" && lat > 35 && lat < 41 && lon > -96 && lon < -89;

async function nextName(admin: any, category: string, subject: string) {
  const { data } = await admin.from("poi_locations").select("name").eq("category", category);
  let prefix = PREFIX[category] || "";
  let max = 0;
  for (const r of data || []) {
    const m = String(r.name || "").match(/^(.*?)\s*#\s*(\d+)\s*$/);
    if (m) { if (!PREFIX[category]) prefix = m[1]; max = Math.max(max, Number(m[2])); }
  }
  if (!prefix) return (subject || "New place").slice(0, 60).trim();
  return `${prefix} #${max + 1}`;
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return new Response("no", { status: 405, headers: h });
  const json = (b: unknown, status = 200) => Response.json(b, { status, headers: h });

  // Owner check, with the caller's own sign-in
  const auth = req.headers.get("authorization") || "";
  const userSb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
  const { data: isAdmin, error: adminErr } = await userSb.rpc("is_traffic_admin");
  if (adminErr || isAdmin !== true) return json({ ok: false, error: "not_allowed" }, 403);

  const admin = createClient(URL_, SERVICE);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || "list");

  if (action === "list") {
    const { data: pins, error } = await admin.from("poi_pin_inbox")
      .select("id, received_at, sender, subject, notes, pin_name, latitude, longitude, photo_keys, skipped_files, status, category, final_description, location_id, decided_at")
      .in("status", ["new", "approving", "approved", "rejected"])
      .order("received_at", { ascending: false }).limit(40);
    if (error) return json({ ok: false, error: error.message }, 500);
    const { data: places } = await admin.from("poi_locations").select("id, name, category, latitude, longitude, status");
    const live = (places || []).filter((p: any) => String(p.status).toLowerCase() !== "archived");
    const out = [];
    for (const p of pins || []) {
      const photos: string[] = [];
      if (p.status === "new" && p.photo_keys?.length) {
        const { data: signed } = await admin.storage.from("pin-inbox").createSignedUrls(p.photo_keys, 3600);
        for (const s of signed || []) if (s.signedUrl) photos.push(s.signedUrl);
      }
      const text = `${p.subject || ""}\n${p.pin_name || ""}\n${p.notes || ""}`;
      const near = okCoords(p.latitude, p.longitude)
        ? live.map((l: any) => ({ name: l.name, d: miles(p.latitude, p.longitude, l.latitude, l.longitude) }))
          .filter((l: any) => Number.isFinite(l.d) && l.d <= 0.25).sort((a: any, b: any) => a.d - b.d).slice(0, 3)
        : [];
      const placeName = p.location_id ? (places || []).find((l: any) => l.id === p.location_id)?.name : null;
      out.push({
        id: p.id, received_at: p.received_at, sender: p.sender, subject: p.subject,
        latitude: p.latitude, longitude: p.longitude, has_coords: okCoords(p.latitude, p.longitude),
        photos, photo_count: (p.photo_keys || []).length, skipped: p.skipped_files || [],
        status: p.status, category: p.category, place_name: placeName,
        suggested_category: guessCategory(text),
        description: p.status === "new" ? cleanNotes(p.notes) : (p.final_description || ""),
        near,
      });
    }
    return json({ ok: true, categories: CATEGORIES, pins: out });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "bad_id" }, 400);

  if (action === "reject") {
    const { data, error } = await admin.from("poi_pin_inbox")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", id).eq("status", "new").select("id");
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data?.length) return json({ ok: false, error: "This pin was already handled." }, 409);
    return json({ ok: true });
  }

  if (action === "approve") {
    const category = String(body.category || "");
    const description = String(body.description || "").trim();
    if (!CATEGORIES.includes(category)) return json({ ok: false, error: "Pick a place type first." }, 400);
    if (!description) return json({ ok: false, error: "Add a description first." }, 400);
    if (description.length > 2000) return json({ ok: false, error: "The description is too long." }, 400);

    // Claim the pin so a double tap can't add it twice
    const { data: claimed, error: claimErr } = await admin.from("poi_pin_inbox")
      .update({ status: "approving" }).eq("id", id).eq("status", "new")
      .select("id, subject, latitude, longitude, photo_keys").single();
    if (claimErr || !claimed) return json({ ok: false, error: "This pin was already handled." }, 409);
    const release = () => admin.from("poi_pin_inbox").update({ status: "new" }).eq("id", id);

    if (!okCoords(claimed.latitude, claimed.longitude)) {
      await release();
      return json({ ok: false, error: "No GPS was found in this email, so it can't go in the app." }, 400);
    }

    const name = await nextName(admin, category, claimed.subject || "");
    // source_id is a required unique number (it came from the old Glide sheet); new places get the next one
    let loc: any = null, locErr: any = null;
    for (let tries = 0; tries < 3 && !loc; tries++) {
      const { data: top } = await admin.from("poi_locations").select("source_id").order("source_id", { ascending: false }).limit(1).maybeSingle();
      const res = await admin.from("poi_locations").insert({
        source_id: Number(top?.source_id || 0) + 1 + tries,
        name, category, description, latitude: claimed.latitude, longitude: claimed.longitude,
        access: "Paid", status: "Draft",
      }).select("id, name").single();
      loc = res.data; locErr = res.error;
      if (locErr && locErr.code !== "23505") break; // only retry when the number was just taken
    }
    if (locErr || !loc) { await release(); return json({ ok: false, error: locErr?.message || "Could not add the place." }, 500); }

    // Copy photos (already stripped of location data when they arrived) into the app's photo bucket
    let copied = 0;
    for (let n = 0; n < (claimed.photo_keys || []).length; n++) {
      const src = claimed.photo_keys[n];
      const dl = await admin.storage.from("pin-inbox").download(src);
      if (dl.error || !dl.data) continue;
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const key = `poi-location-photos/${loc.id}/pin-${id}-${n + 1}.jpg`;
      const up = await admin.storage.from("poi-photos").upload(key, bytes, { contentType: "image/jpeg", upsert: true });
      if (up.error) continue;
      const ins = await admin.from("poi_location_photos").insert({
        location_id: loc.id, drive_file_id: `pin-${id}-${n + 1}`, object_key: key, filename: `pin-${id}-${n + 1}.jpg`,
        content_type: "image/jpeg", byte_size: bytes.length,
      });
      if (!ins.error) copied++;
    }

    await admin.from("poi_pin_inbox").update({
      status: "approved", location_id: loc.id, category, final_description: description,
      decided_at: new Date().toISOString(),
    }).eq("id", id);

    return json({ ok: true, name: loc.name, photos: copied, slug: loc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
