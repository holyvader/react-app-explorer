import { describe, expect, test } from "bun:test";
import type { Edge } from "@rae/schema";
import type { DrawnElement, DrawnGraph } from "../src/graph/drawn.ts";
import { layoutAll, PACK_FROM } from "../src/graph/layout.ts";

// 70 files of 5 declarations (each calling the next file's first), plus loose cards a → b → c
function bigGraph(): DrawnGraph {
  const elements: DrawnElement[] = [];
  const relations: DrawnGraph["relations"] = [];
  const rel = (source: string, target: string) => relations.push({ id: `${source}>${target}`, source, target, edge: { from: source, to: target, kind: "invokes" } as Edge });
  for (let f = 0; f < 70; f++) {
    const file = `src/f${String(f).padStart(2, "0")}.ts`;
    elements.push({ id: file, kind: "module", name: file, parent: null });
    for (let d = 0; d < 5; d++) elements.push({ id: `${file}#d${d}`, kind: "function", name: `d${d}`, parent: file });
    for (let d = 1; d < 5; d++) rel(`${file}#d0`, `${file}#d${d}`);
    if (f) rel(`src/f${String(f - 1).padStart(2, "0")}.ts#d4`, `${file}#d0`);
  }
  for (const id of ["a", "b", "c"]) elements.push({ id, kind: "component", name: id, parent: null });
  rel("a", "b");
  rel("b", "c");
  return { elements, relations };
}

describe("layout of big diagrams", () => {
  test("packed: everything placed, about the viewport's shape, top-level blocks apart", async () => {
    const graph = bigGraph();
    expect(graph.elements.length).toBeGreaterThanOrEqual(PACK_FROM);
    const placed = await layoutAll(graph);
    expect(placed.length).toBe(graph.elements.length);
    const top = placed.filter((p) => !p.element.parent);
    const width = Math.max(...top.map((p) => p.x + p.width)) - Math.min(...top.map((p) => p.x));
    const height = Math.max(...top.map((p) => p.y + p.height)) - Math.min(...top.map((p) => p.y));
    expect(width / height).toBeLessThan(3);
    expect(width / height).toBeGreaterThan(0.5);
    for (let i = 0; i < top.length; i++)
      for (let j = i + 1; j < top.length; j++) {
        const [a, b] = [top[i]!, top[j]!];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        if (overlap) throw new Error(`${a.element.id} overlaps ${b.element.id}`);
      }
  });

  test("packed: loose cards keep their flow, a file's declarations stay inside it", async () => {
    const placed = await layoutAll(bigGraph());
    const at = (id: string) => placed.find((p) => p.element.id === id)!;
    expect(at("b").y).toBeGreaterThan(at("a").y);
    expect(at("c").y).toBeGreaterThan(at("b").y);
    const file = at("src/f00.ts");
    const d1 = at("src/f00.ts#d1");
    // children are relative to their frame and inside it
    expect(d1.x + d1.width).toBeLessThanOrEqual(file.width);
    expect(d1.y + d1.height).toBeLessThanOrEqual(file.height);
    expect(d1.y).toBeGreaterThan(at("src/f00.ts#d0").y);
  });

  test("small diagrams keep the single layered layout", async () => {
    const graph = bigGraph();
    const small = { elements: graph.elements.slice(0, 18), relations: graph.relations.filter((r) => graph.elements.slice(0, 18).some((e) => e.id === r.target) && graph.elements.slice(0, 18).some((e) => e.id === r.source)) };
    const placed = await layoutAll(small);
    const at = (id: string) => placed.find((p) => p.element.id === id)!;
    // f00's last declaration calls into f01: layered puts f01 below f00
    expect(at("src/f01.ts").y).toBeGreaterThan(at("src/f00.ts").y);
  });
});
