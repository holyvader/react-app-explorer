import { Popover as ChakraPopover, Portal } from "@chakra-ui/react";
import type { ReactElement, ReactNode, RefObject } from "react";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element that opens it (the popover is placed against it)… */
  trigger?: ReactElement;
  /** …or a point in client coordinates (e.g. where the canvas was right-clicked). */
  at?: { x: number; y: number } | null;
  placement?: "top" | "bottom" | "bottom-start" | "top-start" | "right-start";
  /** Accessible name of the panel. */
  label: string;
  initialFocusEl?: RefObject<HTMLElement | null>;
  width?: string;
  height?: string;
  children: ReactNode;
}

/** A floating panel (picker, quick add): focus trapped inside, closes on outside click / Esc. */
export function Popover({ open, onOpenChange, trigger, at, placement = "bottom", label, initialFocusEl, width = "480px", height, children }: PopoverProps) {
  return (
    <ChakraPopover.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      positioning={{
        placement,
        gutter: 12,
        ...(at ? { getAnchorRect: () => ({ x: at.x, y: at.y, width: 0, height: 0 }) } : {}),
      }}
      initialFocusEl={initialFocusEl ? () => initialFocusEl.current : undefined}
      lazyMount
      unmountOnExit
    >
      {trigger && <ChakraPopover.Trigger asChild>{trigger}</ChakraPopover.Trigger>}
      <Portal>
        <ChakraPopover.Positioner>
          <ChakraPopover.Content aria-label={label} width={width} maxW="calc(100vw - 32px)" height={height} rounded="l3" shadow="popover" overflow="hidden" display="flex" flexDirection="column">
            {children}
          </ChakraPopover.Content>
        </ChakraPopover.Positioner>
      </Portal>
    </ChakraPopover.Root>
  );
}
