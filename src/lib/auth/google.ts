import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { codeFromCallbackUrl, NATIVE_REDIRECT } from "./callback-url";
import { getSupabase } from "./supabase";

/** Google blocks sign-in inside app web views, so Android opens Chrome Custom Tabs and returns via deep link. */
export async function signInWithGoogle() {
  const db = getSupabase();
  if (!db) throw new Error("Supabase is not configured");
  if (Capacitor.isNativePlatform()) {
    const { data, error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
    if (error) throw error;
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.url });
    return;
  }
  const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
  if (error) throw error;
}

export async function listenForNativeCallback(db: SupabaseClient) {
  const { App } = await import("@capacitor/app");
  const { Browser } = await import("@capacitor/browser");
  const handle = async (url: string) => {
    const code = codeFromCallbackUrl(url);
    if (!code) return;
    await Browser.close().catch(() => {});
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) toast.error("Google sign-in didn't finish. Try again.");
  };
  await App.addListener("appUrlOpen", ({ url }) => void handle(url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handle(launch.url);
}
