import type { Thread } from "./gmail";
import type { RankItem, RankTask } from "./rank";

// Who the inbox belongs to. Personal, so it lives in owner.json (gitignored); see owner.example.json.
const OWNER: { name: string; about: string } = await (async () => {
  const f = Bun.file("owner.json");
  const o = (await f.exists()) ? await f.json() : await Bun.file("owner.example.json").json();
  return { name: o.name, about: [].concat(o.about).join(" ") };
})();

export const DEFAULT_CRITERION = "what matters most to me and should be read first";

const DEFAULT_GUIDE = [
  "Prefer: a real human writing to the owner personally, anything that needs a reply or action, deadlines, money, security and account access, and personal college-application matters.",
  "Deprioritize: marketing, newsletters, mass college recruiting, promotions, social alerts, and automated notices.",
];

const ago = (ms: number) => {
  const h = (Date.now() - ms) / 36e5;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes ago` : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
};

function card(t: Thread, ownerEmail: string) {
  const last = t.messages[t.messages.length - 1];
  const other = [...t.messages].reverse().find((m) => m.from.email !== ownerEmail) || last;
  const ownerLast = last.from.email === ownerEmail;
  return {
    from: `${other.from.name} <${other.from.email}>`,
    subject: t.subject,
    received: ago(t.date),
    gmail_tab: t.category.toLowerCase(),
    signals: [
      t.bulk ? "bulk mail (List-Unsubscribe)" : "no unsubscribe header",
      ownerLast ? "the owner sent the latest message in this thread (they are waiting on the other side)" : "",
      t.messages.length > 1 ? `thread of ${t.messages.length} (participants: ${t.senders.join(", ")})` : "",
      last.attachments.length ? `attachments: ${last.attachments.slice(0, 3).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    body: (last.text || t.snippet).replace(/\s+/g, " ").slice(0, 900),
  };
}

export function emailTask(threads: Thread[], ownerEmail: string, criterion: string, algo?: RankTask["algo"]): { items: RankItem[]; task: RankTask } {
  const q = criterion.trim() || DEFAULT_CRITERION;
  return {
    items: threads.map((t) => ({ id: t.id, card: card(t, ownerEmail) })),
    task: {
      noun: "email",
      context: { owner: { ...OWNER, email: ownerEmail }, note: `These are emails in ${OWNER.name}'s inbox. "me"/"I" in the criterion means ${OWNER.name}.` },
      criterion: q,
      guide: q === DEFAULT_CRITERION ? DEFAULT_GUIDE : undefined,
      algo,
    },
  };
}
