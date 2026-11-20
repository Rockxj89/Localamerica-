// post-image-save: stores an owner-approved Adobe place-post image where Make can pick it up.
// Public result: https://<project>.supabase.co/storage/v1/object/public/post-images/<location_id>.jpg
// Make's "Facebook Auto Post" (7043201) posts that image for the place if it exists, else designs its own.
//
// Auth: a short-lived one-time-style token minted only from the database
//   (select public.mint_post_image_token();  -> valid 1 hour, max 12 uses, counted atomically).
// Only its SHA-256 hash is stored. No key is kept anywhere.
//
// Actions (POST JSON):
//   { action: "save",   token, location_id, jpeg_b64, design_urn? }
//   { action: "delete", token, location_id }
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_BYTES = 3 * 1024 * 1024;

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

// Rebuild a JPEG keeping only what's needed to show the picture:
// - APP0 only if it is a plain 16-byte JFIF header; every other APPn (EXIF/GPS, XMP, ...) and COM is dropped,
//   before the first scan AND between scans (progressive JPEGs).
// - Everything after the first end-of-image marker is refused (phones hide second images with GPS there).
// Also reads the frame size.
function stripJpeg(src: Uint8Array): { bytes: Uint8Array; w: number; h: number } | null {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  let i = 2, w = 0, h = 0, scans = 0, eoi = false;
  while (i + 2 <= src.length) {
    if (src[i] !== 0xff) return null;
    const marker = src[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9) { // end of image
      if (scans === 0) return null;
      parts.push(src.subarray(i, i + 2));
      if (i + 2 !== src.length) return null; // trailing data: refuse
      eoi = true;
      break;
    }
    if (i + 4 > src.length) return null;
    const len = (src[i + 2] << 8) | src[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > src.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && len >= 7) {
      h = (src[i + 5] << 8) | src[i + 6];
      w = (src[i + 7] << 8) | src[i + 8];
    }
    if (marker === 0xda) { // start of scan: header, then entropy-coded data up to the next real marker
      scans++;
      let j = end;
      while (j + 1 < src.length) {
        if (src[j] === 0xff) {
          const n = src[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j += 2; continue; }
          break;
        }
        j++;
      }
      if (j + 1 >= src.length) return null; // no end marker
      parts.push(src.subarray(i, j));
      i = j;
      continue;
    }
    const isJfif = marker === 0xe0 && len === 16 &&
      src[i + 4] === 0x4a && src[i + 5] === 0x46 && src[i + 6] === 0x49 && src[i + 7] === 0x46 && src[i + 8] === 0x00;
    const junk = (marker >= 0xe0 && marker <= 0xef && !isJfif) || marker === 0xfe;
    if (!junk) parts.push(src.subarray(i, end));
    i = end;
  }
  if (!eoi || scans === 0 || w === 0) return null;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, w, h };
}

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const len = Number(req.headers.get("content-length") || "0");
  if (!len || len > 4.5 * 1024 * 1024) return bad("too_big_or_no_length", 413);
  let body: any;
  try { body = await req.json(); } catch { return bad("bad_json"); }
  if (!body || typeof body !== "object") return bad("bad_json");

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ---- token check (atomic: counts one use, refuses expired or used-up tokens) ----
  const token = String(body.token || "");
  if (!/^[0-9a-f]{48}$/.test(token)) return new Response("no", { status: 403 });
  const { data: okTok, error: tokErr } = await sb.rpc("use_post_image_token", { p_hash: await sha256Hex(token) });
  if (tokErr || okTok !== true) return new Response("no", { status: 403 });

  const id = Number(body.location_id);
  if (!Number.isInteger(id) || id <= 0) return bad("bad_location_id");
  const { data: loc } = await sb.from("poi_locations").select("id").eq("id", id).maybeSingle();
  if (!loc) return bad("unknown_location", 404);
  const key = `${id}.jpg`;

  if (body.action === "delete") {
    const rm = await sb.storage.from("post-images").remove([key]);
    if (rm.error) return bad("delete_failed", 500);
    await sb.from("post_images").delete().eq("location_id", id);
    return Response.json({ ok: true, deleted: key });
  }

  if (body.action !== "save") return bad("bad_action");
  const b64 = String(body.jpeg_b64 || "");
  if (!b64 || b64.length > MAX_BYTES * 1.4) return bad("too_big_or_empty");
  let raw: Uint8Array;
  try { raw = b64ToBytes(b64); } catch { return bad("bad_base64"); }
  const clean = stripJpeg(raw);
  if (!clean) return bad("not_a_jpeg");
  if (clean.bytes.length > MAX_BYTES) return bad("too_big");
  if (clean.w < 1000 || clean.h < 1000 || clean.w !== clean.h) return bad(`must_be_square_1080 (${clean.w}x${clean.h})`);

  const up = await sb.storage.from("post-images").upload(key, clean.bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "60" });
  if (up.error) return bad("upload_failed", 500);
  const urn = typeof body.design_urn === "string" ? body.design_urn.slice(0, 200) : null;
  const { error: logErr } = await sb.from("post_images").upsert({ location_id: id, object_key: key, design_urn: urn, approved_at: new Date().toISOString() });
  if (logErr) return bad("log_failed", 500);

  return Response.json({
    ok: true, location_id: id, bytes: clean.bytes.length,
    url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/post-images/${key}`,
  });
});
