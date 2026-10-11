// The service worker talks to the local Jev server (it holds the read-only Gmail token and the Jev
// key), so the extension needs no Google sign-in. Host permission lets it reach localhost without CORS.
const SERVER = "http://localhost:8383";

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "spellcheck") {
    fetch(`${SERVER}/api/spellcheck`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: msg.draft, context: msg.context }), signal: AbortSignal.timeout(9000)
    }).then(async (response) => {
      const result = await response.json();
      reply(response.ok ? result : { error: result.error || "Jev spell check failed. Your draft is unchanged." });
    }).catch(() => reply({ error: "Can't reach Jev spell check. Start the existing server with: bun run server.ts" }));
    return true;
  }
  if (msg.type !== "recent") return;
  fetch(`${SERVER}/api/recent?hours=${msg.hours || 24}${msg.refresh ? "&refresh=1" : ""}`)
    .then((r) => r.json())
    .then(reply, (e) => reply({ error: `Can't reach the Jev server on localhost:8383 (${e.message}). Start it with: bun run server.ts` }));
  return true;
});

// Analysis streams over a long-lived port: SSE from the server, one message per event.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "jev") return;
  const ctl = new AbortController();
  port.onDisconnect.addListener(() => ctl.abort());
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "analyze") return;
    try {
      const qs = new URLSearchParams({ src: "recent", hours: String(msg.hours || 24), algo: msg.algo || "auto", q: msg.q || "" });
      const res = await fetch(`${SERVER}/api/analyze?${qs}`, { signal: ctl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith("data: ")) port.postMessage(JSON.parse(chunk.slice(6)));
        }
      }
    } catch (e) {
      if (!ctl.signal.aborted) port.postMessage({ type: "fatal", message: `Can't reach the Jev server on localhost:8383 (${e.message})` });
    }
  });
});

// Presence contains no email text. Actual capture/sort is requested only by a native shortcut.
const companionClient = crypto.randomUUID();
async function companionPost(route, value, timeout = 5000) {
  const response = await fetch(`${SERVER}/api/companion/extension/${route}`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: companionClient, ...value }), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("Companion server unavailable");
  return response.json();
}
let activeGmailTab = null;
async function companionPresence() {
  try {
    const window = await chrome.windows.getLastFocused();
    const [tab] = window.focused ? await chrome.tabs.query({ active: true, windowId: window.id }) : [];
    const presence = tab && await chrome.tabs.sendMessage(tab.id, { type: "glancePresence" }).catch(() => null);
    activeGmailTab = presence?.gmail ? tab.id : null;
    await companionPost("presence", { active: activeGmailTab !== null });
  } catch { activeGmailTab = null; }
}
async function companionLoop() {
  for (;;) {
    try {
      await companionPresence();
      const { command } = await companionPost("next", {}, 23000);
      if (!command) continue;
      let result;
      try {
        await companionPresence();
        if (activeGmailTab === null) throw new Error("Gmail is no longer focused.");
        result = await chrome.tabs.sendMessage(activeGmailTab, { type: "glanceLookup", mode: command.mode, criterion: command.criterion });
      } catch { result = { error: "The active Gmail tab could not complete this shortcut. Refresh Gmail and retry." }; }
      await companionPost("result", { id: command.id, result });
    } catch { await new Promise((resolve) => setTimeout(resolve, 3000)); }
  }
}
setInterval(() => void companionPresence(), 2000);
void companionLoop();
