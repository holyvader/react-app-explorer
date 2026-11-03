import { Portal, Tooltip as ChakraTooltip } from "@chakra-ui/react";
import type { ReactElement, ReactNode } from "react";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  disabled?: boolean;
  placement?: "top" | "bottom" | "left" | "right";
}

/**
 * Rich tooltip (one Chakra/zag machine per instance). For elements rendered in large numbers
 * (diagram nodes, edges) prefer native titles, e.g. `ActionIconButton tooltip="native"`.
 */
export function Tooltip({ content, children, disabled, placement = "top" }: TooltipProps) {
  if (disabled || !content) return children;
  return (
    <ChakraTooltip.Root openDelay={600} closeDelay={50} positioning={{ placement }} lazyMount unmountOnExit>
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content maxW="md" fontSize="11.5px" bg="bg.emphasized" color="fg" rounded="l2" shadow="popover">
            {content}
          </ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  );
}
