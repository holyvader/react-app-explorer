import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { system } from "./theme.ts";

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>;
}
