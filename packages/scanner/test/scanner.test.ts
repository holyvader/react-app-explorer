import { describe, expect, test, beforeAll } from "bun:test";
import type { Edge, Snapshot } from "@rae/schema";
import { scan } from "../src/scan.ts";

const fixture = (name: string) => new URL(`../../fixtures/${name}/`, import.meta.url).pathname;
const edge = (s: Snapshot, kind: Edge["kind"], from: string, to: string) =>
  s.edges.find((e) => e.kind === kind && e.from === from && e.to === to);

for (const types of [true, false]) {
  describe(`next-app (types: ${types})`, () => {
    let s: Snapshot;
    beforeAll(async () => {
      s = await scan(fixture("next-app"), { cache: false, types });
    });

    test("detects framework and next roles", () => {
      expect(s.framework).toBe("next-app");
      expect(s.nodes["app/page.tsx"]!.nextRole).toBe("page");
      expect(s.nodes["app/layout.tsx"]!.nextRole).toBe("layout");
    });

    test("classifies node kinds", () => {
      expect(s.nodes["app/page.tsx#HomePage"]!.kind).toBe("component");
      expect(s.nodes["hooks/useToggle.ts#useToggle"]!.kind).toBe("hook");
      expect(s.nodes["app/actions/todos.ts#addTodo"]!.kind).toBe("serverAction");
      expect(s.nodes["lib/format.ts#formatTitle"]!.kind).toBe("function");
      expect(s.nodes["ext:react"]!.kind).toBe("external");
      expect(s.nodes["ext:clsx"]!.kind).toBe("external");
    });

    test("propagates server/client boundaries", () => {
      expect(s.nodes["app/page.tsx"]!.moduleType).toBe("server");
      expect(s.nodes["components/TodoItem.tsx"]!.moduleType).toBe("client");
      expect(s.nodes["lib/format.ts"]!.moduleType).toBe("client"); // only imported from client
      expect(s.nodes["lib/data.ts"]!.moduleType).toBe("server"); // server-only
      expect(s.nodes["components/Header.tsx#Header"]!.moduleType).toBe("server");
    });

    test("import types: static, lazy, next-dynamic, type-only", () => {
      expect(edge(s, "imports", "app/dashboard/page.tsx", "components/Chart.tsx")!.importType).toBe("next-dynamic");
      expect(edge(s, "imports", "app/dashboard/page.tsx", "components/Stats.tsx")!.importType).toBe("lazy");
      expect(edge(s, "imports", "components/TodoItem.tsx", "lib/data.ts")!.importType).toBe("type-only");
      expect(edge(s, "imports", "app/page.tsx", "components/TodoList.tsx")!.importType).toBe("static");
    });

    test("render conditions", () => {
      expect(edge(s, "renders", "app/dashboard/page.tsx#DashboardPage", "components/Chart.tsx#Chart")!.conditions).toEqual([
        { kind: "ternary-true", expr: 'tab === "chart"' },
      ]);
      // memo(Stats) default export resolves to the Stats decl
      expect(edge(s, "renders", "app/dashboard/page.tsx#DashboardPage", "components/Stats.tsx#Stats")!.conditions![0]!.kind).toBe("ternary-false");
      expect(edge(s, "renders", "components/TodoList.tsx#TodoList", "components/TodoItem.tsx#TodoItem")!.conditions![0]!.kind).toBe("map");
      const todoList = edge(s, "renders", "app/page.tsx#HomePage", "components/TodoList.tsx#TodoList")!;
      expect(todoList.conditions!.map((c) => c.kind)).toEqual(["early-return", "suspense"]);
      const tree = s.nodes["app/page.tsx#HomePage"]!.renderTree!;
      expect(tree[0]!.tag).toBe("p");
      expect(tree[0]!.conditions).toEqual([{ kind: "if", expr: "!user" }]);
      const a = tree[1]!.children.find((c) => c.tag === "a")!;
      expect(a.native).toBe(true);
      expect(a.conditions).toEqual([{ kind: "and", expr: "user.isAdmin" }]);
    });

    test("hooks, invokes and server action invokes", () => {
      expect(edge(s, "usesHook", "components/AddTodoForm.tsx#AddTodoForm", "hooks/useToggle.ts#useToggle")).toBeDefined();
      expect(edge(s, "usesHook", "components/TodoItem.tsx#TodoItem", "ext:react")!.specifiers).toEqual(["useState"]);
      expect(edge(s, "invokesAction", "components/AddTodoForm.tsx#AddTodoForm", "app/actions/todos.ts#addTodo")).toBeDefined();
      expect(edge(s, "invokes", "app/page.tsx#HomePage", "lib/data.ts#getUser")).toBeDefined();
      const item = s.nodes["components/TodoItem.tsx#TodoItem"]!;
      expect(item.hooksUsed![0]!.assignedTo).toBe("[done, setDone]");
      expect(item.functions![0]!.name).toBe("toggle");
    });

    test("props and signatures", () => {
      const header = s.nodes["components/Header.tsx#Header"]!;
      const subtitle = header.props!.find((p) => p.name === "subtitle")!;
      expect(subtitle.optional).toBe(true);
      expect(subtitle.default).toBe('"sub"');
      expect(header.props!.find((p) => p.name === "title")!.type).toBe("string");
      expect(s.nodes["lib/format.ts#formatTitle"]!.signature!.returnType).toBe("string");
      if (types) {
        expect(s.nodes["hooks/useToggle.ts#useToggle"]!.signature!.returnType).toBe("{ on: boolean; toggle: () => void; }");
        expect(s.nodes["components/TodoItem.tsx#TodoItem"]!.hooksUsed![0]!.returnType).toBe(
          "[boolean, Dispatch<SetStateAction<boolean>>]",
        );
        expect(s.nodes["app/actions/todos.ts#addTodo"]!.signature!.returnType).toBe("Promise<{ ok: boolean; }>");
      }
    });
  });
}

describe("react-app", () => {
  let s: Snapshot;
  beforeAll(async () => {
    s = await scan(fixture("react-app"), { cache: false });
  });

  test("framework, module-level render and lazy import", () => {
    expect(s.framework).toBe("react");
    expect(edge(s, "renders", "src/main.tsx", "src/App.tsx#App")).toBeDefined();
    expect(edge(s, "imports", "src/App.tsx", "src/components/Settings.tsx")!.importType).toBe("lazy");
    expect(s.nodes["src/App.tsx"]!.moduleType).toBe("client");
  });

  test("switch-case conditions via local variable", () => {
    const e = edge(s, "renders", "src/App.tsx#App", "src/components/Settings.tsx#Settings")!;
    expect(e.conditions).toEqual([
      { kind: "switch-case", expr: 'view === "settings"' },
      { kind: "suspense", expr: "null" },
    ]);
  });

  test("props from interface with defaults", () => {
    const props = s.nodes["src/components/Button.tsx#Button"]!.props!;
    expect(props.map((p) => p.name)).toEqual(["label", "onClick", "variant"]);
    expect(props.find((p) => p.name === "variant")!.default).toBe('"primary"');
  });

  test("entry-file mode follows imports", async () => {
    const s2 = await scan(fixture("react-app") + "src/main.tsx", { cache: false, types: false });
    expect(Object.keys(s2.nodes)).toContain("src/components/Settings.tsx#Settings");
    expect(s2.entry).toBe("src/main.tsx");
  });
});

describe("invokes", () => {
  test("new Foo() and module-level calls create invokes edges", async () => {
    const s = await scan(fixture("next-app"), { cache: false, types: false });
    expect(edge(s, "invokes", "lib/store.ts#createStore", "lib/store.ts#TodoStore")).toBeDefined();
    expect(edge(s, "invokes", "lib/store.ts", "lib/store.ts#createStore")).toBeDefined();
    expect(s.schemaVersion).toBe(2);
  });
});

describe("aliases and externals: only packages are external", () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  /** Writes a throwaway project; returns its root. */
  const project = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "rae-alias-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };
  const kindOf = (s: Snapshot, id: string) => s.nodes[id]?.kind;

  test("tsconfig paths alias: existing → local, missing → a 'missing' file (not external); assets are files", async () => {
    const root = project({
      "tsconfig.json": `{
        // comments and trailing commas, as tsconfigs have them
        "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"], }, },
      }`,
      "src/main.tsx": [
        `import { Real } from "@/components/Real";`,
        `import { Gone } from "@/generated/Gone";`,
        `import { Rel } from "./nowhere";`,
        `import "./style.css";`,
        `import { useState } from "react";`,
        `import fp from "lodash/fp";`,
        `export function App() { useState(0); fp; return <Real><Gone /><Rel /></Real>; }`,
      ].join("\n"),
      "components/Real.tsx": `export function Real({ children }: { children?: unknown }) { return <div>{children as never}</div>; }`,
      "src/style.css": `body {}`,
    });
    const s = await scan(join(root, "src/main.tsx"), { cache: false, types: false });
    expect(kindOf(s, "components/Real.tsx")).toBe("module");
    expect(s.nodes["generated/Gone"]).toMatchObject({ kind: "module", missing: true, specifier: "@/generated/Gone" });
    expect(s.nodes["src/nowhere"]).toMatchObject({ kind: "module", missing: true });
    expect(s.nodes["src/style.css"]).toMatchObject({ kind: "module", asset: true });
    // bare names that are no alias stay packages, installed or not
    expect(kindOf(s, "ext:react")).toBe("external");
    expect(kindOf(s, "ext:lodash/fp")).toBe("external");
    expect(Object.values(s.nodes).filter((n) => n.kind === "external" && n.name.startsWith("@/"))).toEqual([]);
  });

  test("Vite-style: tsconfig.json only references tsconfig.app.json, which declares the aliases", async () => {
    const root = project({
      "tsconfig.json": `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }`,
      "tsconfig.app.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./src/*"] } }, "include": ["src"] }`,
      "tsconfig.node.json": `{ "compilerOptions": {}, "include": ["vite.config.ts"] }`,
      "src/main.tsx": `import { App } from "~/App";\nimport { X } from "~/missing/X";\nexport const main = () => [App, X];`,
      "src/App.tsx": `export function App() { return <div />; }`,
    });
    const s = await scan(join(root, "src/main.tsx"), { cache: false, types: false });
    expect(kindOf(s, "src/App.tsx")).toBe("module");
    expect(s.nodes["src/missing/X"]).toMatchObject({ kind: "module", missing: true });
    expect(Object.values(s.nodes).filter((n) => n.kind === "external")).toEqual([]);
  });

  test("monorepo: each package's files use that package's own aliases", async () => {
    const root = project({
      "apps/web/tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }`,
      "apps/web/page.tsx": `import { Button } from "../../packages/ui/src/Button";\nexport default function Page() { return <Button />; }`,
      "packages/ui/tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }`,
      "packages/ui/src/Button.tsx": `import { cn } from "@/lib/cn";\nimport { Icon } from "@/icons/Icon";\nexport function Button() { cn(); return <Icon />; }`,
      "packages/ui/src/lib/cn.ts": `export const cn = () => "";`,
    });
    const s = await scan(join(root, "apps/web/page.tsx"), { cache: false, types: false });
    const cn = Object.keys(s.nodes).find((id) => id.endsWith("packages/ui/src/lib/cn.ts"));
    expect(cn && kindOf(s, cn)).toBe("module");
    // ui's "@/icons/Icon" means packages/ui/src/icons/Icon (missing) — not apps/web/icons, not a package
    expect(Object.values(s.nodes).find((n) => n.missing)?.filePath).toMatch(/packages\/ui\/src\/icons\/Icon$/);
    expect(Object.values(s.nodes).filter((n) => n.kind === "external")).toEqual([]);
  });
});

describe("generics and extends", () => {
  test("type parameters with constraints/defaults, interface extends, and their type links", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const root = mkdtempSync(join(tmpdir(), "rae-gen-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), `{ "name": "gen" }`);
    writeFileSync(
      join(root, "src/list.tsx"),
      [
        `export interface Item { id: string }`,
        `export interface Base<T> { items: T[] }`,
        `export interface ListProps<T extends Item = Item> extends Base<T>, Omit<Base<T>, "items"> { onSelect?: (item: T) => void }`,
        `export function List<T extends Item>({ items }: ListProps<T>) { return <ul>{items.length}</ul>; }`,
        `export const pick = <T, K extends keyof T>(o: T, k: K): T[K] => o[k];`,
      ].join("\n"),
    );
    const s = await scan(join(root, "src/list.tsx"), { cache: false, types: false });
    expect(s.nodes["src/list.tsx#ListProps"]).toMatchObject({
      typeParams: [{ name: "T", constraint: "Item", default: "Item" }],
      extends: ["Base<T>", `Omit<Base<T>, "items">`],
      typeRefs: { Base: "src/list.tsx#Base", Item: "src/list.tsx#Item" },
    });
    expect(s.nodes["src/list.tsx#List"]!.typeParams).toEqual([{ name: "T", constraint: "Item" }]);
    expect(s.nodes["src/list.tsx#pick"]!.typeParams).toEqual([{ name: "T" }, { name: "K", constraint: "keyof T" }]);
    expect(edge(s, "usesType", "src/list.tsx#ListProps", "src/list.tsx#Base")).toBeDefined();
  });
});

describe("App Router routes", () => {
  test("route tree, segment kinds, API methods, and navigation matched to routes", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const root = mkdtempSync(join(tmpdir(), "rae-routes-"));
    const files: Record<string, string> = {
      "package.json": `{ "name": "r", "dependencies": { "next": "15" } }`,
      "app/layout.tsx": `export default function Root({ children }: { children: unknown }) { return <html>{children as never}</html>; }`,
      "app/(marketing)/layout.tsx": `export default function M({ children }: { children: unknown }) { return <div>{children as never}</div>; }`,
      "app/(marketing)/page.tsx": [
        `import Link from "next/link";`,
        `export default function Home({ slug }: { slug: string }) {`,
        `  return <><Link href="/blog/new">new</Link><Link href={\`/blog/\${slug}\`}>post</Link><a href="/docs/a/b?x=1">docs</a><a href="https://x.dev">out</a></>;`,
        `}`,
      ].join("\n"),
      "app/blog/[slug]/page.tsx": `import { redirect } from "next/navigation";\nexport default async function Post() { const r = await fetch("/api/posts"); if (!r.ok) redirect("/"); return <p />; }`,
      "app/blog/new/page.tsx": `export default function New() { return <p />; }`,
      "app/blog/@modal/default.tsx": `export default function D() { return null; }`,
      "app/docs/[[...slug]]/page.tsx": `export default function Docs() { return <p />; }`,
      "app/@modal/default.tsx": `export default function D() { return null; }`,
      "app/@modal/(.)blog/[slug]/page.tsx": `export default function Quick() { return <dialog />; }`,
      "app/api/posts/route.ts": `export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }`,
    };
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), t);
    }
    const s = await scan(root, { cache: false, types: false });
    const r = (id: string) => s.nodes[id]!.route!;
    expect(r("route:/")).toMatchObject({ url: "/", segmentKind: "root", kind: "segment" });
    expect(r("route:/(marketing)")).toMatchObject({ url: "/", segmentKind: "group", kind: "page", parent: "route:/" });
    expect(s.nodes["route:/(marketing)"]!.name).toBe("/ (marketing)");
    expect(r("route:/blog/[slug]")).toMatchObject({ url: "/blog/[slug]", segmentKind: "dynamic", params: ["slug"], kind: "page" });
    expect(r("route:/blog/@modal")).toMatchObject({ url: "/blog", segmentKind: "slot", kind: "segment" });
    expect(r("route:/docs/[[...slug]]")).toMatchObject({ segmentKind: "optionalCatchAll", params: ["slug"] });
    expect(r("route:/api/posts")).toMatchObject({ kind: "api", methods: ["GET", "POST"], files: { route: "app/api/posts/route.ts" } });

    // intercepting (the marker on a parent folder): named as Next prints it, and never a link target
    expect(s.nodes["route:/@modal/(.)blog/[slug]"]).toMatchObject({ name: "/(.)blog/[slug]", route: { url: "/blog/[slug]", segmentKind: "intercept" } });
    const home = "app/(marketing)/page.tsx#Home";
    // static beats dynamic; a template part matches a dynamic segment; query strings are dropped; external links ignored
    expect(edge(s, "navigates", home, "route:/blog/new")?.href).toBe("/blog/new");
    expect(edge(s, "navigates", home, "route:/blog/[slug]")?.href).toBe("/blog/[…]");
    expect(edge(s, "navigates", home, "route:/docs/[[...slug]]")?.href).toBe("/docs/a/b");
    expect(s.nodes[home]!.navigations!.some((n) => n.href.includes("x.dev"))).toBe(false);
    expect(edge(s, "fetches", "app/blog/[slug]/page.tsx#Post", "route:/api/posts")).toBeDefined();
    expect(edge(s, "navigates", "app/blog/[slug]/page.tsx#Post", "route:/(marketing)")?.via).toBe("redirect");
    expect(edge(s, "routeChild", "route:/blog", "route:/blog/[slug]")).toBeUndefined(); // app/blog has no special files: not a route
    expect(edge(s, "routeChild", "route:/", "route:/blog/[slug]")).toBeDefined();
  });
});
