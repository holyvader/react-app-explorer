import type { NodeKind } from "@rae/schema";
import {
  IconComponent,
  IconExternal,
  IconFunction,
  IconHook,
  IconModule,
  IconServerAction,
  type Icon,
} from "@rae/design-system/icons";

export const KIND_META: Record<NodeKind, { label: string; icon: Icon }> = {
  module: { label: "Module", icon: IconModule },
  component: { label: "Component", icon: IconComponent },
  hook: { label: "Hook", icon: IconHook },
  serverAction: { label: "Server action", icon: IconServerAction },
  function: { label: "Function", icon: IconFunction },
  external: { label: "External", icon: IconExternal },
};

export const NODE_KINDS = Object.keys(KIND_META) as NodeKind[];
