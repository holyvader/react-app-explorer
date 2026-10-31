import { Box, chakra, Text, type BoxProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { NodeKindToken } from "../theme.ts";

import { tokenVar } from "../tokens.ts";

/** Rounded gradient tile with an icon, in a node kind's colour — the same tile as on the canvas cards. */
export function KindTile({ kind, size = 32, children, ...rest }: { kind: NodeKindToken; size?: number; children: ReactNode } & BoxProps) {
  const k = tokenVar(`kind.${kind}.solid`);
  const external = kind === "external";
  return (
    <Box
      flexShrink={0}
      w={`${size}px`}
      h={`${size}px`}
      rounded={kind === "function" || external ? "full" : `${Math.round(size * 0.3)}px`}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      color={external ? `kind.${kind}.fg` : "white"}
      style={{
        background: external
          ? `color-mix(in srgb, ${k} 18%, var(--chakra-colors-bg-panel))`
          : `linear-gradient(135deg, color-mix(in srgb, ${k} 82%, white), color-mix(in srgb, ${k} 88%, black))`,
        boxShadow: external
          ? `inset 0 0 0 1px color-mix(in srgb, ${k} 40%, transparent)`
          : `0 2px 6px color-mix(in srgb, ${k} 38%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.35)`,
      }}
      {...rest}
    >
      {children}
    </Box>
  );
}

export type CodeTokenKind = "name" | "type" | "value" | "keyword" | "punct";

/** A coloured code token (prop names, types, default values…), consistent with the node tooltip. */
export function CodeToken({ kind, children }: { kind: CodeTokenKind; children: ReactNode }) {
  return (
    <chakra.span color={`syntax.${kind === "value" ? "literal" : kind}`} fontWeight={kind === "name" ? "medium" : undefined}>
      {children}
    </chakra.span>
  );
}

/** Tinted pill in any colour token (hooks, components, exports, relations). */
export function TagChip({ color, children, mono, onClick, title }: { color: string; children: ReactNode; mono?: boolean; onClick?: () => void; title?: string }) {
  const c = tokenVar(color);
  return (
    // A chip only becomes a button when it does something (it may sit inside another button).
    <chakra.span
      as={onClick ? "button" : "span"}
      {...(onClick ? { type: "button", onClick } : {})}
      title={title}
      display="inline-flex"
      alignItems="center"
      gap="1"
      px="2"
      h="22px"
      rounded="full"
      fontSize="xs"
      fontFamily={mono ? "mono" : undefined}
      fontWeight="medium"
      whiteSpace="nowrap"
      cursor={onClick ? "pointer" : "default"}
      transition="background 150ms ease, box-shadow 150ms ease"
      style={{
        color: `color-mix(in srgb, ${c} 82%, var(--chakra-colors-fg))`,
        background: `color-mix(in srgb, ${c} 11%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 30%, transparent)`,
      }}
      _hover={onClick ? { filter: "brightness(0.97)" } : undefined}
    >
      {children}
    </chakra.span>
  );
}

/** Small uppercase label above a group of values. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase" color="fg.subtle">
      {children}
    </Text>
  );
}
