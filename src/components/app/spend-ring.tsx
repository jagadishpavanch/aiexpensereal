import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { Category } from "@/lib/finance/types";
import { formatINR } from "@/lib/finance/format";
import { useFinance } from "@/lib/finance/store";

export function SpendRing({ data, categories, total }: { data: { categoryId: string; amount: number }[]; categories: Category[]; total: number }) {
  const reduce = useReducedMotion();
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const [active, setActive] = useState<string | null>(null);
  const R = 70;
  const C = 2 * Math.PI * R;
  const gap = 0.012 * C;
  let offset = 0;
  const top = data.slice(0, 6);
  const rest = data.slice(6).reduce((s, x) => s + x.amount, 0);
  const segs = rest > 0 ? [...top, { categoryId: "other", amount: rest }] : top;
  const sel = active ? segs.find((s) => s.categoryId === active) : null;
  const selCat = categories.find((c) => c.id === active);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative size-52 shrink-0">
        <svg viewBox="0 0 180 180" className="size-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--color-muted)" strokeWidth="18" />
          {segs.map((s, i) => {
            const len = total > 0 ? (s.amount / total) * C : 0;
            const cat = categories.find((c) => c.id === s.categoryId);
            const dash = Math.max(0, len - gap);
            const el = (
              <motion.circle
                key={s.categoryId}
                cx="90" cy="90" r={R} fill="none"
                stroke={`var(--${cat?.color ?? "chart-6"})`}
                strokeWidth={active === s.categoryId ? 24 : 18}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}
                initial={reduce ? false : { strokeDashoffset: -offset, strokeDasharray: `0 ${C}` }}
                animate={{ strokeDashoffset: -offset, strokeDasharray: `${dash} ${C}`, opacity: active && active !== s.categoryId ? 0.35 : 1 }}
                transition={{ duration: 0.9, delay: 0.25 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                onMouseEnter={() => setActive(s.categoryId)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(active === s.categoryId ? null : s.categoryId)}
                className="cursor-pointer"
                style={{ transition: "stroke-width .2s" }}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <motion.div key={active ?? "all"} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <p className="text-xs text-muted-foreground">{sel ? selCat?.name ?? "Other" : "Spent this month"}</p>
            <p className="font-display text-2xl font-bold tnum">{hidden ? "₹ ••••" : formatINR(sel ? sel.amount : total)}</p>
            {sel && total > 0 && <p className="text-xs text-muted-foreground">{Math.round((sel.amount / total) * 100)}% of spending</p>}
          </motion.div>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-1">
        {segs.map((s, i) => {
          const cat = categories.find((c) => c.id === s.categoryId);
          return (
            <motion.li key={s.categoryId}
              initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.06 }}
              onMouseEnter={() => setActive(s.categoryId)} onMouseLeave={() => setActive(null)}
              className="flex items-center gap-2 text-sm">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--${cat?.color ?? "chart-6"})` }} />
              <span className="truncate text-muted-foreground">{cat?.name ?? "Other"}</span>
              <span className="ml-auto font-medium tnum">{hidden ? "••" : `${total ? Math.round((s.amount / total) * 100) : 0}%`}</span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
