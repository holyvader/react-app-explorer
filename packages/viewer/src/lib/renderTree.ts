import type { JsxNode } from "@rae/schema";

/** Elements in a render tree (each element and everything under it). */
export function countElements(nodes: readonly JsxNode[]): number {
  return nodes.reduce((n, el) => n + 1 + countElements(el.children), 0);
}
