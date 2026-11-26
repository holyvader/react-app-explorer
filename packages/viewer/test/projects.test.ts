import { describe, expect, test } from "bun:test";
import { diffRequestOf, viewKey } from "../src/lib/projects.ts";

describe("viewKey", () => {
  test("the working tree, a branch (with or without origin/), a comparison", () => {
    expect(viewKey({ file: "a", kind: "worktree" })).toBe("worktree");
    expect(viewKey({ file: "a", kind: "branch", commit: { ref: "origin/feat/x", sha: "1" } })).toBe(viewKey({ file: "b", commit: { ref: "feat/x", sha: "2" } }));
    expect(viewKey({ file: "a", kind: "diff", diff: { base: "main 1a", head: "feat 2b", changes: 3 } })).toBe("diff:main..feat");
  });
  test("comparisons with uncommitted changes, or from the base's tip, are views of their own", () => {
    const d = { base: "main 1a", head: "feat 2b", changes: 3 };
    const keys = new Set([viewKey({ file: "a", diff: d }), viewKey({ file: "b", diff: { ...d, worktree: true } }), viewKey({ file: "c", diff: { ...d, against: "base" } })]);
    expect(keys.size).toBe(3);
  });
  test("an entry that doesn't say which view it is is never taken for the working tree", () => {
    expect(viewKey({ file: "old.json" })).toBe("unknown:old.json");
  });
});

describe("diffRequestOf", () => {
  const side = (ref: string, extra = {}) => ({ ref, sha: "abc1234", ...extra });
  test("the same comparison again: a request, the uncommitted changes, or a branch", () => {
    expect(diffRequestOf({ base: side("main"), head: side("refs/pull/12/head", { request: { number: 12, provider: "github", title: "Fix" } }), against: "merge-base" } as never)).toMatchObject({ base: "main", request: "refs/pull/12/head", against: "merge-base", requestInfo: { title: "Fix" } });
    expect(diffRequestOf({ base: side("main"), head: side("feat", { worktree: true }), against: "base" } as never)).toEqual({ base: "main", worktree: true, against: "base" });
    expect(diffRequestOf({ base: side("main"), head: side("feat"), against: "merge-base" } as never)).toEqual({ base: "main", head: "feat", against: "merge-base" });
  });
});
