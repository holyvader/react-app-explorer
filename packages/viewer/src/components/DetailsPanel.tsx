import type { Edge, GraphNode } from "@rae/schema";
import {
  ActionIconButton,
  Badge,
  BoundaryChip,
  Box,
  Button,
  Code,
  DataTable,
  Flex,
  HStack,
  KindChip,
  Link,
  Panel,
  PanelHeader,
  PanelSection,
  PropertyList,
  Stack,
  Text,
  Wrap,
} from "@rae/design-system";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconClose,
  IconCopy,
  IconFocus,
  IconOpen,
} from "@rae/design-system/icons";
import { useMemo } from "react";
import { childEdges, parentEdges } from "../graph/relations.ts";
import { formatCondition } from "../lib/conditions.ts";
import { editorUrl } from "../lib/editor.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { relationFilterOf, useExplorer } from "../store.ts";
import { RenderTree } from "./RenderTree.tsx";

export function DetailsPanel() {
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  const selectedId = useExplorer((s) => s.selectedId);
  const enabled = useExplorer((s) => s.enabled);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const editor = useExplorer((s) => s.editor);
  const { select, expand, addNodes } = useExplorer.getState();
  const node = selectedId ? snapshot?.nodes[selectedId] : undefined;

  const relations = useMemo(() => {
    if (!snapshot || !index || !node) return { parents: [], children: [] };
    const filter = relationFilterOf({ enabled, excluded, hideAllLibraries });
    return {
      parents: parentEdges(snapshot, index, node.id, filter),
      children: childEdges(snapshot, index, node.id, filter),
    };
  }, [snapshot, index, node, enabled, excluded, hideAllLibraries]);

  if (!snapshot || !node) return null;

  const open = node.absPath ? editorUrl(editor, node.absPath, node.loc?.line, node.loc?.col) : undefined;
  const sig = node.signature;

  return (
    <Panel w="420px" flexShrink={0}>
      <PanelHeader
        title={node.name}
        subtitle={node.filePath}
        actions={<ActionIconButton label="Close" icon={<IconClose />} onClick={() => select(undefined)} />}
      >
        <Wrap gap="1" mt="2">
          <KindChip kind={node.kind}>{KIND_META[node.kind].label}</KindChip>
          {node.moduleType && <BoundaryChip boundary={node.moduleType} />}
          {node.nextRole && <Badge size="sm" variant="outline">next: {node.nextRole}</Badge>}
          {node.isAsync && <Badge size="sm" variant="outline">async</Badge>}
          {node.directives?.map((d) => (
            <Badge key={d} size="sm" variant="outline" fontFamily="mono">
              '{d}'
            </Badge>
          ))}
        </Wrap>
        <HStack gap="1" mt="2" wrap="wrap">
          {open && (
            <Button asChild size="xs" variant="outline">
              <a href={open}>
                <IconOpen size={14} /> Open in editor
              </a>
            </Button>
          )}
          {node.absPath && (
            <ActionIconButton
              label="Copy path"
              icon={<IconCopy />}
              onClick={() => navigator.clipboard.writeText(`${node.absPath}:${node.loc?.line ?? 1}`)}
            />
          )}
          <ActionIconButton label="Center on canvas" icon={<IconFocus />} onClick={() => addNodes([node.id], { focus: node.id })} />
          <Box flex="1" />
          <ActionIconButton label="Show parents" icon={<IconArrowUp />} onClick={() => expand(node.id, "parents", false)} />
          <ActionIconButton label="Parents up to root" icon={<IconChevronsUp />} onClick={() => expand(node.id, "parents", true)} />
          <ActionIconButton label="Show children" icon={<IconArrowDown />} onClick={() => expand(node.id, "children", false)} />
          <ActionIconButton label="Children down to leaves" icon={<IconChevronsDown />} onClick={() => expand(node.id, "children", true)} />
        </HStack>
      </PanelHeader>

      <PanelSection title="Info">
        <PropertyList
          items={[
            { label: "Path", value: <Code fontSize="xs">{node.filePath}{node.loc ? `:${node.loc.line}:${node.loc.col}` : ""}</Code> },
            ...(node.moduleId ? [{ label: "Module", value: <NodeLink id={node.moduleId} /> }] : []),
            ...(node.exportNames?.length ? [{ label: "Exports", value: node.exportNames.join(", ") }] : node.moduleId ? [{ label: "Exports", value: "not exported" }] : []),
            { label: "Id", value: <Code fontSize="2xs">{node.id}</Code> },
          ]}
        />
      </PanelSection>

      {node.props && node.props.length > 0 && (
        <PanelSection title="Props" count={node.props.length}>
          <DataTable
            rows={node.props}
            rowKey={(p) => p.name}
            columns={[
              { key: "name", header: "Name", width: "30%", render: (p) => <Code fontSize="xs">{p.name}{p.optional ? "?" : ""}</Code> },
              { key: "type", header: "Type", render: (p) => <Text fontFamily="mono">{p.type ?? "—"}</Text> },
              { key: "default", header: "Default", width: "22%", render: (p) => <Text fontFamily="mono">{p.default ?? ""}</Text> },
            ]}
          />
        </PanelSection>
      )}

      {sig && node.kind !== "module" && node.kind !== "external" && (
        <PanelSection title="Signature">
          <Code display="block" whiteSpace="pre-wrap" fontSize="xs" p="2">
            {formatSignature(node)}
          </Code>
        </PanelSection>
      )}

      {node.hooksUsed && node.hooksUsed.length > 0 && (
        <PanelSection title="Hooks" count={node.hooksUsed.length}>
          <Stack gap="2">
            {node.hooksUsed.map((h, i) => (
              <Box key={i} fontSize="xs" fontFamily="mono">
                <Text>
                  {h.assignedTo && <Text as="span" color="fg.muted">const {h.assignedTo} = </Text>}
                  {h.targetId && snapshot.nodes[h.targetId]?.kind === "hook" ? (
                    <NodeLink id={h.targetId} label={h.hook} />
                  ) : (
                    <Text as="span" fontWeight="semibold" color="kind.hook.fg">{h.hook}</Text>
                  )}
                  ({h.args.join(", ")})
                </Text>
                {h.returnType && <Text color="fg.muted" pl="3">→ {h.returnType}</Text>}
              </Box>
            ))}
          </Stack>
        </PanelSection>
      )}

      {node.functions && node.functions.length > 0 && (
        <PanelSection title="Functions" count={node.functions.length}>
          <Stack gap="1.5">
            {node.functions.map((f, i) => (
              <Text key={i} fontSize="xs" fontFamily="mono">
                {f.isAsync && <Text as="span" color="fg.muted">async </Text>}
                <Text as="span" fontWeight="semibold" color="kind.function.fg">{f.name}</Text>(
                {f.params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`).join(", ")})
                {f.returnType && <Text as="span" color="fg.muted">: {f.returnType}</Text>}
                <Text as="span" color="fg.subtle"> :{f.loc.line}</Text>
              </Text>
            ))}
          </Stack>
        </PanelSection>
      )}

      {node.renderTree && node.renderTree.length > 0 && (
        <PanelSection title="Render tree">
          <RenderTree nodes={node.renderTree} />
        </PanelSection>
      )}

      <PanelSection title="Parents" count={relations.parents.length} defaultOpen={relations.parents.length <= 30}>
        <RelationList edges={relations.parents} side="from" />
      </PanelSection>
      <PanelSection title="Children" count={relations.children.length} defaultOpen={relations.children.length <= 30}>
        <RelationList edges={relations.children} side="to" />
      </PanelSection>
    </Panel>
  );
}

function formatSignature(n: GraphNode): string {
  const sig = n.signature!;
  const params = sig.params.map((p) => `  ${p.name}${p.optional && !p.default ? "?" : ""}${p.type ? `: ${p.type}` : ""}${p.default ? ` = ${p.default}` : ""}`);
  const head = `${n.isAsync ? "async " : ""}${n.name}(`;
  return params.length ? `${head}\n${params.join(",\n")}\n): ${sig.returnType ?? "?"}` : `${head}): ${sig.returnType ?? "?"}`;
}

function NodeLink({ id, label }: { id: string; label?: string }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const { addNodes } = useExplorer.getState();
  const n = snapshot?.nodes[id];
  if (!n) return <Text as="span">{label ?? id}</Text>;
  return (
    <Link
      as="button"
      color={`kind.${n.kind}.fg`}
      fontWeight="semibold"
      onClick={() => addNodes([id], { select: id, focus: id, anchor: useExplorer.getState().selectedId })}
    >
      {label ?? n.name}
    </Link>
  );
}

function RelationList({ edges, side }: { edges: Edge[]; side: "from" | "to" }) {
  const snapshot = useExplorer((s) => s.snapshot);
  if (!edges.length) return <Text fontSize="xs" color="fg.muted">None</Text>;
  return (
    <Stack gap="1.5">
      {edges.map((e, i) => {
        const other = snapshot?.nodes[e[side]];
        return (
          <Flex key={i} gap="2" align="start" fontSize="xs">
            <Badge size="xs" variant="subtle" flexShrink={0} minW="16" justifyContent="center">
              {e.kind === "imports" && e.importType && e.importType !== "static" ? e.importType : e.kind}
            </Badge>
            <Box minW="0">
              <NodeLink id={e[side]} />
              {other && other.kind !== "external" && (
                <Text color="fg.subtle" fontFamily="mono" truncate>{other.filePath}</Text>
              )}
              {e.specifiers && <Text color="fg.muted" fontFamily="mono">{e.specifiers.join(", ")}</Text>}
              {e.conditions && (
                <Text color="orange.fg" fontFamily="mono">when {e.conditions.map(formatCondition).join(" ∧ ")}</Text>
              )}
            </Box>
          </Flex>
        );
      })}
    </Stack>
  );
}
