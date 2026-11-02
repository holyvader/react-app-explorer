import { basename, dirname, join, relative } from "node:path";
import type { Condition, Edge, EdgeKind, GraphNode, HookUsage, ImportType, JsxNode, ModuleType, NodeId, RouteInfo, SegmentKind } from "@rae/schema";
import type { FileExtract, RawJsxNode, Resolved } from "./extract/types.ts";
import { nextRoleOf, type ProjectInfo } from "./project.ts";

/**
 * Turns per-file extracts into the snapshot graph: module/decl/external nodes, and
 * imports/declares/renders/usesHook/invokes/invokesAction edges. Symbols are linked
 * syntactically: local binding → import → resolved file → export (following re-exports).
 */
export function buildGraph(files: Map<string, FileExtract>, info: ProjectInfo) {
  const nodes: Record<NodeId, GraphNode> = {};
  const edges: Edge[] = [];
  const edgeIndex = new Map<string, Edge>();
  const relCache = new Map<string, string>();
  const rel = (p: string) => {
    let r = relCache.get(p);
    if (r === undefined) {
      r = p.startsWith(info.rootDir + "/") ? p.slice(info.rootDir.length + 1) : relative(info.rootDir, p) || basename(p);
      relCache.set(p, r);
    }
    return r;
  };
  const moduleId = (p: string) => rel(p);
  const declId = (p: string, local: string) => `${rel(p)}#${local}`;

  // ---- nodes ---------------------------------------------------------------------------------
  for (const f of files.values()) {
    const id = moduleId(f.absPath);
    nodes[id] = {
      id,
      kind: "module",
      name: basename(f.absPath),
      filePath: rel(f.absPath),
      absPath: f.absPath,
      loc: { line: 1, col: 1 },
      nextRole: nextRoleOf(f.absPath, info),
      directives: f.directives.length ? f.directives : undefined,
    };
    const exportNamesByLocal = new Map<string, string[]>();
    for (const e of f.exports) {
      if (!e.local) continue;
      let local = e.local;
      for (let i = 0; i < 5 && f.aliases[local]; i++) local = f.aliases[local]!;
      const list = exportNamesByLocal.get(local) ?? [];
      list.push(e.exported);
      exportNamesByLocal.set(local, list);
    }
    const fileBase = basename(f.absPath).replace(/\.[^.]+$/, "");
    for (const d of f.decls) {
      const did = declId(f.absPath, d.local);
      const exportNames = exportNamesByLocal.get(d.local);
      nodes[did] = {
        id: did,
        kind: d.kind,
        name: d.local === "default" ? `${fileBase} (default)` : d.local,
        filePath: rel(f.absPath),
        absPath: f.absPath,
        loc: d.loc,
        moduleId: id,
        exported: !!exportNames,
        exportNames,
        isAsync: d.isAsync || undefined,
        directives: d.directives.length ? d.directives : undefined,
        nextRole: exportNames?.includes("default") ? nodes[id]!.nextRole : undefined,
        props: d.props,
        signature: d.kind === "type" ? undefined : { params: d.params, returnType: d.returnType },
        typeText: d.typeText,
        typeKind: d.typeKind,
        typeParams: d.typeParams,
        extends: d.extends,
        functions: d.functions.length ? d.functions.map(({ pos: _pos, ...fn }) => fn) : undefined,
      };
    }
  }

  /**
   * The node an import points at. Only packages (node_modules, Node built-ins) are external; the
   * project's own non-source files (assets) and files that don't exist (missing) are file nodes in
   * the project tree, flagged so the viewer can say what they are.
   */
  const external = (r: Resolved): NodeId => {
    if (r.kind === "local") return moduleId(r.path);
    if (r.kind === "asset" || r.kind === "missing") {
      const id = moduleId(r.path);
      nodes[id] ??= {
        id,
        kind: "module",
        name: basename(r.path),
        filePath: rel(r.path),
        absPath: r.kind === "asset" ? r.path : undefined,
        ...(r.kind === "asset" ? { asset: true } : { missing: true, specifier: r.specifier }),
      };
      return id;
    }
    const id = `ext:${r.specifier}`;
    nodes[id] ??= { id, kind: "external", name: r.specifier, filePath: r.specifier };
    return id;
  };

  // ---- symbol resolution --------------------------------------------------------------------
  const exportMemo = new Map<string, NodeId | undefined>();

  /** Resolve export `name` of file `path` to a node id. */
  function resolveExport(path: string, name: string, depth = 0): NodeId | undefined {
    const key = `${path}\0${name}`;
    if (exportMemo.has(key)) return exportMemo.get(key);
    exportMemo.set(key, undefined); // cycle guard
    const f = files.get(path);
    let result: NodeId | undefined;
    if (!f) result = undefined;
    else if (name === "*") result = moduleId(path);
    else if (depth < 20) {
      const direct = indexOf(f).exports.get(name);
      if (direct?.local) result = resolveLocal(f, direct.local, depth + 1)?.id;
      else if (direct && direct.from !== undefined) {
        const imp = f.imports[direct.from]!;
        result = imp.resolved ? resolveTarget(imp.resolved, direct.imported ?? name, depth + 1) : undefined;
      } else if (name !== "default") {
        for (const e of f.exports) {
          if (e.exported !== "*" || e.from === undefined) continue;
          const r = f.imports[e.from]!.resolved;
          if (r?.kind === "local") result = resolveExport(r.path, name, depth + 1);
          if (result) break;
        }
      }
      result ??= moduleId(path);
    }
    exportMemo.set(key, result);
    return result;
  }

  function resolveTarget(r: Resolved, imported: string, depth: number): NodeId | undefined {
    if (r.kind === "local") return resolveExport(r.path, imported, depth);
    return external(r);
  }

  interface LocalTarget {
    id: NodeId;
    /** For namespace imports: the file, so members can be resolved. */
    nsPath?: string;
    importedName?: string;
  }

  interface FileIndex {
    decls: Set<string>;
    imports: Map<string, { resolved: Resolved; imported: string }>;
    exports: Map<string, FileExtract["exports"][number]>;
  }
  const indexes = new Map<string, FileIndex>();
  const indexOf = (f: FileExtract): FileIndex => {
    let ix = indexes.get(f.absPath);
    if (!ix) {
      ix = { decls: new Set(f.decls.map((d) => d.local)), imports: new Map(), exports: new Map() };
      for (const imp of f.imports) {
        if (imp.type === "type-only" || !imp.resolved) continue;
        for (const n of imp.names) if (!ix.imports.has(n.local)) ix.imports.set(n.local, { resolved: imp.resolved, imported: n.imported });
      }
      for (const e of f.exports) if (!ix.exports.has(e.exported)) ix.exports.set(e.exported, e);
      indexes.set(f.absPath, ix);
    }
    return ix;
  };

  function resolveLocal(f: FileExtract, local: string, depth = 0): LocalTarget | undefined {
    for (let i = 0; i < 5 && f.aliases[local]; i++) local = f.aliases[local]!;
    const ix = indexOf(f);
    if (ix.decls.has(local)) return { id: declId(f.absPath, local) };
    const imp = ix.imports.get(local);
    if (!imp) return undefined;
    if (imp.imported === "*" && imp.resolved.kind === "local") return { id: moduleId(imp.resolved.path), nsPath: imp.resolved.path };
    const id = resolveTarget(imp.resolved, imp.imported, depth);
    return id ? { id, importedName: imp.imported } : undefined;
  }

  function resolveRef(f: FileExtract, local: string, member?: string): LocalTarget | undefined {
    const t = resolveLocal(f, local);
    if (t?.nsPath && member) {
      const id = resolveExport(t.nsPath, member);
      return id ? { id, importedName: member } : t;
    }
    if (t && member && nodes[t.id]?.kind === "external") return { ...t, importedName: `${local}.${member}` };
    return t;
  }

  const addEdge = (e: Edge, mergeKey = `${e.kind}\0${e.from}\0${e.to}\0${e.importType ?? ""}`) => {
    if (e.from === e.to) return;
    const existing = edgeIndex.get(mergeKey);
    if (!existing) {
      edgeIndex.set(mergeKey, e);
      edges.push(e);
      return;
    }
    if (e.specifiers) existing.specifiers = [...new Set([...(existing.specifiers ?? []), ...e.specifiers])];
    if (e.kind === "renders") {
      existing.variants ??= [existing.conditions ?? []];
      existing.variants.push(e.conditions ?? []);
    }
  };

  // ---- edges ---------------------------------------------------------------------------------
  for (const f of files.values()) {
    const mid = moduleId(f.absPath);
    for (const imp of f.imports) {
      if (!imp.resolved) continue;
      const to = external(imp.resolved);
      addEdge({
        from: mid,
        to,
        kind: "imports",
        importType: imp.type as ImportType,
        specifiers: imp.names.length
          ? imp.names.map((n) => (n.imported === n.local ? n.imported : n.imported === "*" ? `* as ${n.local}` : `${n.imported} as ${n.local}`))
          : undefined,
      });
    }
    // Module-level code invoking declarations (e.g. `export default withAuth(Page)`, `const store = createStore()`).
    for (const c of f.moduleCalls ?? []) {
      const t = resolveRef(f, c.local, c.member);
      const target = t && nodes[t.id];
      if (!target || target.kind === "module" || target.kind === "external" || target.kind === "component") continue;
      addEdge({ from: mid, to: target.id, kind: target.kind === "serverAction" ? "invokesAction" : "invokes" });
    }
    for (const r of f.moduleRenders ?? []) {
      const t = resolveRef(f, r.local, r.member);
      if (t) addEdge({ from: mid, to: t.id, kind: "renders", conditions: r.conditions?.length ? r.conditions : undefined });
    }
    if (f.moduleTree) nodes[mid]!.renderTree = f.moduleTree.map((n) => linkJsx(f, n));

    for (const d of f.decls) {
      const did = declId(f.absPath, d.local);
      const node = nodes[did]!;
      addEdge({ from: mid, to: did, kind: "declares" });
      // type references: link the names to their declarations (through imports), as usesType relations
      if (d.typeRefs?.length) {
        const refs: Record<string, NodeId> = {};
        for (const name of d.typeRefs) {
          const t = resolveLocal(f, name);
          if (!t || !nodes[t.id]) continue;
          refs[name] = t.id;
          if (nodes[t.id]!.kind === "type") addEdge({ from: did, to: t.id, kind: "usesType" });
        }
        if (Object.keys(refs).length) node.typeRefs = refs;
      }

      // hooks
      const hooksUsed: HookUsage[] = [];
      for (const h of d.hooks) {
        const t = resolveRef(f, h.local, h.member);
        hooksUsed.push({
          hook: h.hook,
          targetId: t?.id,
          args: h.args,
          assignedTo: h.assignedTo,
          returnType: h.returnType,
          loc: h.loc,
        });
        if (t) addEdge({ from: did, to: t.id, kind: "usesHook", specifiers: [h.member ?? t.importedName ?? h.local] });
      }
      if (hooksUsed.length) node.hooksUsed = hooksUsed;

      // invokes (only scanned decls; calls into libraries are visible via module imports)
      for (const c of d.calls) {
        const t = resolveRef(f, c.local, c.member);
        const target = t && nodes[t.id];
        if (!target || target.kind === "module" || target.kind === "external" || target.kind === "component") continue;
        const kind: EdgeKind = target.kind === "serverAction" ? "invokesAction" : "invokes";
        addEdge({ from: did, to: target.id, kind });
      }

      // renders
      for (const r of d.renders) {
        const t = resolveRef(f, r.local, r.member);
        if (!t) continue;
        const conditions = r.conditions?.length ? r.conditions : undefined;
        addEdge({
          from: did,
          to: t.id,
          kind: "renders",
          conditions,
          specifiers: nodes[t.id]?.kind === "external" ? [t.importedName ?? r.local] : undefined,
        });
      }

      if (d.renderTree.length) node.renderTree = d.renderTree.map((n) => linkJsx(f, n));
    }
  }

  function linkJsx(f: FileExtract, n: RawJsxNode): JsxNode {
    const targetId = n.ref ? resolveRef(f, n.ref.local, n.ref.member)?.id : undefined;
    return {
      tag: n.tag,
      native: n.native,
      targetId,
      props: n.props,
      conditions: n.conditions,
      loc: n.loc,
      children: n.children.map((c) => linkJsx(f, c)),
    };
  }

  propagateModuleTypes(files, info, nodes, moduleId);
  if (info.appDir) addRoutes(info.appDir);
  return { nodes, edges };

  /**
   * The App Router as nodes: one route per app/ directory holding special files (page, layout,
   * loading, error, not-found, template, default, route), nested by directory. Then every
   * declaration's navigations are matched to routes: navigates / fetches / revalidates edges.
   */
  function addRoutes(appDir: string) {
    const HTTP = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
    const byDir = new Map<string, { files: Record<string, NodeId>; methods: string[] }>();
    for (const f of files.values()) {
      if (!f.absPath.startsWith(appDir + "/")) continue;
      const role = nextRoleOf(f.absPath, info);
      if (!role) continue;
      const dir = dirname(f.absPath).slice(appDir.length).replace(/^\//, "");
      const entry = byDir.get(dir) ?? { files: {}, methods: [] };
      const base = basename(f.absPath).replace(/\.[^.]+$/, "");
      entry.files[base === "global-error" ? "global-error" : role] = moduleId(f.absPath);
      if (role === "route") entry.methods.push(...f.exports.map((e) => e.exported).filter((n) => HTTP.has(n)));
      byDir.set(dir, entry);
    }
    if (!byDir.size) return;

    const segmentKind = (seg: string): SegmentKind =>
      seg === ""
        ? "root"
        : seg.startsWith("@")
          ? "slot"
          : /^\((\.{1,3}|\.\.\)\(\.\.)\)/.test(seg)
            ? "intercept"
            : seg.startsWith("(") && seg.endsWith(")")
              ? "group"
              : seg.startsWith("[[...")
                ? "optionalCatchAll"
                : seg.startsWith("[...")
                  ? "catchAll"
                  : seg.startsWith("[")
                    ? "dynamic"
                    : "static";
    const routeId = (dir: string) => `route:/${dir}`;
    const urlSegments = (dir: string) =>
      dir
        .split("/")
        .filter(Boolean)
        .filter((seg) => !["group", "slot"].includes(segmentKind(seg)))
        .map((seg) => (segmentKind(seg) === "intercept" ? seg.replace(/^(\((\.{1,3})\))+/, "") : seg));

    const routes: { id: NodeId; segs: string[]; kind: RouteInfo["kind"] }[] = [];
    for (const [dir, entry] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
      const segs = urlSegments(dir);
      const url = "/" + segs.join("/");
      const last = dir.split("/").pop() ?? "";
      // intercepting: a "(.)" / "(..)" / "(...)" segment on the way (it may sit on a parent folder)
      const interceptAt = dir.split("/").filter((seg) => !["group", "slot"].includes(segmentKind(seg))).findIndex((seg) => segmentKind(seg) === "intercept");
      const kindOfSeg = interceptAt >= 0 ? "intercept" : segmentKind(dir === "" ? "" : last);
      // named as Next prints it: the URL with the interception marker kept (`/(.)photos/[id]`)
      const display = interceptAt >= 0 ? "/" + dir.split("/").filter((seg) => !["group", "slot"].includes(segmentKind(seg))).join("/") : url;
      const kind: RouteInfo["kind"] = entry.files.page ? "page" : entry.files.route ? "api" : "segment";
      // parent: the nearest enclosing directory that is a route too
      let parent: NodeId | undefined;
      for (let up = dir; up !== ""; ) {
        up = up.includes("/") ? up.slice(0, up.lastIndexOf("/")) : "";
        if (byDir.has(up)) {
          parent = routeId(up);
          break;
        }
      }
      const id = routeId(dir);
      nodes[id] = {
        id,
        kind: "route",
        // groups and slots share their parent's URL: name them by their segment too
        name: kindOfSeg === "group" || kindOfSeg === "slot" ? `${url} ${last}` : display,
        filePath: rel(join(appDir, dir)) || ".",
        absPath: join(appDir, dir),
        route: {
          url,
          segment: last,
          segmentKind: kindOfSeg,
          params: segs.filter((s) => s.startsWith("[")).map((s) => s.replace(/^\[+(\.\.\.)?|\]+$/g, "")),
          kind,
          files: entry.files,
          methods: entry.methods.length ? [...new Set(entry.methods)] : undefined,
          parent,
        },
      };
      if (parent) addEdge({ from: parent, to: id, kind: "routeChild" });
      for (const mid of Object.values(entry.files)) if (mid) addEdge({ from: id, to: mid, kind: "routeFile" });
      // links go to the real route (Next does the intercepting), so intercepting routes aren't targets
      if (kind !== "segment" && kindOfSeg !== "intercept") routes.push({ id, segs, kind });
    }

    // most specific first: more static segments, then fewer catch-alls
    const score = (segs: string[]) => segs.reduce((n, s) => n + (s.startsWith("[[") ? 0 : s.startsWith("[...") ? 1 : s.startsWith("[") ? 2 : 4), 0);
    routes.sort((a, b) => score(b.segs) - score(a.segs) || b.segs.length - a.segs.length);
    const matches = (segs: string[], path: string[]) => {
      let i = 0;
      for (const seg of segs) {
        if (seg.startsWith("[[...")) return true;
        if (seg.startsWith("[...")) return i < path.length;
        if (i >= path.length) return false;
        // a static segment needs that exact text; a template part ("[…]") only fills dynamic segments
        if (!seg.startsWith("[") && seg !== path[i]) return false;
        i++;
      }
      return i === path.length;
    };
    const match = (href: string, api: boolean) => {
      const path = href.split("/").filter(Boolean).map((p) => (p.includes("[…]") ? "[…]" : decodeURIComponent(p)));
      return routes.find((r) => (api ? r.kind === "api" : r.kind === "page") && matches(r.segs, path))?.id;
    };

    for (const f of files.values()) {
      for (const d of f.decls) {
        if (!d.navigations?.length) continue;
        const did = declId(f.absPath, d.local);
        const node = nodes[did];
        if (!node) continue;
        node.navigations = d.navigations.map((n) => {
          // fetch targets API routes; links, router calls, redirects and revalidatePath pages, falling back to APIs (<Link href="/rss.xml">)
          const route = n.via === "fetch" ? match(n.href, true) : (match(n.href, false) ?? match(n.href, true));
          if (route) {
            const kind = n.via === "fetch" ? "fetches" : n.via === "revalidate" ? "revalidates" : "navigates";
            addEdge({ from: did, to: route, kind, href: n.href, via: n.via }, `${kind}\0${did}\0${route}\0${n.via}`);
          }
          return route ? { ...n, route } : n;
        });
      }
    }
  }
}

/**
 * Server/client boundaries.
 * - next-app: app router files are server by default; `'use client'` files and everything they
 *   (value-)import are client; files reached from both sides are shared.
 * - next-pages / react: client, except pages/api, middleware and `server-only`.
 */
function propagateModuleTypes(
  files: Map<string, FileExtract>,
  info: ProjectInfo,
  nodes: Record<NodeId, GraphNode>,
  moduleId: (p: string) => string,
) {
  const server = new Set<string>();
  const client = new Set<string>();
  const valueImports = (f: FileExtract) =>
    f.imports.filter((i) => i.type !== "type-only" && i.resolved?.kind === "local").map((i) => (i.resolved as { path: string }).path);

  const bfs = (starts: string[], set: Set<string>, stop: (f: FileExtract) => boolean) => {
    const queue = [...starts];
    while (queue.length) {
      const p = queue.pop()!;
      if (set.has(p)) continue;
      const f = files.get(p);
      if (!f) continue;
      set.add(p);
      for (const next of valueImports(f)) {
        const nf = files.get(next);
        if (nf && !stop(nf)) queue.push(next);
      }
    }
  };

  const isClient = (f: FileExtract) => f.directives.includes("use client");
  const isServerFile = (f: FileExtract) => f.directives.includes("use server") || f.serverOnly;

  if (info.framework === "next-app") {
    const serverRoots: string[] = [];
    const clientRoots: string[] = [];
    for (const f of files.values()) {
      const role = nextRoleOf(f.absPath, info);
      if (isClient(f)) clientRoots.push(f.absPath);
      else if (role || isServerFile(f)) serverRoots.push(f.absPath);
    }
    // Server traversal stops at client boundaries (the client file itself is still "used by" server).
    bfs(serverRoots, server, isClient);
    // Client traversal stops at 'use server' files (client only holds references to actions).
    bfs(clientRoots, client, (f) => f.directives.includes("use server"));
    // Pages router inside an app-router project.
    if (info.pagesDir) {
      for (const f of files.values()) {
        const role = nextRoleOf(f.absPath, info);
        if (role === "api") bfs([f.absPath], server, isClient);
        else if (role && f.absPath.startsWith(info.pagesDir + "/")) bfs([f.absPath], client, (x) => x.directives.includes("use server"));
      }
    }
  } else {
    for (const f of files.values()) {
      const role = nextRoleOf(f.absPath, info);
      if (role === "api" || role === "middleware" || isServerFile(f)) bfs([f.absPath], server, isClient);
    }
    for (const f of files.values()) if (!server.has(f.absPath) || isClient(f)) client.add(f.absPath);
  }

  for (const f of files.values()) {
    let t: ModuleType | undefined;
    if (isClient(f)) t = "client";
    else if (f.directives.includes("use server") || f.serverOnly) t = "server";
    else if (server.has(f.absPath) && client.has(f.absPath)) t = "shared";
    else if (server.has(f.absPath)) t = "server";
    else if (client.has(f.absPath)) t = "client";
    const mid = moduleId(f.absPath);
    if (!t) continue;
    nodes[mid]!.moduleType = t;
    for (const d of f.decls) {
      const n = nodes[`${mid}#${d.local}`];
      if (n) n.moduleType = t;
    }
  }
}

export type { Condition };
