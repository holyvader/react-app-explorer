---
name: react-flow
description: Work on the viewer's React Flow (@xyflow/react v12) diagram — canvas, nested frames (folder → file → declarations), ELK layout + noesis-style local placement/drag/resize rules, custom nodes/edges, parent/child expansion, viewport focus/fit, performance with large graphs. Use when editing packages/viewer/src/components/{Canvas,ConditionEdge}.tsx, components/nodes/* or packages/viewer/src/graph/*.
---

# React Flow in the viewer

## Model
- The **snapshot graph is the source of truth**. The store (`src/store.ts`) holds `visible: string[]` (ids the user put on the canvas), the derived `graph` (what is drawn) and `placed` (where).
- `graph/drawn.ts` → `drawnGraph()` derives the **containment tree** plus edges:
  - folder frame (`dir:<path>`, optional, toggled by "Folders") → file **module** frame → declarations (component/hook/function/action).
  - Only what the user added is drawn. A declaration sits inside its file module **when that module is on the canvas too**. Otherwise it goes into the nearest drawn folder, or the top level. A module with nothing drawn inside is a plain card.
  - A folder chain that holds only one folder is compressed into one frame (`src/components`). The frame id is the deepest path, so it keeps its place when the chain splits.
  - Containment is never an edge (`declares` is skipped, and so are edges between an element and its own container).
  - The library filter (`graph/packages.ts`) removes 3rd-party externals. `react` and `react-dom` are excluded by default.
- `Canvas.tsx` maps `placed` → React Flow nodes (`type: "frame" | "card"`, `parentId`, fixed `width`/`height`, `dragHandle` = frame header). Local `nodes` state exists only for drag and measurements. It re-syncs with the "adjust state during render" pattern; never call setState inside effects.

## Placement engine (after noesis' system model explorer)
- `graph/layout.ts`: **ELK** layered DOWN with `hierarchyHandling: INCLUDE_CHILDREN`, frames padded (`PADDING`) and sized around their children. Used for the first placement, "Re-layout everything", folder toggling, any change adding more than `LOCAL_LIMIT` (12) elements, and whenever local placement returns `null`.
- `graph/placement.ts` (pure, unit-tested in `packages/viewer/test/graph.test.ts`):
  - `placeLocally(prev, graph, anchor)`: what stays keeps its place. New cards go in the nearest free spot beside the anchor, inside their container's room. The container `fit`s (grows, top-left fixed), `pushAround` moves the siblings it now covers, and this cascades up the parents. A container appearing around already-drawn children is drawn around them. Containers that lost children `lift` (close the top gap) and `refit` (shrink).
  - `movedTo(prev, graph, id, point)` on drag stop: the element stays at its own level. Dropped inside a foreign frame (`refusingFrames`), it lands at that frame's nearest free side. Overlapped siblings are `shove`d (cascading), and the parent `refit`s (grows or shrinks).
  - `arrangeWithin` + `layoutWithin`: the frame's "Tidy up inside" action (ELK on that subtree only).
  - Work happens in absolute coordinates and is converted back to container-relative positions at the end. `absoluteRect()` helps with focus and drag origins.
- Interactions: frames drag by their header (`FRAME_HANDLE`) and children move with them. The dragged element is raised (`zIndex`). A frame that would refuse it is marked (`data.refused`, red dashed). Nodes glide with a CSS transform transition, except while dragging.

## Relations (`graph/relations.ts`)
- `CHILD_KINDS[nodeKind]` decides which outgoing edge kinds count as children. An edge X→Y is a parent link of Y iff it is a child link of X.
  - module: imports, declares, renders, invokes · component: renders, usesHook, invokes, invokesAction · hook/function/action: invokes, usesHook, invokesAction · external: none
- Every relation query takes a `RelationFilter` (enabled edge groups + library filter): `relationFilterOf(state)`.
- `reachable(…, deep)` is a BFS with a visited set. Expansions above `LARGE_EXPANSION` (300) ask first.

## Nodes and edges are plain HTML/CSS (no Chakra on the canvas)
- `components/nodes/{CardNode,FrameNode,NodeActions}.tsx`, `ConditionEdge.tsx` and `components/canvas.css` render with plain elements and `rae-*` classes. They re-render on every drag frame, and Chakra's runtime styling dropped frames. Colors come from design-system tokens via Chakra CSS variables (`--chakra-colors-kind-server-action-solid`: camelCase becomes kebab-case; see `cssVar()` in Canvas.tsx). The design-system import rule still holds: nothing imports Chakra here.
- Leaf cards: gradient icon tile, name, quiet caption (kind · role · async), and a boundary pill. Actions float in as a toolbar on hover or selection (`.rae-card__actions`), replacing the pill. The fill is a tinted glass gradient with a soft top sheen. Hover is a subtle outline plus wash in the node's own colour (`.rae-card__hover`, a separate filter-free SVG; frames use `.rae-frame::after`; folders react only when their top bar, the drag handle, is hovered, via `:has(> .rae-frame__header:hover)`), faded in by **opacity only**. **Never recolour cards or animate filters on hover, and no `backdrop-filter` on the canvas:** it read as blinking while the pointer crossed the diagram, and backdrop blur re-samples the animated edges every frame.
- Shapes per kind are SVG (`nodes/CardShape.tsx`, path from the card's width and height): component = rounded rect, hook = hexagon, function = solid pill, server action = arrow, module card = folded sheet, library = dashed pill. Each is a stroked outline plus a **translucent fill**, so frames and edges behind show through. Elevation grows with nesting depth: Canvas sets `--depth` on every node, and cards get a `drop-shadow` while frames get layered box-shadows that scale with it. The diagram reads in layers: folder → file → element. Don't use clip-path border layers: the border colour bleeds through translucent fills. Frames are file modules (solid) and folders (dashed with a tab), also translucent with soft shadows.
- Colours: **blue is reserved for selection** (selected = blue-500, related = blue-300). Components and their renders relation are #429cb5 (custom `component` palette in the theme), imports edges dark grey (`relation.imports`), libraries yellow.
- Edges are **floating** (`graph/floating.ts`, after the React Flow floating-edges example): they attach where the line between node centres crosses each border (`useInternalNode`). Handles exist only as hidden anchors. Every edge carries a label pill with the relation word in its colour (`lib/relationWords.ts`), plus render conditions when present. Hover shows specifiers and all condition variants.
- Node actions show only what would add something: ↑ / ↑↑ / ↓ / ↓↓ render only when `data.can.*` says that direction has undrawn nodes (`hasUndrawn` in relations.ts, early-exit BFS). In the context menu they're disabled instead. Remove icons: ✕ removes a node (`IconRemove`), trash removes a frame with everything inside (`IconRemoveWithContents`), the opened box removes only the file frame and keeps its contents (`IconUnwrap`).
- Node tooltip: one plain-HTML `NodeTooltip` for the whole canvas, shown **600 ms** after `onNodeMouseEnter`. It uses the same visual language as the sidebar (kind tile, caption, path box, `syntax.*` token colours, tinted chips, kind-coloured accent line, arrow), **above the node and centred on it** (below when there's no room above). It hides when the view moves (`onMoveStart`). It covers component props, hook names (each once, ×N) and renders; function/hook/action inputs and output; module exports and re-exports; library imported names. It's hidden while dragging or while a menu is open.
- Cursors (canvas.css, end of file): grab on pane, cards, frame headers and rooms; grabbing while dragging or panning; copy while ⌘/Ctrl is held (adds to the selection); not-allowed over a frame that refuses the drop; pointer on buttons; help on edge labels.
- Edges: all relations share the same (bezier) line; each has its own colour, dash pattern and animation speed (`.rae-edge--imports|imports-lazy|imports-type|renders|usesHook|invokes|invokesAction`, CSS `stroke-dashoffset` keyframes). Animations pause while dragging (`[data-dragging]`) and honour `prefers-reduced-motion`.
- Selection belongs to the store only. Every node is `selectable: false` and `elementsSelectable={false}`, because React Flow otherwise flips its internal node's `selected` on click, outside onNodesChange, leaving a stale outline after the app deselects. `onNodesChange` also drops `select` changes. `selected` is passed in from the store, and onNodeClick still fires. A file module's only element is placed automatically (`autoPlaceSoleChildren`: top-left of the room, frame fitted, applied to every placement) and is `draggable: false`. Inside folders everything stays draggable.
- Selection: `select(id, adding)`, with ⌘/Ctrl+click adding to it. Clicking the only selected node again lets go of it (noesis), as does clicking the empty pane or a folder's room. The canvas gets `data-selection`, selected nodes `selected`, related nodes (edge ends, containers, contents) `rae-related`, related edges `rae-edge--related` (thicker, **keeping their relation colour**). CSS fades the rest. Edge labels sit above every edge layer (`z-index: 1100`; React Flow lifts edges of selected nodes to 1000+) on an opaque background. Only the involved nodes are re-created.
- Frames (files holding elements, and folders) are selected, dragged and hovered **from their header only**. Their room (`.rae-frame__room`) acts as canvas, after noesis: drag pans (rAF-throttled, final position from the pointerup), double-click zooms ×2 around the pointer, click clears the selection. Leaf cards select, drag and hover anywhere.
- Folders are selectable nodes (`dir:<path>`, not in the snapshot). `FolderDetails` shows what they contain (`graph/folder.ts`: files, declarations, subfolders, counts per kind). Their actions are ↓ show the files inside and ↓↓ show everything inside (`expandFolder`, which asks above 300), tidy and remove. Header buttons, the context menu and the sidebar all offer them. Folder headers show the scanned-element count; folders have no tooltip. A selected frame highlights everything inside it.
- Adding, as in noesis:
  - The **picker** (`picker/ExplorationPicker.tsx`) is a popover from the round "+" at the canvas foot, or from Space, ⌘K, toolbar Add, or "Start exploration". It shows the model tree (`graph/tree.ts`, folders → files → declarations, then libraries) under a filter. Rows tick in and out; a file cycles file → with all inside → off. The footer has "N of M drawn", Add all (asks above 300), Clear and Done.
  - **Quick add** (`picker/QuickAdd.tsx`): right-click on the empty canvas opens the tree at that point. A picked element lands there; drawn ones are left out or greyed.
  - The **contains "+"** (`ContainsButton`) on a file's bottom border opens a menu: "Show all N", then each undrawn declaration.
  - The tree (`picker/ElementTree.tsx`) is plain HTML with keyboard support (↓ from the filter, ↑↓ ←→, Enter/Space). Enter in the filter picks the first addable match.
- Esc closes whatever is open (picker, quick add, menu), even from inside it; otherwise it clears the selection.
- Right-click: `onNodeContextMenu` opens the design-system `ContextMenu` with `nodeMenuEntries(id)` (`components/nodeMenu.tsx`). It holds every action plus relation submenus in both directions (Imports/Imported by, Declares/Declared in, Renders/Rendered by, Uses hooks/Hook used by, Invokes/Invoked by), each with "Show all" and the individual targets. Declarations also get "Imports (its file)" and "Imported by", which lists only importers naming that export or importing the module as a namespace. Right-click on the pane opens search anchored at that point.
- Shortcuts (Canvas keydown, noesis set): Space add, ⌘K search, ⌘/Ctrl+click multi-select, ⌘A select all in sight, Delete/⌫ remove the selection, ⌘Z/⇧⌘Z/Ctrl+Y undo/redo, Esc clear. React Flow's own key bindings are off (`deleteKeyCode`, `selectionKeyCode`, `multiSelectionKeyCode`, `panActivationKeyCode` = null). The legend is in the bottom-left corner (`ShortcutLegend`). Pressing on the canvas takes focus from fields, so the shortcuts apply.

## Editing model
- The diagram is read-only as a graph: `nodesConnectable={false}`, hidden non-interactive handles (`HIDDEN_HANDLE`), `deleteKeyCode={null}`. The app handles Delete/Backspace (removes the selection) in `App.tsx`.
- Every diagram change (`addNodes`, `hideNode`, `clear`, `dropAt`, `arrange`, `relayout`) calls `record()` first. It pushes `{visible, placed, selectedId}` onto `past` (max 100) and clears `future`. `undo`/`redo` (⌘Z / ⇧⌘Z / Ctrl+Y, toolbar) `restore()` a step: the stored positions are reconciled with `placeLocally(…, null)`, falling back to ELK.
- The current diagram is stored per project (`rae.diagram:<rootDir>` in localStorage, debounced subscription) and restored in `setSnapshot`. The last opened snapshot is remembered (`rae.lastSnapshot`).

## Performance rules (measured on a 300-node canvas)
- Node objects must keep their identity when their source didn't change. The sync step in `Canvas.tsx` reuses the local node (with React Flow's `measured`). Replacing all nodes makes React Flow re-measure everything and re-render every card (selection went from ~500 ms to ~30 ms after this fix).
- Selection is applied on top of the memoized `derived` nodes (`selectedNodes`). Don't put `selectedId` into `derived`.
- No component-library components inside nodes or edges: plain HTML + `canvas.css`, native `title` tooltips. Measured: 0 dropped frames dragging cards or frames and panning, with 355 elements placed (212 rendered).
- `drawnGraph(…, index)` walks only the drawn nodes' edges, never all snapshot edges.
- Viewport changes right after adding many nodes go through `whenReady()`, because React Flow's lookup can lag a frame and `fitView` would silently do nothing.
- Dev builds expose the store as `window.__rae` for headless profiling (see the frontend skill).

## Viewport
- Single add (search, links): `addNodes(ids, { focus, anchor })` → `setCenter` once placed. Search anchors at the viewport centre; sidebar links anchor at the selected node.
- Expansion: `addNodes(ids, { fit: true, anchor: id })` → `fitView({ nodes })`.

## Conventions
- Define `nodeTypes` and `edgeTypes` at **module scope** and wrap node components in `memo`.
- Card/frame sizes come from `widthOf`/`frameWidthOf`/`CARD_HEIGHT`/`PADDING`. If node content grows, update those so ELK and the placement agree.
- Interactive elements inside nodes need `className="nodrag nopan"` and `stopPropagation` (see `NodeActions`).
- Colors come from design-system tokens through CSS vars (`cssVar("kind.component.solid")`).
- Keep `onlyRenderVisibleElements` on. Leave the React Flow attribution visible.

## Adding a node kind / edge kind / container level
1. Schema + scanner (see the scanner skill).
2. `KIND_META` (`src/lib/kinds.tsx`) icon/label, plus a `kind.<name>` token in `packages/design-system/src/theme.ts`.
3. Edges: `EDGE_GROUP_OF`, `EDGE_GROUPS`, `CHILD_KINDS`, `EDGE_STYLE`.
4. New container level: give elements a `parent` in `drawnGraph()`. ELK and the placement engine handle any depth.

## Verify
`bun test packages/viewer/test` (engine), `bun --cwd packages/viewer e2e` (see the frontend skill), and `tsc -p packages/viewer --noEmit`.
