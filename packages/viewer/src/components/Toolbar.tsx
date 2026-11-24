import { ActionIconButton, Box, BrandMark, Button, ContextMenu, Flex, Popover, Select, setColorMode, setTextSize, Stack, SwitchField, Text, TEXT_SIZES, textPx, type TextSize, ToolGroup, Tooltip, type MenuEntry, useColorMode, useTextSize } from "@rae/design-system";
import { projectName } from "../lib/paths.ts";
import { FolderSwitcher, when } from "./FolderSwitcher.tsx";
import {
  IconBranch,
  IconChevronDown,
  IconClear,
  IconHistory,
  IconLayout,
  IconLibrary,
  IconOpen,
  IconRedo,
  IconScan,
  IconUndo,
  IconViewOptions,
} from "@rae/design-system/icons";
import { useRef, useState } from "react";
import { sideLabel } from "../lib/diff.ts";
import type { SnapshotDiff } from "@rae/schema";
import { EDITORS, type EditorKind, openRequestPage } from "../lib/editor.ts";
import type { SnapshotList } from "../lib/api.ts";
import { type DiffMode, diffModeOf, useExplorer } from "../store.ts";

export interface ToolbarProps {
  list?: SnapshotList;
  current?: string;
  onPickSnapshot: (file: string) => void;
  onLoadFile: (file: File) => void;
  onScan: () => void;
  /** Scans a folder or file right away with the remembered settings (Rescan, a pasted path). */
  onScanPath: (path: string) => void;
  onManageSnapshots: () => void;
  onLibraries: () => void;
}

/** The app bar: mark, the folder switcher and its snapshot (a diff's chip and overlay switch), history, view options and Scan. */
export function Toolbar({ list, current, onPickSnapshot, onLoadFile, onScan, onScanPath, onManageSnapshots, onLibraries }: ToolbarProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const canUndo = useExplorer((s) => s.past.length > 0);
  const canRedo = useExplorer((s) => s.future.length > 0);
  const { relayout, undo, redo } = useExplorer.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const snapshots = list?.snapshots ?? [];
  const currentEntry = snapshots.find((s) => s.file === current);
  // the open folder's snapshots, newest first: the menu of the date beside the switcher
  const own = snapshot?.rootDir ? snapshots.filter((s) => s.rootDir === snapshot.rootDir).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const entries: MenuEntry[] = [
    { type: "label", label: `Snapshots of ${snapshot ? projectName(snapshot.rootDir) : "this folder"}` },
    ...own.map(
      (s): MenuEntry => ({
        type: "item",
        value: s.file,
        label: s.diff ? `${when(s.createdAt)} · diff ${s.diff.base.split(" ")[0]} ← ${s.diff.head.split(" ")[0]}` : when(s.createdAt),
        hint: s.file === current ? "open" : s.diff ? `${s.diff.changes} changes` : s.nodeCount ? `${s.nodeCount} nodes` : undefined,
        onSelect: () => onPickSnapshot(s.file),
      }),
    ),
    { type: "separator" },
    { type: "item", value: "manage", label: "Manage all snapshots…", icon: <IconHistory size={14} />, onSelect: onManageSnapshots },
  ];

  return (
    <Flex align="center" gap="2.5" pl="3.5" pr="3" h="44px" flexShrink={0} minW="0" bg="panel.bg" borderBottomWidth="1px" borderColor="border">
      <Flex align="center" gap="9px" flexShrink={0}>
        <BrandMark size={22} />
        <Text fontSize={textPx(13)} fontWeight="bold" letterSpacing="0.04em" color="fg" aria-label="React App Explorer" title="React App Explorer">
          RAE
        </Text>
      </Flex>
      <Divider />

      {/* the folder in the middle (switch, rescan, open another), then which of its snapshots is open */}
      <Flex flex="1" minW="0" align="center" justify="center" gap="1.5">
        <FolderSwitcher list={list} onPickSnapshot={onPickSnapshot} onScanPath={onScanPath} onBrowse={onScan} onLoadFile={() => fileRef.current?.click()} />
        {currentEntry && own.length > 0 && (
          <Tooltip content={`${own.length} snapshot${own.length === 1 ? "" : "s"} of this folder`}>
            <Flex
              as="button"
              align="center"
              gap="1.5"
              h="30px"
              px="2"
              rounded="l2"
              flexShrink={0}
              cursor="pointer"
              fontFamily="mono"
              fontSize={textPx(11.5)}
              color="fg.muted"
              whiteSpace="nowrap"
              _hover={{ bg: "bg.muted" }}
              aria-haspopup="menu"
              aria-label={`Snapshot from ${when(currentEntry.createdAt)}: choose another`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenuAt({ x: r.left, y: r.bottom + 4 });
              }}
            >
              <IconHistory size={13} /> {when(currentEntry.createdAt)}
              <IconChevronDown size={13} />
            </Flex>
          </Tooltip>
        )}
        {snapshot?.diff && <DiffChip diff={snapshot.diff} />}
        {snapshot?.diff && <DiffModeSelect />}
      </Flex>
      <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} entries={entries} />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadFile(f);
          e.target.value = "";
        }}
      />

      <ToolGroup>
        <BarIcon label="Undo (⌘Z)" icon={<IconUndo />} onClick={undo} disabled={!canUndo} />
        <BarIcon label="Redo (⇧⌘Z)" icon={<IconRedo />} onClick={redo} disabled={!canRedo} />
        <BarIcon label="Re-layout everything" icon={<IconLayout />} onClick={relayout} disabled={!visible.length} />
        <ViewOptions onLibraries={onLibraries} />
      </ToolGroup>
      <Divider />
      <Button size="xs" h="30px" px="11px" variant="outline" borderColor="border.emphasized" bg="bg.subtle" _hover={{ bg: "border" }} fontSize={textPx(12.5)} fontWeight="medium" gap="7px" rounded="l2" onClick={onScan} aria-label="Scan a project…">
        <IconScan size={14} /> Scan
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
  const editor = useExplorer((s) => s.editor);
  const editors = useExplorer((s) => s.editors);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const visible = useExplorer((s) => s.visible);
  const { setEditor, setShowAssets, clear } = useExplorer.getState();
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

const DIFF_MODES = [
  { value: "off", label: "Off" },
  { value: "overlay", label: "Overlay" },
  { value: "code", label: "Overlay + code" },
];

/**
 * The diff view, on the bar while a diff is open: off, the overlay (what changed in colour, removed
 * elements as ghosts), or the overlay plus the selected element's changed lines in a card under it.
 */
function DiffModeSelect() {
  const mode = useExplorer(diffModeOf);
  return (
    <Tooltip content="Diff view — Overlay: what changed in colour, removed elements as ghosts. Overlay + code: also the changed lines in the tooltip of a changed element.">
      <Flex align="center" gap="1.5" flexShrink={0} fontSize={textPx(12)} color="fg.muted">
        <Text as="span">Diff</Text>
        <Select value={mode} onValueChange={(v) => useExplorer.getState().setDiffMode(v as DiffMode)} options={DIFF_MODES} width="140px" size="xs" label="Diff view" />
      </Flex>
    </Tooltip>
  );
}

/** What a diff compares: `main ← #12 Fix footer` (a PR / MR, with a link to its page), `main ← feature 1a2b3c4`. */
function DiffChip({ diff }: { diff: SnapshotDiff }) {
  const req = diff.head.request;
  const head = req ? `${req.provider === "github" ? "#" : "!"}${req.number}${req.title ? ` ${req.title}` : ""}` : sideLabel(diff.head.ref, diff.head.sha, diff.head.worktree);
  const tip = [
    req?.title ? `${req.provider === "github" ? "Pull" : "Merge"} request ${req.provider === "github" ? "#" : "!"}${req.number}: ${req.title}${req.author ? ` (${req.author})` : ""}` : undefined,
    `Comparing ${diff.head.ref} (${diff.head.sha.slice(0, 7)}${diff.head.subject ? `: ${diff.head.subject}` : ""})`,
    `with ${diff.against === "merge-base" ? `its merge-base with ${diff.base.ref}` : diff.base.ref} (${diff.compared.slice(0, 7)})`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Flex align="center" gap="0.5" flexShrink={1} minW="0">
      <Tooltip content={tip}>
        <Flex align="center" gap="1.5" h="24px" px="2" rounded="l2" minW="0" fontFamily="mono" fontSize={textPx(11)} color="diff.changed.fg" bg="diff.changed.subtle">
          <IconBranch size={12} />
          <Text as="span" truncate maxW="360px">
            {sideLabel(diff.base.ref, diff.compared).split(" ")[0]} ← {head}
          </Text>
        </Flex>
      </Tooltip>
      {req?.url && (
        <ActionIconButton
          label={`Open ${req.provider === "github" ? "the pull request on GitHub" : "the merge request on GitLab"}`}
          icon={<IconOpen />}
          size="2xs"
          color="diff.changed.fg"
          onClick={() => void openRequestPage(req.url!).catch((e: Error) => useExplorer.getState().notify(e.message))}
        />
      )}
    </Flex>
  );
}
