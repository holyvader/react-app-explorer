import type { Edge, GraphNode, ParamDef } from "@rae/schema";
import {
  ActionIconButton,
  BoundaryChip,
  Box,
  Button,
  Code,
  CodeToken,
  Eyebrow,
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
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconClose,
  IconCopy,
  IconFocus,
  IconOpen,
  IconRouteChain,
} from "@rae/design-system/icons";
import { type ReactNode, useMemo } from "react";
import { childEdges, parentEdges } from "../graph/relations.ts";
import { formatCondition } from "../lib/conditions.ts";
import { editorUrl, openInEditor } from "../lib/editor.ts";
import { KIND_META, fileNote, routeCaption } from "../lib/kinds.tsx";
import { relationToken, relationWord } from "../lib/relationWords.ts";
import { relationFilterOf, useExplorer, SIDEBAR_WIDTH } from "../store.ts";
import { isFolder } from "../graph/drawn.ts";
import { FolderDetails } from "./FolderDetails.tsx";
import { routeOf } from "../graph/drawn.ts";
import { RenderTree } from "./RenderTree.tsx";
import { TypeText } from "./TypeText.tsx";

/**
 * Details of the selected element. Shares its visual language with the canvas and the node
 * tooltip: the kind's icon tile, code-coloured props/signatures, tinted chips, relation colours.
 */
export function DetailsPanel() {
  const sidebarWidth = useExplorer((s) => s.sidebarWidth);
  const setSidebarWidth = useExplorer((s) => s.setSidebarWidth);
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  const selectedId = useExplorer((s) => s.selectedId);
  const enabled = useExplorer((s) => s.enabled);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const editor = useExplorer((s) => s.editor);
  const { select, expand, addNodes } = useExplorer.getState();
  const node = selectedId ? snapshot?.nodes[selectedId] : undefined;

  const relations = useMemo(() => {
    if (!snapshot || !index || !node) return { parents: [], children: [] };
    const filter = relationFilterOf({ enabled, excluded, hideAllLibraries, showAssets });
    return {
      parents: parentEdges(snapshot, index, node.id, filter),
      children: childEdges(snapshot, index, node.id, filter),
    };
  }, [snapshot, index, node, enabled, excluded, hideAllLibraries, showAssets]);

  // Folders aren't scanned nodes: they get their own details (what they contain).
  if (selectedId && isFolder(selectedId)) return <FolderDetails id={selectedId} />;
  if (!snapshot || !node || !index) return null;

  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const open = node.absPath ? editorUrl(editor, node.absPath, node.loc?.line, node.loc?.col) : undefined;
  const caption = node.route ? routeCaption(node.route) : [node.kind === "type" && node.typeKind && node.typeKind !== "type" ? node.typeKind[0]!.toUpperCase() + node.typeKind.slice(1) : meta.label, fileNote(node), node.nextRole ? `next ${node.nextRole}` : undefined, node.isAsync ? "async" : undefined].filter(Boolean).join(" · ");
  const renders = [...new Set((index.out.get(node.id) ?? []).filter((e) => e.kind === "renders").map((e) => e.to))];
  const declared = node.kind === "module" ? (index.out.get(node.id) ?? []).filter((e) => e.kind === "declares").map((e) => snapshot.nodes[e.to]).filter((d): d is GraphNode => !!d) : [];

  return (
    <Panel resize={{ width: sidebarWidth, onWidthChange: setSidebarWidth, defaultWidth: SIDEBAR_WIDTH }}>
      <PanelHeader>
        <Flex gap="3" align="start">
          <KindTile kind={node.kind} size={44}>
            <Icon size={20} strokeWidth={2.2} />
          </KindTile>
          <Box flex="1" minW="0">
            <Text fontSize="lg" fontWeight="semibold" letterSpacing="-0.01em" lineHeight="1.25" truncate>
              {node.name}
            </Text>
            <Text fontSize="xs" color="fg.muted" mt="0.5">
              {caption}
            </Text>
          </Box>
          <ActionIconButton label="Close" icon={<IconClose />} size="sm" onClick={() => select(undefined)} />
        </Flex>

        <Flex mt="3" align="center" gap="1.5" bg="syntax.bg" rounded="l2" px="2.5" py="1.5" minW="0">
          <Text fontFamily="mono" fontSize="xs" color="fg.muted" truncate flex="1" title={node.filePath}>
            {node.filePath}
            {node.loc && node.kind !== "module" ? `:${node.loc.line}` : ""}
          </Text>
          {node.absPath && (
            <ActionIconButton label="Copy path" icon={<IconCopy />} size="2xs" onClick={() => navigator.clipboard.writeText(`${node.absPath}:${node.loc?.line ?? 1}`)} />
          )}
        </Flex>

        {node.missing && (
          <Text fontSize="xs" color="fg.muted" bg="bg.subtle" rounded="l2" px="2.5" py="2">
            Not found on disk. Imported as <Code fontSize="2xs">{node.specifier ?? node.filePath}</Code>, but no such file exists: a generated file
            that isn't built yet, or a broken path or alias.
          </Text>
        )}
        {(node.moduleType || node.directives?.length || node.moduleId) && (
          <Wrap gap="1.5" mt="3" align="center">
            {node.moduleId && (
              <>
                <Text fontSize="xs" color="fg.muted">
                  in
                </Text>
                <NodeChip id={node.moduleId} anchor={node.id} />
              </>
            )}
            {node.moduleType && <BoundaryChip boundary={node.moduleType} rounded="full" px="2" />}
            {node.directives?.map((d) => (
              <TagChip key={d} color="kind.serverAction.solid" mono>
                &apos;{d}&apos;
              </TagChip>
            ))}
          </Wrap>
        )}

        <Flex mt="4" gap="2" align="center">
          {open && (
            <Button size="sm" variant="solid" rounded="l2" onClick={() => void openInEditor(open).catch((e: Error) => useExplorer.getState().notify(e.message))}>
              <IconOpen size={15} /> Open in editor
            </Button>
          )}
          <ActionIconButton label="Center on canvas" icon={<IconFocus />} size="sm" variant="outline" onClick={() => addNodes([node.id], { focus: node.id })} />
          {snapshot && routeOf(snapshot, node.id) && (
            <ActionIconButton
              label={`Show the route chain of ${snapshot.nodes[routeOf(snapshot, node.id)!]!.route!.url} (layouts down to the page)`}
              icon={<IconRouteChain />}
              size="sm"
              variant="outline"
              onClick={() => useExplorer.getState().showRouteChain(node.id)}
            />
          )}
          <Box flex="1" />
          <HStack gap="0" borderWidth="1px" borderColor="border.muted" rounded="l2" p="0.5">
            <ActionIconButton label="Show parents" icon={<IconArrowUp />} size="xs" onClick={() => expand(node.id, "parents", false)} />
            <ActionIconButton label="Parents up to root" icon={<IconChevronsUp />} size="xs" onClick={() => expand(node.id, "parents", true)} />
            <ActionIconButton label="Show children" icon={<IconArrowDown />} size="xs" onClick={() => expand(node.id, "children", false)} />
            <ActionIconButton label="Children down to leaves" icon={<IconChevronsDown />} size="xs" onClick={() => expand(node.id, "children", true)} />
          </HStack>
        </Flex>
      </PanelHeader>

      {node.route && (
        <PanelSection title="Route">
          <RouteInfoView node={node} />
        </PanelSection>
      )}

      {node.kind === "type" && (node.typeParams?.length || node.extends?.length) ? (
        <PanelSection title={node.extends?.length ? (node.typeParams?.length ? "Generics & extends" : "Extends") : "Generics"}>
          <Generics node={node} />
        </PanelSection>
      ) : null}

      {node.kind === "type" && node.typeText && (
        <PanelSection title="Definition">
          <Box bg="syntax.bg" rounded="l2" px="3" py="2.5" fontFamily="mono" fontSize="xs" lineHeight="1.7" borderWidth="1px" borderColor="border.muted" overflowX="auto">
            <TypeText text={node.typeText} owner={node} block />
          </Box>
        </PanelSection>
      )}

      {node.props && node.props.length > 0 && (
        <PanelSection title="Props" count={node.props.length}>
          <Stack gap="0.5">
            {node.props.map((p) => (
              <CodeRow key={p.name}>
                <CodeToken kind="name">{p.name}</CodeToken>
                <CodeToken kind="punct">{p.optional ? "?: " : ": "}</CodeToken>
                <TypeText text={p.type ?? "unknown"} owner={node} />
                {p.default && (
                  <>
                    <CodeToken kind="punct"> = </CodeToken>
                    <CodeToken kind="value">{p.default}</CodeToken>
                  </>
                )}
              </CodeRow>
            ))}
          </Stack>
        </PanelSection>
      )}

      {node.signature && node.kind !== "module" && node.kind !== "external" && (
        <PanelSection title={node.kind === "component" ? "Signature" : "Inputs & output"}>
          <Signature node={node} />
        </PanelSection>
      )}

      {node.hooksUsed && node.hooksUsed.length > 0 && (
        <PanelSection title="Hooks" count={node.hooksUsed.length}>
          <Stack gap="2.5">
            {node.hooksUsed.map((h, i) => {
              const local = h.targetId && snapshot.nodes[h.targetId]?.kind === "hook" ? h.targetId : undefined;
              return (
                <Box key={i}>
                  <Flex align="center" gap="2" minW="0">
                    <TagChip color="kind.hook.solid" mono onClick={local ? () => addNodes([local], { select: local, focus: local, anchor: node.id }) : undefined}>
                      {h.hook}
                    </TagChip>
                    <Text fontFamily="mono" fontSize="xs" color="fg.muted" truncate title={h.args.join(", ")}>
                      ({h.args.join(", ")})
                    </Text>
                  </Flex>
                  {(h.assignedTo || h.returnType) && (
                    <CodeRow indent>
                      {h.assignedTo && <CodeToken kind="name">{h.assignedTo}</CodeToken>}
                      {h.returnType && (
                        <>
                          <CodeToken kind="punct">{h.assignedTo ? ": " : "→ "}</CodeToken>
                          <TypeText text={h.returnType} owner={node} />
                        </>
                      )}
                    </CodeRow>
                  )}
                </Box>
              );
            })}
          </Stack>
        </PanelSection>
      )}

      {renders.length > 0 && (
        <PanelSection title="Renders" count={renders.length}>
          <Wrap gap="1.5">
            {renders.map((id) => (
              <NodeChip key={id} id={id} anchor={node.id} />
            ))}
          </Wrap>
        </PanelSection>
      )}

      {declared.length > 0 && (
        <PanelSection title="Declares" count={declared.length}>
          <Wrap gap="1.5">
            {declared.map((d) => (
              <NodeChip key={d.id} id={d.id} anchor={node.id} suffix={d.exported ? undefined : "local"} />
            ))}
          </Wrap>
        </PanelSection>
      )}

      {node.functions && node.functions.length > 0 && (
        <PanelSection title="Functions" count={node.functions.length}>
          <Stack gap="1">
            {node.functions.map((f, i) => (
              <CodeRow key={i} aside={`:${f.loc.line}`}>
                {f.isAsync && <CodeToken kind="keyword">async </CodeToken>}
                <CodeToken kind="name">{f.name}</CodeToken>
                <CodeToken kind="punct">(</CodeToken>
                <Params params={f.params} owner={node} />
                <CodeToken kind="punct">)</CodeToken>
                {f.returnType && (
                  <>
                    <CodeToken kind="punct">: </CodeToken>
                    <TypeText text={f.returnType} owner={node} />
                  </>
                )}
              </CodeRow>
            ))}
          </Stack>
        </PanelSection>
      )}

      {node.renderTree && node.renderTree.length > 0 && (
        <PanelSection title="Render tree">
          <RenderTree nodes={node.renderTree} />
        </PanelSection>
      )}

      <PanelSection title="Used by" count={relations.parents.length} defaultOpen={relations.parents.length <= 30}>
        <RelationList edges={relations.parents} side="from" />
      </PanelSection>
      <PanelSection title="Uses" count={relations.children.length} defaultOpen={relations.children.length <= 30}>
        <RelationList edges={relations.children} side="to" />
      </PanelSection>

      <PanelSection title="Details" defaultOpen={false}>
        <Stack gap="3">
          <Box>
            <Eyebrow>Exports</Eyebrow>
            <Text fontSize="sm" mt="1" color={node.exportNames?.length ? "fg" : "fg.muted"}>
              {node.exportNames?.length ? node.exportNames.join(", ") : "not exported"}
            </Text>
          </Box>
          <Box>
            <Eyebrow>Id</Eyebrow>
            <Text fontFamily="mono" fontSize="xs" color="fg.muted" mt="1" wordBreak="break-all">
              {node.id}
            </Text>
          </Box>
        </Stack>
      </PanelSection>
    </Panel>
  );
}

/** One line of code tokens, wrapping softly; optional right-aligned note. */
function CodeRow({ children, aside, indent }: { children: ReactNode; aside?: string; indent?: boolean }) {
  return (
    <Flex
      align="baseline"
      gap="2"
      fontFamily="mono"
      fontSize="xs"
      lineHeight="1.6"
      px="2"
      py="0.5"
      ml={indent ? "2" : undefined}
      rounded="l1"
      transition="background 150ms ease"
      _hover={{ bg: "bg.subtle" }}
    >
      <Box flex="1" minW="0" wordBreak="break-word">
        {children}
      </Box>
      {aside && (
        <Text as="span" color="fg.subtle" flexShrink={0}>
          {aside}
        </Text>
      )}
    </Flex>
  );
}

function Params({ params, owner }: { params: ParamDef[]; owner?: GraphNode }) {
  return (
    <>
      {params.map((p, i) => (
        <span key={i}>
          {i > 0 && <CodeToken kind="punct">, </CodeToken>}
          <CodeToken kind="name">{p.name}</CodeToken>
          {p.type && (
            <>
              <CodeToken kind="punct">{p.optional && !p.default ? "?: " : ": "}</CodeToken>
              <TypeText text={p.type} owner={owner} />
            </>
          )}
          {p.default && (
            <>
              <CodeToken kind="punct"> = </CodeToken>
              <CodeToken kind="value">{p.default}</CodeToken>
            </>
          )}
        </span>
      ))}
    </>
  );
}

/** A route: its URL, parameters, HTTP methods and special files (layout first, then page…), each addable. */
const FILE_ORDER = ["layout", "template", "page", "route", "loading", "error", "global-error", "not-found", "default"];
function RouteInfoView({ node }: { node: GraphNode }) {
  const r = node.route!;
  const files = Object.entries(r.files)
    .filter(([, id]) => !!id)
    .sort(([a], [b]) => FILE_ORDER.indexOf(a) - FILE_ORDER.indexOf(b));
  return (
    <Stack gap="3">
      <Box {...CODE_BOX}>
        <CodeToken kind="value">{r.url}</CodeToken>
      </Box>
      {(r.params.length > 0 || (r.methods?.length ?? 0) > 0) && (
        <Wrap gap="1.5">
          {r.methods?.map((m) => (
            <TagChip key={m} color="relation.fetches" mono>
              {m}
            </TagChip>
          ))}
          {r.params.map((p) => (
            <TagChip key={p} color="kind.route.solid" mono>
              {p}
            </TagChip>
          ))}
        </Wrap>
      )}
      <Box>
        <Eyebrow>Files</Eyebrow>
        <Wrap gap="1.5" mt="1.5">
          {files.map(([role, id]) => (
            <NodeChip key={role} id={id!} anchor={node.id} suffix={role} />
          ))}
        </Wrap>
      </Box>
    </Stack>
  );
}

const CODE_BOX = { bg: "syntax.bg", rounded: "l2", px: "3", py: "2", fontFamily: "mono", fontSize: "xs", lineHeight: "1.7", borderWidth: "1px", borderColor: "border.muted" } as const;

/**
 * Generic type parameters (`T extends Item = Item`, one per row) and, for interfaces, what they
 * extend — named types are links, like everywhere in the details.
 */
function Generics({ node }: { node: GraphNode }) {
  return (
    <Stack gap="3">
      {node.typeParams?.length ? (
        <Box>
          <Eyebrow>Type parameters</Eyebrow>
          <Stack gap="1.5" mt="1.5">
            {node.typeParams.map((t) => (
              <Box key={t.name} {...CODE_BOX} wordBreak="break-word">
                <CodeToken kind="name">{t.name}</CodeToken>
                {t.constraint && (
                  <>
                    <CodeToken kind="keyword"> extends </CodeToken>
                    <TypeText text={t.constraint} owner={node} pretty />
                  </>
                )}
                {t.default && (
                  <>
                    <CodeToken kind="punct"> = </CodeToken>
                    <TypeText text={t.default} owner={node} pretty />
                  </>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
      {node.extends?.length ? (
        <Box>
          <Eyebrow>Extends</Eyebrow>
          <Stack gap="1.5" mt="1.5">
            {node.extends.map((x, i) => (
              <Box key={i} {...CODE_BOX} wordBreak="break-word">
                <TypeText text={x} owner={node} pretty />
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

/** Type parameters (if generic), inputs (one parameter per row) and output; object types over several lines. */
function Signature({ node }: { node: GraphNode }) {
  const sig = node.signature!;
  const box = CODE_BOX;
  return (
    <Stack gap="3">
      {node.typeParams?.length ? <Generics node={node} /> : null}
      <Box>
        <Eyebrow>Inputs</Eyebrow>
        {sig.params.length ? (
          <Stack gap="1.5" mt="1.5">
            {sig.params.map((p, i) => (
              <Box key={i} {...box} wordBreak="break-word">
                <CodeToken kind="name">{p.name}</CodeToken>
                {p.type && (
                  <>
                    <CodeToken kind="punct">{p.optional && !p.default ? "?: " : ": "}</CodeToken>
                    <TypeText text={p.type} owner={node} pretty />
                  </>
                )}
                {p.default && (
                  <>
                    <CodeToken kind="punct"> = </CodeToken>
                    <CodeToken kind="value">{p.default}</CodeToken>
                  </>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <Text fontSize="sm" color="fg.muted" mt="1">
            None
          </Text>
        )}
      </Box>
      <Box>
        <Eyebrow>Output</Eyebrow>
        <Box {...box} mt="1.5" wordBreak="break-word">
          {node.isAsync && <CodeToken kind="keyword">async </CodeToken>}
          <TypeText text={sig.returnType ?? "unknown"} owner={node} pretty />
        </Box>
      </Box>
    </Stack>
  );
}

/** A related element as a tinted chip in its kind's colour; click adds/focuses it. */
function NodeChip({ id, anchor, suffix }: { id: string; anchor: string; suffix?: string }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const n = snapshot?.nodes[id];
  if (!n) return null;
  const Icon = KIND_META[n.kind].icon;
  return (
    <TagChip
      color={`kind.${n.kind}.solid`}
      title={n.filePath}
      onClick={() => useExplorer.getState().addNodes([id], { select: id, focus: id, anchor })}
    >
      <Icon size={12} strokeWidth={2.4} />
      {n.name}
      {suffix && (
        <Text as="span" opacity={0.6} fontWeight="normal">
          · {suffix}
        </Text>
      )}
    </TagChip>
  );
}

/** Relation groups, most important first: what renders and runs before files and packages. */
const GROUP_ORDER: { kinds: string[]; label: string }[] = [
  { kinds: ["route"], label: "Routes" },
  { kinds: ["component"], label: "Components" },
  { kinds: ["serverAction"], label: "Server actions" },
  { kinds: ["hook"], label: "Hooks" },
  { kinds: ["function"], label: "Functions" },
  { kinds: ["type"], label: "Types" },
  { kinds: ["module"], label: "Files" },
  { kinds: ["external"], label: "Libraries" },
];

function RelationList({ edges, side }: { edges: Edge[]; side: "from" | "to" }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const selectedId = useExplorer((s) => s.selectedId);
  if (!edges.length)
    return (
      <Text fontSize="sm" color="fg.muted">
        Nothing
      </Text>
    );
  // grouped by the other end's kind, groups in importance order, entries by name
  const groups = GROUP_ORDER.map((g) => ({
    ...g,
    edges: edges
      .filter((e) => g.kinds.includes(snapshot?.nodes[e[side]]?.kind ?? ""))
      .sort((a, b) => (snapshot?.nodes[a[side]]?.name ?? "").localeCompare(snapshot?.nodes[b[side]]?.name ?? "")),
  })).filter((g) => g.edges.length);
  return (
    <Stack gap="3">
      {groups.map((g) => (
        <Box key={g.label}>
          {groups.length > 1 && (
            <Flex align="center" gap="1.5" mb="1">
              <Eyebrow>{g.label}</Eyebrow>
              <Text fontSize="2xs" color="fg.subtle" fontWeight="medium">
                {g.edges.length}
              </Text>
            </Flex>
          )}
          <Stack gap="1">
            {g.edges.map((e, i) => (
              <RelationRow key={`${e[side]}-${e.kind}-${i}`} e={e} side={side} selectedId={selectedId} />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function RelationRow({ e, side, selectedId }: { e: Edge; side: "from" | "to"; selectedId?: string }) {
  const other = useExplorer((s) => s.snapshot?.nodes[e[side]]);
  if (!other) return null;
  const Icon = KIND_META[other.kind].icon;
  return (
    <Flex
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
      onClick={() => useExplorer.getState().addNodes([other.id], { select: other.id, focus: other.id, anchor: selectedId })}
    >
      <KindTile kind={other.kind} size={26}>
        <Icon size={13} strokeWidth={2.4} />
      </KindTile>
      <Box flex="1" minW="0">
        <Flex align="center" gap="2" minW="0">
          <Text fontSize="sm" fontWeight="medium" truncate>
            {other.name}
          </Text>
          <TagChip color={relationToken(e)}>{relationWord(e)}</TagChip>
          {fileNote(other) && (
            <Text as="span" fontSize="2xs" color="fg.subtle">
              {fileNote(other)}
            </Text>
          )}
        </Flex>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
          {e.specifiers?.length ? e.specifiers.join(", ") : other.kind === "external" ? "library" : other.filePath}
        </Text>
        {e.conditions && (
          <Text fontSize="xs" color="syntax.literal" fontFamily="mono" truncate title={e.conditions.map(formatCondition).join(" ∧ ")}>
            when {e.conditions.map(formatCondition).join(" ∧ ")}
          </Text>
        )}
      </Box>
    </Flex>
  );
}
