/**
 * Headless smoke test of the viewer.
 * Prereq: `bun run scan packages/fixtures/next-app` and a running dev server:
 *   RAE_SNAPSHOTS=packages/fixtures/next-app/.explorer/snapshots bun run dev -- --port 5199
 * Run: bun packages/viewer/e2e/smoke.ts [outDir]
 * Browser: PW_CHROMIUM_PATH=<chromium binary>, otherwise Playwright's default lookup.
 */
import { chromium } from "playwright-core";

const url = process.env.VIEWER_URL ?? "http://localhost:5199/";
const outDir = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const fail = (msg: string) => {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
};

await page.goto(url);
await page.getByText("Empty diagram").waitFor({ timeout: 15000 });
// Earlier runs' UI scans add react-app snapshots to the same folder: pick the newest next-app one.
const select = page.locator("select").first();
const nextApp = await select.evaluate((el: HTMLSelectElement) => [...el.options].find((o) => o.text.startsWith("next-app"))?.value);
if (!nextApp) throw new Error("no next-app snapshot: run `bun run scan packages/fixtures/next-app` first");
await select.selectOption(nextApp);
await page.getByText(/^next-app · \d+ files/).waitFor();
await page.getByText("Empty diagram").waitFor();
await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
await page.getByPlaceholder(/Search components/).fill("HomePage");
await page.keyboard.press("Enter");
await page.locator(".react-flow__node").first().waitFor();
if ((await page.getByText("Render tree").count()) === 0) fail("details panel did not open");
// Adding a node draws just that node: no file module is added around it.
if ((await page.locator(".react-flow__node").count()) !== 1) fail("adding a component must draw only that component");

await page.getByRole("button", { name: "Children down to leaves" }).first().click();
await page.getByRole("button", { name: "Parents up to root" }).first().click();
await page.waitForTimeout(600);
const onCanvas = Number((await page.getByText(/ shown$/).first().textContent())?.match(/(\d+) shown/)?.[1]);
if (!(onCanvas > 5)) fail(`expected expansion to add nodes, got ${onCanvas}`);
if (outDir) await page.screenshot({ path: `${outDir}/smoke.png` });

if ((await page.locator('.react-flow__node[data-id="ext:react"]').count()) !== 0) fail("react should be hidden by default");
// Read-only diagram: no handle can start a connection.
if ((await page.locator(".react-flow__handle.connectable").count()) !== 0) fail("handles must not be connectable");

// Nesting: adding TodoItem's file (sidebar "Module" link) draws it as a frame around TodoItem, inside its folder.
await page.locator(".react-flow__controls-fitview").click();
await page.waitForTimeout(400);
await page.locator('.react-flow__node[data-id="components/TodoItem.tsx#TodoItem"]').click();
await page.locator("dl").getByRole("button", { name: "TodoItem.tsx", exact: true }).click();
await page.locator('.react-flow__node-frame[data-id="components/TodoItem.tsx"]').waitFor();
if ((await page.locator('.react-flow__node-frame[data-id^="dir:"]').count()) === 0) fail("expected a folder frame around the file");

// Dragging a card inside its file frame grows the frame (top-left corner fixed).
await page.locator(".react-flow__controls-fitview").click();
await page.waitForTimeout(500);
const frame = page.locator('.react-flow__node[data-id="components/TodoItem.tsx"]');
const card = page.locator('.react-flow__node[data-id="components/TodoItem.tsx#TodoItem"]');
const before = await frame.boundingBox();
const cb = await card.boundingBox();
if (before && cb) {
  await page.mouse.move(cb.x + 40, cb.y + 12);
  await page.mouse.down();
  await page.mouse.move(cb.x + 220, cb.y + 140, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await frame.boundingBox();
  if (!after || after.width * after.height <= before.width * before.height || Math.abs(after.x - before.x) > 1) fail(`frame did not grow around the dragged card: ${JSON.stringify({ before, after })}`);
}

// Delete removes the selection; undo brings it back, redo removes it again.
const count = () => page.locator(".react-flow__node").count();
await card.click();
const withCard = await count();
await page.keyboard.press("Delete");
await page.waitForTimeout(300);
if ((await count()) >= withCard) fail("Delete should remove the selected node");
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
await page.waitForTimeout(300);
if ((await count()) !== withCard) fail("undo should restore the removed node");
await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
await page.waitForTimeout(300);
if ((await count()) >= withCard) fail("redo should remove it again");
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
await page.waitForTimeout(400);

// The diagram is stored: a reload brings back the same nodes.
const stored = await count();
await page.reload();
await page.locator(".react-flow__node").first().waitFor();
await page.waitForTimeout(500);
if ((await count()) !== stored) fail(`diagram not restored after reload: ${await count()} vs ${stored}`);

// Libraries filter: showing react brings it back into relation lists.
await page.getByRole("button", { name: /Libraries/ }).click();
const dialog = page.getByRole("dialog");
await dialog.getByText("react", { exact: true }).click();
if (!(await dialog.getByRole("checkbox", { name: "react", exact: true }).isChecked())) fail("react checkbox did not toggle on");
await page.keyboard.press("Escape");
if ((await page.getByRole("button", { name: /Libraries \(1 hidden\)/ }).count()) !== 1) fail("toolbar should report 1 hidden library");

// Scan from the UI: pick the react-app fixture via the folder browser + path input.
const reactApp = new URL("../../fixtures/react-app", import.meta.url).pathname;
await page.getByRole("button", { name: "Scan a project…" }).click();
await page.getByPlaceholder(/path\/to\/app/).fill(reactApp);
if (outDir) await page.screenshot({ path: `${outDir}/scan-modal.png` });
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.getByText(/snapshot loaded/).waitFor({ timeout: 30000 });
if (outDir) await page.screenshot({ path: `${outDir}/scan-done.png` });
await page.getByRole("button", { name: "Close", exact: true }).first().click();
const status = await page.getByText(/files · \d+ shown/).first().textContent();
if (!status?.startsWith("react ·")) fail(`expected scanned react-app snapshot to be loaded, got "${status}"`);
if (errors.length) fail(`console errors:\n${errors.join("\n")}`);
if (!process.exitCode) console.log(`✔ viewer smoke test passed (${onCanvas} nodes on canvas)`);
await browser.close();
