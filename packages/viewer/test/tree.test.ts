import { describe, expect, test } from "bun:test";
import type { GraphNode, Snapshot } from "@rae/schema";
import { buildTree, changesTree, openKeys, type TreeNode } from "../src/graph/tree.ts";
import { branchOptions } from "../src/lib/branches.ts";

const mod = (path: string): GraphNode => ({ id: path, kind: "module", name: path.split("/").pop()!, filePath: path });
const ext = (spec: string): GraphNode => ({ id: `ext:${spec}`, kind: "external", name: spec, filePath: spec });
const snap = (nodes: GraphNode[]): Snapshot => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), edges: [] }) as unknown as Snapshot;
const filter = { excluded: new Set<string>(), hideAll: false };
const names = (list: TreeNode[]): unknown => list.map((n) => (n.children.length ? { [n.name]: names(n.children) } : n.name));

describe("libraries in the tree", () => {
  test("nested by package; a package imported by one path stays one row", () => {
    const s = snap([mod("src/a.ts"), ext("next/link"), ext("next/navigation"), ext("zod"), ext("@scope/ui"), ext("@scope/ui/icons"), ext("node:fs"), ext("node:path")]);
    const libs = buildTree(s, filter).find((n) => n.kind === "libraries")!;
    expect(names(libs.children)).toEqual([{ "@scope/ui": ["icons"] }, { next: ["link", "navigation"] }, { node: ["fs", "path"] }, "zod"]);
    expect(libs.children.find((n) => n.name === "next")).toMatchObject({ kind: "package", key: "pkg:next" });
    // the bare package imported too: its own row holds the paths
    expect(libs.children.find((n) => n.name === "@scope/ui")).toMatchObject({ kind: "library", id: "ext:@scope/ui" });
    // a subpath keeps its specifier as the path (the filter matches it)
    expect(libs.children.find((n) => n.name === "next")!.children[0]).toMatchObject({ path: "next/link", id: "ext:next/link" });
  });
});

describe("the changes tree", () => {
  test("only what changed, with the folders down to it, single-folder chains merged", () => {
    const s = snap([mod("src/lib/a.ts"), mod("src/lib/b.ts"), mod("src/ui/c.tsx"), mod("README.md")]);
    const changed = new Set(["src/lib/a.ts"]);
    const tree = changesTree(buildTree(s, filter), (n) => !!n.id && changed.has(n.id));
    expect(names(tree)).toEqual([{ "src/lib": ["a.ts"] }]);
    expect([...openKeys(tree)]).toEqual(["dir:src/lib"]);
  });
});

describe("branch options", () => {
  test("grouped by prefix: plain names first, then feat/ fix/…, then remotes", () => {
    const b = (name: string, remote = false) => ({ name, remote, sha: "0", subject: "s" });
    const opts = branchOptions([b("fix/b"), b("main"), b("feat/x"), b("origin/feat/y", true), b("origin/main", true), b("feat/a")] as never, (n) => n);
    expect(opts.map((o) => [o.value, o.group])).toEqual([
      ["main", "Branches"],
      ["feat/a", "feat"],
      ["feat/x", "feat"],
      ["fix/b", "fix"],
      ["origin/main", "Remote branches"],
      ["origin/feat/y", "origin/feat"],
    ]);
  });
});

describe("branch rows", () => {
  test("remote dim, own last part bold; in a prefix group just the rest; second line: author (bold) · subject", async () => {
    const { branchParts } = await import("../src/lib/branches.ts");
    expect(branchParts("origin/feat/login-page", true)).toEqual([{ text: "origin/", tone: "dim" }, { text: "feat/" }, { text: "login-page", tone: "strong" }]);
    expect(branchParts("main")).toEqual([{ text: "main", tone: "strong" }]);
    expect(branchParts("feat/x")).toEqual([{ text: "feat/" }, { text: "x", tone: "strong" }]);
    const [o] = branchOptions([{ name: "origin/fix/a", remote: true, sha: "0", subject: "Fix the footer", author: "Ann", ref: "", date: "" }], (n) => n);
    expect(o!.detail).toBe("Fix the footer");
    expect(o!.detailLead).toBe("Ann");
    expect(o!.label).toBe("origin/fix/a");
    expect(o!.group).toBe("origin/fix");
    expect(o!.parts).toEqual([{ text: "a", tone: "strong" }]);
    const [n] = branchOptions([{ name: "feat/ui/top-nav", remote: false, sha: "0", subject: "s", ref: "", date: "" }], (x) => x);
    expect(n!.parts).toEqual([{ text: "ui/" }, { text: "top-nav", tone: "strong" }]);
  });
});

test("remote label: https, scp-like ssh and ssh URLs as host/path", async () => {
  const { remoteLabel } = await import("../src/lib/branches.ts");
  expect(remoteLabel("https://github.com/owner/repo.git")).toBe("github.com/owner/repo");
  expect(remoteLabel("git@github.com:owner/repo.git")).toBe("github.com/owner/repo");
  expect(remoteLabel("https://user@gitlab.example.com/group/sub/repo")).toBe("gitlab.example.com/group/sub/repo");
});
