# Cloud handoff: work plan until 01:40 IST, 26 Nov 2026

Written for: the cloud Claude agent continuing ExTrack work while the owner's laptop is closed.

## Where things stand

- Branch `feat/supabase-sync` (pushed to `origin`). Base: `feat/reduced-motion` (55c4ded).
- Read first: `AGENTS.md`, `CLAUDE.md`, and the plan `docs/superpowers/plans/2026-11-25-supabase-sync.md`.
- Done and reviewed: plan Tasks 1, 3, 4, 5 (sync core, store `syncPort`, sync engine + `supabaseRemote`). Engine went through 2 fix rounds. The approved changes beyond the plan: generation guard so no stale sync survives `forget`/`wipeAll`/`stop`; `wiping` flag; keyset paging via `pullPages`; `SyncInfo.lastError` + retry backoff `min(60s, 2s·2^n)`; `SyncPort.reset({ keepLock })` with first-sign-in keeping the phone's app lock.
- Not possible from the cloud: plan Task 0 (Google Cloud + Supabase dashboard), `supabase login/link/db push`, real sign-in E2E, Android APK build. The owner has given only the publishable key; the project URL is still unknown. Leave those steps for the owner and list them in STATUS.

## Hard rules

- **Stop by 01:40 IST (20:10 UTC, 25 Nov).** Check `date -u` before starting each item. Never start an item you can't finish, test and commit before then.
- Work only on `feat/supabase-sync`. Never touch `main` or `feat/reduced-motion`. Never force-push, amend, rebase or squash pushed commits (the repo syncs to Lovable).
- After each finished item: `npm test` green, `npx tsc --noEmit -p .` 0 errors, `npm run build` succeeds, then commit and `git push origin feat/supabase-sync`. Every pushed commit must build.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Follow AGENTS.md: finance logic as pure, unit-tested functions in `src/lib/finance/`; data access only via `store.ts` (`useFinance` + `actions`); select stable references only; app screens under `_shell`.
- TDD for all logic. Test output must be clean.
- No secrets in the repo. `.env.local` is gitignored; only `.env.example` (empty values) is committed.
- Motion: use `motion/react`. Every new animation must respect reduced motion: `MotionConfig reducedMotion="user"` already covers transforms; anything that animates values imperatively must check `useReducedMotion()` and jump to the final state.
- No new heavy dependencies. Small, well-known ones only if clearly needed.

## Work order (highest value first)

### A. Production rule-based transaction categorization (do first)

Goal: every transaction from manual entry, CSV import, AI preview or bank/UPI SMS gets the right category reliably, fully on-device, explainable, and it learns from corrections.

1. `src/lib/finance/categorize.ts` (pure) + `categorize.test.ts`:
   - `normalizeMerchant(raw: string): string`: lowercase; drop UPI VPA handles (`@okaxis`, `@ybl`, `@paytm`, `@oksbi`, `@okhdfcbank`, `@axl`, `@ibl`…), reference numbers, long digit runs, `pvt ltd`/`private limited`/`ltd`/`llp`/`india`, punctuation; collapse spaces. Map known legal names to brands (`bundl technologies` → swiggy, `zomato` variants, `ani technologies` → ola, `uber india systems` → uber, `grofers`/`blink commerce` → blinkit, `kiranakart` → zepto, `supermarket grocery supplies` → bigbasket, `one97` → paytm, `phonepe`…).
   - `categorize(input: { merchant: string; text?: string; type: TxType }, rules: MerchantRule[], categories: Category[]): { categoryId: string; source: "rule" | "merchant" | "keyword" | "fallback"; matched?: string }`.
   - Precedence: (1) the user's `MerchantRule`s, case-insensitive, longest `match` wins; (2) a built-in brand dictionary of common Indian merchants → category ids (food: swiggy, zomato, dominos, mcdonalds, kfc, starbucks, chai point…; groceries: bigbasket, blinkit, zepto, instamart, dmart, jiomart, more, reliance fresh…; transport: uber, ola, rapido, irctc, redbus, metro, fastag, hpcl/iocl/bpcl/indian oil/shell…; bills: airtel, jio, vi, bsnl, bescom, tneb, msedcl, tata power, act fibernet, tata play, gas…; rent: nobroker, rent; shopping: amazon, flipkart, myntra, ajio, meesho, nykaa, croma…; entertainment: netflix, spotify, hotstar, prime video, bookmyshow, pvr, inox…; health: apollo, 1mg, pharmeasy, netmeds, practo, hospital…); (3) word-boundary keyword rules over merchant + text (restaurant/cafe/dhaba/biryani → food; petrol/fuel → transport; electricity/broadband/recharge/dth → bills; pharmacy/medical/clinic → health…); income: salary/sal cr/payroll → salary, upwork/fiverr/invoice/freelance → freelance; (4) fallback: first existing category of the right kind (`other` for expenses, first income category for income).
   - Only ever return ids that exist in `categories` with the right `kind`. Unknown or deleted ids skip to the next level.
   - Tests: ≥30 cases covering each level, precedence, VPA/legal-name normalization, word boundaries (`"olacabs"` yes, `"cola"` not transport), missing categories, income vs expense.
2. Harden `src/lib/finance/sms-parse.ts` with a corpus test (`sms-corpus.test.ts`, ≥25 realistic messages in the formats HDFC, ICICI, SBI, Axis, Kotak, Paytm Payments Bank, GPay/PhonePe UPI, credit-card spend, card bill due, EMI due, salary credit, refund, ATM withdrawal):
   - The transaction amount must win over `Avl Bal`/`available limit`/`balance` amounts that appear in the same SMS.
   - OTPs, promotional/offer texts ("get Rs 500 cashback", "win", "offer", "click"), and balance-only messages must not count as finance alerts (`isFinanceAlert` false).
   - Keep the existing tests green.
3. Wire it in through the store (only `store.ts` touches data):
   - `actions.categorize(merchant, opts?)` keeps its call sites working but delegates to `categorize()` with the current rules and categories. Update the 4 call sites (`tx-sheet.tsx:109`, `_shell.auto-tracking.tsx:45`, `_shell.settings.tsx:60`, AI preview in `_shell.ai.tsx`) to use the result's `categoryId`, passing `text`/`type` where available.
   - **Learning:** when the user changes the category of a saved transaction in the sheet, upsert a `MerchantRule` for its normalized merchant (`actions.learnCategory(merchant, categoryId)`, which replaces an existing rule for the same match). Show a toast: "Future <merchant> payments go to <category>". Rules already sync via the `rules` collection.
   - In the add sheet, show a small "Auto: <category> · <why>" hint under the category picker when the category came from the engine. Animate it in.

### B. Plan Tasks 2, 6, 7, 8, 9 (code only)

Follow `docs/superpowers/plans/2026-11-25-supabase-sync.md` exactly, with these cloud adjustments:
- Task 2: create the migration with `npx supabase init` and `npx supabase migration new records`. Do **not** run login/link/db push.
- Tasks 6–8: as written. The app must show the "Sign-in isn't set up yet…" splash when env vars are missing, never crash. `npx cap sync android` only if it works headless; otherwise note it in STATUS.
- Task 9: do the docs part. List the web/Android E2E checks as owner TODOs in STATUS.
- Also fix these review leftovers in `src/lib/sync/engine.ts` (all small, test-first): `wipeAll` should wait `while (running)` instead of `if (running)`; concurrent `wipeAll` calls should share one promise; when the generation changed during a wipe, skip `saveOutbox()`; `applyRemote` should skip `replace` when `applyRows` returns the same object (add that check in `store.ts` `syncPort.applyRemote`); `merge.ts` `applyRows` should skip rows whose collection is unknown instead of throwing.

### C. UI/UX motion polish (only after A and B are pushed)

Do as many as fit, one commit each, highest first:
1. Home balance card collapses into a compact sticky header on scroll (`useScroll` + `useTransform`; static under reduced motion).
2. Rolling-digit balance: digits roll from the previous value (not from ₹0 on every mount) in a new `RollingAmount` in `bits.tsx`. Honours `hideAmounts` and reduced motion.
3. Budget bars: overshoot spring; at ≥100% turn `bg-expense` with one short shake when the state changes. Near (80%) gets a soft pulse.
4. Goal reached: lightweight confetti burst (DOM/CSS particles, no new dependency) when `contributeGoal` completes a goal; static check under reduced motion.
5. Newly added transaction animates into Recent/Activity lists (`AnimatePresence` + `layout`), with a brief highlight.
6. Insights charts re-key on month change so they morph instead of jumping.

### D. Finish (by 01:40 IST)

- Self-review the whole branch diff against the plan and AGENTS.md. Fix anything Important.
- Write `docs/superpowers/STATUS-2026-11-26.md`: what was done (commits), what's left, and the owner's TODO list:
  - Task 0: Google OAuth client + Supabase Google provider + redirect URLs `http://localhost:8080/auth/callback`, `https://<web-domain>/auth/callback`, `com.extrack.app://auth/callback`.
  - Put the project URL into `.env.local` (the publishable key is already there on the laptop) and into Lovable's env settings.
  - `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
  - Web and Android E2E checks from plan Task 9.
- Commit and push. Do not merge or open a PR.
