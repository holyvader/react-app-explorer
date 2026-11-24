import type { GraphNode, ParamDef, Snapshot } from "@rae/schema";
import type { GraphIndex } from "./relations.ts";

/**
 * The type a component's props are declared with, when it's a named one (`ButtonProps`,
 * `Props<T>`, `BaseProps & { … }`), not an object written inline (`{ children: ReactNode }`).
 */
export function namedPropsType(params: ParamDef[] | undefined): string | undefined {
  if (params?.length !== 1) return undefined;
  const text = (params[0]!.written ?? params[0]!.type)?.trim();
  return text && !text.startsWith("{") ? text : undefined;
}

/** The project declaration a named props type stands for: one name (`ButtonProps`, `Props<T>`) the owner resolved to a type. */
export function propsTypeDeclaration(s: Snapshot, owner: GraphNode): GraphNode | undefined {
  const name = namedPropsType(owner.signature?.params)?.match(/^([A-Za-z_$][\w$]*)(<.*>)?$/s)?.[1];
  const id = name ? owner.typeRefs?.[name] : undefined;
  const target = id ? s.nodes[id] : undefined;
  return target?.kind === "type" ? target : undefined;
}

/** Whether an import's specifiers (`Name`, `Name as local`, `* as ns`, `default`) bring in `name`. */
const importsName = (specifiers: string[] | undefined, name: string) =>
  !specifiers || specifiers.some((sp) => sp.startsWith("* as ") || sp.split(" as ")[0] === name);

/**
 * A component's private props type: the project type it takes its props as (`{ … }: ButtonProps`)
 * when nothing else uses it — no other declaration's "uses type" edge points at it, and no import
 * of its file names it. Drawn as part of the component (named in its caption), not as a card.
 */
export function privatePropsType(s: Snapshot, ix: GraphIndex, component: GraphNode): GraphNode | undefined {
  if (component.kind !== "component") return undefined;
  const type = propsTypeDeclaration(s, component);
  if (!type) return undefined;
  const incoming = ix.in.get(type.id) ?? [];
  if (incoming.some((e) => e.kind === "usesType" && e.from !== component.id)) return undefined;
  // its file: what declares it; another file importing the name from there uses it too
  const file = incoming.find((e) => e.kind === "declares")?.from;
  if (file && (ix.in.get(file) ?? []).some((e) => e.kind === "imports" && importsName(e.specifiers, type.name))) return undefined;
  return type;
}
