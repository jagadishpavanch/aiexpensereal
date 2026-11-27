import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = path.join(ROOT, "src", "lib", "updates", "version.ts");
const WEB_DIR = path.join(ROOT, ".output", "public");
const OUT_DIR = path.join(ROOT, "dist-ota");

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function collectFiles(dir, prefix = "") {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) entries.push(...collectFiles(full, rel));
    else entries.push({ rel, full });
  }
  return entries;
}

/** Write a standard ZIP with POSIX forward-slash paths so Android ZipInputStream extracts cleanly. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { rel, full } of files) {
    const data = readFileSync(full);
    const nameBuf = Buffer.from(rel, "utf8");
    const crc = crc32(data);
    const compressed = data.length > 0 ? deflateRawSync(data, { level: 9 }) : Buffer.alloc(0);
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x5421, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5421, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cdBuf, eocd]);
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = /^([^#=\s]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return out;
}

function parseArgs(argv) {
  const opts = { noBump: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") opts.version = argv[++i];
    else if (a === "--min-native") opts.minNative = argv[++i];
    else if (a === "--base-url") opts.baseUrl = argv[++i];
    else if (a === "--notes") opts.notes = argv[++i];
    else if (a === "--no-bump") opts.noBump = true;
    else if (a === "--skip-build") opts.skipBuild = true;
  }
  return opts;
}

function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Expected semver x.y.z, got "${version}"`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function currentVersion() {
  const src = readFileSync(VERSION_FILE, "utf8");
  const m = /BUNDLE_VERSION\s*=\s*"([^"]+)"/.exec(src);
  if (!m) throw new Error(`Could not read BUNDLE_VERSION from ${VERSION_FILE}`);
  return m[1];
}

const args = parseArgs(process.argv.slice(2));
const version = args.version ?? (args.noBump ? currentVersion() : bumpPatch(currentVersion()));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(`Invalid --version "${version}" (expected x.y.z)`);

const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
writeFileSync(
  VERSION_FILE,
  `/** Semantic version of the currently running web bundle (updated by scripts/package-ota.mjs). */\nexport const BUNDLE_VERSION = "${version}";\n`,
);

if (!args.skipBuild) {
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
}
if (!existsSync(path.join(WEB_DIR, "index.html"))) {
  throw new Error(`Missing ${path.join(WEB_DIR, "index.html")}. Run npm run build first.`);
}

mkdirSync(OUT_DIR, { recursive: true });
const zipName = `extrack-${version}.zip`;
const zipPath = path.join(OUT_DIR, zipName);
const zipBuffer = buildZip(collectFiles(WEB_DIR));
writeFileSync(zipPath, zipBuffer);

const checksum = createHash("sha256").update(zipBuffer).digest("hex");
const envLocal = readEnvFile(path.join(ROOT, ".env.local"));
const supabaseBase = (process.env.VITE_SUPABASE_URL || envLocal.VITE_SUPABASE_URL || "").replace(
  /\/+$/,
  "",
);
const baseUrl = (
  args.baseUrl || (supabaseBase ? `${supabaseBase}/storage/v1/object/public/app-updates` : "")
).replace(/\/+$/, "");

const manifest = {
  version,
  url: baseUrl ? `${baseUrl}/${zipName}` : `<BASE_URL>/${zipName}`,
  checksum,
  minNativeVersion: args.minNative || "1.0",
  ...(args.notes ? { notes: args.notes } : {}),
};

const manifestPath = path.join(OUT_DIR, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Packaged OTA bundle v${version}:`);
console.log(`  Zip:      ${zipPath} (${zipBuffer.length} bytes)`);
console.log(`  Manifest: ${manifestPath}`);
console.log(`  SHA-256:  ${checksum}`);
