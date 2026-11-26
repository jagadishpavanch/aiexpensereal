> [!IMPORTANT]
> Don't rewrite pushed git history (force-push, or rebase/amend/squash pushed
> commits), and keep every pushed commit building and passing tests. The project
> was scaffolded in Lovable but is now developed in Antigravity; nothing syncs to
> Lovable.

## Architecture rules
- Finance logic lives in `src/lib/finance/` (pure functions, unit-tested); screens never compute money totals inline. Why: one source of truth for calculations.
- Data access goes through `src/lib/finance/store.ts` (`useFinance` + `actions`); select stable references only, never filtered arrays inside the selector. Why: storage can be swapped for the cloud later, and new arrays cause render loops.
- App screens live under the pathless `_shell` layout (nav + add-transaction sheet); onboarding is `/`. Why: onboarding has no navigation.
