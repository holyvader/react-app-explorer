import type { NodeId, Snapshot } from "@rae/schema";
import { createContext } from "react";

export interface CodeNav {
  /** Names in the code shown, and the element each refers to (lib/codeLinks.ts). */
  links: Map<string, NodeId>;
  snapshot: Snapshot;
}

/** Given by a dialog showing code (components/codeNav.tsx); without it (the tooltip's diff column) names are plain. */
export const CodeNavContext = createContext<CodeNav | null>(null);
