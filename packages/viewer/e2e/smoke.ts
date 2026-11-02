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
// (the status text only shows on wide screens; it's always in the DOM)
await page.getByText(/^next-app · \d+ files/).waitFor({ state: "attached" });
await page.getByText("Empty diagram").waitFor();
// Add the way noesis does: "Start exploration" opens the picker; filter, Enter picks the first match.
await page.getByRole("button", { name: "Start exploration" }).click();
await page.getByLabel("Filter elements").fill("HomePage");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Done" }).click();
// Select it so the details panel opens.
await page.locator('.react-flow__node[data-id="app/page.tsx#HomePage"]').click({ position: { x: 60, y: 14 } });
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
// the sidebar header shows the file a component is declared in, as a chip
await page.getByRole("button", { name: "TodoItem.tsx", exact: true }).first().click();
await page.locator('.react-flow__node-frame[data-id="components/TodoItem.tsx"]').waitFor();
if ((await page.locator('.react-flow__node-frame[data-id^="dir:"]').count()) === 0) fail("expected a folder frame around the file");

const frame = page.locator('.react-flow__node[data-id="components/TodoItem.tsx"]');
const card = page.locator('.react-flow__node[data-id="components/TodoItem.tsx#TodoItem"]');
await page.locator(".react-flow__controls-fitview").click();
await page.waitForTimeout(500);

// A file's only element is placed automatically and can't be dragged: dragging it pans instead.
{
  const f0 = (await frame.boundingBox())!;
  const c0 = (await card.boundingBox())!;
  await page.mouse.move(c0.x + 40, c0.y + 12);
  await page.mouse.down();
  await page.mouse.move(c0.x + 140, c0.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const f1 = (await frame.boundingBox())!;
  const c1 = (await card.boundingBox())!;
  if (Math.abs(c1.x - f1.x - (c0.x - f0.x)) > 1 || Math.abs(c1.y - f1.y - (c0.y - f0.y)) > 1) fail("the only element in a file should not move inside it");
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(500);
}

// Dragging a frame (by its header) inside its folder grows the folder (top-left corner fixed).
const folder = page.locator('.react-flow__node[data-id="dir:components"]');
const before = await folder.boundingBox();
const hb = await frame.locator(".rae-frame__header").boundingBox();
if (before && hb) {
  await page.mouse.move(hb.x + 20, hb.y + 10);
  await page.mouse.down();
  await page.mouse.move(hb.x + 260, hb.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await folder.boundingBox();
  if (!after || after.width * after.height <= before.width * before.height || Math.abs(after.x - before.x) > 1)
    fail(`folder did not grow around the dragged file: ${JSON.stringify({ before, after })}`);
}

// Folders are selectable from their header (like dragging); details show what they contain.
await page.locator('.react-flow__node[data-id="dir:components"] .rae-frame__header').click({ position: { x: 120, y: 20 } });
await page.getByText(/^Folder · \d+ files?/).waitFor();
// …and a frame's content area acts as empty canvas: a click there clears the selection.
{
  // (the sidebar is open on the right now: click near the room's bottom-left, clear of it)
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(400);
  const room = (await page.locator('.react-flow__node[data-id="components/TodoItem.tsx"] .rae-frame__room').boundingBox())!;
  await page.mouse.click(room.x + 6, room.y + room.height - 5);
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => (window as unknown as { __rae: { getState: () => { selection: string[] } } }).__rae.getState().selection);
  if (sel.length) fail(`clicking a frame's content should clear the selection, got ${JSON.stringify(sel)}`);
}

// Selecting highlights related nodes and edges; the rest fades.
await card.click();
await page.waitForTimeout(200);
if ((await page.locator(".rae-canvas[data-selection]").count()) !== 1) fail("selection should mark the canvas");
if ((await page.locator(".react-flow__node.rae-related").count()) === 0) fail("selecting should highlight related nodes");

// Right-click: actions and relations (e.g. "Rendered by"), each listing related elements.
await card.click({ button: "right" });
await page.getByRole("menuitem", { name: /^Rendered by/ }).hover();
await page.getByRole("menuitem", { name: /^Show all|^All shown/ }).first().waitFor();
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

// Dragging inside a folder frame's empty room pans the diagram.
const room = page.locator('.react-flow__node-frame[data-id^="dir:"] .rae-frame__room').first();
const rb = await room.boundingBox();
const viewport = () => page.evaluate(() => document.querySelector(".react-flow__viewport")!.getAttribute("style"));
if (rb) {
  const v0 = await viewport();
  await page.mouse.move(rb.x + 6, rb.y + 6);
  await page.mouse.down();
  await page.mouse.move(rb.x + 106, rb.y + 56, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  if ((await viewport()) === v0) fail("dragging inside a frame should pan the diagram");
}

// Space opens the picker (noesis shortcut).
await page.keyboard.press(" ");
await page.getByLabel("Filter elements").waitFor();
await page.keyboard.press("Escape");
await page.getByLabel("Filter elements").waitFor({ state: "detached" });

// Right-click on the empty canvas: quick add right there.
await page.locator(".react-flow__pane").click({ button: "right", position: { x: 30, y: 30 } });
await page.getByPlaceholder(/Add here/).waitFor();
await page.keyboard.press("Escape");
await page.getByPlaceholder(/Add here/).waitFor({ state: "detached" });

// Delete removes the selection; undo brings it back, redo removes it again.
const count = () => page.locator(".react-flow__node").count();
// Esc clears the selection (clicking a selected node again would let go of it).
await page.keyboard.press("Escape");
await page.waitForTimeout(350); // let any glide settle before clicking
await card.click();
const selected = await page.evaluate(() => (window as unknown as { __rae: { getState: () => { selection: string[] } } }).__rae.getState().selection);
if (!selected.includes("components/TodoItem.tsx#TodoItem")) fail(`clicking the card should select it, got ${JSON.stringify(selected)}`);
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

// The diagram is stored: a reload brings back the same elements (compared in the store, since
// only elements in the viewport are rendered).
const drawnIds = () => page.evaluate(() => (window as unknown as { __rae: { getState: () => { visible: string[] } } }).__rae.getState().visible.slice().sort().join(","));
const stored = await drawnIds();
await page.reload();
await page.locator(".react-flow__node").first().waitFor();
await page.waitForTimeout(500);
if ((await drawnIds()) !== stored) fail("diagram not restored after reload");

// Libraries filter: showing react brings it back into relation lists.
await page.getByRole("button", { name: /Libraries/ }).click();
const dialog = page.getByRole("dialog");
await dialog.getByText("react", { exact: true }).click();
if (!(await dialog.getByRole("checkbox", { name: "react", exact: true }).isChecked())) fail("react checkbox did not toggle on");
await page.keyboard.press("Escape");
if ((await page.getByRole("button", { name: /^Libraries\s*1$/ }).count()) !== 1) fail("toolbar should report 1 hidden library");

// Scan from the UI: pick the react-app fixture via the folder browser + path input.
const reactApp = new URL("../../fixtures/react-app", import.meta.url).pathname;
await page.getByRole("button", { name: "Scan a project…" }).click();
await page.getByPlaceholder(/path\/to\/app/).fill(reactApp);
if (outDir) await page.screenshot({ path: `${outDir}/scan-modal.png` });
await page.getByRole("button", { name: "Scan", exact: true }).click();
// The dialog closes right away; a progress panel over the canvas follows files, then types.
await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
await page.getByText("Scan finished").waitFor({ timeout: 30000 });
if (outDir) await page.screenshot({ path: `${outDir}/scan-done.png` });
const typed = await page.evaluate(() => (window as any).__rae.getState().snapshot.stats.types);
if (!typed) fail("the typed snapshot should replace the structure-only one after the type pass");
const status = await page.getByText(/files · \d+ shown/).first().textContent();
if (!status?.startsWith("react ·")) fail(`expected scanned react-app snapshot to be loaded, got "${status}"`);
if (errors.length) fail(`console errors:\n${errors.join("\n")}`);
if (!process.exitCode) console.log(`✔ viewer smoke test passed (${onCanvas} nodes on canvas)`);
await browser.close();
