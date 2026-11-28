import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { changeBetween, pointIndexAt, RANGES, spendSeries, type RangeKey, type Series, type SeriesPoint } from "@/lib/finance/series";
import { formatINR } from "@/lib/finance/format";
import { Panel } from "@/components/app/bits";
import { cn } from "@/lib/utils";

type Metric = "spent" | "income";

const RANGE_NAME: Record<RangeKey, string> = {
  "7D": "last 7 days",
  "30D": "last 30 days",
  "3M": "last 3 months",
  "1Y": "last year",
  ALL: "all time",
};

const H = 184;
const PAD = { l: 6, r: 6, t: 14, b: 24 };
const TZ = "Asia/Kolkata";

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...o });
const F_DAY_LONG = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const F_DAY = fmt({ day: "numeric", month: "short" });
const F_MONTH_LONG = fmt({ month: "long", year: "numeric" });
const F_MONTH = fmt({ month: "short", year: "2-digit" });
const F_TIME = fmt({ hour: "numeric", minute: "2-digit", hour12: true });

function pointTitle(p: SeriesPoint, bucket: Series["bucket"]) {
  const d = new Date(p.date);
  if (bucket === "day") return F_DAY_LONG.format(d);
  if (bucket === "month") return F_MONTH_LONG.format(d);
  const end = new Date(p.endDate);
  return `${F_DAY.format(d)} – ${F_DAY.format(end)}`;
}

function tickLabel(p: SeriesPoint, bucket: Series["bucket"]) {
  const d = new Date(p.date);
  return bucket === "month" ? F_MONTH.format(d) : F_DAY.format(d);
}

/** Stock-chart style spending view: pick a range, then drag a finger or mouse across it. */
export function RangeChart({ className }: { className?: string }) {
  const txs = useFinance((s) => s.transactions);
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const reduce = useReducedMotion();
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const [range, setRange] = useState<RangeKey>("30D");
  const [metric, setMetric] = useState<Metric>("spent");
  const [active, setActive] = useState<number | null>(null);
  const now = useMemo(() => new Date(), []);
  const series = useMemo(() => spendSeries(txs, range, now), [txs, range, now]);
  const pts = series.points;

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = pts.map((p) => p[metric]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values) * 1.1;
  const innerW = width - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xAt = (i: number) => PAD.l + (pts.length <= 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const yAt = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * innerH;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");
  const base = yAt(Math.max(0, lo));
  const area = pts.length > 1 ? `${line} L${xAt(pts.length - 1).toFixed(1)} ${base} L${xAt(0).toFixed(1)} ${base} Z` : "";

  const shown = active !== null && active < pts.length ? active : null;
  const cur = shown !== null ? pts[shown] : null;
  const markerIdx = shown ?? pts.length - 1;
  const color = metric === "spent" ? "var(--color-chart-1)" : "var(--color-income)";
  const empty = series.count === 0 && series.income === 0;

  const ticks = useMemo(() => {
    const n = pts.length;
    if (n <= 1) return [0];
    const want = width < 340 ? 3 : 4;
    return Array.from(new Set(Array.from({ length: want }, (_, k) => Math.round((k / (want - 1)) * (n - 1)))));
  }, [pts.length, width]);

  const money = (v: number) => formatINR(v, { hidden });

  const scrubTo = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    setActive(pointIndexAt(pts.length, (clientX - r.left - PAD.l) / Math.max(1, r.width - PAD.l - PAD.r)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const last = pts.length - 1;
    const at = shown ?? last;
    const next = e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  const change = cur ? changeBetween(values[0], values[shown!]) : null;
  const upIsBad = metric === "spent";
  const changeGood = change ? (change.delta === 0 ? null : (change.delta > 0) !== upIsBad) : null;
  const ChangeIcon = change && change.delta < 0 ? TrendingDown : TrendingUp;

  const countOf = (p: SeriesPoint) => (metric === "spent" ? p.count : p.incomeCount);
  const noun = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`;
  const valueText = cur
    ? `${pointTitle(cur, series.bucket)}, ${money(cur[metric])}, ${noun(countOf(cur))}`
    : `${RANGE_NAME[range]}, ${money(metric === "spent" ? series.spent : series.income)}`;

  return (
    <div className={className}>
      <Panel className="h-full">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">{metric === "spent" ? "Spending over time" : "Income over time"}</h2>
          <div className="flex rounded-full bg-muted p-0.5 text-xs" role="group" aria-label="Show">
            {(["spent", "income"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMetric(m); setActive(null); }} aria-pressed={metric === m}
                className={cn("min-h-8 rounded-full px-3 font-medium", metric === m ? "bg-card shadow-soft" : "text-muted-foreground")}>
                {m === "spent" ? "Spent" : "Income"}
              </button>
            ))}
          </div>
        </div>

        {/* Readout: the range total at rest, the touched point while scrubbing. Fixed height so the chart never jumps. */}
        <div className="min-h-[4.25rem]" aria-live="off">
          <p className="font-display text-3xl font-semibold leading-tight tnum">
            {money(cur ? cur[metric] : metric === "spent" ? series.spent : series.income)}
          </p>
          {cur && change ? (
            <>
              <p className="text-sm text-muted-foreground tnum">
                {pointTitle(cur, series.bucket)}
                {series.bucket === "day" && cur.lastAt ? ` · last at ${F_TIME.format(new Date(cur.lastAt)).toLowerCase()}` : ""}
                {` · ${noun(countOf(cur))}`}
              </p>
              {shown !== 0 && (
                <p className={cn("flex items-center gap-1 text-sm font-medium tnum", changeGood === null ? "text-muted-foreground" : changeGood ? "text-income" : "text-expense")}>
                  <ChangeIcon className="size-4" aria-hidden />
                  {hidden ? "since the start" : `${change.delta > 0 ? "+" : change.delta < 0 ? "−" : ""}${formatINR(Math.abs(change.delta))}${change.pct === null ? "" : ` (${change.delta > 0 ? "+" : change.delta < 0 ? "−" : ""}${Math.abs(change.pct).toFixed(1)}%)`} since ${tickLabel(pts[0], series.bucket)}`}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground tnum">
              {RANGE_NAME[range]} · {noun(metric === "spent" ? series.count : pts.reduce((s, p) => s + p.incomeCount, 0))}
              {series.bucket !== "day" ? ` · by ${series.bucket}` : ""}
            </p>
          )}
        </div>

        <div ref={box} className="relative mt-2 select-none">
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="slider"
            tabIndex={0}
            aria-label="Spending over time. Use the arrow keys, or drag across the chart, to inspect a point."
            aria-valuemin={0}
            aria-valuemax={Math.max(0, pts.length - 1)}
            aria-valuenow={markerIdx}
            aria-valuetext={valueText}
            className="block touch-pan-y rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(e) => scrubTo(e.clientX, e.currentTarget)}
            onPointerMove={(e) => scrubTo(e.clientX, e.currentTarget)}
            onPointerUp={(e) => { if (e.pointerType !== "mouse") setActive(null); }}
            onPointerCancel={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            <defs>
              <linearGradient id={`rc${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1={PAD.l} x2={width - PAD.r} y1={PAD.t + f * innerH} y2={PAD.t + f * innerH} stroke="var(--color-border)" strokeDasharray={f === 1 ? undefined : "3 4"} />
            ))}
            {lo < 0 && <line x1={PAD.l} x2={width - PAD.r} y1={yAt(0)} y2={yAt(0)} stroke="var(--color-muted-foreground)" strokeOpacity={0.5} />}
            {area && (
              <motion.path key={`a-${range}-${metric}`} d={area} fill={`url(#rc${gid})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
            )}
            {pts.length > 1 ? (
              <motion.path key={`l-${range}-${metric}`} d={line} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round"
                initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
            ) : null}
            {ticks.map((i, k) => (
              <text key={i} x={xAt(i)} y={H - 6} fontSize={11} fill="var(--color-muted-foreground)" textAnchor={k === 0 && ticks.length > 1 ? "start" : k === ticks.length - 1 && ticks.length > 1 ? "end" : "middle"}>
                {tickLabel(pts[i], series.bucket)}
              </text>
            ))}
            {shown !== null && <line x1={xAt(shown)} x2={xAt(shown)} y1={PAD.t - 6} y2={H - PAD.b} stroke="var(--color-foreground)" strokeOpacity={0.55} strokeWidth={1.25} />}
            {pts.length > 0 && (
              <circle cx={xAt(markerIdx)} cy={yAt(values[markerIdx])} r={shown !== null ? 5 : 3.5} fill={color} stroke="var(--color-card)" strokeWidth={2} />
            )}
          </svg>
          {empty && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">No transactions in this range</p>
          )}
        </div>

        <div className="mt-3 flex rounded-full bg-muted p-0.5 text-sm" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => { setRange(r); setActive(null); }} aria-pressed={range === r}
              className={cn("relative min-h-10 flex-1 rounded-full px-2 font-medium", range === r ? "text-primary-foreground" : "text-muted-foreground")}>
              {range === r && <motion.span layoutId="range-chart-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className="relative">{r === "ALL" ? "All" : r}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {hidden ? "Amounts hidden. " : ""}Drag across the chart to see each {series.bucket}.
        </p>
      </Panel>
    </div>
  );
}
