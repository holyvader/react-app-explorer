import { Box, Switch as ChakraSwitch } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  /** Accessible name when there's no visible label (`children`). */
  label?: string;
}

export function Switch({ checked, onCheckedChange, children, size = "sm", disabled, label }: SwitchProps) {
  return (
    <ChakraSwitch.Root checked={checked} onCheckedChange={(e) => onCheckedChange(e.checked)} size={size} disabled={disabled} colorPalette="accent">
      <ChakraSwitch.HiddenInput aria-label={label} />
      <ChakraSwitch.Control />
      {children && <ChakraSwitch.Label>{children}</ChakraSwitch.Label>}
    </ChakraSwitch.Root>
  );
}

export interface SwitchFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The row's text (clickable: it toggles the switch). */
  label: ReactNode;
  /** A quieter line under the label. */
  hint?: ReactNode;
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string;
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  /** Horizontal padding and minimum height of the row (menus: "3.5" / "36px"). */
  px?: string;
  minH?: string;
}

/**
 * A setting row: label (and hint) on the left, the switch on the right. The whole row is the
 * switch's label, so a click anywhere on it toggles the switch.
 */
export function SwitchField({ checked, onCheckedChange, label, hint, ariaLabel, size = "sm", disabled, px, minH }: SwitchFieldProps) {
  return (
    <ChakraSwitch.Root
      checked={checked}
      onCheckedChange={(e) => onCheckedChange(e.checked)}
      size={size}
      disabled={disabled}
      colorPalette="accent"
      display="flex"
      alignItems="center"
      gap="3"
      width="full"
      px={px}
      minH={minH}
      cursor={disabled ? "default" : "pointer"}
    >
      <ChakraSwitch.HiddenInput aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)} />
      <Box flex="1" minW="0">
        <Box>{label}</Box>
        {hint && (
          <Box fontSize="xs" color="fg.muted">
            {hint}
          </Box>
        )}
      </Box>
      <ChakraSwitch.Control />
    </ChakraSwitch.Root>
  );
}
