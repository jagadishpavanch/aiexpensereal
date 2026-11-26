import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Plus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavTab {
  to: string;
  label: string;
  icon: LucideIcon;
}

const SPRING = { type: "spring", stiffness: 500, damping: 34 } as const;

/** Shrinks a little while the page scrolls down, comes back on the way up. */
function useScrollCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) > 6) {
        setCompact(y > last && y > 80);
        last = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return compact;
}

/** Shows the new tab's name for a moment after switching, since the bar is icons only. */
function useTabHint(label: string | undefined) {
  const [hint, setHint] = useState<string | null>(null);
  const prev = useRef(label);
  useEffect(() => {
    if (prev.current === label) return;
    prev.current = label;
    if (!label) return;
    setHint(label);
    const t = setTimeout(() => setHint(null), 1100);
    return () => clearTimeout(t);
  }, [label]);
  return hint;
}

/** Phone-only bottom bar: a frosted pill of icons with a sliding active circle and the add button at the end. */
export function FloatingNav({ tabs, isActive, onAdd, addOpen }: { tabs: readonly NavTab[]; isActive: (to: string) => boolean; onAdd: () => void; addOpen: boolean }) {
  const reduce = useReducedMotion();
  const compact = useScrollCompact();
  const activeLabel = tabs.find((t) => isActive(t.to))?.label;
  const hint = useTabHint(activeLabel);

  return (
    <>
      {/* soft fade so content slides under the bar instead of stopping at a hard edge */}
      <div aria-hidden style={{ height: "calc(env(safe-area-inset-bottom, 0px) + 7rem)" }} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/75 to-transparent md:hidden" />

      <motion.nav
        aria-label="Main"
        initial={reduce ? false : { y: 96, opacity: 0 }}
        animate={{ y: compact ? 6 : 0, opacity: 1, scale: compact ? 0.94 : 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.85rem)" }}
        className="pointer-events-none fixed inset-x-0 z-40 flex justify-center md:hidden"
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/50 bg-card/85 p-1.5 shadow-lift backdrop-blur-lg backdrop-saturate-150 dark:border-white/10">
          {tabs.map((n) => {
            const active = isActive(n.to);
            return (
              <Link
                key={n.to}
                to={n.to as "/home"}
                aria-label={n.label}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) navigator.vibrate?.(6);
                }}
                className="relative grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-foreground shadow-md" transition={SPRING} />}
                <motion.span whileTap={{ scale: 0.82 }} className="relative grid size-full place-items-center">
                  <motion.span
                    key={active ? "on" : "off"}
                    initial={active && !reduce ? { scale: 0.55, rotate: -14 } : false}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 600, damping: 16 }}
                    className={cn("transition-colors duration-200", active ? "text-background" : "text-muted-foreground")}
                  >
                    <n.icon className="size-[1.3rem]" strokeWidth={active ? 2.3 : 1.9} />
                  </motion.span>
                </motion.span>

                <AnimatePresence>
                  {active && hint === n.label && (
                    <span className="pointer-events-none absolute inset-x-0 -top-10 flex justify-center">
                      <motion.span
                        initial={{ opacity: 0, y: 6, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.95 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background shadow-md"
                      >
                        {n.label}
                      </motion.span>
                    </span>
                  )}
                </AnimatePresence>
              </Link>
            );
          })}

          <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />

          <motion.button
            type="button"
            onClick={onAdd}
            aria-label="Add transaction"
            whileTap={{ scale: 0.86 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            className="relative grid size-11 place-items-center rounded-full bg-peacock text-primary-foreground shadow-fab outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* a few pulses only: an endless one under the blurred pill repaints it every frame */}
            {!reduce && !addOpen && <span className="absolute inset-0 animate-ping rounded-full bg-primary/25 [animation-duration:2.8s] [animation-iteration-count:3]" aria-hidden />}
            <Plus className="relative size-5" strokeWidth={2.6} />
          </motion.button>
        </div>
      </motion.nav>
    </>
  );
}
