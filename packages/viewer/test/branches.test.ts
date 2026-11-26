import { describe, expect, test } from "bun:test";
import { groupByPrefix } from "../src/lib/branches.ts";

const b = (name: string, remote = false) => ({ name, remote });

describe("groupByPrefix", () => {
  test("plain names first, then prefixes A to Z, local before remote; rows without the prefix", () => {
    const groups = groupByPrefix(
      [b("feat/login"), b("main"), b("fix/footer"), b("feat/ui/nav"), b("origin/release"), b("origin/feat/search", true), b("origin/HEAD", true)].map((x) => ({ ...x, remote: x.remote || x.name.startsWith("origin/") })),
      (x) => x.name,
      (x) => x.remote,
      (remote) => (remote ? "origin" : "Branches"),
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.rest)])).toEqual([
      ["Branches", ["main"]],
      ["feat", ["login", "ui/nav"]],
      ["fix", ["footer"]],
      ["origin", ["release", "HEAD"]],
      ["origin/feat", ["search"]],
    ]);
  });

  test("items without a name go under the plain label", () => {
    const groups = groupByPrefix([{ head: undefined as string | undefined }, { head: "renovate/bun" }], (x) => x.head, () => false, () => "other branches");
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([["other branches", 1], ["renovate", 1]]);
  });
});
