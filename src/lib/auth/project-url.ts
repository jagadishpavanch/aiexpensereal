/**
 * The Supabase project's root URL (`https://<ref>.supabase.co`) from `VITE_SUPABASE_URL`,
 * ignoring any path pasted after it. The dashboard also shows the REST endpoint
 * (`…/rest/v1/`); with that value, auth requests went to the wrong path and failed.
 */
export function projectUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
