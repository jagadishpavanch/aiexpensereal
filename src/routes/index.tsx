import { createFileRoute, useNavigate, useHydrated } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, MessageSquareText, PenLine, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { DEFAULT_WIDGETS } from "@/lib/finance/demo";
import type { WidgetId } from "@/lib/finance/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { signInWithGoogle } from "@/lib/auth/google";
import { retrySync, useAppSession } from "@/lib/sync/runtime";
import { Logo } from "./_shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ExTrack — Track every rupee, effortlessly" },
      { name: "description", content: "A calm, private expense tracker for India. UPI, cards and cash in one place, with budgets, goals and clear charts." },
      { property: "og:title", content: "ExTrack — Track every rupee, effortlessly" },
      { property: "og:description", content: "A calm, private expense tracker for India with budgets, goals and clear charts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Onboarding,
});

const WIDGET_LABELS: Record<WidgetId, string> = {
  balance: "Balance & cash flow", ring: "Spending by category", budgets: "Budgets", goals: "Savings goals",
  trend: "30-day trend", recent: "Recent transactions", merchants: "Top merchants", recurring: "Recurring payments", bills: "Bills due soon", cashback: "Cashback", splits: "Splits",
};

const STEPS = 5;

function Onboarding() {
  const hydrated = useHydrated();
  const onboarded = useFinance((s) => s.prefs.onboarded);
  const prefs = useFinance((s) => s.prefs);
  const navigate = useNavigate();
  const session = useAppSession();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");

  const ready = session.auth === "signedIn" && session.sync === "ready";
  useEffect(() => {
    if (hydrated && ready && onboarded) navigate({ to: "/home", replace: true });
  }, [hydrated, ready, onboarded, navigate]);

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };
  const googleName = session.auth === "signedIn" ? ((session.user.user_metadata?.["given_name"] ?? session.user.user_metadata?.["full_name"]) as string | undefined) : undefined;
  const finish = () => {
    actions.setPrefs({ onboarded: true, name: name.trim() || googleName || prefs.name });
    navigate({ to: "/home" });
  };

  if (session.auth === "misconfigured") return <Splash text="Sign-in isn't set up yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local and restart." />;
  if (!hydrated || session.auth === "loading" || (session.auth === "signedIn" && session.sync === "starting") || (ready && onboarded)) return <Splash text="Getting your data ready…" />;
  if (session.auth === "signedIn" && session.sync === "failed") return <Splash text="Couldn't load your data. Check your internet connection." action={<Button className="rounded-2xl" onClick={retrySync}>Try again</Button>} />;

  return (
    <div className="relative grid min-h-dvh overflow-hidden bg-background">
      <Backdrop step={step} />
      <div className="relative mx-auto flex w-full max-w-md flex-col px-5 pb-8 pt-6">
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button onClick={() => go(step - 1)} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-card shadow-soft"><ArrowLeft className="size-5" /></button>
          ) : <Logo />}
          <div className="flex flex-1 gap-1.5" aria-label={`Step ${step + 1} of ${STEPS}`}>
            {Array.from({ length: STEPS }).map((_, i) => (
              <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full bg-primary" initial={false} animate={{ width: i <= step ? "100%" : "0%" }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
              </div>
            ))}
          </div>
          {step > 0 && step < STEPS - 1 && <button onClick={finish} className="text-sm font-medium text-muted-foreground">Skip</button>}
        </div>

        <div className="relative flex-1">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div key={step} custom={dir}
              initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="flex h-full flex-col pt-8">
              {step === 0 && (
                <>
                  <HeroCoins />
                  <h1 className="mt-8 font-display text-[2.6rem] font-bold leading-[1.05]">Every rupee, accounted for.</h1>
                  <p className="mt-3 text-lg text-muted-foreground">UPI, cards and cash in one calm place, with budgets that keep you on track.</p>
                  {session.auth === "signedOut" ? (
                    <div className="mt-auto space-y-3 pt-8">
                      <Button size="lg" className="h-14 w-full rounded-2xl text-base" onClick={() => signInWithGoogle().catch(() => toast.error("Couldn't open Google sign-in. Try again."))}>Continue with Google</Button>
                      <p className="text-center text-xs text-muted-foreground">Your data is saved to your private account and works offline.</p>
                    </div>
                  ) : (
                    <div className="mt-auto space-y-3 pt-8">
                      <Button size="lg" className="h-14 w-full rounded-2xl text-base" onClick={() => { actions.loadDemo(); go(1); }}>Explore with sample data</Button>
                      <Button size="lg" variant="outline" className="h-14 w-full rounded-2xl text-base" onClick={() => { actions.startFresh(); go(1); }}>Start with my own data</Button>
                      <p className="text-center text-xs text-muted-foreground">Everything syncs to your account and still works offline.</p>
                    </div>
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  <h2 className="font-display text-3xl font-bold">How transactions get in</h2>
                  <ul className="mt-6 space-y-3">
                    {[
                      { icon: PenLine, t: "Add by hand", d: "Two taps with the + button. Works offline." },
                      { icon: Upload, t: "Import a CSV", d: "Bring statements from your bank or another app." },
                      { icon: MessageSquareText, t: "Bank SMS (coming with the Android app)", d: "We'll read only bank alerts, on your phone, with your permission." },
                    ].map((x, i) => (
                      <motion.li key={x.t} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
                        className="flex gap-4 rounded-3xl bg-card p-4 shadow-soft">
                        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><x.icon className="size-5" /></span>
                        <div><p className="font-semibold">{x.t}</p><p className="text-sm text-muted-foreground">{x.d}</p></div>
                      </motion.li>
                    ))}
                  </ul>
                  <Next onClick={() => go(2)} />
                </>
              )}
              {step === 2 && (
                <>
                  <span className="grid size-16 place-items-center rounded-3xl bg-income-soft text-income"><ShieldCheck className="size-8" /></span>
                  <h2 className="mt-6 font-display text-3xl font-bold">Your money data stays yours</h2>
                  <ul className="mt-5 space-y-3 text-muted-foreground">
                    {["No bank login or password ever needed.", "Sample data is always labelled, so it's never mixed up with real records.", "Hide amounts with one tap when someone's looking.", "Only you can read your data. Export or delete everything whenever you like."].map((x) => (
                      <li key={x} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-income" />{x}</li>
                    ))}
                  </ul>
                  <label className="mt-8 block">
                    <span className="mb-1.5 block text-sm font-medium">What should we call you?</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" className="input-base" />
                  </label>
                  <Next onClick={() => go(3)} />
                </>
              )}
              {step === 3 && (
                <>
                  <h2 className="font-display text-3xl font-bold">Pick your home screen</h2>
                  <p className="mt-2 text-muted-foreground">You can rearrange these any time.</p>
                  <ul className="mt-5 space-y-2">
                    {prefs.widgets.map((w) => (
                      <li key={w.id}>
                        <label className={cn("flex items-center justify-between rounded-2xl border bg-card px-4 py-3 transition-colors", w.visible && "border-primary")}>
                          <span className="font-medium">{WIDGET_LABELS[w.id]}</span>
                          <Switch checked={w.visible} onCheckedChange={(v) => actions.setPrefs({ widgets: prefs.widgets.map((x) => (x.id === w.id ? { ...x, visible: v } : x)) })} />
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button className="mt-3 text-sm font-medium text-primary" onClick={() => actions.setPrefs({ widgets: DEFAULT_WIDGETS })}>Reset to recommended</button>
                  <Next onClick={() => go(4)} />
                </>
              )}
              {step === 4 && (
                <>
                  <motion.span initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 12 }}
                    className="grid size-16 place-items-center rounded-3xl bg-marigold-soft text-marigold"><Sparkles className="size-8" /></motion.span>
                  <h2 className="mt-6 font-display text-3xl font-bold">Want an AI helper?</h2>
                  <p className="mt-2 text-muted-foreground">Ask things like "How much did I spend on food last week?" or say "Add ₹250 for lunch". It's optional, and the rest of the app works without it.</p>
                  <label className="mt-6 flex items-center justify-between rounded-2xl border bg-card px-4 py-4">
                    <span><span className="block font-medium">Show the AI tab</span><span className="text-sm text-muted-foreground">Needs your OpenAI key, which you can add later</span></span>
                    <Switch checked={prefs.aiEnabled} onCheckedChange={(v) => actions.setPrefs({ aiEnabled: v })} />
                  </label>
                  <div className="mt-auto pt-8">
                    <Button size="lg" className="h-14 w-full rounded-2xl text-base" onClick={finish}>Go to my dashboard</Button>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Splash({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
        {action}
      </div>
    </div>
  );
}

function Next({ onClick }: { onClick: () => void }) {
  return (
    <div className="mt-auto pt-8">
      <Button size="lg" className="h-14 w-full rounded-2xl text-base" onClick={onClick}>Continue</Button>
    </div>
  );
}

function Backdrop({ step }: { step: number }) {
  return (
    <motion.div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full bg-peacock opacity-20 blur-3xl"
      animate={{ x: step * -30, y: step * 40, scale: 1 + step * 0.05 }} transition={{ type: "spring", stiffness: 40, damping: 15 }} />
  );
}

function HeroCoins() {
  const items = [
    { t: "Swiggy", a: "−₹452", c: "bg-expense-soft", d: 0 },
    { t: "Salary", a: "+₹92,000", c: "bg-income-soft", d: 0.15 },
    { t: "Metro", a: "−₹40", c: "bg-accent", d: 0.3 },
  ];
  return (
    <div className="relative h-56">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 140, damping: 14 }}
        className="absolute left-1/2 top-1/2 grid size-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-peacock font-display text-6xl font-bold text-primary-foreground shadow-lift">₹</motion.div>
      {items.map((x, i) => (
        <motion.div key={x.t}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: [0, -6, 0] }}
          transition={{ opacity: { delay: 0.4 + x.d }, y: { delay: 0.4 + x.d, duration: 3 + i, repeat: Infinity, ease: "easeInOut" } }}
          className={cn("absolute rounded-2xl px-3 py-2 text-sm shadow-soft", x.c, i === 0 && "left-0 top-4", i === 1 && "right-0 top-16", i === 2 && "bottom-2 left-8")}>
          <span className="font-medium">{x.t}</span> <span className="tnum font-semibold">{x.a}</span>
        </motion.div>
      ))}
    </div>
  );
}
