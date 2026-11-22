<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Finance logic lives in `src/lib/finance/` (pure functions, unit-tested); screens never compute money totals inline. Why: one source of truth for calculations.
- Data access goes through `src/lib/finance/store.ts` (`useFinance` + `actions`); select stable references only, never filtered arrays inside the selector. Why: storage can be swapped for the cloud later, and new arrays cause render loops.
- App screens live under the pathless `_shell` layout (nav + add-transaction sheet); onboarding is `/`. Why: onboarding has no navigation.
