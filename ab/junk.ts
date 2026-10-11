// Does the trash check (50 Jev calls run alongside the ranking) slow the ranking down?
//   bun run ab/junk.ts
import { configure, jev, rank } from "../src/rank";
import { emailTask } from "../src/emails";
configure({ key: process.env.TYPESAFE_API_KEY, concurrency: 256 });
const inbox = await Bun.file("data/inbox.json").json();
const JUNK = { type: "choice", instructions: ["Would the owner be fine with `email` going straight to Trash without ever reading it?"], criteria: { trash: "safe to trash", keep: "the owner should keep it" } };
const res: Record<string, number[]> = { alone: [], withJunk: [], junkAfterTriage: [] };
for (let i = 0; i < 3; i++)
  for (const mode of ["alone", "withJunk", "junkAfterTriage"] as const) {
    const { items, task } = emailTask(inbox.threads.slice(0, 50), inbox.email.toLowerCase(), "", "swiss");
    const t0 = performance.now();
    let startJunk: () => void = () => {};
    const junk = mode === "alone" ? null : new Promise<void>((go) => (startJunk = go)).then(() => Promise.all(items.map((it) => jev({ email: it.card }, { trash: JUNK }).catch(() => {}))));
    if (mode === "withJunk") startJunk();
    await rank(items, task, (e: any) => mode === "junkAfterTriage" && e.type === "phase" && e.key === "s1" && startJunk());
    res[mode].push(Math.round(performance.now() - t0));
    await junk;
    await Bun.sleep(1500);
  }
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(16), v.join(" "), "median", [...v].sort((a, b) => a - b)[1]);
