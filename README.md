# Gmail × Jev: importance sort

A pixel-faithful Gmail clone that mirrors your 100 most recent Inbox threads (read-only). **Analyze** sorts them by importance with Jev.

How the sort works:
1. **Triage.** Every email gets a tier from Jev (critical/high/medium/low/noise). All 100 calls run in parallel, about 0.5s total. This seeds the next step.
2. **Swiss tournament.** About 9 rounds. Each round pairs neighbours in the current standings with no rematches, and all 50 pairwise Jev decisions run at once. Each result is soft: Jev returns P(A matters more). A/B order is randomized so position bias averages out.
3. **Top-12 round robin.** Nails down the head of the list.
4. **Bradley–Terry fit.** Runs over every game and gives the final order.

A full run is about 600 Jev decisions in about 3–4s, costing about $0.03.

**Safety:** the refresh token is downscoped to `gmail.readonly` at refresh time, and the server refuses any other scope. Only GET requests are made. Clicking archive, star, etc. in the UI does nothing.

```bash
bun run server.ts   # http://localhost:8383
```
`.env`: `TYPESAFE_API_KEY`, `GOOGLE_TOKEN_FILE` (an authorized-user JSON for the account). `data/inbox.json` caches the fetch. The refresh button refetches live.

## Chrome extension (extension/)

Sort your real Gmail (last 24 hours) in place. A **⚡ Sort ▾** split button is injected into Gmail's toolbar.
The ▾ opens "Sort by…": type any sentence ("which require investor attention") or pick a preset, plus Auto/Pivot/Swiss.
Gmail's own rows are reordered (FLIP animation) with rank + tier chips, and a live Jev panel shows the tournament.

No Google sign-in in the extension: its service worker talks to this server on localhost:8383, which holds the
read-only (gmail.readonly) token and the Jev key. Row ids match because Gmail renders `data-legacy-thread-id` = API thread id.

1. `bun run server.ts`
2. chrome://extensions → Developer mode → Load unpacked → pick `extension/`
3. Open Gmail inbox → ⚡ Sort

Logic test without Gmail: http://localhost:8383/ext-test.html (Gmail-DOM mock + chrome.runtime shim).

Algorithms: `auto` = every pair at once when n(n-1)/2 ≤ 250 (one wave, complete information), else pivot sort.
Jev is throughput-bound: ≤256 in flight → p50 ~200ms; 1200 in flight → p50 11s. Slow calls are hedged after 3×p50.
