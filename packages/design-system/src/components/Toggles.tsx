import { chakra, Flex, type FlexProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { tokenVar } from "../tokens.ts";

export interface ToggleItem {
  value: string;
  label: ReactNode;
  /** Colour token for the leading dot. */
  color?: string;
  on: boolean;
}

/** A segmented row of on/off toggles (e.g. relation filters), each with an optional colour dot. */
export function SegmentedToggles({ items, onToggle, label }: { items: ToggleItem[]; onToggle: (value: string) => void; label: string }) {
  return (
    <Flex role="group" aria-label={label} bg="bg.muted" rounded="l3" p="0.5" gap="0.5">
      {items.map((it) => (
        <chakra.button
          key={it.value}
          type="button"
          aria-pressed={it.on}
          onClick={() => onToggle(it.value)}
          display="inline-flex"
          alignItems="center"
          gap="1.5"
          h="7"
          px="2.5"
          rounded="l2"
          fontSize="xs"
          fontWeight="medium"
          cursor="pointer"
          color={it.on ? "fg" : "fg.subtle"}
          bg={it.on ? "bg.panel" : "transparent"}
          boxShadow={it.on ? "xs" : "none"}
          transition="background 200ms ease, color 200ms ease, box-shadow 200ms ease"
          _hover={{ color: "fg" }}
        >
          {it.color && (
            <chakra.span
              w="2"
              h="2"
              rounded="full"
              transition="opacity 200ms ease"
              opacity={it.on ? 1 : 0.35}
              style={{ background: tokenVar(it.color) }}
            />
          )}
          {it.label}
        </chakra.button>
      ))}
    </Flex>
  );
}

/** A soft container grouping related toolbar controls. */
export function ToolGroup({ children, ...rest }: FlexProps) {
  return (
    <Flex align="center" gap="0.5" bg="bg.muted" rounded="l3" p="0.5" {...rest}>
      {children}
    </Flex>
  );
}
