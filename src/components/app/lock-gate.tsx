import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Delete, Fingerprint } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { clearPinFails, hashPin, isUnlocked, markUnlocked, pinLockedUntil, recordPinFail, touch, verifyBiometric } from "@/lib/finance/lock";
import { cn } from "@/lib/utils";

export function LockGate({ children }: { children: ReactNode }) {
  const on = useFinance((s) => s.prefs.features.lock);
  const lock = useFinance((s) => s.prefs.lock);
  const armed = on && (!!lock.credentialId || !!lock.pinHash);
  const [locked, setLocked] = useState(() => armed && !isUnlocked(lock.idleMinutes));

  useEffect(() => {
    if (!armed) { setLocked(false); return; }
    const onAct = () => touch();
    const tick = setInterval(() => { if (!isUnlocked(lock.idleMinutes)) setLocked(true); }, 15000);
    const onVis = () => { if (document.visibilityState === "visible" && !isUnlocked(lock.idleMinutes)) setLocked(true); };
    window.addEventListener("pointerdown", onAct);
    window.addEventListener("keydown", onAct);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(tick); window.removeEventListener("pointerdown", onAct); window.removeEventListener("keydown", onAct); document.removeEventListener("visibilitychange", onVis); };
  }, [armed, lock.idleMinutes]);

  if (!locked) return <>{children}</>;
  return <LockScreen onUnlock={() => { clearPinFails(); markUnlocked(); setLocked(false); }} />;
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const lock = useFinance((s) => s.prefs.lock);
  const name = useFinance((s) => s.prefs.name);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(0);
  // After too many wrong PINs the keypad waits; `waitUntil` is when it opens again (0 = open).
  const [waitUntil, setWaitUntil] = useState(() => pinLockedUntil());
  const [, setTick] = useState(0);
  const waitLeft = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => {
      if (Date.now() >= waitUntil) setWaitUntil(0);
      else setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [waitUntil]);

  const bio = async () => {
    if (!lock.credentialId) return;
    try {
      if (await verifyBiometric(lock.credentialId)) onUnlock();
    } catch {
      setErr(lock.pinHash ? "Fingerprint didn't work here. Use your PIN." : "Fingerprint didn't work. Try again.");
    }
  };

  useEffect(() => { if (lock.credentialId) void bio(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const press = async (d: string) => {
    if (waitUntil > Date.now()) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setErr("");
    if (next.length === 4) {
      if ((await hashPin(next)) === lock.pinHash) onUnlock();
      else {
        const until = recordPinFail();
        setWaitUntil(until > Date.now() ? until : 0);
        setErr("Wrong PIN");
        setShake((s) => s + 1);
        setPin("");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-peacock p-6 text-primary-foreground">
      <div className="pointer-events-none absolute inset-0 bg-feather" />
      <div className="relative flex w-full max-w-xs flex-col items-center">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-4 grid size-16 place-items-center rounded-3xl bg-primary-foreground/15 backdrop-blur">
          <Fingerprint className="size-8" />
        </motion.div>
        <h1 className="font-display text-2xl font-bold">ExTrack is locked</h1>
        <p className="mt-1 text-sm opacity-80">Welcome back{name ? `, ${name}` : ""}</p>

        {lock.pinHash && (
          <motion.div key={shake} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}} className="my-6 flex gap-3" aria-label={`${pin.length} of 4 digits entered`}>
            {[0, 1, 2, 3].map((i) => (
              <motion.span key={i} animate={{ scale: pin.length > i ? 1.15 : 1 }} className={cn("size-3.5 rounded-full border-2 border-primary-foreground", pin.length > i && "bg-primary-foreground")} />
            ))}
          </motion.div>
        )}
        <p className="h-5 text-sm text-marigold tnum" role="alert">{waitLeft > 0 ? `Too many wrong PINs. Try again in ${waitLeft >= 60 ? `${Math.ceil(waitLeft / 60)} min` : `${waitLeft} s`}` : err}</p>

        {lock.pinHash && (
          <div className="mt-2 grid w-full grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <Key key={d} onClick={() => press(d)}>{d}</Key>)}
            {lock.credentialId ? <Key onClick={bio} label="Use fingerprint"><Fingerprint className="size-6" /></Key> : <span />}
            <Key onClick={() => press("0")}>0</Key>
            <Key onClick={() => setPin((p) => p.slice(0, -1))} label="Delete"><Delete className="size-5" /></Key>
          </div>
        )}
        {!lock.pinHash && lock.credentialId && (
          <button onClick={bio} className="mt-6 flex h-12 items-center gap-2 rounded-2xl bg-primary-foreground px-6 font-medium text-primary">
            <Fingerprint className="size-5" /> Unlock with fingerprint
          </button>
        )}
      </div>
    </div>
  );
}

function Key({ children, onClick, label }: { children: ReactNode; onClick: () => void; label?: string }) {
  return (
    <motion.button whileTap={{ scale: 0.88 }} onClick={onClick} aria-label={label}
      className="grid h-16 place-items-center rounded-2xl bg-primary-foreground/12 font-display text-2xl font-semibold backdrop-blur">
      {children}
    </motion.button>
  );
}
