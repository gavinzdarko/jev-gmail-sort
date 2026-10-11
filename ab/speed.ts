// Wall time and calls for each algorithm on the first 50 inbox threads.  bun run ab/speed.ts
import { configure, rank } from "../src/rank";
configure({ key: process.env.TYPESAFE_API_KEY, concurrency: 256 });
import { emailTask } from "../src/emails";
const inbox = await Bun.file("data/inbox.json").json();
for (const algo of ["swiss", "full", "pivot", "swiss", "full"] as const) {
  const { items, task } = emailTask(inbox.threads.slice(0, 50), inbox.email.toLowerCase(), "", algo);
  const firstStandings: number[] = [];
  const t0 = performance.now();
  const r = await rank(items, task, (e: any) => e.type === "standings" && firstStandings.push(Math.round(performance.now() - t0)));
  console.log(`${algo.padEnd(6)} ${String(Math.round(performance.now() - t0)).padStart(5)}ms  calls ${r.jev.calls}  p50 ${r.jev.p50} p90 ${r.jev.p90}  hedges ${r.jev.hedges}  $${r.jev.costUsd.toFixed(3)}  first live update ${firstStandings[0] ?? "-"}ms`);
  await Bun.sleep(2000);
}
