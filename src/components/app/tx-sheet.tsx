import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle, Gift, Sparkles, Users, X } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { budgetAfter, inMonth, isDuplicate, overallStatus } from "@/lib/finance/calc";
import { CASHBACK_SOURCES } from "@/lib/finance/cashback";
import { explainCategorization, shouldLearn } from "@/lib/finance/categorize";
import { computeShares } from "@/lib/finance/splits";
import { formatINR } from "@/lib/finance/format";
import type { SplitMode } from "@/lib/finance/types";
import type { Transaction, TxType } from "@/lib/finance/types";
import { Button } from "@/components/ui/button";
import { CategoryIcon } from "./bits";
import { cn } from "@/lib/utils";

const schema = z.object({
  type: z.enum(["expense", "income", "transfer", "refund"]),
  amount: z.coerce.number({ invalid_type_error: "Enter an amount" }).positive("Amount must be more than ₹0").max(10_000_000, "That's more than ₹1 crore"),
  merchant: z.string().trim().min(1, "Add who you paid or who paid you").max(60),
  categoryId: z.string().min(1, "Pick a category"),
  accountId: z.string().min(1),
  date: z.string().min(1),
  note: z.string().max(200).optional(),
});
type FormValues = z.infer<typeof schema>;

export interface TxPreset { date?: string; type?: TxType }
const Ctx = createContext<{ open: (tx?: Transaction, preset?: TxPreset) => void; isOpen: boolean; setOverlay: (v: boolean) => void }>({ open: () => {}, isOpen: false, setOverlay: () => {} });
export const useTxSheet = () => useContext(Ctx);

export function TxSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; tx?: Transaction; preset?: TxPreset }>({ open: false });
  const [overlay, setOverlay] = useState(false);
  return (
    <Ctx.Provider value={{ open: (tx, preset) => setState({ open: true, tx, preset }), isOpen: state.open || overlay, setOverlay }}>
      {children}
      <AnimatePresence>
        {state.open && <Sheet key="sheet" tx={state.tx} preset={state.preset} onClose={() => setState({ open: false })} />}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

const TYPES: { v: TxType; label: string }[] = [
  { v: "expense", label: "Expense" },
  { v: "income", label: "Income" },
  { v: "refund", label: "Refund" },
  { v: "transfer", label: "Transfer" },
];

function localInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Sheet({ tx, preset, onClose }: { tx?: Transaction; preset?: TxPreset; onClose: () => void }) {
  const drag = useDragControls();
  const categories = useFinance((s) => s.categories);
  const features = useFinance((s) => s.prefs.features);
  const overall = useFinance((s) => s.prefs.overallBudget);
  const budgets = useFinance((s) => s.budgets);
  const people = useFinance((s) => s.people);
  const [cashback, setCashback] = useState(!!tx?.cashback);
  const [cbSource, setCbSource] = useState(tx?.cashbackSource ?? "Google Pay");
  const [splitOn, setSplitOn] = useState(false);
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [splitVals, setSplitVals] = useState<Record<string, string>>({});
  const [paidBy, setPaidBy] = useState("me");
  const [newPerson, setNewPerson] = useState("");
  // What the categorization engine last picked for this merchant, and why. Kept even if the user overrides it.
  const [suggestion, setSuggestion] = useState<{ categoryId: string; why?: string } | null>(null);
  // True once the user taps a category in this session. Only an explicit pick may teach the engine, and a later merchant change must not overwrite it.
  const userPicked = useRef(false);
  // True while the form's category came from the engine, so it can be reset if the merchant is cleared.
  const autoSet = useRef(false);
  const reduce = useReducedMotion();
  const accounts = useFinance((s) => s.accounts);
  const all = useFinance((s) => s.transactions);
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: tx?.type ?? preset?.type ?? "expense",
      amount: tx?.amount ?? ("" as unknown as number),
      merchant: tx?.merchant ?? "",
      categoryId: tx?.categoryId ?? "food",
      accountId: tx?.accountId ?? "upi",
      date: localInput(tx?.date ?? preset?.date ?? new Date().toISOString()),
      note: tx?.note ?? "",
    },
  });
  const type = watch("type");
  const cat = watch("categoryId");
  const merchant = watch("merchant");
  const amountRaw = Number(watch("amount")) || 0;
  const kind = type === "income" ? "income" : "expense";
  const when = new Date(watch("date") || Date.now());
  const monthTxs = all.filter((t) => inMonth(t.date, when) && t.id !== tx?.id);
  const catBudget = budgets.find((b) => b.categoryId === cat);
  const catAfter = type === "expense" && catBudget && amountRaw > 0 ? budgetAfter(catBudget, monthTxs, amountRaw) : null;
  const allAfter = type === "expense" && overall > 0 && amountRaw > 0 ? overallStatus(overall, monthTxs, amountRaw) : null;
  const participants = ["me", ...splitWith];
  // The payer must be on the split: if the person picked as payer was taken off again, it falls back to me.
  const payer = participants.includes(paidBy) ? paidBy : "me";
  const split = splitOn && amountRaw > 0 ? computeShares(amountRaw, splitMode, participants.map((id) => ({ personId: id, value: Number(splitVals[id]) || 0 }))) : null;
  const nameOf = (id: string) => (id === "me" ? "You" : people.find((p) => p.id === id)?.name ?? "?");
  const cats = categories.filter((c) => c.kind === kind);

  useEffect(() => {
    if (!cats.some((c) => c.id === cat)) {
      userPicked.current = false;
      setValue("categoryId", cats[0]?.id ?? "other");
    }
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tx || userPicked.current) return;
    if (!merchant.trim() && !autoSet.current) return; // untouched form: keep the default category
    const r = actions.categorize(merchant, { type });
    setValue("categoryId", r.categoryId);
    if (r.source === "fallback") {
      autoSet.current = !!merchant.trim();
      setSuggestion(null);
      return;
    }
    autoSet.current = true;
    setSuggestion({ categoryId: r.categoryId, why: explainCategorization(r) });
  }, [merchant, type, tx, setValue]);

  /** Learn from a correction: future payments to this merchant go to the category the user chose. */
  const learnFrom = (v: FormValues) => {
    if (v.type === "transfer") return;
    const enginePick = tx ? undefined : actions.categorize(v.merchant, { type: v.type }).categoryId;
    if (!shouldLearn({ userPicked: userPicked.current, chosen: v.categoryId, enginePick, original: tx?.categoryId })) return;
    if (!actions.learnCategory(v.merchant, v.categoryId)) return;
    const name = categories.find((c) => c.id === v.categoryId)?.name ?? "that category";
    const merchantName = v.merchant.trim();
    // Counted after this save, so the transaction just edited isn't offered again.
    const past = actions.pastToRecategorize(v.merchant, v.categoryId);
    toast.success(`Future ${merchantName} payments go to ${name}`, past ? {
      description: `${past} earlier ${past === 1 ? "one is" : "ones are"} in other categories.`,
      duration: 10000,
      action: {
        label: `Also change ${past} past`,
        onClick: () => {
          const undo = actions.recategorizeMerchant(v.merchant, v.categoryId);
          toast.success(`Moved ${past} past ${merchantName} transaction${past === 1 ? "" : "s"} to ${name}`, { action: { label: "Undo", onClick: undo } });
        },
      },
    } : undefined);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onSubmit = (v: FormValues) => {
    const isCb = features.cashback && v.type === "income" && cashback;
    const payload = { ...v, date: new Date(v.date).toISOString(), note: v.note || undefined, cashback: isCb || undefined, cashbackSource: isCb ? cbSource : undefined };
    if (!tx && splitOn && v.type === "expense") {
      if (!split || split.error || splitWith.length === 0) { toast.error(split?.error ?? "Pick who you are splitting with"); return; }
      actions.addSplit(
        { title: v.merchant, total: v.amount, paidBy: payer, date: payload.date, mode: splitMode, shares: split.shares },
        { ...payload, source: "manual", isDemo: false },
      );
      toast.success("Split saved", { description: payer === "me" ? "We'll keep track of who owes you." : `You owe ${nameOf(payer)} your share.` });
      learnFrom(v);
      onClose();
      return;
    }
    if (tx) {
      actions.updateTx(tx.id, payload);
      toast.success("Transaction updated");
      learnFrom(v);
    } else {
      if (isDuplicate(payload, all)) toast.warning("This looks like a duplicate of a recent transaction. Saved anyway.");
      actions.addTx({ ...payload, source: "manual", isDemo: false });
      toast.success(v.type === "income" ? "Income added" : "Expense added");
      learnFrom(v);
    }
    onClose();
  };

  return (
    <>
      <motion.div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog" aria-modal aria-label={tx ? "Edit transaction" : "Add transaction"}
        data-testid="sheet-scroll"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[calc(100dvh-env(safe-area-inset-top,0px)-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[2rem] bg-card p-5 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] shadow-lift md:bottom-auto md:top-1/2 md:max-h-[92dvh] md:-translate-y-1/2 md:rounded-[2rem]"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        // Drag-to-close starts only from the handle and title row: a drag listener on the whole
        // sheet sets touch-action on it, and the form could no longer scroll on a phone.
        drag="y" dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, i) => i.offset.y > 120 && onClose()}
      >
        <div onPointerDown={(e) => drag.start(e)} className="-mx-5 -mt-5 touch-none px-5 pt-5" data-testid="sheet-handle">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted md:hidden" />
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">{tx ? "Edit transaction" : "Add transaction"}</h2>
            <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-muted" aria-label="Close"><X className="size-4" /></button>
          </div>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="relative grid grid-cols-4 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Type">
            {TYPES.map((t) => (
              <button key={t.v} type="button" role="radio" aria-checked={type === t.v} onClick={() => setValue("type", t.v)}
                className={cn("relative z-10 rounded-xl py-2 text-sm font-medium transition-colors", type === t.v ? "text-primary-foreground" : "text-muted-foreground")}>
                {type === t.v && <motion.span layoutId="type-pill" className="absolute inset-0 -z-10 rounded-xl bg-primary" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
                {t.label}
              </button>
            ))}
          </div>

          <label className="block text-center">
            <span className="sr-only">Amount in rupees</span>
            <div className="flex items-baseline justify-center gap-1">
              <span className="font-display text-3xl text-muted-foreground">₹</span>
              <input {...register("amount")} inputMode="decimal" autoFocus={!tx} placeholder="0"
                className="w-48 bg-transparent text-center font-display text-5xl font-bold tnum outline-none placeholder:text-muted" />
            </div>
            {errors.amount && <p className="mt-1 text-sm text-destructive">{errors.amount.message}</p>}
          </label>

          <Field label={type === "income" ? "From" : "Paid to"} error={errors.merchant?.message}>
            <input {...register("merchant")} placeholder="e.g. Swiggy, landlord, Ravi" className="input-base" />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium">Category</p>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <motion.button whileTap={{ scale: 0.94 }} type="button" key={c.id} onClick={() => { userPicked.current = true; setValue("categoryId", c.id); }}
                  aria-pressed={cat === c.id}
                  className={cn("flex items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 text-sm transition-colors", cat === c.id ? "border-primary bg-accent" : "border-border")}>
                  <CategoryIcon category={c} size="sm" />{c.name}
                </motion.button>
              ))}
            </div>
            <div role="status" aria-live="polite">
              <AnimatePresence initial={false}>
                {suggestion && suggestion.categoryId === cat && (
                  <motion.p key="auto-hint" className={cn("overflow-hidden text-xs text-muted-foreground", reduce && "mt-2")}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0 }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto", marginTop: 8 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: reduce ? 0.15 : 0.25, ease: [0.16, 1, 0.3, 1] }}>
                    <Sparkles className="mr-1 inline size-3 text-primary" aria-hidden />
                    Auto: <span className="font-medium text-foreground">{categories.find((c) => c.id === cat)?.name}</span>
                    {suggestion.why ? ` · ${suggestion.why}` : ""}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="grid gap-3 min-[400px]:grid-cols-2">
            <Field label="Account">
              <select {...register("accountId")} className="input-base">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Date & time">
              <input type="datetime-local" {...register("date")} className="input-base" />
            </Field>
          </div>
          <Field label="Note (optional)">
            <input {...register("note")} placeholder="Add a note" className="input-base" />
          </Field>

          {(catAfter && catAfter.state !== "ok") || (allAfter && allAfter.state !== "ok") ? (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="alert"
              className={cn("flex gap-3 rounded-2xl p-3 text-sm", (catAfter?.state === "over" || allAfter?.state === "over") ? "bg-expense/12" : "bg-marigold-soft")}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-0.5">
                {catAfter && catAfter.state !== "ok" && <p>{catAfter.state === "over" ? `This takes ${categories.find((c) => c.id === cat)?.name} over its budget by ${formatINR(-catAfter.remaining)}.` : `${Math.round(catAfter.pct * 100)}% of the ${categories.find((c) => c.id === cat)?.name} budget used after this.`}</p>}
                {allAfter && allAfter.state !== "ok" && <p>{allAfter.state === "over" ? `Over your monthly limit by ${formatINR(-allAfter.remaining)}.` : `${Math.round(allAfter.pct * 100)}% of your monthly limit used after this.`}</p>}
              </div>
            </motion.div>
          ) : null}

          {features.cashback && type === "income" && (
            <div className="rounded-2xl border p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium"><Gift className="size-4 text-marigold" /> This is cashback</span>
                <input type="checkbox" checked={cashback} onChange={(e) => setCashback(e.target.checked)} className="size-5 accent-[var(--primary)]" />
              </label>
              {cashback && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {CASHBACK_SOURCES.map((s) => (
                    <button type="button" key={s} onClick={() => setCbSource(s)} aria-pressed={cbSource === s}
                      className={cn("rounded-full border px-3 py-1 text-xs", cbSource === s ? "border-primary bg-accent" : "")}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {features.splits && !tx && type === "expense" && (
            <div className="rounded-2xl border p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium"><Users className="size-4 text-primary" /> Split with people</span>
                <input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} className="size-5 accent-[var(--primary)]" />
              </label>
              <AnimatePresence initial={false}>
                {splitOn && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="mt-3 flex flex-wrap gap-2">
                      {people.map((p) => (
                        <button type="button" key={p.id} aria-pressed={splitWith.includes(p.id)}
                          onClick={() => setSplitWith((w) => (w.includes(p.id) ? w.filter((x) => x !== p.id) : [...w, p.id]))}
                          className={cn("rounded-full border px-3 py-1 text-sm", splitWith.includes(p.id) ? "border-primary bg-accent" : "")}>{p.name}</button>
                      ))}
                      <span className="flex items-center gap-1">
                        <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="New person" className="input-base h-8 w-28 text-sm" />
                        <button type="button" className="rounded-full bg-muted px-2.5 py-1 text-sm" onClick={() => { if (!newPerson.trim()) return; const p = actions.addPerson({ name: newPerson.trim(), group: "friend" }); setSplitWith((w) => [...w, p.id]); setNewPerson(""); }}>Add</button>
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-muted p-1 text-xs">
                      {(["equal", "exact", "percent", "shares"] as SplitMode[]).map((m) => (
                        <button type="button" key={m} onClick={() => setSplitMode(m)} className={cn("rounded-lg py-1.5 capitalize", splitMode === m ? "bg-card font-semibold shadow-soft" : "text-muted-foreground")}>{m === "percent" ? "%" : m}</button>
                      ))}
                    </div>
                    <label className="mt-3 flex items-center justify-between text-sm">
                      <span>Who paid?</span>
                      <select value={payer} onChange={(e) => setPaidBy(e.target.value)} className="input-base h-9 w-36">
                        {participants.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
                      </select>
                    </label>
                    <ul className="mt-3 space-y-2">
                      {participants.map((id, i) => (
                        <li key={id} className="flex items-center justify-between gap-2 text-sm">
                          <span>{nameOf(id)}</span>
                          <span className="flex items-center gap-2">
                            {splitMode !== "equal" && (
                              <input inputMode="decimal" value={splitVals[id] ?? ""} onChange={(e) => setSplitVals((v) => ({ ...v, [id]: e.target.value }))}
                                placeholder={splitMode === "exact" ? "₹" : splitMode === "percent" ? "%" : "shares"} className="input-base h-8 w-20 text-right text-sm" />
                            )}
                            <span className="w-20 text-right font-semibold tnum">{split && !split.error ? formatINR(split.shares[i]?.amount ?? 0, { decimals: true }) : "—"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {split?.error && <p className="mt-2 text-xs text-destructive">{split.error}</p>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <Button type="submit" size="lg" disabled={isSubmitting} className="h-14 w-full rounded-2xl text-base">
            {tx ? "Save changes" : "Add transaction"}
          </Button>
        </form>
      </motion.div>
    </>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-destructive">{error}</span>}
    </label>
  );
}
