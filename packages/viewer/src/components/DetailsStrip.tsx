import { ActionIconButton, Box, Flex, Text } from "@rae/design-system";
import { IconDetailsOpen } from "@rae/design-system/icons";
import type { ReactNode } from "react";
import { useExplorer } from "../store.ts";

/**
 * The details panel minimized: a thin strip with the button to open it again, and what it shows
 * (the element's tile and name, written down the strip) — a click anywhere on it opens it.
 */
export function DetailsStrip({ tile, name }: { tile: ReactNode; name: string }) {
  const open = () => useExplorer.getState().setDetailsOpen(true);
  return (
    <Flex direction="column" align="center" gap="3" py="2" h="full" cursor="pointer" onClick={open} _hover={{ bg: "bg.subtle" }} transition="background 160ms ease">
      <ActionIconButton
        label="Show the details"
        icon={<IconDetailsOpen />}
        size="xs"
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
      />
      {tile}
      <Box minH="0" flex="1" overflow="hidden">
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" whiteSpace="nowrap" style={{ writingMode: "vertical-rl" }} title={name}>
          {name}
        </Text>
      </Box>
    </Flex>
  );
}

