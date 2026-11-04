import { describe, expect, test } from "bun:test";
import { diffLines, foldUnchanged, splitRows } from "../src/lib/lineDiff.ts";

describe("line diffs", () => {
  const before = ["function Header() {", "  return <h1>Hi</h1>;", "}"];
  const after = ["function Header({ title }) {", "  return <h1>{title}</h1>;", "}"];

  test("same / removed / added, with each side's line numbers (from where the declaration starts)", () => {
    const d = diffLines(before, after, 10, 12);
    expect(d.map((l) => l.type)).toEqual(["del", "del", "add", "add", "same"]);
    expect(d[0]).toEqual({ type: "del", a: 10, text: "function Header() {" });
    expect(d[2]).toEqual({ type: "add", b: 12, text: "function Header({ title }) {" });
    expect(d[4]).toEqual({ type: "same", a: 12, b: 14, text: "}" });
  });

  test("insertions in the middle keep the rest matched", () => {
    const d = diffLines(["a", "b", "c", "d"], ["a", "b", "x", "c", "d"]);
    expect(d.map((l) => `${l.type}:${l.text}`)).toEqual(["same:a", "same:b", "add:x", "same:c", "same:d"]);
  });

  test("only one side: all added or all removed", () => {
    expect(diffLines([], ["a", "b"]).map((l) => l.type)).toEqual(["add", "add"]);
    expect(diffLines(["a"], []).map((l) => l.type)).toEqual(["del"]);
  });

  test("split rows pair removed lines with added ones", () => {
    const rows = splitRows(diffLines(before, after));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.left!.text).toBe("function Header() {");
    expect(rows[0]!.right!.text).toBe("function Header({ title }) {");
    expect(rows[2]!.left as unknown).toBe(rows[2]!.right); // the same line on both sides
    const uneven = splitRows(diffLines(["a", "x", "z"], ["a", "y", "y2", "z"]));
    expect(uneven.map((r): (string | undefined)[] => [r.left?.text, r.right?.text])).toEqual([["a", "a"], ["x", "y"], [undefined, "y2"], ["z", "z"]]);
  });

  test("long unchanged runs fold, keeping context around changes", () => {
    const a = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const b = [...a];
    b[20] = "changed";
    const parts = foldUnchanged(diffLines(a, b), (l) => l.type !== "same", 3);
    expect(parts.map((p) => (p.type === "fold" ? `fold ${p.count}` : `rows ${p.rows.length}`))).toEqual(["fold 17", "rows 8", "fold 16"]);
  });

  test("a huge rewrite doesn't stall: the middle is removed, then added", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    const t = performance.now();
    const d = diffLines(a, b);
    expect(performance.now() - t).toBeLessThan(200);
    expect(d.filter((l) => l.type === "del")).toHaveLength(3000);
  });
});

describe("whitespace", () => {
  test("lines differing only in whitespace are the same line, shown as the head has them", () => {
    const d = diffLines(["function a() {", "  return 1;", "}"], ["function a() {", "\treturn   1;", "}"]);
    expect(d.map((l) => l.type)).toEqual(["same", "same", "same"]);
    expect(d[1]).toMatchObject({ text: "\treturn   1;", was: "  return 1;" });
    expect(d[0]).not.toHaveProperty("was");
  });

  test("a real change next to a re-indented line", () => {
    const d = diffLines(["if (x) {", "f();", "}"], ["if (x) {", "  g();", "}"]);
    expect(d.map((l) => l.type)).toEqual(["same", "del", "add", "same"]);
  });
});
