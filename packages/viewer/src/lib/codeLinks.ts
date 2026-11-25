import type { GraphNode, NodeId, Snapshot } from "@rae/schema";
import type { GraphIndex } from "../graph/relations.ts";
import { isWholeFile } from "./nodeDiff.ts";

/** Relations whose target a name in the code refers to. */
const REFERS = new Set(["imports", "renders", "invokes", "usesHook", "invokesAction", "usesType"]);
const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * The names in a node's code that refer to other elements, and which: what it renders, calls, uses
 * as a hook, server action or type, and imports (under the local name, `X as Y` → Y); never a
 * 3rd-party library's (their code isn't the project's). For a whole
 * file, its own declarations and theirs too. An import of a file points at the declaration it
 * exports under that name, else at the file. The node's own name isn't a link.
 *
 * `wholeFile`: a declaration shown with the rest of its file — the file's names are links.
 */
export function codeLinks(s: Snapshot, index: GraphIndex, node: GraphNode, wholeFile = false): Map<string, NodeId> {
  const links = new Map<string, NodeId>();
  const fileNode = wholeFile && !isWholeFile(node) && node.moduleId ? s.nodes[node.moduleId] : undefined;
  const add = (name: string | undefined, id: NodeId) => {
    // 3rd-party code isn't the project's: library names stay plain
    if (!name || !IDENT.test(name) || id === node.id || id === fileNode?.id || links.has(name) || s.nodes[id]?.kind === "external") return;
    links.set(name, id);
  };
  const declsOf = (file: NodeId) => (index.out.get(file) ?? []).filter((e) => e.kind === "declares").map((e) => s.nodes[e.to]).filter((d): d is GraphNode => !!d);
  /** In a file, the declaration exported as `name`. */
  const exported = (file: NodeId, name: string) => declsOf(file).find((d) => d.exportNames?.includes(name) || (name !== "default" && d.name === name));

  const shown = fileNode ?? node;
  const owners = [shown];
  if (isWholeFile(shown)) for (const d of declsOf(shown.id)) owners.push(d);
  for (const owner of owners) {
    if (owner !== shown) add(owner.name, owner.id);
    for (const [name, id] of Object.entries(owner.typeRefs ?? {})) if (s.nodes[id]) add(name, id);
    for (const e of index.out.get(owner.id) ?? []) {
      const target = s.nodes[e.to];
      if (!target || !REFERS.has(e.kind)) continue;
      if (e.kind === "imports" && e.specifiers) {
        for (const spec of e.specifiers) {
          const [imported, local = imported] = spec.split(" as ").map((p) => p.trim()) as [string, string?];
          if (imported === "*") add(local, target.id);
          else add(local, target.kind === "module" ? (exported(target.id, imported)?.id ?? target.id) : target.id);
        }
        continue;
      }
      if (target.kind !== "external") add(target.name, target.id);
    }
  }
  return links;
}
