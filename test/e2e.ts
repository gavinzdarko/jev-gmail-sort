// End-to-end test of the real unpacked extension in headless Chromium. mail.google.com is served by a
// Gmail-DOM mock built from real thread ids (data/inbox.json), so the background really reads those
// threads from the Gmail API and really ranks them with Jev. The mock's Delete button only removes
// rows from the page; nothing is ever sent to Gmail except GETs.
//   bun run test/e2e.ts ["sentence"] [--headed] [--slow]   (--slow = 4x CPU throttle, a heavy page)
import { chromium } from "playwright";

const Q = process.argv.slice(2).find((a) => !a.startsWith("--")) || "";
const headed = process.argv.includes("--headed");
const slow = process.argv.includes("--slow");
const ext = new URL("../extension", import.meta.url).pathname;
const inbox = await Bun.file("data/inbox.json").json();
const threads = inbox.threads.slice(0, 50);

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const title = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const css = await Bun.file("public/ext-test.html").text().then((t) => t.match(/<style>[\s\S]*?<\/style>/)![0]);
// Gmail's list scrolls inside a div, not the window; the toolbar stays put above it.
const extraCss = `<style>.scroll{height:calc(100vh - 112px);overflow-y:auto}[role=main]{overflow:visible}</style>`;
// Gmail's page is huge; pad the DOM so layout costs are realistic in --slow mode.
const ballast = slow ? `<div style="position:absolute;left:-9999px">${"<div><span>x</span><span>y</span></div>".repeat(20000)}</div>` : "";
const row = (t: any) => `<tr class="zA ${t.unread ? "zE" : "yO"}">
  <td class="oZ-x3"><div role="checkbox" aria-checked="false"></div></td>
  <td class="apU"><span aria-label="${t.starred ? "Starred" : "Not starred"}">${t.starred ? "★" : "☆"}</span></td>
  <td class="yX"><div class="yW"><span email="${esc(t.from.email)}" name="${esc(t.from.name)}">${esc(t.from.name || t.from.email)}</span>${t.messages.length > 1 ? ` <span class="bx0">${t.messages.length}</span>` : ""}</div></td>
  <td class="xY a4W"><div class="xS"><div class="xT"><div class="y6"><span class="bog"><span class="bqe" data-thread-id="#thread-f:${BigInt("0x" + t.id)}" data-legacy-thread-id="${t.id}">${esc(t.subject)}</span></span></div><span class="y2"> - ${esc(t.snippet)}</span></div></div></td>
  <td class="xW"><span title="${title(t.date)}">${new Date(t.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></td></tr>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Inbox - ${esc(inbox.email)} - Gmail</title>${css}${extraCss}</head><body>
<div class="top">Gmail<a aria-label="Google Account: Test Owner (${esc(inbox.email)})"></a></div>
<div role="main"><div gh="mtb"><div class="G-tF" style="display:flex;align-items:center"><span class="ic">☐</span><div class="ic" data-tooltip="Refresh" role="button">↻</div><div class="ic" act="10" data-tooltip="Delete" role="button">🗑</div><div class="ic" data-tooltip="More email options" role="button">⋮</div></div></div>
<div class="scroll"><div class="aKy" style="height:56px;display:flex;align-items:center;padding:0 20px;border-bottom:1px solid #f1f3f4"><span style="font:22px 'Google Sans',Arial;color:#1f1f1f">Inbox</span></div><table class="F"><tbody>${threads.map(row).join("")}</tbody></table></div></div>${ballast}
<script>
document.querySelector("tbody").addEventListener("click", (e) => { const cb = e.target.closest("[role=checkbox]"); if (!cb) return; const on = cb.getAttribute("aria-checked") !== "true"; cb.setAttribute("aria-checked", on); cb.closest("tr").classList.toggle("x7", on); });
// Like Gmail, the mock opens emails by its own list model, by position, so it opens the wrong one once
// rows are moved. The extension has to open the row that was actually clicked.
const model = [...document.querySelectorAll("tr.zA [data-legacy-thread-id]")].map((x) => x.getAttribute("data-legacy-thread-id"));
document.querySelector("tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr"); if (!tr || e.target.closest("[role=checkbox], [aria-label]")) return; location.hash = "#inbox/" + model[[...tr.parentElement.children].indexOf(tr)]; });
// Opening an email hides the list, like Gmail's thread view; going back shows it again.
addEventListener("hashchange", () => (document.querySelector(".scroll").style.display = location.hash.split("/").length > 1 ? "none" : ""));
// Mock Delete: drop the checked rows from the page (like Gmail does), and record what was "trashed".
window.trashed = [];
document.querySelector('[act="10"]').addEventListener("click", () => document.querySelectorAll('tr.zA [role=checkbox][aria-checked="true"]').forEach((cb) => { const tr = cb.closest("tr"); window.trashed.push(tr.querySelector("[data-legacy-thread-id]").getAttribute("data-legacy-thread-id")); tr.remove(); }));
</script></body></html>`;

const ctx = await chromium.launchPersistentContext("", { headless: !headed, channel: "chromium", args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], viewport: { width: 1400, height: 1000 } });
await ctx.route("https://mail.google.com/**", (r) => r.fulfill({ contentType: "text/html", body: html }));
if (!ctx.serviceWorkers().length) await ctx.waitForEvent("serviceworker");
// OpenAI stand-in (the real call needs a funded key): returns sort ideas so the menu can be checked.
let openaiCalls = 0;
ctx.on("request", (r) => r.url().includes("api.openai.com") && !process.argv.includes("--stub-openai") && openaiCalls++);
if (process.argv.includes("--stub-openai")) await ctx.route("https://api.openai.com/**", (r) => {
  openaiCalls++;
  const content = JSON.stringify({ suggestions: [
    { q: "replies from the hackathon organizers", icon: "event" },
    { q: "security findings that need follow-up", icon: "shield" },
    { q: "anything from andreessen horowitz", icon: "money" },
    { q: "college visit logistics", icon: "school" },
    { q: "github activity on my repos", icon: "code" },
  ] });
  return r.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
// Watch the service worker's traffic: Gmail must only ever see GETs.
const gmailCalls: string[] = [];
ctx.on("request", (r) => r.url().includes("gmail.googleapis.com") && gmailCalls.push(r.method()));
const gmailStatus: Record<number, number> = {};
ctx.on("response", (r) => r.url().includes("gmail.googleapis.com") && (gmailStatus[r.status()] = (gmailStatus[r.status()] || 0) + 1));

if (process.argv.includes("--stub-openai")) await ctx.serviceWorkers()[0].evaluate(() => chrome.storage.local.set({ openai: "test-key" }));
if (process.argv.includes("--no-presort")) await ctx.serviceWorkers()[0].evaluate(() => chrome.storage.local.set({ presort: false }));
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
if (slow) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto("https://mail.google.com/mail/u/0/#inbox");
await page.waitForSelector(".jevx-split", { timeout: 10000 });
console.log("button placed:", await page.$eval(".jevx-split", (b) => (b.classList.contains("in-head") ? "next to the Inbox heading" : "in the toolbar")));
console.log("button injected; letting the prefetch (and background sort) run like a user reading their inbox");
await page.waitForTimeout(7000);
const ids = () => page.$$eval("tr.zA [data-legacy-thread-id]", (xs) => xs.map((x) => x.getAttribute("data-legacy-thread-id")));
const before = await ids();

// Start scrolled down, like the user was: sorting should bring the list to the top.
await page.$eval(".scroll", (s) => (s.scrollTop = 900));
// Count main-thread stalls during the sort.
await page.evaluate(() => {
  (window as any).longTasks = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).longTasks.push(Math.round(e.duration)))).observe({ type: "longtask" });
});
if (Q) {
  await page.click(".jevx-caret");
  await page.fill(".jevx-in input", Q);
  await page.press(".jevx-in input", "Enter");
} else await page.click(".jevx-sort");
const t0 = Date.now();
await page.waitForSelector("tr.jevx-status.running, .jevx-split.sorted", { timeout: 5000 });
if (await page.$(".jevx-split.sorted")) console.log(`click -> sorted: ${Date.now() - t0}ms (pre-sorted in the background)`);
const live = await page.evaluate(() => ({
  scrollTop: document.querySelector(".scroll")!.scrollTop,
  statusTop: Math.round(document.querySelector("tr.jevx-status")!.getBoundingClientRect().top),
}));
console.log(`while running: list scrollTop=${live.scrollTop} (want 0), status row at y=${live.statusTop}`);
const timeline: string[] = [];
const poll = setInterval(async () => timeline.push(`${Date.now() - t0}ms ${await page.$eval(".jevx-st .meta", (e) => e.textContent).catch(() => "")}`), 250);
await page.waitForTimeout(900);
await page.screenshot({ path: "data/e2e-live.png" });
await page.waitForSelector(".jevx-split.sorted", { timeout: 60000 });
console.log(`sorted in ${Date.now() - t0}ms`);
clearInterval(poll);
if (process.argv.includes("--timeline")) console.log(timeline.join("\n"));
await page.waitForTimeout(800);

// Scroll mid-list and make sure late re-renders (junk answers) don't move the page.
await page.$eval(".scroll", (s) => (s.scrollTop = 300));
await page.waitForTimeout(700);
const out = await page.evaluate(() => ({
  scrollTop: document.querySelector(".scroll")!.scrollTop,
  status: document.querySelector(".jevx-st")!.textContent!.replace(/\s+/g, " ").trim(),
  sections: [...document.querySelectorAll("tr.jevx-sec:not(.jevx-status)")].map((s) => s.textContent!.replace(/\s+/g, " ").trim().slice(0, 40)),
  junk: document.querySelectorAll("tr.zA.jevx-junk").length,
  chips: document.querySelectorAll(".jevx-chip b:not(:empty)").length,
  top: [...document.querySelectorAll("tr.zA")].slice(0, 8).map((r) => (r.querySelector(".jevx-chip")?.textContent + " " + r.querySelector(".yX")!.textContent + " · " + r.querySelector(".bog")!.textContent).slice(0, 90)),
  longTasks: (window as any).longTasks as number[],
}));
console.log("status:", out.status);
console.log("scroll held after re-render:", out.scrollTop === 300, `(${out.scrollTop})`);
console.log("sections:", out.sections.join(" | "), "| chips:", out.chips, "| suggested trash:", out.junk);
console.log("top 8:\n  " + out.top.join("\n  "));
console.log(`long tasks during sort: ${out.longTasks.length}, worst ${Math.max(0, ...out.longTasks)}ms, total ${out.longTasks.reduce((a, b) => a + b, 0)}ms`);
console.log(`${(await ids()).filter((id, i) => id !== before[i]).length}/${before.length} rows moved`);
await page.$eval(".scroll", (s) => (s.scrollTop = 0));
await page.screenshot({ path: "data/e2e-sorted.png" });

// Prompt menu screenshot.
await page.click(".jevx-caret");
await page.waitForSelector(".jevx-menu");
await page.waitForTimeout(250);
console.log(`menu: ${openaiCalls} OpenAI call(s); for this inbox:`, await page.$$eval(".jevx-gen .jevx-p", (xs) => xs.map((x) => x.dataset.q).join(" | ")));
// Typing filters, arrows pick among what's visible.
await page.fill(".jevx-in input", "secur");
const visibleOpts = await page.$$eval(".jevx-p:not([hidden])", (xs) => xs.map((x) => x.dataset.q));
await page.keyboard.press("ArrowDown");
const picked = await page.$eval(".jevx-p.on", (x) => x.dataset.q).catch(() => null);
console.log(`filter "secur": ${visibleOpts.length} shown, ArrowDown picks "${picked}"`);
await page.fill(".jevx-in input", "");
await page.screenshot({ path: "data/e2e-menu.png" });
await page.keyboard.press("Escape");

await page.click('[data-act="hide"]');
const hidden = await page.$$eval("tr.zA.jevx-hidden", (x) => x.length);
await page.click('[data-act="hide"]');
console.log(`hide the rest: ${hidden} hidden`);

// Opening, keyboard and range selection on the sorted list must follow what's on screen.
const shown = () => page.$$eval("tr.zA:not(.jevx-hidden) [data-legacy-thread-id]", (xs) => xs.map((x) => x.getAttribute("data-legacy-thread-id")));
const order = await shown();
const hash = () => page.evaluate(() => location.hash);
await page.click(`tr.zA:has([data-legacy-thread-id="${order[2]}"]) .bog`);
const clicked = await hash();
await page.evaluate(() => (location.hash = "#inbox"));
await page.waitForTimeout(800); // the sort comes back
await page.click(".aKy", { position: { x: 4, y: 4 } }); // focus the page, not a row or the Sort button
await page.keyboard.press("j");
await page.keyboard.press("j");
await page.keyboard.press("Enter");
const keyed = await hash(); // the cursor starts on the row clicked above (#3), like Gmail
await page.evaluate(() => (location.hash = "#inbox"));
await page.waitForTimeout(800);
await page.click(`tr.zA:has([data-legacy-thread-id="${order[1]}"]) [role=checkbox]`);
await page.click(`tr.zA:has([data-legacy-thread-id="${order[4]}"]) [role=checkbox]`, { modifiers: ["Shift"] });
const ticked = await page.$$eval('tr.zA:has([aria-checked="true"]) [data-legacy-thread-id]', (xs) => xs.map((x) => x.getAttribute("data-legacy-thread-id")));
for (const id of ticked) await page.click(`tr.zA:has([data-legacy-thread-id="${id}"]) [role=checkbox]`);
console.log(`click row #3 opens it: ${clicked === "#inbox/" + order[2]} (${clicked}) · then j j Enter opens #5: ${keyed === "#inbox/" + order[4]} · shift-click #2..#5 ticks exactly those: ${JSON.stringify(ticked) === JSON.stringify(order.slice(1, 5))}`, JSON.stringify(order) === JSON.stringify(await shown()) ? "" : "(order changed meanwhile)");

// Trash: first click arms, second click trashes exactly the suggested rows through the Delete button.
if (out.junk) {
  const want = await page.$$eval("tr.zA.jevx-junk [data-legacy-thread-id]", (xs) => xs.map((x) => x.getAttribute("data-legacy-thread-id")).sort());
  await page.click('[data-act="trash"]');
  const armedText = await page.$eval('[data-act="trash"]', (b) => b.textContent);
  const notYet = await page.evaluate(() => (window as any).trashed.length);
  await page.click('[data-act="trash"]');
  await page.waitForTimeout(600);
  const got = (await page.evaluate(() => (window as any).trashed as string[])).sort();
  console.log(`trash: armed="${armedText}", trashed after 1st click=${notYet}, after 2nd=${got.length}, exactly the suggested ones: ${JSON.stringify(got) === JSON.stringify(want)}`);
  await page.screenshot({ path: "data/e2e-trashed.png" });
}

const remaining = await ids();
await page.click('[data-act="reset"]');
const after = await ids();
console.log("undo restores original order of remaining rows:", JSON.stringify(after) === JSON.stringify(before.filter((id) => remaining.includes(id))));

// Second sort, different sentence: everything should come from the cache.
await page.click(".jevx-caret");
await page.click('.jevx-p[data-q="has a deadline coming up soonest"]');
const t1 = Date.now();
await page.waitForSelector(".jevx-split.sorted", { timeout: 60000 });
console.log(`second sort ("deadline"): ${Date.now() - t1}ms · ${await page.$eval(".jevx-st .meta", (e) => e.textContent)}`);
// New mail while sorted: Gmail puts the row at the top of its list; it should stay on top, labelled.
await page.evaluate(() => {
  const tb = document.querySelector("tbody")!;
  const tr = tb.querySelector("tr.zA")!.cloneNode(true) as HTMLElement;
  tr.querySelector(".jevx-chip")?.remove();
  tr.className = "zA zE";
  tr.querySelector("[data-legacy-thread-id]")!.setAttribute("data-legacy-thread-id", "fresh000000000001");
  tb.insertBefore(tr, tb.firstChild);
});
await page.waitForTimeout(1200);
const fresh = await page.evaluate(() => {
  const kids = [...document.querySelector("tbody")!.children];
  const i = kids.findIndex((r) => r.querySelector('[data-legacy-thread-id="fresh000000000001"]'));
  return { i, before: kids.slice(0, i).map((r) => r.className.replace(/\s+/g, " ")).join(" | ") };
});
console.log(`new mail: row ${fresh.i} after [${fresh.before}]`);
console.log("gmail API calls:", gmailCalls.length, "methods:", [...new Set(gmailCalls)].join(","), "statuses:", JSON.stringify(gmailStatus));
await ctx.close();
