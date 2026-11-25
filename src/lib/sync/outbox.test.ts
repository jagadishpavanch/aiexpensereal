import { describe, expect, it } from "vitest";
import { acknowledge, enqueue } from "./outbox";
import type { Change } from "./diff";

const c = (id: string, n: number): Change => ({ collection: "goals", id, data: { id, n } });

describe("outbox", () => {
  it("keeps only the latest change per record", () => {
    const box = enqueue(enqueue({}, [c("a", 1)]), [c("a", 2), c("b", 1)]);
    expect(Object.values(box)).toEqual([c("a", 2), c("b", 1)]);
  });
  it("acknowledging keeps changes made while the push was in flight", () => {
    const sent = enqueue({}, [c("a", 1), c("b", 1)]);
    const now = enqueue(sent, [c("a", 2)]);
    expect(Object.values(acknowledge(now, sent))).toEqual([c("a", 2)]);
  });
});
