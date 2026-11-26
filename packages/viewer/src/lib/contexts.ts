import type { GraphNode, HookUsage, JsxNode, NodeId, Snapshot } from "@rae/schema";

/** A React context a declaration reads: its name, and the project's hook it reads it through (if not directly). */
export interface ContextRead {
  name: string;
  via?: NodeId;
}

const IDENT = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** The context a hook call reads: `useContext(X)`, or React 19's `use(XContext)` (a `use(promise)` isn't one). */
export function contextOfCall(h: HookUsage): string | undefined {
  const arg = h.args[0]?.trim();
  if (!arg || !IDENT.test(arg)) return undefined;
  if (/(^|\.)useContext$/.test(h.hook)) return arg;
  if (/(^|\.)use$/.test(h.hook) && /Context$/.test(arg)) return arg;
  return undefined;
}

/**
 * The contexts a declaration reads, directly or through the project's hooks it calls (followed
 * all the way down: `useCurrency` → `useCurrencyContext` → `useContext(CurrencyContext)`). Each
 * once; a direct read wins over one through a hook, a nearer hook over a deeper one.
 */
export function contextsRead(snapshot: Snapshot, node: GraphNode): ContextRead[] {
  const found = new Map<string, ContextRead>();
  const seen = new Set<NodeId>([node.id]);
  // breadth first: each level's hooks before the next, so the nearest hook names the "via"
  let level: { n: GraphNode; via?: NodeId }[] = [{ n: node }];
  while (level.length) {
    const next: typeof level = [];
    for (const { n, via } of level) {
      for (const h of n.hooksUsed ?? []) {
        const name = contextOfCall(h);
        if (name && !found.has(name)) found.set(name, { name, via });
        const target = h.targetId ? snapshot.nodes[h.targetId] : undefined;
        if (target?.kind === "hook" && !seen.has(target.id)) {
          seen.add(target.id);
          next.push({ n: target, via: via ?? target.id });
        }
      }
    }
    level = next;
  }
  return [...found.values()];
}

/** The contexts a component provides: `<X.Provider>`, or React 19's `<XContext value={…}>`. */
export function contextsProvided(node: GraphNode): string[] {
  const out = new Set<string>();
  const walk = (els: readonly JsxNode[]) => {
    for (const el of els) {
      if (!el.native) {
        if (el.tag.endsWith(".Provider")) out.add(el.tag.slice(0, -".Provider".length));
        else if (/Context$/.test(el.tag) && el.props.some((p) => p.name === "value")) out.add(el.tag);
      }
      walk(el.children);
    }
  };
  walk(node.renderTree ?? []);
  return [...out];
}

/** Who provides and who reads a context (by its name), across the project. */
export interface ContextUse {
  providers: NodeId[];
  readers: NodeId[];
}

const usesCache = new WeakMap<Snapshot, Map<string, ContextUse>>();

/**
 * Every context's providers and readers (directly or through hooks), once per snapshot. Contexts
 * are told apart by name, as written: two `ThemeContext`s in different files count as one.
 */
export function contextUses(snapshot: Snapshot): Map<string, ContextUse> {
  const cached = usesCache.get(snapshot);
  if (cached) return cached;
  const uses = new Map<string, ContextUse>();
  const of = (name: string) => uses.get(name) ?? (uses.set(name, { providers: [], readers: [] }), uses.get(name)!);
  for (const n of Object.values(snapshot.nodes)) {
    if (n.kind === "component") for (const name of contextsProvided(n)) of(name).providers.push(n.id);
    if (n.hooksUsed?.length) for (const r of contextsRead(snapshot, n)) of(r.name).readers.push(n.id);
  }
  usesCache.set(snapshot, uses);
  return uses;
}
