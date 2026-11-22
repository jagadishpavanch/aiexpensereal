import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Check, KeyRound, Mic, Sparkles, X } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { byCategory, inMonth, totals } from "@/lib/finance/calc";
import { formatINR } from "@/lib/finance/format";
import { CategoryIcon } from "@/components/app/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/ai")({
  head: () => ({
    meta: [
      { title: "AI assistant — ExTrack" },
      { name: "description", content: "Ask about your spending or add transactions in plain words." },
      { property: "og:title", content: "AI assistant — ExTrack" },
      { property: "og:description", content: "Ask about your spending or add transactions in plain words." },
    ],
  }),
  component: AiPage,
});

type Draft = { amount: number; merchant: string; categoryId: string };
type Msg = { id: number; role: "user" | "ai"; text: string; draft?: Draft; status?: "pending" | "saved" | "cancelled" };

const SUGGESTIONS = ["How much did I spend on food this month?", "Add ₹250 for lunch at Chai Point", "What's my biggest category?", "Am I on track with budgets?"];

/** Offline preview answers from local data. Replaced by OpenAI when connected. */
function previewReply(q: string, ctx: ReturnType<typeof useCtx>): Omit<Msg, "id" | "role"> {
  const s = q.toLowerCase();
  const add = s.match(/add\s*(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(?:for|on)?\s*(.*)/i);
  if (add) {
    const amount = Number(add[1].replace(/,/g, ""));
    const rest = add[2].trim();
    const merchant = rest.replace(/^(lunch|dinner|breakfast)\s*(at)?\s*/i, "").trim() || rest || "Expense";
    const categoryId = actions.categorize(merchant) ?? (/lunch|dinner|food|chai|coffee/i.test(rest) ? "food" : /uber|ola|metro|auto/i.test(rest) ? "transport" : "other");
    return { text: "Here's what I understood. Check it before saving:", draft: { amount, merchant: merchant[0].toUpperCase() + merchant.slice(1), categoryId }, status: "pending" };
  }
  const cat = ctx.cats.find((c) => s.includes(c.name.split(" ")[0].toLowerCase()) || s.includes(c.id));
  if (cat) {
    const v = ctx.byCat.find((x) => x.categoryId === cat.id)?.amount ?? 0;
    return { text: `You've spent ${formatINR(v)} on ${cat.name.toLowerCase()} this month. That's ${ctx.t.spent ? Math.round((v / ctx.t.spent) * 100) : 0}% of your total spending.` };
  }
  if (/biggest|most|top/.test(s) && ctx.byCat[0]) {
    const c = ctx.cats.find((x) => x.id === ctx.byCat[0].categoryId);
    return { text: `${c?.name} is your biggest category this month at ${formatINR(ctx.byCat[0].amount)}.` };
  }
  if (/budget|track/.test(s)) return { text: `So far this month you've spent ${formatINR(ctx.t.spent)} and received ${formatINR(ctx.t.income)}. Open Budgets to see each category's progress.` };
  return { text: `This month: ${formatINR(ctx.t.spent)} spent, ${formatINR(ctx.t.income)} received. Once OpenAI is connected I can answer more open questions.` };
}

function useCtx() {
  const txs = useFinance((s) => s.transactions);
  const cats = useFinance((s) => s.categories);
  const month = txs.filter((t) => inMonth(t.date, new Date()));
  return { cats, t: totals(month), byCat: byCategory(month) };
}

function AiPage() {
  const ctx = useCtx();
  const cats = useFinance((s) => s.categories);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, thinking]);

  const send = (text: string) => {
    if (!text.trim() || thinking) return;
    const id = Date.now();
    setMsgs((m) => [...m, { id, role: "user", text }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      setMsgs((m) => [...m, { id: id + 1, role: "ai", ...previewReply(text, ctx) }]);
      setThinking(false);
    }, 700);
  };

  const confirm = (m: Msg) => {
    if (!m.draft) return;
    actions.addTx({ type: "expense", amount: m.draft.amount, merchant: m.draft.merchant, categoryId: m.draft.categoryId, accountId: "upi", date: new Date().toISOString(), source: "ai", isDemo: false });
    setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, status: "saved" } : x)));
    toast.success("Expense added");
  };

  const voice = () => {
    type SR = { lang: string; interimResults: boolean; start: () => void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void };
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return toast.error("Voice input isn't supported in this browser. Try Chrome on Android.");
    const r = new Ctor();
    r.lang = "en-IN";
    r.interimResults = false;
    r.onresult = (e) => setInput(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); toast.error("Couldn't hear that. Check microphone permission and try again."); };
    setListening(true);
    r.start();
  };

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <div className="mb-3 flex items-center gap-3 rounded-2xl border border-dashed bg-marigold-soft/50 p-3 text-sm">
        <KeyRound className="size-5 shrink-0 text-marigold" />
        <p className="flex-1">Preview mode: answers come from your data on this device. Connect your OpenAI key for full conversations.</p>
        <Link to="/settings" className="shrink-0 font-medium text-primary">Settings</Link>
      </div>

      {msgs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <motion.div animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity }}
            className="grid size-20 place-items-center rounded-[1.75rem] bg-peacock text-primary-foreground shadow-lift"><Sparkles className="size-9" /></motion.div>
          <h1 className="mt-6 font-display text-3xl font-bold">Ask about your money</h1>
          <p className="mt-2 max-w-sm text-muted-foreground">Questions or quick entries, in plain words. Nothing is saved until you confirm it.</p>
          <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s, i) => (
              <motion.button key={s} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }} whileTap={{ scale: 0.95 }}
                onClick={() => send(s)} className="rounded-full border bg-card px-4 py-2 text-sm shadow-soft hover:border-primary">{s}</motion.button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-3 py-2" aria-live="polite">
          <AnimatePresence initial={false}>
            {msgs.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-3xl px-4 py-3", m.role === "user" ? "rounded-br-lg bg-primary text-primary-foreground" : "rounded-bl-lg bg-card shadow-soft")}>
                  <p>{m.text}</p>
                  {m.draft && (
                    <div className="mt-3 rounded-2xl border bg-surface p-3">
                      <div className="flex items-center gap-3">
                        <CategoryIcon category={cats.find((c) => c.id === m.draft!.categoryId)} size="sm" />
                        <div className="flex-1"><p className="font-medium">{m.draft.merchant}</p><p className="text-xs text-muted-foreground">{cats.find((c) => c.id === m.draft!.categoryId)?.name} · Today · UPI</p></div>
                        <p className="font-display text-lg font-bold tnum">{formatINR(m.draft.amount)}</p>
                      </div>
                      {m.status === "pending" ? (
                        <div className="mt-3 flex gap-2">
                          <button onClick={() => confirm(m)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary py-2 text-sm font-medium text-primary-foreground"><Check className="size-4" />Save</button>
                          <button onClick={() => setMsgs((a) => a.map((x) => (x.id === m.id ? { ...x, status: "cancelled" } : x)))} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-muted py-2 text-sm font-medium"><X className="size-4" />Discard</button>
                        </div>
                      ) : (
                        <p className={cn("mt-2 text-sm font-medium", m.status === "saved" ? "text-income" : "text-muted-foreground")}>{m.status === "saved" ? "✓ Saved to Activity" : "Discarded"}</p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {thinking && (
            <div className="flex gap-1.5 rounded-3xl bg-card px-4 py-4 shadow-soft w-fit" aria-label="Thinking">
              {[0, 1, 2].map((i) => <motion.span key={i} className="size-2 rounded-full bg-primary" animate={{ y: [0, -5, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12 }} />)}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-24 mt-3 flex items-center gap-2 rounded-[1.75rem] border bg-card p-2 shadow-lift md:bottom-4">
        <button type="button" onClick={voice} aria-label={listening ? "Listening" : "Speak"} className={cn("relative grid size-11 shrink-0 place-items-center rounded-full", listening ? "bg-expense text-primary-foreground" : "bg-muted")}>
          {listening && <motion.span className="absolute inset-0 rounded-full bg-expense" animate={{ scale: [1, 1.6], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
          <Mic className="relative size-5" />
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Listening…" : "Ask or add, e.g. “Add ₹120 for auto”"} className="min-w-0 flex-1 bg-transparent px-1 outline-none" aria-label="Message" />
        <motion.button whileTap={{ scale: 0.9 }} type="submit" disabled={!input.trim()} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp className="size-5" /></motion.button>
      </form>
    </div>
  );
}
