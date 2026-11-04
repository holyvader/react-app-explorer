import { describe, expect, test } from "bun:test";
import type { Snapshot } from "@rae/schema";
import { scan } from "../../scanner/src/scan.ts";
import { drawnGraph } from "../src/graph/drawn.ts";
import { CARD_HEIGHT, layoutAll, PADDING, type PlacedElement } from "../src/graph/layout.ts";
import { DEFAULT_EXCLUDED, packageOf } from "../src/graph/packages.ts";
import { absoluteRect, autoPlaceSoleChildren, movedTo, placeLocally } from "../src/graph/placement.ts";

// A fresh snapshot of the Next.js fixture (no cache, no types: fast and independent of files on disk).
let cached: Promise<Snapshot> | undefined;
const loadSnapshot = (): Promise<Snapshot> =>
  (cached ??= scan(new URL("../../fixtures/next-app", import.meta.url).pathname, { cache: false, types: false, mergeSingleExport: false }));

const ALL = { imports: true, declares: true, renders: true, hooks: true, invokes: true, types: true, navigation: true, cache: true };
const opts = (o: Partial<{ folders: boolean; excluded: string[]; hideAll: boolean }> = {}) => ({
  enabled: ALL,
  folders: o.folders ?? true,
  filter: { excluded: new Set(o.excluded ?? DEFAULT_EXCLUDED), hideAll: o.hideAll ?? false },
});

const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("packages", () => {
  test("packageOf", () => {
    expect(packageOf("react")).toBe("react");
    expect(packageOf("next/link")).toBe("next");
    expect(packageOf("@tanstack/react-query/devtools")).toBe("@tanstack/react-query");
    expect(packageOf("node:fs")).toBe("node");
  });
});

describe("drawnGraph", async () => {
  const s = await loadSnapshot();

  test("adding a declaration draws just that declaration", () => {
    const g = drawnGraph(s, ["components/TodoItem.tsx#TodoItem"], opts());
    expect(g.elements.map((e) => e.id)).toEqual(["components/TodoItem.tsx#TodoItem"]);
    expect(g.elements[0]!.parent).toBeNull();
  });

  test("a declaration sits in its file module when that module is drawn, inside its folder", () => {
    const g = drawnGraph(s, ["components/TodoItem.tsx", "components/TodoItem.tsx#TodoItem"], opts());
    const byId = new Map(g.elements.map((e) => [e.id, e]));
    expect(byId.get("components/TodoItem.tsx#TodoItem")!.parent).toBe("components/TodoItem.tsx");
    expect(byId.get("components/TodoItem.tsx")!.parent).toBe("dir:components");
    expect(byId.get("dir:components")!.parent).toBeNull();
  });

  test("folder chains holding one folder are compressed", () => {
    const g = drawnGraph(s, ["app/dashboard/page.tsx"], opts());
    const dir = g.elements.find((e) => e.kind === "folder")!;
    expect(dir.id).toBe("dir:app/dashboard");
    expect(dir.name).toBe("app/dashboard");
    // Adding a file in app/ splits the chain; the deep folder keeps its id.
    const g2 = drawnGraph(s, ["app/dashboard/page.tsx", "app/page.tsx"], opts());
    const deep = g2.elements.find((e) => e.id === "dir:app/dashboard")!;
    expect(deep.name).toBe("dashboard");
    expect(deep.parent).toBe("dir:app");
  });

  test("an explicitly added folder is drawn even with nothing inside, and holds files added later", () => {
    const alone = drawnGraph(s, ["dir:components"], opts());
    expect(alone.elements).toEqual([{ id: "dir:components", kind: "folder", name: "components", parent: null }]);
    const withFile = drawnGraph(s, ["dir:components", "components/TodoList.tsx"], opts());
    expect(withFile.elements.find((e) => e.id === "components/TodoList.tsx")!.parent).toBe("dir:components");
    // an explicit folder isn't collapsed into a chain: app/ stays its own frame around app/dashboard
    const chain = drawnGraph(s, ["dir:app", "app/dashboard/page.tsx"], opts());
    expect(chain.elements.find((e) => e.id === "dir:app/dashboard")!.parent).toBe("dir:app");
  });

  test("without folders, files are top level", () => {
    const g = drawnGraph(s, ["components/TodoItem.tsx"], opts({ folders: false }));
    expect(g.elements.find((e) => e.id === "components/TodoItem.tsx")!.parent).toBeNull();
    expect(g.elements.some((e) => e.kind === "folder")).toBe(false);
  });

  test("library filter: react hidden by default, others shown unless hideAll", () => {
    expect(drawnGraph(s, ["ext:react"], opts()).elements).toHaveLength(0);
    expect(drawnGraph(s, ["ext:clsx"], opts()).elements).toHaveLength(1);
    expect(drawnGraph(s, ["ext:clsx"], opts({ hideAll: true })).elements).toHaveLength(0);
    expect(drawnGraph(s, ["ext:react"], opts({ excluded: [] })).elements).toHaveLength(1);
  });

  test("containment is not drawn as edges", () => {
    const g = drawnGraph(s, ["components/TodoItem.tsx", "components/TodoItem.tsx#TodoItem"], opts());
    expect(g.relations.some((r) => r.edge.kind === "declares")).toBe(false);
  });
});

describe("placement", async () => {
  const s = await loadSnapshot();
  const visible = ["app/page.tsx", "app/page.tsx#HomePage", "components/TodoList.tsx", "components/TodoList.tsx#TodoList"];
  const g1 = drawnGraph(s, visible, opts());
  const p1 = await layoutAll(g1);

  test("ELK sizes frames around what they hold", () => {
    const file = p1.find((p) => p.element.id === "app/page.tsx")!;
    const decl = p1.find((p) => p.element.id === "app/page.tsx#HomePage")!;
    expect(file.holds).toBe(true);
    expect(decl.x).toBeGreaterThanOrEqual(PADDING.left);
    expect(decl.y).toBeGreaterThanOrEqual(PADDING.top);
    expect(file.height).toBeGreaterThanOrEqual(decl.y + CARD_HEIGHT + PADDING.bottom - 1);
  });

  test("adding a sibling grows the frame and keeps the rest in place", () => {
    const g2 = drawnGraph(s, [...visible, "components/TodoItem.tsx"], opts());
    const p2 = placeLocally(p1, g2, "components/TodoList.tsx#TodoList")!;
    expect(p2).not.toBeNull();
    // The page file didn't move.
    expect(absoluteRect(p2, "app/page.tsx")).toEqual(absoluteRect(p1, "app/page.tsx")!);
    // New file landed inside the components folder, which grew around it.
    const folder = absoluteRect(p2, "dir:components")!;
    const item = absoluteRect(p2, "components/TodoItem.tsx")!;
    expect(item.x).toBeGreaterThanOrEqual(folder.x);
    expect(item.x + item.width).toBeLessThanOrEqual(folder.x + folder.width);
    expect(item.y + item.height).toBeLessThanOrEqual(folder.y + folder.height);
    // Siblings at the same level never overlap.
    const tops = p2.filter((p) => p.element.parent === null).map((p) => absoluteRect(p2, p.element.id)!);
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) expect(overlap(tops[i]!, tops[j]!)).toBe(false);
  });

  test("a declaration without its file drawn goes into the nearest drawn folder", () => {
    const g = drawnGraph(s, ["components/TodoList.tsx", "components/TodoItem.tsx#TodoItem"], opts());
    expect(g.elements.find((e) => e.id === "components/TodoItem.tsx#TodoItem")!.parent).toBe("dir:components");
  });

  test("a card dropped into another frame lands just outside it", () => {
    // TodoList's file module dropped onto the app/ page frame → stays out of it.
    const target = absoluteRect(p1, "app/page.tsx")!;
    const moved = movedTo(p1, g1, "components/TodoList.tsx", { x: target.x + 10, y: target.y + 10 })!;
    expect(moved).not.toBeNull();
    const file = moved.find((p) => p.element.id === "components/TodoList.tsx")!;
    expect(file.element.parent).toBe("dir:components");
    const abs = absoluteRect(moved, "components/TodoList.tsx")!;
    const page = absoluteRect(moved, "app/page.tsx")!;
    expect(overlap(abs, page)).toBe(false);
  });

  test("moving a child refits its parent (grows, and shrinks back)", () => {
    const decl = "components/TodoList.tsx#TodoList";
    const before = absoluteRect(p1, "components/TodoList.tsx")!;
    const d = absoluteRect(p1, decl)!;
    const grown = movedTo(p1, g1, decl, { x: d.x + 300, y: d.y + 200 })!;
    const after = absoluteRect(grown, "components/TodoList.tsx")!;
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.x).toBe(before.x); // top-left corner stays
    const back = movedTo(grown, g1, decl, d)!;
    expect(absoluteRect(back, "components/TodoList.tsx")!.width).toBe(before.width);
  });

  test("removing a declaration leaves the frame a card again", () => {
    const g3 = drawnGraph(s, ["app/page.tsx", "components/TodoList.tsx", "components/TodoList.tsx#TodoList"], opts());
    const p3 = placeLocally(p1, g3, null)!;
    const file = p3.find((p) => p.element.id === "app/page.tsx")!;
    expect(file.holds).toBe(false);
    expect(file.height).toBe(CARD_HEIGHT);
  });
});

export type { PlacedElement };

describe("auto-placement", () => {
  test("sole element moves to the room's corner and the frame shrinks around it", () => {
    const el = (id: string, kind: "module" | "function" | "folder", parent: string | null) => ({ id, kind, name: id, parent });
    const placed: PlacedElement[] = [
      { element: el("dir:lib", "folder", null), holds: true, x: 0, y: 0, width: 900, height: 600 },
      { element: el("lib/data.ts", "module", "dir:lib"), holds: true, x: 16, y: 60, width: 800, height: 500 },
      { element: el("lib/data.ts#getUser", "function", "lib/data.ts"), holds: false, x: 400, y: 300, width: 230, height: CARD_HEIGHT },
      // a folder with one file: left alone
      { element: el("dir:other", "folder", null), holds: true, x: 1000, y: 0, width: 600, height: 400 },
      { element: el("other/x.ts", "module", "dir:other"), holds: false, x: 200, y: 200, width: 230, height: CARD_HEIGHT },
    ];
    const out = autoPlaceSoleChildren(placed);
    const by = new Map(out.map((p) => [p.element.id, p]));
    expect(by.get("lib/data.ts#getUser")).toMatchObject({ x: PADDING.left, y: PADDING.top });
    expect(by.get("lib/data.ts")!.height).toBe(CARD_HEIGHT + PADDING.top + PADDING.bottom);
    expect(by.get("lib/data.ts")).toMatchObject({ x: 16, y: 60 }); // top-left corner kept
    expect(by.get("other/x.ts")).toMatchObject({ x: 200, y: 200 }); // folders aren't touched
  });
});

describe("isPrimitiveType: primitives get no type tooltip", () => {
  const { isPrimitiveType } = require("../src/lib/typeText.ts") as typeof import("../src/lib/typeText.ts");
  test("primitives and literals", () => {
    for (const t of ["string", "number | undefined", "boolean[]", '"a" | "b"', "'x' | 1 | true", "null", "void", "(string | number)[]", "unknown", "-1 | 0n"])
      expect([t, isPrimitiveType(t)]).toEqual([t, true]);
  });
  test("anything that names or shapes something", () => {
    for (const t of ["User", "Promise<void>", "{ a: string }", "() => void", "string[] | Todo", "Record<string, number>", "React.ReactNode", "Element"])
      expect([t, isPrimitiveType(t)]).toEqual([t, false]);
  });
});


describe("routeChain: what renders a URL, root first", () => {
  const { routeChain, routeOf } = require("../src/graph/drawn.ts") as typeof import("../src/graph/drawn.ts");
  const route = (id: string, parent: string | undefined, files: Record<string, string>, kind: "page" | "segment" = "segment") => ({
    id,
    kind: "route" as const,
    name: id,
    filePath: id,
    route: { url: "/", segment: "", segmentKind: "static" as const, params: [], kind, files, parent },
  });
  const mod = (id: string) => ({ id, kind: "module" as const, name: id, filePath: id });
  const snap = {
    nodes: Object.fromEntries(
      [
        route("route:/", undefined, { layout: "app/layout.tsx", "not-found": "app/not-found.tsx" }),
        route("route:/(shop)", "route:/", { layout: "app/(shop)/layout.tsx" }),
        route("route:/(shop)/p/[id]", "route:/(shop)", { page: "app/(shop)/p/[id]/page.tsx", loading: "app/(shop)/p/[id]/loading.tsx" }, "page"),
        route("route:/(shop)/other", "route:/(shop)", { page: "app/(shop)/other/page.tsx" }, "page"),
        mod("app/layout.tsx"),
        mod("app/not-found.tsx"),
        mod("app/(shop)/layout.tsx"),
        mod("app/(shop)/p/[id]/page.tsx"),
        mod("app/(shop)/p/[id]/loading.tsx"),
        { id: "app/(shop)/p/[id]/page.tsx#Product", kind: "component" as const, name: "Product", filePath: "x", moduleId: "app/(shop)/p/[id]/page.tsx" },
      ].map((n) => [n.id, n]),
    ),
    edges: [],
  } as unknown as Parameters<typeof routeChain>[0];
  test("layouts and shared files of every enclosing route, then the route's own page — not its siblings'", () => {
    expect(routeChain(snap, "route:/(shop)/p/[id]")).toEqual([
      "route:/",
      "app/layout.tsx",
      "app/not-found.tsx",
      "route:/(shop)",
      "app/(shop)/layout.tsx",
      "route:/(shop)/p/[id]",
      "app/(shop)/p/[id]/loading.tsx",
      "app/(shop)/p/[id]/page.tsx",
    ]);
  });
  test("the middleware that runs before the route comes first", () => {
    const withMw = {
      ...snap,
      nodes: {
        ...snap.nodes,
        "proxy.ts": { id: "proxy.ts", kind: "module", name: "proxy.ts", filePath: "proxy.ts", middleware: { matchers: [] } },
        "route:/(shop)/p/[id]": { ...snap.nodes["route:/(shop)/p/[id]"]!, route: { ...snap.nodes["route:/(shop)/p/[id]"]!.route!, middleware: { id: "proxy.ts" } } },
      },
    } as typeof snap;
    expect(routeChain(withMw, "route:/(shop)/p/[id]")[0]).toBe("proxy.ts");
    expect(routeChain(withMw, "route:/(shop)/other")).not.toContain("proxy.ts");
  });

  test("a page's component and its file lead to their route", () => {
    expect(routeOf(snap, "app/(shop)/p/[id]/page.tsx#Product")).toBe("route:/(shop)/p/[id]");
    expect(routeOf(snap, "app/(shop)/p/[id]/page.tsx")).toBe("route:/(shop)/p/[id]");
    expect(routeOf(snap, "app/(shop)/layout.tsx")).toBe("route:/(shop)");
  });
  test("drawn routes nest like files hold declarations: in the nearest drawn parent route, nothing added", () => {
    const g = drawnGraph(snap, ["route:/", "route:/(shop)/p/[id]", "app/(shop)/p/[id]/page.tsx", "app/(shop)/p/[id]/page.tsx#Product", "app/layout.tsx"], opts({ folders: false }));
    const parent = Object.fromEntries(g.elements.map((e) => [e.id, e.parent]));
    expect(parent).toEqual({
      "route:/": null,
      // (shop) isn't drawn: no frame for it, the page route sits straight in the root route
      "route:/(shop)/p/[id]": "route:/",
      "app/(shop)/p/[id]/page.tsx": "route:/(shop)/p/[id]",
      "app/(shop)/p/[id]/page.tsx#Product": "app/(shop)/p/[id]/page.tsx",
      "app/layout.tsx": "route:/",
    });
    // a route with no drawn parent, and a declaration whose file isn't drawn: in their route
    const alone = drawnGraph(snap, ["route:/(shop)/p/[id]", "app/(shop)/p/[id]/page.tsx#Product"], opts({ folders: false }));
    expect(Object.fromEntries(alone.elements.map((e) => [e.id, e.parent]))).toEqual({ "route:/(shop)/p/[id]": null, "app/(shop)/p/[id]/page.tsx#Product": "route:/(shop)/p/[id]" });
  });
});

describe("merged scan: a declaration standing for its file", async () => {
  const { buildTree } = await import("../src/graph/tree.ts");
  const s = await scan(new URL("../../fixtures/next-app", import.meta.url).pathname, { cache: false, types: false });

  test("drawn as a file: inside its folder frame, and in its route frame", () => {
    const g = drawnGraph(s, ["app/page.tsx", "components/TodoList.tsx"], opts());
    const byId = new Map(g.elements.map((e) => [e.id, e]));
    expect(byId.get("app/page.tsx")).toMatchObject({ kind: "component", name: "HomePage", parent: "dir:app" });
    expect(byId.get("components/TodoList.tsx")).toMatchObject({ kind: "component", parent: "dir:components" });
    expect(g.relations.some((r) => r.edge.kind === "renders" && r.source === "app/page.tsx" && r.target === "components/TodoList.tsx")).toBe(true);
    const routed = drawnGraph(s, ["app/page.tsx"], { ...opts(), routes: true });
    expect(routed.elements.find((e) => e.id === "app/page.tsx")!.parent).toBe("route:/");
  });

  test("in the tree: a declaration row where the file was", () => {
    const tree = buildTree(s, { excluded: new Set(), hideAll: false });
    const app = tree.find((n) => n.key === "dir:app")!;
    const row = app.children.find((c) => c.id === "app/page.tsx")!;
    expect(row).toMatchObject({ kind: "decl", name: "HomePage", file: true, children: [] });
  });
});
