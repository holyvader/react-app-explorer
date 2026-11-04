import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Snapshot } from "@rae/schema";
import { scanDiff } from "../src/diffScan.ts";
import { git } from "../src/git.ts";

// main: two components and a stylesheet; feature: one re-indented (whitespace only), the CSS edited.
const ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let tmp: string;
let repo: string;
let s: Snapshot;
const sh = (args: string[]) => git(repo, args, ENV);
const write = (files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
};
const commit = async (msg: string) => {
  await sh(["add", "-A"]);
  await sh(["commit", "-q", "-m", msg]);
};

beforeAll(async () => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "rae-ws-")));
  repo = join(tmp, "repo");
  mkdirSync(repo);
  await sh(["init", "-q", "-b", "main"]);
  write({
    "package.json": `{ "name": "demo" }`,
    "src/App.tsx": `import "./app.css";\nimport { Button } from "./Button";\nexport function App() {\n  return <Button label="hi" />;\n}\n`,
    "src/Button.tsx": `export function Button({ label }: { label: string }) {\n  return <button>{label}</button>;\n}\n`,
    "src/app.css": `.app { color: red; }\n`,
  });
  await commit("base");
  await sh(["checkout", "-q", "-b", "feature"]);
  write({
    "src/Button.tsx": `export function Button({ label }: { label: string }) {\n\treturn   <button>{label}</button>;\n\n}\n`,
    "src/app.css": `.app { color: blue; }\n`,
  });
  await commit("feature");
  s = await scanDiff(repo, { base: "main", head: "feature", types: false, cache: false, treesDir: join(tmp, "trees") });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("diffs ignore whitespace; assets count", () => {
  test("a re-indented file is neither listed nor changed", () => {
    expect(s.diff!.files.map((f) => f.path)).toEqual(["src/app.css"]);
    expect(Object.keys(s.diff!.nodes).filter((id) => id.includes("Button"))).toEqual([]);
  });

  test("an edited stylesheet is a changed node, still imported", () => {
    expect(s.diff!.nodes["src/app.css"]).toBe("changed");
    expect(s.edges.some((e) => e.kind === "imports" && e.from === "src/App.tsx" && e.to === "src/app.css")).toBe(true);
  });
});
