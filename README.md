# Home Budget

A shared household budget that works the YNAB way: every dollar gets a job, category balances roll over, and overspending is handled at the end of each month. It's a progressive web app hosted on GitHub Pages, with sync through Firebase, and it's built on the same pattern as Home Duties.

This repo holds code only. Budget data lives in a private Firebase project, protected by its database rules. No real figures, exports or emails belong here.

- **Set up:** see [SETUP.md](SETUP.md). Add `?local` to the address to try it on one phone without Firebase.
- **Releases:** bump `VERSION` in `sw.js`. Phones show "An update is ready" and switch over when someone taps Reload.
- **Tests:** `node tests/engine.test.mjs` (budget maths), `node tests/search.test.mjs` (search terms and dates), `node tests/upsync.test.mjs` and `node tests/sync-job.test.mjs` (Up sync), then `node tests/app.test.cjs` (needs Playwright and Chrome; runs two tabs on made-up data). Use `node tests/verify-ynab.mjs <export.json>` to check the maths against a real YNAB export kept outside the repo.

## How it's organised

| File | What it does |
|---|---|
| `js/engine.js` | The budget maths: Ready to Assign, rollover, overspending, credit cards, targets, matching, reports. No screen and no database. |
| `js/ynab.js` | Turns a YNAB API full export into the app's data. |
| `js/search.js` | YNAB-style search terms and part-typed Australian dates. |
| `js/store.js` | Live data and every change: transactions, transfers, splits, assigning, reconciling, the activity log, imports. |
| `js/backend.js` | The only file that talks to Firebase. `backend-local.js` is the same thing kept in one browser. |
| `js/upsync.js` | Turns Up records from the sync inbox into transactions: held and settled, matching, transfers, round-ups, who spent. |
| `sync/` | The Up sync job for the private repository, and its setup steps. |
| `js/setup.js` | Starting options (import, fresh start, categories only), fresh start later with archives, complete reset, accounts and categories. |
| `js/views.js`, `sheets.js`, `pages.js`, `main.js` | Screens, slide-up sheets, settings, and wiring. |

Completed months are stored as one record each, holding their transactions as a single block of text: Firebase indexes every value in a map, and a month's worth exceeds what one write may change. The current and previous month are stored as separate transactions, so a new phone loads about 80 records rather than 10,000 or more. Edits change only the field concerned, so two phones editing different transactions don't overwrite each other.

## Matching YNAB

Checked against a real YNAB API export covering 78 months. Every category in every month, every account balance and today's Ready to Assign match YNAB to the cent. The one exception is November 2020, where Ready to Assign is $116.44 below YNAB's for that single month. December 2020 and every month after match again.

YNAB rules the engine follows that aren't obvious:
- Cash overspending resets the category to zero next month and comes out of Ready to Assign. Credit card overspending becomes card debt instead.
- Card spending a category can cover moves to that card's payment category. Paying the card from a bank account uses that money.
- A cash advance (a transfer from a card to a bank account) lands in Ready to Assign.
- Lines categorised Ready to Assign on a card, such as interest or small rewards, only change the debt.
- A card paying another card only moves debt between them.
