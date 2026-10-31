import { Box, Collapsible, Flex, Heading, Text, type BoxProps } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Side panel container (e.g. details sidebar). */
export function Panel({ children, ...rest }: BoxProps) {
  return (
    <Box bg="bg.panel" borderLeftWidth="1px" borderColor="border" h="full" overflowY="auto" {...rest}>
      {children}
    </Box>
  );
}

export function PanelHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <Box px="4" py="3" borderBottomWidth="1px" borderColor="border" position="sticky" top="0" bg="bg.panel" zIndex="1">
      <Flex align="start" gap="2">
        <Box flex="1" minW="0">
          <Heading size="sm" truncate>
            {title}
          </Heading>
          {subtitle && (
            <Text fontSize="xs" color="fg.muted" truncate>
              {subtitle}
            </Text>
          )}
        </Box>
        {actions}
      </Flex>
      {children}
    </Box>
  );
}

export interface PanelSectionProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible section inside a Panel. */
export function PanelSection({ title, count, defaultOpen = true, children }: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // Collapsed content isn't mounted: long sections (relation lists, render trees) cost nothing until opened.
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)} lazyMount unmountOnExit>
      <Box borderBottomWidth="1px" borderColor="border">
        <Collapsible.Trigger asChild>
          <Flex as="button" w="full" px="4" py="2" align="center" gap="1.5" cursor="pointer" _hover={{ bg: "bg.muted" }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="fg.muted">
              {title}
            </Text>
            {count !== undefined && (
              <Text fontSize="xs" color="fg.subtle">
                ({count})
              </Text>
            )}
          </Flex>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box px="4" pb="3">
            {children}
          </Box>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
}
