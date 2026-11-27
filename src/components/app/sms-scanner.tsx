import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, CopyX, EyeOff, HelpCircle, Loader2, MessageSquareText, Play, ReceiptText, RotateCcw } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { formatINR } from "@/lib/finance/format";
import type { ImportItem } from "@/lib/sms/types";
import { CategoryIcon, Panel } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "idle" | "loading" | "running" | "done" | "saved";
const EASE = [0.16, 1, 0.3, 1] as const;
/** The whole animation stays under about 8 s however many messages there are. */
const stepMs = (n: number) => Math.max(60, Math.min(560, 8000 / Math.max(n, 1)));
const LIST_MAX = 60;

/** Messages worth showing one by one: everything except texts from non-bank senders, which are only counted. */
const shown = (items: ImportItem[]) => items.filter((i) => !(i.outcome.kind === "ignored" && i.outcome.reason === "sender"));

export function SmsScanner({ title, note, runLabel, load, onConfirm, confirmLabel }: {
  title: string;
  note: string;
  runLabel: string;
  load: () => Promise<{ items: ImportItem[]; scanned: number }>;
  onConfirm: (items: ImportItem[]) => void;
  confirmLabel: (c: { txs: number; bills: number }) => string;
}) {
  const reduce = useReducedMotion();
  const categories = useFinance((s) => s.categories);
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const [phase, setPhase] = useState<Phase>("idle");
  const [all, setAll] = useState<ImportItem[]>([]);
  const [scanned, setScanned] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  // set on every mount: React's dev double-mount runs the cleanup once before the real mount
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const queue = useMemo(() => shown(all), [all]);
  const done = queue.slice(0, count);
  const current = phase === "running" ? queue[count] : undefined;
  const catOf = (id: string) => categories.find((c) => c.id === id);

  const run = async () => {
    setError(null);
    setPhase("loading");
    setCount(0);
    let res: { items: ImportItem[]; scanned: number };
    try {
      res = await load();
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : "Couldn't read messages");
      setPhase("idle");
      return;
    }
    if (!alive.current) return;
    setAll(res.items);
    setScanned(res.scanned);
    setPhase("running");
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    const list = shown(res.items);
    const step = reduce ? 30 : stepMs(list.length);
    for (let i = 1; i <= list.length; i++) {
      await new Promise((r) => setTimeout(r, step));
      if (!alive.current) return;
      setCount(i);
    }
    setPhase("done");
  };

  // cheap enough to recompute each render (a few thousand items at most)
  const stats = (() => {
    const src = phase === "done" || phase === "saved" ? all : done;
    let txs = 0, bills = 0, skipped = 0, unread = 0, spent = 0;
    const buckets = new Map<string, number>();
    for (const i of src) {
      const o = i.outcome;
      if (o.kind === "tx") {
        txs++;
        if (o.tx.type === "expense") spent += o.tx.amount;
        buckets.set(o.tx.categoryId, (buckets.get(o.tx.categoryId) ?? 0) + 1);
      } else if (o.kind === "bill") bills++;
      else if (o.kind === "unread") unread++;
      else skipped++;
    }
    return { txs, bills, skipped, unread, spent, buckets: [...buckets.entries()].map(([id, n]) => ({ id, n, cat: catOf(id) })) };
  })();

  const last = done.at(-1);
  const pct = queue.length ? Math.round((count / queue.length) * 100) : phase === "done" || phase === "saved" ? 100 : 0;
  const notable = all.filter((i) => i.outcome.kind === "tx" || i.outcome.kind === "bill").reverse();
  const unread = all.filter((i) => i.outcome.kind === "unread");

  return (
    <div ref={box} className="scroll-mt-4">
      <Panel className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{title}</h2>
          <Button size="sm" className="shrink-0 rounded-full" onClick={() => void run()} disabled={phase === "loading" || phase === "running"}>
            {phase === "loading" || phase === "running" ? <Loader2 className="size-4 animate-spin" /> : phase === "idle" ? <Play className="size-4" /> : <RotateCcw className="size-4" />}
            {phase === "loading" ? "Opening…" : phase === "running" ? "Reading…" : phase === "idle" ? runLabel : "Run again"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{note}</p>
        {error && <p className="rounded-2xl bg-expense/10 p-3 text-sm text-expense" role="alert">{error}</p>}

        {phase !== "idle" && phase !== "loading" && (
          <>
            <div aria-live="polite">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{phase === "running" ? `Reading ${Math.min(count + 1, queue.length)} of ${queue.length}` : `Read ${scanned} messages`}</span>
                <span className="tnum">{pct}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
              </div>
            </div>

            <div className="relative grid min-h-[8.5rem] overflow-hidden rounded-3xl bg-muted/60 p-3">
              <AnimatePresence mode="popLayout" initial={false}>
                {current ? (
                  <motion.div key={current.alert.id} initial={{ opacity: 0, y: 28, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -28, scale: 0.95 }} transition={{ duration: 0.3, ease: EASE }} className="relative self-center overflow-hidden rounded-2xl rounded-tl-md bg-card p-3 shadow-soft">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><MessageSquareText className="size-3.5" /> {current.alert.from || "Message"}</p>
                    <p className="mt-1 line-clamp-3 text-sm">{current.alert.text}</p>
                    {!reduce && <motion.span aria-hidden className="pointer-events-none absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-primary/25 to-transparent" initial={{ top: "-45%" }} animate={{ top: "110%" }} transition={{ duration: stepMs(queue.length) / 1000, ease: "easeInOut" }} />}
                  </motion.div>
                ) : (
                  <motion.div key="summary" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: EASE }} className="flex items-center gap-4 self-center p-1">
                    <span className="relative grid size-14 shrink-0 place-items-center">
                      {!reduce && Array.from({ length: 8 }, (_, i) => (
                        <motion.span key={i} aria-hidden className="absolute size-1.5 rounded-full bg-income" initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos((i / 8) * Math.PI * 2) * 34, y: Math.sin((i / 8) * Math.PI * 2) * 34, opacity: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.12 }} />
                      ))}
                      <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 14, delay: 0.05 }} className="grid size-14 place-items-center rounded-full bg-income/15 text-income">
                        <CheckCircle2 className="size-8" />
                      </motion.span>
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-lg font-semibold">{phase === "saved" ? "Added to your account" : `Found ${stats.txs} transactions`}</p>
                      <p className="text-sm text-muted-foreground">{formatINR(stats.spent, { hidden })} spent across {stats.buckets.length} categories, {stats.bills} due bill{stats.bills === 1 ? "" : "s"}.</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className={phase === "running" ? "h-9" : "hidden"}>
              <AnimatePresence mode="wait">
                {phase === "running" && last && (
                  <motion.div key={last.alert.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: EASE }} className="flex h-9 min-w-0 items-center gap-2 text-sm">
                    <Verdict item={last} hidden={hidden} catName={(id) => catOf(id)?.name ?? "Other"} cat={(id) => catOf(id)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat icon={ReceiptText} label="Transactions" value={stats.txs} tone="text-primary" />
              <Stat icon={CalendarClock} label="Due bills" value={stats.bills} tone="text-marigold" />
              <Stat icon={EyeOff} label="Skipped" value={stats.skipped} tone="text-muted-foreground" />
            </div>

            {stats.buckets.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Sorted into</p>
                <ul className="flex flex-wrap gap-2">
                  <AnimatePresence>
                    {stats.buckets.map((b) => (
                      <motion.li key={b.id} layout initial={{ opacity: 0, scale: 0.6, y: -12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 26 }} className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pl-1.5 pr-3">
                        <motion.span key={b.n} initial={reduce ? false : { scale: 1.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
                          <CategoryIcon category={b.cat} size="sm" />
                        </motion.span>
                        <span className="text-sm font-medium">{b.cat?.name ?? "Other"}</span>
                        <span className="tnum text-xs text-muted-foreground">×{b.n}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            )}

            {(phase === "done" || phase === "saved") && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE, delay: 0.2 }} className="space-y-2">
                {notable.slice(0, LIST_MAX).map((i) => (
                  <div key={i.alert.id} className="flex items-center gap-2 rounded-2xl border p-3 text-sm">
                    <Verdict item={i} hidden={hidden} catName={(id) => catOf(id)?.name ?? "Other"} cat={(id) => catOf(id)} />
                  </div>
                ))}
                {notable.length > LIST_MAX && <p className="text-center text-xs text-muted-foreground">and {notable.length - LIST_MAX} more</p>}
                {unread.length > 0 && (
                  <details className="rounded-2xl border p-3 text-sm">
                    <summary className="flex cursor-pointer items-center gap-2 font-medium"><HelpCircle className="size-4 text-marigold" />Bank messages we couldn't read ({unread.length})</summary>
                    <p className="mt-2 text-xs text-muted-foreground">These stay on your phone. They show where the reader needs new rules.</p>
                    <ul className="mt-2 space-y-2">
                      {unread.slice(0, 30).map((i) => <li key={i.alert.id} className="rounded-xl bg-muted p-2 text-xs">{i.alert.text}</li>)}
                    </ul>
                  </details>
                )}
                {phase === "done" && stats.txs + stats.bills > 0 && (
                  <Button className="h-11 w-full rounded-2xl" onClick={() => { onConfirm(all); setPhase("saved"); }}>{confirmLabel({ txs: stats.txs, bills: stats.bills })}</Button>
                )}
              </motion.div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function Verdict({ item, hidden, catName, cat }: { item: ImportItem; hidden: boolean; catName: (id: string) => string; cat: (id: string) => Parameters<typeof CategoryIcon>[0]["category"] }) {
  const o = item.outcome;
  if (o.kind === "tx") {
    const inflow = o.tx.type === "income" || o.tx.type === "refund";
    // a transfer moves money between your own accounts: no sign, neutral colour
    const sign = o.tx.type === "transfer" ? "" : inflow ? "+" : "−";
    const tone = o.tx.type === "transfer" ? "text-muted-foreground" : inflow ? "text-income" : "text-expense";
    return (
      <>
        <CategoryIcon category={cat(o.tx.categoryId)} size="sm" />
        <span className="min-w-0 truncate font-medium">
          <span className={tone}>{sign}{formatINR(o.tx.amount, { hidden })}</span> {o.tx.merchant} → {catName(o.tx.categoryId)}
        </span>
      </>
    );
  }
  if (o.kind === "bill") return (<><span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-marigold-soft"><CalendarClock className="size-4" /></span><span className="truncate font-medium">Due bill · {formatINR(o.bill.amount, { hidden })} · {o.bill.name}</span></>);
  if (o.kind === "duplicate") return (<><span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground"><CopyX className="size-4" /></span><span className="truncate text-muted-foreground">Already added</span></>);
  if (o.kind === "unread") return (<><span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-marigold-soft"><HelpCircle className="size-4" /></span><span className="truncate text-muted-foreground">Bank message we couldn't read</span></>);
  return (<><span className="grid size-8 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground"><EyeOff className="size-4" /></span><span className={cn("truncate text-muted-foreground")}>{o.reason === "bills-off" ? "Bill (bills are switched off)" : "Ignored, not a money alert"}</span></>);
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ReceiptText; label: string; value: number; tone: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted/60 p-2.5">
      <Icon className={cn("size-4", tone)} />
      <div className="mt-1 h-7 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p key={value} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="tnum font-display text-xl font-bold">{value}</motion.p>
        </AnimatePresence>
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
