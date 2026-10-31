import { Alert as ChakraAlert } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface AlertProps {
  status?: "info" | "success" | "warning" | "error";
  title?: ReactNode;
  children?: ReactNode;
}

export function Alert({ status = "info", title, children }: AlertProps) {
  return (
    <ChakraAlert.Root status={status} size="sm">
      <ChakraAlert.Indicator />
      <ChakraAlert.Content minW="0">
        {title && <ChakraAlert.Title>{title}</ChakraAlert.Title>}
        {children && <ChakraAlert.Description>{children}</ChakraAlert.Description>}
      </ChakraAlert.Content>
    </ChakraAlert.Root>
  );
}
