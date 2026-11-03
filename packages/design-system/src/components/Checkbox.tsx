import { Checkbox as ChakraCheckbox } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
}

export function Checkbox({ checked, onCheckedChange, children, size = "sm", disabled }: CheckboxProps) {
  return (
    <ChakraCheckbox.Root colorPalette="accent" checked={checked} onCheckedChange={(e) => onCheckedChange(e.checked === true)} size={size} disabled={disabled}>
      <ChakraCheckbox.HiddenInput />
      <ChakraCheckbox.Control />
      {children && <ChakraCheckbox.Label>{children}</ChakraCheckbox.Label>}
    </ChakraCheckbox.Root>
  );
}
