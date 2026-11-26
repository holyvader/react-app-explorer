/**
 * Where zooming is slow: every node of a snapshot drawn, then a slow wheel zoom from the fit to 1.2×
 * and back, logging each frame with the zoom it was drawn at, plus a CPU profile of the run (Chromium)
 * summarised by self time, and the long frames with the level-of-detail change they fall on.
 * Prereq: a snapshot (e2e/benchSnapshot.ts) and a dev server on it:
 *   RAE_SNAPSHOTS=<out dir> node_modules/.bin/vite --port 5199 --strictPort
 * Run: PW_CHROMIUM_PATH=<chromium> bun packages/viewer/e2e/zoomProfile.ts [snapshot file] [steps]
 * ENGINE=webkit: frame times in WebKit (the desktop app's engine), no CPU profile.
 */
import { chromium, webkit } from "playwright-core";

const url = process.env.VIEWER_URL ?? "http://localhost:5199/";
const [file, stepsArg] = process.argv.slice(2);
const steps = Number(stepsArg ?? 70);
const engine = process.env.ENGINE ?? "chromium";
const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
if (file) await page.addInitScript((f) => localStorage.setItem("rae.lastSnapshot", JSON.stringify(f)), file);
// each frame: when, and the zoom and level of detail it was drawn at
await page.addInitScript(() => {
  const w = window as any;
  w.__frames = [];
  let vp: HTMLElement | null = null;
  let canvas: Element | null = null;
  const tick = (t: number) => {
    if (!vp?.isConnected) vp = document.querySelector(".react-flow__viewport");
    if (!canvas?.isConnected) canvas = document.querySelector(".rae-canvas");
    const z = vp ? +(vp.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1) : 1;
    w.__frames.push([t, z, canvas?.getAttribute("data-lod") ?? ""]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.goto(url);
await page.waitForFunction(() => (window as any).__rae?.getState().snapshot, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const s = (window as any).__rae.getState();
  s.clear();
  s.addNodes(Object.keys(s.snapshot.nodes), { fit: true });
});
await page.waitForFunction(() => (window as any).__rae.getState().placed.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const counts = await page.evaluate(() => ({
  zoom: +(+(document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1)).toFixed(3),
  lod: document.querySelector(".rae-canvas")?.getAttribute("data-lod"),
  placed: (window as any).__rae.getState().placed.length,
  nodes: document.querySelectorAll(".react-flow__node").length,
  edges: document.querySelectorAll(".react-flow__edge").length,
}));

const cdp = engine === "chromium" ? await page.context().newCDPSession(page) : null;
await cdp?.send("Profiler.enable");
await cdp?.send("Profiler.setSamplingInterval", { interval: 250 });
const pane = (await page.locator(".react-flow").boundingBox())!;
await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
await cdp?.send("Profiler.start");
// starting the profiler stalls a frame: measure from after it
await page.waitForTimeout(400);
const from: number = await page.evaluate(() => performance.now());
for (let i = 0; i < steps; i++) {
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(40);
}
for (let i = 0; i < steps; i++) {
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(500);
const profile = cdp ? (await cdp.send("Profiler.stop")).profile : { nodes: [], samples: [], timeDeltas: [] };

const frames: [number, number, string][] = await page.evaluate((t0) => (window as any).__frames.filter((f: number[]) => f[0] >= t0), from);
const gaps = frames.slice(1).map((f, i) => ({ ms: f[0] - frames[i]![0], zoom: f[1], lod: f[2], lodBefore: frames[i]![2] }));
const sorted = gaps.map((g) => g.ms).sort((a, b) => a - b);
const long = gaps.filter((g) => g.ms > 50).sort((a, b) => b.ms - a.ms);

// self time per function (url:line), over the whole zoom run
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
for (let i = 0; i < profile.samples!.length; i++) {
  const n = byId.get(profile.samples![i]!)!;
  const f = n.callFrame;
  const where = f.url ? `${f.url.replace(/^.*\/(src|node_modules|deps)\//, "$1/").replace(/\?.*$/, "")}:${f.lineNumber + 1}` : "";
  const key = `${f.functionName || "(anonymous)"} ${where}`.trim();
  self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas![i] ?? 0) / 1000);
}
// inclusive time of the app's own functions (src/), each counted once per sample
const parent = new Map<number, number>();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map<string, number>();
for (let i = 0; i < profile.samples!.length; i++) {
  const seen = new Set<string>();
  for (let id: number | undefined = profile.samples![i]; id !== undefined; id = parent.get(id)) {
    const f = byId.get(id)!.callFrame;
    if (!/\/src\/|xyflow/.test(f.url) || !f.functionName) continue;
    const key = `${f.functionName || "(anonymous)"} ${f.url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "")}:${f.lineNumber + 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incl.set(key, (incl.get(key) ?? 0) + (profile.timeDeltas![i] ?? 0) / 1000);
  }
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 30));

const zs = frames.map((f) => f[1]);
console.log(JSON.stringify({ counts, range: [Math.min(...zs).toFixed(3), Math.max(...zs).toFixed(3)], frames: gaps.length, fps: Math.round(1000 / (gaps.reduce((a, g) => a + g.ms, 0) / gaps.length)), p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], worst: sorted.at(-1) }));
console.log("long frames (>50 ms):");
for (const g of long.slice(0, 20)) console.log(`  ${g.ms.toFixed(0).padStart(5)} ms  zoom ${g.zoom.toFixed(3)}  ${g.lodBefore === g.lod ? g.lod : `${g.lodBefore} → ${g.lod}`}`);
console.log(`self time (${total.toFixed(0)} ms sampled):`);
for (const [k, ms] of top) console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
console.log("inclusive, app code:");
for (const [k, ms] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 30))) console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${k}`);
await browser.close();
