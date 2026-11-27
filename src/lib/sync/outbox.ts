import type { Change } from "./diff";

/** Changes waiting to upload, newest per record. */
export type Outbox = Record<string, Change>;

export const keyOf = (c: { collection: string; id: string }) => `${c.collection}:${c.id}`;

export function enqueue(box: Outbox, changes: Change[]): Outbox {
  if (!changes.length) return box;
  const next = { ...box };
  for (const c of changes) next[keyOf(c)] = c;
  return next;
}

/** Drop what was uploaded, unless the record changed again during the upload. */
export function acknowledge(box: Outbox, sent: Outbox): Outbox {
  const next = { ...box };
  for (const [k, c] of Object.entries(sent)) if (next[k] === c) delete next[k];
  return next;
}
