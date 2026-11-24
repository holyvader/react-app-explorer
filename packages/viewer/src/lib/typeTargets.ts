import type { GraphNode, Snapshot } from "@rae/schema";

/** Type declarations by name, per snapshot: the fallback for names the owner didn't record (inferred types). */
const byName = new WeakMap<Snapshot, Map<string, string[]>>();
export function typesNamed(s: Snapshot, name: string): string[] {
  let m = byName.get(s);
  if (!m) {
    m = new Map();
    for (const n of Object.values(s.nodes)) if (n.kind === "type") (m.get(n.name) ?? m.set(n.name, []).get(n.name)!).push(n.id);
    byName.set(s, m);
  }
  return m.get(name) ?? [];
}

/** The node a name in `owner`'s type text stands for: its recorded reference, else a unique type of that name. */
export function targetOf(s: Snapshot, owner: GraphNode | undefined, name: string): GraphNode | undefined {
  const id = owner?.typeRefs?.[name];
  if (id) return s.nodes[id];
  const named = typesNamed(s, name);
  return named.length === 1 ? s.nodes[named[0]!] : undefined;
}
