/**
 * Canvas performance with a big diagram: every node of a snapshot drawn, then pan and wheel-zoom
 * at the zoomed-out fit, at 0.5× and at 1×, timing frames (requestAnimationFrame intervals) in the page.
 * Prereq: a big snapshot (e2e/benchSnapshot.ts) and a dev server on it:
 *   RAE_SNAPSHOTS=<out dir> node_modules/.bin/vite --port 5199 --strictPort
 * Run: bun packages/viewer/e2e/bench.ts [chromium|webkit|firefox] [snapshot file] [screenshot dir]
 * Browser: PW_CHROMIUM_PATH=<chromium binary> for chromium; webkit from Playwright's install (once:
 * `playwright-core install webkit`); firefox is the installed Firefox over WebDriver BiDi (channel
 * `moz-firefox`, PW_FIREFOX_CHANNEL to change it): Playwright's own Firefox build doesn't start on macOS 27.
 */
import { chromium, firefox, webkit } from "playwright-core";

const url = process.env.VIEWER_URL ?? "http://localhost:5199/";
const [engine = "chromium", file, shots] = process.argv.slice(2);
const browser = engine === "webkit" ? await webkit.launch() : engine === "firefox" ? await firefox.launch({ channel: process.env.PW_FIREFOX_CHANNEL ?? "moz-firefox" }) : await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = new Map<string, number>();
page.on("pageerror", (e) => {
  if (!errors.has(e.message)) console.error("page error:", e.stack?.split("\n").slice(0, 6).join("\n"));
  errors.set(e.message, (errors.get(e.message) ?? 0) + 1);
});
// (about:blank first: Firefox refuses localStorage there)
if (file)
  await page.addInitScript((f) => {
    try {
      localStorage.setItem("rae.lastSnapshot", f);
    } catch {
      /* not the viewer's page yet */
    }
  }, file);
// Frame timestamps from the page's own start, in its own world: frames() reads the ones in its span.
await page.addInitScript(() => {
  const w = window as any;
  w.__benchFrames = [];
  const tick = (t: number) => {
    w.__benchFrames.push(t);
    if (w.__benchFrames.length > 20000) w.__benchFrames.splice(0, 10000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
// BENCH_CSS: extra CSS for experiments (what costs what)
if (process.env.BENCH_CSS) await page.addInitScript((css) => addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: css }))), process.env.BENCH_CSS);
await page.goto(url);
await page.waitForFunction(() => (window as any).__rae?.getState().snapshot, null, { timeout: 60000 });
await page.waitForTimeout(1000);

const t0 = Date.now();
await page.evaluate(() => {
  const s = (window as any).__rae.getState();
  s.clear();
  s.addNodes(Object.keys(s.snapshot.nodes), { fit: true });
});
await page.waitForFunction(() => (window as any).__rae.getState().placed.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(2500);
const placeMs = Date.now() - t0;

const pane = (await page.locator(".react-flow").boundingBox())!;
const dom = () =>
  page.evaluate(() => ({
    elements: document.querySelectorAll(".react-flow *").length,
    nodes: document.querySelectorAll(".react-flow__node").length,
    edges: document.querySelectorAll(".react-flow__edge").length,
    labels: document.querySelectorAll(".rae-edge-label").length,
    zoom: +(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform.match(/matrix\(([^,]+)/)?.[1] ?? 1),
  }));

/** Frame intervals while `act` runs (and 300 ms after, for what it left to render). */
async function frames(act: () => Promise<void>) {
  const from: number = await page.evaluate(() => performance.now());
  const start = Date.now();
  await act();
  await page.waitForTimeout(300);
  const ms = Date.now() - start;
  const f: number[] = await page.evaluate((t0) => {
    const ts: number[] = ((window as any).__benchFrames ?? []).filter((t: number) => t >= t0);
    return ts.slice(1).map((t, i) => t - ts[i]!);
  }, from);
  if (!f.length) return { fps: 0, ms, p50: 0, p95: 0, worst: 0, over50: 0, note: "no animation frames recorded" };
  const sorted = [...f].sort((a, b) => a - b);
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  return {
    fps: Math.round(1000 / mean),
    ms,
    p50: +sorted[Math.floor(sorted.length * 0.5)]?.toFixed(1),
    p95: +sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1),
    worst: +sorted.at(-1)!.toFixed(1),
    over50: f.filter((x) => x > 50).length,
  };
}

/** A point on the empty pane (not on a node or edge label), so a drag pans. */
const emptyPoint = () =>
  page.evaluate(({ x, y, width, height }) => {
    for (let fy = 0.5; fy < 0.95; fy += 0.05)
      for (let fx = 0.08; fx < 0.5; fx += 0.02) {
        const px = x + width * fx;
        const py = y + height * fy;
        if (document.elementFromPoint(px, py)?.classList.contains("react-flow__pane")) return { x: px, y: py };
      }
    return null;
  }, pane);
const pan = async () => {
  const at = await emptyPoint();
  if (!at) throw new Error("no empty spot on the pane to drag");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(at.x + i * 12, at.y + Math.sin(i / 6) * 60);
  for (let i = 40; i >= 0; i--) await page.mouse.move(at.x + i * 12, at.y);
  await page.mouse.up();
};
const zoom = async () => {
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
};

const results: Record<string, unknown> = { engine, file: file ?? "(last)", placeMs };
results.fitDom = await dom();
if (shots) await page.screenshot({ path: `${shots}/bench-${engine}-fit.png` });
results.fitPan = await frames(pan);
results.fitZoom = await frames(zoom);
// 0.5×, centred: the readable middle
await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
for (let i = 0; i < 40 && (await dom()).zoom < 0.5; i++) await page.mouse.wheel(0, -100);
await page.waitForTimeout(800);
results.midDom = await dom();
if (shots) await page.screenshot({ path: `${shots}/bench-${engine}-mid.png` });
results.midPan = await frames(pan);
// 1×: full detail (labels, dashes, arrows)
for (let i = 0; i < 40 && (await dom()).zoom < 1; i++) await page.mouse.wheel(0, -100);
await page.waitForTimeout(800);
results.fullDom = await dom();
if (shots) await page.screenshot({ path: `${shots}/bench-${engine}-full.png` });
results.fullPan = await frames(pan);
if (errors.size) results.errors = Object.fromEntries(errors);
console.log(JSON.stringify(results));
await browser.close();
