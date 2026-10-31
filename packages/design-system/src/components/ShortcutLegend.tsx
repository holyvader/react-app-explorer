import { Box, Collapsible, Flex, HStack, Kbd, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Keyboard } from "lucide-react";
import { useState } from "react";

export interface Shortcut {
  keys: string[];
  does: string;
}

/** Collapsible keyboard-shortcut legend, meant for a canvas corner. */
export function ShortcutLegend({ shortcuts, title = "Keyboard shortcuts" }: { shortcuts: Shortcut[]; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="md" shadow="sm" fontSize="xs" maxW="sm">
      <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)} lazyMount unmountOnExit>
        <Collapsible.Trigger asChild>
          <Flex as="button" align="center" gap="1.5" px="2.5" py="1.5" w="full" cursor="pointer" color="fg.muted">
            <Keyboard size={14} />
            <Text flex="1" textAlign="left">
              {title}
            </Text>
            {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </Flex>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box as="dl" px="2.5" pb="2" display="grid" gridTemplateColumns="auto 1fr" columnGap="3" rowGap="1.5">
            {shortcuts.map((s) => (
              <Box key={s.does} display="contents">
                <HStack as="dt" gap="1" wrap="nowrap">
                  {s.keys.map((k) => (
                    <Kbd key={k} size="sm">
                      {k}
                    </Kbd>
                  ))}
                </HStack>
                <Text as="dd" color="fg.muted">
                  {s.does}
                </Text>
              </Box>
            ))}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}
