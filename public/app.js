const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const S = {
  inbox: null,
  byId: new Map(),
  rows: new Map(),
  dateOrder: [],
  rankOrder: null,
  sort: "date",
  tiers: {},
  record: {},
  importance: {},
  running: false,
  query: "",
};

// ---------- formatting ----------
function fmtDate(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}
function fmtLong(ms) {
  const d = new Date(ms);
  const days = Math.round((Date.now() - ms) / 864e5);
  const rel = days < 1 ? `${Math.max(1, Math.round((Date.now() - ms) / 36e5))} hours ago` : `${days} day${days > 1 ? "s" : ""} ago`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (${rel})`;
}
const COLORS = ["#1a73e8", "#e8710a", "#188038", "#d93025", "#9334e6", "#12858a", "#c5221f", "#5f6368", "#b06000", "#3949ab"];
const colorFor = (s) => COLORS[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const n = (x) => x.toLocaleString("en-US");

function senderLabel(t) {
  const names = t.senders.length ? t.senders : [t.from.name];
  let s = names.slice(0, 3).join(", ");
  return esc(s) + (t.count > 1 ? `<span class="n">${t.count}</span>` : "");
}

function snack(html, ms = 4000) {
  const el = $("#snack");
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(snack.t);
  snack.t = setTimeout(() => (el.hidden = true), ms);
}

// ---------- list ----------
function rowEl(t) {
  const el = document.createElement("div");
  el.className = "row" + (t.unread ? " unread" : "");
  el.dataset.id = t.id;
  el.innerHTML = `
    <div class="ctl">
      <span class="ms cb" title="Select">check_box_outline_blank</span>
      <span class="ms star${t.starred ? " on" : ""}" title="${t.starred ? "Starred" : "Not starred"}">star</span>
      <span class="ms imp${t.important ? " half" : ""}" title="${t.important ? "Important according to Google magic." : "Click to teach Gmail this conversation is important."}">label_important</span>
    </div>
    <div class="rank"></div>
    <div class="from">${senderLabel(t)}</div>
    <div class="mid"><span class="tier-slot"></span><span class="subj-wrap"><span class="subj">${esc(t.subject)}</span><span class="snip"> - ${esc(t.snippet)}</span></span></div>
    <div class="rec"></div>
    <div class="date" title="${esc(new Date(t.date).toString())}">${fmtDate(t.date)}</div>
    <div class="hover-acts">
      <span class="ms icon-btn sm ro" title="Archive">archive</span>
      <span class="ms icon-btn sm ro" title="Delete">delete</span>
      <span class="ms icon-btn sm ro" title="Mark as read">drafts</span>
      <span class="ms icon-btn sm ro" title="Snooze">schedule</span>
    </div>
    <div class="imp-bar" style="width:0"></div>`;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".ro")) return readOnly(e);
    if (e.target.classList.contains("cb")) {
      e.target.textContent = e.target.textContent === "check_box" ? "check_box_outline_blank" : "check_box";
      return;
    }
    if (e.target.classList.contains("star") || e.target.classList.contains("imp")) return readOnly(e);
    openThread(t.id);
  });
  return el;
}

function readOnly(e) {
  e?.stopPropagation();
  snack("Read-only mirror: nothing is changed in your real Gmail.");
}

function currentOrder() {
  const base = S.sort === "importance" && S.rankOrder ? S.rankOrder : S.dateOrder;
  if (!S.query) return base;
  const q = S.query.toLowerCase();
  return base.filter((id) => {
    const t = S.byId.get(id);
    return (t.subject + " " + t.snippet + " " + t.from.name + " " + t.from.email + " " + t.senders.join(" ")).toLowerCase().includes(q);
  });
}

// FLIP: record positions, reorder DOM, animate each row from its old spot to the new one.
function applyOrder(order, animate = true) {
  const list = $("#list");
  const before = new Map();
  if (animate) for (const [id, el] of S.rows) if (el.isConnected) before.set(id, el.getBoundingClientRect().top);
  const keep = new Set(order);
  for (const [id, el] of S.rows) if (!keep.has(id) && el.isConnected) el.remove();
  const frag = document.createDocumentFragment();
  for (const id of order) frag.appendChild(S.rows.get(id));
  list.appendChild(frag);
  order.forEach((id, i) => {
    const el = S.rows.get(id);
    el.querySelector(".rank").textContent = S.rankOrder && S.sort === "importance" ? i + 1 : "";
  });
  if (!animate) return;
  const moved = [];
  for (const id of order) {
    const el = S.rows.get(id);
    const was = before.get(id);
    if (was == null) continue;
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    moved.push(el);
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of moved) {
        el.style.transition = "transform 420ms cubic-bezier(.2,.8,.2,1)";
        el.style.transform = "";
      }
    }),
  );
}

function renderHead() {
  const total = S.inbox.total;
  const shown = currentOrder().length;
  $("#range").textContent = `1–${shown} of ${n(total)}`;
  $("#unread").textContent = n(S.inbox.unread);
  $("#drafts").textContent = S.inbox.drafts ? n(S.inbox.drafts) : "";
  const crit = S.criterion && S.criterion !== DEFAULT_Q ? S.criterion : null;
  $("#listTitle").innerHTML = S.sort === "importance" && S.rankOrder ? (crit ? `Sorted by <q>${esc(crit)}</q>` : "Inbox · by importance") : "Inbox";
}

async function loadInbox(refresh = false) {
  $("#list").innerHTML = `<div class="loading">${refresh ? "Fetching your latest 100 emails from Gmail…" : "Loading…"}</div>`;
  const r = await fetch("/api/inbox" + (refresh ? "?refresh=1" : ""));
  const data = await r.json();
  if (data.error) {
    $("#list").innerHTML = `<div class="loading">${esc(data.error)}</div>`;
    return;
  }
  S.inbox = data;
  S.byId = new Map(data.threads.map((t) => [t.id, t]));
  S.rows = new Map(data.threads.map((t) => [t.id, rowEl(t)]));
  S.dateOrder = data.threads.map((t) => t.id);
  S.rankOrder = null;
  S.sort = "date";
  S.tiers = {};
  S.record = {};
  S.importance = {};
  $("#list").innerHTML = "";
  $("#list").classList.remove("ranked");
  $("#sortchips").hidden = true;
  $("#analyze").className = "analyze";
  $(".analyze-label").textContent = "Analyze";
  $("#avatar span").textContent = data.email[0].toUpperCase();
  $("#avatar").title = `Google Account\n${data.email}`;
  document.title = `Inbox (${n(data.unread)}) - ${data.email} - Gmail`;
  applyOrder(currentOrder(), false);
  renderHead();
}

// ---------- Jev analysis ----------
const ui = { t0: 0, timer: 0, lat: [], calls: 0, inflight: 0, phases: [], phaseDone: {}, phaseTotal: {}, feedN: 0 };

function setTier(id, tier) {
  S.tiers[id] = tier;
  const slot = S.rows.get(id)?.querySelector(".tier-slot");
  if (slot) slot.innerHTML = `<span class="tier ${tier}">${tier}</span>`;
}

function buildPhases(phases) {
  ui.phases = phases;
  $("#phases").innerHTML = phases
    .map((p) => `<li class="phase" data-k="${p.key}"><span class="ms">progress_activity</span><span>${p.label}</span><span class="meta"></span><span class="bar"><i></i></span></li>`)
    .join("");
  ui.phaseDone = {};
  ui.phaseTotal = Object.fromEntries(phases.map((p) => [p.key, p.total || 0]));
}

function phaseEl(k) {
  return $(`.phase[data-k="${k}"]`);
}
function phaseStart(k, total) {
  for (const el of document.querySelectorAll(".phase.on")) finishPhase(el.dataset.k);
  if (total != null) ui.phaseTotal[k] = total;
  ui.phaseDone[k] = 0;
  ui.phaseStartAt = performance.now();
  const el = phaseEl(k);
  if (!el) return;
  el.classList.add("on");
  el.querySelector(".ms").textContent = "progress_activity";
  el.querySelector(".meta").textContent = `0/${ui.phaseTotal[k]}`;
  el.scrollIntoView({ block: "nearest" });
}
function phaseTick(k) {
  ui.phaseDone[k] = (ui.phaseDone[k] || 0) + 1;
  const el = phaseEl(k);
  if (!el) return;
  const tot = ui.phaseTotal[k] || 1;
  el.querySelector(".bar i").style.width = `${(100 * ui.phaseDone[k]) / tot}%`;
  el.querySelector(".meta").textContent = `${ui.phaseDone[k]}/${tot}`;
}
function finishPhase(k, extra) {
  const el = phaseEl(k);
  if (!el || el.classList.contains("done")) return;
  el.classList.remove("on");
  el.classList.add("done");
  el.querySelector(".ms").textContent = "check_circle";
  el.querySelector(".bar i").style.width = "100%";
  const ms = Math.round(performance.now() - ui.phaseStartAt);
  el.querySelector(".meta").textContent = extra || `${ui.phaseDone[k] || 0} in ${ms}ms`;
}

function pushFeed(html) {
  const feed = $("#feed");
  feed.insertAdjacentHTML("afterbegin", html);
  while (feed.childElementCount > 40) feed.lastElementChild.remove();
  ui.feedN++;
  $("#feedCount").textContent = `${n(ui.feedN)} decisions`;
}

function short(id) {
  const t = S.byId.get(id);
  const other = t.from.email === S.inbox.email.toLowerCase() ? t.senders.find((s) => s !== "me") : null;
  return { who: esc(other || t.from.name), what: esc(t.subject) };
}

function tickStats() {
  if (S.running) $("#sElapsed").textContent = ((performance.now() - ui.t0) / 1000).toFixed(1) + "s";
  $("#sCalls").textContent = n(ui.feedN);
  $("#sInflight").textContent = ui.inflight;
  if (ui.lat.length) {
    const l = [...ui.lat].sort((a, b) => a - b);
    $("#sP50").textContent = l[Math.floor(l.length / 2)] + "ms";
  }
  if (S.running) ui.timer = requestAnimationFrame(tickStats);
}

function flash(id, cls) {
  const el = S.rows.get(id);
  if (!el) return;
  el.classList.remove("fight", "won", "lost");
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 700);
}

function setRecord(id, r) {
  S.record[id] = r;
  const el = S.rows.get(id)?.querySelector(".rec");
  if (el) el.textContent = `${r.w}–${r.l}`;
}

const DEFAULT_Q = "what matters most to me and should be read first";
const PRESETS = [
  ["bolt", DEFAULT_Q],
  ["gavel", "what gets me in trouble if I ignore it"],
  ["schedule", "has a deadline coming up soonest"],
  ["person", "a real person is waiting on my reply"],
  ["attach_money", "involves money I could make or lose"],
  ["shield", "security, hacking or account access"],
  ["school", "actually matters for my college applications"],
  ["sentiment_very_satisfied", "would make me happiest to read"],
];
const TIER_LABEL = { top: "top", strong: "strong", some: "partial", weak: "weak", none: "no" };
let algo = "pivot";

function analyze(criterion) {
  if (S.running || !S.inbox) return;
  const q = (criterion ?? $("#q").value).trim() || DEFAULT_Q;
  $("#q").value = q === DEFAULT_Q ? "" : q;
  $("#suggest").hidden = true;
  $("#q").blur();
  S.running = true;
  S.criterion = q;
  Object.assign(ui, { t0: performance.now(), lat: [], calls: 0, inflight: 0, feedN: 0, pivots: new Set(), callMs: new Set() });
  $("#feed").innerHTML = "";
  $("#feedCount").textContent = "";
  $("#jev").hidden = false;
  $("#jevCrit").textContent = q === DEFAULT_Q ? "Importance sort" : `“${q}”`;
  $("#jevAlgo").textContent = `Jev · ${algo === "pivot" ? "pivot sort" : "Swiss tournament"}`;
  $("#phases").innerHTML = "";
  $("#analyze").className = "analyze running";
  $(".analyze-label").textContent = "Analyzing…";
  for (const el of S.rows.values()) {
    el.querySelector(".tier-slot").innerHTML = "";
    el.querySelector(".rec").textContent = "";
    el.querySelector(".imp-bar").style.width = "0";
    el.classList.remove("pivot", "fight");
  }
  S.importance = {};
  S.sort = "importance";
  S.rankOrder = [...S.dateOrder];
  $("#list").classList.add("ranked");
  $("#sortchips").hidden = false;
  setChips();
  renderHead();
  closeThread();
  tickStats();

  const es = new EventSource(`/api/analyze?algo=${algo}&q=${encodeURIComponent(q === DEFAULT_Q ? "" : q)}`);
  let cur = null;
  const label = (k) => (k === "rr" ? "top-12" : k === "pivot" ? "pivot" : k.toUpperCase());
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    switch (ev.type) {
      case "plan":
        buildPhases(ev.phases);
        break;
      case "pivots":
        ui.pivots = new Set(ev.ids);
        for (const id of ev.ids) S.rows.get(id)?.classList.add("pivot");
        break;
      case "phase": {
        cur = ev.key;
        // The pivot wave is one call per item but P decisions per call; count decisions.
        const P = ui.pivots.size;
        const total = ev.key === "pivot" ? (ev.pairs?.length || 0) + (S.inbox.threads.length - P) * P : ev.total;
        phaseStart(ev.key, total);
        ui.inflight = ev.total;
        for (const el of S.rows.values()) el.classList.remove("fight");
        for (const [a, b] of ev.pairs || []) {
          S.rows.get(a)?.classList.add("fight");
          S.rows.get(b)?.classList.add("fight");
        }
        break;
      }
      case "triage": {
        ui.calls++;
        ui.inflight--;
        ui.lat.push(ev.ms);
        setTier(ev.id, ev.tier);
        phaseTick("triage");
        const s = short(ev.id);
        pushFeed(`<div class="tri"><span class="tier ${ev.tier}">${TIER_LABEL[ev.tier] || ev.tier}</span><b>${s.who} · <span class="dim">${s.what}</span></b><span class="ms-t">${Math.round(ev.conf * 100)}% · ${ev.ms}ms</span></div>`);
        break;
      }
      case "match": {
        // Several decisions can share one call (pivot wave); count each call once.
        const callKey = ev.phase === "pivot" && !ui.pivots.has(ev.a) ? ev.a : `${ev.a}|${ev.b}`;
        if (!ui.callMs.has(callKey)) {
          ui.callMs.add(callKey);
          ui.calls++;
          ui.inflight = Math.max(0, ui.inflight - 1);
          ui.lat.push(ev.ms);
        }
        phaseTick(ev.phase);
        const aWins = ev.pA >= 0.5;
        flash(ev.a, aWins ? "won" : "lost");
        flash(ev.b, aWins ? "lost" : "won");
        const A = short(ev.a), B = short(ev.b);
        const p = Math.round(Math.max(ev.pA, 1 - ev.pA) * 100);
        pushFeed(`<div class="duel">
          <div class="side ${aWins ? "win" : "lose"}"><b>${A.who}</b><span>${A.what}</span></div>
          <div class="vs">vs</div>
          <div class="side r ${aWins ? "lose" : "win"}"><b>${ui.pivots.has(ev.b) ? "◆ " : ""}${B.who}</b><span>${B.what}</span></div>
          <div class="pbar ${aWins ? "" : "flip"}"><i style="width:${p}%"></i></div>
          <div class="meta"><span>${aWins ? `◀ ${p}%` : ""}</span><span>${label(ev.phase)} · ${ev.ms}ms</span><span>${aWins ? "" : `${p}% ▶`}</span></div>
        </div>`);
        break;
      }
      case "standings":
        for (const [id, r] of Object.entries(ev.record)) setRecord(id, r);
        S.rankOrder = ev.order;
        applyOrder(currentOrder());
        break;
      case "done": {
        if (cur) finishPhase(cur);
        phaseStart("bt", 1);
        phaseTick("bt");
        finishPhase("bt", `${n(ev.matches)} games`);
        for (const [id, r] of Object.entries(ev.record)) setRecord(id, r);
        S.rankOrder = ev.order;
        S.importance = ev.importance;
        for (const el of S.rows.values()) el.classList.remove("fight", "pivot");
        for (const [id, v] of Object.entries(ev.importance)) {
          const row = S.rows.get(id);
          if (!row) continue;
          row.querySelector(".imp-bar").style.width = `${Math.round(v * 100)}%`;
          const imp = row.querySelector(".imp");
          imp.classList.toggle("on", v >= 0.75);
          imp.classList.toggle("half", v >= 0.55 && v < 0.75);
        }
        applyOrder(currentOrder());
        $("#list").scrollTo({ top: 0, behavior: "smooth" });
        S.running = false;
        cancelAnimationFrame(ui.timer);
        ui.inflight = 0;
        tickStats();
        $("#sCalls").textContent = n(ev.jev.decisions);
        $("#sElapsed").textContent = (ev.ms / 1000).toFixed(1) + "s";
        $("#sP50").textContent = ev.jev.p50 + "ms";
        $("#analyze").className = "analyze done";
        $(".analyze-label").textContent = "Sorted";
        renderHead();
        snack(`Sorted <b>${S.inbox.threads.length}</b> emails in <b>${(ev.ms / 1000).toFixed(1)}s</b> · ${n(ev.jev.decisions)} Jev decisions in ${n(ev.jev.calls)} calls · p50 ${ev.jev.p50}ms · $${ev.jev.costUsd.toFixed(3)}`, 8000);
        es.close();
        break;
      }
      case "error":
        console.warn(ev);
        break;
      case "fatal":
        snack("Jev failed: " + esc(ev.message), 8000);
        S.running = false;
        es.close();
        $("#analyze").className = "analyze";
        $(".analyze-label").textContent = "Analyze";
        break;
    }
  };
  es.onerror = () => {
    if (!S.running) return;
    es.close();
    S.running = false;
    snack("Lost connection to the analysis stream.");
    $("#analyze").className = "analyze";
    $(".analyze-label").textContent = "Analyze";
  };
}

function renderSuggest() {
  const typed = $("#q").value.trim();
  const items = typed && !PRESETS.some(([, t]) => t === typed) ? [["search_spark", typed], ...PRESETS] : PRESETS;
  $("#sgList").innerHTML = items.map(([ic, t]) => `<div class="sg" data-q="${esc(t)}"><span class="ms">${ic}</span>${esc(t)}</div>`).join("");
}

function setChips() {
  for (const c of document.querySelectorAll("#sortchips .chip")) c.classList.toggle("on", c.dataset.sort === S.sort);
}

// ---------- thread view ----------
let openId = null;
async function openThread(id) {
  openId = id;
  location.hash = "inbox/" + id;
  $("#listView").hidden = true;
  $("#threadView").hidden = false;
  const order = currentOrder();
  const i = order.indexOf(id);
  $("#tpos").textContent = `${i + 1} of ${n(S.inbox.total)}`;
  const box = $("#thread");
  box.scrollTop = 0;
  const lt = S.byId.get(id);
  box.innerHTML = `<div class="t-subject"><h2>${esc(lt.subject)}</h2></div><div class="loading">Loading…</div>`;
  const t = await (await fetch("/api/thread/" + id)).json();
  if (openId !== id) return;
  const rankI = S.rankOrder && S.importance[id] != null ? S.rankOrder.indexOf(id) : -1;
  const verdict =
    rankI >= 0
      ? `<span class="jev-verdict"><span class="ms">bolt</span>#${rankI + 1} of ${S.rankOrder.length} · ${S.tiers[id] || ""} · ${S.record[id] ? `${S.record[id].w}–${S.record[id].l}` : ""}</span>`
      : "";
  const me = S.inbox.email.toLowerCase();
  box.innerHTML =
    `<div class="t-subject"><h2>${esc(t.subject)}</h2><span class="t-tag">Inbox<span class="ms" style="font-size:14px">close</span></span>${verdict}</div>` +
    t.messages
      .map((m, k) => {
        const last = k === t.messages.length - 1;
        const isMe = m.from.email === me;
        const name = isMe ? "me" : m.from.name;
        return `<div class="msg${last ? "" : " collapsed"}" data-k="${k}">
          <div class="msg-av" style="background:${colorFor(m.from.email)}">${esc((m.from.name || "?").replace(/[^\p{L}\p{N}]/gu, "")[0]?.toUpperCase() || "?")}</div>
          <div class="msg-h">
            <div class="msg-from"><b>${esc(name)}</b><span class="em">&lt;${esc(m.from.email)}&gt;</span>
              <div class="to">to ${esc(m.to.split(",").map((x) => (x.toLowerCase().includes(me) ? "me" : x.replace(/<.*>/, "").replace(/"/g, "").trim())).join(", ").slice(0, 80))}<span class="ms" style="font-size:18px">arrow_drop_down</span></div>
              <div class="snip">${esc(m.text.replace(/\s+/g, " ").slice(0, 160))}</div>
            </div>
            <div class="msg-date">${fmtLong(m.date)}</div>
            <span class="ms icon-btn sm ro" title="Not starred">star</span>
            <span class="ms icon-btn sm ro" title="Reply">reply</span>
            <span class="ms icon-btn sm" title="More">more_vert</span>
          </div>
          <div class="msg-body"></div>
          ${m.attachments.length ? `<div class="atts">${m.attachments.map((a) => `<div class="att"><span class="ms">attach_file</span>${esc(a)}</div>`).join("")}</div>` : ""}
        </div>`;
      })
      .join("") +
    `<div class="reply-row"><button class="ro"><span class="ms">reply</span>Reply</button><button class="ro"><span class="ms">forward</span>Forward</button></div>`;

  const fill = (msgEl) => {
    const m = t.messages[Number(msgEl.dataset.k)];
    const body = msgEl.querySelector(".msg-body");
    if (body.childElementCount) return;
    if (m.html) {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
      f.srcdoc = `<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>body{margin:0;font:14px Roboto,Arial,sans-serif;color:#222;overflow-x:auto}img{max-width:100%;height:auto}</style></head><body>${m.html}</body></html>`;
      f.onload = () => {
        const h = () => (f.style.height = f.contentDocument.documentElement.scrollHeight + "px");
        h();
        setTimeout(h, 400);
        setTimeout(h, 1500);
      };
      body.appendChild(f);
    } else {
      const pre = document.createElement("pre");
      pre.innerHTML = esc(m.text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" style="color:#1a0dab">${u}</a>`);
      body.appendChild(pre);
    }
  };
  for (const el of box.querySelectorAll(".msg")) {
    if (!el.classList.contains("collapsed")) fill(el);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".ro")) return readOnly(e);
      if (el.classList.contains("collapsed")) {
        el.classList.remove("collapsed");
        fill(el);
      }
    });
  }
  box.querySelectorAll(".reply-row .ro").forEach((b) => b.addEventListener("click", readOnly));
}

function closeThread() {
  openId = null;
  $("#threadView").hidden = true;
  $("#listView").hidden = false;
  if (location.hash.startsWith("#inbox/")) history.replaceState(null, "", "#inbox");
}

function step(d) {
  const order = currentOrder();
  const i = order.indexOf(openId) + d;
  if (i >= 0 && i < order.length) openThread(order[i]);
}

// ---------- wiring ----------
$("#analyze").addEventListener("click", () => analyze());
$("#refresh").addEventListener("click", () => !S.running && loadInbox(true));
$("#jevClose").addEventListener("click", () => ($("#jev").hidden = true));
$("#back").addEventListener("click", closeThread);
$("#prevT").addEventListener("click", () => step(-1));
$("#nextT").addEventListener("click", () => step(1));
document.querySelectorAll("#threadView .ro").forEach((b) => b.addEventListener("click", readOnly));
document.querySelectorAll(".compose, .nav-item:not(.active)").forEach((b) => b.addEventListener("click", (e) => (e.preventDefault(), snack("This mirror only shows your Inbox."))));
$(".nav-item.active").addEventListener("click", (e) => (e.preventDefault(), closeThread()));
$(".logo").addEventListener("click", (e) => (e.preventDefault(), closeThread()));
$("#sortchips").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c || S.running) return;
  S.sort = c.dataset.sort;
  setChips();
  $("#list").classList.toggle("ranked", S.sort === "importance");
  applyOrder(currentOrder());
  renderHead();
});
$("#sortForm").addEventListener("submit", (e) => (e.preventDefault(), analyze()));
$("#q").addEventListener("focus", () => (renderSuggest(), ($("#suggest").hidden = false)));
$("#q").addEventListener("input", renderSuggest);
$("#q").addEventListener("keydown", (e) => e.key === "Escape" && (($("#suggest").hidden = true), e.target.blur()));
$("#suggest").addEventListener("mousedown", (e) => {
  e.preventDefault(); // keep focus so the dropdown stays open for the algo toggle
  const sg = e.target.closest(".sg");
  if (sg) return analyze(sg.dataset.q);
  const b = e.target.closest("#algo button");
  if (b) {
    algo = b.dataset.a;
    for (const x of document.querySelectorAll("#algo button")) x.classList.toggle("on", x === b);
  }
});
document.addEventListener("mousedown", (e) => !e.target.closest("#sortForm") && ($("#suggest").hidden = true));
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (openId && (e.key === "u" || e.key === "Escape")) closeThread();
  else if (openId && e.key === "j") step(1);
  else if (openId && e.key === "k") step(-1);
  else if (e.key === "/") (e.preventDefault(), $("#q").focus());
});

loadInbox();
