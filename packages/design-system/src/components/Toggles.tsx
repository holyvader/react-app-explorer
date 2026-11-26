import { chakra, Flex, Text, type FlexProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { textPx } from "../textSize.ts";
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
 * on, a filled swatch on a raised chip (in a `vertical` list, just the filled swatch); off, a hollow square in quiet text.
 */
export function SegmentedToggles({
  items,
  onToggle,
  label,
  title,
  vertical,
}: {
  items: ToggleItem[];
  onToggle: (value: string) => void;
  label: string;
  title?: ReactNode;
  /** One toggle per line, without the frame (a list inside a popover). */
  vertical?: boolean;
}) {
  const frame = vertical ? { flexDirection: "column" as const, align: "stretch", p: "1.5" } : { align: "center", bg: "bg.subtle", borderWidth: "1px", borderColor: "card.border", rounded: "l3", p: "1" };
  return (
    <Flex role="group" aria-label={label} gap="0.5" fontSize="12px" {...frame}>
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
          h={vertical ? "7" : "6"}
          px="2"
          rounded="5px"
          whiteSpace="nowrap"
          cursor="pointer"
          color={it.on ? "fg" : "fg.subtle"}
          bg={it.on && !vertical ? "border" : "transparent"}
          _hover={{ color: "fg", bg: it.on && !vertical ? "border.emphasized" : "bg.muted" }}
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

export interface SegmentOption {
  value: string;
  label: ReactNode;
}

/**
 * One choice of a few, side by side (a radio group drawn as a segmented control). `tone` colours the
 * chosen segment with a colour token family (`diff.changed` → its `solid` / `subtle` / `fg`); without
 * it the chosen segment is raised in the neutral `border` tone.
 */
export function SegmentedControl({ value, options, onValueChange, label, tone }: { value: string; options: SegmentOption[]; onValueChange: (value: string) => void; label: string; tone?: string }) {
  return (
    <Flex role="radiogroup" aria-label={label} align="center" gap="0.5" p="0.5" rounded="7px" bg={tone ? `${tone}.subtle` : "bg.muted"} flexShrink={0}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <chakra.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onValueChange(o.value)}
            h="6"
            px="2.5"
            rounded="5px"
            fontSize={textPx(12)}
            whiteSpace="nowrap"
            cursor="pointer"
            fontWeight={on ? "semibold" : "normal"}
            color={on ? (tone ? "bg" : "fg") : tone ? `${tone}.fg` : "fg.muted"}
            bg={on ? (tone ? `${tone}.fg` : "border.emphasized") : "transparent"}
            _hover={on ? undefined : { color: tone ? `${tone}.fg` : "fg", bg: tone ? "blackAlpha.200" : "border" }}
            _focusVisible={{ outline: "1.5px solid var(--chakra-colors-selection-solid)", outlineOffset: "1px" }}
          >
            {o.label}
          </chakra.button>
        );
      })}
    </Flex>
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
