import { describe, expect, it } from "vitest";
import {
  compareSemver,
  parseManifest,
  parseSemver,
  OTA_DEFAULT_MANIFEST_URL,
  resolveManifestUrl,
  shouldApplyUpdate,
} from "./manifest";

const VALID_SHA = "a".repeat(64);
const VALID_URL =
  "https://example.supabase.co/storage/v1/object/public/app-updates/extrack-1.0.1.zip";

describe("semver helpers", () => {
  it("parses two- and three-part versions", () => {
    expect(parseSemver("1.0")).toEqual([1, 0, 0]);
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("builtin")).toBeNull();
  });

  it("compares semver versions numerically", () => {
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.10", "1.0.2")).toBe(1);
    expect(compareSemver("1.0.1", "1.1.0")).toBe(-1);
  });
});

describe("parseManifest", () => {
  it("accepts a valid manifest and normalizes checksum", () => {
    expect(
      parseManifest({
        version: "1.0.1",
        url: VALID_URL,
        checksum: VALID_SHA.toUpperCase(),
        minNativeVersion: "1.0",
        notes: "Bug fixes",
      }),
    ).toEqual({
      version: "1.0.1",
      url: VALID_URL,
      checksum: VALID_SHA,
      minNativeVersion: "1.0",
      notes: "Bug fixes",
    });
  });

  it("rejects http URLs, bad checksums, and bad minNativeVersion", () => {
    expect(
      parseManifest({ version: "1.0.1", url: "http://example.com/a.zip", checksum: VALID_SHA }),
    ).toBeNull();
    expect(parseManifest({ version: "1.0.1", url: VALID_URL, checksum: "abc" })).toBeNull();
    expect(
      parseManifest({
        version: "1.0.1",
        url: VALID_URL,
        checksum: VALID_SHA,
        minNativeVersion: "bad",
      }),
    ).toBeNull();
  });
});

describe("shouldApplyUpdate", () => {
  const manifest = parseManifest({
    version: "1.1.0",
    url: VALID_URL,
    checksum: VALID_SHA,
    minNativeVersion: "1.0",
  })!;

  it("applies when remote version is newer and native version meets minimum", () => {
    expect(shouldApplyUpdate(manifest, { currentVersion: "1.0.0", nativeVersion: "1.0" })).toEqual({
      apply: true,
    });
  });

  it("skips when already at or above remote version", () => {
    expect(shouldApplyUpdate(manifest, { currentVersion: "1.1.0", nativeVersion: "1.0" })).toEqual({
      apply: false,
      reason: "up_to_date",
    });
    expect(shouldApplyUpdate(manifest, { currentVersion: "1.2.0", nativeVersion: "1.0" })).toEqual({
      apply: false,
      reason: "up_to_date",
    });
  });

  it("blocks updates that require a newer native APK", () => {
    const needsNewApk = parseManifest({
      version: "2.0.0",
      url: VALID_URL,
      checksum: VALID_SHA,
      minNativeVersion: "2.0",
    })!;
    expect(
      shouldApplyUpdate(needsNewApk, { currentVersion: "1.0.0", nativeVersion: "1.0" }),
    ).toEqual({
      apply: false,
      reason: "native_too_old",
    });
  });
});

describe("resolveManifestUrl", () => {
  it("prefers explicit HTTPS VITE_OTA_MANIFEST_URL", () => {
    expect(resolveManifestUrl({ VITE_OTA_MANIFEST_URL: "https://cdn.example.com/extrack/manifest.json" })).toBe(
      "https://cdn.example.com/extrack/manifest.json",
    );
  });

  it("defaults to the manifest on the repo's latest GitHub Release", () => {
    expect(resolveManifestUrl({})).toBe(OTA_DEFAULT_MANIFEST_URL);
    expect(OTA_DEFAULT_MANIFEST_URL).toBe(
      "https://github.com/jagadishpavanch/aiexpensereal/releases/latest/download/manifest.json",
    );
  });

  it("rejects a non-HTTPS override", () => {
    expect(resolveManifestUrl({ VITE_OTA_MANIFEST_URL: "http://localhost:8080/manifest.json" })).toBeNull();
  });
});
