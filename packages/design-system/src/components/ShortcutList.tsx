import { Box, HStack, Kbd, Text } from "@chakra-ui/react";

export interface Shortcut {
  keys: string[];
  does: string;
}

/** The keyboard shortcuts as a two-column list (keys, what they do), e.g. inside a popover. */
export function ShortcutList({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <Box as="dl" display="grid" gridTemplateColumns="auto 1fr" columnGap="3" rowGap="1.5" fontSize="12px" m="0">
      {shortcuts.map((s) => (
        <Box key={s.does} display="contents">
          <HStack as="dt" gap="1" wrap="nowrap">
            {s.keys.map((k) => (
              <Kbd key={k} size="sm">
                {k}
              </Kbd>
            ))}
          </HStack>
          <Text as="dd" color="fg.muted" m="0">
            {s.does}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
