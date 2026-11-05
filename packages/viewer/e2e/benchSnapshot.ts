/**
 * A big snapshot for the canvas benchmark (e2e/bench.ts): a scanned project copied N times under
 * app0/, app1/… (libraries shared), so edges and kinds stay realistic.
 *   bun run scan packages/viewer --no-types --out <src>
 *   bun packages/viewer/e2e/benchSnapshot.ts <src> <out dir> <copies>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const [src, out, copiesArg] = process.argv.slice(2);
const f = readdirSync(src).find((f) => f.endsWith(".json") && f !== "index.json")!;
const base = JSON.parse(readFileSync(`${src}/${f}`, "utf8"));
const ids = new Set(Object.keys(base.nodes).filter((id) => !id.startsWith("ext:")));
const files = new Set(Object.values<any>(base.nodes).map((n) => n.filePath).filter(Boolean));
const copies = Number(copiesArg);
const walk = (v: any, p: string): any => {
  if (typeof v === "string") return ids.has(v) || files.has(v) ? p + v : v;
  if (Array.isArray(v)) return v.map((x) => walk(x, p));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "absPath" ? x : walk(x, p)]));
  return v;
};
const nodes: Record<string, any> = {};
const edges: any[] = [];
for (let i = 0; i < copies; i++) {
  const p = `app${i}/`;
  for (const [id, n] of Object.entries<any>(base.nodes)) {
    if (id.startsWith("ext:")) {
      nodes[id] = n;
      continue;
    }
    nodes[p + id] = walk(n, p);
  }
  for (const e of base.edges) edges.push(walk(e, p));
}
const file = `2026-11-05T00-00-0${copies}-000Z.json`;
const snap = { ...base, createdAt: `2026-11-05T00:00:0${copies}.000Z`, rootDir: `/bench/x${copies}`, nodes, edges, stats: { ...base.stats } };
writeFileSync(`${out}/${file}`, JSON.stringify(snap));
console.log(file, Object.keys(nodes).length, edges.length);
