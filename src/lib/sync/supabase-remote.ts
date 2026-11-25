import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemoteApi } from "./engine";
import type { RemoteRow } from "./merge";

const PAGE = 1000; // Supabase's default max rows per request
const BATCH = 500;
const OVERLAP_MS = 5000; // re-read a little, in case a row committed late

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
      const from = since ? new Date(Date.parse(since) - OVERLAP_MS).toISOString() : null;
      const out: RemoteRow[] = [];
      for (let page = 0; ; page++) {
        let q = db.from("records").select("collection,id,data,deleted,updated_at").eq("user_id", userId);
        if (from) q = q.gt("updated_at", from);
        const { data, error } = await q.order("updated_at").order("collection").order("id").range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        out.push(...(data as RemoteRow[]));
        if (data.length < PAGE) return out;
      }
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
