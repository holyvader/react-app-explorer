import { ActionIconButton, Box, BrandMark, Button, Flex, Spinner, Text, textPx, ToolGroup, Tooltip } from "@rae/design-system";
import { FolderSwitcher } from "./FolderSwitcher.tsx";
import { GitControls } from "./git/GitControls.tsx";
import {
  IconLayout,
  IconRedo,
  IconFolderOpen,
  IconUndo,
  IconViewOptions,
} from "@rae/design-system/icons";
import type { SnapshotList } from "../lib/api.ts";
import { useExplorer } from "../store.ts";


export interface ToolbarProps {
  list?: SnapshotList;
  onScan: () => void;
  /** Scans a folder or file right away with the remembered settings (Rescan, a pasted path). */
  onScanPath: (path: string) => void;
  onManageSnapshots: () => void;
}

/** The app bar: mark, the project switcher and git, history, view options and Open. A comparison adds the `DiffBar` under it. */
export function Toolbar({ list, onScan, onScanPath, onManageSnapshots }: ToolbarProps) {
  const visible = useExplorer((s) => s.visible);
  const canUndo = useExplorer((s) => s.past.length > 0);
  const canRedo = useExplorer((s) => s.future.length > 0);
  const { relayout, undo, redo } = useExplorer.getState();
  // a quiet refresh in the background: a small note instead of the progress card
  const updating = useExplorer((s) => !!s.scan?.quiet && (s.scan.phase === "structure" || s.scan.phase === "types"));

  return (
    <Flex align="center" gap="2.5" pl="3.5" pr="3" h="44px" flexShrink={0} minW="0" bg="panel.bg" borderBottomWidth="1px" borderColor="border">
      <Flex align="center" gap="9px" flexShrink={0}>
        <BrandMark size={22} />
        <Text fontSize={textPx(13)} fontWeight="bold" letterSpacing="0.04em" color="fg" aria-label="React App Explorer" title="React App Explorer">
          RAE
        </Text>
      </Flex>
      <Divider />

      {/* the project (switch, refresh, open another), then git (branch, compare); a comparison's controls are on the Git bar under this one */}
      <Flex flex="1" minW="0" align="center" gap="1.5">
        <FolderSwitcher list={list} onScanPath={onScanPath} onBrowse={onScan} onManage={onManageSnapshots} />
        <GitControls />
        {updating && (
          <Tooltip content="Reading the latest changes in the background: they show when it's done">
            <Flex align="center" gap="1.5" px="1.5" flexShrink={0} fontSize={textPx(12)} color="fg.subtle" role="status">
              <Spinner size="xs" /> Updating…
            </Flex>
          </Tooltip>
        )}
      </Flex>

      <ToolGroup>
        <BarIcon label="Undo (⌘Z)" icon={<IconUndo />} onClick={undo} disabled={!canUndo} />
        <BarIcon label="Redo (⇧⌘Z)" icon={<IconRedo />} onClick={redo} disabled={!canRedo} />
        <BarIcon label="Re-layout everything" icon={<IconLayout />} onClick={relayout} disabled={!visible.length} />
        <SettingsButton />
      </ToolGroup>
      <Divider />
      <Button size="xs" h="30px" px="11px" variant="outline" borderColor="border.emphasized" bg="bg.subtle" _hover={{ bg: "border" }} fontSize={textPx(12.5)} fontWeight="medium" gap="7px" rounded="l2" onClick={onScan} aria-label="Open project…">
        <IconFolderOpen size={14} /> Open
      </Button>
    </Flex>
  );
}

const Divider = () => <Box w="1px" h="18px" bg="card.border" flexShrink={0} />;

function BarIcon(props: { label: string; icon: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <ActionIconButton size="xs" w="30px" h="30px" minW="30px" color="kind.module.fg" css={{ "& svg": { width: "15px", height: "15px" } }} {...props} />;
}

/** Opens and closes the settings sheet (components/settings/SettingsSheet.tsx); pressed while it's open. */
function SettingsButton() {
  const open = useExplorer((s) => s.settingsOpen);
  return (
    <ActionIconButton
      label="Settings (⌘,)"
      icon={<IconViewOptions />}
      size="xs"
      w="30px"
      h="30px"
      minW="30px"
      color="kind.module.fg"
      bg={open ? "bg.muted" : undefined}
      aria-pressed={open}
      css={{ "& svg": { width: "15px", height: "15px" } }}
      onClick={() => useExplorer.getState().setSettingsOpen(!open)}
    />
  );
}
