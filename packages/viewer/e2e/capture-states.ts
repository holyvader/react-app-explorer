/**
 * Screenshots of every screen and state of the viewer, for a redesign brief (docs/redesign).
 * Runs against a dev server (window.__rae) with the next-shop-demo snapshot:
 *
 *   RAE_SNAPSHOTS=<next-shop-demo>/.explorer/snapshots node_modules/.bin/vite --port 5199 --strictPort
 *   PW_CHROMIUM_PATH=… bun e2e/capture-states.ts [outDir]
 */
import { chromium, type Page } from "playwright-core";

const out = process.argv[2] ?? "../../docs/redesign/screens";
const url = process.env.VIEWER_URL ?? "http://localhost:5199/";
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const p: Page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));

type Store = { getState: () => Record<string, any>; setState: (s: Record<string, unknown>) => void };
const st = <T,>(fn: (s: Store) => T) => p.evaluate(`(${fn.toString()})(window.__rae)`) as Promise<T>;
const wait = (ms = 700) => p.waitForTimeout(ms);
const shot = async (name: string) => {
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log("✔", name);
};
const fresh = async () => {
  await p.keyboard.press("Escape");
  await st((s) => {
    const g = s.getState();
    g.setSearchOpen(false);
    g.setQuickAdd(null);
    g.openMenu(null);
    g.inspect(undefined);
    g.setDetailsOpen(true);
    g.setTreeOpen(true);
    g.clear();
    s.setState({ pending: undefined, scan: undefined, notice: undefined });
  });
  await wait(300);
};
const draw = (ids: string[], select?: string) => st(new Function("s", `s.getState().addNodes(${JSON.stringify(ids)}, { fit: true, select: ${JSON.stringify(select)} })`) as (s: Store) => void);
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fresh();
    await fn();
  } catch (e) {
    console.log("✘", name, (e as Error).message.split("\n")[0]);
  }
};

await p.goto(url);
await p.evaluate(() => localStorage.clear());
await p.reload();
await wait(1800);

await step("01-welcome-no-snapshot", async () => {
  await st((s) => s.getState().unloadSnapshot());
  await wait();
  await shot("01-welcome-no-snapshot");
  await p.reload();
  await wait(1800);
});
await step("02-empty-diagram", async () => shot("02-empty-diagram"));
await step("03-component-selected", async () => {
  await draw(["components/Header.tsx#Header", "components/SearchBox.tsx#SearchBox", "components/CartBadge.tsx#CartBadge", "hooks/useCart.tsx#useCart", "components/Header.tsx"], "components/Header.tsx#Header");
  await wait(1500);
  await shot("03-component-selected");
});
await step("04-node-tooltip", async () => {
  await draw(["components/ProductCard.tsx#ProductCard", "components/AddToCartButton.tsx#AddToCartButton"]);
  await wait(1500);
  await p.locator('.react-flow__node[data-id="components/AddToCartButton.tsx#AddToCartButton"]').hover();
  await wait(1000);
  await shot("04-node-tooltip");
});
await step("05-context-menu", async () => {
  await draw(["components/Header.tsx#Header"], "components/Header.tsx#Header");
  await wait(1200);
  await p.locator('.react-flow__node[data-id="components/Header.tsx#Header"]').click({ button: "right" });
  await wait(400);
  await p.getByRole("menuitem").filter({ hasText: /^Renders/ }).first().hover().catch(() => {});
  await wait(500);
  await shot("05-context-menu");
});
await step("06-add-picker", async () => {
  await st((s) => s.getState().setSearchOpen(true));
  await wait(500);
  await p.keyboard.type("cart");
  await wait(500);
  await shot("06-add-picker");
});
await step("07-quick-add", async () => {
  await draw(["components/Header.tsx#Header"]);
  await wait(1200);
  const pane = (await p.locator(".react-flow__pane").boundingBox())!;
  await p.mouse.click(pane.x + 120, pane.y + 140, { button: "right" });
  await wait(600);
  await shot("07-quick-add");
});
const details = (name: string, id: string, extra: string[] = []) =>
  step(name, async () => {
    await draw([id, ...extra], id);
    await wait(1500);
    await shot(name);
  });
await details("08-details-hook", "hooks/useCart.tsx#useCart");
await details("09-details-type", "lib/types.ts#Paginated");
await details("10-details-route", "route:/(shop)/products/[id]");
await details("11-details-server-action", "lib/actions.ts#addToCart");
await details("12-details-file-frame", "components/Header.tsx", ["components/Header.tsx#Header"]);
await details("13-details-library", "ext:next/link");
await step("14-details-folder-inspected-from-tree", async () => {
  await p.getByRole("tree", { name: "Files" }).locator('[data-id="dir:components"]').click();
  await wait(700);
  await shot("14-details-folder-inspected-from-tree");
});
await step("15-routes-and-navigation", async () => {
  await draw(["route:/(shop)/products/[id]"], "route:/(shop)/products/[id]");
  await wait(800);
  await st((s) => s.getState().showRouteChain("route:/(shop)/products/[id]"));
  await wait(1500);
  await shot("15-routes-and-navigation");
});
await step("16-children-grid", async () => {
  await draw(["components/Header.tsx#Header"], "components/Header.tsx#Header");
  await wait(1000);
  await st((s) => s.getState().expand("components/Header.tsx#Header", "children", false));
  await wait(1800);
  await shot("16-children-grid");
});
await step("17-scan-dialog", async () => {
  await p.getByRole("button", { name: "Scan a project…" }).click();
  await wait(800);
  await shot("17-scan-dialog");
});
await step("18-scan-progress", async () => {
  await draw(["components/Header.tsx#Header"]);
  await wait(800);
  await st((s) =>
    s.setState({
      scan: { path: "/Users/me/IdeaProjects/next-shop-demo", phase: "types", stage: "types", parse: { done: 1820, total: 1820 }, types: { done: 640, total: 1820, loading: false, since: Date.now() - 4000 }, withTypes: true, startedAt: Date.now() - 6200, file: "x.json" },
    }),
  );
  await wait(500);
  await shot("18-scan-progress");
});
await step("19-snapshots-dialog", async () => {
  await p.getByRole("button", { name: "Manage snapshots…" }).click();
  await wait(800);
  await shot("19-snapshots-dialog");
});
await step("20-libraries-dialog", async () => {
  await p.getByRole("button", { name: /^Libraries/ }).click();
  await wait(800);
  await shot("20-libraries-dialog");
});
await step("21-keyboard-shortcuts", async () => {
  await p.getByRole("button", { name: /Keyboard shortcuts/ }).click();
  await wait(500);
  await shot("21-keyboard-shortcuts");
});
await step("22-panels-minimized", async () => {
  await draw(["hooks/useCart.tsx#useCart", "components/CartBadge.tsx#CartBadge"], "hooks/useCart.tsx#useCart");
  await wait(1000);
  await st((s) => {
    s.getState().setDetailsOpen(false);
    s.getState().setTreeOpen(false);
  });
  await wait(900);
  await shot("22-panels-minimized");
});
await step("23-confirm-large-expansion", async () => {
  await draw(["components/Header.tsx#Header"]);
  await wait(800);
  await st((s) => s.setState({ pending: { ids: Array.from({ length: 140 }, (_, i) => `x${i}`), label: "All children of Header", anchor: "components/Header.tsx#Header" } }));
  await wait(600);
  await shot("23-confirm-large-expansion");
});
await step("24-notice", async () => {
  await draw(["components/Header.tsx#Header"]);
  await wait(800);
  await st((s) => s.getState().notify("Couldn't open the editor: IntelliJ IDEA isn't installed, or doesn't handle idea:// links."));
  await wait(500);
  await shot("24-notice");
});
await step("25-big-diagram", async () => {
  const ids = await st((s) => Object.keys(s.getState().snapshot.nodes).filter((id: string) => !id.startsWith("ext:") && !id.startsWith("asset:")).slice(0, 60));
  await draw(ids, "components/Header.tsx#Header");
  await wait(2500);
  await shot("25-big-diagram");
});
console.log("errors:", errors.length ? errors : "none");
await b.close();
