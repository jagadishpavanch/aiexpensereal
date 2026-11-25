import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemoteApi } from "./engine";
import type { RemoteRow } from "./merge";

const PAGE = 1000; // Supabase's default max rows per request
const BATCH = 500;
const OVERLAP_MS = 5000; // re-read a little, in case a row committed late

/**
 * Read everything with updated_at >= lowerBound, a page at a time. Each next page starts at the
 * last row's updated_at (inclusive), so a row edited mid-paging can't make us skip another one.
 */
export async function pullPages(
  fetchPage: (lowerBound: string | null) => Promise<RemoteRow[]>,
  lowerBound: string | null,
  pageSize: number,
): Promise<RemoteRow[]> {
  const out: RemoteRow[] = [];
  const seen = new Set<string>();
  let bound = lowerBound;
  for (;;) {
    const page = await fetchPage(bound);
    let added = 0;
    for (const r of page) {
      const key = `${r.collection}:${r.id}@${r.updated_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      added++;
    }
    if (page.length < pageSize) return out;
    if (!added) throw new Error("sync pull made no progress");
    bound = page[page.length - 1].updated_at;
  }
}

export function supabaseRemote(db: SupabaseClient, userId: string): RemoteApi {
  return {
    async push(changes) {
      for (let i = 0; i < changes.length; i += BATCH) {
        const rows = changes.slice(i, i + BATCH).map((c) => ({ user_id: userId, collection: c.collection, id: c.id, data: c.data, deleted: c.data === null }));
        const { error } = await db.from("records").upsert(rows, { onConflict: "user_id,collection,id" });
        if (error) throw error;
      }
    },
    async pull(since) {
      const ms = since ? Date.parse(since) : NaN;
      const bound = Number.isNaN(ms) ? null : new Date(ms - OVERLAP_MS).toISOString(); // unreadable cursor: full pull
      return pullPages(
        async (lowerBound) => {
          let q = db.from("records").select("collection,id,data,deleted,updated_at").eq("user_id", userId);
          if (lowerBound) q = q.gte("updated_at", lowerBound);
          const { data, error } = await q.order("updated_at").order("collection").order("id").limit(PAGE);
          if (error) throw error;
          return data as RemoteRow[];
        },
        bound,
        PAGE,
      );
    },
    async hasAny() {
      const { count, error } = await db.from("records").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("deleted", false);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    async wipe() {
      const { error } = await db.from("records").update({ data: null, deleted: true }).eq("user_id", userId).eq("deleted", false);
      if (error) throw error;
    },
  };
}
