import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, LayoutGrid, Loader2, MessageSquareText, Monitor, Moon, Plus, Smartphone, Sun, Trash2, Upload } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { parseCSV, toCSV } from "@/lib/finance/csv";
import { isDuplicate } from "@/lib/finance/calc";
import { DEMO_SMS } from "@/lib/finance/demo";
import type { Prefs } from "@/lib/finance/types";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PageTitle, Panel } from "@/components/app/bits";
import { cn } from "@/lib/utils";
import { deleteEverything, signOutAndForget, syncNow, useAppSession, useSyncInfo } from "@/lib/sync/runtime";
import { syncLabel, syncSub } from "@/lib/sync/labels";

export const Route = createFileRoute("/_shell/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ExTrack" },
      { name: "description", content: "Theme, categories, merchant rules, CSV import and export, SMS setup and privacy." },
      { property: "og:title", content: "Settings — ExTrack" },
      { property: "og:description", content: "Theme, categories, merchant rules, CSV import and export, SMS setup and privacy." },
    ],
  }),
  component: Settings,
});

const ACCENTS: { v: Prefs["accent"]; label: string; swatch: string }[] = [
  { v: "peacock", label: "Peacock", swatch: "oklch(0.53 0.095 205)" },
  { v: "marigold", label: "Marigold", swatch: "oklch(0.7 0.15 65)" },
  { v: "indigo", label: "Indigo", swatch: "oklch(0.5 0.15 265)" },
  { v: "rose", label: "Rose", swatch: "oklch(0.58 0.17 10)" },
];

function Settings() {
  const prefs = useFinance((s) => s.prefs);
  const cats = useFinance((s) => s.categories);
  const rules = useFinance((s) => s.rules);
  const txs = useFinance((s) => s.transactions);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newCat, setNewCat] = useState("");
  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleCat, setRuleCat] = useState("food");
  const session = useAppSession();
  const sync = useSyncInfo();
  const user = session.auth === "signedIn" ? session.user : null;
  const syncReady = session.auth === "signedIn" && session.sync === "ready";
  const [busy, setBusy] = useState<null | "signout" | "sync" | "delete">(null);
  const busyRef = useRef(false);
  const anyBusy = busy !== null;

  // Only one of sign out, sync now and delete runs at a time, even on a fast double tap.
  const exclusive = async (kind: "signout" | "sync" | "delete", fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  // Raw sync errors are for the console, not the screen.
  useEffect(() => {
    if (sync.lastError) console.warn("[sync]", sync.lastError);
  }, [sync.lastError]);

  const onSignOut = () => {
    const n = sync.pending;
    if (n && !confirm(`${n} change${n === 1 ? " hasn't" : "s haven't"} been uploaded yet. If you sign out now, ${n === 1 ? "it" : "they"} will be lost. Sign out anyway?`)) return;
    void exclusive("signout", async () => {
      await signOutAndForget();
      navigate({ to: "/" });
    });
  };

  const onSyncNow = () => void exclusive("sync", () => syncNow());

  const onDeleteAll = () => {
    if (busyRef.current) return;
    if (!confirm("Delete everything you've saved in ExTrack, on this phone and in your account? This can't be undone.")) return;
    void exclusive("delete", async () => {
      try {
        await deleteEverything();
        navigate({ to: "/" });
      } catch (err) {
        console.warn("[sync]", err);
        toast.error("Couldn't reach your account. Connect to the internet and try again.");
      }
    });
  };

  const exportCSV = () => {
    const blob = new Blob([toCSV(txs)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `extrack-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${txs.length} transactions`);
  };

  const importCSV = async (f: File) => {
    const { rows, errors } = parseCSV(await f.text());
    const fresh = rows.filter((r) => !isDuplicate(r, txs));
    actions.importTxs(fresh.map((r) => ({
      type: r.type, amount: r.amount, merchant: r.merchant, date: r.date,
      categoryId: cats.some((c) => c.id === r.category) ? r.category : actions.categorize(r.merchant, { type: r.type }).categoryId,
      accountId: "hdfc", source: "csv", isDemo: false,
    })));
    toast.success(`Imported ${fresh.length} transactions`, { description: `${rows.length - fresh.length} duplicates skipped · ${errors.length} rows had problems` });
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Settings" />

      <Group title="Account">
        <Row label={(user?.user_metadata?.["full_name"] as string | undefined) || "Signed in"} sub={user?.email}>
          <Button size="sm" variant="secondary" className="shrink-0 rounded-xl" disabled={anyBusy} onClick={onSignOut}>
            {busy === "signout" && <Loader2 className="size-4 animate-spin" />}{busy === "signout" ? "Signing out…" : "Sign out"}
          </Button>
        </Row>
        <Row label={syncLabel(sync)} sub={syncSub(sync)} live>
          <Button size="sm" variant="secondary" className="shrink-0 rounded-xl" disabled={!syncReady || anyBusy || sync.status === "syncing"} onClick={onSyncNow}>
            {busy === "sync" && <Loader2 className="size-4 animate-spin" />}Sync now
          </Button>
        </Row>
      </Group>

      <Group title="Profile">
        <Row label="Name"><input defaultValue={prefs.name} onBlur={(e) => actions.setPrefs({ name: e.target.value })} className="input-base h-10 w-44" /></Row>
        <Row label="Time zone"><select value={prefs.timeZone} onChange={(e) => actions.setPrefs({ timeZone: e.target.value })} className="input-base h-10 w-44">{["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"].map((z) => <option key={z}>{z}</option>)}</select></Row>
        <Row label="Currency"><span className="text-sm text-muted-foreground">Indian Rupee (₹)</span></Row>
      </Group>

      <Group title="Appearance">
        <div className="grid grid-cols-3 gap-2 p-1">
          {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([v, Icon, l]) => (
            <button key={v} onClick={() => actions.setPrefs({ theme: v })} aria-pressed={prefs.theme === v}
              className={cn("flex flex-col items-center gap-1.5 rounded-2xl border py-3 text-sm font-medium", prefs.theme === v ? "border-primary bg-accent" : "")}>
              <Icon className="size-5" />{l}
            </button>
          ))}
        </div>
        <Row label="Accent colour">
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <button key={a.v} onClick={() => actions.setPrefs({ accent: a.v })} aria-label={a.label} aria-pressed={prefs.accent === a.v}
                className={cn("size-8 rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110", prefs.accent === a.v && "ring-2 ring-foreground")} style={{ backgroundColor: a.swatch }} />
            ))}
          </div>
        </Row>
        <Link to="/customize" className="flex items-center justify-between rounded-2xl px-3 py-3 text-sm font-medium hover:bg-muted"><span className="flex items-center gap-2"><LayoutGrid className="size-4" />Customize home screen</span><span className="text-muted-foreground">›</span></Link>
      </Group>

      <Group title="Privacy">
        <Row label="Hide amounts" sub="Mask every rupee value"><Switch checked={prefs.hideAmounts} onCheckedChange={(v) => actions.setPrefs({ hideAmounts: v })} /></Row>
        <Row label="Show AI tab" sub="Optional assistant"><Switch checked={prefs.aiEnabled} onCheckedChange={(v) => actions.setPrefs({ aiEnabled: v })} /></Row>
      </Group>

      <Group title="Notifications">
        <Row label="Budget alerts" sub="At 80% and 100%"><Switch checked={prefs.notifications.budgetAlerts} onCheckedChange={(v) => actions.setPrefs({ notifications: { ...prefs.notifications, budgetAlerts: v } })} /></Row>
        <Row label="Weekly summary"><Switch checked={prefs.notifications.weeklySummary} onCheckedChange={(v) => actions.setPrefs({ notifications: { ...prefs.notifications, weeklySummary: v } })} /></Row>
        <Row label="Bill reminders"><Switch checked={prefs.notifications.bills} onCheckedChange={(v) => actions.setPrefs({ notifications: { ...prefs.notifications, bills: v } })} /></Row>
      </Group>

      <Group title="Categories">
        <div className="flex flex-wrap gap-2 p-1">
          {cats.map((c) => <span key={c.id} className="rounded-full bg-muted px-3 py-1.5 text-sm">{c.name}</span>)}
        </div>
        <form className="flex gap-2 p-1" onSubmit={(e) => { e.preventDefault(); if (!newCat.trim()) return; actions.addCategory(newCat.trim(), "expense"); setNewCat(""); toast.success("Category added"); }}>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" className="input-base h-10" />
          <Button type="submit" size="icon" className="size-10 shrink-0 rounded-xl" aria-label="Add category"><Plus className="size-4" /></Button>
        </form>
      </Group>

      <Group title="Merchant rules" sub="Auto-pick a category when the merchant name contains a word">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
            <span>“{r.match}” → <b>{cats.find((c) => c.id === r.categoryId)?.name}</b></span>
            <button onClick={() => actions.deleteRule(r.id)} aria-label="Delete rule" className="text-muted-foreground"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <form className="flex gap-2 p-1" onSubmit={(e) => { e.preventDefault(); if (!ruleMatch.trim()) return; actions.addRule({ match: ruleMatch.trim(), categoryId: ruleCat }); setRuleMatch(""); toast.success("Rule added"); }}>
          <input value={ruleMatch} onChange={(e) => setRuleMatch(e.target.value)} placeholder="e.g. zepto" className="input-base h-10" />
          <select value={ruleCat} onChange={(e) => setRuleCat(e.target.value)} className="input-base h-10 w-36">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Button type="submit" size="icon" className="size-10 shrink-0 rounded-xl" aria-label="Add rule"><Plus className="size-4" /></Button>
        </form>
      </Group>

      <Group title="Import & export">
        <div className="grid grid-cols-2 gap-2 p-1">
          <Button variant="secondary" className="h-12 rounded-2xl" onClick={() => fileRef.current?.click()}><Upload className="size-4" />Import CSV</Button>
          <Button variant="secondary" className="h-12 rounded-2xl" onClick={exportCSV}><Download className="size-4" />Export CSV</Button>
        </div>
        <p className="px-2 pb-1 text-xs text-muted-foreground">Columns: date, amount, merchant, type, category. Duplicates are skipped.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = ""; }} />
      </Group>

      <Group title="Bank SMS tracking">
        <div className="flex gap-3 p-2">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><Smartphone className="size-5" /></span>
          <div className="text-sm">
            <p className="font-semibold">Needs the ExTrack Android app</p>
            <p className="mt-1 text-muted-foreground">A website can't read text messages. The upcoming Android app will read only bank and UPI alerts, on your phone, after you allow it. Until then, add transactions by hand or import a CSV.</p>
          </div>
        </div>
        <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">Sample messages we'd recognise:</p>
        <ul className="space-y-2 p-1">
          {DEMO_SMS.map((s) => (
            <li key={s} className="flex gap-2 rounded-2xl bg-muted/70 p-3 text-xs"><MessageSquareText className="size-4 shrink-0 text-muted-foreground" />{s}</li>
          ))}
        </ul>
      </Group>

      <Group title="Your data">
        <Row label={prefs.demoMode ? "Using sample data" : "Using your own data"} sub={prefs.demoMode ? "Sample transactions are clearly labelled" : `${txs.length} transactions on this device`}>
          {prefs.demoMode
            ? <Button size="sm" className="rounded-xl" onClick={() => { actions.startFresh(); toast.success("Sample data cleared"); }}>Start fresh</Button>
            : <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => { actions.loadDemo(); toast("Sample data loaded"); }}>Load samples</Button>}
        </Row>
        <button onClick={onDeleteAll} disabled={!syncReady || anyBusy}
          className="flex w-full items-center gap-2 rounded-2xl px-3 py-3 text-left text-sm font-medium text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50">
          {busy === "delete" && <Loader2 className="size-4 animate-spin" />}{busy === "delete" ? "Deleting…" : "Delete all my data (phone and account)"}
        </button>
      </Group>
    </div>
  );
}

function Group({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-2 pb-1 font-display text-lg font-semibold">{title}</h2>
      {sub && <p className="px-2 pb-2 text-sm text-muted-foreground">{sub}</p>}
      <Panel className="space-y-1 p-2">{children}</Panel>
    </section>
  );
}

function Row({ label, sub, live, children }: { label: string; sub?: string; live?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
      <div className="min-w-0" {...(live ? { role: "status" } : {})}>
        <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{label}</p>
        {sub && <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
