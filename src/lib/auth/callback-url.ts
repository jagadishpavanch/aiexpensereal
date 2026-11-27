/** Where Google sends the Android app back to. Must be listed in Supabase → Auth → Redirect URLs. */
export const NATIVE_REDIRECT = "com.extrack.app://auth/callback";

export function codeFromCallbackUrl(url: string): string | null {
  if (!url.startsWith(NATIVE_REDIRECT)) return null;
  return new URL(url).searchParams.get("code");
}
