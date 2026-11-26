import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAppSession } from "@/lib/sync/runtime";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in — ExTrack" }] }),
  component: AuthCallback,
});

function AuthCallback() {
  const session = useAppSession();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(new URLSearchParams(window.location.search).has("error")), []);
  useEffect(() => {
    if (session.auth === "signedIn") navigate({ to: "/", replace: true });
  }, [session.auth, navigate]);
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      {failed || session.auth === "signedOut" || session.auth === "misconfigured" ? (
        <div className="space-y-4">
          <p className="font-medium">Google sign-in didn't finish.</p>
          <Button className="rounded-2xl" onClick={() => navigate({ to: "/" })}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      )}
    </div>
  );
}
