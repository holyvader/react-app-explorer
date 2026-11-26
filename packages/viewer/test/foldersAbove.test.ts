import { describe, expect, test } from "bun:test";
import type { GraphNode, Snapshot } from "@rae/schema";
import { foldersAbove } from "../src/graph/folder.ts";

const mod = (id: string): GraphNode => ({ id, kind: "module", name: id.split("/").pop()!, filePath: id });

const snap = {
  schemaVersion: 2, createdAt: "", rootDir: "/r", entry: "/r", framework: "next-app", stats: { files: 3, durationMs: 1, phases: {}, cacheHits: 0, types: true },
  nodes: Object.fromEntries([mod("src/ui/button/index.tsx"), mod("page.tsx"), mod("../shared/x.ts"), { id: "src/ui/button/index.tsx#Button", kind: "component", name: "Button", filePath: "src/ui/button/index.tsx" } as GraphNode].map((n) => [n.id, n])),
  edges: [],
} as unknown as Snapshot;

describe("foldersAbove", () => {
  test("a file's own folder, then every folder up to the root", () => {
    expect(foldersAbove(snap, "src/ui/button/index.tsx", false)).toEqual(["dir:src/ui/button"]);
    expect(foldersAbove(snap, "src/ui/button/index.tsx", true)).toEqual(["dir:src/ui/button", "dir:src/ui", "dir:src"]);
  });
  test("a folder's parent folders", () => {
    expect(foldersAbove(snap, "dir:src/ui/button", false)).toEqual(["dir:src/ui"]);
    expect(foldersAbove(snap, "dir:src/ui/button", true)).toEqual(["dir:src/ui", "dir:src"]);
    expect(foldersAbove(snap, "dir:src", true)).toEqual([]);
  });
  test("none for a root file, a file outside the folder, or a declaration", () => {
    expect(foldersAbove(snap, "page.tsx", true)).toEqual([]);
    expect(foldersAbove(snap, "../shared/x.ts", true)).toEqual([]);
    expect(foldersAbove(snap, "src/ui/button/index.tsx#Button", true)).toEqual([]);
  });
});
