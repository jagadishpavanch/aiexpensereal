import { describe, expect, it } from "vitest";
import type { RemoteRow } from "./merge";
import { pullPages, supabaseRemote } from "./supabase-remote";

const row = (id: string, updated_at: string): RemoteRow => ({ collection: "goals", id, data: { id }, deleted: false, updated_at });
const ts = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`;

/** In-memory stand-in for the keyset query: rows with updated_at >= bound, ordered, limited. */
function pager(rows: RemoteRow[], pageSize: number, beforeFetch?: (call: number) => void) {
  let call = 0;
  return async (bound: string | null) => {
    beforeFetch?.(++call);
    return rows
      .filter((r) => bound === null || r.updated_at >= bound)
      .sort((a, b) => (a.updated_at + a.collection + a.id < b.updated_at + b.collection + b.id ? -1 : 1))
      .slice(0, pageSize);
  };
}

describe("pullPages", () => {
  it("returns every row across several pages without duplicates", async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(`r${n}`, ts(n)));
    const out = await pullPages(pager(rows, 3), null, 3);
    expect(out.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
  });

  it("still returns a row that was updated between page fetches, and skips nothing", async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(`r${n}`, ts(n)));
    const out = await pullPages(
      pager(rows, 3, (call) => {
        if (call === 2) rows[1] = row("r2", ts(8)); // another device edits r2 mid-paging
      }),
      null,
      3,
    );
    expect(new Set(out.map((r) => r.id))).toEqual(new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]));
    expect(out.some((r) => r.id === "r2" && r.updated_at === ts(8))).toBe(true);
  });

  it("throws instead of looping when a full page of rows shares one timestamp", async () => {
    const rows = ["a", "b", "c", "d"].map((id) => row(id, ts(1)));
    await expect(pullPages(pager(rows, 3), null, 3)).rejects.toThrow("made no progress");
  });
});

describe("supabaseRemote session guard", () => {
  // Without a session, supabase-js falls back to the publishable key and queries run as anon;
  // an empty answer then would look like "the cloud is empty" and let a new phone claim the account.
  const fakeDb = (sessionUserId: string | null) => {
    const queried: string[] = [];
    const db = {
      auth: { getSession: async () => ({ data: { session: sessionUserId ? { user: { id: sessionUserId } } : null }, error: null }) },
      from: (table: string) => {
        queried.push(table);
        const q = { select: () => q, eq: () => q, then: (ok: (v: unknown) => void) => ok({ count: 0, error: null }) };
        return q;
      },
    };
    return { db: db as unknown as Parameters<typeof supabaseRemote>[0], queried };
  };

  it("refuses to query without a session", async () => {
    const { db, queried } = fakeDb(null);
    await expect(supabaseRemote(db, "u1").hasAny()).rejects.toThrow(/not signed in/i);
    expect(queried).toEqual([]);
  });

  it("refuses to query as a different user", async () => {
    const { db } = fakeDb("u2");
    await expect(supabaseRemote(db, "u1").push([{ collection: "goals", id: "g", data: null }])).rejects.toThrow(/not signed in/i);
  });

  it("queries when the session belongs to this user", async () => {
    const { db, queried } = fakeDb("u1");
    await expect(supabaseRemote(db, "u1").hasAny()).resolves.toBe(false);
    expect(queried).toEqual(["records"]);
  });
});
