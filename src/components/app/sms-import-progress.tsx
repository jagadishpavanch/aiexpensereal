import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, MessageSquareText } from "lucide-react";
import { BOTTOM_BAR_REM } from "./bottom-nav";
import { useImportProgress, type ImportProgress, type ImportStage } from "@/lib/sms/runtime";
import { cn } from "@/lib/utils";

const STEPS: { id: ImportStage; label: string }[] = [
  { id: "reading", label: "Reading your messages" },
  { id: "sorting", label: "Finding bank alerts" },
  { id: "saving", label: "Saving transactions" },
];
const ORDER: Record<ImportStage, number> = { reading: 0, sorting: 1, saving: 2 };

/** 0–100. Reading is a short first slice, sorting most of the bar, saving the end. */
export function importPercent(p: ImportProgress | null): number {
  if (!p) return 0;
  if (p.stage === "reading") return 4;
  if (p.stage === "saving") return 98;
  return Math.round(6 + (p.total ? p.read / p.total : 0) * 90);
}

const fmt = (n: number) => n.toLocaleString("en-IN");

/** Big progress for the import sheet: ring, drifting message bubbles, the three steps and live counts. */
export function ImportProgressView({ progress }: { progress: ImportProgress | null }) {
  const reduce = useReducedMotion();
  const pct = importPercent(progress);
  const stage = progress?.stage ?? "reading";
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="relative mx-auto grid size-36 place-items-center">
        <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" className="stroke-muted" />
          <motion.circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-primary"
            strokeDasharray={C} initial={false} animate={{ strokeDashoffset: C * (1 - pct / 100) }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 60, damping: 18 }} />
        </svg>
        {/* message bubbles drifting into the counter while it works */}
        {!reduce && [0, 1, 2].map((i) => (
          <motion.span key={i} aria-hidden className="absolute grid size-7 place-items-center rounded-xl rounded-bl-sm bg-accent text-primary shadow-soft"
            initial={{ x: -70 + i * 70, y: 70, opacity: 0, scale: 0.6 }}
            animate={{ x: 0, y: 0, opacity: [0, 1, 0], scale: [0.6, 1, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5, ease: [0.16, 1, 0.3, 1] }}>
            <MessageSquareText className="size-3.5" />
          </motion.span>
        ))}
        <div className="relative text-center">
          <p className="font-display text-3xl font-bold tnum">{pct}%</p>
          <p className="text-xs text-muted-foreground tnum">{progress?.total ? `${fmt(progress.read)} / ${fmt(progress.total)}` : "Starting…"}</p>
        </div>
      </div>

      <ol className="space-y-2">
        {STEPS.map((s) => {
          const done = ORDER[s.id] < ORDER[stage];
          const now = s.id === stage;
          return (
            <li key={s.id} className={cn("flex items-center gap-3 text-sm transition-colors", done || now ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", done ? "bg-income text-primary-foreground" : now ? "bg-primary/15 text-primary" : "bg-muted")}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : now ? <motion.span className="size-2 rounded-full bg-primary" animate={reduce ? undefined : { scale: [1, 1.6, 1] }} transition={{ duration: 1, repeat: Infinity }} /> : null}
              </span>
              <span className="flex-1">{s.label}</span>
              {s.id === "sorting" && (now || done) && <span className="tnum text-xs text-muted-foreground">{fmt(progress?.found ?? 0)} found</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Small pill above the nav while an import runs in the background. */
export function ImportPill() {
  const progress = useImportProgress();
  const reduce = useReducedMotion();
  const pct = importPercent(progress);
  return (
    <AnimatePresence>
      {progress && (
        <motion.div key="import-pill" role="status" aria-live="polite"
          initial={reduce ? false : { y: 24, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 24, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${BOTTOM_BAR_REM + 0.75}rem)` }}
          className="fixed left-4 z-40 flex max-w-[70vw] items-center gap-2.5 rounded-full border bg-card/95 py-2 pl-2.5 pr-4 text-sm shadow-lift backdrop-blur md:bottom-6">
          <span className="relative grid size-6 place-items-center">
            <motion.span className="absolute inset-0 rounded-full border-2 border-primary/25 border-t-primary" animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} />
            <MessageSquareText className="size-3 text-primary" />
          </span>
          <span className="truncate">Importing SMS <span className="tnum font-semibold">{pct}%</span>{progress.found ? <span className="text-muted-foreground"> · {fmt(progress.found)} found</span> : null}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
