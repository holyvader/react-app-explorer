import { describe, expect, test } from "bun:test";
import type { Edge, GraphNode, NodeKind, RouteInfo, Snapshot } from "@rae/schema";
import { impactOf } from "../src/graph/impact.ts";
import { buildIndex } from "../src/graph/relations.ts";

const mod = (id: string): GraphNode => ({ id, kind: "module", name: id.split("/").pop()!, filePath: id });
const decl = (file: string, name: string, kind: NodeKind = "function"): GraphNode => ({ id: `${file}#${name}`, kind, name, filePath: file, moduleId: file });
const route = (url: string, files: RouteInfo["files"], kind: RouteInfo["kind"] = "page", parent?: string): GraphNode => ({
  id: `route:${url}`, kind: "route", name: url, filePath: "app", route: { url, segment: "", segmentKind: "static", params: [], kind, files, ...(parent ? { parent } : {}) },
});
const e = (kind: Edge["kind"], from: string, to: string): Edge => ({ kind, from, to });

/** A small App Router app: / (layout + page), /blog, /api/x, a lib file and an unused script. */
function app(changed: Record<string, "added" | "changed" | "removed">): Snapshot {
  const nodes = [
    route("/", { page: "app/page.tsx", layout: "app/layout.tsx" }),
    route("/blog", { page: "app/blog/page.tsx" }, "page", "route:/"),
    route("/api/x", { route: "app/api/x/route.ts" }, "api", "route:/"),
    mod("app/page.tsx"), decl("app/page.tsx", "Home", "component"),
    mod("app/layout.tsx"), decl("app/layout.tsx", "RootLayout", "component"),
    mod("app/blog/page.tsx"), decl("app/blog/page.tsx", "Blog", "component"),
    mod("app/api/x/route.ts"), decl("app/api/x/route.ts", "GET"),
    mod("lib/util.ts"), decl("lib/util.ts", "fmt"), decl("lib/util.ts", "slug"),
    mod("scripts/seed.ts"), decl("scripts/seed.ts", "seed"),
  ];
  const declares = nodes.filter((n) => n.moduleId).map((n) => e("declares", n.moduleId!, n.id));
  return {
    schemaVersion: 2, createdAt: "", rootDir: "/repo", entry: "/repo", framework: "next-app",
    stats: { files: 7, durationMs: 1, phases: {}, cacheHits: 0, types: false },
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: [
      ...declares,
      e("invokes", "app/blog/page.tsx#Blog", "lib/util.ts#fmt"),
      // the home page imports the lib file but only uses slug
      e("imports", "app/page.tsx", "lib/util.ts"),
      e("invokes", "app/page.tsx#Home", "lib/util.ts#slug"),
    ],
    diff: {
      base: { ref: "main", sha: "a".repeat(40) }, head: { ref: "feat", sha: "b".repeat(40) }, against: "merge-base", compared: "c".repeat(40),
      nodes: changed, removed: {}, before: {}, renamed: {}, edges: { added: [], removed: [] },
      files: Object.keys(changed).filter((id) => !id.includes("#")).map((path) => ({ path, status: "modified" as const, additions: 1, deletions: 1 })),
    },
  };
}
const run = (s: Snapshot) => impactOf(s, buildIndex(s));

describe("what a diff affects", () => {
  test("a changed helper reaches the route whose page calls it, not the one that only imports its file", () => {
    const impact = run(app({ "lib/util.ts": "changed", "lib/util.ts#fmt": "changed" }));
    expect(impact.routes.map((r) => r.url)).toEqual(["/blog"]);
    const blog = impact.routes[0]!;
    expect(blog.via).toEqual(["page"]);
    expect(blog.chain).toEqual(["app/blog/page.tsx", "app/blog/page.tsx#Blog", "lib/util.ts#fmt"]);
  });

  test("a layout change reaches every route it wraps", () => {
    const impact = run(app({ "app/layout.tsx#RootLayout": "changed" }));
    expect(impact.routes.map((r) => r.url)).toEqual(["/", "/api/x", "/blog"]);
    expect(impact.routes.find((r) => r.url === "/blog")!.via).toEqual(["layout of /"]);
    expect(impact.routes.find((r) => r.url === "/")!.via).toEqual(["layout"]);
  });

  test("a change no route runs is top level, with its file", () => {
    const impact = run(app({ "scripts/seed.ts#seed": "added" }));
    expect(impact.routes).toEqual([]);
    expect(impact.topLevel.map((t) => t.id)).toEqual(["scripts/seed.ts"]);
    expect(impact.topLevel[0]!.chain).toEqual(["scripts/seed.ts", "scripts/seed.ts#seed"]);
  });

  test("without routes: the top-level elements the change surfaces in", () => {
    const s = app({ "lib/util.ts#fmt": "changed" });
    for (const id of Object.keys(s.nodes)) if (id.startsWith("route:")) delete s.nodes[id];
    const impact = run(s);
    expect(impact.hasRoutes).toBe(false);
    // the blog page's file is where it surfaces; the route files are no longer covered by routes
    expect(impact.topLevel.map((t) => t.id)).toEqual(["app/blog/page.tsx"]);
    expect(impact.topLevel[0]!.changes).toBe(1);
  });
});
