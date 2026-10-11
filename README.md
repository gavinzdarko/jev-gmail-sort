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

## On-demand spelling in Gmail drafts

This is an addition to the same extension and localhost server. The sorting UI, ranking engine and read-only Gmail API flow are retained. Run `bun install` after updating, restart the server, reload the extension at `chrome://extensions`, and refresh Gmail. No new extension permissions, API provider, or API key are needed.

Focus a Gmail compose or reply body and press **Option-Shift-S** on macOS (**Alt-Shift-S** elsewhere), or click **✦ Spell check** above that draft. The tool checks only when asked. An optional **Writing purpose** field can specify context such as “email to my professor”; the current subject, recipient names, and that draft's quoted conversation also guide decisions. Unrelated open conversations are excluded.

Local Hunspell candidates (`nspell` + `dictionary-en`) propose spellings. One request to the existing Jev endpoint asks it to keep or correct each candidate in context. This covers English spelling, capitalization, common contractions and word confusions such as your/you're. **Jev selects supplied options; it does not generate unrestricted rewrites or perform a general grammar rewrite.** There is no separate LLM or Exa call. At most 24 suspect spans are assessed per shortcut in drafts up to 12,000 characters; run again if further mistakes remain. Latency depends on local candidate generation and the Jev round trip, and is not guaranteed to be instantaneous.

Only confident choices (confidence ≥0.8 and selected probability ≥0.9) apply. Names, slang and uncertain words can stay unchanged. Corrections replace individual words using the browser's native editing command, preserving surrounding formatting. Links, code, noneditable chips, signatures and quoted replies are not edited. If the draft, writing context, or focused editor changes while checking, the response does not overwrite the newer text. Gmail's normal Undo works for applied corrections; it may take more than one undo step for several words.

**Draft edits are real edits:** Gmail may autosave them. Spell check never clicks Send or uses a Gmail write API. The original `gmail.readonly` token remains unchanged. Draft text and bounded context go to Jev only after the explicit button or shortcut; credential patterns, email addresses, URLs and inline code are masked before the provider request. Drafts and provider response bodies are not logged or cached. The new route is JSON-only and rejects unrelated web origins; the local server binds to loopback.

Validation:

```bash
bun test
# Browser regression fixture, with invented drafts and mocked Jev decisions:
# http://localhost:8383/spellcheck-test.html
```

Tests cover candidate quality (including multiple transpositions), context and UTF-16 offsets, confidence gates, protected data, malformed responses, and request limits. The browser fixture exercises real rich-text edits and Undo, draft changes during requests, focus/context changes, protected formatting, and the existing Sort toolbar. It does not claim live model accuracy or production Gmail DOM coverage. Official API shape: [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice).

Algorithms: `auto` = every pair at once when n(n-1)/2 ≤ 250 (one wave, complete information), else pivot sort.
Jev is throughput-bound: ≤256 in flight → p50 ~200ms; 1200 in flight → p50 11s. Slow calls are hedged after 3×p50.
