import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { CalendarClock, MessageSquareText, ShieldCheck } from "lucide-react";
import { BottomSheet, Chips } from "./sheet";
import { ImportProgressView } from "./sms-import-progress";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/lib/finance/store";
import { nativeSmsAvailable } from "@/lib/sms/native";
import { markSmsPromptAnswered, smsPromptDue, SmsPermissionError, startImport, useImportProgress, type ImportRange } from "@/lib/sms/runtime";

type Phase = "ask" | "working" | "denied";
type RangeKey = "1y" | "2y" | "all";
const RANGES: Record<RangeKey, ImportRange> = { "1y": 365, "2y": 730, all: "all" };

const POINTS = [
  { icon: MessageSquareText, text: "Only bank, card and UPI alerts. OTPs and chats are skipped." },
  { icon: ShieldCheck, text: "Read on this phone. Message text is never uploaded." },
  { icon: CalendarClock, text: "Adds your past bank SMS now, then new ones on their own." },
];

/**
 * Android, once per account on this phone: asks for SMS access right after sign-in and imports the
 * chosen range on Allow. A big inbox can take a while, so the import runs as a background job: the
 * sheet shows live progress and can be closed, and a toast reports the result either way.
 */
export function SmsPermissionPrompt() {
  const on = useFinance((s) => s.prefs.features.autoTracking);
  const reduce = useReducedMotion();
  const progress = useImportProgress();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("ask");
  const [range, setRange] = useState<RangeKey>("1y");

  useEffect(() => {
    if (!on || !nativeSmsAvailable() || !smsPromptDue()) return;
    const t = setTimeout(() => setOpen(true), 700); // let the first screen settle first
    return () => clearTimeout(t);
  }, [on]);

  const close = () => {
    markSmsPromptAnswered();
    setOpen(false);
  };

  const allow = async () => {
    setPhase("working");
    try {
      await startImport(RANGES[range]);
      close();
    } catch (e) {
      if (e instanceof SmsPermissionError) setPhase("denied");
      else close();
    }
  };

  const working = phase === "working";
  return (
    <BottomSheet open={open} onClose={close} title={working ? "Importing your bank SMS" : "Track bank SMS automatically"}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === "denied" ? (
          <motion.div key="denied" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <p className="text-sm text-muted-foreground">Android didn't allow SMS access. Apps installed from an APK need one extra switch first:</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Open Settings → Apps → ExTrack.</li>
              <li>Tap ⋮ (top right) → Allow restricted settings.</li>
              <li>Then Permissions → SMS → Allow.</li>
            </ol>
            <div className="flex gap-2">
              <Button className="h-12 flex-1 rounded-2xl" onClick={() => void allow()}>Try again</Button>
              <Button variant="secondary" className="h-12 rounded-2xl" onClick={close}>Later</Button>
            </div>
            <p className="text-xs text-muted-foreground">You can also do this later from the card on Home.</p>
          </motion.div>
        ) : working ? (
          <motion.div key="working" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            <ImportProgressView progress={progress} />
            <p className="text-center text-sm text-muted-foreground">A big inbox can take a few minutes. You can keep using ExTrack; we'll tell you when it's done.</p>
            <Button variant="secondary" className="h-12 w-full rounded-2xl" onClick={close}>Keep using ExTrack</Button>
          </motion.div>
        ) : (
          <motion.div key="ask" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            <ul className="space-y-3">
              {POINTS.map((p, i) => (
                <motion.li key={p.text} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }} className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><p.icon className="size-5" /></span>
                  <p className="pt-2 text-sm">{p.text}</p>
                </motion.li>
              ))}
            </ul>
            <div className="space-y-2">
              <p className="text-sm font-medium">How far back</p>
              <Chips<RangeKey> value={range} onChange={setRange} options={[{ v: "1y", label: "1 year" }, { v: "2y", label: "2 years" }, { v: "all", label: "Everything" }]} />
            </div>
            <div className="space-y-2">
              <Button className="h-12 w-full rounded-2xl text-base" onClick={() => void allow()}>Allow SMS access</Button>
              <Button variant="ghost" className="h-11 w-full rounded-2xl" onClick={close}>Not now</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </BottomSheet>
  );
}
