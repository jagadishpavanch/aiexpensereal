import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Share2, Trash2, UserPlus } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { balances, splitSummary } from "@/lib/finance/splits";
import { formatINR } from "@/lib/finance/format";
import type { PersonGroup } from "@/lib/finance/types";
import { Amount, DemoBadge, Empty, PageTitle, Panel, Section, Ticker } from "@/components/app/bits";
import { BottomSheet, Chips, Field } from "@/components/app/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/splits")({
  head: () => ({
    meta: [
      { title: "Splits — ExTrack" },
      { name: "description", content: "Who owes you and whom you owe. Settle up and share a reminder on WhatsApp." },
      { property: "og:title", content: "Splits — ExTrack" },
      { property: "og:description", content: "Who owes you and whom you owe. Settle up and share a reminder on WhatsApp." },
    ],
  }),
  component: Splits,
});

const GROUPS: { v: PersonGroup; label: string }[] = [
  { v: "friend", label: "Friend" }, { v: "partner", label: "Partner" }, { v: "family", label: "Family" }, { v: "roommate", label: "Roommate" }, { v: "other", label: "Other" },
];
const TONES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

export function Avatar({ name, i, className }: { name: string; i: number; className?: string }) {
  return <span className={cn("grid size-10 place-items-center rounded-full font-semibold text-primary-foreground ring-2 ring-card", TONES[i % TONES.length], className)}>{name.slice(0, 1).toUpperCase()}</span>;
}

function Splits() {
  const people = useFinance((s) => s.people);
  const splits = useFinance((s) => s.splits);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<PersonGroup | "all">("all");
  const bal = useMemo(() => balances(splits), [splits]);
  const sum = useMemo(() => splitSummary(splits), [splits]);
  const nameOf = (id: string) => (id === "me" ? "You" : people.find((p) => p.id === id)?.name ?? "Someone");
  const shown = people.filter((p) => filter === "all" || p.group === filter);

  const share = (name: string, v: number) => {
    const text = v > 0 ? `Hi ${name}, just a reminder: you owe me ${formatINR(v)} from our shared expenses. Sent from ExTrack.` : `Hi ${name}, I owe you ${formatINR(-v)}. Settling up soon! Sent from ExTrack.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Splits" sub="Shared spending with people" right={<div className="flex items-center gap-2"><DemoBadge /><Button size="sm" className="rounded-full" onClick={() => setAdding(true)}><UserPlus className="size-4" />Person</Button></div>} />

      <div className="grid grid-cols-2 gap-3">
        <Panel className="bg-peacock text-primary-foreground"><p className="text-xs opacity-80">Owed to you</p><Ticker value={sum.owedToMe} className="font-display text-2xl font-bold" /></Panel>
        <Panel><p className="text-xs text-muted-foreground">You owe</p><Ticker value={sum.iOwe} className="font-display text-2xl font-bold text-expense" /></Panel>
      </div>

      <Section title="People">
        <Chips value={filter} onChange={setFilter} options={[{ v: "all", label: "All" }, ...GROUPS]} />
        {shown.length === 0 ? <Empty text="No people here yet. Add friends, family or roommates to split with." /> : (
          <div className="space-y-2">
            {shown.map((p, i) => {
              const v = bal.get(p.id) ?? 0;
              return (
                <motion.div key={p.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 rounded-3xl bg-card p-3 shadow-soft">
                  <Avatar name={p.name} i={people.indexOf(p)} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className={cn("text-xs", v > 0 ? "text-income" : v < 0 ? "text-expense" : "text-muted-foreground")}>{v > 0 ? `Owes you ${formatINR(v)}` : v < 0 ? `You owe ${formatINR(-v)}` : "All settled"} · <span className="capitalize">{p.group}</span></p>
                  </div>
                  {v !== 0 ? (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="size-9 rounded-full" aria-label={`Share with ${p.name}`} onClick={() => share(p.name, v)}><Share2 className="size-4" /></Button>
                      <Button size="sm" variant="secondary" className="rounded-full" onClick={() => { actions.settlePerson(p.id); toast.success(`Settled with ${p.name}`); }}><Check className="size-4" />Settle</Button>
                    </div>
                  ) : (
                    <Button size="icon" variant="ghost" className="size-9 rounded-full text-muted-foreground" aria-label={`Remove ${p.name}`} onClick={() => actions.deletePerson(p.id)}><Trash2 className="size-4" /></Button>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Recent splits">
        {splits.length === 0 ? <Empty text="Turn on Split when adding an expense to share it." /> : (
          <div className="space-y-2">
            {splits.map((sp) => (
              <Panel key={sp.id} className="flex items-center gap-3 p-4">
                <div className="flex -space-x-3">
                  {sp.shares.slice(0, 4).map((sh, j) => (
                    <motion.span key={sh.personId} initial={{ x: -10 * j, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: j * 0.06, type: "spring" }}>
                      <Avatar name={nameOf(sh.personId)} i={sh.personId === "me" ? 0 : people.findIndex((p) => p.id === sh.personId) + 1} className={cn("size-8 text-xs", sp.settled.includes(sh.personId) && "opacity-40")} />
                    </motion.span>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{sp.title}</p>
                  <p className="text-xs text-muted-foreground">{nameOf(sp.paidBy)} paid · {sp.mode} · {new Date(sp.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                </div>
                <Amount value={sp.total} />
                <button onClick={() => actions.deleteSplit(sp.id)} aria-label="Delete split" className="text-muted-foreground"><Trash2 className="size-4" /></button>
              </Panel>
            ))}
          </div>
        )}
      </Section>

      <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add a person">
        {adding && <PersonForm onDone={() => setAdding(false)} />}
      </BottomSheet>
    </div>
  );
}

function PersonForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState<PersonGroup>("friend");
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return toast.error("Enter a name"); actions.addPerson({ name: name.trim(), group }); toast.success(`${name.trim()} added`); onDone(); }}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="e.g. Kabir" className="input-base h-11" autoFocus /></Field>
      <Field label="Group"><Chips value={group} onChange={setGroup} options={GROUPS} /></Field>
      <Button type="submit" className="h-12 w-full rounded-2xl">Add person</Button>
    </form>
  );
}
