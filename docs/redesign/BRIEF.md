# React App Explorer: redesign brief

This brief is for a designer (Claude Design) doing a complete redesign of React App Explorer. It covers what the app does, every screen and state as it looks today, the visual language, what must not change, the technical limits, and what to deliver.

Everything listed here is in this folder:

| File | What it is |
|---|---|
| `BRIEF.md` | This brief |
| `screens/01…25-*.png` | Every screen and state, 1440 × 900 at 2×, captured from the running app with real data |
| `sample-snapshot.json` | The data behind the screenshots: a scan of a Next.js 16 demo shop (145 nodes, 330 relations) |
| `../../packages/design-system/src/theme.ts` | Today's tokens: colours, fonts, radii, shadows |
| `../../packages/viewer/src/components/canvas.css` | Today's diagram styling (cards, frames, edges, tooltip) |
| `../../packages/desktop/icon.svg` | Today's logo and app-icon artwork |

To re-capture the screenshots after changes, run `packages/viewer/e2e/capture-states.ts`. How to run it is at the top of that file.

**One file for Claude Design:** `react-app-explorer-redesign.pdf` has all of this in one document: the brief, the 25 screens full width, and appendices with the tokens, the diagram CSS, the logo and sample data. To rebuild it, run `packages/viewer/e2e/brief-pdf.ts`.

---

## 1. The product

**React App Explorer** maps a React or Next.js codebase as an interactive diagram. A scanner reads the source, using oxc to parse it and TypeScript 7 for types. It writes a *snapshot*: every file, component, hook, function, server action, TypeScript type and Next.js route, and how they relate. The viewer lets you explore that snapshot one step at a time:
- add an element;
- expand its parents or children;
- read its props, types, render tree and caching;
- open the source in your editor.

- **Who uses it:** front-end developers and tech leads who want to understand a large or unfamiliar app. They are technical and keyboard-friendly, and they keep the app open next to their editor.
- **Where it runs:**
  - As a **web app** in Chrome, served by Vite.
  - As a **desktop app** (Tauri, macOS first). It shows the same UI in WebKit (Safari's engine), with no browser toolbar.
  - Both must look and behave the same. See §7.
- **How a session goes:**
  1. Scan a project (or pick an earlier snapshot).
  2. The diagram starts empty: add an element from the file tree or the picker.
  3. Grow the diagram along relations (↑ parents, ↓ children, right-click menus).
  4. Read the details on the right; jump to the code.
  5. Come back later: the diagram, selection and settings are kept.

## 2. The model: what appears on screen

### Node kinds (each has its own colour and icon; the colours carry meaning)

| Kind | Meaning | Colour today | Icon (lucide) |
|---|---|---|---|
| `module` | A source file | gray | Box |
| `component` | React component | **#429cb5** (custom teal, "component" palette) | CodeXml `</>` |
| `hook` | React hook | purple | Anchor |
| `serverAction` | `"use server"` function | orange | Zap |
| `function` | Plain function | teal | FunctionSquare |
| `type` | TypeScript type / interface | green | Braces `{}` |
| `route` | Next.js App Router route | pink | Signpost |
| `external` | npm package (library) | yellow | Package |
| folder | A folder (added explicitly; not a scanned kind) | neutral | Folder |

Extra states on a node:
- **Boundary:** `server`, `client` or `shared` chip (gray, cyan and pink).
- **Next.js role:** page, layout, loading, error, route, middleware…
- **Flags:** `async`, missing file (a broken import), asset (CSS or images; hidden by default).
- **Routes:** rendering badges ◯ Static, ◐ Partial, ƒ Dynamic, ⚠ Blocking, with revalidate times. The reasons appear in the details.
- **Cached** (`"use cache"`): "cached 1h" in the caption.

### Relations (edges): each has a colour, a word, and sometimes a dash

| Relation | Word on the edge | Colour today |
|---|---|---|
| imports | "imports" (dashed: lazy or dynamic import; muted: type-only) | dark gray |
| declares | "declares" (a file → what's in it) | gray |
| renders | "renders" (can carry *conditions*, e.g. `when user && isAdmin`) | component teal |
| usesHook | "uses hook" | purple |
| invokes / invokesAction | "invokes" / "server action" | teal / orange |
| usesType | "uses type" | green |
| navigates | "links to" (Link, router.push, redirect) | pink |
| fetches | "calls API" | cyan |
| revalidates / invalidates | "revalidates" / "invalidates" | gray / purple |
| routeFile / routeChild | "route file" / "nested route" | light pink |
| runsBefore | "runs before" (middleware → route) | red |

Several relations between the same two nodes are drawn side by side in *lanes*, with their labels stacked one under another.

### Containment
A **file** that has elements drawn inside it is a **frame** around them: header, chips and actions on top, cards inside. Folders and routes are separate nodes, never automatic frames.

## 3. Screens and states (see `screens/`)

| # | Screen / state | Notes |
|---|---|---|
| 01 | Welcome: no snapshot | Brand, one call to action (Scan a project) |
| 02 | Snapshot loaded, empty diagram | "Empty diagram" prompt, the file tree, the round + button |
| 03 | A component selected | The app's main state: card in its file frame, children, edges with labels, details panel |
| 04 | Node tooltip on hover | Props, hooks, types; shows after 600 ms |
| 05 | Right-click menu on a node | Actions, then "Relations" submenus listing related elements |
| 06 | Add picker (Space / ⌘K / +) | Tree with checkboxes, filter, "Add all", "Done" |
| 07 | Quick add (right-click on empty canvas) | Adds at that point |
| 08 | Details: hook | Inputs & output, uses / used by |
| 09 | Details: TypeScript type | Generics, definition (code), uses |
| 10 | Details: Next.js route | URL, params, rendering badge and reasons, files |
| 11 | Details: server action | |
| 12 | Details: file (frame) | Exports, imports |
| 13 | Details: library | |
| 14 | Details: folder, picked in the file tree | Not on the diagram: "Add to diagram" comes first |
| 15 | Route chain (layouts → page) with navigation | Pink route cards, files, "links to" |
| 16 | Direct children placed as a grid | Placement behaviour; the look of a dense diagram |
| 17 | Scan dialog | Folder browser, path input, types on/off |
| 18 | Scan progress | Floating card: files scanned, then types, with Cancel |
| 19 | Snapshots dialog | Grouped by scanned folder; delete |
| 20 | Libraries dialog | Which npm packages are hidden |
| 21 | Keyboard shortcuts legend | Bottom-left, expandable |
| 22 | Both side panels minimized | File tree and details folded to strips (animated) |
| 23 | Confirm a large expansion | "Add 140 elements?" |
| 24 | Notice (toast) | e.g. the editor couldn't open |
| 25 | A big diagram (60 elements) | Stress test for legibility |

**States not captured, but they need designs too:**
- Hover, focus-visible, pressed and disabled for every control. Selected versus *related* (highlighted) versus faded nodes: when something is selected, everything unrelated fades to 32%.
- Dragging a node (frames grow and push neighbours). Dragging the panel resize handles.
- Scan **failed**, **cancelled**, "diagram ready **without types**" (with message), loading a snapshot (spinner).
- A file-tree filter with no matches. A long tree that's cut off ("refine the filter").
- Edge **conditions** (`when …`) and "+N variants" labels. Dashed and animated edges for lazy imports.
- A missing file (broken import) node. Asset nodes (when shown).
- Desktop app: the loading screen while the local server starts, and the failure page when it can't start (`packages/desktop/loading/index.html`).
- The toolbar on narrow windows (1280 px): the relation filters scroll sideways and fade at their end.
- Dark mode: dark values exist for most tokens but have never been designed. This is a decision to make (§9).

## 4. Layout and interaction model (today)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [mark] [project name · path | snapshot ▾ | scan · snapshots · load] │ relation filters │ view │ history │ [+ Add] │
├────────────┬───────────────────────────────────────────────┬─────────────────┤
│ FILES      │                 canvas (diagram)              │ details panel   │
│ filter     │                                               │ (selected or    │
│ tree +     │  zoom · fit · ← →        (+)         minimap  │  inspected      │
│ (+ to add) │  keyboard shortcuts                           │  element)       │
└────────────┴───────────────────────────────────────────────┴─────────────────┘
```
- **Shell:** the panels float on a grey backdrop with 8 px gaps (14 px radius, soft shadow).
  - **File tree** (left): resizable 200–560 px; folds to a 44 px strip.
  - **Details** (right): resizable, 440 px by default; minimizes to a strip showing the element's icon and name.
  - **Canvas:** fills the middle.
- **Toolbar groups,** left to right:
  - brand;
  - **workspace** (project and snapshot, scan, manage snapshots, load file);
  - **relation filters** (8 colour-dot toggles);
  - **view** (assets, libraries filter, editor choice);
  - **history** (undo, redo, re-layout, clear);
  - **primary:** + Add.
- **Canvas controls:** zoom in/out, fit, Back/Forward (selection history), the minimap, the round "+" add button, and the keyboard shortcuts legend.
- **Per-node actions** (appear on hover or selection): ↑ parents, ⇈ up to root, ↓ children, ⇊ down to leaves, × remove. Frames add: arrange, unwrap and remove-with-contents.
- **Keyboard:**
  - Space / ⌘K: add.
  - ⌘A: select all.
  - Delete: remove.
  - ⌘Z / ⇧⌘Z: undo / redo.
  - Esc: clear the selection.
  - ⌘[ / ⌘]: back / forward.
- **Persistence:** the diagram per project, the selection, panel widths and open states, filters, editor choice.

## 5. Visual language today (starting point, not a constraint)
- **Type:** Inter Variable (UI) and JetBrains Mono Variable (code), both bundled.
- **Radii:** 6 / 8 / 12 px, and 14 px for panels.
- **Colour:** cool greys for the shell (`#ECEFF3`); white surfaces; a near-white canvas with a dot grid.
- **Cards:** "glass" cards with a light tint of the kind colour from the top-left corner, a gradient icon tile per kind, and a thin border that turns blue when selected. Each kind has its own card shape: hooks are hexagons, external libraries have a dashed outline, files have a folded corner.
- **Brand:** the mark shows a component (teal square), a hook (violet circle) and a server action (amber tile) linked to the explored node, on a deep teal-to-ink tile. Feel free to rework it.
- **Selection is the only use of blue.**

## 6. What must stay (product rules)
1. **The kind colours and relation colours encode meaning.** The same colour must be used for a kind's card, its tree icon, its details tile and its chips, and for a relation's edge, label, toolbar dot and details badge. Refine the palette freely, but keep it one colour per kind and one per relation, and keep them telling apart for colour-blind users (consider a second cue: icon or shape).
2. **Selection stays unambiguous:** one accent colour is reserved for selected and related elements.
3. **Dense diagrams must stay readable:** 50–300 nodes, long names, many labels.
4. **Code is code:** monospace and syntax colours for types, props and paths (name, type, literal, keyword, punctuation).
5. **Accessible:** every icon button has a label and tooltip, there are visible focus rings, it works with the keyboard, and text contrast is at least 4.5:1.

## 7. Technical constraints the design must respect
- **Two engines:** Chrome (web) and WebKit (desktop). In WebKit, animating `opacity`, `transform` or `filter` on diagram nodes makes them blurry under zoom while the animation runs, so **node hover and selection changes must not depend on those transitions**; instant changes are fine. Panel and dialog animations are fine. `backdrop-filter` works but is costly over the canvas.
- **The desktop app has no browser UI:** no Back button, address bar or `alert()`. Anything users need must be in the app (the ← → buttons exist for this reason).
- **Performance:**
  - Diagram nodes and edges are plain HTML, CSS and SVG, re-rendered while panning and zooming with hundreds on screen. No heavy shadows per node, no blur per node, no web fonts besides the two bundled ones.
  - The chrome (toolbar, panels, dialogs) uses Chakra UI v3 through `@rae/design-system`, the only package allowed to import Chakra or icons.
- **Window sizes:** 1280–2560 px wide, and it must work at 1280 × 800. The toolbar currently drops labels to icons below 2080 px.
- **Icons:** lucide (any icon from the set). Custom SVG is fine for the brand and for kind glyphs.
- **Tokens:** they become Chakra semantic tokens (light and dark), e.g. `kind.hook.solid / subtle / muted / fg`, `relation.renders`, `syntax.type`, `shell.bg`. Keep the token structure, or propose a better one, mapped one to one.

## 8. What to deliver
1. **Direction:** two or three visual directions (moodboard and one hero screen each, state 03), before going wide.
2. **Design system:**
   - colour tokens, light and dark (neutrals, accent or selection, the 8 kind colours with solid, subtle, muted and fg, 12+ relation colours, boundary chips, syntax);
   - type scale; spacing scale; radii; shadows or elevation;
   - focus and interaction states;
   - motion (durations and easing; which elements may animate, given §7).
3. **Components** (with states):
   - toolbar groups and controls;
   - segmented toggles; select; icon buttons; buttons; chips (kind, boundary, tag, relation);
   - panel and panel header and sections; the panel strip (minimized);
   - tree rows (file tree and picker, with ticks); context menu with submenus;
   - modal; tooltip; toast; progress card; empty state;
   - code rows, inline types and type links.
4. **Diagram spec:**
   - a card for each kind (default, hover, selected, related, faded, dragging), including the route rendering badges and "cached" captions;
   - the file frame (header and room);
   - folder and route cards;
   - edges for each relation: stroke, dash, arrowheads, labels, condition labels, lanes;
   - the minimap; the canvas background; the node action toolbar.
5. **Screens:** every state in §3, including the states not captured, at 1440 × 900, plus the toolbar at 1280 and 1920.
6. **Brand:** a refined mark, the macOS app icon (1024 artwork on Apple's icon grid), favicon, and the desktop loading and failure screens.
7. **Hand-off format:** tokens as JSON or TS (Chakra-compatible names), component specs with sizes, and if possible HTML/React prototypes of the shell and of a card and an edge, so they can be built faithfully.

## 9. Open questions (for the owner, before or during the design)
- Dark mode: in scope? (Recommended: yes, designed together with light mode.)
- Is the toolbar too busy? Ideas welcome: move the relation filters onto the canvas, fold them into a menu on narrow windows, or add a command palette.
- Should the details panel get tabs (Overview · Relations · Code) instead of one long scroll?
- Does the product name "React App Explorer" stay?

## 10. Implementation plan (after the designs)
1. Tokens and theme (`packages/design-system/src/theme.ts`): colours, type, radii, shadows, light and dark.
2. Design-system components: restyle the existing ones, add any new ones (only this package touches Chakra).
3. The shell and toolbar (`App.tsx`, `Toolbar.tsx`, `Panel`), the file tree, the details panel.
4. The diagram (`canvas.css`, `CardShape`, `CardNode`, `FrameNode`, `ConditionEdge`, the tooltip). Measure on a 300-node canvas.
5. Brand assets: `icon.svg` → `bunx tauri icon`, favicon, loading page.
6. Check each step in both engines (Chromium on the dev server, WebKit against the desktop server) and with `capture-states.ts`; compare against the designs.
