import type { NodeKind } from "@rae/schema";
import {
  ActionIconButton,
  Box,
  Button,
  Flex,
  HStack,
  KindTile,
  Panel,
  PanelHeader,
  PanelSection,
  Stack,
  TagChip,
  Text,
  Wrap,
} from "@rae/design-system";
import { IconArrowDown, IconArrowUp, IconChevronsDown, IconChevronsUp, IconClose, IconCopy, IconDetailsClose, IconFocus, IconFolder, IconLayout, IconPlus, IconRemove } from "@rae/design-system/icons";
import { useMemo } from "react";
import { FOLDER_PREFIX } from "../graph/drawn.ts";
import { folderContents, folderPath, parentFolders } from "../graph/folder.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { DetailsStrip } from "./DetailsStrip.tsx";
import { useExplorer, SIDEBAR_WIDTH } from "../store.ts";

/** Rows listed before "+N more" (the rest stays reachable via "Show the files inside"). */
const MAX_FILES = 120;
const KIND_ORDER: NodeKind[] = ["module", "component", "hook", "function", "serverAction"];

/** Details of a selected folder: what it contains, in the same visual language as other nodes. */
export function FolderDetails({ id, onDiagram = true }: { id: string; onDiagram?: boolean }) {
  const sidebarWidth = useExplorer((s) => s.sidebarWidth);
  const detailsOpen = useExplorer((s) => s.detailsOpen);
  const setSidebarWidth = useExplorer((s) => s.setSidebarWidth);
  const snapshot = useExplorer((s) => s.snapshot);
  const graph = useExplorer((s) => s.graph);
  const { select, expandFolder, addNodes, hideNode, arrange, showParentFolders } = useExplorer.getState();
  const path = folderPath(id);
  const c = useMemo(() => (snapshot ? folderContents(snapshot, path) : undefined), [snapshot, path]);
  const drawn = useMemo(() => new Set(graph.elements.map((e) => e.id)), [graph]);
  if (!snapshot || !c) return null;

  const name = path.slice(path.lastIndexOf("/") + 1);
  const total = c.files.length + c.declarations.filter((d) => !d.file).length;
  const declsIn = (fileId: string) => c.declarations.filter((d) => d.moduleId === fileId).length;
  const canFiles = c.files.some((f) => !drawn.has(f.id));
  const canAll = canFiles || c.declarations.some((d) => !drawn.has(d.id));
  const canParent = parentFolders(id, false).some((x) => !drawn.has(x));
  const canAllParents = parentFolders(id, true).filter((x) => !drawn.has(x)).length > 1;
  const missingSubs = c.subfolders.filter((f) => !drawn.has(`${FOLDER_PREFIX}${f.path}`));

  return (
    <Panel
      resize={{ width: sidebarWidth, onWidthChange: setSidebarWidth, defaultWidth: SIDEBAR_WIDTH }}
      collapse={{
        collapsed: !detailsOpen,
        strip: (
          <DetailsStrip
            name={name}
            tile={
              <KindTile kind="module" size={20} color="fg.subtle">
                <IconFolder size={17} />
              </KindTile>
            }
          />
        ),
      }}
    >
      <PanelHeader>
        <Flex gap="3" align="start">
          <KindTile kind="module" size={20} color="fg.subtle">
            <IconFolder size={20} />
          </KindTile>
          <Box flex="1" minW="0">
            <Text fontSize="lg" fontWeight="semibold" letterSpacing="-0.01em" lineHeight="1.25" truncate>
              {name}
            </Text>
            <Text fontSize="xs" color="fg.muted" mt="0.5">
              Folder · {c.files.length} {c.files.length === 1 ? "file" : "files"} · {total} scanned {total === 1 ? "element" : "elements"}
            </Text>
          </Box>
          <ActionIconButton label="Minimize the details" icon={<IconDetailsClose />} size="sm" onClick={() => useExplorer.getState().setDetailsOpen(false)} />
          <ActionIconButton
            label="Close"
            icon={<IconClose />}
            size="sm"
            onClick={() => (useExplorer.getState().inspectedId ? useExplorer.getState().inspect(undefined) : select(undefined))}
          />
        </Flex>

        <Flex mt="3" align="center" gap="1.5" bg="syntax.bg" rounded="l2" px="2.5" py="1.5" minW="0">
          <Text fontFamily="mono" fontSize="xs" color="fg.muted" truncate flex="1" title={path}>
            {path}/
          </Text>
          <ActionIconButton label="Copy path" icon={<IconCopy />} size="2xs" onClick={() => navigator.clipboard.writeText(path)} />
        </Flex>

        <Flex mt="4" gap="2" align="center" wrap="wrap">
          {!onDiagram && (
            <Button size="sm" variant="solid" rounded="l2" onClick={() => addNodes([id], { select: id, focus: id })}>
              <IconPlus size={15} /> Add to diagram
            </Button>
          )}
          <Button size="sm" variant={onDiagram ? "solid" : "outline"} rounded="l2" disabled={!canAll} onClick={() => expandFolder(id, true)}>
            <IconChevronsDown size={15} /> Show everything inside
          </Button>
          <ActionIconButton label="Show the files inside" icon={<IconArrowDown />} size="sm" variant="outline" disabled={!canFiles} onClick={() => expandFolder(id, false)} />
          <ActionIconButton label="Show the parent folder" icon={<IconArrowUp />} size="sm" variant="outline" disabled={!canParent} onClick={() => showParentFolders(id, false)} />
          <ActionIconButton label="Show all parent folders up to the root" icon={<IconChevronsUp />} size="sm" variant="outline" disabled={!canAllParents} onClick={() => showParentFolders(id, true)} />
          <Box flex="1" />
          <HStack gap="0" borderWidth="1px" borderColor="border.muted" rounded="l2" p="0.5">
            <ActionIconButton label="Center on canvas" icon={<IconFocus />} size="xs" onClick={() => addNodes([], { focus: id })} />
            <ActionIconButton label="Tidy up inside" icon={<IconLayout />} size="xs" onClick={() => void arrange(id)} />
            <ActionIconButton label="Remove with everything inside" icon={<IconRemove />} size="xs" onClick={() => hideNode(id)} />
          </HStack>
        </Flex>
      </PanelHeader>

      <PanelSection title="Contains">
        <Wrap gap="1.5">
          {KIND_ORDER.filter((k) => c.countsByKind[k]).map((k) => {
            const Icon = KIND_META[k].icon;
            return (
              <TagChip key={k} color={`kind.${k}.solid`}>
                <Icon size={12} strokeWidth={2.4} />
                {c.countsByKind[k]} {k === "module" ? (c.countsByKind[k] === 1 ? "file" : "files") : KIND_META[k].label.toLowerCase() + (c.countsByKind[k]! > 1 ? "s" : "")}
              </TagChip>
            );
          })}
        </Wrap>
      </PanelSection>

      {c.subfolders.length > 0 && (
        <PanelSection
          title="Folders"
          count={c.subfolders.length}
          aside={
            missingSubs.length > 0 && (
              <Button
                as="span"
                size="2xs"
                variant="outline"
                rounded="full"
                onClick={(e) => {
                  e.stopPropagation();
                  addNodes(missingSubs.map((f) => `${FOLDER_PREFIX}${f.path}`), { anchor: id, fit: true });
                }}
              >
                Add all
              </Button>
            )
          }
        >
          <Wrap gap="1.5">
            {c.subfolders.map((f) => (
              <TagChip
                key={f.path}
                color="kind.module.solid"
                title={drawn.has(`${FOLDER_PREFIX}${f.path}`) ? `${f.path} is on the diagram` : `Add ${f.path} to the diagram`}
                onClick={() => addNodes([`${FOLDER_PREFIX}${f.path}`], { anchor: id, select: `${FOLDER_PREFIX}${f.path}` })}
              >
                <IconFolder size={12} strokeWidth={2.4} />
                {f.name}
                <Text as="span" opacity={0.6} fontWeight="normal">
                  · {f.count}
                </Text>
              </TagChip>
            ))}
          </Wrap>
        </PanelSection>
      )}

      <PanelSection title="Files" count={c.files.length} defaultOpen={c.files.length <= 60}>
        <Stack gap="0.5">
          {c.files.slice(0, MAX_FILES).map((f) => {
            const Icon = KIND_META.module.icon;
            const n = declsIn(f.id);
            return (
              <Flex
                key={f.id}
                as="button"
                gap="2.5"
                align="center"
                textAlign="left"
                px="2"
                py="1.5"
                mx="-2"
                rounded="l2"
                transition="background 150ms ease"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => addNodes([f.id], { select: f.id, focus: f.id, anchor: id })}
              >
                <KindTile kind="module" size={26}>
                  <Icon size={13} strokeWidth={2.4} />
                </KindTile>
                <Box flex="1" minW="0">
                  <Text fontSize="sm" fontWeight="medium" truncate>
                    {f.name}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
                    {f.filePath.slice(path.length + 1)}
                  </Text>
                </Box>
                <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
                  {n ? `${n} inside` : ""}
                  {drawn.has(f.id) ? " · on canvas" : ""}
                </Text>
              </Flex>
            );
          })}
          {c.files.length > MAX_FILES && (
            <Text fontSize="xs" color="fg.muted" pt="1">
              +{c.files.length - MAX_FILES} more — use “Show the files inside”
            </Text>
          )}
        </Stack>
      </PanelSection>
    </Panel>
  );
}
