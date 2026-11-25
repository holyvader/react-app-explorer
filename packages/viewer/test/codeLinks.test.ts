import { describe, expect, test } from "bun:test";
import type { Edge, GraphNode, Snapshot } from "@rae/schema";
import { buildIndex } from "../src/graph/relations.ts";
import { codeLinks } from "../src/lib/codeLinks.ts";

const mod = (id: string): GraphNode => ({ id, kind: "module", name: id.split("/").pop()!, filePath: id });
const decl = (file: string, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id: `${file}#${name}`, kind: "function", name, filePath: file, moduleId: file, ...extra });
const e = (kind: Edge["kind"], from: string, to: string, specifiers?: string[]): Edge => ({ kind, from, to, ...(specifiers ? { specifiers } : {}) });

function snapshot(): Snapshot {
  const nodes = [
    mod("app/page.tsx"), decl("app/page.tsx", "Page", { kind: "component", typeRefs: { PageProps: "app/types.ts#PageProps" } }),
    mod("lib/data.ts"), decl("lib/data.ts", "getTodos", { exportNames: ["getTodos"] }),
    mod("app/types.ts"), decl("app/types.ts", "PageProps", { kind: "type" }),
    { id: "ext:react", kind: "external", name: "react", filePath: "react" } as GraphNode,
  ];
  return {
    schemaVersion: 2, createdAt: "", rootDir: "/r", entry: "/r", framework: "next-app", stats: { files: 3, durationMs: 1, phases: {}, cacheHits: 0, types: true },
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: [
      e("declares", "app/page.tsx", "app/page.tsx#Page"),
      e("declares", "lib/data.ts", "lib/data.ts#getTodos"),
      e("imports", "app/page.tsx", "lib/data.ts", ["getTodos as load"]),
      e("imports", "app/page.tsx", "ext:react", ["useState"]),
      e("invokes", "app/page.tsx#Page", "lib/data.ts#getTodos"),
      e("usesHook", "app/page.tsx#Page", "ext:react", ["useState"]),
    ],
  };
}

describe("code links", () => {
  test("a declaration's names: what it calls and its types; never itself or a library", () => {
    const s = snapshot();
    const links = codeLinks(s, buildIndex(s), s.nodes["app/page.tsx#Page"]!);
    expect(links.get("getTodos")).toBe("lib/data.ts#getTodos");
    // a library's hook isn't a link
    expect(links.has("useState")).toBe(false);
    expect(links.get("PageProps")).toBe("app/types.ts#PageProps");
    expect(links.has("Page")).toBe(false);
  });
  test("a whole file: imports under their local name lead to the declaration exported", () => {
    const s = snapshot();
    const links = codeLinks(s, buildIndex(s), s.nodes["app/page.tsx"]!);
    expect(links.get("load")).toBe("lib/data.ts#getTodos");
    expect(links.get("Page")).toBe("app/page.tsx#Page");
  });
  test("a declaration shown with its whole file: the file's imports are links too", () => {
    const s = snapshot();
    const index = buildIndex(s);
    const page = s.nodes["app/page.tsx#Page"]!;
    expect(codeLinks(s, index, page).has("load")).toBe(false);
    const whole = codeLinks(s, index, page, true);
    expect(whole.get("load")).toBe("lib/data.ts#getTodos");
    expect(whole.has("useState")).toBe(false);
    // still not itself, nor its own file
    expect(whole.has("Page")).toBe(false);
  });
});
