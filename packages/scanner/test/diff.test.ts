import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Snapshot } from "@rae/schema";
import { scanDiff } from "../src/diffScan.ts";
import { changedFiles, exportCommit, fetchRequest, git, listBranches, listRequests, mergeBase, repoOf, resolveRef } from "../src/git.ts";

// A small React repo with history: main, a feature branch off it, and main moving on after the branch.
const ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let tmp: string;
let repo: string;
let trees: string;
const sh = (args: string[], cwd = repo) => git(cwd, args, ENV);
const write = (files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
};
const commit = async (msg: string) => {
  await sh(["add", "-A"]);
  await sh(["commit", "-q", "-m", msg]);
  return (await sh(["rev-parse", "HEAD"])).trim();
};

let baseSha: string;
let featureSha: string;
beforeAll(async () => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "rae-diff-")));
  repo = join(tmp, "repo");
  trees = join(tmp, "trees");
  mkdirSync(repo);
  await sh(["init", "-q", "-b", "main"]);
  write({
    "package.json": `{ "name": "demo" }`,
    "src/main.tsx": `import { App } from "./App";\nexport function main() { return <App />; }\n`,
    "src/App.tsx": `import { Header } from "./Header";\nimport { Old } from "./Old";\nexport function App() {\n  return <div><Header /><Old /></div>;\n}\n`,
    "src/Header.tsx": `export function Header() {\n  return <h1>Hi</h1>;\n}\n`,
    "src/Old.tsx": `export function Old() {\n  return <p>old</p>;\n}\n`,
    "src/util/format.ts": `export function format(s: string) {\n  return s.trim();\n}\nexport function same(n: number) {\n  return n;\n}\n`,
  });
  baseSha = await commit("base");
  await sh(["checkout", "-q", "-b", "feature"]);
  rmSync(join(repo, "src/Old.tsx"));
  renameSync(join(repo, "src/util/format.ts"), join(repo, "src/util/text.ts"));
  write({
    "src/App.tsx": `import { Header } from "./Header";\nimport { Footer } from "./Footer";\nexport function App() {\n  return <div><Header /><Footer /></div>;\n}\n`,
    "src/Header.tsx": `export function Header({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}\n`,
    "src/Footer.tsx": `import { format } from "./util/text";\nexport function Footer() {\n  return <footer>{format(" bye ")}</footer>;\n}\n`,
    "src/util/text.ts": `export function format(s: string) {\n  return s.trim();\n}\nexport function same(n: number) {\n  return n;\n}\n`,
  });
  featureSha = await commit("feature: footer, header title");
  // main moves on: a change the feature's diff must not show (compared against the merge-base)
  await sh(["checkout", "-q", "main"]);
  write({ "src/Late.tsx": `export function Late() {\n  return null;\n}\n` });
  await commit("later on main");
  await sh(["checkout", "-q", "feature"]);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("git, plain commands", () => {
  test("repo, refs, merge-base, branches", async () => {
    const info = (await repoOf(join(repo, "src")))!;
    expect(info.root).toBe(repo);
    expect(info.branch).toBe("feature");
    expect(info.defaultBranch).toBe("main");
    expect(info.head).toBe(featureSha);
    expect(await resolveRef(repo, "feature")).toBe(featureSha);
    expect(resolveRef(repo, "--output=x")).rejects.toThrow();
    expect(resolveRef(repo, "nope")).rejects.toThrow("Unknown ref");
    expect(await mergeBase(repo, "main", "feature")).toBe(baseSha);
    expect((await listBranches(repo)).map((b) => b.name).sort()).toEqual(["feature", "main"]);
    expect(await repoOf(tmp)).toBeUndefined();
  });

  test("changed files: renames, line counts", async () => {
    const files = await changedFiles(repo, baseSha, featureSha);
    const by = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(by["src/util/text.ts"]).toMatchObject({ status: "renamed", from: "src/util/format.ts" });
    expect(by["src/Old.tsx"]!.status).toBe("deleted");
    expect(by["src/Footer.tsx"]).toMatchObject({ status: "added", additions: 4, deletions: 0 });
    expect(by["src/Header.tsx"]).toMatchObject({ status: "modified", additions: 2, deletions: 2 });
  });

  test("exporting a commit leaves the repo as it was", async () => {
    const before = await sh(["status", "--porcelain"]);
    const dir = await exportCommit(repo, baseSha, trees);
    expect(readdirSync(join(dir, "src")).sort()).toEqual(["App.tsx", "Header.tsx", "Old.tsx", "main.tsx", "util"]);
    expect(await exportCommit(repo, baseSha, trees)).toBe(dir); // reused
    expect(await sh(["status", "--porcelain"])).toBe(before);
    expect((await sh(["worktree", "list"])).trim().split("\n")).toHaveLength(1);
  });

  test("pull / merge request refs from a remote (ls-remote, fetch into FETCH_HEAD)", async () => {
    // a bare "host" that publishes request refs as GitHub and GitLab do
    const host = join(tmp, "host.git");
    await git(tmp, ["init", "-q", "--bare", host], ENV);
    await sh(["push", "-q", host, "main", `${featureSha}:refs/pull/7/head`, `${featureSha}:refs/merge-requests/3/head`]);
    await sh(["remote", "add", "origin", host]);
    const requests = await listRequests(repo);
    expect(requests.map((r) => `${r.provider} ${r.number}`)).toEqual(["github 7", "gitlab 3"]);
    expect(await fetchRequest(repo, requests[0]!)).toBe(featureSha);
    expect(fetchRequest(repo, { ref: "refs/heads/main" })).rejects.toThrow();
    // no branch or ref was created
    expect((await sh(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/pull"])).trim().split("\n")).toEqual(["refs/heads/feature", "refs/heads/main"]);
    await sh(["remote", "remove", "origin"]);
  });
});

describe("scanDiff: a branch against main", () => {
  let s: Snapshot;
  beforeAll(async () => {
    s = await scanDiff(repo, { base: "main", head: "feature", types: false, cache: false, treesDir: trees, mergeSingleExport: false });
  });

  test("sides: merge-base by default, the project's root", () => {
    const d = s.diff!;
    expect(d.compared).toBe(baseSha);
    expect(d.against).toBe("merge-base");
    expect(d.head).toMatchObject({ ref: "feature", sha: featureSha, subject: "feature: footer, header title" });
    expect(d.base.subject).toBe("later on main");
    expect(s.rootDir).toBe(repo);
    // the head is checked out: files open from the checkout
    expect(s.nodes["src/Header.tsx#Header"]!.absPath).toBe(join(repo, "src/Header.tsx"));
  });

  test("added, removed, changed; unchanged and later-on-main left out", () => {
    const d = s.diff!;
    expect(d.nodes["src/Footer.tsx#Footer"]).toBe("added");
    expect(d.nodes["src/Footer.tsx"]).toBe("added");
    expect(d.nodes["src/Old.tsx#Old"]).toBe("removed");
    expect(d.removed["src/Old.tsx#Old"]!.name).toBe("Old");
    expect(d.nodes["src/Header.tsx#Header"]).toBe("changed");
    expect(d.nodes["src/App.tsx#App"]).toBe("changed");
    expect(d.nodes["src/main.tsx#main"]).toBeUndefined();
    expect(Object.keys(d.nodes).some((id) => id.includes("Late"))).toBe(false);
  });

  test("renamed files: their declarations match, unchanged", () => {
    const d = s.diff!;
    expect(d.renamed["src/util/format.ts#format"]).toBe("src/util/text.ts#format");
    expect(d.nodes["src/util/text.ts#format"]).toBeUndefined();
    expect(d.nodes["src/util/text.ts#same"]).toBeUndefined();
    expect(d.files.find((f) => f.path === "src/util/text.ts")).toMatchObject({ status: "renamed", from: "src/util/format.ts" });
  });

  test("edges: added and removed relations", () => {
    const d = s.diff!;
    const has = (list: typeof d.edges.added, kind: string, from: string, to: string) => list.some((e) => e.kind === kind && e.from === from && e.to === to);
    expect(has(d.edges.added, "renders", "src/App.tsx#App", "src/Footer.tsx#Footer")).toBe(true);
    expect(has(d.edges.added, "invokes", "src/Footer.tsx#Footer", "src/util/text.ts#format")).toBe(true);
    expect(has(d.edges.removed, "renders", "src/App.tsx#App", "src/Old.tsx#Old")).toBe(true);
    // the renamed file's edges aren't reported as removed + added
    expect(has(d.edges.removed, "declares", "src/util/text.ts", "src/util/text.ts#same")).toBe(false);
  });

  test("against the base's tip: main's later commit shows as removed", async () => {
    const tip = await scanDiff(repo, { base: "main", head: "feature", against: "base", types: false, cache: false, treesDir: trees, mergeSingleExport: false });
    expect(tip.diff!.nodes["src/Late.tsx#Late"]).toBe("removed");
  });

  test("a sub-folder of the repo, merged files", async () => {
    const sub = await scanDiff(join(repo, "src"), { base: "main", head: "feature", types: false, cache: false, treesDir: trees });
    expect(sub.rootDir).toBe(join(repo, "src"));
    expect(sub.diff!.files.map((f) => f.path).sort()).toEqual(["App.tsx", "Footer.tsx", "Header.tsx", "Old.tsx", "util/text.ts"]);
    // merged: Footer.tsx is just Footer, under the file's id
    expect(sub.diff!.nodes["Footer.tsx"]).toBe("added");
    expect(sub.diff!.nodes["Header.tsx"]).toBe("changed");
  });
});

describe("scanDiff: a monorepo app using a workspace package", () => {
  test("the package is read as it is at each commit (not from the checkout)", async () => {
    const mono = join(tmp, "mono");
    mkdirSync(mono);
    const m = (args: string[]) => git(mono, args, ENV);
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(mono, path)), { recursive: true });
      writeFileSync(join(mono, path), text);
    };
    await m(["init", "-q", "-b", "main"]);
    put(".gitignore", "node_modules\n");
    put("packages/ui/package.json", `{ "name": "@demo/ui", "exports": { "./*": "./src/*.tsx" } }`);
    put("packages/ui/src/Button.tsx", `export function Button() {\n  return <button />;\n}\n`);
    put("apps/web/package.json", `{ "name": "web" }`);
    put("apps/web/src/main.tsx", `import { Button } from "@demo/ui/Button";\nexport function Main() {\n  return <Button />;\n}\n`);
    // installed workspace link, as bun / pnpm / npm create it (relative, not committed)
    mkdirSync(join(mono, "apps/web/node_modules/@demo"), { recursive: true });
    symlinkSync("../../../../packages/ui", join(mono, "apps/web/node_modules/@demo/ui"));
    await m(["add", "-A"]);
    await m(["commit", "-q", "-m", "base"]);
    await m(["checkout", "-q", "-b", "feature"]);
    put("packages/ui/src/Button.tsx", `export function Button({ big }: { big?: boolean }) {\n  return <button data-big={big} />;\n}\n`);
    await m(["commit", "-qam", "bigger button"]);

    const s = await scanDiff(join(mono, "apps/web"), { base: "main", types: false, cache: false, treesDir: trees });
    expect(Object.keys(s.nodes).some((id) => id.includes(tmp.slice(1)))).toBe(false); // no ids into the temp folders
    expect(s.nodes["../../packages/ui/src/Button.tsx"]?.kind).toBe("component");
    expect(s.diff!.nodes["../../packages/ui/src/Button.tsx"]).toBe("changed");
    expect(s.diff!.nodes["src/main.tsx"]).toBeUndefined();
  });
});
