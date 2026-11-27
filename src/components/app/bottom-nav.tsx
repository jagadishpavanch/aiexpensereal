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

/** Height of the floating pill plus its gap above the screen edge, without the gesture-area inset. */
export const BOTTOM_BAR_REM = 5.25;

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

/** Shows the new tab's name for a moment after switching, since the pill is icons only. */
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

/**
 * Phone-only navigation: a floating frosted pill whose five tabs share its width equally (so it fits any screen),
 * with a dark circle that slides to the active tab, and the add button floating separately at the bottom right.
 */
export function BottomNav({ tabs, isActive, onAdd, addOpen }: { tabs: readonly NavTab[]; isActive: (to: string) => boolean; onAdd: () => void; addOpen: boolean }) {
  const reduce = useReducedMotion();
  const compact = useScrollCompact();
  const activeLabel = tabs.find((t) => isActive(t.to))?.label;
  const hint = useTabHint(activeLabel);

  return (
    <>
      {/* soft fade so content slides under the pill instead of stopping at a hard edge */}
      <div aria-hidden style={{ height: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/70 to-transparent md:hidden" />

      <AnimatePresence>
        {!addOpen && (
          <motion.button
            key="fab"
            type="button"
            onClick={onAdd}
            aria-label="Add transaction"
            initial={reduce ? false : { scale: 0, opacity: 0, rotate: -90 }}
            animate={{ scale: compact ? 0.88 : 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0, rotate: 90 }}
            whileTap={{ scale: 0.86, rotate: 90 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${BOTTOM_BAR_REM + 0.75}rem)` }}
            className="fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-peacock text-primary-foreground shadow-fab outline-none ring-4 ring-background focus-visible:ring-ring md:hidden"
          >
            {/* a few pulses only: an endless one keeps the GPU busy */}
            {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-primary/25 [animation-duration:2.8s] [animation-iteration-count:3]" aria-hidden />}
            <Plus className="relative size-7" strokeWidth={2.5} />
          </motion.button>
        )}
      </AnimatePresence>

      <motion.nav
        aria-label="Main"
        initial={reduce ? false : { y: 96, opacity: 0 }}
        animate={{ y: compact ? 8 : 0, opacity: 1, scale: compact ? 0.95 : 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
        className="fixed inset-x-4 z-40 mx-auto max-w-md md:hidden"
      >
        <div className="grid grid-cols-5 gap-1 rounded-full border border-white/60 bg-card/90 p-1.5 shadow-lift backdrop-blur-lg dark:border-white/10">
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
                className="relative grid h-14 min-w-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {active && <motion.span layoutId="tab-pill" className="absolute inset-y-0 left-1/2 aspect-square h-full -translate-x-1/2 rounded-full bg-foreground shadow-md" transition={SPRING} />}
                <motion.span whileTap={{ scale: 0.82 }} className="relative grid size-full place-items-center">
                  <motion.span
                    key={active ? "on" : "off"}
                    initial={active && !reduce ? { scale: 0.55, rotate: -14 } : false}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 600, damping: 16 }}
                    className={cn("transition-colors duration-200", active ? "text-background" : "text-muted-foreground")}
                  >
                    <n.icon className="size-6" strokeWidth={active ? 2.3 : 1.9} />
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
                        className="whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold text-background shadow-md"
                      >
                        {n.label}
                      </motion.span>
                    </span>
                  )}
                </AnimatePresence>
              </Link>
            );
          })}
        </div>
      </motion.nav>
    </>
  );
}
