import { Box, Menu, Portal, Text } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type MenuEntry =
  | {
      type: "item";
      value: string;
      label: ReactNode;
      onSelect: () => void;
      icon?: ReactNode;
      /** Right-aligned hint: a shortcut, a count, "on canvas"… */
      hint?: ReactNode;
      disabled?: boolean;
    }
  | { type: "separator" }
  | { type: "label"; label: ReactNode }
  | { type: "submenu"; value: string; label: ReactNode; icon?: ReactNode; hint?: ReactNode; entries: MenuEntry[]; disabled?: boolean };

export interface ContextMenuProps {
  /** Where it opens (client coordinates); null = closed. */
  at: { x: number; y: number } | null;
  onClose: () => void;
  entries: MenuEntry[];
  /** Optional header above the entries. */
  title?: ReactNode;
}

/** A right-click menu at a point, with nested submenus. One instance serves the whole canvas. */
export function ContextMenu({ at, onClose, entries, title }: ContextMenuProps) {
  return (
    <Menu.Root
      open={!!at}
      anchorPoint={at ?? undefined}
      // No trigger element: the menu is anchored to the pointer's point.
      positioning={{ placement: "bottom-start", gutter: 2, getAnchorRect: () => (at ? { x: at.x, y: at.y, width: 0, height: 0 } : null) }}
      onOpenChange={(e) => !e.open && onClose()}
      onSelect={() => onClose()}
      size="sm"
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="64" maxW="sm">
            {title && (
              <Box px="2" py="1.5" borderBottomWidth="1px" borderColor="border" mb="1">
                {title}
              </Box>
            )}
            <Entries entries={entries} />
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

function Entries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((e, i) => {
        switch (e.type) {
          case "separator":
            return <Menu.Separator key={i} />;
          case "label":
            return (
              <Text key={i} px="2" pt="1.5" pb="0.5" fontSize="2xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="fg.subtle">
                {e.label}
              </Text>
            );
          case "item":
            return (
              <Menu.Item key={e.value} value={e.value} onClick={e.onSelect} disabled={e.disabled}>
                {e.icon}
                <Box flex="1" minW="0" truncate>
                  {e.label}
                </Box>
                {e.hint && <Menu.ItemCommand>{e.hint}</Menu.ItemCommand>}
              </Menu.Item>
            );
          case "submenu":
            return (
              <Menu.Root key={e.value} size="sm" positioning={{ placement: "right-start", gutter: 2 }} lazyMount unmountOnExit>
                <Menu.TriggerItem aria-disabled={e.disabled || undefined}>
                  {e.icon}
                  <Box flex="1" minW="0" truncate>
                    {e.label}
                  </Box>
                  {e.hint && <Menu.ItemCommand>{e.hint}</Menu.ItemCommand>}
                  <ChevronRight size={14} />
                </Menu.TriggerItem>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content minW="64" maxW="md" maxH="70vh" overflowY="auto">
                      <Entries entries={e.entries} />
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            );
        }
      })}
    </>
  );
}
