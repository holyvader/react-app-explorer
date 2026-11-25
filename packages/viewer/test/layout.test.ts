import { describe, expect, test } from "bun:test";
import type { Edge } from "@rae/schema";
import type { DrawnElement, DrawnGraph } from "../src/graph/drawn.ts";
import type { PlacedElement } from "../src/graph/layout.ts";
import { layoutAll, layoutWithin, squareLayout, tangleOf } from "../src/graph/squareLayout.ts";

const relationsOf = (pairs: [string, string][]): DrawnGraph["relations"] =>
  pairs.map(([source, target]) => ({ id: `${source}>${target}`, source, target, edge: { from: source, to: target, kind: "invokes" } as Edge }));
const card = (id: string, parent: string | null = null): DrawnElement => ({ id, kind: "function", name: id, parent });

// 70 files of 5 declarations (each calling the next file's first), plus loose cards a → b → c
function bigGraph(): DrawnGraph {
  const elements: DrawnElement[] = [];
  const pairs: [string, string][] = [];
  for (let f = 0; f < 70; f++) {
    const file = `src/f${String(f).padStart(2, "0")}.ts`;
    elements.push({ id: file, kind: "module", name: file, parent: null });
    for (let d = 0; d < 5; d++) elements.push(card(`${file}#d${d}`, file));
    for (let d = 1; d < 5; d++) pairs.push([`${file}#d0`, `${file}#d${d}`]);
    if (f) pairs.push([`src/f${String(f - 1).padStart(2, "0")}.ts#d4`, `${file}#d0`]);
  }
  for (const id of ["a", "b", "c"]) elements.push({ id, kind: "component", name: id, parent: null });
  pairs.push(["a", "b"], ["b", "c"]);
  return { elements, relations: relationsOf(pairs) };
}

const overlap = (a: PlacedElement, b: PlacedElement) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("square layout", () => {
  test("everything placed, siblings apart, what a frame holds inside it, about square", async () => {
    const graph = bigGraph();
    const started = performance.now();
    const placed = await layoutAll(graph);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(placed.length).toBe(graph.elements.length);
    const byParent = new Map<string | null, PlacedElement[]>();
    for (const p of placed) byParent.set(p.element.parent, [...(byParent.get(p.element.parent) ?? []), p]);
    for (const siblings of byParent.values())
      for (let i = 0; i < siblings.length; i++) for (let j = i + 1; j < siblings.length; j++) expect(overlap(siblings[i]!, siblings[j]!)).toBe(false);
    const at = new Map(placed.map((p) => [p.element.id, p]));
    for (const p of placed) {
      if (!p.element.parent) continue;
      const frame = at.get(p.element.parent)!;
      expect(p.x + p.width).toBeLessThanOrEqual(frame.width);
      expect(p.y + p.height).toBeLessThanOrEqual(frame.height);
    }
    const top = byParent.get(null)!;
    const width = Math.max(...top.map((p) => p.x + p.width));
    const height = Math.max(...top.map((p) => p.y + p.height));
    expect(width / height).toBeGreaterThan(0.5);
    expect(width / height).toBeLessThan(2.5);
  });

  test("two crossing pairs are uncrossed", () => {
    // in a 2 × 2 square, a–d and b–c laid out in order are its two diagonals
    const graph: DrawnGraph = { elements: ["a", "b", "c", "d"].map((id) => card(id)), relations: relationsOf([["a", "d"], ["b", "c"]]) };
    const placed = squareLayout(graph);
    expect(tangleOf(graph, placed).crossings).toBe(0);
  });

  test("a hub with eight spokes goes in the middle: no edge runs through a card", () => {
    const spokes = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const graph: DrawnGraph = { elements: [card("hub"), ...spokes.map((id) => card(id))], relations: relationsOf(spokes.map((s) => ["hub", s])) };
    const tangle = tangleOf(graph, squareLayout(graph));
    expect(tangle.through).toBe(0);
    expect(tangle.crossings).toBe(0);
  });

  test("the same graph is placed the same way", () => {
    const graph: DrawnGraph = {
      elements: ["a", "b", "c", "d", "e", "f"].map((id) => card(id)),
      relations: relationsOf([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "f"], ["f", "a"], ["a", "d"]]),
    };
    const xy = (p: PlacedElement[]) => p.map((e) => `${e.element.id}@${e.x},${e.y}`).join(" ");
    expect(xy(squareLayout(graph))).toBe(xy(squareLayout(graph)));
  });

  test("tidy up inside: a frame's own elements from the corner of what they cover", async () => {
    const graph: DrawnGraph = {
      elements: [{ id: "f", kind: "module", name: "f.ts", parent: null }, card("x", "f"), card("y", "f"), card("z", "f"), card("outside")],
      relations: relationsOf([["x", "y"], ["y", "z"], ["z", "outside"]]),
    };
    const inside = await layoutWithin(graph, "f");
    expect(inside.map((p) => p.element.id).sort()).toEqual(["x", "y", "z"]);
    expect(Math.min(...inside.map((p) => p.x))).toBe(0);
    expect(Math.min(...inside.map((p) => p.y))).toBe(0);
  });
});

describe("tree layout", () => {
  const file = (path: string): DrawnElement => ({ id: path, kind: "module", name: path, parent: null });
  const absolute = (placed: PlacedElement[]) => {
    const at = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const p of placed) {
      const round = p.element.parent ? at.get(p.element.parent) : undefined;
      at.set(p.element.id, { x: p.x + (round?.x ?? 0), y: p.y + (round?.y ?? 0), width: p.width, height: p.height });
    }
    return at;
  };

  test("callers above what they call, level by level", () => {
    const graph: DrawnGraph = {
      elements: ["src/app.ts", "src/routes.ts", "src/api.ts", "src/db.ts"].map(file),
      relations: relationsOf([["src/app.ts", "src/routes.ts"], ["src/app.ts", "src/api.ts"], ["src/routes.ts", "src/db.ts"], ["src/api.ts", "src/db.ts"]]),
    };
    const at = absolute(squareLayout(graph, null, "thorough", "tree"));
    const y = (id: string) => at.get(id)!.y;
    expect(y("src/app.ts")).toBeLessThan(y("src/routes.ts"));
    expect(y("src/routes.ts")).toBe(y("src/api.ts"));
    expect(y("src/api.ts")).toBeLessThan(y("src/db.ts"));
  });

  test("what hangs under one element is a block under it; the unjoined go last", () => {
    const kids = Array.from({ length: 6 }, (_, i) => `src/k${i}.ts`);
    const graph: DrawnGraph = {
      elements: ["src/hub.ts", ...kids, "src/alone.ts"].map(file),
      relations: relationsOf(kids.map((k) => ["src/hub.ts", k])),
    };
    const at = absolute(squareLayout(graph, null, "thorough", "tree"));
    const hub = at.get("src/hub.ts")!;
    const block = kids.map((k) => at.get(k)!);
    for (const k of block) expect(k.y).toBeGreaterThan(hub.y + hub.height);
    // a square block, not one long row
    expect(new Set(block.map((k) => k.y)).size).toBeGreaterThan(1);
    expect(at.get("src/alone.ts")!.y).toBeGreaterThan(Math.max(...block.map((k) => k.y)));
  });

  test("a cycle is placed, its parts in levels", () => {
    const graph: DrawnGraph = { elements: ["src/a.ts", "src/b.ts", "src/c.ts"].map(file), relations: relationsOf([["src/a.ts", "src/b.ts"], ["src/b.ts", "src/c.ts"], ["src/c.ts", "src/a.ts"]]) };
    const placed = squareLayout(graph, null, "quick", "tree");
    expect(placed.length).toBe(3);
    expect(new Set(placed.map((p) => p.y)).size).toBe(3);
  });

  test("a file's declarations stay a square; folders stay apart", () => {
    const elements: DrawnElement[] = [file("src/ui/page.ts"), card("src/ui/page.ts#a", "src/ui/page.ts"), card("src/ui/page.ts#b", "src/ui/page.ts"), card("src/ui/page.ts#c", "src/ui/page.ts"), card("src/ui/page.ts#d", "src/ui/page.ts"), file("src/ui/form.ts"), file("src/ui/list.ts"), file("src/db/users.ts"), file("src/db/posts.ts"), file("src/db/pool.ts")];
    const graph: DrawnGraph = {
      elements,
      relations: relationsOf([
        ["src/ui/page.ts#a", "src/ui/page.ts#b"], ["src/ui/page.ts#b", "src/ui/page.ts#c"], ["src/ui/page.ts#c", "src/ui/page.ts#d"],
        ["src/ui/page.ts", "src/ui/form.ts"], ["src/ui/page.ts", "src/ui/list.ts"], ["src/ui/list.ts", "src/db/users.ts"],
        ["src/db/users.ts", "src/db/pool.ts"], ["src/db/posts.ts", "src/db/pool.ts"],
      ]),
    };
    const tree = squareLayout(graph, null, "thorough", "tree");
    const square = squareLayout(graph, null, "thorough", "square");
    // inside the file: the same 2 × 2 as the square layout gives it
    const inFile = (placed: PlacedElement[]) => placed.filter((p) => p.element.parent === "src/ui/page.ts").map((p) => `${p.x},${p.y}`).sort();
    expect(new Set(inFile(tree).map((xy) => xy.split(",")[1])).size).toBe(2);
    expect(inFile(tree).length).toBe(4);
    expect(inFile(square).length).toBe(4);
    // the two folders' boxes don't overlap
    const at = absolute(tree);
    const boxOf = (ids: string[]) => {
      const rs = ids.map((id) => at.get(id)!);
      return { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), width: Math.max(...rs.map((r) => r.x + r.width)) - Math.min(...rs.map((r) => r.x)), height: Math.max(...rs.map((r) => r.y + r.height)) - Math.min(...rs.map((r) => r.y)) };
    };
    const ui = boxOf(["src/ui/page.ts", "src/ui/form.ts", "src/ui/list.ts"]);
    const db = boxOf(["src/db/users.ts", "src/db/posts.ts", "src/db/pool.ts"]);
    const apart = ui.x + ui.width <= db.x || db.x + db.width <= ui.x || ui.y + ui.height <= db.y || db.y + db.height <= ui.y;
    expect(apart).toBe(true);
    // and inside db, callers above: users and posts over pool
    expect(at.get("src/db/users.ts")!.y).toBeLessThan(at.get("src/db/pool.ts")!.y);
  });
});
