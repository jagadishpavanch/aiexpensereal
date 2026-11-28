/** Device unlock using the phone's fingerprint / face (passkeys), with a PIN fallback. Browser-only. */

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function biometricAvailable() {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function registerBiometric(name: string): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: "ExTrack" },
      user: { id: rand(16), name: name || "ExTrack user", displayName: name || "ExTrack user" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Fingerprint setup was cancelled");
  return b64(cred.rawId);
}

export async function verifyBiometric(credentialId: string) {
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: "public-key", id: unb64(credentialId) }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!res;
}

export async function hashPin(pin: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`extrack:${pin}`));
  return b64(buf);
}

const KEY = "extrack:unlockedAt";
export function markUnlocked() {
  sessionStorage.setItem(KEY, String(Date.now()));
}
export function touch() {
  if (sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, String(Date.now()));
}
export function isUnlocked(idleMinutes: number) {
  const t = Number(sessionStorage.getItem(KEY) || 0);
  return t > 0 && Date.now() - t < idleMinutes * 60 * 1000;
}
export function lockNow() {
  sessionStorage.removeItem(KEY);
}

/**
 * Wrong PINs in a row before the keypad starts making you wait. A 4-digit PIN has 10,000 values, so
 * without a wait anyone holding the phone could try them all.
 */
export const FREE_TRIES = 5;

/** How long to wait after `fails` wrong PINs in a row: none for the first five, then 30 s doubling to 15 min. */
export function pinWaitMs(fails: number) {
  if (fails < FREE_TRIES) return 0;
  return Math.min(15 * 60_000, 30_000 * 2 ** (fails - FREE_TRIES));
}

/** Kept in localStorage, not sessionStorage, so closing the app doesn't reset the count. */
const FAILS_KEY = "extrack:pinFails";

export function readPinFails(): { fails: number; at: number } {
  try {
    const v = JSON.parse(localStorage.getItem(FAILS_KEY) ?? "null") as { fails?: unknown; at?: unknown } | null;
    return { fails: typeof v?.fails === "number" ? v.fails : 0, at: typeof v?.at === "number" ? v.at : 0 };
  } catch {
    return { fails: 0, at: 0 };
  }
}

/** Counts a wrong PIN and returns when the next try is allowed (epoch ms). */
export function recordPinFail(now = Date.now()) {
  const fails = readPinFails().fails + 1;
  localStorage.setItem(FAILS_KEY, JSON.stringify({ fails, at: now }));
  return now + pinWaitMs(fails);
}

export function clearPinFails() {
  localStorage.removeItem(FAILS_KEY);
}

/** Epoch ms when the keypad opens again (0 if it is open). */
export function pinLockedUntil() {
  const { fails, at } = readPinFails();
  const until = at + pinWaitMs(fails);
  return until > Date.now() ? until : 0;
}
