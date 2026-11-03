import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * Design tokens for Explorer ("Explorer Final" in Claude Design: Graphite shell, Paper light mode).
 * Graph node kinds, relations and server/client boundaries get dedicated semantic tokens so the app
 * never hardcodes colours: use e.g. `bg="kind.component.subtle"`.
 * Blue (hue 240–280) is reserved for selection: no kind or relation uses it.
 * Note: no token may be called `value` (Chakra reads any object with a `value` key as a token).
 */
const ok = (l: number, c: number, h: number, a?: number) => `oklch(${l} ${c} ${h}${a != null ? ` / ${a}` : ""})`;
const v = (light: string, dark: string) => ({ value: { _light: light, _dark: dark } });

const HUE = { component: 210, hook: 300, serverAction: 55, function: 175, type: 140, route: 355, external: 90 } as const;

const kind = (h: number) => ({
  solid: v(ok(0.6, 0.12, h), ok(0.76, 0.12, h)),
  subtle: v(ok(0.965, 0.02, h), ok(0.3, 0.05, h)),
  muted: v(ok(0.86, 0.04, h), ok(0.45, 0.07, h)),
  fg: v(ok(0.45, 0.1, h), ok(0.84, 0.09, h)),
});

/** A Chakra colour palette (solid, contrast, fg, muted, subtle, emphasized, focusRing), for `colorPalette`. */
const palette = (h: number, solid: [string, string], contrast: [string, string]) => ({
  solid: v(...solid),
  contrast: v(...contrast),
  fg: v(ok(0.45, 0.12, h), ok(0.84, 0.09, h)),
  muted: v(ok(0.9, 0.04, h), ok(0.36, 0.06, h)),
  subtle: v(ok(0.965, 0.02, h), ok(0.27, 0.04, h)),
  emphasized: v(ok(0.86, 0.05, h), ok(0.42, 0.08, h)),
  focusRing: v(...solid),
});

const config = defineConfig({
  globalCss: {
    "html, body, #root": { height: "100%", margin: 0 },
    html: { colorScheme: "light" },
    "html.dark": { colorScheme: "dark" },
    body: { fontSize: "12.5px", lineHeight: "18px", ...({ WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" } as object) },
  },
  theme: {
    tokens: {
      radii: {
        l1: { value: "4px" }, // chips
        l2: { value: "6px" }, // controls
        l3: { value: "8px" }, // cards, frames, popovers
        panel: { value: "14px" }, // dialogs
      },
      shadows: {
        node: { value: "none" },
        nodeDragging: { value: "0 12px 24px -8px rgb(0 0 0 / 0.6)" },
        popover: { value: "0 12px 24px -8px rgb(0 0 0 / 0.6), 0 0 0 1px var(--chakra-colors-border-emphasized)" },
        focusRing: { value: "0 0 0 3px var(--chakra-colors-selection-ring)" },
      },
      fonts: {
        // bundled (@fontsource-variable, imported by the provider): the same in the browser and the app
        body: { value: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, -apple-system, sans-serif" },
        heading: { value: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, -apple-system, sans-serif" },
        mono: { value: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, monospace" },
      },
      durations: {
        panel: { value: "200ms" },
        popover: { value: "140ms" },
        dialog: { value: "180ms" },
        relayout: { value: "220ms" },
      },
      easings: {
        standard: { value: "cubic-bezier(0.22, 1, 0.36, 1)" },
      },
    },
    textStyles: {
      panelTitle: { value: { fontSize: "18px", lineHeight: "24px", fontWeight: 600, letterSpacing: "-0.01em" } },
      cardName: { value: { fontSize: "13.5px", lineHeight: "18px", fontWeight: 600 } },
      body: { value: { fontSize: "12.5px", lineHeight: "18px", fontWeight: 400 } },
      sectionLabel: { value: { fontSize: "11.5px", lineHeight: "16px", fontWeight: 600, letterSpacing: "0.02em" } },
      panelLabel: { value: { fontSize: "11px", lineHeight: "14px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" } },
      caption: { value: { fontSize: "11px", lineHeight: "14px", fontWeight: 400 } },
      code: { value: { fontFamily: "mono", fontSize: "11.5px", lineHeight: "19px" } },
      edgeLabel: { value: { fontFamily: "mono", fontSize: "10.5px", lineHeight: "14px" } },
    },
    semanticTokens: {
      colors: {
        // Chakra's own neutrals, so every stock component (dialogs, menus, inputs) sits in the shell.
        bg: {
          DEFAULT: v("#FFFFFF", "#18191D"),
          panel: v("#FFFFFF", "#18191D"),
          subtle: v("#F7F6F3", "#1B1C20"),
          muted: v("#EEEDE9", "#24262B"),
          emphasized: v("#E2E0DA", "#2A2C32"),
        },
        fg: {
          DEFAULT: v("#1F1E1C", "#E6E7EA"),
          muted: v("#4A4844", "#AEB1B8"),
          subtle: v("#6B6964", "#9A9DA4"),
          disabled: v("#B9B6AE", "#5C5F66"),
        },
        border: {
          DEFAULT: v("#E2E0DA", "#26282D"),
          muted: v("#EBE9E4", "#222429"),
          subtle: v("#EBE9E4", "#222429"),
          emphasized: v("#D9D6CE", "#33353B"),
        },
        shell: { bg: v("#EFEEEA", "#141518"), border: v("#E2E0DA", "#26282D") },
        panel: { bg: v("#FFFFFF", "#18191D") },
        canvas: { bg: v("#FCFBF9", "#121316"), grid: v("#ECEAE4", "#1B1C20"), dot: v("#DAD7CF", "#26282D") },
        card: { bg: v("#FFFFFF", "#1B1C20"), bgSelected: v("#FFFFFF", "#1E2025"), border: v("#E2E0DA", "#2C2E34"), frame: v("#FAF9F7", "#17181C") },
        // Selection (selected and related nodes, the selected tree row, the primary action).
        selection: {
          solid: v(ok(0.56, 0.2, 262), ok(0.7, 0.15, 262)),
          related: v(ok(0.78, 0.09, 262), ok(0.48, 0.1, 262)),
          ring: v(ok(0.56, 0.2, 262, 0.18), ok(0.7, 0.15, 262, 0.22)),
          rowBg: v(ok(0.94, 0.035, 262), ok(0.24, 0.03, 262)),
          treeRow: v(ok(0.9, 0.06, 262), ok(0.3, 0.06, 262)),
        },
        // `colorPalette="accent"`: the primary action (Add, Scan a project…), in the selection blue.
        accent: palette(262, [ok(0.56, 0.2, 262), ok(0.7, 0.15, 262)], ["#FFFFFF", "#0E1015"]),
        // Kept for `colorPalette="component"` (progress bars).
        component: palette(HUE.component, [ok(0.6, 0.12, HUE.component), ok(0.76, 0.12, HUE.component)], ["#FFFFFF", "#0E1015"]),
        kind: {
          module: { solid: v("#8A877F", "#AEB1B8"), subtle: v("#EEEDE9", "#26282D"), muted: v("#D9D6CE", "#33353B"), fg: v("#4A4844", "#C7C9CE") },
          component: kind(HUE.component),
          hook: kind(HUE.hook),
          serverAction: kind(HUE.serverAction),
          function: kind(HUE.function),
          type: kind(HUE.type),
          route: kind(HUE.route),
          external: kind(HUE.external),
        },
        boundary: {
          server: { solid: v("#8A877F", "#AEB1B8"), subtle: v("#EEEDE9", "#26282D"), muted: v("#D9D6CE", "#33353B"), fg: v("#4A4844", "#C7C9CE") },
          client: { solid: v(ok(0.6, 0.1, 215), ok(0.76, 0.1, 215)), subtle: v(ok(0.95, 0.04, 215), ok(0.3, 0.05, 215)), muted: v(ok(0.86, 0.05, 215), ok(0.42, 0.07, 215)), fg: v(ok(0.42, 0.09, 215), ok(0.86, 0.08, 215)) },
          shared: { solid: v(ok(0.6, 0.13, 355), ok(0.76, 0.12, 355)), subtle: v(ok(0.96, 0.025, 355), ok(0.3, 0.06, 355)), muted: v(ok(0.86, 0.05, 355), ok(0.42, 0.08, 355)), fg: v(ok(0.48, 0.13, 355), ok(0.86, 0.08, 355)) },
        },
        // Edge stroke, edge label, filter dot and details badge all use these.
        relation: {
          imports: v("#4A4844", "#AEB1B8"), // dashed when lazy; faint when type-only
          importsMuted: v("#A3A097", "#6E727A"),
          declares: v("#8A877F", "#8A8D94"),
          renders: v(ok(0.6, 0.12, HUE.component), ok(0.76, 0.12, HUE.component)),
          usesHook: v(ok(0.6, 0.13, HUE.hook), ok(0.76, 0.12, HUE.hook)),
          invokes: v(ok(0.6, 0.11, HUE.function), ok(0.76, 0.11, HUE.function)),
          invokesAction: v(ok(0.64, 0.14, HUE.serverAction), ok(0.78, 0.13, HUE.serverAction)),
          usesType: v(ok(0.6, 0.13, HUE.type), ok(0.76, 0.13, HUE.type)),
          navigates: v(ok(0.6, 0.15, HUE.route), ok(0.76, 0.13, HUE.route)),
          fetches: v(ok(0.58, 0.1, 195), ok(0.78, 0.1, 195)), // dash 6 3
          revalidates: v("#8A877F", "#8A8D94"), // dash 1 3
          invalidates: v(ok(0.5, 0.13, HUE.hook), ok(0.76, 0.12, HUE.hook)), // dash 1 3
          routeFile: v(ok(0.72, 0.1, 355), ok(0.7, 0.1, 355)), // dash 3 3
          runsBefore: v(ok(0.56, 0.18, 25), ok(0.72, 0.16, 25)),
        },
        // Code tokens (props, signatures, hooks): shared by the node tooltip and the sidebar.
        syntax: {
          name: v("#1F1E1C", "#E6E7EA"),
          type: v(ok(0.48, 0.1, 175), ok(0.8, 0.1, 175)),
          literal: v(ok(0.52, 0.12, 55), ok(0.82, 0.11, 55)),
          keyword: v(ok(0.5, 0.13, 300), ok(0.8, 0.1, 300)),
          punct: v("#A3A097", "#6E727A"),
          bg: v("#F7F6F3", "#121316"),
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

export type NodeKindToken = "module" | "component" | "hook" | "serverAction" | "function" | "type" | "route" | "external";
export type BoundaryToken = "server" | "client" | "shared";
