/**
 * One file for a designer (Claude Design): docs/redesign/react-app-explorer-redesign.pdf.
 * The brief, every screen (captured by capture-states.ts) full width with its caption, and
 * appendices: today's tokens (theme.ts), the diagram CSS, the logo SVG and a sample of the data.
 *
 *   PW_CHROMIUM_PATH=… bun e2e/brief-pdf.ts <dir of the screens as .jpg>
 * (JPEGs keep the PDF small: e.g. `sips -Z 2000 -s format jpeg -s formatOptions 72 …`.)
 */
import { chromium } from "playwright-core";

const root = new URL("../../../", import.meta.url).pathname;
const dir = `${root}docs/redesign`;
const jpgDir = process.argv[2] ?? `${dir}/screens`;
const read = (p: string) => Bun.file(`${root}${p}`).text();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let md = await Bun.file(`${dir}/BRIEF.md`).text();
// this file is self-contained: point at the appendices instead of repo files
md = md.replace(/^Everything listed here is in this folder:[\s\S]*?\n---\n/m, `Everything a redesign needs is in this one document: the brief, every screen and state (section 3, full-width screenshots from the running app, 1440 × 900), and appendices with today's design tokens (A), the diagram's CSS (B), the logo artwork (C) and a sample of the data the app shows (D).\n`);
md = md.replace(/\(see `screens\/`\)/, "(screenshots follow the table)");
let body = (Bun.markdown as any).html(md, { gfm: true, tables: true }) as string;

const shots = [...new Bun.Glob("*.{jpg,png}").scanSync(jpgDir)].sort();
const caption = (f: string) => f.replace(/\.(jpg|png)$/, "").replace(/^(\d+)-/, "$1 · ").replace(/-/g, " ");
const figures = await Promise.all(
  shots.map(async (f) => {
    const bytes = Buffer.from(await Bun.file(`${jpgDir}/${f}`).arrayBuffer()).toString("base64");
    const mime = f.endsWith(".png") ? "image/png" : "image/jpeg";
    return `<figure><img src="data:${mime};base64,${bytes}" alt="${caption(f)}"><figcaption>${caption(f)}</figcaption></figure>`;
  }),
);
body = body.replace(/(<h2[^>]*>4\. )/, `<section class="shots">${figures.join("\n")}</section>\n$1`);

// D: one node of each kind and one relation of each kind, as the scanner writes them
const snap = JSON.parse(await Bun.file(`${dir}/sample-snapshot.json`).text());
const oneOf = new Map<string, unknown>();
for (const n of Object.values(snap.nodes) as Record<string, unknown>[]) {
  if (oneOf.has(n.kind as string)) continue;
  const { renderTree, ...rest } = n as { renderTree?: unknown[] };
  oneOf.set(n.kind as string, renderTree ? { ...rest, renderTree: `(${renderTree.length} JSX elements, trimmed)` } : rest);
}
const edgeOf = new Map<string, unknown>();
for (const e of snap.edges as Record<string, unknown>[]) if (!edgeOf.has(e.kind as string)) edgeOf.set(e.kind as string, e);
const sample = { framework: snap.framework, next: snap.next, stats: snap.stats, nodes: Object.fromEntries(oneOf), edges: [...edgeOf.values()] };

const appendix = `
<h2 class="appendix">Appendix A. Today's design tokens (packages/design-system/src/theme.ts)</h2>
<p>Chakra UI v3 <code>createSystem</code> config. Semantic tokens have light and dark values. Kind colours are <code>kind.&lt;kind&gt;.{solid,subtle,muted,fg}</code>; relation colours are <code>relation.&lt;relation&gt;</code>.</p>
<pre><code>${esc(await read("packages/design-system/src/theme.ts"))}</code></pre>
<h2 class="appendix">Appendix B. Today's diagram CSS (packages/viewer/src/components/canvas.css)</h2>
<p>Cards, frames, edges, labels, the tooltip and the canvas chrome. Plain CSS on purpose: hundreds of nodes re-render while panning.</p>
<pre><code>${esc(await read("packages/viewer/src/components/canvas.css"))}</code></pre>
<h2 class="appendix">Appendix C. Logo and app-icon artwork (packages/desktop/icon.svg)</h2>
<div class="logo">${await read("packages/desktop/icon.svg")}</div>
<pre><code>${esc(await read("packages/desktop/icon.svg"))}</code></pre>
<h2 class="appendix">Appendix D. The data: one node and one relation of each kind</h2>
<p>From the scan of the demo shop the screenshots show (${Object.keys(snap.nodes).length} nodes, ${snap.edges.length} relations). Every label, badge and section in the UI comes from these fields.</p>
<pre><code>${esc(JSON.stringify(sample, null, 2))}</code></pre>`;

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>React App Explorer: redesign brief</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 16mm 14mm; }
:root { --ink: #111827; --muted: #5b6573; --line: #dde2e8; --code: #f4f6f8; --accent: #2e6878; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); font: 10.5pt/1.55 "Inter", system-ui, sans-serif; }
h1 { font-size: 22pt; letter-spacing: -0.02em; margin: 0 0 8pt; }
h2 { font-size: 14.5pt; margin: 22pt 0 8pt; padding-top: 10pt; border-top: 1px solid var(--line); break-after: avoid; }
h2.appendix { break-before: page; }
h3 { font-size: 11.5pt; margin: 14pt 0 6pt; break-after: avoid; }
li { margin: 2pt 0; }
a { color: var(--accent); }
code { font: 0.86em/1.4 "JetBrains Mono", ui-monospace, monospace; background: var(--code); border-radius: 3px; padding: 0 3px; }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 6px; padding: 8pt 10pt; font: 7.4pt/1.45 "JetBrains Mono", ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
pre code { background: none; padding: 0; font: inherit; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 6pt 0 12pt; }
tr { break-inside: avoid; }
th, td { text-align: left; vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid var(--line); }
th { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--line); margin: 14pt 0; }
.shots figure { margin: 0 0 14pt; break-inside: avoid; }
.shots img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 6px; }
.shots figcaption { font-size: 9pt; color: var(--muted); margin-top: 4pt; text-transform: capitalize; }
.logo svg { width: 120px; height: 120px; display: block; margin: 6pt 0; }
</style></head><body>${body}${appendix}</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
const out = `${dir}/react-app-explorer-redesign.pdf`;
await page.pdf({ path: out, format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" }, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="font: 8px -apple-system, Helvetica, Arial, sans-serif; color: #8a93a0; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between;"><span>React App Explorer · redesign brief</span><span class="pageNumber"></span></div>` });
await browser.close();
console.log("✔", out, `${(Bun.file(out).size / 1024 / 1024).toFixed(1)} MB`);
