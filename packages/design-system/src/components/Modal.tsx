import { CloseButton, Dialog, Portal } from "@chakra-ui/react";
import type { ReactNode, RefObject } from "react";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  initialFocusEl?: RefObject<HTMLElement | null>;
}

export function Modal({ open, onOpenChange, title, children, footer, size = "lg", initialFocusEl }: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      size={size}
      placement="top"
      initialFocusEl={initialFocusEl ? () => initialFocusEl.current : undefined}
      // Closed dialogs leave nothing mounted (no stray focused inputs swallowing shortcuts).
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            {title && (
              <Dialog.Header>
                <Dialog.Title>{title}</Dialog.Title>
              </Dialog.Header>
            )}
            <Dialog.Body>{children}</Dialog.Body>
            {footer && <Dialog.Footer>{footer}</Dialog.Footer>}
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
