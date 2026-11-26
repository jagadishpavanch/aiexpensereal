import { useState } from "react";
import type { Transaction } from "@/lib/finance/types";
import { freshIds } from "@/lib/motion-cues";

const NONE: ReadonlySet<string> = new Set();

/**
 * Ids of transactions that arrived in the latest change to `txs` (added,
 * restored, synced in). Nothing is fresh on first render, so opening a
 * screen never highlights old rows. Uses the "adjust state while rendering"
 * pattern, so it stays correct when React renders twice in dev.
 */
export function useFreshIds(txs: Transaction[]): ReadonlySet<string> {
  const [seen, setSeen] = useState(txs);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NONE);
  if (seen !== txs) {
    setSeen(txs);
    setFresh(freshIds(seen, txs));
  }
  return fresh;
}
