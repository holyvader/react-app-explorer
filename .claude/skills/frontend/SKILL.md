---
name: frontend
description: General conventions for the viewer app (packages/viewer, Vite + React 19 + zustand) — file layout, state patterns, import rules, snapshot loading, running and testing it headlessly. Use for any change in packages/viewer that isn't specifically about React Flow internals or the design system.
---

# Viewer frontend (`packages/viewer`)

## Layout
```
vite.config.ts / vite-plugin-snapshots.ts   dev API (dir = RAE_SNAPSHOTS):
                        GET /api/snapshots, /api/snapshots/:file · GET /api/fs?path= (folder picker)
                        POST /api/scan {path, types} → spawns `bun packages/scanner/src/cli.ts <path> --out <dir>`
                        (the dev server runs under Node, the scanner needs Bun; RAE_BUN overrides the binary,
                        RAE_BROWSE_ROOT the initial picker folder). Dev-only: it exposes the local filesystem.
src/main.tsx            DesignSystemProvider + App
src/App.tsx             shell: Toolbar, Canvas, DetailsPanel, ScanModal, LibrariesModal, ConfirmExpansion; ⌘K opens the picker
src/components/picker/  adding: ExplorationPicker (tree picker), QuickAdd (right-click), ElementTree
src/store.ts            zustand store (single source of UI state)
src/graph/              pure graph logic (drawn graph, relations, ELK layout, placement engine, library filter), no React; tests in test/
src/lib/                pure helpers (api, conditions formatting, editor URLs, kind metadata)
src/components/         React components
e2e/smoke.ts            headless smoke test (playwright-core)
```

## Import rules (lint-enforced)
- UI comes from `@rae/design-system`, icons from `@rae/design-system/icons`.
- **Never** import `@chakra-ui/*`, `@emotion/*`, `lucide-react` or `@ark-ui/*` in the viewer. `no-restricted-imports` in `.oxlintrc.json` fails the lint. If a component is missing, add it to the design system first (design-system skill).
- Otherwise import only from the viewer's own `src/`, `@rae/schema` (types), `@xyflow/react`, and small libs (`zustand`, `elkjs`).
- Hot-path canvas UI (nodes, edges, labels, tooltip, tree rows) is plain HTML + CSS (`components/canvas.css`, `picker/picker.css`) using the design-system token CSS variables. That doesn't break the rule: nothing there imports Chakra.

## State
- **zustand selectors must return stable values**: `useExplorer((s) => s.index?.in.get(id)?.filter(…))`
  returns a fresh array every call and loops forever ("Maximum update depth exceeded"). Select the
  store value and derive with `useMemo`, or return a primitive (a count).
- Read with granular selectors: `useExplorer((s) => s.visible)`. Never select the whole store.
- Call actions via `useExplorer.getState().action` (stable, no re-render), or select them individually.
- Keep derived data in `useMemo` near its use (e.g. the picker tree, relations). Store only the minimal state.
- No `setState` in effects. Derive during render, or update from the event handler.

## Data
- 3rd-party filter: `excluded` packages (default `react`, `react-dom`) and `hideAllLibraries` live in the store and persist in localStorage. Anything listing nodes or relations must respect it: use `relationFilterOf(state)` or `isFiltered(node, …)`.
- Types come from `@rae/schema`. The snapshot is read-only in the UI.
- Conditions are displayed through `formatCondition`/`summarize` (`src/lib/conditions.ts`). Early-return and ternary-false conditions are negated for display ("rendered when …").
- Persistence: everything goes in localStorage under `rae.*` keys (settings, `rae.lastSnapshot`, each project's diagram `rae.diagram:<rootDir>`, saved 300ms after a change and on `pagehide`). In the desktop app, `syncStorage()` (`src/lib/storage.ts`, awaited in main.tsx **before App, the store and selectionHistory are imported**: main.tsx loads them with dynamic `import()`, because the store reads its settings from localStorage as it loads) restores them from the server's `/api/storage` and mirrors every `rae.*` write back. The app's server gets a new port each launch, so the web view's own localStorage starts empty. Always use `rae.*` keys, or it won't survive a restart.
- Selection history (`src/lib/selectionHistory.ts`, imported in main.tsx): each newly selected node is a `history` entry `{rae: id, i}` (`i` = step index; the first selection replaces the page's entry; a snapshot switch resets to 0). Back/Forward select it again with `addNodes([id], {select, focus})`, so removed nodes come back. Ways in, the same in both apps: the ← → `ControlButton`s in the canvas `Controls` (`useSelectionHistory()` for their disabled state), ⌘[ / ⌘] (handled by the viewer itself, never left to the browser), and the browser's own Back/Forward. The mouse's back/forward buttons are handled only in the desktop app (`serverIsDesktop`): a browser already does it, so handling it there too would step twice.
- Details panel relations: "Uses" comes before "Used by"; "Used by" shows the first `USED_BY_LIMIT` (5) entries in group order, then "Show N more". Each row shows the other end's file path, dimmed and smaller (`2xs`). In "Used by", imported names equal to the viewed node's own name are dropped (a hook's users import the hook).
- "Open in editor" goes through `editorUrl` (`src/lib/editor.ts`): IntelliJ/WebStorm `idea://`/`webstorm://`, VS Code/Cursor `vscode://file`. The choice persists in localStorage.

## Toolbar
- Left: the scanned project (`projectName(rootDir)` + `shortPath(rootDir)`, `lib/paths.ts`), then the snapshot select. Its options are grouped by scanned folder (`SelectOption.group` → `<optgroup>`), each option its date and node count. The Snapshots modal groups the same way (a header per folder with select-all).
- It must fit from 1280px up. The view buttons (Folders, Routes, Assets, Libraries) show text only
  from 2080px (`Label`; `aria-label` keeps their names). The brand text shows from 2240px and the
  stats from 2400px. The relation toggles may shrink and scroll sideways. Re-measure after adding
  anything (scrollWidth vs clientWidth at 1280 / 1600 / 1920).

## Details sidebar & filters
- The details panel minimizes (header button "Minimize the details") to a strip (`DetailsStrip`: open button, the element's tile, its name written down the strip; a click anywhere opens it). `detailsOpen` in the store, kept as `rae.detailsOpen`. The file tree folds the same way (`Panel` collapse).
- Components: one "Props" section (`ComponentProps`): each prop when known one by one, else the parameter's type (`props: ButtonProps`, linked), generics first. No "Output": a component returns an element. Other functions keep "Inputs & output".

## File tree (left)
- `components/FileTree.tsx`: the scanned model (`buildTree`) in `ElementTree` mode "browse", in a `Panel` with `resize.side = "left"`. Collapsible to a thin strip; open state and width in the store (`treeOpen` / `treeWidth`, `rae.treeOpen` / `rae.treeWidth`).
- A row click opens / closes it and shows its details. On the diagram: selected and centred there. Not on it: `select(undefined)` then `inspect(id)` (store `inspectedId`): the diagram selection is cleared and the details panel shows it, with an **"Add to diagram"** button first (elements and folders). Any selection change clears `inspectedId`; closing the details of an inspected element goes back to the selection. The + next to a name (`aria-label "Add <name> to the diagram"`) adds it directly. Rows on the diagram are bold; the shown one is tinted and revealed (its folders opened, scrolled into view). A treeitem's accessible name includes the + label: locate rows in tests by `[data-id="<node id>"]` (folders `dir:<path>`).
- Its filter box is "Filter files" and the tree "Files", so they don't clash with the picker's "Filter elements".
- The sidebar is resizable (`Panel resize`, a drag handle on its left edge; double-click resets).
  Its width is `sidebarWidth` in the store, kept in localStorage `rae.sidebarWidth`.
- Hooks in details and tooltips: only **custom hooks** (`hooksUsed` resolving to a project `hook` node)
  by name, as chips that open the hook (×N when called more than once). React's and libraries' hooks
  and their argument and return types are left out; a hook's own details lead with its Inputs & output.
- Generics: a `Generics` block (type parameters `T extends X = D`, and interface `Extends`) is its own
  section for types and sits at the top of Inputs & output for functions; the canvas tooltip shows it too.
- Inputs & output (`Signature`): Inputs (one parameter per row) and Output, without the element's
  name. Object types are laid out over lines by `formatType` (lib/typeText.ts; `TypeText pretty`),
  and tooltips always show that layout. The scanner keeps type text up to 1000 chars (`MAX_TYPE`).
- Uses / Used by are grouped by the other end's kind, most important first (`GROUP_ORDER`:
  components, server actions, hooks, functions, types, files, libraries).
- Types render through `TypeText`. Hovering shows a tooltip with the whole type plus the definitions
  of the project types it names (primitive-only types — `string`, `number | undefined`, literals: `isPrimitiveType` in lib/typeText.ts — get no tooltip); the names are links that add the type (`node.typeRefs`, falling
  back to a unique type node of that name). A type node's details show its definition.
- Assets (`asset` modules, old `asset:` externals) are hidden unless the toolbar's Assets toggle is
  on (`showAssets`, localStorage `rae.showAssets`): `isFiltered` applies everywhere the library
  filter does.
- Open in editor: `openInEditor(url)`. In a browser it follows the editor's URL scheme; in the
  desktop app (`serverIsDesktop`, from the snapshot list's `desktop: true`) it POSTs `/api/open`,
  and the server opens only editor schemes with the OS. Errors go to `notify()` (a notice over the
  canvas): `alert()` doesn't work in the app's web view.

## Scanning from the UI
- `lib/scanJob.ts` `startScan` reads the NDJSON stream into the store's `scan` state, so it outlives
  the dialog. `cancelScan` aborts the request, and the server then stops parsing or kills the type
  checker. `ScanModal` only starts the scan and closes at once: nothing blocks while it runs.
- `ScanProgress` (a panel over the canvas) covers the whole scan with real counts. Files: scanned /
  found and left; the total grows while imports are followed. Types: a timer while TypeScript loads
  the project (`loading`, no per-file count), then typed / total and left. It has a Cancel button.
- When the structure snapshot is written it loads; when the typed snapshot lands, `updateSnapshot`
  swaps it in place and keeps the diagram. It's applied even if it arrives before the structure
  snapshot finished loading. A cancelled scan keeps its structure snapshot (untyped).
- `SnapshotsModal` (toolbar ⟲ "Manage snapshots…") deletes snapshots via `DELETE /api/snapshots/`
  `{files}` (both servers; the running scan's file is refused with 409). Deleting the loaded one loads
  the newest left, or `unloadSnapshot()`.
- Scanner side: `scanStructure` + `addTypes` (scan.ts); `scan()` still does both for the CLI/tests.
  `signal` cancels; `onCount(stage, done, total, loading?)` feeds the progress.

## Same behaviour in the web app and the desktop app
The viewer runs in two hosts: Chrome/any browser on the Vite dev server (`bun run dev`, 5173) and the desktop app, a **WebKit** web view (WKWebView on macOS) on the Bun sidecar (production build). Every feature must behave the same in both. Design for the desktop app's limits:
- **No browser UI** in the app: no Back/Forward buttons, address bar, browser shortcuts or dev tools. Anything users would do with the browser needs an in-app control (e.g. the ← → history buttons; ⌘[ / ⌘] handled in JS for both apps).
- **New origin every launch** (the sidecar uses `--port 0`): localStorage, sessionStorage, IndexedDB and cookies start empty. Keep state in `rae.*` localStorage keys only: `syncStorage()` mirrors exactly those to the server (`/api/storage`).
- **WebKit, not Chromium**: no `alert`/`confirm`/`prompt` (use `Notice`/modals); other apps' URL schemes go through the server (`openInEditor` → `/api/open`); an opacity/transform *transition* on canvas nodes rasterises them blurry under the zoom (`:root[data-webkit]` turns those transitions off); mouse back/forward buttons don't navigate.
- **The production build has no `window.__rae`**: desktop-only paths (`serverIsDesktop`) can only be tested through the UI.

**Verify in both** before calling a UI change done:
1. Chromium against the Vite test server on 5199 (see "Test headlessly").
2. WebKit against the real sidecar and the production build, the closest thing to the app that can be scripted (macOS Accessibility is off, so the real app's window can't be driven):
```bash
S=<scratch dir>; (cd packages/viewer && node_modules/.bin/vite build --outDir $S/vdist --emptyOutDir)
mkdir -p $S/store/snapshots && cp <snapshots>/* $S/store/snapshots/
bun packages/server/src/server.ts --port 0 --snapshots $S/store/snapshots --static $S/vdist   # prints RAE_SERVER_URL
# Playwright: import { webkit } from "playwright-core"; webkit.launch() → goto that URL
# (once: `playwright-core install webkit`). Add nodes through the UI: Add → click the item → Done.
```
Restart the server (a new port) with a fresh browser context to check that state survives a relaunch. Then, after `bun run desktop:build`, open the real app (`open -n …/React App Explorer.app`) and probe its sidecar with curl for anything server-side.

## Run
- The packaged desktop app serves this viewer from a Bun sidecar with the same `/api/*` endpoints as the Vite plugin; keep both in sync (see the `desktop` skill).
```bash
bun run scan <path-to-app>                                 # writes <app>/.explorer/snapshots
RAE_SNAPSHOTS=<app>/.explorer/snapshots bun run dev        # http://localhost:5173
bun run build && tsc -p packages/viewer --noEmit && bun run lint
```

## Test headlessly
```bash
bun run scan packages/fixtures/next-app
# Dedicated port + PID: the user may have their own `bun run dev` running.
(cd packages/viewer && RAE_SNAPSHOTS=../fixtures/next-app/.explorer/snapshots node_modules/.bin/vite --port 5199 --strictPort > /tmp/rae-test.log 2>&1 & echo $! > /tmp/rae-test.pid)
PW_CHROMIUM_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  bun --cwd packages/viewer e2e [screenshotDir]
```
Afterwards stop **only that server**: `kill "$(cat /tmp/rae-test.pid)"`. Never `pkill -f "bun --filter @rae/viewer dev"` or `pkill -f vite`: that pattern matches the user's own `bun run dev` and kills their server.
Pass a screenshot dir and look at the PNG to check layout visually. In dev, `window.__rae` is the zustand store: tests can call `__rae.getState().addNodes([...])` to build big canvases, and you can profile with CDP `Profiler.*` through `page.context().newCDPSession(page)`. Extend `e2e/smoke.ts` when adding user flows. Use accessible names (`getByRole(..., { name })`); every icon button has a label through `ActionIconButton`.

## Diff snapshots (`snapshot.diff`, lib/diff.ts)
- `normalizeSnapshot` → `applyDiff`: the diff's removed nodes and edges go into the graph as **ghosts**
  (`isGhost`, `edgeChange` via WeakSets/WeakMaps — no extra fields on schema objects); added edges are marked.
- The **diff overlay** (`diffOverlay` in the store, View options) shows changes; off, `LibraryFilter.hideRemoved`
  hides ghosts everywhere (canvas, tree, relations) through `isFiltered` / `drawnGraph` / `isChildEdge`.
  Pass `diffOverlay` to every `relationFilterOf` call.
- Canvas: node data `change` → `data-change` on `.rae-card` / `.rae-frame` + the A/M/D `.rae-change` corner
  badge; edges get `rae-edge--added|removed`. Colours: `diff.{added,changed,removed}.{solid,subtle,fg}` tokens
  (green / amber / red; blue stays selection's).
- A diff opens with `changesToShow` (declarations first, then their files) unless its diagram was saved;
  diagrams are stored per diff (`rae.diagram:<root>@<base>..<head>`).
- Files panel: the Changes view (`ChangesList`, file by file as git lists them, plus elements whose file didn't
  change); the tree marks rows A/M/D and folders holding changes. Details: "In this diff" (`describeChange`
  over `diff.before`; the first 5 changes, then "Show more"; type changes only when both sides have a
  type — the base is compared untyped). Its code-diff button opens `NodeDiffModal`: both versions from
  `GET /api/git/source?path&sha&file` (`git show`, or the working tree; paths must stay in the repo),
  a declaration's lines (loc → endLine) or the whole file (modules, merged files), `lib/lineDiff.ts`
  (prefix/suffix + capped LCS), split or inline (remembered: `rae.codeDiffMode`), unchanged runs folded.
  Toolbar: the `base ← head` chip.
- Scan dialog: `CompareOptions` (shown when the folder is in a git repo): base branch, what to compare
  (the checkout, a branch, or a PR / MR listed on demand by "PRs / MRs"), from the merge-base or the
  base's tip; warns when the checkout is dirty. It sends `diff` with the scan (`ScanSettings.diff`).
  "PRs / MRs" picks the source (Auto — default —, git, GitHub CLI, GitLab CLI; remembered per repo in
  `rae.requestSource:<root>`); listed requests pre-select the newest and set Base to its target branch.
  The toolbar's `DiffChip` shows `#12 title` and an open-on-GitHub/GitLab button (`openRequestPage`).
- Try it: `bun run scan packages/viewer --base <ref> --head <ref> --out <dir>` and a dev server with
  `RAE_SNAPSHOTS=<dir>`; swap base and head (`--against-tip`) for removals to look at.
