import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Fingerprint, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { biometricAvailable, hashPin, lockNow, markUnlocked, registerBiometric } from "@/lib/finance/lock";
import { PageTitle, Panel } from "@/components/app/bits";
import { Chips, Field } from "@/components/app/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_shell/lock")({
  head: () => ({
    meta: [
      { title: "App lock — ExTrack" },
      { name: "description", content: "Lock ExTrack with your phone's fingerprint or face unlock, with a PIN as backup." },
      { property: "og:title", content: "App lock — ExTrack" },
      { property: "og:description", content: "Lock ExTrack with your phone's fingerprint or face unlock, with a PIN as backup." },
    ],
  }),
  component: LockSetup,
});

function LockSetup() {
  const prefs = useFinance((s) => s.prefs);
  const lock = prefs.lock;
  const on = prefs.features.lock;
  const [bio, setBio] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  useEffect(() => { biometricAvailable().then(setBio); }, []);
  const setLock = (p: Partial<typeof lock>) => actions.setPrefs({ lock: { ...lock, ...p } });

  const setupBio = async () => {
    try {
      const id = await registerBiometric(prefs.name);
      setLock({ credentialId: id });
      markUnlocked();
      toast.success("Fingerprint unlock is ready");
    } catch (e) {
      toast.error("Couldn't set up fingerprint", { description: e instanceof Error ? e.message : "Try again, or use a PIN." });
    }
  };
  const savePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) return toast.error("PIN must be 4 digits");
    if (pin !== pin2) return toast.error("PINs don't match");
    setLock({ pinHash: await hashPin(pin) });
    markUnlocked();
    setPin(""); setPin2("");
    toast.success("PIN saved");
  };
  const ready = !!lock.credentialId || !!lock.pinHash;

  return (
    <div className="space-y-5">
      <PageTitle title="App lock" sub="Keep your money private" />

      <Panel className="flex items-center gap-4 bg-peacock text-primary-foreground">
        <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.4 }} className="grid size-14 place-items-center rounded-2xl bg-primary-foreground/15"><Fingerprint className="size-8" /></motion.span>
        <div className="flex-1">
          <p className="font-display text-lg font-semibold">{on && ready ? "Lock is on" : "Lock is off"}</p>
          <p className="text-sm opacity-85">{ready ? "Asks to unlock when you open the app and after you're idle." : "Set up fingerprint or a PIN first."}</p>
        </div>
        <Switch checked={on} disabled={!ready} aria-label="App lock" onCheckedChange={(v) => { actions.setPrefs({ features: { ...prefs.features, lock: v } }); if (v) markUnlocked(); }} />
      </Panel>

      <Panel className="space-y-3">
        <div className="flex items-center gap-2"><Fingerprint className="size-5 text-primary" /><h2 className="font-semibold">Fingerprint or face unlock</h2></div>
        {bio === false && <p className="text-sm text-muted-foreground">This browser doesn't offer fingerprint unlock. Use a PIN instead. It works on Android Chrome and most modern phones.</p>}
        {lock.credentialId ? (
          <div className="flex items-center justify-between rounded-2xl bg-accent p-3 text-sm"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-income" />Set up on this device</span>
            <Button size="sm" variant="ghost" onClick={() => setLock({ credentialId: undefined })}>Remove</Button></div>
        ) : (
          <Button className="h-11 w-full rounded-2xl" disabled={!bio} onClick={setupBio}><Fingerprint className="size-4" />Set up fingerprint</Button>
        )}
      </Panel>

      <Panel className="space-y-3">
        <div className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /><h2 className="font-semibold">Backup PIN</h2>{lock.pinHash && <span className="ml-auto text-xs text-income">Saved</span>}</div>
        <form onSubmit={savePin} className="grid grid-cols-2 gap-3">
          <Field label={lock.pinHash ? "New 4-digit PIN" : "4-digit PIN"}><input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="input-base h-11 tracking-[0.5em]" /></Field>
          <Field label="Repeat PIN"><input type="password" inputMode="numeric" maxLength={4} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} className="input-base h-11 tracking-[0.5em]" /></Field>
          <Button type="submit" variant="secondary" className="col-span-2 h-11 rounded-2xl">Save PIN</Button>
        </form>
      </Panel>

      <Panel className="space-y-3">
        <h2 className="font-semibold">Lock after being idle for</h2>
        <Chips value={String(lock.idleMinutes)} onChange={(v) => setLock({ idleMinutes: Number(v) })}
          options={[{ v: "1", label: "1 min" }, { v: "5", label: "5 min" }, { v: "15", label: "15 min" }, { v: "60", label: "1 hour" }]} />
        {on && ready && <Button variant="outline" className="h-11 w-full rounded-2xl" onClick={() => { lockNow(); location.reload(); }}><Lock className="size-4" />Lock now</Button>}
      </Panel>
    </div>
  );
}
