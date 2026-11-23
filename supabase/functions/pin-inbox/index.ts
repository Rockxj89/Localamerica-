// pin-inbox: receives a pin the owner emailed in from onX (forwarded by Make's mailhook).
// Saves it to the PRIVATE table poi_pin_inbox and private bucket pin-inbox.
// Nothing here is visible in the app. A place only goes live after the owner approves it (pin-review).
// Also used by the Facebook Auto Post scenario (same key) to add approved places to the posting sheet:
//   action "sheet_next"  -> the next approved place that isn't in the sheet yet, with a mixed-in post order
//   action "sheet_added" -> marks that place as added to the sheet
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET_SHA256 = "ed5fa78c3e02c66b5da4953b22c76f70bceb5cbc09b0e6fac3fe35c7a5e9d5aa";

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64Text(b64: string | undefined): string {
  if (!b64) return "";
  try { return new TextDecoder().decode(b64ToBytes(b64)); } catch { return ""; }
}

// Rebuild a JPEG keeping only what's needed to show the picture, so no location data can ride along
// (these photos end up public once the place is approved, and pins are paid places):
// - Only the parts a decoder needs are kept: frame header, Huffman/quantization tables, restart interval,
//   scans, and a plain 16-byte JFIF APP0. Every other APPn (EXIF incl. GPS, XMP, ICC, MPF, Photoshop) and
//   COM is dropped, before the first scan AND between scans (progressive JPEGs).
// - Everything after the end-of-image marker is cut off. Phones hang extra data there: Samsung's trailer
//   (edit history, capture info), Ultra HDR gain-map images with their own metadata, motion-photo videos.
// - Anything unexpected (unknown or malformed parts, a file that never ends) means null: the photo is
//   skipped, never stored as-is.
function stripJpeg(src: Uint8Array): Uint8Array | null {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  let i = 2, scans = 0, eoi = false, segments = 0;
  while (i + 2 <= src.length) {
    if (src[i] !== 0xff) return null;
    const marker = src[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9) { // end of image: keep the marker, drop everything after it
      if (scans === 0) return null;
      parts.push(src.subarray(i, i + 2));
      eoi = true;
      break;
    }
    if (++segments > 2000) return null; // real photos have a few dozen parts at most
    if (i + 4 > src.length) return null;
    const len = (src[i + 2] << 8) | src[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > src.length) return null;
    if (marker === 0xda) { // start of scan: its header, then image data up to the next real marker
      if (len !== 6 + 2 * src[i + 4]) return null;
      scans++;
      let j = end;
      while (j + 1 < src.length) {
        if (src[j] === 0xff) {
          const n = src[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j += 2; continue; } // stuffed byte or restart marker
          if (n === 0xff) { j++; continue; } // fill byte before a marker
          break;
        }
        j++;
      }
      if (j + 1 >= src.length) return null; // image data never ends: not a whole JPEG
      parts.push(src.subarray(i, j));
      i = j;
      continue;
    }
    const jfif = marker === 0xe0 && len === 16 &&
      src[i + 4] === 0x4a && src[i + 5] === 0x46 && src[i + 6] === 0x49 && src[i + 7] === 0x46 && src[i + 8] === 0x00;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const keep = jfif || (sof && len === 8 + 3 * src[i + 9]) || marker === 0xc4 || marker === 0xcc || marker === 0xdb ||
      ((marker === 0xdd || marker === 0xdc) && len === 4);
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!keep && !drop) return null;
    if (keep) parts.push(src.subarray(i, end));
    i = end;
  }
  if (!eoi) return null;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Last check on the cleaned photo: any EXIF header left anywhere in the whole file means it is skipped.
function hasExifGps(b: Uint8Array): boolean {
  const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  outer: for (let i = 0; i + sig.length <= b.length; i++) {
    for (let k = 0; k < sig.length; k++) if (b[i + k] !== sig[k]) continue outer;
    return true;
  }
  return false;
}

function decodeXml(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function parsePin(xml: string): { lat: number; lon: number; name: string; desc: string } | null {
  const wpt = xml.match(/<(wpt|trkpt|rtept)\b[^>]*>([\s\S]*?)<\/\1>|<(wpt|trkpt|rtept)\b[^>]*\/>/);
  if (wpt) {
    const tag = wpt[0];
    const lat = parseFloat((tag.match(/lat\s*=\s*["']([-0-9.]+)["']/) || [])[1]);
    const lon = parseFloat((tag.match(/lon\s*=\s*["']([-0-9.]+)["']/) || [])[1]);
    const name = decodeXml((tag.match(/<name>([\s\S]*?)<\/name>/) || [, ""])[1]);
    const desc = decodeXml((tag.match(/<(?:desc|cmt)>([\s\S]*?)<\/(?:desc|cmt)>/) || [, ""])[1]);
    if (isFinite(lat) && isFinite(lon)) return { lat, lon, name, desc };
  }
  const kml = xml.match(/<coordinates>\s*([-0-9.]+)\s*,\s*([-0-9.]+)/); // KML is lon,lat
  if (kml) {
    const name = decodeXml((xml.match(/<Placemark>[\s\S]*?<name>([\s\S]*?)<\/name>/) || [, ""])[1]);
    return { lat: parseFloat(kml[2]), lon: parseFloat(kml[1]), name, desc: "" };
  }
  return null;
}

function coordsFromText(t: string): { lat: number; lon: number } | null {
  const m = t.match(/(-?\d{2}\.\d{3,})\s*[, ]\s*(-?\d{2,3}\.\d{3,})/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (lat > 30 && lat < 45 && lon < -80 && lon > -100) return { lat, lon };
  return null;
}

const toSlug = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const PHOTO_BASE = "https://ycdlxdijrlfsxvxksyrq.supabase.co/storage/v1/object/public/poi-photos/";

// Pick a post order that slots the new place in among the next ~5–30 unposted items,
// never right next to a place of the same type. Orders are text like "P150"; "P150n0007" sorts
// between "P150" and "P151" (Google Sheets compares text without caring about upper/lower case).
function pickOrder(upcoming: string, category: string, pinId: number): string {
  // upcoming = "P150~Caves|P151~Video|..." (post order ~ category), from the sheet's unposted rows
  const list = upcoming.split("|").map((s) => { const i = s.indexOf("~"); return { o: (i < 0 ? s : s.slice(0, i)).trim(), c: i < 0 ? "" : s.slice(i + 1).trim() }; })
    .filter((x) => x.o)
    .sort((a, b) => (a.o.toUpperCase() < b.o.toUpperCase() ? -1 : a.o.toUpperCase() > b.o.toUpperCase() ? 1 : 0));
  const suffix = "n" + String(pinId).padStart(4, "0");
  if (!list.length) return "P999" + suffix;
  const valid: string[] = [];
  const lo = list.length > 6 ? 5 : 1;
  const hi = Math.min(30, list.length - 1);
  for (let k = lo; k <= hi; k++) {
    const prev = list[k - 1], next = list[k];
    if (prev.c === category || next.c === category) continue;
    const key = prev.o + suffix;
    if (key.toUpperCase() < next.o.toUpperCase()) valid.push(key);
  }
  if (valid.length) return valid[Math.floor(Math.random() * valid.length)];
  return list[list.length - 1].o + suffix; // fallback: after the last unposted item
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const key = req.headers.get("x-pin-key") || "";
  if ((await sha256Hex(key)) !== SECRET_SHA256) return new Response("no", { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ---------- Posting sheet (called by the Facebook Auto Post scenario) ----------
  if (body.action === "sheet_next") {
    const { data: pin } = await sb.from("poi_pin_inbox").select("id, location_id, subject")
      .eq("status", "approved").is("sheet_added_at", null).not("location_id", "is", null)
      .order("decided_at", { ascending: true }).limit(1).maybeSingle();
    if (!pin) return Response.json({ ok: true, has: "no" });
    if (typeof body.upcoming !== "string") return Response.json({ ok: true, has: "yes" }); // quick check only
    const { data: loc } = await sb.from("poi_locations")
      .select("id, name, category, access, latitude, longitude, description, status").eq("id", pin.location_id).maybeSingle();
    // A pin whose subject starts with "TEST" is a test of this step: its sheet row is marked TEST so it never posts.
    const isTest = /^TEST\b/.test(String(pin.subject || ""));
    if (!loc || (String(loc.status).toLowerCase() === "archived" && !isTest)) {
      await sb.from("poi_pin_inbox").update({ sheet_added_at: new Date().toISOString(), sheet_order: "skipped" }).eq("id", pin.id);
      return Response.json({ ok: true, has: "no" });
    }
    const { data: photos } = await sb.from("poi_location_photos").select("object_key").eq("location_id", loc.id).order("id");
    const keys = (photos || []).map((p: any) => p.object_key);
    const paid = String(loc.access).toLowerCase() !== "free";
    const slug = toSlug(loc.name);
    return Response.json({
      ok: true, has: "yes", location_id: loc.id, name: isTest ? `TEST ROW, delete me (${loc.name})` : loc.name,
      status_cell: isTest ? "TEST" : "", category: loc.category,
      access: paid ? "Paid" : "Free", latitude: loc.latitude, longitude: loc.longitude,
      description: loc.description || "", photo_count: keys.length,
      photo_links: keys.slice(0, 3).map((k: string) => PHOTO_BASE + k.split("/").map(encodeURIComponent).join("/")).join(" "),
      gps: paid ? "" : `${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}`,
      order: pickOrder(body.upcoming, loc.category, pin.id),
      slug, place_url: `localamerica.us/places/${slug}`,
    });
  }
  if (body.action === "sheet_added") {
    const id = Number(body.location_id);
    if (!Number.isInteger(id)) return Response.json({ ok: false, error: "bad_id" }, { status: 400 });
    await sb.from("poi_pin_inbox").update({ sheet_added_at: new Date().toISOString(), sheet_order: String(body.order || "").slice(0, 20) })
      .eq("location_id", id).eq("status", "approved");
    return Response.json({ ok: true });
  }

  // ---------- A pin emailed in ----------
  const subject = b64Text(body.subject).slice(0, 300);
  const text = b64Text(body.text).slice(0, 5000);
  const sender = b64Text(body.from).slice(0, 200);
  const files: { name: string; type: string; b64: string }[] = (body.files || [])
    .map((f: any) => ({ name: b64Text(f.name), type: String(f.type || "").toLowerCase(), b64: String(f.b64 || "") }))
    .filter((f: any) => f.b64.length > 0);

  let pin: { lat: number; lon: number; name: string; desc: string } | null = null;
  const photos: { name: string; bytes: Uint8Array }[] = [];
  const skipped: string[] = [];

  for (const f of files) {
    const lname = f.name.toLowerCase();
    let bytes: Uint8Array;
    try { bytes = b64ToBytes(f.b64); } catch { skipped.push(`${f.name} (unreadable)`); continue; }
    if (lname.endsWith(".gpx") || lname.endsWith(".kml") || f.type.includes("gpx") || f.type.includes("kml")) {
      if (!pin) pin = parsePin(new TextDecoder().decode(bytes));
      continue;
    }
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (isJpeg) {
      const clean = stripJpeg(bytes);
      if (!clean || hasExifGps(clean)) { skipped.push(`${f.name} (couldn't remove location data)`); continue; }
      photos.push({ name: f.name, bytes: clean });
    } else {
      skipped.push(`${f.name} (not a JPEG photo)`);
    }
  }

  if (!pin) {
    const c = coordsFromText(`${subject}\n${text}`);
    if (c) pin = { ...c, name: "", desc: "" };
  }

  const { data: row, error } = await sb.from("poi_pin_inbox").insert({
    sender, subject, notes: [text.trim(), pin?.desc].filter(Boolean).join("\n\n") || null,
    pin_name: pin?.name || null, latitude: pin?.lat ?? null, longitude: pin?.lon ?? null,
    skipped_files: skipped,
  }).select("id").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const keys: string[] = [];
  for (let n = 0; n < photos.length; n++) {
    const k = `${row.id}/photo-${n + 1}.jpg`;
    const up = await sb.storage.from("pin-inbox").upload(k, photos[n].bytes, { contentType: "image/jpeg", upsert: true });
    if (up.error) skipped.push(`${photos[n].name} (upload failed)`); else keys.push(k);
  }
  await sb.from("poi_pin_inbox").update({ photo_keys: keys, skipped_files: skipped }).eq("id", row.id);

  return Response.json({ ok: true, id: row.id, got_pin: !!pin, photos: keys.length, skipped });
});
