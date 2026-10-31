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
        // Magenta for components (not in Chakra's default palette).
        magenta: {
          50: { value: "#fdf4ff" },
          100: { value: "#fae8ff" },
          200: { value: "#f5d0fe" },
          300: { value: "#f0abfc" },
          400: { value: "#e879f9" },
          500: { value: "#d946ef" },
          600: { value: "#c026d3" },
          700: { value: "#a21caf" },
          800: { value: "#86198f" },
          900: { value: "#701a75" },
          950: { value: "#4a044e" },
        },
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
          component: kind("magenta"),
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
