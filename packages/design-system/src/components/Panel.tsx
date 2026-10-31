import { Box, Collapsible, Flex, Text, type BoxProps } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Side panel container (e.g. details sidebar). */
export function Panel({ children, ...rest }: BoxProps) {
  return (
    <Box bg="bg.panel" borderLeftWidth="1px" borderColor="border.muted" h="full" overflowY="auto" {...rest}>
      {children}
    </Box>
  );
}

/** Sticky panel header: free-form content (tile, title, actions…). */
export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <Box
      px="5"
      pt="5"
      pb="4"
      position="sticky"
      top="0"
      zIndex="1"
      bg="bg.panel"
      borderBottomWidth="1px"
      borderColor="border.muted"
      style={{ backdropFilter: "saturate(1.4) blur(8px)", background: "color-mix(in srgb, var(--chakra-colors-bg-panel) 88%, transparent)" }}
    >
      {children}
    </Box>
  );
}

export interface PanelSectionProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  /** Right-aligned extra in the section header. */
  aside?: ReactNode;
  children: ReactNode;
}

/** Collapsible section inside a Panel: title, count pill, chevron. */
export function PanelSection({ title, count, defaultOpen = true, aside, children }: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // Collapsed content isn't mounted: long sections (relation lists, render trees) cost nothing until opened.
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)} lazyMount unmountOnExit>
      <Box borderBottomWidth="1px" borderColor="border.muted">
        <Collapsible.Trigger asChild>
          <Flex
            as="button"
            w="full"
            px="5"
            py="3"
            align="center"
            gap="2"
            cursor="pointer"
            transition="background 150ms ease"
            _hover={{ bg: "bg.subtle" }}
          >
            <Text fontSize="sm" fontWeight="semibold" color="fg">
              {title}
            </Text>
            {count !== undefined && (
              <Text as="span" fontSize="2xs" fontWeight="semibold" color="fg.muted" bg="bg.muted" px="1.5" rounded="full" lineHeight="18px">
                {count}
              </Text>
            )}
            <Box flex="1" />
            {aside}
            <Box color="fg.subtle" transition="transform 200ms ease" transform={open ? "rotate(0deg)" : "rotate(-90deg)"}>
              <ChevronDown size={16} />
            </Box>
          </Flex>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box px="5" pb="4">
            {children}
          </Box>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
}
