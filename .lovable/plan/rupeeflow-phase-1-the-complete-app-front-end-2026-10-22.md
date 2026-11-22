# RupeeFlow: Phase 1, the complete app front end

## Goal
Build every RupeeFlow screen from the brief as a polished, animated, phone-first app that you can click through. It runs on clearly labelled demo data stored on the device. Phase 2 adds accounts, cloud saving and the OpenAI assistant. The screens will be built so the data source can be swapped later without redesigning them.

## Approaches considered
- **Front end first with local demo data (chosen):** you see and feel the whole product quickly. Saving to the cloud comes later.
- Thin slice with a real backend: real saving from day one, but only a few screens at first.
- Everything at once: slow, and design problems show up late.

## Screens
1. **Onboarding:** welcome, how tracking works, a choice between demo mode and signing in (the sign-in screen is a placeholder for now), privacy, an optional AI step, choosing dashboard widgets, and an optional first budget. You can skip any step.
2. **Home:** greeting, current period, search, a button to hide amounts, and alerts. Below that: a balance and cash-flow summary with counting-up numbers, a spending ring, recent transactions, budget progress, and an Add button.
3. **Customize dashboard:** turn widgets on or off, drag to reorder, change widget size, and reset to the default layout.
4. **Activity:** a list grouped by day, with search, filters (type, category, account, source, date range) and swipe actions. Add and Edit open in a bottom sheet with validated forms. Deleting can be undone.
5. **Insights:** spending by category, trends, income vs expense, budget vs actual, a spending calendar heatmap, top merchants, savings goals, recurring payments, cash flow, and unusual spending changes. Charts are interactive and animate in.
6. **Budgets:** monthly category budgets, savings goals with progress, and recurring expenses.
7. **AI:** chat screen with suggestion chips, sample replies, a microphone button with a listening animation, and transaction confirmation cards. It is clearly marked "Connect OpenAI to enable", and it can be hidden in Settings.
8. **Settings:** profile, light/dark/system theme, accent colour, currency and time zone, categories, accounts, merchant rules, CSV import and export, notifications, the SMS setup screen (honest about needing a future Android app, with demo SMS examples), privacy, and resetting demo data.

## Design direction
- My own palette, "Peacock and Marigold":
  - Mist background #F1F4EF and deep peacock ink #0E2B30 for text.
  - Peacock #0E7C86 is the main colour.
  - Marigold #F2A93B is for highlights and goals.
  - Mint #BDE7C8 is for money coming in. A soft coral #E05A4C is for money going out, always shown with an icon or sign as well as the colour.
  - Dark mode uses deep peacock-night surfaces (#08191C) with glowing peacock and marigold accents.
  - You can still change the accent colour in Settings.
- Fonts: Bricolage Grotesque for big rupee amounts and headings, with lining figures that keep their width. Geist is used for everything else.
- The signature moment: the Home balance counts up while the spending ring draws itself segment by segment, and category chips settle underneath. The Home header has a subtle peacock-feather curve.
- Phone layout has a floating bottom tab bar with a sliding highlight under the active tab, plus a raised Add button. Larger screens get a side bar and a two-column layout.
- Rich motion throughout:
  - Shared-element page transitions.
  - Spring bottom sheets.
  - Swipe-to-delete with elastic resistance.
  - Number tickers.
  - Charts that animate in and morph when filters change.
  - Dashboard widgets that drag with lift and shadow.
  - Budget bars that fill with a liquid motion.
  - Confetti when a goal is reached.
  - Skeleton shimmer while loading.
  - Small taps and presses get a slight scale response.
- Reduced-motion settings are respected.
- Amounts use Indian formatting (₹1,23,456) and the Asia/Kolkata time zone.

## Technical details
- TanStack routes: `/` for onboarding or redirect, plus `/home`, `/activity`, `/insights`, `/budgets`, `/ai`, `/settings` and its sub-routes. They share an app shell.
- Domain layer in `src/lib/finance/`: types, INR formatting, calculations (totals, budgets, trends, anomalies), dedupe, and CSV parse/export. Unit tests cover the money calculations.
- A repository interface with a localStorage implementation, behind TanStack Query hooks. It gets swapped for Lovable Cloud in Phase 2.
- Libraries: recharts, framer-motion (motion), react-hook-form, zod, @dnd-kit, shadcn ui and lucide.
- Demo data generator: 90 days of realistic Indian transactions (UPI, Swiggy, rent, salary), each marked as demo.

## Out of scope for this phase (Phase 2)
Real sign-in, cloud saving, OpenAI chat and voice (your own key), and reminders sent to you outside the app.
