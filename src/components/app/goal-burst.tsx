import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { burstParticles } from "@/lib/motion-cues";
import { cn } from "@/lib/utils";

/** Marigold leads (goals colour), with peacock and income green as accents. */
const TONES = ["var(--color-marigold)", "var(--color-marigold)", "var(--color-primary)", "var(--color-income)"];
const PARTICLES = burstParticles(28, TONES.length);
/** The particle that starts last also lands last; it ends the burst. */
const LAST = PARTICLES.reduce((m, p, i) => (p.delay > PARTICLES[m].delay ? i : m), 0);

/**
 * Confetti that erupts from the tapped button when a goal is reached.
 * Plain DOM particles moved with transform and opacity only; the burst
 * removes itself when the last one lands. Portalled to <body> because the
 * shell's page wrapper keeps a `filter`, which would make it the containing
 * block for `position: fixed` and push the burst off by the scroll offset. Callers skip it under reduced
 * motion and rely on the static "Reached" check instead.
 */
export function GoalBurst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed z-[60]" style={{ left: x, top: y }}>
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          className={cn(
            "absolute block",
            p.shape === "strip" && "-ml-[3px] -mt-1.5 h-3 w-1.5 rounded-[2px]",
            p.shape === "dot" && "-ml-1 -mt-1 size-2 rounded-full",
            p.shape === "diamond" && "-ml-1 -mt-1 size-2 rotate-45 rounded-[1px]",
          )}
          style={{ backgroundColor: TONES[p.tone] }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.dx, y: [0, p.peak, p.peak + p.fall], rotate: p.rotate, opacity: [1, 1, 0], scale: 1 }}
          transition={{
            duration: 1.25,
            delay: p.delay,
            x: { duration: 1.25, delay: p.delay, ease: [0.16, 1, 0.3, 1] },
            y: { duration: 1.25, delay: p.delay, times: [0, 0.32, 1], ease: ["easeOut", "easeIn"] },
            opacity: { duration: 1.25, delay: p.delay, times: [0, 0.7, 1] },
          }}
          onAnimationComplete={i === LAST ? onDone : undefined}
        />
      ))}
    </div>,
    document.body,
  );
}
