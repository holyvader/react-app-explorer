import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * Design tokens for React App Explorer.
 * Graph node kinds and server/client boundaries get dedicated semantic tokens so
 * the app never hardcodes colors: use e.g. `bg="kind.component.subtle"`.
 * Blue is reserved for selection (selected / related nodes and edges): no kind or relation uses it.
 */
const kind = (base: string) => ({
  solid: { value: `{colors.${base}.500}` },
  subtle: { value: { _light: `{colors.${base}.50}`, _dark: `{colors.${base}.950}` } },
  muted: { value: { _light: `{colors.${base}.200}`, _dark: `{colors.${base}.800}` } },
  fg: { value: { _light: `{colors.${base}.700}`, _dark: `{colors.${base}.300}` } },
});

const config = defineConfig({
  globalCss: {
    "html, body, #root": { height: "100%", margin: 0 },
  },
  theme: {
    tokens: {
      colors: {
        // Components and their "renders" relation: #429cb5 at 500, tints and shades around it.
        component: {
          50: { value: "#eef8fb" },
          100: { value: "#d6eef4" },
          200: { value: "#b0deea" },
          300: { value: "#82c8da" },
          400: { value: "#5cb2c8" },
          500: { value: "#429cb5" },
          600: { value: "#367f94" },
          700: { value: "#2e6878" },
          800: { value: "#285563" },
          900: { value: "#234754" },
          950: { value: "#142c35" },
        },
      },
      // Softer, more modern corners across every component.
      radii: {
        l1: { value: "6px" },
        l2: { value: "8px" },
        l3: { value: "12px" },
      },
      fonts: {
        body: { value: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
        heading: { value: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
        mono: { value: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" },
      },
    },
    semanticTokens: {
      colors: {
        kind: {
          module: kind("gray"),
          // Blue is reserved for selection; nothing else uses it.
          component: kind("component"),
          hook: kind("purple"),
          serverAction: kind("orange"),
          function: kind("teal"),
          external: kind("yellow"),
        },
        boundary: {
          server: kind("gray"),
          client: kind("cyan"),
          shared: kind("pink"),
        },
        relation: {
          // "imports" edges: dark grey, distinct from the lighter module frames.
          imports: { value: { _light: "{colors.gray.700}", _dark: "{colors.gray.300}" } },
          importsMuted: { value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
          // Same colours as the edges and their labels on the canvas (sidebar badges reuse them).
          renders: { value: "{colors.component.500}" },
          usesHook: { value: "{colors.purple.500}" },
          invokes: { value: "{colors.teal.500}" },
          invokesAction: { value: "{colors.orange.500}" },
          declares: { value: "{colors.gray.500}" },
        },
        // Code tokens (props, signatures, hooks) — shared by the node tooltip and the sidebar.
        // Note: no token may be called `value` — Chakra reads any object with a `value` key as a token.
        syntax: {
          name: { value: { _light: "{colors.gray.900}", _dark: "{colors.gray.50}" } },
          type: { value: { _light: "#0f766e", _dark: "{colors.teal.300}" } },
          literal: { value: { _light: "#b45309", _dark: "{colors.orange.300}" } },
          keyword: { value: { _light: "{colors.purple.600}", _dark: "{colors.purple.300}" } },
          punct: { value: { _light: "{colors.gray.400}", _dark: "{colors.gray.500}" } },
          bg: { value: { _light: "{colors.gray.50}", _dark: "{colors.gray.900}" } },
        },
        canvas: {
          bg: { value: { _light: "{colors.gray.50}", _dark: "{colors.gray.950}" } },
          dot: { value: { _light: "{colors.gray.300}", _dark: "{colors.gray.700}" } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

export type NodeKindToken = "module" | "component" | "hook" | "serverAction" | "function" | "external";
export type BoundaryToken = "server" | "client" | "shared";
