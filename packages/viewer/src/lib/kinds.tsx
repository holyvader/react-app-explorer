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

/** A route's rendering as `next build` prints it: "○ Static", "● SSG", "◐ Partial", "ƒ Dynamic", "○ ISR 60s"; "⚠ Blocking" when the build would fail. */
export function renderingLabel(r: { mode: string; revalidate?: number; expire?: number; blocking?: boolean }): string {
  if (r.blocking) return "⚠ Blocking";
  if (r.mode === "dynamic") return "ƒ Dynamic";
  const every = r.revalidate ? duration(r.revalidate) : undefined;
  if (r.mode === "ppr") return every ? `◐ Partial · ${every}` : "◐ Partial";
  if (r.mode === "ssg") return every ? `● SSG · ${every}` : "● SSG";
  if (every) return r.expire ? `○ Static · ${every}` : `○ ISR ${every}`;
  return "○ Static";
}

/** The badge's colour key: the mode, or "blocking". */
export const renderingKey = (r: { mode: string; blocking?: boolean }) => (r.blocking ? "blocking" : r.mode);

/** 3600 → "1h", 86400 → "1d", 90 → "90s". */
export function duration(n: number): string {
  if (n % 86400 === 0) return `${n / 86400}d`;
  if (n % 3600 === 0) return `${n / 3600}h`;
  if (n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

/** A "use cache" chip: `use cache · 1h`, with the variant when it isn't the default. */
export function cacheLabel(c: { variant: string; revalidate?: number }): string {
  return `${c.variant === "default" ? "use cache" : `use cache: ${c.variant}`}${c.revalidate ? ` · ${duration(c.revalidate)}` : ""}`;
}
