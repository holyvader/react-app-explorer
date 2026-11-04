import { describe, expect, test } from "bun:test";
import type { GraphNode } from "@rae/schema";
import { diffOf } from "../src/lib/nodeDiff.ts";

const decl = (line: number, endLine: number): GraphNode => ({ id: "f.ts#X", kind: "type", name: "X", filePath: "f.ts", loc: { line, col: 1 }, endLine });
const side = (node: GraphNode, whole = false) => ({ sha: "x", label: "x", node, whole });

describe("an element's code diff (the header's counts are the dialog's)", () => {
  const before = ["import a;", "", "interface X {", "  a: string;", "  b: number;", "}", "const tail = 1;", ""].join("\n");
  const after = ["import a;", "import b;", "", "interface X {", "  a: string;", "  b: string;", "  c?: boolean;", "}", "const tail = 2;", ""].join("\n");

  test("a declaration: only its own lines count, wherever it moved in the file", () => {
    const d = diffOf({ text: before, side: side(decl(3, 6)) }, { text: after, side: side(decl(4, 8)) });
    expect({ removed: d.removed, added: d.added }).toEqual({ removed: 1, added: 2 }); // not its whole length (4 → 5)
    expect(d.lines.find((l) => l.type === "del")).toMatchObject({ a: 5, text: "  b: number;" });
    expect(d.lines.find((l) => l.type === "add")).toMatchObject({ b: 6, text: "  b: string;" });
  });

  test("a whole file (modules, merged files): every changed line", () => {
    const file: GraphNode = { id: "f.ts", kind: "module", name: "f.ts", filePath: "f.ts" };
    const d = diffOf({ text: before, side: side(file, true) }, { text: after, side: side(file, true) });
    expect({ removed: d.removed, added: d.added }).toEqual({ removed: 2, added: 4 });
  });

  test("added and removed elements: one side only", () => {
    expect(diffOf({}, { text: after, side: side(decl(4, 8)) })).toMatchObject({ removed: 0, added: 5 });
    expect(diffOf({ text: before, side: side(decl(3, 6)) }, {})).toMatchObject({ removed: 4, added: 0 });
  });
});
