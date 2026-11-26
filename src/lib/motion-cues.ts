/**
 * Pure helpers that decide *when* and *how* the UI animates. Kept out of the
 * components so the rules are unit-testable.
 */

export type RollCell = { key: string; char: string; digit: number | null };

/**
 * Split a formatted amount into cells for a rolling-digit display.
 * Cells are keyed by their place counted from the right, so a digit keeps its
 * column when the number grows or shrinks ("₹9,999" → "₹10,000" only adds a
 * column on the left). Indian grouping puts commas at fixed places from the
 * right, so separators never land on a digit's key.
 */
export function rollCells(text: string): RollCell[] {
  const chars = [...text];
  return chars.map((char, i) => {
    const place = chars.length - 1 - i;
    const digit = char >= "0" && char <= "9" ? Number(char) : null;
    return { key: digit === null ? `s${place}${char}` : `d${place}`, char, digit };
  });
}

/** Map of digit-cell key to digit, used to know where each column rolls from. */
export function digitsByKey(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of rollCells(text)) if (c.digit !== null) m.set(c.key, c.digit);
  return m;
}

export type BarState = "ok" | "near" | "over";

/**
 * Which one-off cue a progress bar plays when its state changes.
 * `prev` is undefined on mount. Crossing into "over" shakes once, but only on
 * a live change, never just because a page opened on an over-budget bar.
 * Reaching "near" (80%) pulses softly, on mount too, as a heads-up.
 */
export function barCue(prev: BarState | undefined, next: BarState): "shake" | "pulse" | null {
  if (next === "over") return prev !== undefined && prev !== "over" ? "shake" : null;
  if (next === "near") return prev !== "near" ? "pulse" : null;
  return null;
}

export type Particle = { dx: number; peak: number; fall: number; rotate: number; delay: number; shape: "strip" | "dot" | "diamond"; tone: number };

/** Stable pseudo-random in [0, 1) for particle i, channel k (no Math.random, so renders are repeatable). */
function rand(i: number, k: number) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Paths for a confetti burst: an upward fan (within ±80° of straight up)
 * that rises to `peak` (negative = up, in px) and then falls past the origin.
 * `tone` indexes the caller's colour list.
 */
export function burstParticles(n: number, tones: number): Particle[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (rand(i, 1) - 0.5) * (Math.PI * 0.9);
    const speed = 110 + rand(i, 2) * 150;
    return {
      dx: Math.round(Math.cos(angle) * speed * 1.2),
      peak: Math.round(Math.sin(angle) * speed),
      fall: Math.round(160 + rand(i, 3) * 160),
      rotate: Math.round((rand(i, 4) - 0.5) * 720),
      delay: Math.round(rand(i, 5) * 80) / 1000,
      shape: (["strip", "strip", "dot", "diamond"] as const)[i % 4],
      tone: i % tones,
    };
  });
}

/**
 * Ids in `next` that were not in `prev`: rows that just arrived (added,
 * restored or synced in). Used to highlight them once. Order is ignored.
 */
export function freshIds(prev: readonly { id: string }[], next: readonly { id: string }[]): Set<string> {
  const before = new Set(prev.map((x) => x.id));
  return new Set(next.filter((x) => !before.has(x.id)).map((x) => x.id));
}
