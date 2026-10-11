// A/B test: is asking about many pairs in ONE Jev call (a block of k emails, all C(k,2) pairs as
// separate questions) as accurate as one pair per call? And how far can k go?
//   bun run ab/pack.ts [n=24] ["criterion"]
import { configure, jev, bradleyTerry, type Match } from "../src/rank";
configure({ key: process.env.TYPESAFE_API_KEY, concurrency: Number(process.env.JEV_CONCURRENCY || 256) });
import { emailTask } from "../src/emails";

const N = Number(process.argv[2] || 24);
const CRIT = process.argv[3] || "";
const recent = await Bun.file("data/recent.json").json();
const { items, task } = emailTask(recent.threads.slice(0, N), recent.email.toLowerCase(), CRIT);
const ids = items.map((i) => i.id);
const card = new Map(items.map((i) => [i.id, i.card]));
const rule = `Rank each email by this criterion: "${task.criterion}".`;
const guide = task.guide || [];
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairs: [string, string][] = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pairs.push([ids[i], ids[j]]);

type Obs = Map<string, number[]>; // key(a,b) -> list of P(smaller id ranks higher)
const add = (o: Obs, a: string, b: string, pA: number) => {
  const k = key(a, b);
  (o.get(k) || o.set(k, []).get(k)!).push(a < b ? pA : 1 - pA);
};

async function single(order: "both" | "random") {
  const o: Obs = new Map();
  const lat: number[] = [];
  let calls = 0, missing = 0;
  const jobs = pairs.flatMap(([a, b]) => (order === "both" ? [[a, b], [b, a]] : [Math.random() < 0.5 ? [a, b] : [b, a]]));
  await Promise.all(
    jobs.map(async ([x, y]) => {
      try {
        const r = await jev({ context: task.context, criterion: task.criterion, A: card.get(x), B: card.get(y) }, {
          higher: { type: "choice", instructions: [rule, "Which email, `A` or `B`, ranks higher?", ...guide], criteria: { A: "email A ranks higher", B: "email B ranks higher" } },
        });
        calls++;
        lat.push(r.ms);
        const p = r.answers.higher?.probabilities?.A;
        if (p == null) missing++;
        else add(o, x, y, p);
      } catch {
        missing++;
      }
    }),
  );
  return { o, calls, lat, missing, questions: jobs.length };
}

// Cover all pairs with blocks of size k: random partitions of the n items, repeated until every
// pair has shared a block at least once.
function blocks(k: number) {
  const seen = new Set<string>();
  const out: string[][] = [];
  while (seen.size < pairs.length) {
    const sh = [...ids].sort(() => Math.random() - 0.5);
    for (let i = 0; i < sh.length; i += k) {
      const b = sh.slice(i, i + k);
      if (b.length < 2) continue;
      let fresh = 0;
      for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) if (!seen.has(key(b[x], b[y]))) fresh++;
      if (!fresh) continue;
      for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) seen.add(key(b[x], b[y]));
      out.push(b);
    }
  }
  return out;
}

async function packed(k: number) {
  const o: Obs = new Map();
  const lat: number[] = [];
  let calls = 0, missing = 0, questions = 0;
  const bs = blocks(k);
  await Promise.all(
    bs.map(async (b) => {
      const names = b.map((_, i) => `E${i + 1}`);
      const qs: Record<string, unknown> = {};
      const asked: [string, string, string][] = [];
      for (let x = 0; x < b.length; x++)
        for (let y = x + 1; y < b.length; y++) {
          // Randomize which one is mentioned first so position bias averages out.
          const [i, j] = Math.random() < 0.5 ? [x, y] : [y, x];
          const q = `${names[i]}_vs_${names[j]}`;
          qs[q] = {
            type: "choice",
            instructions: [rule, `Which email, \`emails.${names[i]}\` or \`emails.${names[j]}\`, ranks higher?`, ...guide],
            criteria: { [names[i]]: `email ${names[i]} ranks higher`, [names[j]]: `email ${names[j]} ranks higher` },
          };
          asked.push([q, b[i], b[j]]);
        }
      questions += asked.length;
      try {
        const r = await jev({ context: task.context, criterion: task.criterion, emails: Object.fromEntries(b.map((id, i) => [names[i], card.get(id)])) }, qs);
        calls++;
        lat.push(r.ms);
        for (const [q, a, bb] of asked) {
          const ans = r.answers[q];
          const nameA = names[b.indexOf(a)];
          const p = ans?.probabilities?.[nameA];
          if (p == null) missing++;
          else add(o, a, bb, p);
        }
      } catch (e) {
        missing += asked.length;
        console.error(`  k=${k} call failed: ${String(e).slice(0, 140)}`);
      }
    }),
  );
  return { o, calls, lat, missing, questions };
}

// Star: one focal email vs m others in one call (the shape pivot sort uses).
async function star(m: number) {
  const o: Obs = new Map();
  const lat: number[] = [];
  let calls = 0, missing = 0, questions = 0;
  const jobs: [string, string[]][] = [];
  for (let i = 0; i < N; i++) {
    const rest = ids.slice(i + 1);
    for (let c = 0; c < rest.length; c += m) jobs.push([ids[i], rest.slice(c, c + m)]);
  }
  await Promise.all(
    jobs.map(async ([id, others]) => {
      const names = others.map((_, k) => `P${k + 1}`);
      const qs = Object.fromEntries(
        names.map((p) => {
          const sides = Math.random() < 0.5 ? [["item", "`item` ranks higher"], [p, `\`others.${p}\` ranks higher`]] : [[p, `\`others.${p}\` ranks higher`], ["item", "`item` ranks higher"]];
          return [`vs_${p}`, { type: "choice", instructions: [rule, `Does \`item\` rank above \`others.${p}\`?`, ...guide], criteria: Object.fromEntries(sides) }];
        }),
      );
      questions += names.length;
      try {
        const r = await jev({ context: task.context, criterion: task.criterion, others: Object.fromEntries(names.map((p, k) => [p, card.get(others[k])])), item: card.get(id) }, qs);
        calls++;
        lat.push(r.ms);
        names.forEach((p, k) => {
          const pr = r.answers[`vs_${p}`]?.probabilities?.item;
          if (pr == null) missing++;
          else add(o, id, others[k], pr);
        });
      } catch {
        missing += names.length;
      }
    }),
  );
  return { o, calls, lat, missing, questions };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] | 0;
const fit = (o: Obs) => {
  const ms: Match[] = [];
  for (const [k, ps] of o) {
    const [a, b] = k.split("|");
    ms.push({ a, b, pA: mean(ps), ms: 0, phase: "" });
  }
  const s = bradleyTerry(ids, ms, new Map());
  return [...ids].sort((x, y) => s.get(y)! - s.get(x)!);
};
function kendall(r1: string[], r2: string[]) {
  const p1 = new Map(r1.map((id, i) => [id, i])), p2 = new Map(r2.map((id, i) => [id, i]));
  let c = 0, d = 0;
  for (const [a, b] of pairs) {
    const s = Math.sign(p1.get(a)! - p1.get(b)!) * Math.sign(p2.get(a)! - p2.get(b)!);
    s > 0 ? c++ : d++;
  }
  return (c - d) / (c + d);
}
const topk = (r1: string[], r2: string[], k: number) => r1.slice(0, k).filter((x) => r2.slice(0, k).includes(x)).length;

console.log(`n=${N} emails, ${pairs.length} pairs, criterion: "${task.criterion}"\n`);
const t0 = performance.now();
const ref = await single("both");
console.log(`reference: ${ref.calls} single-pair calls (both orders) in ${Math.round(performance.now() - t0)}ms`);
const refP = new Map([...ref.o].map(([k, ps]) => [k, mean(ps)]));
const refRank = fit(ref.o);
const confident = [...refP].filter(([, p]) => Math.abs(p - 0.5) > 0.15).map(([k]) => k);
console.log(`  ${confident.length}/${pairs.length} pairs where the reference is confident (|p-0.5|>0.15)\n`);

const rows: string[] = [];
const arms: [string, () => Promise<Awaited<ReturnType<typeof packed>>>][] = [
  ["single (1 q/call)", () => single("random")],
  ...(process.env.ARMS || "k4,k6,k8,k12,k16").split(",").map((a) => {
    const v = Number(a.slice(a[0] === "s" ? 4 : 1));
    return a.startsWith("star") ? [`star m=${v} (${v} q/call)`, () => star(v)] : [`packed k=${v} (${(v * (v - 1)) / 2} q/call)`, () => packed(v)];
  }) as [string, () => Promise<any>][],
];
for (const [name, run] of arms) {
  await Bun.sleep(3000); // let Jev settle so arms don't share load
  const t = performance.now();
  const r = await run();
  const wall = Math.round(performance.now() - t);
  const p = new Map([...r.o].map(([k, ps]) => [k, mean(ps)]));
  const agree = confident.filter((k) => p.has(k) && (p.get(k)! > 0.5) === (refP.get(k)! > 0.5)).length / confident.filter((k) => p.has(k)).length;
  const mae = mean([...p].filter(([k]) => refP.has(k)).map(([k, v]) => Math.abs(v - refP.get(k)!)));
  const rank = fit(r.o);
  rows.push(
    [name.padEnd(24), String(r.calls).padStart(5), String(r.questions).padStart(6), `${String(r.missing).padStart(4)}`, `${(agree * 100).toFixed(1)}%`.padStart(7), mae.toFixed(3).padStart(6), kendall(rank, refRank).toFixed(3).padStart(6), `${topk(rank, refRank, 5)}/5`.padStart(5), `${pct(r.lat, 0.5)}/${pct(r.lat, 0.9)}`.padStart(10), `${wall}ms`.padStart(8)].join(" "),
  );
  console.log(rows.at(-1));
}
console.log(`\n${"arm".padEnd(24)} calls  quest miss  agree    MAE    tau  top5  p50/p90ms     wall`);
for (const r of rows) console.log(r);
