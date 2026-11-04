import type { Condition, ImportType, JsxProp, Loc, ParamDef, PropDef, TypeParam, Navigation, MiddlewareMatcher } from "@rae/schema";

/** Result of resolving an import specifier. */
export type Resolved =
  | { kind: "local"; path: string }
  | { kind: "asset"; path: string }
  | { kind: "external"; specifier: string }
  /** The project's own file that doesn't exist (a relative import or an alias pointing at nothing). */
  | { kind: "missing"; path: string; specifier: string };

export interface ImportName {
  /** Imported name: `default`, `*` (namespace) or the named export. */
  imported: string;
  local: string;
}

export interface ImportRecord {
  specifier: string;
  type: ImportType;
  names: ImportName[];
  resolved?: Resolved;
}

export interface ExportRecord {
  /** Name under which it's exported (`default` for default). `*` for `export * from`. */
  exported: string;
  /** Local binding name (for local exports). */
  local?: string;
  /** For re-exports: source specifier index into `imports`, and the imported name (`*` = namespace). */
  from?: number;
  imported?: string;
}

/** JSX node before cross-file linking: references a local binding instead of a NodeId. */
export interface RawJsxNode {
  tag: string;
  native: boolean;
  /** Root identifier of the tag (e.g. `UI` for `<UI.Button>`), and member path. */
  ref?: { local: string; member?: string };
  props: JsxProp[];
  conditions: Condition[];
  loc: Loc;
  children: RawJsxNode[];
}

export interface RawHook {
  hook: string;
  local: string;
  member?: string;
  args: string[];
  assignedTo?: string;
  loc: Loc;
  /** Offsets of identifiers in the binding pattern (for type queries). */
  bindingPositions: number[];
  bindingNames: string[];
  /** Whether the binding pattern is an array pattern (tuple-like result). */
  arrayPattern: boolean;
  /** Offset of the callee identifier (fallback type query). */
  calleePos: number;
  returnType?: string;
}

export interface RawFn {
  name: string;
  isAsync: boolean;
  params: ParamDef[];
  returnType?: string;
  loc: Loc;
  pos: number;
}

export interface RawRef {
  local: string;
  member?: string;
  conditions?: Condition[];
}

export type DeclKind = "component" | "hook" | "serverAction" | "function" | "type";

export interface DeclExtract {
  local: string;
  kind: DeclKind;
  isAsync: boolean;
  loc: Loc;
  /** Offset of the name identifier (or the function start) for type queries. */
  pos: number;
  /** Last line of the declaration, and a hash of its source (a diff compares them). */
  endLine: number;
  hash: string;
  params: ParamDef[];
  returnType?: string;
  /** The return type annotation as written (the type pass fills `returnType`). */
  returnWritten?: string;
  /** A hash of its `return` statements' code (or an arrow's expression body). */
  returnHash?: string;
  props?: PropDef[];
  hooks: RawHook[];
  functions: RawFn[];
  calls: RawRef[];
  renders: RawRef[];
  renderTree: RawJsxNode[];
  directives: string[];
  /** Type declarations: the declaration as written (the preview), and what kind of declaration. */
  typeText?: string;
  typeKind?: "interface" | "type" | "enum";
  /** Names of types this declaration refers to in its type annotations (resolved in the graph). */
  typeRefs?: string[];
  /** Generic type parameters, as written. */
  typeParams?: TypeParam[];
  /** Interfaces: their `extends` clauses, as written. */
  extends?: string[];
  /** Request-time APIs it calls (`cookies()`, `headers()`, `searchParams`, `fetch … no-store`, plain `fetch()`…). */
  dynamicApis?: string[];
  /** cacheLife / cacheTag calls in its body ("use cache" scopes). */
  cacheLife?: string;
  cacheTags?: string[];
  /** revalidateTag / updateTag calls. */
  invalidates?: { via: "revalidateTag" | "updateTag"; tag: string }[];
  /** Segment config `export const instant = false` lives on the file; see FileExtract.segmentConfig. */
  /** Where it navigates or sends requests (in-app paths only), as written. */
  navigations?: { via: Navigation["via"]; href: string }[];
}

export interface FileExtract {
  absPath: string;
  stamp: string;
  /** Hash of the file's text (diffs tell changed files by it). */
  hash: string;
  directives: string[];
  serverOnly: boolean;
  clientOnly: boolean;
  imports: ImportRecord[];
  exports: ExportRecord[];
  decls: DeclExtract[];
  /** Route segment config: `export const dynamic = "…"`, `export const revalidate = n | false`. */
  segmentConfig?: { dynamic?: string; revalidate?: number | false; instant?: boolean };
  /** `export const config = { matcher }` (middleware / proxy), as written; undefined when there's none. */
  matcher?: MiddlewareMatcher[];
  /** JSX rendered at module level (outside declarations). */
  moduleRenders?: RawRef[];
  /** Declarations invoked by module-level code. */
  moduleCalls?: RawRef[];
  moduleTree?: RawJsxNode[];
  /** local alias → decl local (e.g. `const Memo = memo(Stats)`). */
  aliases: Record<string, string>;
  errors: string[];
  /** Key of the inputs used for type info (own stamp + direct deps); set by the types pass. */
  typesKey?: string;
}
