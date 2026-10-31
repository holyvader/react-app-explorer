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
                      ShortcutLegend, Popover (anchored to a trigger or a point)
```

## Tokens
- `kind.<module|component|hook|serverAction|function|external>.{solid,subtle,muted,fg}`
- `boundary.<server|client|shared>.{solid,subtle,muted,fg}` (server gray, client cyan, shared pink)
- `relation.imports`, `relation.importsMuted` (dark grey import edges)
- Kinds: module gray, component **magenta** (custom palette), hook purple, server action orange, function teal, library yellow. **Blue is reserved for selected nodes** (relations always keep their own colours); don't use it for anything else.
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
