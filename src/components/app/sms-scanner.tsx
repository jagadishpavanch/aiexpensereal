import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, EyeOff, Loader2, MessageSquareText, Play, ReceiptText, RotateCcw } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { isFinanceAlert, parseAlert, type ParsedAlert } from "@/lib/finance/sms-parse";
import { formatINR } from "@/lib/finance/format";
import { CategoryIcon, Panel } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Result = { text: string; parsed: ParsedAlert | null; categoryId?: string };
type Phase = "idle" | "running" | "done";

const EASE = [0.16, 1, 0.3, 1] as const;
const READ_MS = 560;
const SETTLE_MS = 300;

/**
 * Live SMS reading demo: each message slides in under a scanning beam, then drops into a category bucket while the
 * counters tick. Messages go through the same parser and categoriser the Android app will use.
 */
export function SmsScanner({ samples }: { samples: string[] }) {
  const reduce = useReducedMotion();
  const categories = useFinance((s) => s.categories);
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const [results, setResults] = useState<Result[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const alive = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  // set on every mount: React's dev double-mount runs the cleanup once before the real mount
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, reduce ? 40 : ms));

  const run = async () => {
    setResults([]);
    setPhase("running");
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    for (const text of samples) {
      if (!alive.current) return;
      setCurrent(text);
      await wait(READ_MS);
      if (!alive.current) return;
      const parsed = isFinanceAlert(text) ? parseAlert(text) : null;
      const categoryId = parsed && parsed.kind !== "bill" ? actions.categorize(parsed.merchant ?? "", { text, type: parsed.kind === "income" ? "income" : "expense" }).categoryId : undefined;
      setResults((r) => [...r, { text, parsed, categoryId }]);
      await wait(SETTLE_MS);
    }
    if (!alive.current) return;
    setCurrent(null);
    setPhase("done");
  };

  const summary = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const buckets = new Map<string, { id: string; count: number; total: number }>();
    let txs = 0, bills = 0, ignored = 0, spent = 0;
    for (const r of results) {
      if (!r.parsed) { ignored++; continue; }
      if (r.parsed.kind === "bill") { bills++; continue; }
      txs++;
      if (r.parsed.kind === "expense") spent += r.parsed.amount;
      const id = r.categoryId ?? "other";
      const b = buckets.get(id) ?? { id, count: 0, total: 0 };
      buckets.set(id, { ...b, count: b.count + 1, total: b.total + r.parsed.amount });
    }
    return { txs, bills, ignored, spent, buckets: [...buckets.values()].map((b) => ({ ...b, cat: byId.get(b.id) })) };
  }, [results, categories]);

  const addFound = () => {
    const found = results.filter((r) => r.parsed && r.parsed.kind !== "bill");
    actions.importTxs(found.map((r) => {
      const p = r.parsed!;
      return { type: p.kind === "income" ? "income" : "expense", amount: p.amount, merchant: p.merchant ?? "Bank alert", categoryId: r.categoryId ?? "other", accountId: p.isUpi ? "upi" : "hdfc", date: new Date().toISOString(), source: "sms_demo", isDemo: true };
    }));
    toast.success(`Added ${found.length} sample transactions`);
  };

  const n = samples.length;
  const pct = Math.round((results.length / n) * 100);
  const last = results.at(-1);
  const catOf = (id?: string) => categories.find((c) => c.id === id);

  return (
    <div ref={box} className="scroll-mt-4">
    <Panel className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Live detection demo</h2>
        <Button size="sm" className="shrink-0 rounded-full" onClick={() => void run()} disabled={phase === "running"}>
          {phase === "running" ? <Loader2 className="size-4 animate-spin" /> : phase === "done" ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
          {phase === "running" ? "Reading…" : phase === "done" ? "Run again" : "Run demo"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Sample messages go through the same reader and categoriser the Android app will use.</p>

      {phase !== "idle" && (
        <>
          <div aria-live="polite">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{phase === "done" ? `All ${n} messages read` : `Reading message ${Math.min(results.length + 1, n)} of ${n}`}</span>
              <span className="tnum">{pct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
            </div>
          </div>

          {/* the scanner stage */}
          <div className="relative grid min-h-[8.5rem] place-items-stretch overflow-hidden rounded-3xl bg-muted/60 p-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {current ? (
                <motion.div
                  key={current}
                  initial={{ opacity: 0, y: 28, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -28, scale: 0.95 }}
                  transition={{ duration: 0.34, ease: EASE }}
                  className="relative self-center overflow-hidden rounded-2xl rounded-tl-md bg-card p-3 shadow-soft"
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><MessageSquareText className="size-3.5" /> Message</p>
                  <p className="mt-1 line-clamp-3 text-sm">{current}</p>
                  {!reduce && (
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
                      initial={{ top: "-45%" }}
                      animate={{ top: "110%" }}
                      transition={{ duration: READ_MS / 1000, ease: "easeInOut" }}
                    />
                  )}
                </motion.div>
              ) : (
                <motion.div key="done" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: EASE }} className="flex items-center gap-4 self-center p-1">
                  <span className="relative grid size-14 shrink-0 place-items-center">
                    {!reduce && Array.from({ length: 8 }, (_, i) => (
                      <motion.span
                        key={i}
                        aria-hidden
                        className="absolute size-1.5 rounded-full bg-income"
                        initial={{ x: 0, y: 0, opacity: 1 }}
                        animate={{ x: Math.cos((i / 8) * Math.PI * 2) * 34, y: Math.sin((i / 8) * Math.PI * 2) * 34, opacity: 0 }}
                        transition={{ duration: 0.7, ease: EASE, delay: 0.12 }}
                      />
                    ))}
                    <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 14, delay: 0.05 }} className="grid size-14 place-items-center rounded-full bg-income/15 text-income">
                      <CheckCircle2 className="size-8" />
                    </motion.span>
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold">Found {summary.txs} transactions</p>
                    <p className="text-sm text-muted-foreground">
                      {formatINR(summary.spent, { hidden })} spent, sorted into {summary.buckets.length} categories. {summary.bills} due bill{summary.bills === 1 ? "" : "s"}, {summary.ignored} messages ignored.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* verdict for the message just read */}
          <div className={phase === "running" ? "h-9" : "hidden"}>
            <AnimatePresence mode="wait">
              {phase === "running" && last && (
                <motion.div key={results.length} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }} className="flex h-9 min-w-0 items-center gap-2 text-sm">
                  {!last.parsed ? (
                    <><span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground"><EyeOff className="size-4" /></span><span className="truncate text-muted-foreground">Ignored, not a money alert</span></>
                  ) : last.parsed.kind === "bill" ? (
                    <><span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-marigold-soft"><CalendarClock className="size-4" /></span><span className="truncate font-medium">Due bill · {formatINR(last.parsed.amount, { hidden })}</span></>
                  ) : (
                    <><CategoryIcon category={catOf(last.categoryId)} size="sm" /><span className="truncate font-medium"><span className={last.parsed.kind === "income" ? "text-income" : "text-expense"}>{last.parsed.kind === "income" ? "+" : "−"}{formatINR(last.parsed.amount, { hidden })}</span>{" → "}{catOf(last.categoryId)?.name ?? "Other"}</span></>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat icon={ReceiptText} label="Transactions" value={summary.txs} tone="text-primary" />
            <Stat icon={CalendarClock} label="Due bills" value={summary.bills} tone="text-marigold" />
            <Stat icon={EyeOff} label="Ignored" value={summary.ignored} tone="text-muted-foreground" />
          </div>

          {summary.buckets.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Sorted into</p>
              <ul className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {summary.buckets.map((b) => (
                    <motion.li key={b.id} layout initial={{ opacity: 0, scale: 0.6, y: -12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 26 }} className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pl-1.5 pr-3">
                      <motion.span key={b.count} initial={reduce ? false : { scale: 1.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
                        <CategoryIcon category={b.cat} size="sm" />
                      </motion.span>
                      <span className="text-sm font-medium">{b.cat?.name ?? "Other"}</span>
                      <span className="tnum text-xs text-muted-foreground">×{b.count}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          )}

          {phase === "done" && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE, delay: 0.25 }} className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={cn("rounded-2xl border p-3 text-sm", !r.parsed && "opacity-50")}>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{r.text}</p>
                  <p className="mt-1 text-xs font-medium">
                    {!r.parsed ? "Ignored, not a money alert" : r.parsed.kind === "bill" ? `Due bill · ${formatINR(r.parsed.amount, { hidden })}` : `${r.parsed.kind === "income" ? "+" : "−"}${formatINR(r.parsed.amount, { hidden })} · ${catOf(r.categoryId)?.name ?? "Other"}${r.parsed.isUpi ? " · UPI" : ""}`}
                  </p>
                </div>
              ))}
              {summary.txs > 0 && <Button variant="secondary" className="h-11 w-full rounded-2xl" onClick={addFound}>Add detected transactions as samples</Button>}
            </motion.div>
          )}
        </>
      )}
    </Panel>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ReceiptText; label: string; value: number; tone: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted/60 p-2.5">
      <Icon className={cn("size-4", tone)} />
      <div className="mt-1 h-7 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p key={value} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="tnum font-display text-xl font-bold">
            {value}
          </motion.p>
        </AnimatePresence>
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
