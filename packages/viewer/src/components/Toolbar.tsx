import { ActionIconButton, Box, BrandMark, Button, DIAGRAM_PALETTES, type DiagramPaletteId, Flex, Popover, Select, Spinner, setColorMode, setDiagramPalette, setTextSize, Stack, SwitchField, Text, TEXT_SIZES, textPx, type TextSize, ToolGroup, Tooltip, useColorMode, useDiagramPalette, useTextSize } from "@rae/design-system";
import { FolderSwitcher } from "./FolderSwitcher.tsx";
import { GitControls } from "./git/GitControls.tsx";
import {
  IconClear,
  IconLayout,
  IconLibrary,
  IconRedo,
  IconFolderOpen,
  IconUndo,
  IconViewOptions,
} from "@rae/design-system/icons";
import { useState } from "react";
import { EDITORS, type EditorKind } from "../lib/editor.ts";
import type { SnapshotList } from "../lib/api.ts";
import { useExplorer } from "../store.ts";
import type { LayoutMode } from "../graph/squareLayout.ts";

const LAYOUT_MODES: { value: LayoutMode; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "tree", label: "Tree" },
];

export interface ToolbarProps {
  list?: SnapshotList;
  onScan: () => void;
  /** Scans a folder or file right away with the remembered settings (Rescan, a pasted path). */
  onScanPath: (path: string) => void;
  onManageSnapshots: () => void;
  onLibraries: () => void;
}

/** The app bar: mark, the project switcher and git, history, view options and Open. A comparison adds the `DiffBar` under it. */
export function Toolbar({ list, onScan, onScanPath, onManageSnapshots, onLibraries }: ToolbarProps) {
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
        <ViewOptions onLibraries={onLibraries} />
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

/** View options: colour mode, asset files, hidden libraries, the editor files open in, clearing the canvas. */
function ViewOptions({ onLibraries }: { onLibraries: () => void }) {
  const [open, setOpen] = useState(false);
  const mode = useColorMode();
  const textSize = useTextSize();
  const palette = useDiagramPalette();
  const editor = useExplorer((s) => s.editor);
  const editors = useExplorer((s) => s.editors);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const visible = useExplorer((s) => s.visible);
  const layoutMode = useExplorer((s) => s.layoutMode);
  const { setEditor, setShowAssets, clear, setLayoutMode } = useExplorer.getState();
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="View options"
      placement="bottom"
      width="310px"
      trigger={
        <Box display="inline-flex">
          <BarIcon label="View options" icon={<IconViewOptions />} />
        </Box>
      }
    >
      <Stack gap="0" fontSize={textPx(12.5)}>
        <Text textStyle="panelLabel" color="fg.subtle" px="3.5" pt="3" pb="2">
          View
        </Text>
        <Row label="Text size" hint="Panels and toolbar">
          <Select value={textSize} onValueChange={(v) => setTextSize(v as TextSize)} options={TEXT_SIZES} width="130px" size="xs" label="Text size" />
        </Row>
        <Row label="Layout" hint={layoutMode === "tree" ? "Callers above what they call" : "Each folder in a square"}>
          <Select value={layoutMode} onValueChange={(v) => setLayoutMode(v as LayoutMode)} options={LAYOUT_MODES} width="130px" size="xs" label="Layout" />
        </Row>
        <Row label="Diagram colours" hint={DIAGRAM_PALETTES.find((p) => p.value === palette)?.hint}>
          <Select value={palette} onValueChange={(v) => setDiagramPalette(v as DiagramPaletteId)} options={DIAGRAM_PALETTES} width="130px" size="xs" label="Diagram colours" />
        </Row>
        <SwitchField size="xs" px="3.5" minH="36px" label="Dark mode" checked={mode === "dark"} onCheckedChange={(on) => setColorMode(on ? "dark" : "light")} />
        <SwitchField size="xs" px="3.5" minH="36px" label="Asset files" hint="CSS, images, JSON" checked={showAssets} onCheckedChange={setShowAssets} />
        <Row label="Libraries" hint={hideAllLibraries ? "all hidden" : excluded.length ? `${excluded.length} hidden` : "all shown"}>
          <Button
            size="2xs"
            variant="outline"
            rounded="l2"
            onClick={() => {
              setOpen(false);
              onLibraries();
            }}
          >
            <IconLibrary size={12} /> Choose…
          </Button>
        </Row>
        {editors && !editors.length ? (
          <Box pb="2">
            <Row label="Open files in">
              <Select value="" onValueChange={() => {}} options={[]} placeholder="No editor found" width="130px" size="xs" label="Open files in" disabled />
            </Row>
            <Text px="3.5" fontSize={textPx(11)} color="fg.subtle">
              To open files from here, install IntelliJ IDEA, WebStorm, VS Code, Cursor or Zed (then restart the app).
            </Text>
          </Box>
        ) : (
          <Row label="Open files in">
            <Select value={editor} onValueChange={(v) => setEditor(v as EditorKind)} options={editors ? EDITORS.filter((e) => editors.includes(e.value)) : EDITORS} width="130px" size="xs" label="Open files in" />
          </Row>
        )}
        <Box borderTopWidth="1px" borderColor="border.muted" mt="1" p="2">
          <Button
            size="xs"
            variant="ghost"
            w="full"
            justifyContent="start"
            rounded="l2"
            color="fg.muted"
            disabled={!visible.length}
            onClick={() => {
              clear();
              setOpen(false);
            }}
          >
            <IconClear size={14} /> Clear the canvas
          </Button>
        </Box>
      </Stack>
    </Popover>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Flex align="center" gap="3" px="3.5" minH="36px">
      <Box flex="1" minW="0">
        <Text>{label}</Text>
        {hint && (
          <Text fontSize={textPx(11)} color="fg.subtle">
            {hint}
          </Text>
        )}
      </Box>
      {children}
    </Flex>
  );
}
