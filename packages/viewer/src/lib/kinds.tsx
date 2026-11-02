import type { NodeKind } from "@rae/schema";
import {
  IconComponent,
  IconExternal,
  IconFunction,
  IconHook,
  IconModule,
  IconServerAction,
  IconRoute,
  IconType,
  type Icon,
} from "@rae/design-system/icons";

export const KIND_META: Record<NodeKind, { label: string; icon: Icon }> = {
  module: { label: "Module", icon: IconModule },
  component: { label: "Component", icon: IconComponent },
  hook: { label: "Hook", icon: IconHook },
  serverAction: { label: "Server action", icon: IconServerAction },
  function: { label: "Function", icon: IconFunction },
  type: { label: "Type", icon: IconType },
  route: { label: "Route", icon: IconRoute },
  external: { label: "External", icon: IconExternal },
};

export const NODE_KINDS = Object.keys(KIND_META) as NodeKind[];

/** What a file node is when it isn't plain source: a non-code asset, or an import that points at nothing. */
export const fileNote = (n: { asset?: boolean; missing?: boolean }) => (n.missing ? "not found" : n.asset ? "asset" : undefined);

/** A route's caption: what it serves (`Page`, `API · GET POST`, `Layout segment`), and its URL shape. */
export function routeCaption(r: { kind: string; methods?: string[]; segmentKind: string; params: string[] }): string {
  const what = r.kind === "api" ? `API${r.methods?.length ? ` · ${r.methods.join(" ")}` : ""}` : r.kind === "page" ? "Page" : "Layout segment";
  const shape =
    r.segmentKind === "group" ? "route group" : r.segmentKind === "slot" ? "parallel slot" : r.segmentKind === "intercept" ? "intercepting" : r.params.length ? "dynamic" : undefined;
  return shape ? `${what} · ${shape}` : what;
}
