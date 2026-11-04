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
  → mergeSingleExportModules      (merge.ts, default on; --no-merge / mergeSingleExport: false) files declaring
                                  exactly one thing, exported, collapse into it
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
3. tsgo prints types with `FORMAT` (TypeScript's defaults + `NoTruncation`: no `... N more ...`), clipped at `MAX_TYPE` (2000).
3b. tsgo: collect all positions per file and send **one** `checker.getTypeAtPosition(file, positions[])`. Pipeline follow-ups with `Promise.all`; never `await` in a per-node loop. Clip type strings (`MAX_TYPE`).
4. Keep the extractor syntactic and worker-safe: plain serializable output, no closures, no class instances.
5. **Type declarations** (interface / type alias / enum) are declarations of kind `type`. `typeText`
   is the declaration as written (`SourceText.raw`, the UI's preview) and `typeKind` says which kind.
   Every declaration records `typeRefs` (names in its annotations → node ids, resolved through
   imports) and `usesType` edges to type nodes. The tsgo pass skips `type` declarations.
   Generics: `typeParams` (`{ name, constraint?, default? }`, as written) on types and functions;
   interfaces also keep `extends` (as written), and their extends clauses count as type references.
6. **Next.js App Router routes** (graph.ts `addRoutes`): one `route` node per app/ directory with
   special files. The id is `route:/<dir under app>` (groups and slots stay distinct) and the name is
   the URL (groups and slots also show their segment). `RouteInfo` holds the URL, segment kind,
   params, kind (page / api / segment), files by role, API methods and the parent route. Edges:
   `routeChild` and `routeFile`. Each declaration's `navigations` (Link/`<a>` href, router.push /
   replace, redirect, fetch, revalidatePath; in-app "/…" paths only, template parts → `[…]`) are
   matched to routes, most specific first, and become `navigates` / `fetches` / `revalidates` edges.
   A `[…]` only fills dynamic segments. Intercepting routes (`(.)x` anywhere on the way, often on a
   parent folder) get segment kind `intercept`, are named as Next prints them (`/(.)photos/[id]`) and
   are never link targets. Middleware (`middleware.ts` / `proxy.ts`, root or src/): `config.matcher`
   is read as written (strings, arrays, `{ source, has, missing }`) onto the module's `middleware`.
   `matcherRegex` (path-to-regexp `:p` `:p?` `:p*` `:p+`, raw `(…)` groups) is tested against
   `samplePaths` of each page / API route (intercepting ones included). Matches get `runsBefore` edges
   and `route.middleware` (with the matcher and has/missing conditions). No matcher means every route.
   `NextResponse.redirect` / `rewrite(new URL("/x", …))` are navigations. Checks inside the function
   aren't evaluated. **Rendering** (`addRendering`, matches `next build`'s ○ / ● / ƒ): segment config
   (`dynamic`, `revalidate`) of the route's layouts and own file (the innermost wins); dynamic segments
   need `generateStaticParams` (→ `ssg`); route handlers are dynamic by default; any `dynamicApis`
   (`cookies()`, `headers()`, `draftMode()`, `connection()`, `noStore()`, `fetch … no-store`, a page
   reading `searchParams`) reached from the route's files via renders / invokes / usesHook makes it
   dynamic. Server actions aren't followed. `reasons` say why. Checked against next-shop-demo's
   `next build`: 16/16 routes agree. **Cache Components** (`cacheComponents` / `dynamicIO` / `useCache`
   in next.config → `snapshot.next.cacheComponents`): `addCacheComponentsRendering`. Request-time
   data (`cookies()`, `headers()`, `connection()`, `searchParams`, uncached `fetch()`, `params`
   without generateStaticParams) inside `<Suspense>` (a `renders` edge with a `suspense` condition) or
   under a loading.tsx is `ppr` (◐). A loading.tsx covers its page and the segments below, layouts
   included, but not its own layout; the root layout is covered by nothing. Outside a boundary it's
   `dynamic` + `blocking` (next build fails) unless `export const instant = false`. Route files are
   entered through their exports; client components and server actions aren't followed; `"use cache"`
   scopes (`cache` on the node: variant, function or file scope, cacheLife profile or object → seconds,
   cacheTag) stop the walk and their shortest revalidate / expire becomes the route's. `revalidateTag`
   / `updateTag` → `invalidates` edges to the tagged scopes. Verified against next-shop-demo's build
   (cacheComponents on): 18/18 routes and the 1h/1d and 1m/10m intervals agree. Pages Router isn't
   modelled (by choice). A real-world test project:
   ~/IdeaProjects/next-shop-demo (every route kind, API methods, navigation, generics).
7. **Only packages are external**: imports resolved into node_modules, Node built-ins, and bare names
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

## Merging single-export files (`merge.ts`)
A module whose only declaration is exported (no private helpers, no extra types) is replaced by that
declaration, **under the module's id** (`app/page.tsx`, not `app/page.tsx#HomePage`), so imports,
`route.files`, middleware links and render-tree targets keep resolving. The node keeps the file's
`nextRole`, `moduleType`, directives, dynamicApis, cache, middleware; it gets `file: true` and
`fileName`. Its `declares` edge goes; edges and ids pointing at the declaration are renamed; duplicates
collapse. `snapshot.options.mergeSingleExport` records the choice. Assets and missing files never merge.
The viewer treats `file: true` nodes as files (`isFileNode` / `fileIdOf` in graph/drawn.ts): folder
frames, route frames, the tree (a decl row where the file was) and the card's role / boundary badges.
Tests that check file → declaration structure pass `mergeSingleExport: false`.

## Diff mode (`git.ts`, `diff.ts`, `diffScan.ts`)
`rae-scan <dir> --base main [--head feature] [--against-tip]` / `scanDiff(dir, { base, head })`:
the head's snapshot with `snapshot.diff` (`SnapshotDiff` in schema).
- **Plain git only** (no gh / glab): `for-each-ref` (branches), `ls-remote origin refs/pull/*/head
  refs/merge-requests/*/head` (GitHub PRs / GitLab MRs, no titles), `fetch origin <that ref>` (into
  FETCH_HEAD only), `merge-base`, `diff -z -M --name-status/--numstat`. Arguments as a list, refs
  checked with `rev-parse --verify --end-of-options`. **Never change the user's repo**: no checkout,
  worktree, branch or ref.
- Each commit is exported with a temporary index (`read-tree` + `checkout-index --prefix`) into
  `$TMPDIR/rae-trees/<sha>` (reused). Its node_modules are the checkout's, linked package by package;
  workspace links (into the repo, outside node_modules) become **relative** links into the exported
  tree, so a monorepo's own packages are read at that commit and get the same ids as a normal scan.
- Compared against the merge-base by default (what the PR / MR shows). The base is scanned without
  types. When the head is the checked-out commit, `absPath`s point at the checkout.
- Changes: ids match (after git's renames map `old#X` → `new#X`); `changed` = different `hash`
  (declaration source; for files and merged nodes the whole file) or kind / boundary / role / route
  rendering. Edges compare by kind + ends + importType. Removed nodes are kept in `diff.removed`.
- UIs: `runScanJob(dir, { diff: { base, head | request, against } })` streams it like a scan (the untyped
  diff snapshot, then the typed one with the **same diff** — computed from both sides untyped, so types
  never show as changes). `--request refs/pull/N/head` fetches a PR / MR first. The checkout (`HEAD`)
  is named by its branch.
- `gitApi.ts` (Node- and Bun-safe: `git()` is `execFile`): `gitOverview` (repo, dirty, branches) and
  `gitRequests` (ls-remote, 20s timeout) behind `GET /api/git` and `/api/git/requests` in both the
  desktop server and the Vite dev plugin; `parseDiffRequest` checks a scan body's `diff` (refs never
  start with `-`: the dev plugin passes them to the CLI as `--base=<ref>`). Types: `GitOverview`,
  `GitRepo`, `GitBranch`, `GitRequest` in @rae/schema.
- Finding git (`gitPath`): `RAE_GIT`, Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), PATH, then
  `/usr/bin/git` — on macOS only when the Command Line Tools / Xcode are installed (else that shim
  pops up their installer). Missing → `GIT_MISSING` (what to install), shown in the scan dialog; the
  desktop server logs `git: <path>`. Finder-started apps get PATH=/usr/bin:/bin:…, hence the list.
- `worktree: true` (`--worktree`): the head is the checkout with uncommitted changes, scanned in place;
  `changedFiles(root, base)` diffs against the working tree and adds untracked (not ignored) files.
- Exported commits are pruned on each new export (`pruneTrees`): unused for 7 days, past the 12 most
  recently used, or half-done for over an hour; reuse touches a tree's mtime.
- GitLab: verified on gitlab.com (ls-remote ~0.7s for 1.6k MRs; fetching one ~4s). Request refs list
  open **and** closed requests (git can't tell); the dialog says so.
- **Host CLIs** (`hostCli.ts`, optional): `gh` / `glab` list **open** PRs / MRs with title, author,
  draft, target branch, link (`gh pr list -R host/owner/repo --json …`, `glab mr list -R https://host/path
  --output json`); commits are still fetched with git. Found like git (`RAE_GH` / `RAE_GLAB`, Homebrew,
  PATH); `toolStatus` = installed + `auth status --hostname <host>` (cached 60s; `refreshTools()`).
  `gitRequests(path, source)`: `auto` (default) = the host's CLI (github → gh, gitlab → glab, other hosts:
  whichever is logged in) when installed and logged in, else git with `fallback` saying why; `git`;
  or an explicit CLI (errors reported, no fallback). `GET /api/git/tools`, `/api/git/requests?source=`.
  The host comes from `remote.origin.url` as configured (not `insteadOf`-rewritten). The request's
  title / author / link travel as `diff.requestInfo` (cleaned by `parseDiffRequest`; links must pass
  `isRequestUrl`: https PR / MR pages) → `diff.head.request`. The desktop `/api/open` also opens
  `isRequestUrl` links. Verified with real gh on pmndrs/zustand (3 PRs listed in ~0.9s, a PR diffed in ~1.8s).
- Tests: `test/diff.test.ts` builds real temp repos (branch, rename, delete, a bare "host" with request
  refs, a monorepo with a workspace link).

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
