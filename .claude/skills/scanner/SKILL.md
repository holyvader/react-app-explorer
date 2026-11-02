---
name: scanner
description: Work on the @rae/scanner (Bun CLI that statically analyzes React/Next.js repos into graph snapshots) — adding extraction features, condition kinds, node/edge kinds, type info via TypeScript 7 (tsgo), fixing classification or resolution, and keeping it fast. Use whenever editing packages/scanner or packages/schema, or when a snapshot looks wrong.
---

# Scanner (`packages/scanner`)

Performance is the top requirement. Never introduce ts-morph, the JS `typescript` compiler API, Babel or other JS-based parsers.

## Pipeline

```
discoverProject (project.ts)      dir → glob source files │ file → single entry; detects next-app / next-pages / react
  → collectFiles (collect.ts)     BFS over local imports; small batches inline, else Bun Worker pool (workers/extract.worker.ts)
      → extractFile (extract/)    oxc-parser AST → FileExtract (imports/exports/decls/JSX/hooks/calls) + oxc-resolver
  → applyTypes (types/tsgo.ts)    TypeScript 7 Go checker over async IPC — only for types, at offsets oxc found
  → buildGraph (graph.ts)         cross-file symbol linking → nodes + edges, server/client propagation
  → writeSnapshot (scan.ts)       <root>/.explorer/snapshots/<ISO>.json + index.json
```

Incremental cache: `<root>/.explorer/cache/extract-v<EXTRACT_VERSION>.json`, keyed by mtime+size. Types are re-queried when `typesKey` changes (own stamp + direct deps' stamps).

## Key files
- `packages/schema/src/index.ts` is the snapshot contract shared with the viewer. Bump `SCHEMA_VERSION` on breaking changes.
- `extract/index.ts`: directives, imports/exports, decl candidates, classification (component/hook/serverAction/function), props/params, hooks, calls.
- `extract/jsx.ts`: render tree with the **condition stack**: `&&`, `||/??`, ternary, `if`/early return, `switch`, `.map`, render props, JSX-in-props, Suspense/ErrorBoundary, and JSX in local variables (followed one level deep).
- `graph.ts`: `resolveLocal` → `resolveExport` (follows re-exports and `export *`); ids are `<relPath>` for modules (including assets and missing files), `<relPath>#<local>` for decls, `ext:<specifier>` for packages. (Old snapshots may still have `asset:<rel>` externals; the viewer tolerates them.)
- `types/tsgo.ts`: `typescript/async` API. **The sync API does not work under Bun** because it reads Node-internal `_handle.fd`.

## Rules
1. **Bump `EXTRACT_VERSION` in `cache.ts`** whenever the `FileExtract` shape or semantics change, or users get stale cache data.
2. oxc offsets are UTF-16 and match what tsgo positions expect. Pass `node.start` directly.
3. tsgo: collect all positions per file and send **one** `checker.getTypeAtPosition(file, positions[])`. Pipeline follow-ups with `Promise.all`; never `await` in a per-node loop. Clip type strings (`MAX_TYPE`).
4. Keep the extractor syntactic and worker-safe: plain serializable output, no closures, no class instances.
5. **Type declarations** (interface / type alias / enum) are declarations of kind `type`. `typeText`
   is the declaration as written (`SourceText.raw`, the UI's preview) and `typeKind` says which kind.
   Every declaration records `typeRefs` (names in its annotations → node ids, resolved through
   imports) and `usesType` edges to type nodes. The tsgo pass skips `type` declarations.
   Generics: `typeParams` (`{ name, constraint?, default? }`, as written) on types and functions;
   interfaces also keep `extends` (as written), and their extends clauses count as type references.
6. **Only packages are external**: imports resolved into node_modules, Node built-ins, and bare names
   that match no tsconfig alias. They become `external` nodes and are never scanned. Everything else
   is the project's own:
   - local non-source files are `module` nodes with `asset: true`;
   - imports that don't resolve but are relative, or match the file's tsconfig `paths`/`baseUrl`, are
     `module` nodes with `missing: true` (+ `specifier`), placed where the alias points (e.g. generated
     files that aren't built). `resolve.ts` reads aliases itself (`parseJsonc`, relative `extends`,
     `references`), because oxc-resolver doesn't say why a lookup failed.
   - Each file resolves with its **nearest tsconfig** (oxc `tsconfig: "auto"`), so monorepo packages and
     Vite-style `tsconfig.app.json` references keep their own aliases. Only an explicit `--tsconfig`
     applies to all files.
   - The project root is a **real path** (`realpathSync`): the resolver returns real paths, and a
     symlinked root (macOS `/var` → `/private/var`) turned ids into `../../…`.
   - Changing what extraction records means bumping `EXTRACT_VERSION` (cache.ts): caches keep each
     file's resolved imports.
6. Adding a new schema field: schema → extract (worker output) → graph (node/edge mapping) → viewer display → test.

## Adding things
- **New condition kind**: add to `ConditionKind` (schema) → push in `JsxAnalyzer` → `formatCondition` / `CONDITION_LABEL` in `packages/viewer/src/lib/conditions.ts` → test.
- Relations: `imports`, `declares`, `renders`, `usesHook`, `invokes` (calls, `new`, handler references, module-level calls), `invokesAction` (invokes a server action). Schema v1 called the last two `calls`/`callsAction`; the viewer upgrades old snapshots in `normalizeSnapshot`.
- **New edge kind**: add to `EdgeKind` → `addEdge` in graph.ts → viewer `EDGE_GROUP_OF`, `CHILD_KINDS` (relations.ts), `EDGE_STYLE` (Canvas.tsx).
- **New Next.js file convention**: `APP_ROLES` / `nextRoleOf` in project.ts.

## Verify
```bash
bun test packages/scanner                       # fixture tests (types on + --no-types)
bun run scan packages/fixtures/next-app --stats # phase timings
tsc -p packages/scanner --noEmit                # tsc is TS 7 (Go)
```
Fixtures live in `packages/fixtures/{next-app,react-app}`. Add a fixture file for every new feature and assert on edges/nodes in `packages/scanner/test/scanner.test.ts`.

Perf check on a big repo: shallow-clone one into the scratchpad (e.g. `shadcn-ui/ui`, apps/v4 ≈ 3.6k files) and run `--no-cache --stats --out <scratch>`. Baseline: parse ≈ 0.4s, types ≈ 1.0s, graph ≈ 0.1s, warm rescan with cache ≈ a few ms. Profile with `bun --cpu-prof`.
