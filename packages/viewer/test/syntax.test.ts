import { describe, expect, test } from "bun:test";
import { layoutType, lexSource, lexType, typeLines } from "../src/lib/syntax.ts";

const ONCHANGE =
  '(diff: { base?: string | undefined; head?: string | undefined; request?: string | undefined; requestInfo?: { title?: string | undefined; author?: string | undefined; url?: string | undefined; } | undefined; worktree?: boolean | undefined; against?: "base" | "merge-base" | undefined; } | undefined) => void';

describe("type layout", () => {
  test("the example: parameters and objects broken one per line, `| undefined` dropped from optional members", () => {
    expect(typeLines(ONCHANGE, { width: 72 }).join("\n")).toBe(
      [
        "(",
        "  diff: {",
        "    base?: string;",
        "    head?: string;",
        "    request?: string;",
        "    requestInfo?: { title?: string; author?: string; url?: string };",
        "    worktree?: boolean;",
        '    against?: "base" | "merge-base";',
        "  } | undefined",
        ") => void",
      ].join("\n"),
    );
  });

  test("what fits stays on one line (objects without the trailing `;`)", () => {
    expect(typeLines("{ title: string; subtitle?: string | undefined; }", { width: 60 })).toEqual(["{ title: string; subtitle?: string }"]);
    expect(typeLines("string | undefined")).toEqual(["string | undefined"]); // not a member: kept
    expect(typeLines("{}")).toEqual(["{}"]);
    expect(typeLines("(a: number, b?: string | undefined) => void")).toEqual(["(a: number, b?: string) => void"]);
  });

  test("only optional members lose `undefined`; required ones keep it", () => {
    expect(typeLines("{ a: string | undefined; b?: undefined | number; c?: undefined; }")).toEqual(["{ a: string | undefined; b?: number; c?: undefined }"]);
  });

  test("a lone object hugs its brackets; long unions go one member per line", () => {
    expect(typeLines("Promise<{ user: { id: number; name: string; }; ok: boolean; }>", { width: 24 })).toEqual(["Promise<{", "  user: {", "    id: number;", "    name: string;", "  };", "  ok: boolean;", "}>"]);
    expect(typeLines('"alpha" | "beta" | "gamma" | "delta"', { width: 20 })).toEqual(['| "alpha"', '| "beta"', '| "gamma"', '| "delta"']);
    expect(typeLines('{ mode: "alpha" | "beta" | "gamma" | "delta"; }', { width: 24 })).toEqual(["{", "  mode:", '    | "alpha"', '    | "beta"', '    | "gamma"', '    | "delta";', "}"]);
  });

  test("strings with brackets, clipped types and `flat` survive", () => {
    expect(typeLines('{ a: "{ not; an; object }"; }', { width: 80 })).toEqual(['{ a: "{ not; an; object }" }']);
    expect(typeLines("{ a: string; b: { c: num…", { width: 12 }).join("\n")).toContain("num…");
    expect(layoutType(ONCHANGE, { flat: true })).toHaveLength(1);
  });

  test("colours: names, primitives, literals, keywords, types", () => {
    const kinds = Object.fromEntries(lexType('{ readonly id: string; kind: "a"; items: Item[]; key: keyof T; n: 1 }').filter((t) => t.k !== "plain" && t.k !== "punct").map((t) => [t.t, t.k]));
    expect(kinds).toMatchObject({ readonly: "keyword", id: "name", string: "primitive", '"a"': "literal", items: "name", Item: "type", keyof: "keyword", T: "type", "1": "literal" });
    // the branches of a conditional type aren't member names
    const cond = lexType("T extends string ? A : B");
    expect(cond.find((t) => t.t === "A")!.k).toBe("type");
  });
});

describe("source colours", () => {
  test("comments, strings across lines, JSX tags and attributes, calls; generics aren't JSX", () => {
    const lines = lexSource('// note\nconst x = useState<Item>(0);\nreturn <Box className="a" onClick={() => go(`a\n${b}`)} hidden />;');
    const kindsOf = (n: number) => lines[n]!.filter((t) => t.t.trim()).map((t) => `${t.k}:${t.t}`);
    expect(kindsOf(0)).toEqual(["comment:// note"]);
    expect(kindsOf(1)).toContain("fn:useState");
    expect(kindsOf(1)).toContain("type:Item"); // a type argument, not a tag
    expect(kindsOf(2)).toEqual(expect.arrayContaining(["keyword:return", "tag:Box", "attr:className", 'literal:"a"', "attr:onClick", "fn:go", "literal:`a"]));
    expect(kindsOf(3)).toEqual(expect.arrayContaining(["literal:${b}`", "attr:hidden"])); // the template literal goes on; attributes after it still are
    expect(lines).toHaveLength(4);
  });
});

describe("definitions", () => {
  const { layoutDefinition } = require("../src/lib/syntax.ts") as typeof import("../src/lib/syntax.ts");
  const text = (lines: ReturnType<typeof layoutDefinition>) => lines.map((l) => l.map((t) => t.t).join(""));
  const SCAN_SETTINGS = [
    "export interface ScanSettings {",
    "  types: boolean;",
    "  /** Diff mode: compare `head` with `base`. */",
    '  diff?: { base?: string; head?: string; requestInfo?: { title?: string; url?: string }; worktree?: boolean; against?: "merge-base" | "base" | undefined };',
    "}",
  ].join("\n");

  test("a member written on one long line is laid out under it; the rest stays as written", () => {
    expect(text(layoutDefinition(SCAN_SETTINGS, 60))).toEqual([
      "export interface ScanSettings {",
      "  types: boolean;",
      "  /** Diff mode: compare `head` with `base`. */",
      "  diff?: {",
      "    base?: string;",
      "    head?: string;",
      "    requestInfo?: { title?: string; url?: string };",
      "    worktree?: boolean;",
      '    against?: "merge-base" | "base" | undefined;', // as the author wrote it
      "  };",
      "}",
    ]);
  });

  test("lines that fit, and one-line aliases that don't", () => {
    expect(text(layoutDefinition(SCAN_SETTINGS, 400))).toEqual(SCAN_SETTINGS.split("\n"));
    expect(text(layoutDefinition("export type Pair = { left: string; right: string; both: [string, string] };", 30))).toEqual([
      "export type Pair = {",
      "  left: string;",
      "  right: string;",
      "  both: [string, string];",
      "};",
    ]);
  });
});

describe("an optional prop / parameter's type on its own", () => {
  const { typeLines } = require("../src/lib/syntax.ts") as typeof import("../src/lib/syntax.ts");
  test("loses `| undefined` only when optional", () => {
    expect(typeLines("AbortSignal | undefined", { optional: true })).toEqual(["AbortSignal"]);
    expect(typeLines("AbortSignal | undefined")).toEqual(["AbortSignal | undefined"]);
    expect(typeLines("undefined", { optional: true })).toEqual(["undefined"]); // nothing else left: kept
  });
});

describe("folding objects", () => {
  const { typeLines, layoutType, layoutDefinition, FIRST_LEVEL } = require("../src/lib/syntax.ts") as typeof import("../src/lib/syntax.ts");
  const T = '(diff: { base?: string; head?: string; requestInfo?: { title?: string; author?: string; url?: string }; against?: "base" | "merge-base" } | undefined) => void';

  test("the first level only (tooltips): nested objects as `{…N}`", () => {
    expect(typeLines(T, { width: 60, fold: FIRST_LEVEL })).toEqual([
      "(",
      "  diff: {",
      "    base?: string;",
      "    head?: string;",
      "    requestInfo?: {…3};",
      '    against?: "base" | "merge-base";',
      "  } | undefined",
      ") => void",
    ]);
    expect(typeLines("{ a: { b: string } }", { flat: true, fold: FIRST_LEVEL })).toEqual(["{ a: {…1} }"]);
  });

  test("folded tokens carry their object's id (stable whatever else is folded) and size", () => {
    const folded = layoutType(T, { width: 60, fold: FIRST_LEVEL }).flat().find((t) => t.fold)!;
    expect(folded).toMatchObject({ t: "{…3}", members: 3 });
    // unfolding it: the same id now on its `{`, to fold it back
    const open = layoutType(T, { width: 30, fold: (id) => id !== folded.fold && false }).flat();
    expect(open.some((t) => t.unfold === folded.fold)).toBe(true);
  });

  test("definitions: a member's object that doesn't fit folds", () => {
    const def = "interface S {\n  a: string;\n  diff?: { base?: string; head?: string; info?: { title?: string; url?: string } };\n}";
    const lines = layoutDefinition(def, 40, (_id, _depth, fits) => !fits).map((l) => l.map((t) => t.t).join(""));
    expect(lines).toEqual(["interface S {", "  a: string;", "  diff?: {…3};", "}"]);
  });
});
