import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBranchName } from "../src/git.ts";
import { upgradeIndex } from "../src/snapshotIndex.ts";

describe("isBranchName", () => {
  test("what git allows, accents and + @ # included", () => {
    for (const ok of ["main", "feat/login", "fix/über-bug", "feat+x", "user@feature", "release/1.2", "a#b"]) expect(isBranchName(ok)).toBe(true);
  });
  test("what git refuses, and options", () => {
    for (const bad of ["", "-rf", "a..b", "a b", "a~1", "a^", "a:b", "a?", "a*", "a[b", "a\\b", "a@{1}", "a//b", "a/", "a.", ".hidden", "x/.y", "a.lock", "@"]) expect(isBranchName(bad)).toBe(false);
  });
});

describe("upgradeIndex", () => {
  test("old entries learn their view from the snapshot, once (the index is saved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rae-index-"));
    try {
      writeFileSync(join(dir, "a.json"), JSON.stringify({ commit: { ref: "origin/main", sha: "abc" } }));
      writeFileSync(join(dir, "b.json"), JSON.stringify({}));
      const entries = [{ file: "a.json", createdAt: "2", rootDir: "/p" }, { file: "b.json", createdAt: "1", rootDir: "/p" }, { file: "c.json", createdAt: "0", rootDir: "/p", kind: "worktree" }] as never[];
      const out = upgradeIndex(dir, entries);
      expect(out.map((e: { kind?: string; commit?: { ref: string } }) => [e.kind, e.commit?.ref])).toEqual([["branch", "origin/main"], ["worktree", undefined], ["worktree", undefined]]);
      expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))[0].kind).toBe("branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
