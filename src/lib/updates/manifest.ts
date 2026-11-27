export const OTA_BUCKET = "app-updates";
export const OTA_MANIFEST_FILE = "manifest.json";

export interface OtaManifest {
  version: string;
  url: string;
  checksum: string;
  minNativeVersion?: string;
  notes?: string;
}

export type SemverTuple = readonly [number, number, number];

const SEMVER_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

/** Parse `1.0`, `1.0.0`, or `v1.2.3` into a numeric `[major, minor, patch]` tuple. */
export function parseSemver(raw: string): SemverTuple | null {
  const m = SEMVER_RE.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? "0"), Number(m[3] ?? "0")];
}

/** Return -1 if `a < b`, 0 if equal, 1 if `a > b`. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver comparison: "${a}" vs "${b}"`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/** Validate and normalize an untrusted OTA manifest JSON payload. */
export function parseManifest(raw: unknown): OtaManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const version = typeof obj["version"] === "string" ? obj["version"].trim() : "";
  const url = obj["url"];
  const checksum = typeof obj["checksum"] === "string" ? obj["checksum"].trim().toLowerCase() : "";
  if (!parseSemver(version) || !isHttpsUrl(url) || !SHA256_HEX_RE.test(checksum)) return null;

  const minNativeRaw = obj["minNativeVersion"];
  let minNativeVersion: string | undefined;
  if (minNativeRaw !== undefined) {
    if (typeof minNativeRaw !== "string" || !parseSemver(minNativeRaw)) return null;
    minNativeVersion = minNativeRaw.trim();
  }

  const notes =
    typeof obj["notes"] === "string" && obj["notes"].trim() ? obj["notes"].trim() : undefined;
  return {
    version,
    url: url.trim(),
    checksum,
    ...(minNativeVersion ? { minNativeVersion } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** Decide whether a remote bundle should be downloaded for this device and app version. */
export function shouldApplyUpdate(
  manifest: OtaManifest,
  device: { currentVersion: string; nativeVersion: string },
): { apply: true } | { apply: false; reason: "up_to_date" | "native_too_old" } {
  if (manifest.minNativeVersion) {
    if (
      !parseSemver(device.nativeVersion) ||
      compareSemver(device.nativeVersion, manifest.minNativeVersion) < 0
    ) {
      return { apply: false, reason: "native_too_old" };
    }
  }
  if (
    parseSemver(device.currentVersion) &&
    compareSemver(manifest.version, device.currentVersion) <= 0
  ) {
    return { apply: false, reason: "up_to_date" };
  }
  return { apply: true };
}

/** Resolve the manifest endpoint from `VITE_OTA_MANIFEST_URL` or the Supabase public Storage bucket. */
export function resolveManifestUrl(env: {
  VITE_OTA_MANIFEST_URL?: string;
  VITE_SUPABASE_URL?: string;
}): string | null {
  const override = env.VITE_OTA_MANIFEST_URL?.trim();
  if (override) return isHttpsUrl(override) ? override : null;

  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  if (!isHttpsUrl(supabaseUrl)) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${OTA_BUCKET}/${OTA_MANIFEST_FILE}`;
}
