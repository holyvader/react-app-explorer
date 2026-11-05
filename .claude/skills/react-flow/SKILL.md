---
name: react-flow
description: Work on the viewer's React Flow (@xyflow/react v12) diagram — canvas, nested frames (folder → file → declarations), ELK layout + local placement/drag/resize rules, custom nodes/edges, parent/child expansion, viewport focus/fit, performance with large graphs. Use when editing packages/viewer/src/components/{Canvas,ConditionEdge}.tsx, components/nodes/* or packages/viewer/src/graph/*.
---

# React Flow in the viewer

## Model
- **Folders and routes are nodes of their own** (added from the file tree / picker / menus), never automatic frames around files: the store keeps `folders: false` and `routes: false` (no toolbar toggles). The frame code paths (`foldersFor`, `routesFor` in drawn.ts) stay for the tests and could come back behind an option. Files are frames around their drawn declarations, and **routes nest the same way, among what's drawn only** (`drawnRouteNesting`): a drawn route sits in its nearest drawn parent route, a drawn route file (page, layout…, or a declaration whose file isn't drawn) in its route. Nothing is added to make a frame.
- The **snapshot graph is the source of truth**. The store (`src/store.ts`) holds `visible: string[]` (ids the user put on the canvas), the derived `graph` (what is drawn) and `placed` (where).
- `graph/drawn.ts` → `drawnGraph()` derives the **containment tree** plus edges:
  - folder frame (`dir:<path>`, optional, toggled by "Folders") → file **module** frame → declarations (component/hook/function/action).
  - Only what the user added is drawn. A declaration sits inside its file module **when that module is on the canvas too**. Otherwise it goes into the nearest drawn folder, or the top level. A module with nothing drawn inside is a plain card.
  - A folder chain that holds only one folder is compressed into one frame (`src/components`). The frame id is the deepest path, so it keeps its place when the chain splits.
  - Containment is never an edge (`declares` is skipped, and so are edges between an element and its own container).
  - The library filter (`graph/packages.ts`) removes 3rd-party externals. `react` and `react-dom` are excluded by default.
- `Canvas.tsx` maps `placed` → React Flow nodes (`type: "frame" | "card"`, `parentId`, fixed `width`/`height`, `dragHandle` = frame header). Local `nodes` state exists only for drag and measurements. It re-syncs with the "adjust state during render" pattern; never call setState inside effects.

## Placement engine
- `graph/layout.ts`: **ELK** layered DOWN with `hierarchyHandling: INCLUDE_CHILDREN`, frames padded (`PADDING`) and sized around their children. Used for the first placement, "Re-layout everything", folder toggling, any change adding more than `LOCAL_LIMIT` (12) elements (direct parents / children: `EXPANSION_LIMIT`, 80), and whenever local placement returns `null`. `gridEdges()` adds hidden edges that wrap a big fan (more than 6 cards: one node's children, or parents, in one container) into rows of `ceil(√n)`, chaining card i → i + columns, so ELK doesn't lay 20 siblings out in one row.
- `graph/placement.ts` (pure, unit-tested in `packages/viewer/test/graph.test.ts`):
  - `placeLocally(prev, graph, anchor, {direction})`: new cards sharing a container go in **together as a grid** (`gridColumns(n) = ceil(√n)`, sorted by name), in the spot one block of that size gets. `direction` "up" / "down" (direct parents / children from `expand`) prefers spots above / below the anchor; candidate spots include centred above / below. Expanding direct parents or children never falls back to a full layout below `EXPANSION_LIMIT`.
  - `placeLocally(prev, graph, anchor)`: what stays keeps its place. New cards go in the nearest free spot beside the anchor, inside their container's room. The container `fit`s (grows, top-left fixed), `pushAround` moves the siblings it now covers, and this cascades up the parents. A container appearing around already-drawn children is drawn around them. Containers that lost children `lift` (close the top gap) and `refit` (shrink).
  - `movedTo(prev, graph, id, point)` on drag stop: the element stays at its own level. Dropped inside a foreign frame (`refusingFrames`), it lands at that frame's nearest free side. Overlapped siblings are `shove`d (cascading), and the parent `refit`s (grows or shrinks).
  - `arrangeWithin` + `layoutWithin`: the frame's "Tidy up inside" action (ELK on that subtree only).
  - Work happens in absolute coordinates and is converted back to container-relative positions at the end. `absoluteRect()` helps with focus and drag origins.
- Interactions: frames drag by their header (`FRAME_HANDLE`) and children move with them. The dragged element is raised (`zIndex`). A frame that would refuse it is marked (`data.refused`, red dashed). Nodes glide with a CSS transform transition, except while dragging.

## Edge lanes
- Several relations between the same two nodes (either direction) run side by side: Canvas groups drawn relations by unordered pair and gives each `data.lane` (px, `EDGE_LANE` 10 apart, centred) and `data.step`. `floatingEdgeParams(source, target, lane)` shifts both ends perpendicular to the centre line (in the lower-id → higher-id direction, so both directions share one set of lanes), then intersects with the borders. Labels stack vertically by `step` (24px), so they never cover each other.

## Relations (`graph/relations.ts`)
- `CHILD_KINDS[nodeKind]` decides which outgoing edge kinds count as children. An edge X→Y is a parent link of Y iff it is a child link of X.
  - module: imports, declares, renders, invokes · component: renders, usesHook, invokes, invokesAction · hook/function/action: invokes, usesHook, invokesAction · external: none
- Every relation query takes a `RelationFilter` (enabled edge groups + library filter): `relationFilterOf(state)`.
- `reachable(…, deep)` is a BFS with a visited set. Expansions above `LARGE_EXPANSION` (300) ask first.

## Nodes and edges are plain HTML/CSS (no Chakra on the canvas)
- `components/nodes/{CardNode,FrameNode,NodeActions}.tsx`, `ConditionEdge.tsx` and `components/canvas.css` render with plain elements and `rae-*` classes. They re-render on every drag frame, and Chakra's runtime styling dropped frames. Colors come from design-system tokens via Chakra CSS variables (`--chakra-colors-kind-server-action-solid`: camelCase becomes kebab-case; see `cssVar()` in Canvas.tsx). The design-system import rule still holds: nothing imports Chakra here.
- Leaf cards (the "Explorer Final" design): flat, 52px high, padding 0 12, a 17px icon in the kind's colour (no tile), name 15/600 (caption 12.5; frame titles 13 mono, chips 11.5), and a caption whose first word is the kind in `kind.*.fg` followed by quiet extras (`.rae-card__extra`: role, async, cached; ` · client` / ` · shared` for top-level files in the boundary colour). Borders only, no shadows except while dragging. States change **instantly** (no transitions on nodes, WebKit rasterises animating layers at 1×): hover = `kind.*.muted` border on `card.bgSelected`; related = 1.5px `selection.related`; selected = 1.5px `selection.solid` + 3px `selection.ring`; faded = a veil of 68% canvas colour (`::after` on `.rae-card` / `.rae-frame` / edge labels; ghosts' contents a `::before` veil), **never `opacity`**: a translucent node gets its own WebKit layer, rasterised at 1× and scaled by the zoom, so the desktop app showed every faded node blurry. Actions sit in an inset group on the right (`.rae-card__actions`, `bg.emphasized`), shown on hover or selection. No `backdrop-filter` on the canvas.
- The kind's shape is in the corners (plain CSS `border-radius` on `.rae-card`): component 8px, hook a pill, function `26px 8px 8px 26px`, server action `10px 2px 10px 2px`, type 3px, library a dashed pill, folder and missing files dashed. Frames: `card.frame` background, 1px `card.border`, radius 8, a 34px header (`PADDING.top` 48) with the file path / route URL / folder name in mono and outlined chips (Next.js role in the route colour, boundary).
- Colours: **blue (hue 240–280) is reserved for selection** (`selection.solid` selected, `selection.related` related, also the selected tree row and the primary action). Every relation has a `relation.*` token shared by its edge, arrow, label, filter swatch and details badge.
- Edges are **floating** (`graph/floating.ts`, after the React Flow floating-edges example): they attach where the line between node centres crosses each border (`useInternalNode`). Handles exist only as hidden anchors. Every edge carries a one-line mono label (11.5px) in its relation colour on a patch of canvas (`lib/relationWords.ts`), the render condition after it in `fg.subtle`. Hover shows specifiers and all condition variants.
- Node actions show only what would add something: ↑ / ↑↑ / ↓ / ↓↓ render only when `data.can.*` says that direction has undrawn nodes (`hasUndrawn` in relations.ts, early-exit BFS). In the context menu they're disabled instead. Remove icons: ✕ removes a node, or a frame with everything inside (`IconRemove`, the same for both), the opened box removes only the file frame and keeps its contents (`IconUnwrap`).
- Node tooltip: one plain-HTML `NodeTooltip` for the whole canvas, shown **600 ms** after `onNodeMouseEnter`. Same language as the details panel (kind icon, kind-coloured caption, mono path, `syntax.*` code boxes, 4px tinted chips), a popover surface (`bg.subtle`, `border.emphasized`, radius 8) that fades in with a 4px rise, **above the node and centred on it** (below when there's no room above). It hides when the view moves (`onMoveStart`). It covers component props, hook names (each once, ×N) and renders; function/hook/action inputs and output; module exports and re-exports; library imported names. It's hidden while dragging or while a menu is open.
- Canvas chrome (React Flow `Panel`s, 12px margins): relation filters top-left (`SegmentedToggles`), zoom column bottom-left, Back / Forward row beside it (`.rae-history`), the shortcut legend after that, the minimap bottom-right. `fitView` pads clear of them (`FIT_PADDING`). The background is a 24px line grid (`canvas.grid`). ReactFlow gets `colorMode` from `useColorMode()`: its root carries `.light`/`.dark`, and a mismatch flips every Chakra token inside the canvas.
- Box selection: **Shift + drag** from empty space (React Flow's default; ⌘/Ctrl + drag draws no box) → a selection box (`useMarquee` in Canvas.tsx, captured before React Flow and the room pan). What it touches joins the selection live, on top of the earlier selection, and the release keeps exactly that (the click that follows a box drag is swallowed, or the pane would clear it); cards count when touched, frames only when wholly inside. React Flow's own selection stays off.
- Cursors (canvas.css): grab on pane, cards, frame headers and rooms; grabbing while dragging or panning; copy while ⌘/Ctrl is held (adds to the selection); not-allowed over a frame that refuses the drop; pointer on buttons; help on edge labels.
- Edges: all relations share the same (bezier) line, 1.5px (2px when related), static. Colour is the first cue, dash the second (`.rae-edge--*` in canvas.css): imports solid (dashed 4 3 when lazy, half opacity when type-only), fetches 6 3, revalidates and invalidates 1 3, route file 3 3, declares 2 3. Unrelated edges fade to 0.18 under a selection.
- Selection belongs to the store only. Every node is `selectable: false` and `elementsSelectable={false}`, because React Flow otherwise flips its internal node's `selected` on click, outside onNodesChange, leaving a stale outline after the app deselects. `onNodesChange` also drops `select` changes. `selected` is passed in from the store, and onNodeClick still fires. A file module's only element is placed automatically (`autoPlaceSoleChildren`: top-left of the room, frame fitted, applied to every placement) and is `draggable: false`. Inside folders everything stays draggable.
- Selection: `select(id, adding)`, with ⌘/Ctrl+click adding to it. Clicking the only selected node again lets go of it, as does clicking the empty pane or a folder's room. The canvas gets `data-selection`, selected nodes `selected`, related nodes (edge ends, containers, contents) `rae-related`, related edges `rae-edge--related` (thicker, **keeping their relation colour**). CSS fades the rest. Edge labels sit above every edge layer (`z-index: 1100`; React Flow lifts edges of selected nodes to 1000+) on an opaque background. Only the involved nodes are re-created.
- Frames (files holding elements, and folders) are selected, dragged and hovered **from their header only**. Their room (`.rae-frame__room`) acts as canvas: drag pans (rAF-throttled, final position from the pointerup), double-click zooms ×2 around the pointer, click clears the selection. Leaf cards select, drag and hover anywhere.
- Folders are selectable nodes (`dir:<path>`, not in the snapshot). `FolderDetails` shows what they contain (`graph/folder.ts`: files, declarations, subfolders, counts per kind). Their actions are ↓ show the files inside and ↓↓ show everything inside (`expandFolder`, which asks above 300), tidy and remove. Header buttons, the context menu and the sidebar all offer them. Folder headers show the scanned-element count; folders have no tooltip. A selected frame highlights everything inside it.
- ⌘A selects every drawn element, folders included. Folders' ↑ / ↑↑ add the parent folder, or
  all folders up to the project root (`parentFolders`, `showParentFolders`).
- **Routes mode** (toolbar Routes toggle, `routes` in the store, on by default): `routesFor` in
  drawn.ts puts each drawn route file (or a declaration in one whose file isn't drawn) inside its
  route frame, and routes inside their parent routes. Single-child chains collapse, like folders.
  Route files leave the folder frames. Removing a route frame takes its contents
  (`nodesUnderRoute`). With Routes off, a route you added is a card linked by `routeFile` /
  `routeChild` edges (in the "Declares" group). Kind `route` is pink; the Navigation group holds
  `navigates` (solid), `fetches` (dashed), `revalidates` (dotted) and `runsBefore` (red,
  middleware → route). Show route chain starts with the route's middleware.
- Cache Components: "◐ Partial" (purple) and "⚠ Blocking" (red, the build would fail) badges.
  "use cache" declarations say `cached 1h` in their caption, and their details have a Cache section
  (variant, cacheLife, tags, invalidated by). `invalidates` edges are in the "Cache" relation group.
- Rendering badges (`renderingLabel`: "○ Static", "● SSG", "ƒ Dynamic", "○ ISR 60s"; `.rae-chip[data-render]`)
  on route cards and frame headers, in route details (with the reasons), the tooltip and picker rows.
- **Show route chain** (card, menu, details) on routes and route files or their declarations
  (`routeOf`). `routeChain` = every enclosing route, root first, with its layout, template, loading,
  error and not-found, then the route's own page (or route.ts) — through `requestAdd`. `can.routeChain`
  hides the action once all of it is drawn.
- Kind `type` (green, square-ish card) and relation `usesType` (group "Types", dotted green).
- Folders can be **added explicitly**: their `dir:<path>` id goes into `visible`, from the picker (the row ticks folder → with the files inside → off) or from quick add (the folder lands at the clicked point). `drawnGraph` draws an explicit folder even when empty, as a dashed folder card (`CardNode` folder branch), and never collapses it into a chain. Removing a folder also removes explicit subfolders. Removing anything else **keeps the drawn folders around it**: `hideNodes` makes them explicit, so a folder left empty stays as a folder card. Folders can add their subfolders, all or one: a "Subfolders" submenu in the context menu and "Add all" or chips in `FolderDetails`.
- Adding:
  - The **picker** (`picker/ExplorationPicker.tsx`) is a popover from the round "+" at the canvas foot, or from Space, ⌘K, toolbar Add, or "Start exploration". It shows the model tree (`graph/tree.ts`, folders → files → declarations, then libraries nested by package: `next` → `link`, `navigation`; a `package` row when the bare package isn't imported itself) under a filter. Rows tick in and out; a file cycles file → with all inside → off. The footer has "N of M drawn", Add all (asks above 300), Clear and Done.
  - **Quick add** (`picker/QuickAdd.tsx`): right-click on the empty canvas opens the tree at that point. A picked element lands there; drawn ones are left out or greyed.
  - The **contains "+"** (`ContainsButton`) on a file's bottom border opens a menu: "Show all N", then each undrawn declaration.
  - The tree (`picker/ElementTree.tsx`) is plain HTML with keyboard support (↓ from the filter, ↑↓ ←→, Enter/Space). Enter in the filter picks the first addable match.
- Esc closes whatever is open (picker, quick add, menu), even from inside it; otherwise it clears the selection.
- Right-click: `onNodeContextMenu` opens the design-system `ContextMenu` with `nodeMenuEntries(id)` (`components/nodeMenu.tsx`). It holds every action plus relation submenus in both directions (Imports/Imported by, Declares/Declared in, Renders/Rendered by, Uses hooks/Hook used by, Invokes/Invoked by), each with "Show all" and the individual targets. Declarations also get "Imports (its file)" and "Imported by", which lists only importers naming that export or importing the module as a namespace. Right-click on the pane opens search anchored at that point.
- Shortcuts (Canvas keydown): Space add, ⌘K search, ⌘/Ctrl+click multi-select, ⌘A select all in sight, Delete/⌫ remove the selection, ⌘Z/⇧⌘Z/Ctrl+Y undo/redo, Esc clear. React Flow's own key bindings are off (`deleteKeyCode`, `selectionKeyCode`, `multiSelectionKeyCode`, `panActivationKeyCode` = null). The legend is in the bottom-left corner (`ShortcutLegend`). Pressing on the canvas takes focus from fields, so the shortcuts apply.

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
- Expansion: `addNodes(ids, { fit: true, anchor: id })` → `fitView({ nodes })` (`fitTo` narrows it).
- Show parents (direct): the view goes to what was added — one new parent is selected and centred
  (`focus`), several are fitted (`fitTo`: only the new ones).

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
