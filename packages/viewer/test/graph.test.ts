import { describe, expect, test } from "bun:test";
import type { Snapshot } from "@rae/schema";
import { scan } from "../../scanner/src/scan.ts";
import { type DrawnElement, type DrawnGraph, drawnGraph } from "../src/graph/drawn.ts";
import { CARD_HEIGHT, FILE_PADDING, fileListOf, GROUP_GAP, type PlacedElement, ROW_HEIGHT } from "../src/graph/layout.ts";
import { layoutAll } from "../src/graph/squareLayout.ts";
import { DEFAULT_EXCLUDED, packageOf } from "../src/graph/packages.ts";
import { absoluteRect, movedTo, placeLocally } from "../src/graph/placement.ts";

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

  test("a file's declarations are rows under its header, the file fitted to them", () => {
    const file = p1.find((p) => p.element.id === "app/page.tsx")!;
    const decl = p1.find((p) => p.element.id === "app/page.tsx#HomePage")!;
    expect(file.holds).toBe(true);
    expect(decl).toMatchObject({ x: FILE_PADDING.left, y: FILE_PADDING.top, width: file.width, height: ROW_HEIGHT });
    expect(file.height).toBe(FILE_PADDING.top + ROW_HEIGHT + FILE_PADDING.bottom);
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

  test("a file's row stays in its list: moving it changes nothing", () => {
    const decl = "components/TodoList.tsx#TodoList";
    const before = absoluteRect(p1, "components/TodoList.tsx")!;
    const d = absoluteRect(p1, decl)!;
    const moved = movedTo(p1, g1, decl, { x: d.x + 300, y: d.y + 200 })!;
    expect(absoluteRect(moved, decl)).toEqual(d);
    expect(absoluteRect(moved, "components/TodoList.tsx")).toEqual(before);
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

describe("file lists", () => {
  const el = (id: string, kind: DrawnElement["kind"], parent: string | null): DrawnElement => ({ id, kind, name: id.split("#").pop()!, parent });
  test("types, components, hooks, server actions, functions; A to Z in each, a gap between groups", () => {
    const file = el("lib/a.ts", "module", null);
    const kids = [el("lib/a.ts#zeta", "function", "lib/a.ts"), el("lib/a.ts#Card", "component", "lib/a.ts"), el("lib/a.ts#useX", "hook", "lib/a.ts"), el("lib/a.ts#Props", "type", "lib/a.ts"), el("lib/a.ts#alpha", "function", "lib/a.ts"), el("lib/a.ts#save", "serverAction", "lib/a.ts"), el("lib/a.ts#Avatar", "component", "lib/a.ts")];
    const list = fileListOf(file, kids);
    expect(list.rows.map((r) => r.element.name)).toEqual(["Props", "Avatar", "Card", "useX", "save", "alpha", "zeta"]);
    expect(list.rows.map((r) => r.y)).toEqual([0, 38, 68, 106, 144, 182, 212]);
    expect(list.innerHeight).toBe(242);
  });
  test("rows standing anywhere are put back in the list, the file fitted to them", () => {
    const graph: DrawnGraph = { elements: [el("dir:lib", "folder", null), el("lib/data.ts", "module", "dir:lib"), el("lib/data.ts#getUser", "function", "lib/data.ts"), el("lib/data.ts#User", "type", "lib/data.ts")], relations: [] };
    const placed: PlacedElement[] = [
      { element: graph.elements[0]!, holds: true, x: 0, y: 0, width: 900, height: 600 },
      { element: graph.elements[1]!, holds: true, x: 16, y: 60, width: 800, height: 500 },
      { element: graph.elements[2]!, holds: false, x: 400, y: 300, width: 230, height: CARD_HEIGHT },
      { element: graph.elements[3]!, holds: false, x: 20, y: 80, width: 230, height: CARD_HEIGHT },
    ];
    const out = placeLocally(placed, graph, null)!;
    const by = new Map(out.map((p) => [p.element.id, p]));
    const file = by.get("lib/data.ts")!;
    expect(file).toMatchObject({ x: 16, y: 60 }); // top-left corner kept
    expect(by.get("lib/data.ts#User")).toMatchObject({ x: 0, y: FILE_PADDING.top, width: file.width, height: ROW_HEIGHT });
    expect(by.get("lib/data.ts#getUser")).toMatchObject({ x: 0, y: FILE_PADDING.top + ROW_HEIGHT + GROUP_GAP });
    expect(file.height).toBe(FILE_PADDING.top + 2 * ROW_HEIGHT + GROUP_GAP + FILE_PADDING.bottom);
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

describe("component expansion", async () => {
  const { buildIndex, childEdges, INVOKES, RENDERS, reachable, ALL_GROUPS } = await import("../src/graph/relations.ts");
  const s = await loadSnapshot();
  const ix = buildIndex(s);
  const f = { enabled: ALL_GROUPS, libraries: { excluded: new Set<string>(), hideAll: false } };
  // a component with render children and other children (hooks, calls, types…)
  const comp = Object.values(s.nodes).find((n) => {
    if (n.kind !== "component") return false;
    const kinds = new Set(childEdges(s, ix, n.id, f).map((e) => e.kind));
    return kinds.has("renders") && kinds.size > 1;
  })!;

  test("the fixture has a component that renders and does something else", () => expect(comp).toBeDefined());

  test("renders-only adds just what it renders, and follows only renders when deep", () => {
    const rendered = new Set(childEdges(s, ix, comp.id, f, RENDERS).map((e) => e.to));
    const all = new Set(childEdges(s, ix, comp.id, f).map((e) => e.to));
    expect(new Set(reachable(s, ix, comp.id, "children", false, f, RENDERS))).toEqual(rendered);
    expect(rendered.size).toBeLessThan(all.size);
    for (const id of reachable(s, ix, comp.id, "children", true, f, RENDERS)) expect(["component", "external"]).toContain(s.nodes[id]!.kind);
  });

  test("invokes-only adds just functions and server actions it calls", () => {
    for (const id of reachable(s, ix, comp.id, "children", false, f, INVOKES)) {
      expect(childEdges(s, ix, comp.id, f, INVOKES).some((e) => e.to === id)).toBe(true);
    }
  });
});

describe("floating edges on component tags", async () => {
  const { floatingEdgeParams } = await import("../src/graph/floating.ts");
  const { Position } = await import("@xyflow/react");
  const { TAG_DEPTH } = await import("../src/graph/layout.ts");
  type N = Parameters<typeof floatingEdgeParams>[0];
  const card = (id: string, x: number, y: number, kind: string, w = 260) =>
    ({ id, type: "card", data: { node: { kind } }, measured: { width: w, height: 52 }, internals: { positionAbsolute: { x, y } } }) as unknown as N;

  test("an edge straight from the side ends at the tag's point", () => {
    const e = floatingEdgeParams(card("a", 500, 0, "component"), card("b", 0, 0, "hook"));
    expect(e.sx).toBeCloseTo(500);
    expect(e.sy).toBeCloseTo(26);
    expect(e.sourcePos).toBe(Position.Left);
    // the hook is a box: its right border
    expect(e.tx).toBeCloseTo(260);
  });

  test("a slanted edge ends on the tag's slanted end, not the box corner", () => {
    const e = floatingEdgeParams(card("a", 500, 0, "component"), card("b", 0, -40, "hook"));
    expect(e.sx).toBeGreaterThan(500);
    expect(e.sx).toBeLessThan(500 + TAG_DEPTH);
    expect(e.sy).toBeLessThan(26);
    expect(e.sourcePos).toBe(Position.Left);
  });

  test("edges from above and below still meet the top and bottom", () => {
    const up = floatingEdgeParams(card("a", 0, 300, "component"), card("b", 0, 0, "component"));
    expect(up.sy).toBeCloseTo(300);
    expect(up.sourcePos).toBe(Position.Top);
    expect(up.ty).toBeCloseTo(52);
    expect(up.targetPos).toBe(Position.Bottom);
  });

  test("other kinds keep the box", () => {
    const e = floatingEdgeParams(card("a", 500, 0, "function"), card("b", 0, -40, "hook"));
    expect(e.sx).toBeCloseTo(500);
  });
});

describe("private props types", async () => {
  const { privatePropsType } = await import("../src/graph/privateProps.ts");
  const { buildIndex } = await import("../src/graph/relations.ts");
  const node = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, name: id.split("#")[1] ?? id, filePath: id.split("#")[0], ...extra });
  const make = (edges: { from: string; to: string; kind: string; specifiers?: string[] }[], extraNodes: ReturnType<typeof node>[] = []) => {
    const nodes = Object.fromEntries(
      [
        node("ui/Button.tsx", "module"),
        node("ui/Button.tsx#Button", "component", { signature: { params: [{ name: "{ ...rest }", type: "ButtonProps", written: "ButtonProps" }] }, typeRefs: { ButtonProps: "ui/Button.tsx#ButtonProps" } }),
        node("ui/Button.tsx#ButtonProps", "type", { typeKind: "interface" }),
        ...extraNodes,
      ].map((n) => [n.id, n]),
    );
    const s = {
      nodes,
      edges: [
        { from: "ui/Button.tsx", to: "ui/Button.tsx#Button", kind: "declares" },
        { from: "ui/Button.tsx", to: "ui/Button.tsx#ButtonProps", kind: "declares" },
        { from: "ui/Button.tsx#Button", to: "ui/Button.tsx#ButtonProps", kind: "usesType" },
        ...edges,
      ],
    } as unknown as Snapshot;
    return privatePropsType(s, buildIndex(s), s.nodes["ui/Button.tsx#Button"]!);
  };

  test("a props type only its component uses is private, even when its file is imported for the component", () => {
    expect(make([{ from: "app/page.tsx", to: "ui/Button.tsx", kind: "imports", specifiers: ["Button"] }])?.id).toBe("ui/Button.tsx#ButtonProps");
  });
  test("another declaration using it makes it shared", () => {
    expect(make([{ from: "ui/Icon.tsx#IconButton", to: "ui/Button.tsx#ButtonProps", kind: "usesType" }])).toBeUndefined();
  });
  test("another file importing it (by name, renamed, or the whole module) makes it shared", () => {
    for (const sp of [["ButtonProps"], ["ButtonProps as BP"], ["* as ui"]])
      expect(make([{ from: "app/page.tsx", to: "ui/Button.tsx", kind: "imports", specifiers: sp }])).toBeUndefined();
  });
});

describe("props chip", async () => {
  const { propsCount, propsChipLabel } = await import("../src/lib/propsCount.ts");
  const comp = (props: { name: string; optional: boolean; written?: string }[]) => ({ id: "c", kind: "component", name: "C", filePath: "c.tsx", props }) as never;
  test("own props are the written ones; the rest are inherited", () => {
    const c = propsCount(comp([{ name: "variant", optional: true, written: '"a" | "b"' }, { name: "size", optional: true, written: '"sm"' }, { name: "onClick", optional: true }]))!;
    expect(c.own).toEqual(["variant?", "size?"]);
    expect(c.inherited).toEqual(["onClick?"]);
    expect(propsChipLabel(c)).toBe("2 + 1 props");
  });
  test("one prop, or none written at all (plain JS): all its own", () => {
    expect(propsChipLabel(propsCount(comp([{ name: "children", optional: false, written: "ReactNode" }]))!)).toBe("1 prop");
    expect(propsChipLabel(propsCount(comp([{ name: "a", optional: false }, { name: "b", optional: false }]))!)).toBe("2 props");
  });
  test("no props: no chip", () => expect(propsCount(comp([]))).toBeUndefined());
});

describe("boundary", () => {
  test("types have no server / client boundary; everything else keeps its own", async () => {
    const { boundaryOf } = await import("../src/lib/boundary.ts");
    expect(boundaryOf({ kind: "type", moduleType: "client" })).toBeUndefined();
    expect(boundaryOf({ kind: "component", moduleType: "client" })).toBe("client");
    expect(boundaryOf({ kind: "function", moduleType: "shared" })).toBe("shared");
  });
});

describe("props type name (In this diff)", () => {
  test("a component's named props type, as written; none for inline objects or non-components", async () => {
    const { propsTypeName } = await import("../src/lib/diff.ts");
    const c = (written?: string, type?: string, kind = "component") => ({ id: "x", name: "X", kind, signature: { params: [{ name: "{ a }", written, type }] } }) as never;
    expect(propsTypeName(c("ButtonProps", "ButtonProps"))).toBe("ButtonProps");
    expect(propsTypeName(c(undefined, "Props<string>"))).toBe("Props<string>");
    expect(propsTypeName(c("{ a: string }", "{ a: string; }"))).toBeUndefined();
    expect(propsTypeName(c("ButtonProps", "ButtonProps", "function"))).toBeUndefined();
  });
});
