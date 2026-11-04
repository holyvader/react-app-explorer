/**
 * Snapshot format produced by @rae/scanner and consumed by @rae/viewer.
 * The app is stored as a normalized graph (id-keyed nodes + edges); trees are derived on demand.
 */
export const SCHEMA_VERSION = 2;

export type NodeId = string;

export type Framework = "next-app" | "next-pages" | "react";

/** A generic type parameter: `T`, its constraint (`extends …`) and default (`= …`), as written. */
export interface TypeParam {
  name: string;
  constraint?: string;
  default?: string;
}

export type NodeKind = "module" | "component" | "hook" | "serverAction" | "function" | "type" | "route" | "external";

/**
 * How a route segment (an app/ directory) takes part in the URL: `static` (`blog`), `dynamic`
 * (`[slug]`), `catchAll` (`[...slug]`), `optionalCatchAll` (`[[...slug]]`), `group` (`(marketing)`,
 * not in the URL), `slot` (`@modal`, parallel route, not in the URL), `intercept` (`(.)photo`),
 * `root` (app/ itself).
 */
export type SegmentKind = "root" | "static" | "dynamic" | "catchAll" | "optionalCatchAll" | "group" | "slot" | "intercept";

/** A Next.js App Router route: one app/ directory with special files. */
export interface RouteInfo {
  /** The URL pattern (`/blog/[slug]`); groups and slots don't appear in it. */
  url: string;
  /** This directory's segment as written (`[slug]`, `(app)`, `@modal`), "" for app/ itself. */
  segment: string;
  segmentKind: SegmentKind;
  /** Dynamic parameters along the URL (`["slug"]`). */
  params: string[];
  /** What the route serves: a page, an API (route.ts), or only shared UI (layout, loading…). */
  kind: "page" | "api" | "segment";
  /** Its special files by role (`page`, `layout`, `loading`, `error`, `not-found`, `template`, `default`, `route`) → module ids. */
  files: Partial<Record<string, NodeId>>;
  /** API routes: the HTTP methods route.ts exports. */
  methods?: string[];
  /** The nearest enclosing route. */
  parent?: NodeId;
  /**
   * How Next renders it (pages and API routes), as `next build` labels it: `static` (○ prerendered),
   * `ssg` (● prerendered for generateStaticParams), `dynamic` (ƒ on every request). `revalidate`:
   * seconds between regenerations (ISR). `reasons`: why it's dynamic / static, as found in the code.
   */
  rendering?: {
    /** `ppr`: ◐ Partial Prerender (Cache Components) — a static shell, request-time parts streamed in. */
    mode: "static" | "ssg" | "ppr" | "dynamic";
    revalidate?: number;
    /** Cache Components: seconds until cached data expires (from cacheLife). */
    expire?: number;
    /** Cache Components: request-time data outside <Suspense> — `next build` fails (blocking prerender). */
    blocking?: boolean;
    reasons: string[];
  };
  /** The middleware (middleware.ts / proxy.ts) that runs before this route, and the matcher that selects it. */
  middleware?: { id: NodeId; matcher?: string; conditions?: string[] };
}

/** A `"use cache"` scope: `"use cache"` / `"use cache: remote"` / `"use cache: private"`, in the function or the whole file. */
export interface CacheInfo {
  variant: "default" | "remote" | "private";
  scope: "function" | "file";
  /** cacheLife as written (`hours`, `{ revalidate: 60 }`); revalidate / expire in seconds when known. */
  life?: string;
  revalidate?: number;
  expire?: number;
  tags?: string[];
}

/** One entry of a middleware's `config.matcher`, as written; `has` / `missing` as "cookie session", "header x-flag=1"… */
export interface MiddlewareMatcher {
  source: string;
  has?: string[];
  missing?: string[];
}

/** Where a declaration sends the user or a request, as written in the source. */
export interface Navigation {
  via: "link" | "push" | "replace" | "redirect" | "rewrite" | "fetch" | "revalidate";
  /** The target as written: `/blog/[…]` stands for a template part. */
  href: string;
  /** The route it matches, when it's a path of this app. */
  route?: NodeId;
}

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
  /** Request-time APIs it calls (`cookies()`, `headers()`, `fetch … no-store`…): they make a route dynamic. */
  dynamicApis?: string[];
  /** `"use cache"` (Cache Components): how it's cached — variant, where the directive is, cacheLife and cacheTag. */
  cache?: CacheInfo;
  /** `revalidateTag` / `updateTag` calls: the cache tags it invalidates. */
  invalidates?: { via: "revalidateTag" | "updateTag"; tag: string }[];
  /** Middleware modules: their `config.matcher` (none → it runs on every route). */
  middleware?: { matchers: MiddlewareMatcher[] };
  /** Route nodes (`kind: "route"`). */
  route?: RouteInfo;
  /** Where this declaration navigates / sends requests (matched to routes where possible). */
  navigations?: Navigation[];
  /** Generic type parameters (`<T extends Item = Item>`) of a type, function, hook or component. */
  typeParams?: TypeParam[];
  /** Interfaces: what they extend, as written (`Base`, `Omit<Props, "x">`). */
  extends?: string[];
  /** Type declarations (`kind: "type"`): the declaration as written — the type's full preview. */
  typeText?: string;
  typeKind?: "interface" | "type" | "enum";
  /**
   * Named types this declaration's annotations refer to, by the name used in its source → the node
   * they resolve to (a `type` node, or an external package for library types). Lets UIs link type text.
   */
  typeRefs?: Record<string, NodeId>;
  /** A project file that isn't source code (CSS, images, JSON…): a module node without declarations. */
  asset?: boolean;
  /** A project file that's imported but doesn't exist (a tsconfig alias or relative path to nothing). */
  missing?: boolean;
  /** For missing files: the import specifier as written. */
  specifier?: string;
  absPath?: string;
  loc?: Loc;
  /** Declarations: their last line. Files and declarations: a hash of their source text (diffs tell changed ones by it). */
  endLine?: number;
  hash?: string;
  moduleType?: ModuleType;
  nextRole?: NextRole;
  /**
   * A declaration standing for its whole file: the file declared only it (and exported it), and the
   * scan merged the two (`mergeSingleExport`). Its id is the file's; `fileName` is the file's name.
   */
  file?: boolean;
  fileName?: string;
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
/**
 * `usesType`: a declaration's annotations (props, params, return type, extends…) refer to a type declaration.
 * Routes: `routeFile` (route → its page/layout/… module), `routeChild` (route → nested route),
 * `navigates` (Link / router.push / redirect → page route), `fetches` (fetch → API route),
 * `revalidates` (revalidatePath → route).
 */
export type EdgeKind =
  | "imports"
  | "declares"
  | "renders"
  | "invokes"
  | "usesHook"
  | "invokesAction"
  | "usesType"
  | "routeFile"
  | "routeChild"
  | "navigates"
  | "fetches"
  | "revalidates"
  /** Middleware (middleware.ts / proxy.ts) → each route its matcher selects (every route without a matcher). */
  | "runsBefore"
  /** revalidateTag / updateTag → the "use cache" declarations tagged with it. */
  | "invalidates";

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
  /** Navigation edges: the target as written, and how (`link`, `push`, `redirect`…). */
  href?: string;
  via?: Navigation["via"];
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
  /** Next.js settings that change how routes render (`cacheComponents` in next.config). */
  next?: { cacheComponents?: boolean };
  stats: ScanStats;
  /** A diff snapshot: the head's graph, and what changed against the base. */
  diff?: SnapshotDiff;
  /** How it was scanned: `mergeSingleExport` — files declaring one exported thing became that declaration. */
  options?: { mergeSingleExport?: boolean };
  nodes: Record<NodeId, GraphNode>;
  edges: Edge[];
}

export type ChangeKind = "added" | "removed" | "changed";

/** A commit a diff compares: the ref as asked for (`main`, `refs/pull/12/head`), its sha and subject. */
export interface DiffSide {
  ref: string;
  sha: string;
  subject?: string;
}

/**
 * What changed between two commits (a branch or pull / merge request against its base). The snapshot
 * holding it is the head's; `removed` keeps what only the base had, so UIs can draw it as ghosts.
 */
export interface SnapshotDiff {
  base: DiffSide;
  head: DiffSide;
  /** The commit compared against: the merge-base of base and head (what the request's own diff shows), or base itself. */
  against: "merge-base" | "base";
  compared: string;
  /** Node id (the head's) → how it changed. Unchanged nodes aren't listed. */
  nodes: Record<NodeId, ChangeKind>;
  /** Nodes only the base had, as they were (ids as in the base). */
  removed: Record<NodeId, GraphNode>;
  /** Base id → head id, for nodes in renamed files. */
  renamed: Record<NodeId, NodeId>;
  /** Edges only the head has, and edges only the base had (base edges use head ids where renamed). */
  edges: { added: Edge[]; removed: Edge[] };
  /** Changed files under the scanned folder (paths relative to it). */
  files: { path: string; status: "added" | "modified" | "deleted" | "renamed"; from?: string; additions: number; deletions: number }[];
}

export interface SnapshotIndexEntry {
  file: string;
  createdAt: string;
  rootDir: string;
  framework: Framework;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  /** Diff snapshots: what they compare (refs and short shas), and how many nodes changed. */
  diff?: { base: string; head: string; changes: number };
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
