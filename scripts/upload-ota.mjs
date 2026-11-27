// Uploads the bundle that scripts/package-ota.mjs wrote to dist-ota/ into the
// public `app-updates` Storage bucket. The zip goes first and the manifest last,
// so phones never see a manifest whose zip isn't there yet.
//
// Runs in CI only. Needs VITE_SUPABASE_URL and SUPABASE_SECRET_KEY in the
// environment; the secret key lives in a GitHub Actions secret, never in the app.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist-ota");
const BUCKET = "app-updates";
const KEEP = 5; // older zips past this many are deleted; phones only need the newest

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY.");

const manifestBuf = readFileSync(path.join(OUT_DIR, "manifest.json"));
const manifest = JSON.parse(manifestBuf.toString("utf8"));
const zipName = `extrack-${manifest.version}.zip`;
const zipBuf = readFileSync(path.join(OUT_DIR, zipName));
if (createHash("sha256").update(zipBuf).digest("hex") !== manifest.checksum) {
  throw new Error("dist-ota/manifest.json checksum doesn't match the zip.");
}
if (!manifest.url.endsWith(`/${BUCKET}/${zipName}`)) {
  throw new Error(`Manifest url ${manifest.url} doesn't point at the ${BUCKET} bucket.`);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const storage = supabase.storage;

// First run: the bucket may not exist yet. A public bucket serves files to anyone
// by URL; uploads still need the secret key.
const { data: bucket } = await storage.getBucket(BUCKET);
if (!bucket) {
  const { error } = await storage.createBucket(BUCKET, { public: true });
  if (error) throw new Error(`Couldn't create bucket ${BUCKET}: ${error.message}`);
  console.log(`Created public bucket ${BUCKET}.`);
} else if (!bucket.public) {
  throw new Error(`Bucket ${BUCKET} exists but isn't public, so phones can't download from it.`);
}

const put = async (name, body, contentType, cacheControl) => {
  const { error } = await storage.from(BUCKET).upload(name, body, { contentType, cacheControl, upsert: true });
  if (error) throw new Error(`Upload of ${name} failed: ${error.message}`);
  console.log(`Uploaded ${name} (${body.length} bytes).`);
};
await put(zipName, zipBuf, "application/zip", "31536000");
await put("manifest.json", manifestBuf, "application/json", "0");

// Prune old zips. Never touches the one just published.
const { data: files, error: listError } = await storage.from(BUCKET).list("", { limit: 1000 });
if (listError) {
  console.warn(`Couldn't list ${BUCKET} to prune old bundles: ${listError.message}`);
} else {
  const zips = files
    .map((f) => f.name)
    .filter((n) => /^extrack-\d+\.\d+\.\d+\.zip$/.test(n) && n !== zipName)
    .sort((a, b) => {
      const v = (n) => n.slice(8, -4).split(".").map(Number);
      const [x, y] = [v(a), v(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  const stale = zips.slice(0, Math.max(0, zips.length - (KEEP - 1)));
  if (stale.length) {
    const { error } = await storage.from(BUCKET).remove(stale);
    if (error) console.warn(`Couldn't prune old bundles: ${error.message}`);
    else console.log(`Removed ${stale.length} old bundle(s).`);
  }
}

console.log(`Published v${manifest.version}. Phones pick it up on their next launch or return to the app.`);
