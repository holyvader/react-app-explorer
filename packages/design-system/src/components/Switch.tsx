import { Switch as ChakraSwitch } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, children, size = "sm", disabled }: SwitchProps) {
  return (
    <ChakraSwitch.Root checked={checked} onCheckedChange={(e) => onCheckedChange(e.checked)} size={size} disabled={disabled}>
      <ChakraSwitch.HiddenInput />
      <ChakraSwitch.Control />
      {children && <ChakraSwitch.Label>{children}</ChakraSwitch.Label>}
    </ChakraSwitch.Root>
  );
}
