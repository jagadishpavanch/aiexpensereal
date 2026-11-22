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
