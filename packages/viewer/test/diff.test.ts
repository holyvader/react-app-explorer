import { describe, expect, test } from "bun:test";
import type { Edge, GraphNode, Snapshot } from "@rae/schema";
import { drawnGraph } from "../src/graph/drawn.ts";
import { DEFAULT_EXCLUDED } from "../src/graph/packages.ts";
import { buildTree } from "../src/graph/tree.ts";
import { applyDiff, changesToShow, edgeChange, isGhost, sideLabel, signatureChanges } from "../src/lib/diff.ts";

// A hand-made diff snapshot: App renders Footer (new) instead of Old (removed); Header changed.
const mod = (id: string): GraphNode => ({ id, kind: "module", name: id.split("/").pop()!, filePath: id });
const comp = (file: string, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id: `${file}#${name}`, kind: "component", name, filePath: file, moduleId: file, exported: true, ...extra });
const e = (kind: Edge["kind"], from: string, to: string): Edge => ({ kind, from, to });

function snapshot(): Snapshot {
  const nodes = Object.fromEntries(
    [mod("src/App.tsx"), comp("src/App.tsx", "App"), mod("src/Footer.tsx"), comp("src/Footer.tsx", "Footer"), mod("src/Header.tsx"), comp("src/Header.tsx", "Header", { props: [{ name: "title", optional: false, type: "string" }] })].map((n) => [n.id, n]),
  );
  return {
    schemaVersion: 2,
    createdAt: "2026-11-04T00:00:00.000Z",
    rootDir: "/repo",
    entry: "/repo",
    framework: "react",
    stats: { files: 3, durationMs: 1, phases: {}, cacheHits: 0, types: false },
    nodes,
    edges: [e("declares", "src/App.tsx", "src/App.tsx#App"), e("renders", "src/App.tsx#App", "src/Footer.tsx#Footer"), e("renders", "src/App.tsx#App", "src/Header.tsx#Header")],
    diff: {
      base: { ref: "main", sha: "a".repeat(40) },
      head: { ref: "refs/pull/12/head", sha: "b".repeat(40) },
      against: "merge-base",
      compared: "c".repeat(40),
      nodes: { "src/Footer.tsx": "added", "src/Footer.tsx#Footer": "added", "src/Old.tsx": "removed", "src/Old.tsx#Old": "removed", "src/Header.tsx#Header": "changed", "src/App.tsx#App": "changed" },
      removed: { "src/Old.tsx": mod("src/Old.tsx"), "src/Old.tsx#Old": comp("src/Old.tsx", "Old") },
      before: { "src/Header.tsx#Header": comp("src/Header.tsx", "Header"), "src/App.tsx#App": comp("src/App.tsx", "App") },
      renamed: {},
      edges: { added: [e("renders", "src/App.tsx#App", "src/Footer.tsx#Footer")], removed: [e("renders", "src/App.tsx#App", "src/Old.tsx#Old")] },
      files: [
        { path: "src/App.tsx", status: "modified", additions: 2, deletions: 2 },
        { path: "src/Footer.tsx", status: "added", additions: 4, deletions: 0 },
        { path: "src/Old.tsx", status: "deleted", additions: 0, deletions: 3 },
        { path: "src/Header.tsx", status: "modified", additions: 1, deletions: 1 },
      ],
    },
  };
}

const ALL = { imports: true, declares: true, renders: true, hooks: true, invokes: true, types: true, navigation: true, cache: true };
const opts = (hideRemoved: boolean) => ({ enabled: ALL, folders: false, filter: { excluded: new Set(DEFAULT_EXCLUDED), hideAll: false, hideRemoved } });

describe("diff snapshots in the viewer", () => {
  test("removed nodes and edges become ghosts; added edges are marked", () => {
    const s = applyDiff(snapshot());
    expect(isGhost(s.nodes["src/Old.tsx#Old"])).toBe(true);
    expect(isGhost(s.nodes["src/App.tsx#App"])).toBe(false);
    const gone = s.edges.find((x) => x.to === "src/Old.tsx#Old")!;
    expect(edgeChange(gone)).toBe("removed");
    expect(edgeChange(s.edges.find((x) => x.to === "src/Footer.tsx#Footer")!)).toBe("added");
    expect(edgeChange(s.edges.find((x) => x.to === "src/Header.tsx#Header")!)).toBeUndefined();
    // applying twice adds nothing
    const count = s.edges.length;
    applyDiff(s);
    expect(s.edges.length).toBe(count);
  });

  test("the overlay off hides ghosts and their relations", () => {
    const s = applyDiff(snapshot());
    const ids = ["src/App.tsx#App", "src/Old.tsx#Old", "src/Footer.tsx#Footer"];
    const on = drawnGraph(s, ids, opts(false));
    expect(on.elements.map((x) => x.id)).toContain("src/Old.tsx#Old");
    expect(on.relations.some((r) => r.target === "src/Old.tsx#Old")).toBe(true);
    const off = drawnGraph(s, ids, opts(true));
    expect(off.elements.map((x) => x.id)).not.toContain("src/Old.tsx#Old");
    expect(off.relations.some((r) => r.target === "src/Old.tsx#Old")).toBe(false);
    // the tree too
    const tree = JSON.stringify(buildTree(s, opts(true).filter));
    expect(tree).not.toContain("Old.tsx");
    expect(JSON.stringify(buildTree(s, opts(false).filter))).toContain("Old.tsx");
  });

  test("a diff opens with its declarations, then the files around them", () => {
    const s = applyDiff(snapshot());
    const ids = changesToShow(s);
    expect(ids.slice(0, 4).sort()).toEqual(["src/App.tsx#App", "src/Footer.tsx#Footer", "src/Header.tsx#Header", "src/Old.tsx#Old"]);
    expect(ids).toContain("src/Header.tsx");
    expect(changesToShow(s, 2)).toHaveLength(2);
  });

  test("before → after in words; refs in short", () => {
    const s = applyDiff(snapshot());
    expect(signatureChanges(s.diff!.before["src/Header.tsx#Header"]!, s.nodes["src/Header.tsx#Header"]!)).toEqual([
      { kind: "param", what: "added", isProp: true, to: { name: "title", type: "string", optional: false } },
    ]);
    // a type only the head has (the base is compared untyped) isn't a change; a different one is
    const was = { ...s.nodes["src/Header.tsx#Header"]!, signature: { params: [] } };
    expect(signatureChanges(was, { ...was, signature: { params: [], returnType: "Element" } })).toEqual([]);
    expect(signatureChanges({ ...was, signature: { params: [], returnType: "string" } }, { ...was, signature: { params: [], returnType: "number" } })).toEqual([{ kind: "return", from: "string", to: "number" }]);
    // the rest (boundary, async, role) is the code diff's: not listed
    expect(signatureChanges({ ...was, moduleType: "server", isAsync: false }, { ...was, moduleType: "client", isAsync: true })).toEqual([]);
    // an optional prop's `| undefined` (added by TypeScript on one side only) isn't a change either
    const opt = (type: string) => ({ ...was, props: [{ name: "list", optional: true, type }] });
    expect(signatureChanges(opt("SnapshotList"), opt("SnapshotList | undefined"))).toEqual([]);
    expect(signatureChanges(opt("A"), opt("B | undefined"))).toEqual([
      { kind: "param", what: "changed", isProp: true, from: { name: "list", type: "A", optional: true }, to: { name: "list", type: "B | undefined", optional: true } },
    ]);
    // becoming optional is a change; a parameter removed keeps its type
    const fn = (params: { name: string; type?: string; optional?: boolean }[]) => ({ ...was, props: undefined, signature: { params } });
    expect(signatureChanges(fn([{ name: "a", type: "string" }]), fn([{ name: "a", type: "string", optional: true }]))[0]).toMatchObject({ what: "changed", isProp: false });
    expect(signatureChanges(fn([{ name: "a", type: "string" }]), fn([]))).toEqual([{ kind: "param", what: "removed", isProp: false, from: { name: "a", type: "string", optional: false } }]);
    // with annotations, what the code says counts: the same annotation printed differently isn't a change
    const ann = (type: string, written?: string) => ({ ...was, props: undefined, signature: { params: [{ name: "rule", type, written }] } });
    expect(signatureChanges(ann("DesignedRuleInput", "DesignedRuleInput"), ann("{ id: string; name?: string }", "DesignedRuleInput"), { annotations: true })).toEqual([]);
    expect(signatureChanges(ann("A", "A"), ann("B", "B"), { annotations: true })).toEqual([
      { kind: "param", what: "changed", isProp: false, from: { name: "rule", type: "A", optional: false, written: "A" }, to: { name: "rule", type: "B", optional: false, written: "B" } },
    ]);
    // inferred on both sides (both typed): the inferred types
    expect(signatureChanges(ann("string"), ann("number"), { annotations: true })[0]).toMatchObject({ what: "changed", from: { type: "string" }, to: { type: "number" } });
    expect(signatureChanges(ann("string"), ann("string", "string"), { annotations: true })).toHaveLength(1); // annotation added
    const ret = (returnType: string, returnWritten?: string) => ({ ...was, props: undefined, signature: { params: [], returnType, returnWritten } });
    expect(signatureChanges(ret("Props", "Props"), ret("{ a: string }", "Props"), { annotations: true })).toEqual([]);
    expect(signatureChanges(ret("string", "string"), ret("number", "number"), { annotations: true })).toEqual([{ kind: "return", from: "string", to: "number" }]);
    // an inferred return type (no annotation on either side) that changed
    expect(signatureChanges(ret("JSX.Element"), ret("JSX.Element | null"), { annotations: true })).toEqual([{ kind: "return", from: "JSX.Element", to: "JSX.Element | null" }]);
    // ReactElement[] written on both sides, printed with default type arguments on one: no change
    expect(signatureChanges(ret("ReactElement[]", "ReactElement[]"), ret("ReactElement<unknown, string | JSXElementConstructor<any>>[]", "ReactElement[]"), { annotations: true })).toEqual([]);
    // the same return type, other returned code: marked modified (and only then)
    const rh = (returnHash: string, returnType = "ReactElement[]") => ({ ...was, props: undefined, signature: { params: [], returnType, returnWritten: returnType, returnHash } });
    expect(signatureChanges(rh("a"), rh("b"), { annotations: true })).toEqual([{ kind: "returned", type: "ReactElement[]" }]);
    expect(signatureChanges(rh("a"), rh("a"), { annotations: true })).toEqual([]);
    expect(signatureChanges(rh("a", "string"), rh("b", "number"), { annotations: true })).toEqual([{ kind: "return", from: "string", to: "number" }]); // a real type change says so instead
    expect(sideLabel("refs/pull/12/head", "b".repeat(40))).toBe("#12 bbbbbbb");
    expect(sideLabel("refs/merge-requests/3/head", "b".repeat(40))).toBe("!3 bbbbbbb");
    expect(sideLabel("main", "a".repeat(40))).toBe("main aaaaaaa");
  });
});
