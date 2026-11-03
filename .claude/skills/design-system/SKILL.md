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
src/icons.ts          curated lucide icons, renamed Icon<Name> (IconPlus, IconComponent…)
src/components/       composed components: Modal, Tooltip, ActionIconButton, SearchInput, Select,
                      Panel/PanelHeader/PanelSection, EmptyState, PropertyList, DataTable, KindChip/BoundaryChip/CodeChip,
                      Switch, Checkbox, Alert, ContextMenu (point-anchored, nested submenus),
                      ShortcutLegend, Popover (anchored to a trigger or a point),
                      KindTile (gradient icon tile per node kind), CodeToken, TagChip (tinted pill,
                      a <span> unless clickable), Eyebrow, SegmentedToggles, ToolGroup
src/tokens.ts         tokenVar(token) → CSS variable of any colour token
```

## Brand & shell (the "modern" look)
- **BrandMark** (`components/BrandMark.tsx`): the logo as inline SVG (gradient ids per instance via `useId`): a component (teal square), hook (violet circle) and server action (amber tile) around the explored node, on a deep teal→ink tile. Used in the toolbar and the welcome empty state. The same artwork is `packages/viewer/public/favicon.svg`, the desktop loading page and the app icon.
- App icon: render `packages/desktop/icon.svg` (1024 artwork; icon-grid margin: 824px body, rx 186, drop shadow) to a 1024 PNG (e.g. a headless Chromium screenshot), then `bunx tauri icon <png>` in packages/desktop and delete the generated `android/`, `ios/`, `Square*Logo.png` and `StoreLogo.png` (unused).
- Fonts are bundled: `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`, imported by `DesignSystemProvider` (same type in the browser and the desktop app, offline). Families `'Inter Variable'` / `'JetBrains Mono Variable'`.
- The shell: `shell.bg` (cool grey backdrop) and `shell.border`. The file tree, canvas and details panel are floating surfaces on it (`rounded="panel"` 14px, `shadow="panel"`, 8px gaps). `Panel` draws itself that way; its resize handle sits in the gap. `collapse={{ collapsed, strip }}` folds it to a `PANEL_STRIP` (44px) strip and back: the width animates (320ms, ease-out; never while dragging), the content keeps its full width (no reflow) and fades out, the strip fades in; the hidden side is `inert`. `ToolGroup` / `SegmentedToggles` are white pills (`shell.border`, `shadow="control"`) on the shell, the active toggle `bg.muted`.

## Tokens
- `kind.<module|component|hook|serverAction|function|external>.{solid,subtle,muted,fg}`
- `boundary.<server|client|shared>.{solid,subtle,muted,fg}` (server gray, client cyan, shared pink)
- `relation.<imports|importsMuted|renders|usesHook|invokes|invokesAction|declares>`: the edges' colours, reused by sidebar badges and toolbar dots
- `syntax.<name|type|literal|keyword|punct|bg>`: code colours shared by the node tooltip (CSS vars) and the sidebar (CodeToken)
- **No token may be named `value`**: Chakra reads any object with a `value` key as a token definition, which silently drops the whole group.
- Radii are softened globally (`l1` 6px, `l2` 8px, `l3` 12px).
- Kinds: module gray, component **#429cb5** (custom `component` palette), hook purple, server action orange, function teal, library yellow. **Blue is reserved for selected nodes** (relations always keep their own colours); don't use it for anything else.
- `canvas.bg`, `canvas.dot`
- Use them as Chakra style props (`bg="kind.hook.subtle"`). Outside Chakra (React Flow SVG), use CSS vars: `var(--chakra-colors-kind-hook-solid)`.
- Prefer Chakra semantic tokens (`bg.panel`, `bg.muted`, `fg.muted`, `border`) over raw palette colors so light/dark both work.

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
