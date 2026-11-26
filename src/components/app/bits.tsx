import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Briefcase, Car, Circle, Film, HeartPulse, Home, Laptop, ShoppingBag, ShoppingBasket, Tag, Utensils, Zap,
  type LucideIcon,
} from "lucide-react";
import { formatINR } from "@/lib/finance/format";
import { useFinance } from "@/lib/finance/store";
import type { Category } from "@/lib/finance/types";
import { digitsByKey, rollCells } from "@/lib/motion-cues";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, "shopping-basket": ShoppingBasket, car: Car, home: Home, zap: Zap,
  "shopping-bag": ShoppingBag, film: Film, "heart-pulse": HeartPulse, circle: Circle,
  briefcase: Briefcase, laptop: Laptop, tag: Tag,
};

export function CategoryIcon({ category, size = "md" }: { category?: Category; size?: "sm" | "md" | "lg" }) {
  const Icon = ICONS[category?.icon ?? "tag"] ?? Tag;
  const color = `var(--${category?.color ?? "chart-5"})`;
  const dims = size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10";
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-2xl", dims)}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
      aria-hidden
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2.2} />
    </span>
  );
}

/** Amount that counts up from 0 (or previous value) to target. */
export function Ticker({ value, className, decimals }: { value: number; className?: string; decimals?: boolean }) {
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => formatINR(Math.round(v), { decimals }));
  useEffect(() => {
    if (reduce) { mv.set(value); return; }
    const c = animate(mv, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, mv, reduce]);
  if (hidden) return <span className={cn("tnum", className)}>₹ ••••</span>;
  return <motion.span className={cn("tnum", className)}>{text}</motion.span>;
}

/** Last value each named RollingAmount showed, so a remount rolls on from it. */
const rollMemory = new Map<string, number>();

/**
 * Odometer-style amount: each digit is a vertical strip of 0–9 that rolls to
 * its new place, lower places a beat after higher ones. With an `id`, a fresh
 * mount (say, coming back to Home) rolls from the last value shown under that
 * id rather than from ₹0. Without one, it rolls up from 0 once on mount.
 */
export function RollingAmount({ value, id, className, decimals }: { value: number; id?: string; className?: string; decimals?: boolean }) {
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const reduce = useReducedMotion();
  const text = formatINR(decimals ? value : Math.round(value), { decimals });
  // Where each column starts on mount: the remembered value, or 0 for new columns.
  const [from] = useState(() => digitsByKey(formatINR(rollMemory.get(id ?? "") ?? 0, { decimals })));
  useEffect(() => {
    if (id) rollMemory.set(id, value);
  }, [id, value]);
  if (hidden) return <span className={cn("tnum", className)}>₹ ••••</span>;
  const cells = rollCells(text);
  const digitCount = cells.filter((c) => c.digit !== null).length;
  let seen = 0;
  return (
    <span className={cn("tnum", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex items-start">
        {cells.map((c) => {
          if (c.digit === null) return <span key={c.key}>{c.char}</span>;
          const order = digitCount - 1 - seen++; // 0 = rightmost
          return (
            <span key={c.key} className="relative inline-block overflow-hidden">
              <span className="invisible">0</span>
              <motion.span
                className="absolute inset-x-0 top-0 flex flex-col text-center"
                initial={reduce ? false : { y: `${-(from.get(c.key) ?? 0) * 10}%` }}
                animate={{ y: `${-c.digit * 10}%` }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 24, delay: order * 0.035 }}
              >
                {DIGITS.map((d) => <span key={d}>{d}</span>)}
              </motion.span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function Amount({ value, type, className }: { value: number; type?: string; className?: string }) {
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const sign = type === "income" || type === "refund" ? "+" : type === "expense" ? "−" : "";
  return (
    <span className={cn("tnum font-semibold", type === "income" || type === "refund" ? "text-income" : "text-foreground", className)}>
      {hidden ? "₹ ••••" : `${sign}${formatINR(value)}`}
    </span>
  );
}

export function Section({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || action) && (
        <div className="flex items-baseline justify-between px-1">
          {title && <h2 className="font-display text-lg font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-3xl bg-card p-5 shadow-soft", className)}>{children}</div>;
}

export function Press({ children, className, ...rest }: React.ComponentProps<typeof motion.button>) {
  return (
    <motion.button whileTap={{ scale: 0.95 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className={className} {...rest}>
      {children}
    </motion.button>
  );
}

export function Bar({ pct, state }: { pct: number; state?: "ok" | "near" | "over" }) {
  const color = state === "over" ? "bg-expense" : state === "near" ? "bg-marigold" : "bg-primary";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, pct * 100)}%` }}
        transition={{ type: "spring", stiffness: 60, damping: 14, delay: 0.15 }}
      />
    </div>
  );
}

export function DemoBadge() {
  const demo = useFinance((s) => s.prefs.demoMode);
  if (!demo) return null;
  return (
    <span className="rounded-full bg-marigold-soft px-2.5 py-1 text-xs font-medium text-foreground">Sample data</span>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-2 pt-2">
      <div>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

export function ChartTip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-soft">
      {label && <p className="mb-1 text-muted-foreground">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 font-semibold tnum">
          {p.color && <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />}
          <span className="font-normal capitalize text-muted-foreground">{p.name}</span> {formatINR(p.value)}
        </p>
      ))}
    </div>
  );
}
