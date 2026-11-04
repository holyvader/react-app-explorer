import {
  ActionIconButton,
  Box,
  BrandMark,
  Button,
  ContextMenu,
  Flex,
  type MenuEntry,
  Popover,
  Select,
  Stack,
  Switch,
  Text,
  ToolGroup,
  Tooltip,
  setColorMode,
  useColorMode,
} from "@rae/design-system";
import { projectName, shortPath } from "../lib/paths.ts";
import {
  IconBranch,
  IconChevronDown,
  IconClear,
  IconHistory,
  IconLayout,
  IconLibrary,
  IconPlus,
  IconRedo,
  IconScan,
  IconSearch,
  IconUndo,
  IconUpload,
  IconViewOptions,
} from "@rae/design-system/icons";
import { useRef, useState } from "react";
import { sideLabel } from "../lib/diff.ts";
import { EDITORS, type EditorKind } from "../lib/editor.ts";
import type { SnapshotList } from "../lib/api.ts";
import { useExplorer } from "../store.ts";

export interface ToolbarProps {
  list?: SnapshotList;
  current?: string;
  onPickSnapshot: (file: string) => void;
  onLoadFile: (file: File) => void;
  onScan: () => void;
  onManageSnapshots: () => void;
  onLibraries: () => void;
}

const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
/** "today 14:02", else "3 Nov 14:02": the snapshot's moment, short. */
const when = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${isToday(d) ? "today" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
};

/** The app bar: mark, project and snapshot, search (adds to the diagram), history, view options, Scan and Add. */
export function Toolbar({ list, current, onPickSnapshot, onLoadFile, onScan, onManageSnapshots, onLibraries }: ToolbarProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const canUndo = useExplorer((s) => s.past.length > 0);
  const canRedo = useExplorer((s) => s.future.length > 0);
  const { setSearchOpen, relayout, undo, redo } = useExplorer.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const snapshots = list?.snapshots ?? [];
  const currentEntry = snapshots.find((s) => s.file === current);
  // the snapshots grouped by the scanned folder (newest first, as the list comes)
  const groups = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const g = s.rootDir ? `${projectName(s.rootDir)} — ${shortPath(s.rootDir)}` : "Other";
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const entries: MenuEntry[] = [
    ...[...groups].flatMap(([group, items]): MenuEntry[] => [
      { type: "label", label: group },
      ...items.map(
        (s): MenuEntry => ({
          type: "item",
          value: s.file,
          label: s.diff ? `${when(s.createdAt)} · diff ${s.diff.base.split(" ")[0]} ← ${s.diff.head.split(" ")[0]}` : when(s.createdAt),
          hint: s.file === current ? "open" : s.diff ? `${s.diff.changes} changes` : s.nodeCount ? `${s.nodeCount} nodes` : undefined,
          onSelect: () => onPickSnapshot(s.file),
        }),
      ),
    ]),
    ...(snapshots.length ? [{ type: "separator" } as const] : []),
    { type: "item", value: "scan", label: "Scan a project…", icon: <IconScan size={14} />, onSelect: onScan },
    { type: "item", value: "manage", label: "Manage snapshots…", icon: <IconHistory size={14} />, onSelect: onManageSnapshots, disabled: !snapshots.length },
    { type: "item", value: "load", label: "Load snapshot file…", icon: <IconUpload size={14} />, onSelect: () => fileRef.current?.click() },
  ];

  return (
    <Flex align="center" gap="2.5" pl="3.5" pr="3" h="44px" flexShrink={0} minW="0" bg="panel.bg" borderBottomWidth="1px" borderColor="border">
      <Flex align="center" gap="9px" flexShrink={0}>
        <BrandMark size={22} />
        <Text fontSize="13px" fontWeight="semibold">
          Explorer
        </Text>
      </Flex>
      <Divider />

      {/* the project and its snapshot: a menu of the snapshots, scanning, loading a file */}
      <Tooltip content={snapshot ? `Scanned folder: ${snapshot.rootDir}${list ? `\nSnapshots in ${list.dir}` : ""}` : list ? `Snapshots in ${list.dir}` : "Snapshots"}>
        <Flex
          as="button"
          align="center"
          gap="2"
          h="30px"
          px="9px"
          rounded="l2"
          fontSize="12.5px"
          minW="0"
          flexShrink={1}
          cursor="pointer"
          _hover={{ bg: "bg.muted" }}
          aria-haspopup="menu"
          aria-label={`Snapshots: ${snapshot ? projectName(snapshot.rootDir) : "none open"}${currentEntry ? `, ${when(currentEntry.createdAt)}` : ""}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Text as="span" fontWeight="medium" truncate>
            {snapshot ? projectName(snapshot.rootDir) : snapshots.length ? "Open a snapshot" : "No project"}
          </Text>
          {currentEntry && (
            <Text as="span" color="fg.subtle" fontFamily="mono" fontSize="11.5px" whiteSpace="nowrap">
              · {when(currentEntry.createdAt)}
            </Text>
          )}
          <Box color="fg.subtle" display="inline-flex" flexShrink={0}>
            <IconChevronDown size={13} />
          </Box>
        </Flex>
      </Tooltip>
      {snapshot?.diff && (
        <Tooltip
          content={`Comparing ${snapshot.diff.head.ref} (${snapshot.diff.head.sha.slice(0, 7)}${snapshot.diff.head.subject ? `: ${snapshot.diff.head.subject}` : ""})\nwith ${snapshot.diff.against === "merge-base" ? `its merge-base with ${snapshot.diff.base.ref}` : snapshot.diff.base.ref} (${snapshot.diff.compared.slice(0, 7)})`}
        >
          <Flex align="center" gap="1.5" h="24px" px="2" rounded="l2" flexShrink={1} minW="0" fontFamily="mono" fontSize="11px" color="diff.changed.fg" bg="diff.changed.subtle">
            <IconBranch size={12} />
            <Text as="span" truncate>
              {sideLabel(snapshot.diff.base.ref, snapshot.diff.compared).split(" ")[0]} ← {sideLabel(snapshot.diff.head.ref, snapshot.diff.head.sha, snapshot.diff.head.worktree)}
            </Text>
          </Flex>
        </Tooltip>
      )}
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

      {/* search: finds an element and adds it to the diagram (⌘K, Space on the canvas) */}
      <Flex flex="1" justify="center" minW="0">
        <Flex
          as="button"
          align="center"
          gap="2.5"
          w="440px"
          maxW="full"
          h="30px"
          pl="11px"
          pr="2"
          bg="syntax.bg"
          borderWidth="1px"
          borderColor="card.border"
          rounded="7px"
          color="fg.subtle"
          fontSize="12.5px"
          cursor={snapshot ? "text" : "default"}
          opacity={snapshot ? 1 : 0.5}
          aria-disabled={!snapshot}
          _hover={snapshot ? { borderColor: "border.emphasized" } : undefined}
          onClick={() => snapshot && setSearchOpen(true)}
          aria-label="Add an element (⌘K)"
        >
          <IconSearch size={14} />
          <Text as="span" flex="1" textAlign="left" truncate>
            Add an element…
          </Text>
          <Text as="span" fontFamily="mono" fontSize="10.5px" px="1.5" borderWidth="1px" borderColor="border.emphasized" rounded="l1" lineHeight="16px">
            ⌘K
          </Text>
        </Flex>
      </Flex>

      <ToolGroup>
        <BarIcon label="Undo (⌘Z)" icon={<IconUndo />} onClick={undo} disabled={!canUndo} />
        <BarIcon label="Redo (⇧⌘Z)" icon={<IconRedo />} onClick={redo} disabled={!canRedo} />
        <BarIcon label="Re-layout everything" icon={<IconLayout />} onClick={relayout} disabled={!visible.length} />
        <ViewOptions onLibraries={onLibraries} />
      </ToolGroup>
      <Divider />
      <Button size="xs" h="30px" px="11px" variant="outline" borderColor="border.emphasized" bg="bg.subtle" _hover={{ bg: "border" }} fontSize="12.5px" fontWeight="medium" gap="7px" rounded="l2" onClick={onScan} aria-label="Scan a project…">
        <IconScan size={14} /> Scan
      </Button>
      <Button size="xs" h="30px" px="11px" colorPalette="accent" fontSize="12.5px" fontWeight="semibold" gap="6px" rounded="l2" onClick={() => setSearchOpen(true)} disabled={!snapshot}>
        <IconPlus size={14} /> Add
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
  const editor = useExplorer((s) => s.editor);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const visible = useExplorer((s) => s.visible);
  const isDiff = useExplorer((s) => !!s.snapshot?.diff);
  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const { setEditor, setShowAssets, setDiffOverlay, clear } = useExplorer.getState();
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="View options"
      placement="bottom"
      width="280px"
      trigger={
        <Box display="inline-flex">
          <BarIcon label="View options" icon={<IconViewOptions />} />
        </Box>
      }
    >
      <Stack gap="0" fontSize="12.5px">
        <Text textStyle="panelLabel" color="fg.subtle" px="3.5" pt="3" pb="2">
          View
        </Text>
        <Row label="Dark mode">
          <Switch size="xs" label="Dark mode" checked={mode === "dark"} onCheckedChange={(on) => setColorMode(on ? "dark" : "light")} />
        </Row>
        {isDiff && (
          <Row label="Diff overlay" hint="What changed: colours, removed elements">
            <Switch size="xs" label="Diff overlay" checked={diffOverlay} onCheckedChange={setDiffOverlay} />
          </Row>
        )}
        <Row label="Asset files" hint="CSS, images, JSON">
          <Switch size="xs" label="Asset files" checked={showAssets} onCheckedChange={setShowAssets} />
        </Row>
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
        <Row label="Open files in">
          <Select value={editor} onValueChange={(v) => setEditor(v as EditorKind)} options={EDITORS} width="130px" size="xs" />
        </Row>
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
          <Text fontSize="11px" color="fg.subtle">
            {hint}
          </Text>
        )}
      </Box>
      {children}
    </Flex>
  );
}
