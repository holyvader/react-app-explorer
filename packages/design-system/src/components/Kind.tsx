import { Box, chakra, Text, type BoxProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { NodeKindToken } from "../theme.ts";

import { tokenVar } from "../tokens.ts";
import { textPx } from "../textSize.ts";

/**
 * A node kind's icon, in the kind's colour: the same mark as on the canvas cards and in the file
 * tree. `size` is the box it sits in (the icon itself carries its own size).
 */
export function KindTile({ kind, size = 20, children, ...rest }: { kind: NodeKindToken; size?: number; children: ReactNode } & BoxProps) {
  return (
    <Box flexShrink={0} w={`${size}px`} h={`${size}px`} display="inline-flex" alignItems="center" justifyContent="center" color={`kind.${kind}.solid`} {...rest}>
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

/** Tinted chip in any colour token (hooks, components, exports, relations). */
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
      px="7px"
      h="20px"
      rounded="l1"
      fontSize={textPx(11)}
      fontFamily={mono ? "mono" : undefined}
      whiteSpace="nowrap"
      cursor={onClick ? "pointer" : "default"}
      style={{
        color: `color-mix(in oklab, ${c} 70%, var(--chakra-colors-fg))`,
        background: `color-mix(in oklab, ${c} 16%, var(--chakra-colors-panel-bg))`,
      }}
      _hover={onClick ? { boxShadow: `inset 0 0 0 1px ${c}` } : undefined}
    >
      {children}
    </chakra.span>
  );
}

/** Small uppercase label above a group of values. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="panelLabel" color="fg.subtle">
      {children}
    </Text>
  );
}
