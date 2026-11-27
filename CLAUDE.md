@AGENTS.md

# ExTrack

Phone-first personal finance app for India: ₹ with Indian grouping (₹1,23,456), Asia/Kolkata. Scaffolded in Lovable, now developed in Antigravity (TanStack Start + React 19 + Tailwind 4 + `motion`), wrapped for Android with Capacitor. Data lives on the device (`localStorage`) and syncs to Supabase after Google sign-in, which the app requires; the plan is `docs/superpowers/plans/2026-11-25-supabase-sync.md`, older design history in `.lovable/plan/`.

## Data and state
- State shape is `FinanceState` in `src/lib/finance/types.ts`; persisted under `extrack:v1` (falls back to legacy `rupeeflow:v1`).
- Adding a field to `Prefs` or `FinanceState`: give it a default in `demo.ts` (`DEFAULT_PREFS` etc.) **and** backfill it in `migrate()` in `store.ts`, or existing installs load `undefined`.
- Demo data is marked `isDemo: true` and the UI shows a "Sample data" badge (`DemoBadge`). Keep demo vs real clearly separated.

## Sync and sign-in
- Sync (`src/lib/sync/`) sits under the store; `syncPort` in `store.ts` is its only door. Every commit is diffed by object identity into an outbox, so store updates stay immutable (spread/map, a new object per changed item) or the change silently never syncs.
- Supabase holds one `records` table (`collection`, `id`, `data jsonb`, tombstone `deleted`). A new `FinanceState` collection goes in `COLLECTIONS` (`src/lib/sync/diff.ts`) **and** the `check` list of a new migration in `supabase/migrations/`.
- `prefs.lock` stays on the device (its credential and PIN hash are bound to this phone); `syncedPrefs` strips it.
- `src/lib/sync/runtime.ts` owns the session and engine lifecycle. Screens read `useAppSession` / `useSyncInfo` and show the app only when `auth === "signedIn"` and `sync === "ready"`. An explicit sign-out is this phone only (`scope: "local"`) and clears local data; a session that ends on its own keeps unsynced edits for the same user.
- Env: copy `.env.example` to `.env.local`. Only the publishable key belongs in the app, never the secret key.

## Auto-tracking (Android)
- `android/.../SmsReaderPlugin.java` reads the SMS inbox (READ_SMS) and `BankNotificationListener.java` queues money alerts from SMS, bank and UPI apps (`AlertFilter.java` lists them). JS reaches them through `src/lib/sms/native.ts`.
- All judgement is in `src/lib/sms/plan.ts` (pure, tested): bank sender check, `sms-parse.ts`, `categorize`, account by last four digits, duplicates by reference or amount within 15 minutes. `runtime.ts` saves through `actions` so imports sync.
- Message text never leaves the phone; unreadable bank messages are listed on the phone only. The inbox cursor `extrack:sms:v1` is per account and never synced.
- `READ_SMS` blocks Play Store review unless Google approves the app; a Play build drops it and keeps notification access.

## Releases and live updates
- The APK carries its own copy of the web app, so a push alone changes nothing on phones. On every push to `main`, `.github/workflows/ota.yml` tests, then `scripts/package-ota.mjs` zips the build as version `<major>.<minor>.<run number>` and the workflow publishes it as a GitHub Release `ota-<version>` (zip plus `manifest.json`) with its own `GITHUB_TOKEN`; no secret is involved. `src/lib/updates/ota.ts` (Capgo updater, started in `__root.tsx`) reads `releases/latest/download/manifest.json` through `CapacitorHttp` (GitHub's download redirect sends no CORS headers, so `fetch` can't), downloads in the background and switches on the next restart. Only the 5 newest `ota-*` releases are kept.
- The bundle's `minNativeVersion` is the APK's `versionName` in `android/app/build.gradle`. Bump `versionName` whenever native code or a Capacitor plugin changes, and build a new APK; older APKs then skip bundles they can't run.
- Pull requests run the same workflow's type-check and tests only.
- Web: Vercel builds from `main` with `vercel.json` (`NITRO_PRESET=vercel`). Add the Vercel domain to the Supabase Auth redirect URLs or Google sign-in fails there.

## Feature switches
`prefs.features` (splits, cashback, bills, cards, lock, autoTracking) plus `prefs.aiEnabled` hide a feature everywhere. A new switchable feature must be gated in every surface:
- desktop sidebar `side` list and `MORE_PATHS` in `src/routes/_shell.tsx`
- tiles in `src/routes/_shell.more.tsx`
- the `off` map for Home widgets in `src/routes/_shell.home.tsx`
- fields in `src/components/app/tx-sheet.tsx`
- the toggle in `src/routes/_shell.features.tsx`

## Money in the UI
- Render amounts with `Amount` / `Ticker` (`src/components/app/bits.tsx`) or `formatINR(..., { hidden })` so the hide-amounts toggle works everywhere.
- Income/expense colour is always paired with a sign or icon (colour is never the only signal).
- Use the `tnum` utility on numbers so digits keep their width while a value counts up.

## Motion
- Library is `motion` (`motion/react`), with spring physics for interaction and `ease: [0.16, 1, 0.3, 1]` for entrances.
- `__root.tsx` wraps the app in `<MotionConfig reducedMotion="user">`; `styles.css` cuts CSS keyframes under `prefers-reduced-motion`. Anything that animates a *value* imperatively (`animate()`, motion values, SVG path drawing) must also check `useReducedMotion()` and jump to the final value, as `Ticker` and `SpendRing` do.
- Shared layout pills use `layoutId` (`tab-pill`, `side-pill`); keep those ids unique per nav.

## Design tokens
"Peacock and Marigold" palette in `src/styles.css`: peacock = primary, marigold = highlights/goals, `text-income` / `text-expense` for flows. `font-display` (Bricolage Grotesque) for headings and big amounts. Utilities: `bg-peacock`, `bg-feather`, `shadow-soft|lift|fab`, `shimmer`, `input-base`.

## Build and tooling
- `vite.config.ts` gets its plugins from `@lovable.dev/vite-tanstack-config`; adding TanStack, React, Tailwind or Nitro plugins by hand duplicates them and breaks the build.
- `src/routeTree.gen.ts` is generated by the router plugin.
- Android: `capacitor.config.json` serves `.output/public`, so run `npm run build` before `npx cap sync android`.
- Run tests from an uppercase-drive path (`Set-Location C:\Users\...` in PowerShell). From a lowercase `c:\` working directory (VS Code's terminal default here) vitest loads two copies of its runner and every file fails with `reading 'config'` before any test runs.
