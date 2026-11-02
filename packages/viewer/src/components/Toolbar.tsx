import { ActionIconButton, Box, Button, Flex, SegmentedToggles, Select, Text, ToolGroup, Tooltip } from "@rae/design-system";
import { IconAsset, IconRoute, IconBrand, IconClear, IconFolderTree, IconHistory, IconLayout, IconLibrary, IconPlus, IconRedo, IconScan, IconUndo, IconUpload } from "@rae/design-system/icons";
import { useRef } from "react";
import { EDGE_GROUPS, type EdgeGroup } from "../graph/relations.ts";
import { EDITORS, type EditorKind } from "../lib/editor.ts";
import type { SnapshotList } from "../lib/api.ts";
import { useExplorer } from "../store.ts";

/** Each relation filter's dot: the same colour as its edges on the canvas. */
const GROUP_COLOR: Record<EdgeGroup, string> = {
  imports: "relation.imports",
  declares: "relation.declares",
  renders: "relation.renders",
  hooks: "relation.usesHook",
  invokes: "relation.invokes",
  types: "relation.usesType",
  navigation: "relation.navigates",
  cache: "relation.invalidates",
};

/** A view button's text: below 2080px only the icon shows (the tooltip says what it is), so the toolbar fits. */
function Label({ children }: { children: string }) {
  return (
    <Text as="span" display="none" css={{ "@media (min-width: 2080px)": { display: "inline" } }}>
      {children}
    </Text>
  );
}

export interface ToolbarProps {
  list?: SnapshotList;
  current?: string;
  onPickSnapshot: (file: string) => void;
  onLoadFile: (file: File) => void;
  onScan: () => void;
  onManageSnapshots: () => void;
  onLibraries: () => void;
}

export function Toolbar({ list, current, onPickSnapshot, onLoadFile, onScan, onManageSnapshots, onLibraries }: ToolbarProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const enabled = useExplorer((s) => s.enabled);
  const editor = useExplorer((s) => s.editor);
  const folders = useExplorer((s) => s.folders);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const routes = useExplorer((s) => s.routes);
  const hasRoutes = snapshot?.framework === "next-app" && Object.values(snapshot.nodes).some((n) => n.kind === "route");
  const canUndo = useExplorer((s) => s.past.length > 0);
  const canRedo = useExplorer((s) => s.future.length > 0);
  const { setSearchOpen, clear, toggleGroup, relayout, setEditor, setFolders, setShowAssets, setRoutes, undo, redo } = useExplorer.getState();
  const fileRef = useRef<HTMLInputElement>(null);

  const options = (list?.snapshots ?? []).map((s) => ({
    value: s.file,
    label: `${s.rootDir ? `${s.rootDir.split("/").pop()} · ` : ""}${new Date(s.createdAt).toLocaleString()}${s.nodeCount ? ` · ${s.nodeCount} nodes` : ""}`,
  }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current });

  return (
    <Flex align="center" gap="2.5" px="4" h="14" borderBottomWidth="1px" borderColor="border.muted" bg="bg.panel" flexShrink={0} minW="0">
      {/* brand */}
      <Flex align="center" gap="2" flexShrink={0} title="React App Explorer">
        <Box
          w="8"
          h="8"
          rounded="l3"
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          color="white"
          style={{ background: "linear-gradient(135deg, var(--chakra-colors-component-400), var(--chakra-colors-component-700))", boxShadow: "0 2px 8px color-mix(in srgb, var(--chakra-colors-component-500) 40%, transparent)" }}
        >
          <IconBrand size={17} strokeWidth={2.2} />
        </Box>
        <Text fontWeight="semibold" fontSize="sm" letterSpacing="-0.01em" display="none" css={{ "@media (min-width: 2240px)": { display: "block" } }}>
          App Explorer
        </Text>
      </Flex>

      {/* snapshot */}
      <ToolGroup>
        <Tooltip content={list ? `From ${list.dir}` : "Snapshots"}>
          <Box>
            <Select
              value={current ?? ""}
              onValueChange={onPickSnapshot}
              options={options}
              placeholder={options.length ? "Select snapshot" : "No snapshots found"}
              width="196px"
              size="xs"
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
        <ActionIconButton label="Load snapshot file…" icon={<IconUpload />} size="xs" onClick={() => fileRef.current?.click()} />
        <ActionIconButton label="Scan a project…" icon={<IconScan />} size="xs" onClick={onScan} />
        <ActionIconButton label="Manage snapshots…" icon={<IconHistory />} size="xs" onClick={onManageSnapshots} disabled={!list?.snapshots.length} />
      </ToolGroup>
      {snapshot && (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" display="none" css={{ "@media (min-width: 2400px)": { display: "block" } }}>
          {snapshot.framework} · {snapshot.stats.files} files · {visible.length} shown
        </Text>
      )}

      <Box flex="1" />

      {/* relation filters, with their canvas colours */}
      {/* the relation toggles shrink (scrolling sideways) rather than push the toolbar off-screen */}
      <Box minW="0" flexShrink={1} overflowX="auto" css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
      <SegmentedToggles
        label="Relations"
        items={EDGE_GROUPS.map(({ group, label }) => ({ value: group, label, color: GROUP_COLOR[group], on: enabled[group] }))}
        onToggle={(g) => toggleGroup(g as EdgeGroup)}
      />
      </Box>

      {/* view options */}
      <ToolGroup>
        <Tooltip content="Draw folders as frames around files">
          <Button size="xs" variant={folders ? "surface" : "ghost"} onClick={() => setFolders(!folders)} aria-pressed={folders} aria-label="Folders" rounded="l2">
            <IconFolderTree size={14} /> <Label>Folders</Label>
          </Button>
        </Tooltip>
        {hasRoutes && (
          <Tooltip content="Draw Next.js routes as frames around their pages, layouts and API handlers">
            <Button size="xs" variant={routes ? "surface" : "ghost"} onClick={() => setRoutes(!routes)} aria-pressed={routes} aria-label="Routes" rounded="l2">
              <IconRoute size={14} /> <Label>Routes</Label>
            </Button>
          </Tooltip>
        )}
        <Tooltip content={showAssets ? "Asset files (CSS, images, JSON) are shown" : "Show asset files (CSS, images, JSON)"}>
          <Button size="xs" variant={showAssets ? "surface" : "ghost"} onClick={() => setShowAssets(!showAssets)} aria-pressed={showAssets} aria-label="Assets" rounded="l2">
            <IconAsset size={14} /> <Label>Assets</Label>
          </Button>
        </Tooltip>
        <Tooltip content={hideAllLibraries ? "All 3rd-party libraries hidden" : `${excluded.length} libraries hidden: ${excluded.join(", ") || "none"}`}>
          <Button size="xs" variant="ghost" onClick={onLibraries} aria-label={hideAllLibraries ? "Libraries all" : excluded.length ? `Libraries ${excluded.length}` : "Libraries"} rounded="l2">
            <IconLibrary size={14} /> <Label>Libraries</Label>
            {(hideAllLibraries || excluded.length > 0) && (
              <Text as="span" fontSize="2xs" fontWeight="semibold" bg="bg.panel" px="1.5" rounded="full" color="fg.muted">
                {hideAllLibraries ? "all" : excluded.length}
              </Text>
            )}
          </Button>
        </Tooltip>
        <Select value={editor} onValueChange={(v) => setEditor(v as EditorKind)} options={EDITORS} width="118px" size="xs" />
      </ToolGroup>

      {/* history & canvas */}
      <ToolGroup>
        <ActionIconButton label="Undo (⌘Z)" icon={<IconUndo />} size="xs" onClick={undo} disabled={!canUndo} />
        <ActionIconButton label="Redo (⇧⌘Z)" icon={<IconRedo />} size="xs" onClick={redo} disabled={!canRedo} />
        <ActionIconButton label="Re-layout everything" icon={<IconLayout />} size="xs" onClick={relayout} disabled={!visible.length} />
        <ActionIconButton label="Clear canvas" icon={<IconClear />} size="xs" onClick={clear} disabled={!visible.length} />
      </ToolGroup>

      <Button size="sm" rounded="l3" onClick={() => setSearchOpen(true)} disabled={!snapshot} px="4">
        <IconPlus size={16} /> Add
      </Button>
    </Flex>
  );
}
