# RupeeFlow: new money features, navigation redesign, and the Android tracking setup

## What you will get

### 1. Navigation redesign
- The bottom bar shows 5 tabs in one row: Home, Activity, Insights, Budgets, More. "More" holds AI and Settings, plus the new features.
- The + button moves out of the bar. It floats at the bottom right, just above the bar, and is round with a soft glow.
- When a sheet is open, the + button hides. When you scroll down it shrinks a little, and it comes back when you scroll up.
- Larger screens keep the side bar.

### 2. Cards and accounts
- New Accounts screen where you can add a bank account, debit card, credit card, UPI ID, wallet or cash.
- Each card looks like a real card with a peacock or marigold finish and shows only the last 4 digits.
- Credit cards show the limit, how much you have used, the statement date and the due date.
- Each account shows its balance and the transactions linked to it.

### 3. Bill reminders
- Add bills such as rent, electricity, mobile, card dues and subscriptions. Each bill has an amount, a due date and how often it repeats.
- Home shows "Due soon" cards. You can mark a bill as paid, which also records the expense.
- Reminders appear inside the app. Phone notifications come later with the Android app.

### 4. Tap a calendar date to add
- The calendar shows each day's spending and dots for bills that are due.
- Tapping a day opens a sheet that asks "What do you want to add?" with three choices: Expense, Income, or Bill / reminder. The date is already filled in.

### 5. Cashback total
- Mark any income as cashback, with its source (Google Pay, PhonePe, Paytm, a card, and others).
- A cashback widget shows the total for the month and for the year, broken down by app, with a small chart.

### 6. Budget limits
- Overall monthly limit plus a limit for each category, with warnings at 80% and 100%.
- Warnings appear on Home and in the Add sheet before you go over.

### 7. Split with people
- Save people with a group tag: Friend, Partner, Family, Roommate or Other.
- When adding an expense, you can turn on "Split". Pick the people, then split equally, by exact amounts, by percentage, or by shares.
- A Splits screen shows who owes you and whom you owe, with a running total per person. You can settle up, and share a WhatsApp-style text with the amount.

### 8. Feature switches
- In Settings, under "Features", each of these can be turned on or off: AI, Splits, Cashback, Bills, Cards, App lock and Auto-tracking.
- Switched-off features disappear from the tabs, Home widgets and the Add sheet.

### 9. App lock with fingerprint
- Optional lock that uses the phone's fingerprint or face unlock, through the browser's passkey support, with a PIN as a backup.
- The lock screen appears when the app opens and after a chosen idle time.
- This works on Android Chrome and most modern phones. Older browsers fall back to the PIN.

### 10. Auto-tracking setup (Android app, shown honestly)
- New "Auto-tracking" screen that explains: "The upcoming Android app will read only bank and UPI alerts on your phone, after you allow it."
- The setup has two steps:
  1. Import your past bank SMS once.
  2. Turn on notification access so new alerts are tracked from then on.
- It shows the system's own permission warning word for word (it can read all notifications, which may include personal data) and explains plainly what RupeeFlow keeps: only transaction and due-bill alerts, read on the phone.
- A live demo turns sample bank and UPI messages into transactions and due bills, so you can see detection working.
- It is clearly marked "Available in the Android app". A website cannot read SMS or notifications.

### 11. Look and feel
- The new screens keep the Peacock and Marigold style.
- Motion includes cards that flip in, a ring that fills for bill countdowns, split avatars that stack, and a cashback counter that ticks up.

## Order of work
1. Navigation redesign and the More screen.
2. Feature switches, then accounts and cards.
3. Bills and the calendar Add sheet.
4. Cashback and budget limits.
5. Splits.
6. App lock.
7. Auto-tracking setup screen.
8. Demo data for all of the above, then tests.

Sign-in and cloud saving, and the built-in OpenAI assistant (using your key, kept on the server), stay as the next phase. That phase starts after this one.

## Technical details
- Extend `types.ts` with Account fields (cardType, last4, limit, statementDay, dueDay, balance), Bill, Person, Split (mode, shares), a cashback flag and source on Transaction, overall budget, and a `features` record in Prefs.
- Pure functions go in `src/lib/finance/`: `splits.ts` (equal, exact, percent and share splits, rounding to the paisa, per-person net balances), `bills.ts` (next due date, overdue, recurrence), `cashback.ts`, and `sms-parse.ts` (regex parser for Indian bank and UPI alerts covering amount, debit or credit, merchant, account last 4, due date). Each gets unit tests.
- `store.ts` gets new actions. The selector rules stay the same.
- New routes under `_shell`: `more`, `accounts`, `bills`, `splits`, `settings.features`, `settings.lock`, `settings.auto-tracking`. The calendar sheet reuses the transaction sheet with a preset date and type.
- App lock uses WebAuthn (`navigator.credentials.create/get`, platform authenticator, userVerification required) and stores the credential ID locally, with a hashed PIN fallback. The `LockGate` sits in the shell.
- The floating action button is fixed at bottom-right, above the nav, with a safe-area inset.
