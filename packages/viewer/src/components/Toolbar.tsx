import { ActionIconButton, Box, BrandMark, Button, Flex, SegmentedToggles, Select, type SelectOption, Text, ToolGroup, Tooltip } from "@rae/design-system";
import { projectName, shortPath } from "../lib/paths.ts";
import { IconAsset, IconClear, IconHistory, IconLayout, IconLibrary, IconPlus, IconRedo, IconScan, IconUndo, IconUpload } from "@rae/design-system/icons";
import { type ReactNode, useEffect, useRef } from "react";
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
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const canUndo = useExplorer((s) => s.past.length > 0);
  const canRedo = useExplorer((s) => s.future.length > 0);
  const { setSearchOpen, clear, toggleGroup, relayout, setEditor, setShowAssets, undo, redo } = useExplorer.getState();
  const fileRef = useRef<HTMLInputElement>(null);

  // grouped by the scanned folder (newest first, as the list comes), each entry its date and size
  const options: SelectOption[] = (list?.snapshots ?? []).map((s) => ({
    value: s.file,
    label: `${new Date(s.createdAt).toLocaleString()}${s.nodeCount ? ` · ${s.nodeCount} nodes` : ""}`,
    group: s.rootDir ? `${projectName(s.rootDir)} — ${shortPath(s.rootDir)}` : "Other",
  }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current });

  return (
    <Flex align="center" gap="2.5" px="3" h="14" flexShrink={0} minW="0">
      {/* brand */}
      <Flex align="center" gap="2.5" flexShrink={0} pl="1" pr="1">
        <BrandMark size={30} />
        <Box lineHeight="1.1" display="none" css={{ "@media (min-width: 1800px)": { display: "block" } }}>
          <Text fontSize="sm" fontWeight="bold" letterSpacing="-0.02em">
            App Explorer
          </Text>
          <Text fontSize="2xs" color="fg.subtle" fontWeight="medium">
            React · Next.js
          </Text>
        </Box>
      </Flex>

      {/* workspace: the scanned project, its snapshot, scanning */}
      <ToolGroup pl="3" gap="2" flexShrink={0}>
        {snapshot ? (
          <Tooltip content={`Scanned folder: ${snapshot.rootDir}`}>
            <Box minW="0" maxW="140px" flexShrink={0} lineHeight="1.15" css={{ "@media (min-width: 1600px)": { maxWidth: "220px" } }}>
              <Text fontSize="sm" fontWeight="semibold" truncate letterSpacing="-0.01em">
                {projectName(snapshot.rootDir)}
              </Text>
              <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" truncate>
                {shortPath(snapshot.rootDir)}
              </Text>
            </Box>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
            No project
          </Text>
        )}
        <Box w="1px" h="6" bg="shell.border" flexShrink={0} />
        <Tooltip content={list ? `Snapshots in ${list.dir}` : "Snapshots"}>
          <Box flexShrink={0}>
            <Select
              value={current ?? ""}
              onValueChange={onPickSnapshot}
              options={options}
              placeholder={options.length ? "Select snapshot" : "No snapshots found"}
              width="168px"
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
        <Flex gap="0.5" flexShrink={0}>
          <ActionIconButton label="Scan a project…" icon={<IconScan />} size="xs" onClick={onScan} />
          <ActionIconButton label="Manage snapshots…" icon={<IconHistory />} size="xs" onClick={onManageSnapshots} disabled={!list?.snapshots.length} />
          <ActionIconButton label="Load snapshot file…" icon={<IconUpload />} size="xs" onClick={() => fileRef.current?.click()} />
        </Flex>
      </ToolGroup>
      {snapshot && (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" display="none" css={{ "@media (min-width: 2400px)": { display: "block" } }}>
          {snapshot.framework} · {snapshot.stats.files} files · {visible.length} shown
        </Text>
      )}

      <Box flex="1" />

      {/* relation filters, with their canvas colours */}
      {/* the relation toggles shrink (scrolling sideways) rather than push the toolbar off-screen */}
      <FadingRow>
      <SegmentedToggles
        label="Relations"
        items={EDGE_GROUPS.map(({ group, label }) => ({ value: group, label, color: GROUP_COLOR[group], on: enabled[group] }))}
        onToggle={(g) => toggleGroup(g as EdgeGroup)}
      />
      </FadingRow>

      {/* view options */}
      <ToolGroup>
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

      <Button size="sm" rounded="l3" onClick={() => setSearchOpen(true)} disabled={!snapshot} px="4" shadow="0 1px 2px rgb(15 23 42 / 0.2), inset 0 1px 0 rgb(255 255 255 / 0.12)">
        <IconPlus size={16} /> Add
      </Button>
    </Flex>
  );
}

/** A row that scrolls sideways when it doesn't fit (the relation filters), fading out at its end while more is hidden there. */
function FadingRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => el.toggleAttribute("data-overflow", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
  }, []);
  return (
    <Box
      ref={ref}
      minW="0"
      flexShrink={1}
      overflowX="auto"
      css={{
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        "&[data-overflow]": { maskImage: "linear-gradient(to right, black calc(100% - 40px), transparent)" },
      }}
    >
      {children}
    </Box>
  );
}
