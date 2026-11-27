/**
 * Headless smoke test of the viewer.
 * Prereq: `bun run scan packages/fixtures/next-app --no-merge` (it checks files holding declarations) and a running dev server:
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

// A server without snapshots shows the welcome screen, never the diagram: say why up front.
const list = (await (await fetch(new URL("api/snapshots", url))).json()) as { dir: string; snapshots: unknown[] };
if (!list.snapshots.length)
  throw new Error(`the server has no snapshots in ${list.dir}: RAE_SNAPSHOTS is relative to the repo root (packages/fixtures/next-app/.explorer/snapshots), and run \`bun run scan packages/fixtures/next-app --no-merge\` first`);

// The app reads the open project again on start (a quiet refresh that replaces the snapshot and
// deletes older ones): keep it unmerged, as the test needs files holding declarations.
// Earlier runs open react-app from the UI into the same folder: start from next-app's newest snapshot.
const nextApp = (list.snapshots as { file: string; rootDir?: string; createdAt: string }[])
  .filter((x) => x.rootDir?.endsWith("next-app"))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
if (!nextApp) throw new Error("no next-app snapshot: run `bun run scan packages/fixtures/next-app --no-merge` first");
// (only before the app has stored its own: a reload later must keep what it shows)
await page.addInitScript((file) => {
  localStorage.setItem("rae.scanMerge", "false");
  if (!localStorage.getItem("rae.lastSnapshot")) localStorage.setItem("rae.lastSnapshot", JSON.stringify(file));
}, nextApp.file);
await page.goto(url);
// It opens the last snapshot shown (set above).
const store = <T,>(read: string) => page.evaluate((r) => new Function("s", `return ${r}`)((window as any).__rae.getState()), read) as Promise<T>;
await page.waitForFunction(() => (window as any).__rae?.getState().snapshot, null, { timeout: 15000 });
if (!(await store<string>("s.snapshot.rootDir")).endsWith("next-app")) throw new Error("next-app's snapshot didn't open");
// …and lets that refresh finish (it starts within a moment of the page), so the snapshot isn't swapped mid-test
for (let t = 0, seen = false; t < 120; t++) {
  const phase = await store<string | undefined>("s.scan?.phase");
  if (phase) seen = true;
  if ((seen && ["typed", "failed", "cancelled"].includes(phase!)) || (!seen && t >= 10)) break;
  await page.waitForTimeout(500);
}
await page
  .waitForFunction(() => !!(window as any).__rae.getState().snapshot?.nodes["components/TodoItem.tsx#TodoItem"], null, { timeout: 15000 })
  .catch(() => {
    throw new Error("the snapshot merged single-declaration files: scan with `--no-merge`");
  });
await page.getByText("Empty diagram").waitFor();
// Adding: "Start exploration" opens the picker; filter, Enter picks the first match.
await page.getByRole("button", { name: "Start exploration" }).click();
await page.getByLabel("Filter elements").fill("HomePage");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Done" }).click();
// Select it so the details panel opens.
await page.locator('.react-flow__node[data-id="app/page.tsx#HomePage"]').click({ position: { x: 60, y: 14 } });
await page.locator(".react-flow__node").first().waitFor();
if ((await page.getByText("Render tree").count()) === 0) fail("details panel did not open");
// A declaration comes with its file (Settings → "Add with their file"): drawn as the file's row.
if ((await page.locator('.react-flow__node-frame[data-id="app/page.tsx"]').count()) !== 1) fail("adding a component must draw it in its file");
if ((await store<string[]>("s.visible")).length !== 2) fail("adding a component must draw it and its file only");

// One level at a time from the node's buttons, and the deep ones ("the render tree"…) offered too.
await page.locator('.react-flow__node[data-id="app/page.tsx#HomePage"]').hover();
await page.getByRole("button", { name: /^Renders \(/ }).first().click();
await page.waitForTimeout(600);
const onCanvas = await store<number>("s.visible.length");
if (!(onCanvas > 2)) fail(`expected expansion to add nodes, got ${onCanvas}`);
await page.locator('.react-flow__node[data-id="app/page.tsx#HomePage"]').hover();
if ((await page.getByRole("button", { name: "Show the render tree" }).count()) + (await store<number>("s.visible.length")) === 0) fail("the render tree should be offered");
if (outDir) await page.screenshot({ path: `${outDir}/smoke.png` });

if ((await page.locator('.react-flow__node[data-id="ext:react"]').count()) !== 0) fail("react should be hidden by default");
// Read-only diagram: no handle can start a connection.
if ((await page.locator(".react-flow__handle.connectable").count()) !== 0) fail("handles must not be connectable");

// Nesting: TodoItem added from the picker comes in a frame of its file.
// Folders are nodes of their own: never drawn automatically around files.
await page.keyboard.press(" ");
await page.getByLabel("Filter elements").fill("TodoItem");
await page.locator('[role=treeitem][data-id="components/TodoItem.tsx#TodoItem"]').click();
await page.getByRole("button", { name: "Done" }).click();
await page.locator('.react-flow__node-frame[data-id="components/TodoItem.tsx"]').waitFor({ state: "attached" });
if ((await page.locator('.react-flow__node[data-id^="dir:"]').count()) !== 0) fail("no folder should be drawn around the file");

const frame = page.locator('.react-flow__node[data-id="components/TodoItem.tsx"]');
const card = page.locator('.react-flow__node[data-id="components/TodoItem.tsx#TodoItem"]');
await page.getByRole("button", { name: "Fit everything" }).click();
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
  await page.getByRole("button", { name: "Fit everything" }).click();
  await page.waitForTimeout(500);
}

// …and a frame's content area acts as empty canvas: a click there clears the selection.
{
  // (select something first, so there's a selection to clear)
  await card.click();
  await page.getByRole("button", { name: "Fit everything" }).click();
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

// Right-click: actions and relations (e.g. "Components rendering it"), each listing related
// elements, with "Show all" first (it asks before adding many).
await card.click({ button: "right" });
await page.getByRole("menuitem", { name: /^Components rendering it/ }).hover();
await page.waitForTimeout(300);
if ((await page.getByRole("menuitem", { name: /^Show all|^All shown/ }).count()) === 0) fail("relation menus should offer Show all");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

// Dragging inside a frame's empty room pans the diagram.
const room = page.locator('.react-flow__node-frame[data-id="components/TodoItem.tsx"] .rae-frame__room').first();
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

// Space opens the picker.
await page.keyboard.press(" ");
await page.getByLabel("Filter elements").waitFor();
await page.keyboard.press("Escape");
await page.getByLabel("Filter elements").waitFor({ state: "detached" });

// Right-click on the empty canvas: the same picker as Space, opened right there.
await page.locator(".react-flow__pane").click({ button: "right", position: { x: 30, y: 120 } });
await page.getByLabel("Filter elements").waitFor();
await page.keyboard.press("Escape");
await page.getByLabel("Filter elements").waitFor({ state: "detached" });

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
await page.getByRole("button", { name: "Settings (⌘,)" }).click();
await page.getByRole("button", { name: "Choose…" }).click();
const dialog = page.getByRole("dialog");
await dialog.getByText("react", { exact: true }).click();
if (!(await dialog.getByRole("checkbox", { name: "react", exact: true }).isChecked())) fail("react checkbox did not toggle on");
await page.keyboard.press("Escape");
// the settings sheet stays docked: it shows the new count
if ((await page.getByText("1 hidden", { exact: true }).count()) !== 1) fail("settings should report 1 hidden library");
// ⌘, closes it
await page.keyboard.press("Meta+Comma");
if ((await page.getByRole("complementary", { name: "Settings" }).count()) !== 0) fail("⌘, should close the settings");

// Opening a project from the UI: the react-app fixture, its path typed in the Open dialog.
const reactApp = new URL("../../fixtures/react-app", import.meta.url).pathname;
await page.getByRole("button", { name: "Open project…" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Edit path" }).click();
await page.getByPlaceholder(/path\/to\/app/).fill(reactApp);
await page.getByRole("dialog").getByRole("button", { name: "Go", exact: true }).click();
if (outDir) await page.screenshot({ path: `${outDir}/scan-modal.png` });
await page.getByRole("dialog").getByRole("button", { name: "Open react-app", exact: true }).click();
// The dialog closes right away; a progress panel over the canvas follows files, then types.
await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
await page.getByText("Opened react-app").waitFor({ timeout: 60000 });
if (outDir) await page.screenshot({ path: `${outDir}/scan-done.png` });
const typed = await page.evaluate(() => (window as any).__rae.getState().snapshot.stats.types);
if (!typed) fail("the typed snapshot should replace the structure-only one after the type pass");
const root = await store<string>("s.snapshot.rootDir");
if (!root.endsWith("react-app")) fail(`expected scanned react-app snapshot to be loaded, got "${root}"`);
if (errors.length) fail(`console errors:\n${errors.join("\n")}`);
if (!process.exitCode) console.log(`✔ viewer smoke test passed (${onCanvas} nodes on canvas)`);
await browser.close();
