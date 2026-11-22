import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Banknote, CreditCard, Landmark, Plus, Smartphone, Trash2, Wallet, Wifi } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { accountActivity } from "@/lib/finance/calc";
import type { Account, Transaction } from "@/lib/finance/types";
import { Amount, Bar, DemoBadge, PageTitle, Panel, Section } from "@/components/app/bits";
import { TxRow } from "@/components/app/tx-row";
import { useTxSheet } from "@/components/app/tx-sheet";
import { BottomSheet, Chips, Field } from "@/components/app/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/accounts")({
  head: () => ({
    meta: [
      { title: "Cards & accounts — ExTrack" },
      { name: "description", content: "Your bank accounts, debit and credit cards, UPI, wallets and cash in one place." },
      { property: "og:title", content: "Cards & accounts — ExTrack" },
      { property: "og:description", content: "Your bank accounts, debit and credit cards, UPI, wallets and cash in one place." },
    ],
  }),
  component: Accounts,
});

const FINISH = { peacock: "bg-peacock", marigold: "bg-marigold-card", ink: "bg-ink-card" } as const;
const KIND_ICON = { bank: Landmark, upi: Smartphone, card: CreditCard, cash: Banknote, wallet: Wallet };
type Kind = "bank" | "debit" | "credit" | "upi" | "wallet" | "cash";

function dueIn(day?: number, now = new Date()) {
  if (!day) return null;
  let d = new Date(now.getFullYear(), now.getMonth(), day);
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
  return Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
}

function Accounts() {
  const accounts = useFinance((s) => s.accounts);
  const txs = useFinance((s) => s.transactions);
  const cats = useFinance((s) => s.categories);
  const { open } = useTxSheet();
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Account | "new" | null>(null);
  const cards = accounts.filter((a) => a.kind === "card");
  const others = accounts.filter((a) => a.kind !== "card");
  const selected = accounts.find((a) => a.id === sel);
  const act = selected ? accountActivity(txs, selected.id) : null;

  return (
    <div className="space-y-6">
      <PageTitle title="Cards & accounts" sub={`${accounts.length} linked`} right={<div className="flex items-center gap-2"><DemoBadge /><Button size="sm" className="rounded-full" onClick={() => setEdit("new")}><Plus className="size-4" />Add</Button></div>} />

      {cards.length > 0 && (
        <Section title="Cards">
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
            {cards.map((c, i) => <CardFace key={c.id} a={c} i={i} active={sel === c.id} onClick={() => setSel(sel === c.id ? null : c.id)} txs={txs} />)}
          </div>
        </Section>
      )}

      <Section title="Accounts & wallets">
        <div className="grid gap-3 sm:grid-cols-2">
          {others.map((a, i) => {
            const Icon = KIND_ICON[a.kind];
            return (
              <motion.button key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                onClick={() => setSel(sel === a.id ? null : a.id)}
                className={cn("flex items-center gap-3 rounded-3xl bg-card p-4 text-left shadow-soft transition-shadow", sel === a.id && "ring-2 ring-primary")}>
                <span className="grid size-11 place-items-center rounded-2xl bg-accent text-primary"><Icon className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="text-xs capitalize text-muted-foreground">{a.kind}{a.last4 ? ` ·· ${a.last4}` : ""}</span>
                </span>
                {a.balance != null && <Amount value={a.balance} />}
              </motion.button>
            );
          })}
        </div>
      </Section>

      {selected && act && (
        <motion.div key={selected.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{selected.name}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="rounded-full" onClick={() => setEdit(selected)}>Edit</Button>
                <Button size="sm" variant="ghost" className="rounded-full text-expense" aria-label="Delete account"
                  onClick={() => { actions.deleteAccount(selected.id); setSel(null); toast.success("Account removed"); }}><Trash2 className="size-4" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Spent this month"><Amount value={act.spent} /></Stat>
              <Stat label="Received"><Amount value={act.received} type="income" /></Stat>
              <Stat label="Transactions"><span className="font-semibold tnum">{act.count}</span></Stat>
            </div>
            {act.recent.length ? <div className="divide-y">{act.recent.map((t) => <TxRow key={t.id} tx={t} category={cats.find((c) => c.id === t.categoryId)} onOpen={() => open(t)} />)}</div> : <p className="text-sm text-muted-foreground">No transactions linked yet.</p>}
          </Panel>
        </motion.div>
      )}

      <AccountSheet value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-2xl bg-muted p-3"><p className="text-[11px] text-muted-foreground">{label}</p>{children}</div>;
}

function CardFace({ a, i, active, onClick, txs }: { a: Account; i: number; active: boolean; onClick: () => void; txs: Transaction[] }) {
  const used = a.cardType === "credit" ? accountActivity(txs, a.id).spent : 0;
  const due = dueIn(a.dueDay);
  return (
    <motion.button onClick={onClick} initial={{ rotateY: -90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1, scale: active ? 1.02 : 1 }}
      transition={{ delay: i * 0.12, type: "spring", stiffness: 120, damping: 16 }} style={{ transformPerspective: 900 }}
      className={cn("relative aspect-[1.586] w-[19rem] shrink-0 snap-center overflow-hidden rounded-3xl p-5 text-left text-primary-foreground shadow-lift", FINISH[a.finish ?? "peacock"], active && "ring-4 ring-primary/40")}>
      <span className="absolute -right-10 -top-10 size-40 rounded-full bg-primary-foreground/10" aria-hidden />
      <span className="absolute -bottom-16 -left-6 size-44 rounded-full bg-primary-foreground/5" aria-hidden />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <div><p className="text-xs uppercase tracking-widest opacity-80">{a.cardType ?? "card"}</p><p className="font-display text-lg font-semibold">{a.name}</p></div>
          <Wifi className="size-5 rotate-90 opacity-80" />
        </div>
        <div className="h-8 w-11 rounded-md bg-gradient-to-br from-primary-foreground/70 to-primary-foreground/30" aria-hidden />
        <div className="flex items-end justify-between">
          <p className="font-mono text-lg tracking-[0.2em] tnum">•••• {a.last4 ?? "0000"}</p>
          {a.cardType === "credit" && due != null && <p className="text-right text-[11px] opacity-90">Due in<br /><b className="text-sm">{due} days</b></p>}
        </div>
        {a.cardType === "credit" && a.limit ? (
          <div className="mt-2 space-y-1 text-[11px]">
            <div className="h-1.5 overflow-hidden rounded-full bg-primary-foreground/25"><motion.div className="h-full rounded-full bg-primary-foreground" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (used / a.limit) * 100)}%` }} transition={{ delay: 0.4 + i * 0.1 }} /></div>
            <p className="opacity-90">Used ₹{Math.round(used).toLocaleString("en-IN")} of ₹{a.limit.toLocaleString("en-IN")} · statement on {a.statementDay}</p>
          </div>
        ) : null}
      </div>
    </motion.button>
  );
}

function AccountSheet({ value, onClose }: { value: Account | "new" | null; onClose: () => void }) {
  const a = value && value !== "new" ? value : undefined;
  const initKind: Kind = a ? (a.kind === "card" ? (a.cardType ?? "debit") : a.kind) : "bank";
  return (
    <BottomSheet open={!!value} onClose={onClose} title={a ? "Edit account" : "Add account"}>
      {value && <AccountForm key={a?.id ?? "new"} a={a} initKind={initKind} onDone={onClose} />}
    </BottomSheet>
  );
}

function AccountForm({ a, initKind, onDone }: { a?: Account; initKind: Kind; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>(initKind);
  const [name, setName] = useState(a?.name ?? "");
  const [last4, setLast4] = useState(a?.last4 ?? "");
  const [balance, setBalance] = useState(a?.balance != null ? String(a.balance) : "");
  const [limit, setLimit] = useState(a?.limit ? String(a.limit) : "");
  const [statementDay, setStatementDay] = useState(String(a?.statementDay ?? 20));
  const [dueDay, setDueDay] = useState(String(a?.dueDay ?? 5));
  const [finish, setFinish] = useState<"peacock" | "marigold" | "ink">(a?.finish ?? "peacock");
  const isCard = kind === "debit" || kind === "credit";
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Give it a name");
    if (last4 && !/^\d{4}$/.test(last4)) return toast.error("Last 4 digits should be 4 numbers");
    const day = (v: string) => Math.min(31, Math.max(1, Number(v) || 1));
    actions.upsertAccount({
      id: a?.id, name: name.trim(), kind: isCard ? "card" : kind, cardType: isCard ? kind : undefined,
      last4: last4 || undefined, balance: kind === "credit" || balance === "" ? undefined : Number(balance),
      limit: kind === "credit" ? Number(limit) || undefined : undefined,
      statementDay: kind === "credit" ? day(statementDay) : undefined, dueDay: kind === "credit" ? day(dueDay) : undefined,
      finish: isCard || kind === "bank" ? finish : undefined,
    });
    toast.success(a ? "Saved" : "Account added");
    onDone();
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <Chips value={kind} onChange={setKind} options={[{ v: "bank", label: "Bank" }, { v: "debit", label: "Debit card" }, { v: "credit", label: "Credit card" }, { v: "upi", label: "UPI" }, { v: "wallet", label: "Wallet" }, { v: "cash", label: "Cash" }]} />
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={kind === "upi" ? "e.g. name@okhdfc" : "e.g. SBI Savings"} className="input-base h-11" /></Field>
      <div className="grid grid-cols-2 gap-3">
        {kind !== "cash" && kind !== "upi" && <Field label="Last 4 digits"><input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" className="input-base h-11" /></Field>}
        {kind !== "credit" && <Field label="Balance (₹)"><input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0" className="input-base h-11" /></Field>}
        {kind === "credit" && <Field label="Credit limit (₹)"><input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" placeholder="100000" className="input-base h-11" /></Field>}
        {kind === "credit" && <Field label="Statement day"><input value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" className="input-base h-11" /></Field>}
        {kind === "credit" && <Field label="Due day"><input value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" className="input-base h-11" /></Field>}
      </div>
      {(isCard || kind === "bank") && (
        <Field label="Card finish">
          <div className="flex gap-3">
            {(["peacock", "marigold", "ink"] as const).map((f) => (
              <button type="button" key={f} onClick={() => setFinish(f)} aria-label={f} aria-pressed={finish === f}
                className={cn("h-12 w-20 rounded-xl shadow-soft transition-transform", FINISH[f], finish === f && "scale-105 ring-2 ring-foreground ring-offset-2 ring-offset-card")} />
            ))}
          </div>
        </Field>
      )}
      <Button type="submit" className="h-12 w-full rounded-2xl">{a ? "Save changes" : "Add account"}</Button>
    </form>
  );
}
