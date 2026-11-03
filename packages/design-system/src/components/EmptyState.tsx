import { EmptyState as ChakraEmptyState, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <ChakraEmptyState.Root>
      <ChakraEmptyState.Content>
        {icon && <ChakraEmptyState.Indicator>{icon}</ChakraEmptyState.Indicator>}
        <VStack textAlign="center">
          <ChakraEmptyState.Title>{title}</ChakraEmptyState.Title>
          {description && <ChakraEmptyState.Description maxW="440px">{description}</ChakraEmptyState.Description>}
        </VStack>
        {children}
      </ChakraEmptyState.Content>
    </ChakraEmptyState.Root>
  );
}
