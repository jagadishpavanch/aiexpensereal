import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, MessageSquareText, ShieldCheck } from "lucide-react";
import { BottomSheet } from "./sheet";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/lib/finance/store";
import { nativeSmsAvailable } from "@/lib/sms/native";
import { importAll, markSmsPromptAnswered, smsPromptDue, SmsPermissionError, undoImport } from "@/lib/sms/runtime";

type Phase = "ask" | "working" | "denied";

const POINTS = [
  { icon: MessageSquareText, text: "Only bank, card and UPI alerts. OTPs and chats are skipped." },
  { icon: ShieldCheck, text: "Read on this phone. Message text is never uploaded." },
  { icon: CalendarClock, text: "Adds your past bank SMS now, then new ones on their own." },
];

/**
 * Android, once per account on this phone: asks for SMS access right after sign-in and imports
 * the inbox on Allow. The answer is saved, so it never asks again; the Home card stays as a way back.
 */
export function SmsPermissionPrompt() {
  const on = useFinance((s) => s.prefs.features.autoTracking);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("ask");

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
      const r = await importAll();
      close();
      if (r.txs || r.bills) {
        const parts = [r.txs && `${r.txs} transaction${r.txs === 1 ? "" : "s"}`, r.bills && `${r.bills} bill${r.bills === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
        toast.success(`Added ${parts} from bank SMS`, { description: "New bank messages will be added on their own.", duration: 8000, action: r.ids.length ? { label: "Undo", onClick: () => undoImport(r.ids) } : undefined });
      } else {
        toast.success("SMS tracking is on", { description: "No bank messages found on this phone yet. New ones will be added as they arrive." });
      }
    } catch (e) {
      if (e instanceof SmsPermissionError) setPhase("denied");
      else {
        close();
        toast.error("Couldn't read messages. Try again from More → Auto-tracking.");
      }
    }
  };

  return (
    <BottomSheet open={open} onClose={phase === "working" ? () => {} : close} title="Track bank SMS automatically">
      {phase === "denied" ? (
        <div className="space-y-4">
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
        </div>
      ) : (
        <div className="space-y-5">
          <ul className="space-y-3">
            {POINTS.map((p, i) => (
              <motion.li key={p.text} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }} className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><p.icon className="size-5" /></span>
                <p className="pt-2 text-sm">{p.text}</p>
              </motion.li>
            ))}
          </ul>
          <div className="space-y-2">
            <Button className="h-12 w-full rounded-2xl text-base" disabled={phase === "working"} onClick={() => void allow()}>
              {phase === "working" ? <><Loader2 className="size-5 animate-spin" />Reading your bank SMS…</> : "Allow SMS access"}
            </Button>
            <Button variant="ghost" className="h-11 w-full rounded-2xl" disabled={phase === "working"} onClick={close}>Not now</Button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
