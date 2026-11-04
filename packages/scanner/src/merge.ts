import type { Edge, GraphNode, JsxNode, NodeId } from "@rae/schema";

/**
 * Files that declare exactly one thing, and export it, collapse into that declaration: the module node
 * goes away and the declaration takes its id (so imports, route files and middleware links keep
 * pointing at it). It keeps the file's facts (Next.js role, server/client, directives, cache…) and is
 * marked `file: true`. `app/blog/[...slug]/page.tsx` → just `BlogPost` (page, server).
 *
 * Assets, missing files and files with several (or private) declarations stay as they are.
 */
export function mergeSingleExportModules(nodes: Record<NodeId, GraphNode>, edges: Edge[]): { nodes: Record<NodeId, GraphNode>; edges: Edge[] } {
  const declsOf = new Map<NodeId, GraphNode[]>();
  for (const n of Object.values(nodes)) {
    if (n.kind === "module" || n.kind === "external" || n.kind === "route" || !n.moduleId) continue;
    const list = declsOf.get(n.moduleId);
    if (list) list.push(n);
    else declsOf.set(n.moduleId, [n]);
  }

  // declaration id → its file's id
  const renamed = new Map<NodeId, NodeId>();
  const out: Record<NodeId, GraphNode> = { ...nodes };
  for (const [moduleId, decls] of declsOf) {
    const m = nodes[moduleId];
    const d = decls[0]!;
    if (decls.length !== 1 || !d.exported || !m || m.kind !== "module" || m.asset || m.missing) continue;
    renamed.set(d.id, moduleId);
    delete out[d.id];
    out[moduleId] = {
      ...d,
      id: moduleId,
      moduleId: undefined,
      file: true,
      fileName: m.name,
      nextRole: d.nextRole ?? m.nextRole,
      moduleType: m.moduleType ?? d.moduleType,
      directives: union(m.directives, d.directives),
      dynamicApis: union(m.dynamicApis, d.dynamicApis),
      navigations: m.navigations || d.navigations ? [...(m.navigations ?? []), ...(d.navigations ?? [])] : undefined,
      invalidates: m.invalidates || d.invalidates ? [...(m.invalidates ?? []), ...(d.invalidates ?? [])] : undefined,
      hash: m.hash ?? d.hash, // the whole file: imports and module-level code count as changes too
      cache: d.cache ?? m.cache,
      middleware: m.middleware ?? d.middleware,
    };
  }
  if (!renamed.size) return { nodes, edges };

  const to = (id: NodeId) => renamed.get(id) ?? id;
  // ids inside node data: type references, render trees, hooks
  const fixJsx = (list: JsxNode[] | undefined): JsxNode[] | undefined =>
    list?.map((j) => ({ ...j, targetId: j.targetId && to(j.targetId), children: fixJsx(j.children)! }));
  for (const [id, n] of Object.entries(out)) {
    const refs = n.typeRefs && Object.values(n.typeRefs).some((v) => renamed.has(v));
    const jsx = n.renderTree?.length;
    const hooks = n.hooksUsed?.some((h) => h.targetId && renamed.has(h.targetId));
    if (!refs && !jsx && !hooks) continue;
    out[id] = {
      ...n,
      typeRefs: refs ? Object.fromEntries(Object.entries(n.typeRefs!).map(([k, v]) => [k, to(v)])) : n.typeRefs,
      renderTree: jsx ? fixJsx(n.renderTree) : n.renderTree,
      hooksUsed: hooks ? n.hooksUsed!.map((h) => ({ ...h, targetId: h.targetId && to(h.targetId) })) : n.hooksUsed,
    };
  }

  // edges: renamed ends; the file → declaration `declares` edge and self-loops go; duplicates once
  const seen = new Set<string>();
  const merged: Edge[] = [];
  for (const e of edges) {
    const from = to(e.from);
    const target = to(e.to);
    if (from === target && e.from !== e.to) continue; // the file's own links to its declaration
    const edge = from === e.from && target === e.to ? e : { ...e, from, to: target };
    const key = JSON.stringify(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(edge);
  }
  return { nodes: out, edges: merged };
}

const union = (a?: string[], b?: string[]) => (a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined);
