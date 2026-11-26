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
