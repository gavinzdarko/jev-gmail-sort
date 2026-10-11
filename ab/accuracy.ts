// How good is each ranking strategy? Reference = every pair compared (full). A second full run gives
// the noise ceiling (Jev disagreeing with itself). "triage" = order from the first read alone.
//   bun run ab/accuracy.ts
import { configure, rank } from "../src/rank";
import { emailTask } from "../src/emails";
configure({ key: process.env.TYPESAFE_API_KEY, concurrency: 256 });
const inbox = await Bun.file("data/inbox.json").json();
const threads = inbox.threads.slice(0, 50);

const tau = (a: string[], b: string[]) => {
  const pb = new Map(b.map((id, i) => [id, i]));
  let c = 0, d = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) (pb.get(a[i])! < pb.get(a[j])! ? c++ : d++);
  return (c - d) / (c + d);
};
const overlap = (a: string[], b: string[], k: number) => a.slice(0, k).filter((x) => b.slice(0, k).includes(x)).length / k;
// NDCG@10 with graded relevance from the reference's position.
const ndcg = (a: string[], ref: string[]) => {
  const rel = new Map(ref.map((id, i) => [id, Math.max(0, 20 - i)]));
  const dcg = (xs: string[]) => xs.slice(0, 10).reduce((s, id, i) => s + rel.get(id)! / Math.log2(i + 2), 0);
  return dcg(a) / dcg(ref);
};

for (const crit of ["", "which require investor attention"]) {
  const run = async (algo: any) => {
    const { items, task } = emailTask(threads, inbox.email.toLowerCase(), crit, algo);
    const tri: Record<string, number> = {};
    const t0 = performance.now();
    const r: any = await rank(items, task, (e: any) => e.type === "triage" && (tri[e.id] = e.value));
    return { order: r.order as string[], ms: Math.round(performance.now() - t0), calls: r.jev.calls, cost: r.jev.costUsd, triage: Object.keys(tri).sort((x, y) => tri[y] - tri[x]) };
  };
  const ref = await run("full");
  const rows: [string, any][] = [["full (again)", await run("full")]];
  for (const algo of ["swiss", "swiss", "pivot", "pivot"]) rows.push([algo, await run(algo)]);
  rows.push(["triage only", { order: rows[1][1].triage, ms: 0, calls: 50, cost: 0 }]);
  console.log(`\n== ${crit || "default: what matters most"}  (reference: full, ${ref.calls} calls)`);
  console.log("strategy       tau    top5  top10  ndcg@10   ms    calls  $");
  for (const [name, r] of rows)
    console.log(`${name.padEnd(13)} ${tau(r.order, ref.order).toFixed(2).padStart(5)}  ${overlap(r.order, ref.order, 5).toFixed(2)}  ${overlap(r.order, ref.order, 10).toFixed(2)}   ${ndcg(r.order, ref.order).toFixed(3)}  ${String(r.ms).padStart(5)}  ${String(r.calls).padStart(5)}  ${r.cost.toFixed(3)}`);
}
