import { Badge, type BadgeProps } from "@chakra-ui/react";
import type { BoundaryToken, NodeKindToken } from "../theme.ts";

/** Badge colored by graph node kind. */
export function KindChip({ kind, children, ...rest }: { kind: NodeKindToken } & BadgeProps) {
  return (
    <Badge bg={`kind.${kind}.subtle`} color={`kind.${kind}.fg`} borderWidth="1px" borderColor={`kind.${kind}.muted`} size="sm" {...rest}>
      {children ?? kind}
    </Badge>
  );
}

/** Badge colored by server/client boundary. */
export function BoundaryChip({ boundary, children, ...rest }: { boundary: BoundaryToken } & BadgeProps) {
  return (
    <Badge bg={`boundary.${boundary}.subtle`} color={`boundary.${boundary}.fg`} size="sm" {...rest}>
      {children ?? boundary}
    </Badge>
  );
}

/** Neutral monospace chip, e.g. for render conditions. */
export function CodeChip({ children, ...rest }: BadgeProps) {
  return (
    <Badge variant="outline" fontFamily="mono" fontWeight="normal" size="sm" maxW="full" whiteSpace="normal" textAlign="left" {...rest}>
      {children}
    </Badge>
  );
}
