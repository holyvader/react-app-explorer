import { ActionIconButton, Box, Button, Flex, Heading, HStack, Select, Separator, Text, Tooltip } from "@rae/design-system";
import { IconClear, IconFolderTree, IconLayout, IconLibrary, IconPlus, IconRedo, IconScan, IconUndo, IconUpload } from "@rae/design-system/icons";
import { useRef } from "react";
import { EDGE_GROUPS } from "../graph/relations.ts";
import { EDITORS, type EditorKind } from "../lib/editor.ts";
import type { SnapshotList } from "../lib/api.ts";
import { useExplorer } from "../store.ts";

export interface ToolbarProps {
  list?: SnapshotList;
  current?: string;
  onPickSnapshot: (file: string) => void;
  onLoadFile: (file: File) => void;
  onScan: () => void;
  onLibraries: () => void;
}

export function Toolbar({ list, current, onPickSnapshot, onLoadFile, onScan, onLibraries }: ToolbarProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const enabled = useExplorer((s) => s.enabled);
  const editor = useExplorer((s) => s.editor);
  const folders = useExplorer((s) => s.folders);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const canUndo = useExplorer((s) => s.past.length > 0);
  const canRedo = useExplorer((s) => s.future.length > 0);
  const { setSearchOpen, clear, toggleGroup, relayout, setEditor, setFolders, undo, redo } = useExplorer.getState();
  const fileRef = useRef<HTMLInputElement>(null);

  const options = (list?.snapshots ?? []).map((s) => ({
    value: s.file,
    label: `${s.rootDir ? `${s.rootDir.split("/").pop()} · ` : ""}${new Date(s.createdAt).toLocaleString()}${s.nodeCount ? ` · ${s.nodeCount} nodes` : ""}`,
  }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current });

  return (
    <Flex align="center" gap="2" px="3" py="2" borderBottomWidth="1px" borderColor="border" bg="bg.panel" wrap="wrap">
      <Heading size="sm" whiteSpace="nowrap" title="React App Explorer">
        RAE
      </Heading>
      <Separator orientation="vertical" h="6" />
      <Tooltip content={list ? `From ${list.dir}` : "Snapshots"}>
        <Box>
          <Select
            value={current ?? ""}
            onValueChange={onPickSnapshot}
            options={options}
            placeholder={options.length ? "Select snapshot" : "No snapshots found"}
            width="260px"
          />
        </Box>
      </Tooltip>
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
      <ActionIconButton label="Load snapshot file…" icon={<IconUpload />} variant="outline" size="sm" onClick={() => fileRef.current?.click()} />
      <ActionIconButton label="Scan a project…" icon={<IconScan />} variant="outline" size="sm" onClick={onScan} />
      {snapshot && (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
          {snapshot.framework} · {snapshot.stats.files} files · {visible.length} shown
        </Text>
      )}
      <Box flex="1" />
      <HStack gap="1">
        {EDGE_GROUPS.map(({ group, label }) => (
          <Button key={group} size="2xs" px="1.5" variant={enabled[group] ? "subtle" : "ghost"} opacity={enabled[group] ? 1 : 0.5} onClick={() => toggleGroup(group)} aria-pressed={enabled[group]}>
            {label}
          </Button>
        ))}
      </HStack>
      <Separator orientation="vertical" h="6" />
      <Select value={editor} onValueChange={(v) => setEditor(v as EditorKind)} options={EDITORS} width="120px" size="xs" />
      <Tooltip content="Draw folders as frames around files">
        <Button size="xs" variant={folders ? "subtle" : "ghost"} onClick={() => setFolders(!folders)} aria-pressed={folders}>
          <IconFolderTree size={14} /> Folders
        </Button>
      </Tooltip>
      <Tooltip content={hideAllLibraries ? "All 3rd-party libraries hidden" : `${excluded.length} libraries hidden: ${excluded.join(", ") || "none"}`}>
        <Button size="xs" variant="ghost" onClick={onLibraries}>
          <IconLibrary size={14} /> Libraries{hideAllLibraries ? " (all hidden)" : excluded.length ? ` (${excluded.length} hidden)` : ""}
        </Button>
      </Tooltip>
      <ActionIconButton label="Undo (⌘Z)" icon={<IconUndo />} size="sm" onClick={undo} disabled={!canUndo} />
      <ActionIconButton label="Redo (⇧⌘Z)" icon={<IconRedo />} size="sm" onClick={redo} disabled={!canRedo} />
      <ActionIconButton label="Re-layout everything" icon={<IconLayout />} size="sm" onClick={relayout} disabled={!visible.length} />
      <ActionIconButton label="Clear canvas" icon={<IconClear />} size="sm" onClick={clear} disabled={!visible.length} />
      <Button size="sm" onClick={() => setSearchOpen(true)} disabled={!snapshot}>
        <IconPlus size={16} /> Add
      </Button>
    </Flex>
  );
}
