# Supabase Sign-in + Offline-first Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Copy this plan to `docs/superpowers/plans/2026-11-25-supabase-sync.md` as the first action of Task 1.

## Context

ExTrack keeps everything in `localStorage` (`extrack:v1`): no accounts, nothing backed up, no second device. The user has their own Supabase project and chose: **Google sign-in, sign-in required, offline-first sync**. The app was built for this swap: every screen reads and writes through `src/lib/finance/store.ts` (`useFinance` + `actions`), so sync can sit *under* the store without changing screens or actions.

**Goal:** Sign in with Google (web + Android APK). Every change saves instantly on the phone, queues, and syncs to the user's private Supabase rows. Other devices pull it down. The app keeps working with no signal.

**Architecture:** The store gains a small `syncPort` (commit listener + remote apply + reset). A sync engine diffs each commit by object identity into an **outbox**, pushes it to one generic `records` table (`user_id, collection, id, data jsonb, deleted, updated_at`) with RLS, then pulls rows newer than a **cursor** and merges them (server order = last write wins; unpushed local edits win). Auth is a thin module around `supabase-js` (PKCE). Android returns from Google via the `com.extrack.app://auth/callback` deep link.

**Tech Stack:** `@supabase/supabase-js` (pinned), `@capacitor/app` + `@capacitor/browser` (^8, pinned), Supabase CLI via `npx supabase`, vitest + jsdom.

## Global Constraints

- Run tests from an **uppercase-drive** path: `Set-Location C:\Users\jagad\Downloads\aiexpensereal; npx vitest run` (PowerShell). From a lowercase `c:\` working directory every test file fails with `TypeError: Cannot read properties of undefined (reading 'config')` (vitest loads two copies of its runner). Baseline today from `C:\`: **3 files, 20 tests pass**.
- AGENTS.md rules hold: money logic in `src/lib/finance/`; data access only through `store.ts`; select stable references in `useFinance` (never filtered arrays); app screens under `_shell`, onboarding at `/`.
- Lovable sync: never force-push, amend or rebase pushed commits; every pushed commit must build.
- Only the **publishable** key goes in the app (`VITE_SUPABASE_PUBLISHABLE_KEY`). Never the secret/service_role key.
- Env vars live in `.env.local` (already gitignored via `*.local`); commit `.env.example` with empty values.
- Pin new packages exactly (`npm install --save-exact`) and commit `package-lock.json`.
- Device-local state never syncs: `prefs.lock` (WebAuthn credential + PIN hash are bound to this phone).
- Web redirect: `${origin}/auth/callback` (dev: `http://localhost:8080/auth/callback`). Native redirect: `com.extrack.app://auth/callback` (constant `NATIVE_REDIRECT`).
- localStorage keys: state `extrack:v1` (existing), outbox `extrack:outbox:v1`, cursor `extrack:cursor:v1`, owner `extrack:owner:v1`.
- Branch: `feat/supabase-sync` from current HEAD. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions (made, not open)

- **One generic `records` table** instead of 9 typed tables: TS types already define the shapes, one sync path covers every collection, and new collections need no migration beyond the `check` list. Server queries remain possible via `jsonb`.
- **Diff by object identity**: store updates are immutable (`map` keeps unchanged items' references), so `prev.item !== next.item` finds exactly the changed rows. No action in `store.ts` has to change.
- **Conflicts:** server arrival order wins; a record with an unpushed local change ignores incoming rows until it is pushed. Fine for one person on 1–2 devices.
- **Deletes are tombstones** (`deleted = true, data = null`), so other devices learn about them. There is no `DELETE` policy; account deletion cascades.
- **First sign-in on a device:** cloud already has data → local is replaced by the cloud copy. Cloud empty and device already onboarded → upload the device's data once. A different user signed in before → wipe local first.
- **Pull overlap of 5 s** on the cursor guards against late-committing transactions; merge is idempotent.

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_records.sql` (create) | `records` table, RLS, grants, `updated_at` trigger |
| `.env.example` (create) | documents the two `VITE_` vars |
| `src/lib/sync/diff.ts` (create) | `Change` type, `diffState`, `toChanges`, `syncedPrefs` |
| `src/lib/sync/outbox.ts` (create) | `enqueue`, `acknowledge`, `keyOf` |
| `src/lib/sync/merge.ts` (create) | `RemoteRow`, `applyRows` |
| `src/lib/sync/engine.ts` (create) | `createSyncEngine` (push/pull/start/wipe/forget), `RemoteApi`, `SyncPort` |
| `src/lib/sync/supabase-remote.ts` (create) | `RemoteApi` over the `records` table (batching + paging) |
| `src/lib/sync/runtime.ts` (create) | app-wide session + engine lifecycle, hooks `useAppSession` / `useSyncInfo`, actions |
| `src/lib/auth/supabase.ts` (create) | lazy browser-only `getSupabase()` |
| `src/lib/auth/callback-url.ts` (create) | `NATIVE_REDIRECT`, `codeFromCallbackUrl` (pure) |
| `src/lib/auth/google.ts` (create) | `signInWithGoogle`, `listenForNativeCallback` |
| `src/lib/finance/store.ts` (modify) | add `syncPort`; `set()` notifies commit listeners |
| `src/routes/__root.tsx` (modify) | call `initAppSession()` once |
| `src/routes/auth.callback.tsx` (create) | web OAuth landing page |
| `src/routes/index.tsx` (modify) | sign-in step, loading/failed splash, gated redirect |
| `src/routes/_shell.tsx` (modify) | guard: signed in + sync ready + onboarded |
| `src/routes/_shell.settings.tsx` (modify) | Account group (sign out, sync status), delete-everything |
| `android/app/src/main/AndroidManifest.xml` (modify) | deep-link intent filter |
| `CLAUDE.md`, `roadmap.md` (modify) | test-path gotcha, sync rules, roadmap tick |

---

### Task 0 (user, outside the repo): Google + Supabase dashboard setup

Only the project owner can do these; the agent prints them as a checklist and waits.

- [ ] Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID**, type **Web application**. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Copy Client ID + Client secret.
- [ ] Supabase Dashboard → Authentication → Sign In / Providers → **Google**: enable, paste Client ID + secret.
- [ ] Authentication → URL Configuration: Site URL = production web URL. Redirect URLs: `http://localhost:8080/auth/callback`, `https://<your-web-domain>/auth/callback`, `com.extrack.app://auth/callback`.
- [ ] Project Settings → API Keys: copy the **Project URL** and **publishable key** into `.env.local`:
  ```
  VITE_SUPABASE_URL=https://<project-ref>.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
  ```
- [ ] To make the Lovable preview work too, add the same two vars in Lovable's project environment settings.

---

### Task 1: Branch, plan copy, test-path note

**Files:** Modify `CLAUDE.md` (Known-issue line). Create `docs/superpowers/plans/2026-11-25-supabase-sync.md` (copy of this plan).

- [ ] **Step 1:** `git checkout -b feat/supabase-sync`
- [ ] **Step 2:** Copy this plan to `docs/superpowers/plans/2026-11-25-supabase-sync.md`.
- [ ] **Step 3:** In `CLAUDE.md`, replace the `Known issue (2026-11-25)` bullet with:
  ```markdown
  - Run tests from an uppercase-drive path (`Set-Location C:\Users\...` in PowerShell). From a lowercase `c:\` working directory (VS Code's terminal default here) vitest loads two copies of its runner and every file fails with `reading 'config'` before any test runs.
  ```
- [ ] **Step 4:** Run `Set-Location C:\Users\jagad\Downloads\aiexpensereal; npx vitest run`. Expected: `Test Files 3 passed (3)`, `Tests 20 passed (20)`.
- [ ] **Step 5:** Commit `CLAUDE.md` and the plan copy: `docs: add CLAUDE.md and Supabase sync plan`.

---

### Task 2: Database schema (migration)

**Files:** Create `supabase/config.toml` (via CLI), `supabase/migrations/<timestamp>_records.sql`, `.env.example`.

**Produces:** table `public.records(user_id uuid, collection text, id text, data jsonb, deleted bool, updated_at timestamptz)`, PK `(user_id, collection, id)`.

- [ ] **Step 1:** Fetch `https://supabase.com/changelog.md` and scan for `breaking-change` entries about RLS, Data API grants, publishable keys or OAuth/PKCE. Note anything that changes the SQL or client code below and adjust before continuing.
- [ ] **Step 2:** `npx supabase --version`, then `npx supabase init` (creates `supabase/config.toml`; answer **no** to VS Code/IntelliJ settings), then `npx supabase migration new records`. Use the file it creates.
- [ ] **Step 3:** Fill the migration:
  ```sql
  -- One row per synced record. The app's TypeScript types define `data`;
  -- the database enforces ownership and ordering only.
  create table public.records (
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    collection text not null check (collection in (
      'transactions','categories','accounts','budgets','goals','rules','bills','people','splits','prefs')),
    id text not null,
    data jsonb,
    deleted boolean not null default false,
    updated_at timestamptz not null default clock_timestamp(),
    primary key (user_id, collection, id)
  );

  create index records_user_updated on public.records (user_id, updated_at);

  alter table public.records enable row level security;

  grant select, insert, update on public.records to authenticated;

  create policy "Users read their own records" on public.records
    for select to authenticated using ((select auth.uid()) = user_id);
  create policy "Users add their own records" on public.records
    for insert to authenticated with check ((select auth.uid()) = user_id);
  create policy "Users change their own records" on public.records
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

  create function public.records_touch() returns trigger
  language plpgsql security invoker set search_path = '' as $$
  begin
    new.updated_at := clock_timestamp();
    return new;
  end;
  $$;

  create trigger records_touch before insert or update on public.records
    for each row execute function public.records_touch();
  ```
- [ ] **Step 4:** Create `.env.example`:
  ```
  # Supabase project (publishable values only — never the secret key)
  VITE_SUPABASE_URL=
  VITE_SUPABASE_PUBLISHABLE_KEY=
  ```
- [ ] **Step 5 (user runs, needs their login):** `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`. Fallback: paste the SQL into Dashboard → SQL Editor.
- [ ] **Step 6:** Verify in the SQL Editor: `select relrowsecurity from pg_class where relname = 'records';` → `true`. If CLI ≥ 2.81.3: `npx supabase db advisors` shows no security findings for `records`.
- [ ] **Step 7:** Commit `supabase/`, `.env.example`: `feat(db): add records table with RLS for sync`.

---

### Task 3: Pure sync core: diff, outbox, merge (TDD)

**Files:** Create `src/lib/sync/diff.ts`, `outbox.ts`, `merge.ts`, and tests `src/lib/sync/diff.test.ts`, `outbox.test.ts`, `merge.test.ts`.

**Produces:**
- `type Collection = ListCollection | "prefs"`, `COLLECTIONS`, `PREFS_ID = "prefs"`
- `interface Change { collection: Collection; id: string; data: Record<string, unknown> | null }`
- `diffState(prev: FinanceState, next: FinanceState): Change[]`, `toChanges(s: FinanceState): Change[]`, `syncedPrefs(p: Prefs): Omit<Prefs, "lock">`
- `type Outbox = Record<string, Change>`, `keyOf({collection,id}): string`, `enqueue(box, changes): Outbox`, `acknowledge(box, sent): Outbox`
- `interface RemoteRow { collection: Collection; id: string; data: Record<string, unknown> | null; deleted: boolean; updated_at: string }`, `applyRows(s, rows, pending): FinanceState`

- [ ] **Step 1: Write failing tests** `src/lib/sync/diff.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { demoState } from "@/lib/finance/demo";
  import { diffState, toChanges } from "./diff";

  const base = demoState(new Date(2026, 10, 25));

  describe("diffState", () => {
    it("finds nothing when state is the same object", () => {
      expect(diffState(base, base)).toEqual([]);
    });
    it("reports only the edited transaction", () => {
      const [first, ...rest] = base.transactions;
      const edited = { ...first, amount: first.amount + 1 };
      const changes = diffState(base, { ...base, transactions: [edited, ...rest] });
      expect(changes).toEqual([{ collection: "transactions", id: first.id, data: edited }]);
    });
    it("reports a removed record as data null", () => {
      const changes = diffState(base, { ...base, goals: base.goals.slice(1) });
      expect(changes).toEqual([{ collection: "goals", id: base.goals[0].id, data: null }]);
    });
    it("syncs prefs without the device lock", () => {
      const changes = diffState(base, { ...base, prefs: { ...base.prefs, name: "Meera" } });
      expect(changes).toHaveLength(1);
      expect(changes[0].collection).toBe("prefs");
      expect(changes[0].data).toMatchObject({ name: "Meera" });
      expect(changes[0].data).not.toHaveProperty("lock");
    });
    it("ignores a lock-only prefs change", () => {
      const next = { ...base, prefs: { ...base.prefs, lock: { idleMinutes: 1, pinHash: "x" } } };
      expect(diffState(base, next)).toEqual([]);
    });
    it("snapshots every record plus prefs", () => {
      const all = toChanges(base);
      expect(all.filter((c) => c.collection === "transactions")).toHaveLength(base.transactions.length);
      expect(all.at(-1)).toMatchObject({ collection: "prefs", id: "prefs" });
    });
  });
  ```
  `src/lib/sync/outbox.test.ts`:
  ```ts
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
  ```
  `src/lib/sync/merge.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { demoState } from "@/lib/finance/demo";
  import { applyRows, type RemoteRow } from "./merge";
  import { enqueue } from "./outbox";

  const base = demoState(new Date(2026, 10, 25));
  const row = (p: Partial<RemoteRow>): RemoteRow => ({ collection: "goals", id: "x", data: null, deleted: false, updated_at: "2026-11-25T00:00:00Z", ...p });

  describe("applyRows", () => {
    it("updates a record in place, keeping list order", () => {
      const g = base.goals[1];
      const next = applyRows(base, [row({ id: g.id, data: { ...g, saved: 1 } })], {});
      expect(next.goals.map((x) => x.id)).toEqual(base.goals.map((x) => x.id));
      expect(next.goals[1].saved).toBe(1);
    });
    it("adds new records and removes tombstoned ones", () => {
      const gone = base.goals[0].id;
      const added = { id: "new", name: "Bike", target: 1, saved: 0, emoji: "🚲" };
      const next = applyRows(base, [row({ id: gone, deleted: true }), row({ id: "new", data: added })], {});
      expect(next.goals.some((x) => x.id === gone)).toBe(false);
      expect(next.goals.at(-1)).toEqual(added);
    });
    it("skips rows for records with an unpushed local change", () => {
      const g = base.goals[0];
      const pending = enqueue({}, [{ collection: "goals", id: g.id, data: { ...g } }]);
      const next = applyRows(base, [row({ id: g.id, data: { ...g, saved: 999 } })], pending);
      expect(next.goals[0].saved).toBe(g.saved);
    });
    it("keeps this device's lock and fills missing feature flags", () => {
      const s = { ...base, prefs: { ...base.prefs, lock: { idleMinutes: 2, pinHash: "h" } } };
      const next = applyRows(s, [row({ collection: "prefs", id: "prefs", data: { name: "Meera", features: { splits: false } } })], {});
      expect(next.prefs.name).toBe("Meera");
      expect(next.prefs.lock).toEqual({ idleMinutes: 2, pinHash: "h" });
      expect(next.prefs.features.splits).toBe(false);
      expect(next.prefs.features.bills).toBe(true);
    });
    it("a prefs tombstone sends the device back to onboarding", () => {
      const next = applyRows(base, [row({ collection: "prefs", id: "prefs", deleted: true })], {});
      expect(next.prefs.onboarded).toBe(false);
    });
    it("keeps transactions newest first", () => {
      const t = { ...base.transactions[0], id: "future", date: "2099-01-01T00:00:00.000Z" };
      const next = applyRows(base, [row({ collection: "transactions", id: "future", data: t })], {});
      expect(next.transactions[0].id).toBe("future");
    });
    it("returns the same object when nothing applies", () => {
      expect(applyRows(base, [], {})).toBe(base);
    });
  });
  ```
- [ ] **Step 2:** Run `npx vitest run src/lib/sync` (from `C:\`). Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** `src/lib/sync/diff.ts`:
  ```ts
  import type { FinanceState, Prefs } from "@/lib/finance/types";

  export const COLLECTIONS = ["transactions", "categories", "accounts", "budgets", "goals", "rules", "bills", "people", "splits"] as const;
  export type ListCollection = (typeof COLLECTIONS)[number];
  export type Collection = ListCollection | "prefs";
  export const PREFS_ID = "prefs";

  export interface Change {
    collection: Collection;
    id: string;
    data: Record<string, unknown> | null; // null = deleted
  }

  export type Item = { id: string };
  export const listOf = (s: FinanceState, c: ListCollection) => s[c] as unknown as Item[];
  const asData = (x: unknown) => x as Record<string, unknown>;

  /** Prefs that follow the user to every device. `lock` belongs to this phone only. */
  export function syncedPrefs(p: Prefs): Omit<Prefs, "lock"> {
    const { lock: _lock, ...rest } = p;
    return rest;
  }

  /** Records changed by one store commit. Store updates are immutable, so identity marks change. */
  export function diffState(prev: FinanceState, next: FinanceState): Change[] {
    const out: Change[] = [];
    for (const c of COLLECTIONS) {
      const a = listOf(prev, c);
      const b = listOf(next, c);
      if (a === b) continue;
      const before = new Map(a.map((x) => [x.id, x]));
      for (const item of b) {
        if (before.get(item.id) !== item) out.push({ collection: c, id: item.id, data: asData(item) });
        before.delete(item.id);
      }
      for (const id of before.keys()) out.push({ collection: c, id, data: null });
    }
    if (prev.prefs !== next.prefs) {
      const p = syncedPrefs(next.prefs);
      if (JSON.stringify(syncedPrefs(prev.prefs)) !== JSON.stringify(p)) out.push({ collection: "prefs", id: PREFS_ID, data: asData(p) });
    }
    return out;
  }

  /** Every record, for the one-time upload of a device's existing data. */
  export function toChanges(s: FinanceState): Change[] {
    const out: Change[] = [];
    for (const c of COLLECTIONS) for (const item of listOf(s, c)) out.push({ collection: c, id: item.id, data: asData(item) });
    out.push({ collection: "prefs", id: PREFS_ID, data: asData(syncedPrefs(s.prefs)) });
    return out;
  }
  ```
  `src/lib/sync/outbox.ts`:
  ```ts
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
  ```
  `src/lib/sync/merge.ts`:
  ```ts
  import { DEFAULT_PREFS } from "@/lib/finance/demo";
  import type { FinanceState, Prefs } from "@/lib/finance/types";
  import { listOf, type Collection, type Item, type ListCollection } from "./diff";
  import { keyOf, type Outbox } from "./outbox";

  export interface RemoteRow {
    collection: Collection;
    id: string;
    data: Record<string, unknown> | null;
    deleted: boolean;
    updated_at: string;
  }

  /** Apply pulled rows (oldest first). Records with unpushed local changes keep the local copy. */
  export function applyRows(s: FinanceState, rows: RemoteRow[], pending: Outbox): FinanceState {
    const touched = new Map<ListCollection, Map<string, Item>>();
    let prefs = s.prefs;
    for (const r of rows) {
      if (pending[keyOf(r)]) continue;
      if (r.collection === "prefs") {
        const d = (r.deleted ? {} : r.data ?? {}) as Partial<Prefs>;
        prefs = { ...DEFAULT_PREFS, ...d, features: { ...DEFAULT_PREFS.features, ...d.features }, lock: s.prefs.lock };
        if (r.deleted) prefs.onboarded = false;
        continue;
      }
      let m = touched.get(r.collection);
      if (!m) {
        m = new Map(listOf(s, r.collection).map((x) => [x.id, x]));
        touched.set(r.collection, m);
      }
      if (r.deleted || !r.data) m.delete(r.id);
      else m.set(r.id, r.data as unknown as Item);
    }
    if (!touched.size && prefs === s.prefs) return s;
    const next = { ...s, prefs } as FinanceState;
    for (const [c, m] of touched) (next as unknown as Record<string, Item[]>)[c] = [...m.values()];
    if (touched.has("transactions")) next.transactions = [...next.transactions].sort((a, b) => +new Date(b.date) - +new Date(a.date));
    return next;
  }
  ```
- [ ] **Step 4:** Run `npx vitest run src/lib/sync`. Expected: 15 new tests pass. Run the full suite: the earlier 20 still pass (35 total).
- [ ] **Step 5:** Commit: `feat(sync): add diff, outbox and merge for offline-first sync`.

---

### Task 4: Store sync port (TDD)

**Files:** Modify `src/lib/finance/store.ts` (`set()` at lines ~61-65, add export at end). Test `src/lib/finance/store-sync.test.ts`.

**Consumes:** nothing new. **Produces:**
```ts
export const syncPort: {
  getState(): FinanceState;
  onLocalCommit(l: (prev: FinanceState, next: FinanceState) => void): () => void;
  applyRemote(fn: (s: FinanceState) => FinanceState): void; // no commit listeners fire
  reset(): void; // empty state, onboarded false, clears saved keys
}
```

- [ ] **Step 1: Failing test** `src/lib/finance/store-sync.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";
  import { actions, syncPort } from "./store";

  describe("syncPort", () => {
    beforeEach(() => syncPort.reset());

    it("tells listeners about local commits with before/after state", () => {
      const seen = vi.fn();
      const off = syncPort.onLocalCommit(seen);
      actions.addGoal({ name: "Bike", target: 100, saved: 0, emoji: "🚲" });
      off();
      expect(seen).toHaveBeenCalledTimes(1);
      const [prev, next] = seen.mock.calls[0];
      expect(next.goals.length).toBe(prev.goals.length + 1);
    });

    it("applies remote changes without reporting them as local", () => {
      const seen = vi.fn();
      const off = syncPort.onLocalCommit(seen);
      syncPort.applyRemote((s) => ({ ...s, prefs: { ...s.prefs, name: "Meera" } }));
      off();
      expect(seen).not.toHaveBeenCalled();
      expect(syncPort.getState().prefs.name).toBe("Meera");
    });

    it("reset returns to an un-onboarded empty state", () => {
      actions.setPrefs({ onboarded: true });
      syncPort.reset();
      expect(syncPort.getState().prefs.onboarded).toBe(false);
      expect(syncPort.getState().transactions).toEqual([]);
    });
  });
  ```
- [ ] **Step 2:** Run `npx vitest run src/lib/finance/store-sync.test.ts`. Expected: FAIL, `syncPort` is not exported.
- [ ] **Step 3: Implement** in `store.ts`. Replace `set()` and add the port + a silent `replace()`:
  ```ts
  type CommitListener = (prev: FinanceState, next: FinanceState) => void;
  const commitListeners = new Set<CommitListener>();

  function set(fn: (s: FinanceState) => FinanceState) {
    const prev = get();
    state = fn(prev);
    persist();
    listeners.forEach((l) => l());
    commitListeners.forEach((l) => l(prev, state!));
  }

  /** Swap state without it counting as a local edit (remote changes, sign-out). */
  function replace(next: FinanceState) {
    state = next;
    persist();
    listeners.forEach((l) => l());
  }
  ```
  At the end of the file:
  ```ts
  /** The sync engine's only door into the store. Screens use `useFinance` + `actions`. */
  export const syncPort = {
    getState: get,
    onLocalCommit(l: CommitListener) {
      commitListeners.add(l);
      return () => void commitListeners.delete(l);
    },
    applyRemote(fn: (s: FinanceState) => FinanceState) {
      replace(fn(get()));
    },
    reset() {
      try {
        localStorage.removeItem(OLD_KEY);
      } catch {
        /* storage unavailable */
      }
      replace({ ...emptyState(), prefs: { ...DEFAULT_PREFS, onboarded: false } });
    },
  };
  ```
- [ ] **Step 4:** Run the full suite from `C:\`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(store): expose syncPort for the sync engine`.

---

### Task 5: Sync engine + Supabase remote (TDD with a fake remote)

**Files:** Create `src/lib/sync/engine.ts`, `src/lib/sync/supabase-remote.ts`. Test `src/lib/sync/engine.test.ts`. Install `@supabase/supabase-js`.

**Consumes:** Task 3 (`diffState`, `toChanges`, `enqueue`, `acknowledge`, `applyRows`, `RemoteRow`, `Change`), Task 4 `syncPort` shape.
**Produces:**
```ts
export interface RemoteApi { push(changes: Change[]): Promise<void>; pull(since: string | null): Promise<RemoteRow[]>; hasAny(): Promise<boolean>; wipe(): Promise<void>; }
export interface SyncPort { getState(); onLocalCommit(l); applyRemote(fn); reset(); }
export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export interface SyncInfo { status: SyncStatus; pending: number; lastSyncedAt: number | null }
export const SYNC_KEYS: { outbox; cursor; owner };
export function createSyncEngine(o: { remote; port; kv; debounceMs?; onInfo?(i: SyncInfo) }): { start(userId): Promise<void>; syncNow(): Promise<void>; wipeAll(): Promise<void>; forget(): void; stop(): void; info(): SyncInfo }
export type SyncEngine = ReturnType<typeof createSyncEngine>;
export function supabaseRemote(db: SupabaseClient, userId: string): RemoteApi;
```

- [ ] **Step 1:** `npm install --save-exact @supabase/supabase-js`
- [ ] **Step 2: Failing tests** `src/lib/sync/engine.test.ts`:
  ```ts
  import { afterEach, describe, expect, it } from "vitest";
  import { demoState, emptyState } from "@/lib/finance/demo";
  import type { FinanceState } from "@/lib/finance/types";
  import type { Change } from "./diff";
  import type { RemoteRow } from "./merge";
  import { createSyncEngine, type KV, type RemoteApi, type SyncEngine, type SyncPort } from "./engine";

  class FakeRemote implements RemoteApi {
    rows = new Map<string, RemoteRow>();
    clock = 0;
    failNext = false;
    private stamp() { return String(++this.clock).padStart(10, "0"); }
    async push(changes: Change[]) {
      if (this.failNext) { this.failNext = false; throw new Error("offline"); }
      for (const c of changes) this.rows.set(`${c.collection}:${c.id}`, { collection: c.collection, id: c.id, data: c.data, deleted: c.data === null, updated_at: this.stamp() });
    }
    async pull(since: string | null) {
      return [...this.rows.values()].filter((r) => since === null || r.updated_at > since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
    }
    async hasAny() { return [...this.rows.values()].some((r) => !r.deleted); }
    async wipe() { for (const [k, r] of this.rows) if (!r.deleted) this.rows.set(k, { ...r, data: null, deleted: true, updated_at: this.stamp() }); }
  }

  function memoryPort(initial: FinanceState) {
    let s = initial;
    const ls = new Set<(p: FinanceState, n: FinanceState) => void>();
    const port: SyncPort & { commit(fn: (s: FinanceState) => FinanceState): void } = {
      getState: () => s,
      onLocalCommit: (l) => (ls.add(l), () => void ls.delete(l)),
      applyRemote: (fn) => { s = fn(s); },
      reset: () => { s = { ...emptyState(), prefs: { ...emptyState().prefs, onboarded: false } }; },
      commit: (fn) => { const p = s; s = fn(s); ls.forEach((l) => l(p, s)); },
    };
    return port;
  }

  const memoryKV = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
  const onboarded = (s: FinanceState) => ({ ...s, prefs: { ...s.prefs, onboarded: true } });
  const engines: SyncEngine[] = [];
  const device = (remote: FakeRemote, initial = emptyState()) => {
    const port = memoryPort(initial);
    const engine = createSyncEngine({ remote, port, kv: memoryKV(), debounceMs: 60_000 });
    engines.push(engine);
    return { port, engine };
  };
  const goal = { id: "g1", name: "Bike", target: 100, saved: 0, emoji: "🚲" };

  afterEach(() => engines.splice(0).forEach((e) => e.stop()));

  describe("sync engine", () => {
    it("uploads an onboarded device's data on first sign-in when the cloud is empty", async () => {
      const remote = new FakeRemote();
      const a = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
      await a.engine.start("u1");
      expect(await remote.hasAny()).toBe(true);
      expect(remote.rows.get("prefs:prefs")?.data).toMatchObject({ onboarded: true });
    });

    it("replaces local data with the cloud copy when the cloud already has data", async () => {
      const remote = new FakeRemote();
      await remote.push([{ collection: "goals", id: "g1", data: goal }]);
      const b = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
      await b.engine.start("u1");
      expect(b.port.getState().goals).toEqual([goal]);
    });

    it("an edit on one device reaches the other", async () => {
      const remote = new FakeRemote();
      const a = device(remote); const b = device(remote);
      await a.engine.start("u1"); await b.engine.start("u1");
      a.port.commit((s) => ({ ...s, goals: [goal] }));
      await a.engine.syncNow(); await b.engine.syncNow();
      expect(b.port.getState().goals).toEqual([goal]);
    });

    it("deletes propagate", async () => {
      const remote = new FakeRemote();
      const a = device(remote); const b = device(remote);
      await a.engine.start("u1"); await b.engine.start("u1");
      a.port.commit((s) => ({ ...s, goals: [goal] }));
      await a.engine.syncNow(); await b.engine.syncNow();
      a.port.commit((s) => ({ ...s, goals: [] }));
      await a.engine.syncNow(); await b.engine.syncNow();
      expect(b.port.getState().goals).toEqual([]);
    });

    it("keeps changes queued while offline and sends them later", async () => {
      const remote = new FakeRemote();
      const a = device(remote);
      await a.engine.start("u1");
      a.port.commit((s) => ({ ...s, goals: [goal] }));
      remote.failNext = true;
      await a.engine.syncNow();
      expect(a.engine.info().status).not.toBe("idle");
      expect(a.engine.info().pending).toBe(1);
      await a.engine.syncNow();
      expect(a.engine.info()).toMatchObject({ status: "idle", pending: 0 });
      expect(remote.rows.get("goals:g1")?.data).toEqual(goal);
    });

    it("an unpushed local edit is not overwritten by an incoming row", async () => {
      const remote = new FakeRemote();
      const a = device(remote); const b = device(remote);
      await a.engine.start("u1"); await b.engine.start("u1");
      a.port.commit((s) => ({ ...s, goals: [goal] }));
      await a.engine.syncNow(); await b.engine.syncNow();
      b.port.commit((s) => ({ ...s, goals: [{ ...goal, saved: 50 }] }));
      a.port.commit((s) => ({ ...s, goals: [{ ...goal, saved: 10 }] }));
      await a.engine.syncNow();
      await b.engine.syncNow(); // pushes 50 after A's 10, so 50 is newest
      await a.engine.syncNow();
      expect(b.port.getState().goals[0].saved).toBe(50);
      expect(a.port.getState().goals[0].saved).toBe(50);
    });

    it("wipeAll tombstones the cloud and resets this device", async () => {
      const remote = new FakeRemote();
      const a = device(remote, onboarded(emptyState()));
      await a.engine.start("u1");
      await a.engine.wipeAll();
      expect(await remote.hasAny()).toBe(false);
      expect(a.port.getState().prefs.onboarded).toBe(false);
    });
  });
  ```
- [ ] **Step 3:** Run `npx vitest run src/lib/sync/engine.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `src/lib/sync/engine.ts`:
  ```ts
  import type { FinanceState } from "@/lib/finance/types";
  import { diffState, toChanges, type Change } from "./diff";
  import { applyRows, type RemoteRow } from "./merge";
  import { acknowledge, enqueue, type Outbox } from "./outbox";

  export interface RemoteApi {
    push(changes: Change[]): Promise<void>;
    pull(since: string | null): Promise<RemoteRow[]>;
    hasAny(): Promise<boolean>;
    wipe(): Promise<void>;
  }
  export interface SyncPort {
    getState(): FinanceState;
    onLocalCommit(listener: (prev: FinanceState, next: FinanceState) => void): () => void;
    applyRemote(fn: (s: FinanceState) => FinanceState): void;
    reset(): void;
  }
  export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
  export type SyncStatus = "idle" | "syncing" | "offline" | "error";
  export interface SyncInfo { status: SyncStatus; pending: number; lastSyncedAt: number | null }

  export const SYNC_KEYS = { outbox: "extrack:outbox:v1", cursor: "extrack:cursor:v1", owner: "extrack:owner:v1" } as const;

  function readOutbox(kv: KV): Outbox {
    try { return JSON.parse(kv.getItem(SYNC_KEYS.outbox) ?? "{}") as Outbox; } catch { return {}; }
  }

  export function createSyncEngine(opts: { remote: RemoteApi; port: SyncPort; kv: KV; debounceMs?: number; onInfo?: (info: SyncInfo) => void }) {
    const { remote, port, kv, debounceMs = 1500, onInfo } = opts;
    let outbox = readOutbox(kv);
    let cursor = kv.getItem(SYNC_KEYS.cursor);
    let status: SyncStatus = "idle";
    let lastSyncedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<void> | null = null;
    let again = false;

    const info = (): SyncInfo => ({ status, pending: Object.keys(outbox).length, lastSyncedAt });
    const emit = () => onInfo?.(info());
    const saveOutbox = () => { kv.setItem(SYNC_KEYS.outbox, JSON.stringify(outbox)); emit(); };
    const setStatus = (s: SyncStatus) => { status = s; emit(); };

    const unsubscribe = port.onLocalCommit((prev, next) => {
      outbox = enqueue(outbox, diffState(prev, next));
      saveOutbox();
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), debounceMs);
    });

    async function runOnce() {
      const sending = outbox;
      const changes = Object.values(sending);
      if (changes.length) {
        await remote.push(changes);
        outbox = acknowledge(outbox, sending);
        saveOutbox();
      }
      const rows = await remote.pull(cursor);
      if (rows.length) {
        port.applyRemote((s) => applyRows(s, rows, outbox));
        cursor = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor ?? "");
        kv.setItem(SYNC_KEYS.cursor, cursor);
      }
    }

    /** Push queued changes, then pull newer rows. Concurrent calls share one run. */
    function syncNow(): Promise<void> {
      if (running) { again = true; return running; }
      setStatus("syncing");
      running = (async () => {
        try {
          do { again = false; await runOnce(); } while (again);
          lastSyncedAt = Date.now();
          setStatus("idle");
        } catch {
          setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
        } finally {
          running = null;
        }
      })();
      return running;
    }

    /** First run for a user on this device decides whose data wins, then syncs. */
    async function start(userId: string) {
      const owner = kv.getItem(SYNC_KEYS.owner);
      if (owner !== userId) {
        const cloudHasData = await remote.hasAny();
        const local = port.getState();
        if (owner !== null || cloudHasData) { port.reset(); outbox = {}; }
        else if (local.prefs.onboarded) outbox = enqueue({}, toChanges(local));
        cursor = null;
        kv.removeItem(SYNC_KEYS.cursor);
        saveOutbox();
        kv.setItem(SYNC_KEYS.owner, userId);
      }
      await syncNow();
    }

    async function wipeAll() {
      await remote.wipe();
      outbox = {};
      saveOutbox();
      port.reset();
    }

    /** Sign-out: drop this user's data and sync bookkeeping from the device. */
    function forget() {
      Object.values(SYNC_KEYS).forEach((k) => kv.removeItem(k));
      outbox = {};
      cursor = null;
      port.reset();
      emit();
    }

    function stop() { unsubscribe(); clearTimeout(timer); }

    return { start, syncNow, wipeAll, forget, stop, info };
  }
  export type SyncEngine = ReturnType<typeof createSyncEngine>;
  ```
  `src/lib/sync/supabase-remote.ts`:
  ```ts
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
  ```
- [ ] **Step 5:** Run the full suite from `C:\`. Expected: all pass. Run `npx tsc --noEmit -p .`. Expected: no new errors in `src/lib/sync`.
- [ ] **Step 6:** Commit `src/lib/sync`, `package.json`, `package-lock.json`: `feat(sync): add sync engine and Supabase remote`.

---

### Task 6: Google sign-in (web + Android deep link) and app session runtime

**Files:** Create `src/lib/auth/supabase.ts`, `src/lib/auth/callback-url.ts` (+ test `callback-url.test.ts`), `src/lib/auth/google.ts`, `src/lib/sync/runtime.ts`, `src/routes/auth.callback.tsx`. Modify `src/routes/__root.tsx` (RootComponent), `android/app/src/main/AndroidManifest.xml`, `src/test/app-routing.test.tsx`. Install `@capacitor/app`, `@capacitor/browser`.

**Consumes:** `createSyncEngine`, `SYNC_KEYS`, `SyncInfo`, `supabaseRemote` (Task 5); `syncPort` (Task 4).
**Produces:**
```ts
// auth
export function getSupabase(): SupabaseClient | null;
export const NATIVE_REDIRECT = "com.extrack.app://auth/callback";
export function codeFromCallbackUrl(url: string): string | null;
export function signInWithGoogle(): Promise<void>;
// runtime
export type AppSession = { auth: "loading" } | { auth: "misconfigured" } | { auth: "signedOut" } | { auth: "signedIn"; user: User; sync: "starting" | "ready" | "failed" };
export function initAppSession(): void;
export function useAppSession(): AppSession;
export function useSyncInfo(): SyncInfo;
export function syncNow(): Promise<void>;
export function retrySync(): void;
export function signOutAndForget(): Promise<void>;
export function deleteEverything(): Promise<void>;
```

- [ ] **Step 1:** `npm install --save-exact @capacitor/app@^8 @capacitor/browser@^8`
- [ ] **Step 2: Failing test** `src/lib/auth/callback-url.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { codeFromCallbackUrl } from "./callback-url";

  describe("codeFromCallbackUrl", () => {
    it("reads the PKCE code from the app's deep link", () => {
      expect(codeFromCallbackUrl("com.extrack.app://auth/callback?code=abc123")).toBe("abc123");
    });
    it("ignores other links", () => {
      expect(codeFromCallbackUrl("https://example.com/auth/callback?code=abc")).toBeNull();
      expect(codeFromCallbackUrl("com.extrack.app://auth/callback?error=access_denied")).toBeNull();
    });
  });
  ```
  Add to `src/test/app-routing.test.tsx`, inside the describe:
  ```ts
  it("matches the OAuth landing page", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/auth/callback").at(-1)?.routeId).toBe("/auth/callback");
  });
  ```
- [ ] **Step 3:** Run `npx vitest run src/lib/auth src/test`. Expected: FAIL (module missing; route not matched).
- [ ] **Step 4: Implement auth modules.**
  `src/lib/auth/callback-url.ts`:
  ```ts
  /** Where Google sends the Android app back to. Must be listed in Supabase → Auth → Redirect URLs. */
  export const NATIVE_REDIRECT = "com.extrack.app://auth/callback";

  export function codeFromCallbackUrl(url: string): string | null {
    if (!url.startsWith(NATIVE_REDIRECT)) return null;
    return new URL(url).searchParams.get("code");
  }
  ```
  `src/lib/auth/supabase.ts`:
  ```ts
  /// <reference types="vite/client" />
  import { createClient, type SupabaseClient } from "@supabase/supabase-js";
  import { Capacitor } from "@capacitor/core";

  let client: SupabaseClient | null | undefined;

  /** Browser-only client; null during prerender or when env vars are missing. */
  export function getSupabase(): SupabaseClient | null {
    if (typeof window === "undefined") return null;
    if (client !== undefined) return client;
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    client = url && key
      ? createClient(url, key, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: !Capacitor.isNativePlatform() } })
      : null;
    return client;
  }
  ```
  `src/lib/auth/google.ts`:
  ```ts
  import { Capacitor } from "@capacitor/core";
  import type { SupabaseClient } from "@supabase/supabase-js";
  import { toast } from "sonner";
  import { codeFromCallbackUrl, NATIVE_REDIRECT } from "./callback-url";
  import { getSupabase } from "./supabase";

  /** Google blocks sign-in inside app web views, so Android opens Chrome Custom Tabs and returns via deep link. */
  export async function signInWithGoogle() {
    const db = getSupabase();
    if (!db) throw new Error("Supabase is not configured");
    if (Capacitor.isNativePlatform()) {
      const { data, error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
      if (error) throw error;
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url });
      return;
    }
    const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) throw error;
  }

  export async function listenForNativeCallback(db: SupabaseClient) {
    const { App } = await import("@capacitor/app");
    const { Browser } = await import("@capacitor/browser");
    const handle = async (url: string) => {
      const code = codeFromCallbackUrl(url);
      if (!code) return;
      await Browser.close().catch(() => {});
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (error) toast.error("Google sign-in didn't finish. Try again.");
    };
    await App.addListener("appUrlOpen", ({ url }) => void handle(url));
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handle(launch.url);
  }
  ```
- [ ] **Step 5: Implement runtime** `src/lib/sync/runtime.ts`:
  ```ts
  import { useSyncExternalStore } from "react";
  import { Capacitor } from "@capacitor/core";
  import type { User } from "@supabase/supabase-js";
  import { getSupabase } from "@/lib/auth/supabase";
  import { listenForNativeCallback } from "@/lib/auth/google";
  import { syncPort } from "@/lib/finance/store";
  import { createSyncEngine, type SyncEngine, type SyncInfo } from "./engine";
  import { supabaseRemote } from "./supabase-remote";

  export type AppSession =
    | { auth: "loading" }
    | { auth: "misconfigured" }
    | { auth: "signedOut" }
    | { auth: "signedIn"; user: User; sync: "starting" | "ready" | "failed" };

  const LOADING: AppSession = { auth: "loading" };
  const IDLE_INFO: SyncInfo = { status: "idle", pending: 0, lastSyncedAt: null };
  let session: AppSession = LOADING;
  let info: SyncInfo = IDLE_INFO;
  let engine: SyncEngine | null = null;
  let started = false;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());
  const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
  const setSession = (s: AppSession) => { session = s; notify(); };

  export const useAppSession = () => useSyncExternalStore(subscribe, () => session, () => LOADING);
  export const useSyncInfo = () => useSyncExternalStore(subscribe, () => info, () => IDLE_INFO);

  /** Call once on the client. Follows the Supabase session and runs one sync engine per signed-in user. */
  export function initAppSession() {
    if (started || typeof window === "undefined") return;
    started = true;
    const db = getSupabase();
    if (!db) return setSession({ auth: "misconfigured" });
    // Supabase warns against awaiting its own calls inside this callback, so defer.
    db.auth.onAuthStateChange((_event, s) => void setTimeout(() => onUser(s?.user ?? null), 0));
    window.addEventListener("online", () => void engine?.syncNow());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void engine?.syncNow(); });
    if (Capacitor.isNativePlatform()) void listenForNativeCallback(db);
  }

  function onUser(user: User | null) {
    if (!user) {
      engine?.stop();
      engine = null;
      return setSession({ auth: "signedOut" });
    }
    if (engine && session.auth === "signedIn" && session.user.id === user.id) return setSession({ ...session, user });
    engine?.stop();
    engine = createSyncEngine({ remote: supabaseRemote(getSupabase()!, user.id), port: syncPort, kv: localStorage, onInfo: (i) => { info = i; notify(); } });
    startEngine(user);
  }

  function startEngine(user: User) {
    setSession({ auth: "signedIn", user, sync: "starting" });
    engine!.start(user.id).then(
      () => setSession({ auth: "signedIn", user, sync: "ready" }),
      () => setSession({ auth: "signedIn", user, sync: "failed" }),
    );
  }

  export const syncNow = () => engine?.syncNow() ?? Promise.resolve();
  export function retrySync() { if (session.auth === "signedIn" && engine) startEngine(session.user); }

  /** Upload what we can, then remove this user's data from the phone and sign out. */
  export async function signOutAndForget() {
    await engine?.syncNow();
    engine?.forget();
    engine?.stop();
    engine = null;
    setSession({ auth: "signedOut" });
    await getSupabase()?.auth.signOut();
  }

  /** Delete every record in the account (as tombstones so other devices clear too) and on this phone. */
  export async function deleteEverything() {
    if (!engine) throw new Error("Not signed in");
    await engine.wipeAll();
  }
  ```
- [ ] **Step 6: Web callback route** `src/routes/auth.callback.tsx`:
  ```tsx
  import { createFileRoute, useNavigate } from "@tanstack/react-router";
  import { useEffect, useState } from "react";
  import { useAppSession } from "@/lib/sync/runtime";
  import { Button } from "@/components/ui/button";

  export const Route = createFileRoute("/auth/callback")({
    head: () => ({ meta: [{ title: "Signing in — ExTrack" }] }),
    component: AuthCallback,
  });

  function AuthCallback() {
    const session = useAppSession();
    const navigate = useNavigate();
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(new URLSearchParams(window.location.search).has("error")), []);
    useEffect(() => { if (session.auth === "signedIn") navigate({ to: "/", replace: true }); }, [session.auth, navigate]);
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        {failed || session.auth === "signedOut" ? (
          <div className="space-y-4">
            <p className="font-medium">Google sign-in didn't finish.</p>
            <Button className="rounded-2xl" onClick={() => navigate({ to: "/" })}>Back to sign in</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    );
  }
  ```
- [ ] **Step 7: Root** — in `src/routes/__root.tsx` `RootComponent`, add `import { initAppSession } from "@/lib/sync/runtime";` and as the first line of the component body: `useEffect(() => initAppSession(), []);` (`useEffect` is already imported).
- [ ] **Step 8: Android deep link** — inside the `<activity>` in `android/app/src/main/AndroidManifest.xml`, after the LAUNCHER intent-filter:
  ```xml
  <intent-filter>
      <action android:name="android.intent.action.VIEW" />
      <category android:name="android.intent.category.DEFAULT" />
      <category android:name="android.intent.category.BROWSABLE" />
      <data android:scheme="com.extrack.app" android:host="auth" />
  </intent-filter>
  ```
- [ ] **Step 9:** `npm run build` (regenerates `src/routeTree.gen.ts` with `/auth/callback`), then run the full suite from `C:\`. Expected: all pass including the 3 new cases.
- [ ] **Step 10:** Commit: `feat(auth): Google sign-in with PKCE on web and Android deep link`.

---

### Task 7: Gate the app behind sign-in; onboarding sign-in step

**Files:** Modify `src/routes/_shell.tsx` (`Shell`, lines ~25-40), `src/routes/index.tsx` (`Onboarding`, step 0 at ~line 79-87, the `onboarded` redirect effect at ~line 44).

**Consumes:** `useAppSession`, `retrySync` (runtime), `signInWithGoogle` (auth/google).

- [ ] **Step 1: Shell guard.** Replace `Shell` in `_shell.tsx`:
  ```tsx
  function Shell() {
    const hydrated = useHydrated();
    const session = useAppSession();
    const onboarded = useFinance((s) => s.prefs.onboarded);
    const navigate = useNavigate();
    const ready = session.auth === "signedIn" && session.sync === "ready";
    const leave = session.auth === "signedOut" || session.auth === "misconfigured" || (session.auth === "signedIn" && session.sync === "failed") || (ready && !onboarded);
    useEffect(() => {
      if (hydrated && leave) navigate({ to: "/" });
    }, [hydrated, leave, navigate]);

    if (!hydrated || !ready || !onboarded) return <ShellSkeleton />;
    return (
      <LockGate>
        <TxSheetProvider>
          <Frame />
        </TxSheetProvider>
      </LockGate>
    );
  }
  ```
  Add `import { useAppSession } from "@/lib/sync/runtime";`.
- [ ] **Step 2: Onboarding gating.** In `index.tsx` `Onboarding`, add `const session = useAppSession();`, and change the redirect effect to:
  ```tsx
  const ready = session.auth === "signedIn" && session.sync === "ready";
  useEffect(() => {
    if (hydrated && ready && onboarded) navigate({ to: "/home", replace: true });
  }, [hydrated, ready, onboarded, navigate]);
  ```
  Change `finish` to prefill the Google name:
  ```tsx
  const googleName = session.auth === "signedIn" ? ((session.user.user_metadata?.given_name ?? session.user.user_metadata?.full_name) as string | undefined) : undefined;
  const finish = () => {
    actions.setPrefs({ onboarded: true, name: name.trim() || googleName || prefs.name });
    navigate({ to: "/home" });
  };
  ```
  After all hooks and before the main `return`, add the splash states:
  ```tsx
  if (session.auth === "misconfigured") return <Splash text="Sign-in isn't set up yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local and restart." />;
  if (!hydrated || session.auth === "loading" || (session.auth === "signedIn" && session.sync === "starting") || (ready && onboarded)) return <Splash text="Getting your data ready…" />;
  if (session.auth === "signedIn" && session.sync === "failed") return <Splash text="Couldn't load your data. Check your internet connection." action={<Button className="rounded-2xl" onClick={retrySync}>Try again</Button>} />;
  ```
  Add the component at the bottom of the file:
  ```tsx
  function Splash({ text, action }: { text: string; action?: React.ReactNode }) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
          {action}
        </div>
      </div>
    );
  }
  ```
- [ ] **Step 3: Step 0 buttons.** Replace the `<div className="mt-auto space-y-3 pt-8">…</div>` block in step 0 with:
  ```tsx
  {session.auth === "signedOut" ? (
    <div className="mt-auto space-y-3 pt-8">
      <Button size="lg" className="h-14 w-full rounded-2xl text-base" onClick={() => signInWithGoogle().catch(() => toast.error("Couldn't open Google sign-in. Try again."))}>Continue with Google</Button>
      <p className="text-center text-xs text-muted-foreground">Your data is saved to your private account and works offline.</p>
    </div>
  ) : (
    <div className="mt-auto space-y-3 pt-8">
      <Button size="lg" className="h-14 w-full rounded-2xl text-base" onClick={() => { actions.loadDemo(); go(1); }}>Explore with sample data</Button>
      <Button size="lg" variant="outline" className="h-14 w-full rounded-2xl text-base" onClick={() => { actions.startFresh(); go(1); }}>Start with my own data</Button>
      <p className="text-center text-xs text-muted-foreground">Everything syncs to your account and still works offline.</p>
    </div>
  )}
  ```
  Add imports: `import { toast } from "sonner";`, `import { signInWithGoogle } from "@/lib/auth/google";`, `import { retrySync, useAppSession } from "@/lib/sync/runtime";`.
- [ ] **Step 4:** In the privacy step list (step 2), replace `"Export or delete everything whenever you like."` with `"Only you can read your data. Export or delete everything whenever you like."`.
- [ ] **Step 5:** `npm run build` succeeds; full test suite passes from `C:\`; `npm run lint` has no new errors in touched files.
- [ ] **Step 6:** Commit: `feat(onboarding): require Google sign-in before the app`.

---

### Task 8: Settings: account, sync status, sign out, delete everything

**Files:** Modify `src/routes/_shell.settings.tsx` (add Account group at top of the page body; replace the delete button at ~line 162).

**Consumes:** `useAppSession`, `useSyncInfo`, `syncNow`, `signOutAndForget`, `deleteEverything`.

- [ ] **Step 1:** Add imports: `import { deleteEverything, signOutAndForget, syncNow, useAppSession, useSyncInfo } from "@/lib/sync/runtime";` and the label map above the component:
  ```tsx
  const SYNC_LABEL = { idle: "Synced", syncing: "Syncing…", offline: "Offline. Changes are saved on this phone", error: "Couldn't sync. Tap Sync now to retry" } as const;
  ```
- [ ] **Step 2:** In the settings component add hooks and handlers:
  ```tsx
  const session = useAppSession();
  const sync = useSyncInfo();
  const user = session.auth === "signedIn" ? session.user : null;
  const syncSub = sync.pending
    ? `${sync.pending} change${sync.pending === 1 ? "" : "s"} waiting to upload`
    : sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : undefined;
  const onSignOut = async () => {
    if (sync.pending && !confirm(`${sync.pending} change${sync.pending === 1 ? " hasn't" : "s haven't"} uploaded yet and will be lost if you sign out now. Sign out anyway?`)) return;
    await signOutAndForget();
    navigate({ to: "/" });
  };
  const onDeleteAll = async () => {
    if (!confirm("Delete all your ExTrack data from this phone and your account? This can't be undone.")) return;
    try {
      await deleteEverything();
      navigate({ to: "/" });
    } catch {
      toast.error("Couldn't reach your account. Connect to the internet and try again.");
    }
  };
  ```
  Render first, before the existing groups:
  ```tsx
  <Group title="Account">
    <Row label={(user?.user_metadata?.full_name as string | undefined) ?? "Signed in"} sub={user?.email}>
      <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => void onSignOut()}>Sign out</Button>
    </Row>
    <Row label={SYNC_LABEL[sync.status]} sub={syncSub}>
      <Button size="sm" variant="secondary" className="rounded-xl" disabled={sync.status === "syncing"} onClick={() => void syncNow()}>Sync now</Button>
    </Row>
  </Group>
  ```
- [ ] **Step 3:** Replace the existing "Delete all data & restart setup" `<button>` with:
  ```tsx
  <button onClick={() => void onDeleteAll()} className="w-full rounded-2xl px-3 py-3 text-left text-sm font-medium text-destructive hover:bg-destructive/10">Delete all my data (phone and account)</button>
  ```
  The old direct `localStorage.removeItem` calls go away; `syncPort.reset()` now owns that.
- [ ] **Step 4:** `npm run build`; full suite passes from `C:\`.
- [ ] **Step 5:** Commit: `feat(settings): account, sync status, sign out and full delete`.

---

### Task 9: Docs, Android sync, end-to-end verification

**Files:** Modify `CLAUDE.md`, `roadmap.md`.

- [ ] **Step 1:** Add to `CLAUDE.md` under "Data and state":
  ```markdown
  - Sync (`src/lib/sync/`) sits under the store: `syncPort` in `store.ts` is its only door. Every `set()` commit is diffed by object identity into an outbox, so store updates must stay immutable (spread/map; never mutate an item in place) or changes silently stop syncing.
  - Supabase holds one `records` table (`collection`, `id`, `data jsonb`, tombstone `deleted`). A new `FinanceState` collection needs adding to `COLLECTIONS` in `src/lib/sync/diff.ts` **and** the `check` list via a new migration.
  - `prefs.lock` never syncs (device-bound credential and PIN).
  - Auth: `src/lib/auth/`; app-wide session + engine lifecycle: `src/lib/sync/runtime.ts` (`useAppSession`, `useSyncInfo`). Env: `.env.local` from `.env.example`.
  ```
- [ ] **Step 2:** In `roadmap.md` tick `Phase 2: real sign-in and cloud saving` and change it to `(Supabase, Google sign-in, offline-first sync)`.
- [ ] **Step 3: Web E2E** (`npm run dev`, http://localhost:8080):
  1. Fresh browser profile → onboarding shows **Continue with Google** only; visiting `/home` bounces to `/`.
  2. Sign in → lands back on `/` → choose sample data → finish → Home shows data.
  3. Supabase Table Editor → `records` has rows for your user; `prefs` row has `onboarded: true` and no `lock`.
  4. Add a transaction → within ~2 s a new `transactions` row appears.
  5. DevTools → Network → Offline → add 2 transactions → Settings shows "2 changes waiting to upload" → back Online → shows "Synced", rows present.
  6. Second browser profile, same Google account → lands on Home with the same data (no onboarding). Edit there → reload first profile (or refocus tab) → edit visible.
  7. Settings → Sign out → back at sign-in; `localStorage` has no `extrack:outbox:v1` / `extrack:owner:v1`.
  8. Settings → Delete all my data → onboarding; other profile on refocus also returns to onboarding.
- [ ] **Step 4: Android E2E:** `npm run build`, `npx cap sync android`, `cd android; .\gradlew.bat assembleDebug`, install `android/app/build/outputs/apk/debug/app-debug.apk`. Tap **Continue with Google** → Chrome Custom Tab → pick account → app reopens signed in. Airplane mode → add transaction → disable airplane mode → reopen app → row appears in Supabase.
- [ ] **Step 5:** Full suite from `C:\` passes; `npm run lint` clean for touched files.
- [ ] **Step 6:** Commit `CLAUDE.md`, `roadmap.md`, and `android/` files changed by `cap sync`: `docs: document sync architecture; tick Phase 2 sign-in`.

## Verification summary

- Unit: `src/lib/sync/*.test.ts` (diff, outbox, merge, engine with fake remote: upload-on-first-sign-in, cloud-wins, two-device propagation, deletes, offline queue, pending-wins, wipe), `store-sync.test.ts`, `callback-url.test.ts`, routing test for `/auth/callback`. Run from `C:\`.
- Database: RLS on, `select`/`insert`/`update` policies scoped by `(select auth.uid()) = user_id`; advisors clean.
- Manual: web steps 1–8 and Android Google round-trip + offline queue (Task 9).
