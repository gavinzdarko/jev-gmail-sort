// Latency of the "sort ideas" call across models / settings.  bun run ab/suggest.ts
const inbox = await Bun.file("data/inbox.json").json();
const items = inbox.threads.slice(0, 50).map((t: any) => ({ from: t.from.name || t.from.email, subject: t.subject, snippet: (t.snippet || "").slice(0, 90) }));
const SYS = `You write sort criteria for an email client that ranks the inbox by a sentence. Given the inbox, return JSON {"suggestions":[{"q":string,"icon":string}]} with 5 criteria (3 to 8 words, lowercase, no trailing period) this person would actually want to sort these emails by. Be specific to the real people, companies, projects and themes you see; avoid generic ideas like "important emails". icon is one of: person, money, trend, clock, shield, work, school, travel, code, event, receipt, chat, star, reply.`;
const lines = (snip: boolean) => items.map((i: any) => `${i.from}: ${i.subject}${snip && i.snippet ? " - " + i.snippet : ""}`).join("\n");
async function call(model: string, extra: any, snip: boolean) {
  const t0 = performance.now();
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, ...extra, messages: [{ role: "system", content: SYS }, { role: "user", content: lines(snip) }] }) });
  const j: any = await r.json();
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) return `${ms}ms ERR ${j.error?.message?.slice(0, 90)}`;
  const s = JSON.parse(j.choices[0].message.content).suggestions;
  return `${ms}ms in=${j.usage.prompt_tokens} out=${j.usage.completion_tokens} rsn=${j.usage.completion_tokens_details?.reasoning_tokens ?? "-"} | ${s.map((x: any) => x.q).join(" | ")}`;
}
const variants: [string, any, boolean][] = [
  ["gpt-6-luna", { reasoning_effort: "none" }, true],
  ["gpt-6-luna", { reasoning_effort: "none" }, false],
  ["gpt-5.6-luna", { reasoning_effort: "none" }, true],
  ["gpt-5.6-luna", { reasoning_effort: "none" }, false],
  ["gpt-5.6-luna", { reasoning_effort: "low" }, true],
];
for (const [m, x, snip] of variants)
  for (let i = 0; i < 2; i++) console.log(m.padEnd(13), JSON.stringify(x).padEnd(30), snip ? "snip " : "subj ", await call(m, x, snip));
