import type { GraphNode } from "@rae/schema";

/**
 * Where an element runs (server / client / shared), as cards, the tooltip and details show it.
 * Types have none: they're erased at build time, so "client" on an interface says nothing.
 */
export const boundaryOf = (n: Pick<GraphNode, "kind" | "moduleType">) => (n.kind === "type" ? undefined : n.moduleType);
