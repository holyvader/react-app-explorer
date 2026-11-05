import { describe, expect, test } from "bun:test";
import { bundleRelations, collapseFrames } from "../src/graph/collapse.ts";
import type { PlacedElement } from "../src/graph/layout.ts";

// dir:src (folder) ⊃ a.ts (file frame) ⊃ A, B; dir:src ⊃ b.ts (card); c.ts (frame, top) ⊃ C; d.ts (card, top)
const el = (id: string, parent: string | null, holds = false): PlacedElement => ({ element: { id, kind: "module", name: id, parent }, holds, x: 0, y: 0, width: 10, height: 10 });
const placed = [el("dir:src", null, true), el("a.ts", "dir:src", true), el("A", "a.ts"), el("B", "a.ts"), el("b.ts", "dir:src"), el("c.ts", null, true), el("C", "c.ts"), el("d.ts", null)];
const rel = (source: string, target: string) => ({ id: `${source}>${target}`, source, target });

describe("collapsing frames when zoomed out", () => {
  test("none: nothing collapses", () => {
    expect(collapseFrames(placed, "none").frames.size).toBe(0);
  });

  test("files: frames holding only cards become blocks; folders holding frames stay open", () => {
    const c = collapseFrames(placed, "files");
    expect([...c.frames]).toEqual([
      ["a.ts", 2],
      ["c.ts", 1],
    ]);
    expect(c.shownAs.get("A")).toBe("a.ts");
    expect(c.shownAs.has("b.ts")).toBe(false);
  });

  test("all: top-level frames hide everything inside", () => {
    const c = collapseFrames(placed, "all");
    expect([...c.frames]).toEqual([
      ["dir:src", 4],
      ["c.ts", 1],
    ]);
    expect(c.shownAs.get("A")).toBe("dir:src");
    expect(c.shownAs.has("d.ts")).toBe(false);
  });

  test("relations: kept between shown ends, merged per block pair, gone inside a block", () => {
    const rels = [rel("A", "B"), rel("A", "C"), rel("B", "C"), rel("C", "A"), rel("b.ts", "d.ts"), rel("A", "d.ts")];
    const { kept, bundles } = bundleRelations(rels, collapseFrames(placed, "files"));
    expect(kept.map((r) => r.id)).toEqual(["b.ts>d.ts"]);
    expect(bundles.map((b) => [b.source, b.target, b.members.length])).toEqual([
      ["a.ts", "c.ts", 2],
      ["c.ts", "a.ts", 1],
      ["a.ts", "d.ts", 1],
    ]);
  });
});

describe("level of detail", () => {
  test("levels by zoom, with hysteresis at the thresholds", async () => {
    const { lodOf, nextLod } = await import("../src/components/lod.ts");
    expect([1, 0.5, 0.2, 0.05].map(lodOf)).toEqual(["full", "compact", "overview", "far"]);
    expect(nextLod(0.59, "full")).toBe("full"); // just under 0.6: stays
    expect(nextLod(0.55, "full")).toBe("compact");
    expect(nextLod(0.61, "compact")).toBe("compact"); // just over: stays
    expect(nextLod(0.65, "compact")).toBe("full");
    expect(nextLod(0.05, "full")).toBe("far"); // a jump past several thresholds
  });

  test("frames collapse only on big diagrams", async () => {
    const { collapseLevelOf, COLLAPSE_FROM } = await import("../src/components/lod.ts");
    expect(collapseLevelOf("overview", COLLAPSE_FROM - 1)).toBe("none");
    expect(collapseLevelOf("overview", COLLAPSE_FROM)).toBe("files");
    expect(collapseLevelOf("far", COLLAPSE_FROM)).toBe("all");
    expect(collapseLevelOf("compact", 5000)).toBe("none");
  });
});
