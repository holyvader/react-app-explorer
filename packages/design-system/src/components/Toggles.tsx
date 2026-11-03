import { chakra, Flex, Text, type FlexProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { tokenVar } from "../tokens.ts";

export interface ToggleItem {
  value: string;
  label: ReactNode;
  /** Colour token for the leading swatch. */
  color?: string;
  /** The swatch's shape (the second cue after colour): square (default), circle or diamond. */
  shape?: "square" | "circle" | "diamond";
  on: boolean;
}

/**
 * A row of on/off toggles (e.g. the relation filters on the canvas), each with a colour swatch:
 * on, a filled swatch on a raised chip; off, a hollow square in quiet text.
 */
export function SegmentedToggles({ items, onToggle, label, title }: { items: ToggleItem[]; onToggle: (value: string) => void; label: string; title?: ReactNode }) {
  return (
    <Flex role="group" aria-label={label} align="center" bg="bg.subtle" borderWidth="1px" borderColor="card.border" rounded="l3" p="1" gap="0.5" fontSize="12px">
      {title && (
        <Text as="span" pl="1.5" pr="2" color="fg.subtle" fontWeight="medium" whiteSpace="nowrap">
          {title}
        </Text>
      )}
      {items.map((it) => (
        <chakra.button
          key={it.value}
          type="button"
          aria-pressed={it.on}
          onClick={() => onToggle(it.value)}
          display="inline-flex"
          alignItems="center"
          gap="1.5"
          h="6"
          px="2"
          rounded="5px"
          whiteSpace="nowrap"
          cursor="pointer"
          color={it.on ? "fg" : "fg.subtle"}
          bg={it.on ? "border" : "transparent"}
          _hover={{ color: "fg", bg: it.on ? "border.emphasized" : "bg.muted" }}
          _focusVisible={{ outline: "1.5px solid var(--chakra-colors-selection-solid)", outlineOffset: "0" }}
        >
          {it.color && <Swatch color={it.color} shape={it.shape} on={it.on} />}
          {it.label}
        </chakra.button>
      ))}
    </Flex>
  );
}

function Swatch({ color, shape = "square", on }: { color: string; shape?: ToggleItem["shape"]; on: boolean }) {
  if (!on) return <chakra.span w="2" h="2" rounded="2px" borderWidth="1.5px" borderColor="syntax.punct" flexShrink={0} />;
  return (
    <chakra.span
      w="2"
      h="2"
      flexShrink={0}
      rounded={shape === "circle" ? "full" : "2px"}
      transform={shape === "diamond" ? "rotate(45deg) scale(0.85)" : undefined}
      style={{ background: tokenVar(color) }}
    />
  );
}

/** Groups related toolbar controls (icon buttons side by side). */
export function ToolGroup({ children, ...rest }: FlexProps) {
  return (
    <Flex align="center" gap="0.5" {...rest}>
      {children}
    </Flex>
  );
}
