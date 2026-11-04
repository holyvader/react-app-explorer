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
      s = await scan(fixture("next-app"), { cache: false, types, mergeSingleExport: false });
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
    s = await scan(fixture("react-app"), { cache: false, mergeSingleExport: false });
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
    const s2 = await scan(fixture("react-app") + "src/main.tsx", { cache: false, types: false, mergeSingleExport: false });
    expect(Object.keys(s2.nodes)).toContain("src/components/Settings.tsx#Settings");
    expect(s2.entry).toBe("src/main.tsx");
  });
});

describe("invokes", () => {
  test("new Foo() and module-level calls create invokes edges", async () => {
    const s = await scan(fixture("next-app"), { cache: false, types: false, mergeSingleExport: false });
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
    const s = await scan(join(root, "src/main.tsx"), { cache: false, types: false, mergeSingleExport: false });
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
    const s = await scan(join(root, "src/main.tsx"), { cache: false, types: false, mergeSingleExport: false });
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
    const s = await scan(join(root, "apps/web/page.tsx"), { cache: false, types: false, mergeSingleExport: false });
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
    const s = await scan(join(root, "src/list.tsx"), { cache: false, types: false, mergeSingleExport: false });
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
    const s = await scan(root, { cache: false, types: false, mergeSingleExport: false });
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

describe("middleware matching", () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const app = (middleware: string) => {
    const root = mkdtempSync(join(tmpdir(), "rae-mw-"));
    const files: Record<string, string> = {
      "package.json": `{ "name": "m", "dependencies": { "next": "16" } }`,
      "app/layout.tsx": `export default function L({ children }: { children: unknown }) { return <html>{children as never}</html>; }`,
      "app/page.tsx": `export default function Home() { return <p />; }`,
      "app/dashboard/page.tsx": `export default function D() { return <p />; }`,
      "app/dashboard/[team]/page.tsx": `export default function T() { return <p />; }`,
      "app/api/data/route.ts": `export function GET() { return Response.json({}); }`,
      "proxy.ts": middleware,
    };
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), t);
    }
    return root;
  };
  const targets = (s: Snapshot) => s.edges.filter((e) => e.kind === "runsBefore").map((e) => e.to).sort();

  test("matcher patterns select routes; has/missing conditions are kept; redirect / rewrite targets navigate", async () => {
    const root = app(
      [
        `import { NextResponse, type NextRequest } from "next/server";`,
        `export function proxy(req: NextRequest) {`,
        `  if (!req.cookies.get("s")) return NextResponse.redirect(new URL("/", req.url));`,
        `  return NextResponse.rewrite(new URL("/dashboard", req.url));`,
        `}`,
        `export const config = { matcher: ["/dashboard/:path*", { source: "/api/:path+", has: [{ type: "header", key: "x-key" }], missing: [{ type: "cookie", key: "skip", value: "1" }] }] };`,
      ].join("\n"),
    );
    const s = await scan(root, { cache: false, types: false, mergeSingleExport: false });
    expect(s.nodes["proxy.ts"]!.middleware!.matchers).toEqual([
      { source: "/dashboard/:path*" },
      { source: "/api/:path+", has: ["header x-key"], missing: ["cookie skip=1"] },
    ]);
    expect(targets(s)).toEqual(["route:/api/data", "route:/dashboard", "route:/dashboard/[team]"]);
    expect(s.nodes["route:/api/data"]!.route!.middleware).toEqual({ id: "proxy.ts", matcher: "/api/:path+", conditions: ["has header x-key", "missing cookie skip=1"] });
    expect(s.nodes["route:/"]!.route!.middleware).toBeUndefined();
    expect(edge(s, "navigates", "proxy.ts#proxy", "route:/")?.via).toBe("redirect");
    expect(edge(s, "navigates", "proxy.ts#proxy", "route:/dashboard")?.via).toBe("rewrite");
  });

  test("no matcher: it runs before every route; a negative-lookahead matcher skips what it excludes", async () => {
    const all = await scan(app(`export function proxy() {}`), { cache: false, types: false, mergeSingleExport: false });
    expect(targets(all)).toEqual(["route:/", "route:/api/data", "route:/dashboard", "route:/dashboard/[team]"]);
    const most = await scan(app(`export function proxy() {}\nexport const config = { matcher: ["/((?!api|_next/static).*)"] };`), { cache: false, types: false, mergeSingleExport: false });
    expect(targets(most)).toEqual(["route:/", "route:/dashboard", "route:/dashboard/[team]"]);
  });
});

describe("static / dynamic rendering", () => {
  test("segment config (incl. layouts'), generateStaticParams, ISR, request-time APIs reached through components, route handlers", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const root = mkdtempSync(join(tmpdir(), "rae-render-"));
    const files: Record<string, string> = {
      "package.json": `{ "name": "r", "dependencies": { "next": "16" } }`,
      "app/layout.tsx": `export default function L({ children }: { children: unknown }) { return <html>{children as never}</html>; }`,
      "app/page.tsx": `import { Buy } from "@/components/Buy";\nexport default function Home() { return <Buy />; }`,
      "components/Buy.tsx": `"use client";\nimport { order } from "@/lib/actions";\nexport function Buy() { return <button onClick={() => order()} />; }`,
      "lib/actions.ts": `"use server";\nimport { cookies } from "next/headers";\nexport async function order() { (await cookies()).set("x", "1"); }`,
      "app/account/page.tsx": `import { Greeting } from "@/components/Greeting";\nexport default function Account() { return <Greeting />; }`,
      "components/Greeting.tsx": `import { UserName } from "./UserName";\nexport function Greeting() { return <p>Hi <UserName /></p>; }`,
      "components/UserName.tsx": `import { cookies } from "next/headers";\nexport async function UserName() { return <b>{(await cookies()).get("name")?.value}</b>; }`,
      "app/news/page.tsx": `export const revalidate = 60;\nexport default async function News() { const r = await fetch("https://x.dev/news"); return <p>{String(r.ok)}</p>; }`,
      "app/live/page.tsx": `export default async function Live() { const r = await fetch("https://x.dev/live", { cache: "no-store" }); return <p>{String(r.ok)}</p>; }`,
      "app/posts/[slug]/page.tsx": `export function generateStaticParams() { return [{ slug: "a" }]; }\nexport default function Post() { return <p />; }`,
      "app/admin/layout.tsx": `export const dynamic = "force-dynamic";\nexport default function A({ children }: { children: unknown }) { return <div>{children as never}</div>; }`,
      "app/admin/page.tsx": `export default function Admin() { return <p />; }`,
      "app/api/feed/route.ts": `export const dynamic = "force-static";\nexport function GET() { return Response.json([]); }`,
      "app/api/me/route.ts": `export function GET() { return Response.json({}); }`,
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }`,
    };
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), t);
    }
    const s = await scan(root, { cache: false, types: false, mergeSingleExport: false });
    const r = (id: string) => s.nodes[id]!.route!.rendering!;
    expect(r("route:/").mode).toBe("static"); // a server action using cookies() runs on submit: doesn't count
    expect(r("route:/account")).toMatchObject({ mode: "dynamic" });
    expect(r("route:/account").reasons[0]).toContain("cookies() in UserName");
    expect(r("route:/news")).toMatchObject({ mode: "static", revalidate: 60 });
    expect(r("route:/live").reasons[0]).toContain("fetch (no-store)");
    expect(r("route:/posts/[slug]").mode).toBe("ssg");
    expect(r("route:/admin")).toMatchObject({ mode: "dynamic", reasons: [`export const dynamic = "force-dynamic"`] }); // from its layout
    expect(r("route:/api/feed").mode).toBe("static");
    expect(r("route:/api/me").mode).toBe("dynamic");
    expect(s.nodes["route:/"]!.route!.kind).toBe("page");
  });
});

describe("Cache Components: \"use cache\", cacheLife / cacheTag, invalidation, partial prerendering", () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const project = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "rae-cc-"));
    const base: Record<string, string> = {
      "package.json": `{ "name": "c", "dependencies": { "next": "16" } }`,
      "next.config.ts": `const config = { cacheComponents: true, partialPrefetching: true };\nexport default config;`,
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }`,
      "app/layout.tsx": `export default function L({ children }: { children: unknown }) { return <html>{children as never}</html>; }`,
    };
    for (const [p, t] of Object.entries({ ...base, ...files })) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), t);
    }
    return root;
  };

  test("cache info, invalidation edges, and how routes render", async () => {
    const root = project({
      "lib/catalog.ts": [
        `import { cacheLife, cacheTag } from "next/cache";`,
        `export async function getDeals() { "use cache"; cacheLife("hours"); cacheTag("deals", "products"); return [1]; }`,
        `export async function getStock() { "use cache: remote"; cacheLife({ revalidate: 60, expire: 600 }); cacheTag("stock"); return 3; }`,
      ].join("\n"),
      "lib/cached-file.ts": `"use cache";\nexport async function getBanner() { return "hi"; }`,
      "lib/actions.ts": `"use server";\nimport { revalidateTag, updateTag } from "next/cache";\nexport async function refresh() { revalidateTag("deals", "max"); updateTag("stock"); }`,
      "app/deals/page.tsx": `import { getDeals, getStock } from "@/lib/catalog";\nexport default async function Deals() { await getDeals(); await getStock(); return <p />; }`,
      "app/account/page.tsx": `import { Suspense } from "react";\nimport { cookies } from "next/headers";\nasync function Who() { return <p>{(await cookies()).get("n")?.value}</p>; }\nexport default function Account() { return <Suspense fallback={null}><Who /></Suspense>; }`,
      "app/feed/page.tsx": `export default async function Feed() { const r = await fetch("https://x.dev/feed"); return <p>{String(r.ok)}</p>; }`,
      "app/feed/loading.tsx": `export default function L() { return <p>…</p>; }`,
      "app/me/page.tsx": `import { headers } from "next/headers";\nexport const instant = false;\nexport default async function Me() { return <p>{(await headers()).get("ua")}</p>; }`,
      "app/broken/page.tsx": `import { cookies } from "next/headers";\nexport default async function Broken() { return <p>{(await cookies()).get("x")?.value}</p>; }`,
      "app/client/page.tsx": `"use client";\nimport { useEffect } from "react";\nexport default function C() { useEffect(() => { fetch("/api/x"); }, []); return <p />; }`,
    });
    const s = await scan(root, { cache: false, types: false, mergeSingleExport: false });
    expect(s.next?.cacheComponents).toBe(true);
    expect(s.nodes["lib/catalog.ts#getDeals"]!.cache).toEqual({ variant: "default", scope: "function", life: "hours", revalidate: 3600, expire: 86400, tags: ["deals", "products"] });
    expect(s.nodes["lib/catalog.ts#getStock"]!.cache).toMatchObject({ variant: "remote", revalidate: 60, expire: 600, tags: ["stock"] });
    expect(s.nodes["lib/cached-file.ts#getBanner"]!.cache).toMatchObject({ variant: "default", scope: "file" });
    expect(edge(s, "invalidates", "lib/actions.ts#refresh", "lib/catalog.ts#getDeals")?.specifiers).toEqual(["deals"]);
    expect(edge(s, "invalidates", "lib/actions.ts#refresh", "lib/catalog.ts#getStock")).toBeDefined();

    const r = (id: string) => s.nodes[id]!.route!.rendering!;
    expect(r("route:/deals")).toMatchObject({ mode: "static", revalidate: 60, expire: 600 }); // the shortest cacheLife wins
    expect(r("route:/account").mode).toBe("ppr");
    expect(r("route:/account").reasons.join(" ")).toContain("cookies() in Who — streamed inside <Suspense> (Account)");
    expect(r("route:/feed").mode).toBe("ppr"); // uncached fetch, inside its loading.tsx
    expect(r("route:/me")).toMatchObject({ mode: "dynamic" });
    expect(r("route:/me").blocking).toBeUndefined();
    expect(r("route:/broken")).toMatchObject({ mode: "dynamic", blocking: true });
    expect(r("route:/client").mode).toBe("static"); // client code runs in the browser
  });
});

describe("merging files that declare one exported thing (default on)", () => {
  test("the declaration takes the file's id, role and boundary; links follow it", async () => {
    const s = await scan(fixture("next-app"), { cache: false, types: false });
    expect(s.options?.mergeSingleExport).toBe(true);
    // app/page.tsx declares only HomePage: one node, the file's id
    const page = s.nodes["app/page.tsx"]!;
    expect(page).toMatchObject({ kind: "component", name: "HomePage", file: true, fileName: "page.tsx", nextRole: "page", moduleType: "server", isAsync: true });
    expect(page.moduleId).toBeUndefined();
    expect(s.nodes["app/page.tsx#HomePage"]).toBeUndefined();
    // the route's page is the merged node; its imports and renders start from it
    expect(s.nodes["route:/"]!.route!.files.page).toBe("app/page.tsx");
    expect(edge(s, "imports", "app/page.tsx", "components/TodoList.tsx")).toBeDefined();
    expect(edge(s, "renders", "app/page.tsx", "components/TodoList.tsx")?.conditions?.some((c) => c.kind === "suspense")).toBe(true);
    expect(s.edges.some((e) => e.kind === "declares" && e.from === "app/page.tsx")).toBe(false);
    // render trees point at merged ids
    const json = JSON.stringify(page.renderTree);
    expect(json).toContain('"targetId":"components/TodoList.tsx"');
    expect(json).not.toContain("components/TodoList.tsx#TodoList");
    // no edge points at a removed id
    for (const e of s.edges) {
      expect(s.nodes[e.from]).toBeDefined();
      expect(s.nodes[e.to]).toBeDefined();
    }
    // several declarations (or a private one next to it) keep the file
    expect(s.nodes["lib/data.ts"]!.kind).toBe("module");
    expect(s.nodes["components/Header.tsx"]!.kind).toBe("module"); // HeaderProps + Header
    expect(s.nodes["lib/format.ts"]).toMatchObject({ kind: "function", name: "formatTitle", file: true });
  });

  test("off: files and declarations as scanned", async () => {
    const s = await scan(fixture("next-app"), { cache: false, types: false, mergeSingleExport: false });
    expect(s.nodes["app/page.tsx"]!.kind).toBe("module");
    expect(s.nodes["app/page.tsx#HomePage"]!.moduleId).toBe("app/page.tsx");
  });
});

describe("type text", () => {
  test("long types are printed whole (no `... N more ...`)", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const root = mkdtempSync(join(tmpdir(), "rae-types-"));
    const project = (files: Record<string, string>) => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      return root;
    };
    project({
      "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx", "strict": true } }`,
      "src/main.tsx": [
        `type Diff = { base?: string; head?: string; request?: string; requestInfo?: { title?: string; author?: string; url?: string }; worktree?: boolean; against?: "base" | "merge-base" };`,
        `export function Options({ onChange }: { onChange: (diff: Diff | undefined) => void }) { onChange(undefined); return <div />; }`,
        `export const pick = (k: "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "zeta" | "eta" | "theta" | "iota" | "kappa" | "lambda" | "mu" | "nu" | "xi" | "omicron" | "pi" | "rho" | "sigma") => k;`,
      ].join("\n"),
    });
    const s = await scan(join(root, "src/main.tsx"), { cache: false, types: true, mergeSingleExport: false });
    const prop = s.nodes["src/main.tsx#Options"]!.props!.find((p) => p.name === "onChange")!;
    expect(prop.type).not.toContain("more");
    const ret = s.nodes["src/main.tsx#pick"]!.signature!.returnType!;
    expect(ret).toContain('"sigma"');
    expect(ret).not.toContain("more");
  }, 60_000);
});
