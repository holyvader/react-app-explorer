---
name: design-system
description: Build or change UI components in @rae/design-system (Chakra UI v3 wrapper; the ONLY place allowed to import Chakra, Emotion or lucide icons), its theme tokens (node-kind and server/client boundary colors) and icons. Use whenever the viewer needs a UI element that doesn't exist yet, or when styling/theming changes.
---

# Design system (`packages/design-system`)

**Hard rule:** `@chakra-ui/react`, `@emotion/*` and `lucide-react` are imported **only** inside `packages/design-system`. Apps import from `@rae/design-system` and `@rae/design-system/icons`. The viewer's lint (`no-restricted-imports`) enforces this.

## Structure
```
src/index.ts          public API, the only entry apps use
src/primitives.ts     curated Chakra re-exports (Box, Flex, Stack, Text, Button, Badge, Code, Kbd, Link, …)
src/theme.ts          createSystem(defaultConfig, config): fonts + semantic tokens
src/provider.tsx      DesignSystemProvider (wrap the app root once)
src/colorMode.ts      dark / light: useColorMode, setColorMode, applyStoredColorMode
src/icons.ts          curated lucide icons, renamed Icon<Name> (IconPlus, IconComponent…)
src/components/       composed components: Modal, Tooltip, ActionIconButton, SearchInput, Select,
                      Panel/PanelBar/PanelHeader/PanelSection, EmptyState, PropertyList, DataTable, KindChip/BoundaryChip/CodeChip,
                      Switch, Checkbox, Alert, ContextMenu (point-anchored, nested submenus),
                      ShortcutLegend, Popover (anchored to a trigger or a point),
                      KindTile (a node kind's icon in its colour), CodeToken, TagChip (4px tinted chip,
                      a <span> unless clickable), Eyebrow, SegmentedToggles, ToolGroup
src/tokens.ts         tokenVar(token) → CSS variable of any colour token
```

## Brand & shell ("Explorer Final" in Claude Design: Graphite dark, Paper light)
- **BrandMark** (`components/BrandMark.tsx`): two chevrons around the explored node, one colour only (`currentColor`, `fg` by default; never recolour the dot). 96 grid drawn edge to edge; `tile` draws it on the app-icon tile (rounded square, mark at 58%). Used in the toolbar (22px + "Explorer" 13/600) and the welcome empty state. The same artwork is `packages/viewer/public/favicon.svg`, the desktop loading page and `packages/desktop/icon.svg` (the app icon).
- App icon: render `packages/desktop/icon.svg` (1024 artwork; icon-grid margin: 824px body, rx 186, drop shadow) to a 1024 PNG (e.g. a headless Chromium screenshot with `omitBackground`), then `bunx tauri icon <png>` in packages/desktop and delete the generated `android/`, `ios/`, `Square*Logo.png` and `StoreLogo.png` (unused).
- Fonts are bundled: `@fontsource-variable/ibm-plex-sans` and `@fontsource-variable/jetbrains-mono`, imported by `DesignSystemProvider` (same type in the browser and the desktop app, offline). Families `'IBM Plex Sans Variable'` / `'JetBrains Mono Variable'`. Text styles: `panelTitle`, `cardName`, `body`, `sectionLabel`, `panelLabel` (uppercase), `caption`, `code`, `edgeLabel`.
- Colour mode: dark by default (`<html class="dark">` in index.html), light on request. `colorMode.ts`: `useColorMode()`, `setColorMode()` (stored as `rae.colorMode`), `applyStoredColorMode()` (main.tsx, after `syncStorage`). The toolbar's View options has the switch.
- The shell is docked and flush: a 44px toolbar (`panel.bg`, bottom border), then file tree | canvas | details with hairlines between, no gaps, radii or shadows. `Panel` draws a side panel that way (its resize handle sits on the hairline, highlighted in `selection.solid`). `PanelBar` is a panel's 34px top bar (uppercase label + icon actions), `PanelHeader` the title block, `PanelSection` a 32px collapsible row (chevron, `sectionLabel`, count in mono on the right). `collapse={{ collapsed, strip }}` folds a panel to a `PANEL_STRIP` (40px) strip: the width animates (200ms, `cubic-bezier(0.22, 1, 0.36, 1)`; never while dragging), the content keeps its full width and fades out, the strip fades in; the hidden side is `inert`.
- Motion: nodes instant, re-layout glide 220ms, panels 200ms, popovers/menus/tooltips 140ms (tooltip delay 600ms), dialogs 180ms.

## Tokens
- Neutrals (Chakra's own `bg`, `bg.panel|subtle|muted|emphasized`, `fg`, `fg.muted|subtle|disabled`, `border`, `border.muted|emphasized`, so stock components fit), plus `shell.*`, `panel.bg`, `canvas.{bg,grid,dot}`, `card.{bg,bgSelected,border,frame}`.
- `selection.{solid,related,ring,rowBg,treeRow}`: **blue (hue 262) is reserved for selection**; no kind or relation may use hues 240–280. `colorPalette="accent"` (the same blue) is for the one primary action (Add, Scan a project, Add to diagram), switches and checkboxes.
- `kind.<module|component|hook|serverAction|function|type|route|external>.{solid,subtle,muted,fg}` (oklch: solid L 0.76 C 0.12 dark; hue carries the meaning, shape the second cue)
- `boundary.<server|client|shared>.{solid,subtle,muted,fg}` (server grey, client cyan, shared pink)
- `relation.<imports|importsMuted|declares|renders|usesHook|invokes|invokesAction|usesType|navigates|fetches|revalidates|invalidates|routeFile|runsBefore>`: edge stroke, arrow, label, filter swatch and details badge share one value
- `syntax.<name|type|literal|keyword|punct|bg>`: code colours shared by the node tooltip (CSS vars) and the sidebar (CodeToken)
- Radii: `l1` 4px chips, `l2` 6px controls, `l3` 8px cards / frames / popovers, `panel` 14px dialogs. Shadows: `node` none, `nodeDragging`, `popover`, `focusRing`.
- **No token may be named `value`**: Chakra reads any object with a `value` key as a token definition, which silently drops the whole group.
- Use them as Chakra style props (`bg="kind.hook.subtle"`). Outside Chakra (React Flow), use CSS vars: `var(--chakra-colors-kind-hook-solid)` (`tokenVar()`).
- Every token has a light (Paper) and a dark (Graphite) value: use tokens, never raw colours, so both modes work.

## Adding a component
1. Prefer a **re-export** in `primitives.ts` when the Chakra primitive is usable as is.
2. Wrap Chakra v3 **compound components** (`Dialog.*`, `Tooltip.*`, `Switch.*`, `Checkbox.*`, `Alert.*`, `NativeSelect.*`, `Collapsible.*`, `Table.*`, `DataList.*`, `EmptyState.*`) in a simple props API (`open`/`onOpenChange`, `value`/`onValueChange`) so apps never see slots. Overlays render inside `<Portal>`.
3. Icon-only buttons go through `ActionIconButton` (`label` = aria-label + tooltip).
4. Export the component and its props type from `src/index.ts`.
5. New icon: add an aliased export to `icons.ts` (`Foo as IconFoo`). Apps never import lucide directly.
6. Run `tsc -p packages/design-system --noEmit`, then `tsc -p packages/viewer --noEmit` and `bun run lint`.

## Performance rule
Design-system components are for chrome (toolbar, sidebar, dialogs, menus). Things rendered by the hundred and re-rendered per frame (diagram nodes/edges) are plain HTML/CSS in the app, styled with the token CSS variables. Dialogs and menus use `lazyMount unmountOnExit`, so nothing stays mounted (and focused) while closed.

## Chakra v3 notes
- Theming uses `createSystem`/`defineConfig`, not `extendTheme`. Provider: `<ChakraProvider value={system}>`.
- `asChild` merges props into the child (e.g. `Button asChild><a href>`).
- Sizes on small widgets go down to `2xs`/`xs`. `colorPalette="orange"` recolors a component's palette.
- Dialog `initialFocusEl` takes a function returning an element. The `Modal` wrapper accepts a ref.
