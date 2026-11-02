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
src/components/picker/  noesis-style adding: ExplorationPicker (tree picker), QuickAdd (right-click), ElementTree
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
- Read with granular selectors: `useExplorer((s) => s.visible)`. Never select the whole store.
- Call actions via `useExplorer.getState().action` (stable, no re-render), or select them individually.
- Keep derived data in `useMemo` near its use (e.g. the picker tree, relations). Store only the minimal state.
- No `setState` in effects. Derive during render, or update from the event handler.

## Data
- 3rd-party filter: `excluded` packages (default `react`, `react-dom`) and `hideAllLibraries` live in the store and persist in localStorage. Anything listing nodes or relations must respect it: use `relationFilterOf(state)` or `isFiltered(node, …)`.
- Types come from `@rae/schema`. The snapshot is read-only in the UI.
- Conditions are displayed through `formatCondition`/`summarize` (`src/lib/conditions.ts`). Early-return and ternary-false conditions are negated for display ("rendered when …").
- "Open in editor" goes through `editorUrl` (`src/lib/editor.ts`): IntelliJ/WebStorm `idea://`/`webstorm://`, VS Code/Cursor `vscode://file`. The choice persists in localStorage.

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
