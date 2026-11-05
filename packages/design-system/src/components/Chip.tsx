import { Badge, type BadgeProps } from "@chakra-ui/react";
import type { BoundaryToken, NodeKindToken } from "../theme.ts";
import { textPx } from "../textSize.ts";

const CHIP = { rounded: "l1", px: "7px", h: "20px", fontSize: textPx(11), fontWeight: "normal", textTransform: "none" } as const;

/** Chip coloured by graph node kind. */
export function KindChip({ kind, children, ...rest }: { kind: NodeKindToken } & BadgeProps) {
  return (
    <Badge bg={`kind.${kind}.subtle`} color={`kind.${kind}.fg`} {...CHIP} {...rest}>
      {children ?? kind}
    </Badge>
  );
}

/** Chip coloured by server/client boundary. */
export function BoundaryChip({ boundary, children, ...rest }: { boundary: BoundaryToken } & BadgeProps) {
  return (
    <Badge bg={`boundary.${boundary}.subtle`} color={`boundary.${boundary}.fg`} {...CHIP} {...rest}>
      {children ?? boundary}
    </Badge>
  );
}

/** Neutral outlined chip (a tag: async, default export…); `mono` for code such as render conditions. */
export function CodeChip({ children, ...rest }: BadgeProps) {
  return (
    <Badge variant="outline" bg="transparent" color="kind.module.fg" boxShadow="inset 0 0 0 1px var(--chakra-colors-border-emphasized)" fontFamily="mono" {...CHIP} h="auto" minH="20px" maxW="full" whiteSpace="normal" textAlign="left" {...rest}>
      {children}
    </Badge>
  );
}
