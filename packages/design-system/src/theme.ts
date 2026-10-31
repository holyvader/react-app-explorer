import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * Design tokens for React App Explorer.
 * Graph node kinds and server/client boundaries get dedicated semantic tokens so
 * the app never hardcodes colors: use e.g. `bg="kind.component.subtle"`.
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
          component: kind("blue"),
          hook: kind("purple"),
          serverAction: kind("orange"),
          function: kind("teal"),
          external: kind("pink"),
        },
        boundary: {
          server: kind("green"),
          client: kind("cyan"),
          shared: kind("yellow"),
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
