import type { GraphNode } from "@rae/schema";

/**
 * A component's props, counted: its own (written in the project) and the ones it inherits from a
 * library type (`ButtonProps extends ButtonHTMLAttributes<…>`: 2 own + 39). Props without any
 * written annotation (plain JS) all count as its own.
 */
export function propsCount(n: GraphNode): { own: string[]; inherited: string[] } | undefined {
  if (n.kind !== "component" || !n.props?.length) return undefined;
  const written = n.props.some((p) => p.written);
  const name = (p: { name: string; optional: boolean }) => p.name + (p.optional ? "?" : "");
  return {
    own: n.props.filter((p) => !written || p.written).map(name),
    inherited: n.props.filter((p) => written && !p.written).map(name),
  };
}

/** The chip on a component's card: "2 props", "1 prop", "2 + 39 props". */
export function propsChipLabel(c: { own: string[]; inherited: string[] }): string {
  const total = c.own.length + c.inherited.length;
  return `${c.inherited.length ? `${c.own.length} + ${c.inherited.length}` : c.own.length} ${total === 1 ? "prop" : "props"}`;
}
