/**
 * Snapshot format produced by @rae/scanner and consumed by @rae/viewer.
 * The app is stored as a normalized graph (id-keyed nodes + edges); trees are derived on demand.
 */
export const SCHEMA_VERSION = 2;

export type NodeId = string;

export type Framework = "next-app" | "next-pages" | "react";

export type NodeKind = "module" | "component" | "hook" | "serverAction" | "function" | "external";

export type ModuleType = "server" | "client" | "shared";

export type NextRole =
  | "page"
  | "layout"
  | "template"
  | "loading"
  | "error"
  | "not-found"
  | "route"
  | "middleware"
  | "default"
  | "api";

export interface Loc {
  line: number;
  col: number;
}

export interface PropDef {
  name: string;
  type?: string;
  optional: boolean;
  default?: string;
}

export interface ParamDef {
  name: string;
  type?: string;
  optional?: boolean;
  default?: string;
}

export interface Signature {
  params: ParamDef[];
  returnType?: string;
}

export interface HookUsage {
  /** Hook name as called, e.g. `useState` or `React.useState`. */
  hook: string;
  /** Linked graph node (local hook or external module). */
  targetId?: NodeId;
  /** Source text of the arguments. */
  args: string[];
  /** Source text of the binding pattern, e.g. `[open, setOpen]`. */
  assignedTo?: string;
  returnType?: string;
  loc: Loc;
}

export interface FnDef {
  name: string;
  isAsync: boolean;
  params: ParamDef[];
  returnType?: string;
  loc: Loc;
}

export type ConditionKind =
  | "and"
  | "or"
  | "ternary-true"
  | "ternary-false"
  | "if"
  | "early-return"
  | "switch-case"
  | "map"
  | "render-prop"
  | "prop"
  | "suspense"
  | "error-boundary";

export interface Condition {
  kind: ConditionKind;
  /** Source text, e.g. `user && isAdmin` → expr `user`. */
  expr: string;
}

export interface JsxProp {
  name: string;
  /** Source text of the value (truncated); `true` for boolean shorthand. */
  value?: string;
  isSpread?: boolean;
}

export interface JsxNode {
  tag: string;
  native: boolean;
  targetId?: NodeId;
  props: JsxProp[];
  /** Conditions relative to the parent element. */
  conditions: Condition[];
  loc: Loc;
  children: JsxNode[];
}

export interface GraphNode {
  id: NodeId;
  kind: NodeKind;
  name: string;
  /** Path relative to Snapshot.rootDir (for external: the module specifier). */
  filePath: string;
  /** A project file that isn't source code (CSS, images, JSON…): a module node without declarations. */
  asset?: boolean;
  /** A project file that's imported but doesn't exist (a tsconfig alias or relative path to nothing). */
  missing?: boolean;
  /** For missing files: the import specifier as written. */
  specifier?: string;
  absPath?: string;
  loc?: Loc;
  moduleType?: ModuleType;
  nextRole?: NextRole;
  /** For decls: owning module node id. */
  moduleId?: NodeId;
  exported?: boolean;
  /** Export names under which the decl is exported (`default` for default export). */
  exportNames?: string[];
  isAsync?: boolean;
  directives?: string[];
  props?: PropDef[];
  signature?: Signature;
  hooksUsed?: HookUsage[];
  functions?: FnDef[];
  renderTree?: JsxNode[];
}

/**
 * - invokes: a declaration (or module-level code) calls / constructs / references-as-handler another declaration.
 * - invokesAction: the same, when the target is a server action.
 * (Schema v1 named these `calls` / `callsAction`.)
 */
export type EdgeKind = "imports" | "declares" | "renders" | "invokes" | "usesHook" | "invokesAction";

export type ImportType = "static" | "dynamic" | "lazy" | "next-dynamic" | "type-only" | "reexport";

export interface Edge {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
  importType?: ImportType;
  /** Cumulative conditions from the component root to this render. */
  conditions?: Condition[];
  /** When the same target is rendered at several places: conditions of each occurrence. */
  variants?: Condition[][];
  /** Imported / used names. */
  specifiers?: string[];
}

export interface ScanStats {
  files: number;
  durationMs: number;
  phases: Record<string, number>;
  cacheHits: number;
  types: boolean;
}

export interface Snapshot {
  schemaVersion: number;
  createdAt: string;
  rootDir: string;
  entry: string;
  framework: Framework;
  stats: ScanStats;
  nodes: Record<NodeId, GraphNode>;
  edges: Edge[];
}

export interface SnapshotIndexEntry {
  file: string;
  createdAt: string;
  rootDir: string;
  framework: Framework;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

/**
 * A scan as seen by a UI (NDJSON lines from POST /api/scan): progress, the structure snapshot as
 * soon as it's written, then the typed snapshot replacing the same file.
 */
export type ScanEvent =
  /**
   * Progress. `parse`: files parsed out of those found so far (more may be found as imports are
   * followed); `types`: files typed out of the total, `loading` while TypeScript loads the project.
   */
  | { type: "progress"; stage: "discover" | "parse" | "graph" | "types"; done?: number; total?: number; loading?: boolean }
  /** The structure snapshot is written; `typesPending` → a `types` event follows. */
  | { type: "result"; file: string; stdout: string; ms: number; warnings: string[]; typesPending: boolean }
  /** The typed snapshot replaced `file`. `typed: false` → the type pass failed (see warnings). */
  | { type: "types"; file: string; ms: number; typed: boolean; warnings: string[] }
  | { type: "error"; message: string }
  /** Stopped on request. A structure snapshot already written stays (untyped). */
  | { type: "cancelled" }
  | { type: "done" };
