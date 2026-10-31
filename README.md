# React App Explorer

Static analysis + interactive diagram for React / Next.js codebases.

- **`packages/scanner`**: a Bun CLI. It uses oxc (Rust) for parsing and resolution and TypeScript 7 (Go, `tsgo`) for types. It scans a folder or an entry file and records:
  - server and client components, server actions, hooks and functions
  - static, lazy and `next/dynamic` imports
  - the JSX render tree, including native elements, with the conditions each element needs to render
  - props, signatures, hooks with their return types, and file locations
  
  Output is a timestamped JSON snapshot.
- **`packages/viewer`**: Vite + React Flow app. The canvas starts empty. Use **Add** (⌘K) to search for any scanned node, then expand parents or children step by step or all the way to the root or leaves.
  - Elements are nested: folder frames contain file modules, and file modules contain their components, hooks and functions.
  - Layout uses ELK. Local placement and drag rules follow the noesis system model explorer: frames grow, shrink and push neighbours aside.
  - 3rd-party libraries can be filtered out. React is hidden by default.
  - Relations include imports, renders, hooks and **invokes** (calls, `new`, handler references, module-level calls; server actions are highlighted).
  - Each element kind has its own shape, and each relation its own animated line style. Clicking selects (blue) and highlights related elements; ⌘-click adds to the selection. Right-click opens every action plus relation submenus (imports / imported by, renders / rendered by, …). Dragging inside a frame pans. Keyboard shortcuts follow the noesis explorer (see the legend on the canvas).
  - Undo/redo (⌘Z / ⇧⌘Z). Delete removes the selected element. The current diagram is stored per project and comes back on reload. The graph itself is read-only: nodes can't be connected by hand.
  - The sidebar shows details and an "Open in editor" link. You can also **Scan…** a project straight from the UI.
- **`packages/design-system`**: Chakra UI v3 wrapper, the only place Chakra is imported.
- **`packages/schema`**: snapshot types shared by the scanner and the viewer.

## Usage

```bash
bun install
bun run scan /path/to/app            # or an entry file: /path/to/app/src/main.tsx
RAE_SNAPSHOTS=/path/to/app/.explorer/snapshots bun run dev
```

Scanner options: `--no-types` (oxc-only, fastest), `--no-cache`, `--out <dir>`, `--tsconfig <path>`, `--include/--exclude <glob>`, `--stats`.
Snapshots live in `<root>/.explorer/snapshots/<timestamp>.json`, and `index.json` keeps the history. The incremental cache lives in `<root>/.explorer/cache`.

Performance (shadcn/ui `apps/v4`, 3.6k files, M-series Mac): about 0.6s without types, about 1.7s with types, a few ms for a warm rescan.

## Development

```bash
bun run test                   # scanner fixtures + viewer placement engine
bun run typecheck              # tsc = TypeScript 7
bun run lint                   # oxlint (enforces the design-system import rule)
bun --cwd packages/viewer e2e  # headless smoke test (see .claude/skills/frontend)
```

Project skills for Claude Code are in `.claude/skills` (scanner, react-flow, frontend, design-system).
