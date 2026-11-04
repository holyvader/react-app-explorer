import type { Edge, GraphNode, ParamDef } from "@rae/schema";
import {
  ActionIconButton,
  BoundaryChip,
  Box,
  CodeChip,
  KindChip,
  Button,
  Code,
  CodeToken,
  Eyebrow,
  Flex,
  HStack,
  KindTile,
  Panel,
  PanelBar,
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
  IconDetailsClose,
  IconFocus,
  IconOpen,
  IconPlus,
  IconRouteChain,
} from "@rae/design-system/icons";
import { type ReactNode, useMemo, useState } from "react";
import { childEdges, parentEdges } from "../graph/relations.ts";
import { formatCondition } from "../lib/conditions.ts";
import { CHANGE_WORD, describeChange } from "../lib/diff.ts";
import { EDITORS, editorUrl, openInEditor } from "../lib/editor.ts";
import { KIND_META, fileNote, duration, renderingLabel, routeCaption } from "../lib/kinds.tsx";
import { relationToken, relationWord } from "../lib/relationWords.ts";
import { relationFilterOf, useExplorer, SIDEBAR_WIDTH } from "../store.ts";
import { isFolder } from "../graph/drawn.ts";
import { DetailsStrip } from "./DetailsStrip.tsx";
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
  const detailsOpen = useExplorer((s) => s.detailsOpen);
  const setSidebarWidth = useExplorer((s) => s.setSidebarWidth);
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  // what the file tree points at, else the diagram's selection
  const selectedId = useExplorer((s) => s.inspectedId ?? s.selectedId);
  const onDiagram = useExplorer((s) => !!selectedId && s.graph.elements.some((e) => e.id === selectedId));
  const multiSelected = useExplorer((s) => !s.inspectedId && s.selection.length > 1);
  const enabled = useExplorer((s) => s.enabled);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const editor = useExplorer((s) => s.editor);
  const { select, expand, addNodes, inspect } = useExplorer.getState();
  // closing a file-tree inspection goes back to the diagram's selection (if any)
  const closeDetails = () => (useExplorer.getState().inspectedId ? inspect(undefined) : select(undefined));
  const node = selectedId ? snapshot?.nodes[selectedId] : undefined;

  const relations = useMemo(() => {
    if (!snapshot || !index || !node) return { parents: [], children: [] };
    const filter = relationFilterOf({ enabled, excluded, hideAllLibraries, showAssets, diffOverlay });
    return {
      parents: parentEdges(snapshot, index, node.id, filter),
      children: childEdges(snapshot, index, node.id, filter),
    };
  }, [snapshot, index, node, enabled, excluded, hideAllLibraries, showAssets, diffOverlay]);

  // Several selected on the diagram: no one element's details (a file-tree inspection still shows).
  if (multiSelected) return null;
  // Folders aren't scanned nodes: they get their own details (what they contain).
  if (selectedId && isFolder(selectedId)) return <FolderDetails id={selectedId} onDiagram={onDiagram} />;
  if (!snapshot || !node || !index) return null;

  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  // the project's own hooks it calls (React's and libraries' left out), each once with a count
  const customHooks = [
    ...(node.hooksUsed ?? [])
      .filter((h) => h.targetId && snapshot?.nodes[h.targetId]?.kind === "hook" && h.targetId !== node.id)
      .reduce((m, h) => m.set(h.targetId!, (m.get(h.targetId!) ?? 0) + 1), new Map<string, number>()),
  ].map(([id, count]) => ({ id, count }));
  const open = node.absPath ? editorUrl(editor, node.absPath, node.loc?.line, node.loc?.col) : undefined;
  const change = diffOverlay ? snapshot?.diff?.nodes[node.id] : undefined;
  const kindWord = node.route ? routeCaption(node.route) : (node.kind === "type" && node.typeKind && node.typeKind !== "type" ? node.typeKind : meta.label).toLowerCase();
  const tags = [fileNote(node), node.isAsync ? "async" : undefined].filter((t): t is string => !!t);
  const renders = [...new Set((index.out.get(node.id) ?? []).filter((e) => e.kind === "renders").map((e) => e.to))];
  const declared = node.kind === "module" ? (index.out.get(node.id) ?? []).filter((e) => e.kind === "declares").map((e) => snapshot.nodes[e.to]).filter((d): d is GraphNode => !!d) : [];

  return (
    <Panel
      resize={{ width: sidebarWidth, onWidthChange: setSidebarWidth, defaultWidth: SIDEBAR_WIDTH }}
      collapse={{
        collapsed: !detailsOpen,
        strip: (
          <DetailsStrip
            name={node.name}
            tile={
              <KindTile kind={node.kind} size={20}>
                <Icon size={17} />
              </KindTile>
            }
          />
        ),
      }}
    >
      <PanelBar label="Details" sticky>
        <ActionIconButton label="Minimize the details" icon={<IconDetailsClose />} size="2xs" color="fg.subtle" onClick={() => useExplorer.getState().setDetailsOpen(false)} />
        <ActionIconButton label="Close" icon={<IconClose />} size="2xs" color="fg.subtle" onClick={closeDetails} />
      </PanelBar>
      <PanelHeader>
        <Flex gap="2.5" align="center" minW="0">
          <KindTile kind={node.kind} size={20}>
            <Icon size={20} />
          </KindTile>
          <Text textStyle="panelTitle" truncate title={node.name}>
            {node.name}
          </Text>
        </Flex>

        {/* what it is: kind, boundary, Next.js role, then plain tags */}
        <Wrap gap="5px" mt="2.5" align="center">
          <KindChip kind={node.kind}>{kindWord}</KindChip>
          {node.moduleType && <BoundaryChip boundary={node.moduleType} />}
          {node.nextRole && <KindChip kind="route">{node.nextRole}</KindChip>}
          {change && (
            <TagChip color={`diff.${change}.solid`}>
              {CHANGE_WORD[change]}
            </TagChip>
          )}
          {tags.map((t) => (
            <CodeChip key={t} fontFamily="body">
              {t}
            </CodeChip>
          ))}
          {node.directives?.map((d) => (
            <TagChip key={d} color="kind.serverAction.solid" mono>
              &apos;{d}&apos;
            </TagChip>
          ))}
        </Wrap>

        <Flex mt="2.5" align="center" gap="2" minW="0">
          <Text fontFamily="mono" fontSize="11.5px" color="fg.muted" truncate flex="1" title={node.filePath}>
            {node.filePath}
            {node.loc && node.kind !== "module" && (
              <Text as="span" color="fg.subtle">
                :{node.loc.line}
              </Text>
            )}
          </Text>
          {node.absPath && (
            <ActionIconButton label="Copy path" icon={<IconCopy />} size="2xs" color="fg.subtle" onClick={() => navigator.clipboard.writeText(`${node.absPath}:${node.loc?.line ?? 1}`)} />
          )}
          {open && (
            <Button
              size="2xs"
              h="24px"
              px="2"
              variant="outline"
              borderColor="border.emphasized"
              rounded="5px"
              fontSize="11.5px"
              fontWeight="normal"
              flexShrink={0}
              onClick={() => void openInEditor(open).catch((e: Error) => useExplorer.getState().notify(e.message))}
            >
              <IconOpen size={12} /> Open in {EDITORS.find((e) => e.value === editor)?.label ?? "editor"}
            </Button>
          )}
        </Flex>

        {node.missing && (
          <Text fontSize="xs" color="fg.muted" bg="bg.subtle" rounded="l2" px="2.5" py="2">
            Not found on disk. Imported as <Code fontSize="2xs">{node.specifier ?? node.filePath}</Code>, but no such file exists: a generated file
            that isn't built yet, or a broken path or alias.
          </Text>
        )}
        {node.moduleId && (
          <Wrap gap="1.5" mt="2.5" align="center">
            <Text fontSize="11.5px" color="fg.subtle">
              in
            </Text>
            <NodeChip id={node.moduleId} anchor={node.id} />
          </Wrap>
        )}

        <Flex mt="3" gap="1.5" align="center" wrap="wrap">
          {/* picked in the file tree and not drawn yet: adding it comes first */}
          {!onDiagram && (
            <Button size="xs" colorPalette="accent" rounded="l2" onClick={() => addNodes([node.id], { select: node.id, focus: node.id })}>
              <IconPlus size={14} /> Add to diagram
            </Button>
          )}
          {onDiagram && <ActionIconButton label="Center on canvas" icon={<IconFocus />} size="xs" variant="outline" onClick={() => addNodes([node.id], { focus: node.id })} />}
          {snapshot && routeOf(snapshot, node.id) && (
            <ActionIconButton
              label={`Show the route chain of ${snapshot.nodes[routeOf(snapshot, node.id)!]!.route!.url} (layouts down to the page)`}
              icon={<IconRouteChain />}
              size="xs"
              variant="outline"
              onClick={() => useExplorer.getState().showRouteChain(node.id)}
            />
          )}
          <Box flex="1" />
          <HStack gap="0" bg="bg.emphasized" rounded="l2" p="2px">
            <ActionIconButton label="Show parents" icon={<IconArrowUp />} size="2xs" onClick={() => expand(node.id, "parents", false)} />
            <ActionIconButton label="Parents up to root" icon={<IconChevronsUp />} size="2xs" onClick={() => expand(node.id, "parents", true)} />
            <ActionIconButton label="Show children" icon={<IconArrowDown />} size="2xs" onClick={() => expand(node.id, "children", false)} />
            <ActionIconButton label="Children down to leaves" icon={<IconChevronsDown />} size="2xs" onClick={() => expand(node.id, "children", true)} />
          </HStack>
        </Flex>
      </PanelHeader>

      {change && snapshot?.diff && (
        <PanelSection title="In this diff">
          <DiffView node={node} change={change} />
        </PanelSection>
      )}

      {node.cache && (
        <PanelSection title="Cache">
          <CacheView node={node} />
        </PanelSection>
      )}

      {node.middleware && (
        <PanelSection title="Middleware">
          <MiddlewareView node={node} />
        </PanelSection>
      )}

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

      {/* components: their props (no output: a component always returns an element) */}
      {node.kind === "component" ? (
        <PanelSection title="Props" count={node.props?.length || undefined}>
          <ComponentProps node={node} />
        </PanelSection>
      ) : null}
      {node.kind !== "component" && node.props && node.props.length > 0 && (
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

      {node.signature && node.kind !== "module" && node.kind !== "external" && node.kind !== "component" && (
        <PanelSection title="Inputs & output">
          <Signature node={node} />
        </PanelSection>
      )}

      {customHooks.length > 0 && (
        <PanelSection title="Custom hooks" count={customHooks.length}>
          {/* just names: the details (arguments, types) are on the hook itself — click to go there */}
          <Wrap gap="1.5">
            {customHooks.map(({ id, count }) => (
              <NodeChip key={id} id={id} anchor={node.id} suffix={count > 1 ? `×${count}` : undefined} />
            ))}
          </Wrap>
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

      <PanelSection title="Uses" count={relations.children.length} defaultOpen={relations.children.length <= 30}>
        <RelationList edges={relations.children} side="to" />
      </PanelSection>
      <PanelSection title="Used by" count={relations.parents.length}>
        <RelationList key={node.id} edges={relations.parents} side="from" limit={USED_BY_LIMIT} />
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
      {r.rendering && (
        <Box>
          <Eyebrow>Rendering</Eyebrow>
          <Flex align="flex-start" gap="2" mt="1.5">
            <TagChip
              color={r.rendering.blocking ? "red.solid" : r.rendering.mode === "dynamic" ? "orange.solid" : r.rendering.mode === "ppr" ? "purple.solid" : r.rendering.mode === "ssg" ? "teal.solid" : "green.solid"}
              mono
            >
              {renderingLabel(r.rendering)}
            </TagChip>
            <Stack gap="0.5" minW="0">
              {r.rendering.reasons.map((why, i) => (
                <Text key={i} fontSize="xs" color="fg.muted" wordBreak="break-word">
                  {why}
                </Text>
              ))}
            </Stack>
          </Flex>
        </Box>
      )}
      {r.middleware && (
        <Box>
          <Eyebrow>Middleware</Eyebrow>
          <Wrap gap="1.5" mt="1.5" align="center">
            <NodeChip id={r.middleware.id} anchor={node.id} />
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {r.middleware.matcher ? `matcher ${r.middleware.matcher}` : "no matcher: runs on every route"}
            </Text>
            {r.middleware.conditions?.map((c) => (
              <TagChip key={c} color="relation.runsBefore" mono>
                {c}
              </TagChip>
            ))}
          </Wrap>
        </Box>
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

/** A "use cache" scope: variant, where the directive is, cacheLife (with revalidate / expire), tags, and what invalidates it. */
function CacheView({ node }: { node: GraphNode }) {
  const c = node.cache!;
  // (select the index itself: a selector returning a fresh filtered array would re-render forever)
  const index = useExplorer((s) => s.index);
  const invalidatedBy = useMemo(() => (index?.in.get(node.id) ?? []).filter((e) => e.kind === "invalidates"), [index, node.id]);
  return (
    <Stack gap="2.5">
      <Box {...CODE_BOX}>
        <CodeToken kind="keyword">"{c.variant === "default" ? "use cache" : `use cache: ${c.variant}`}"</CodeToken>
        <CodeToken kind="punct">{c.scope === "file" ? "  — for the whole file" : "  — in this function"}</CodeToken>
        {c.life && (
          <Box>
            <CodeToken kind="name">cacheLife</CodeToken>
            <CodeToken kind="punct">(</CodeToken>
            <CodeToken kind="value">{c.life.startsWith("{") ? c.life : `"${c.life}"`}</CodeToken>
            <CodeToken kind="punct">)</CodeToken>
          </Box>
        )}
      </Box>
      {(c.revalidate !== undefined || c.expire !== undefined) && (
        <Text fontSize="xs" color="fg.muted">
          {c.revalidate !== undefined && `Revalidates every ${duration(c.revalidate)}`}
          {c.revalidate !== undefined && c.expire !== undefined && " · "}
          {c.expire !== undefined && `expires after ${duration(c.expire)}`}
          {!c.life && " (the default profile)"}
        </Text>
      )}
      {c.tags?.length ? (
        <Wrap gap="1.5">
          {c.tags.map((t) => (
            <TagChip key={t} color="relation.invalidates" mono>
              {t}
            </TagChip>
          ))}
        </Wrap>
      ) : null}
      {invalidatedBy.length > 0 && (
        <Box>
          <Eyebrow>Invalidated by</Eyebrow>
          <Wrap gap="1.5" mt="1.5">
            {invalidatedBy.map((e, i) => (
              <NodeChip key={i} id={e.from} anchor={node.id} suffix={e.specifiers?.[0]} />
            ))}
          </Wrap>
        </Box>
      )}
    </Stack>
  );
}

/** A middleware file: its matchers (with has / missing conditions) and how many routes they select. */
function MiddlewareView({ node }: { node: GraphNode }) {
  const routes = useExplorer((s) => (s.index?.out.get(node.id) ?? []).filter((e) => e.kind === "runsBefore").length);
  const { matchers } = node.middleware!;
  return (
    <Stack gap="2">
      {matchers.length ? (
        matchers.map((m, i) => (
          <Box key={i} {...CODE_BOX}>
            <CodeToken kind="value">{m.source}</CodeToken>
            {(m.has?.length || m.missing?.length) && (
              <Wrap gap="1.5" mt="1.5">
                {m.has?.map((c) => (
                  <TagChip key={`h${c}`} color="relation.runsBefore" mono>
                    has {c}
                  </TagChip>
                ))}
                {m.missing?.map((c) => (
                  <TagChip key={`m${c}`} color="relation.revalidates" mono>
                    missing {c}
                  </TagChip>
                ))}
              </Wrap>
            )}
          </Box>
        ))
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No matcher: it runs before every route.
        </Text>
      )}
      <Text fontSize="xs" color="fg.muted">
        Runs before {routes} route{routes === 1 ? "" : "s"} (see Uses). Checks inside the function itself aren't evaluated.
      </Text>
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

/**
 * A component's props: each prop when they're known one by one, else its parameter's type (e.g.
 * `props: ButtonProps`, a link to that type); type parameters first if it's generic.
 */
function ComponentProps({ node }: { node: GraphNode }) {
  const params = node.signature?.params ?? [];
  return (
    <Stack gap="3">
      {node.typeParams?.length ? <Generics node={node} /> : null}
      {node.props?.length ? (
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
      ) : params.length ? (
        <ParamRows node={node} params={params} />
      ) : (
        <Text fontSize="sm" color="fg.muted">
          None
        </Text>
      )}
    </Stack>
  );
}

/** One parameter per row; object types over several lines. */
function ParamRows({ node, params, mt }: { node: GraphNode; params: ParamDef[]; mt?: string }) {
  return (
    <Stack gap="1.5" mt={mt}>
      {params.map((p, i) => (
        <Box key={i} {...CODE_BOX} wordBreak="break-word">
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
          <ParamRows node={node} params={sig.params} mt="1.5" />
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

/** "Used by" shows this many entries until expanded. */
const USED_BY_LIMIT = 5;

/** `limit`: only the first entries (in group order) until "Show more". */
function RelationList({ edges, side, limit }: { edges: Edge[]; side: "from" | "to"; limit?: number }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const selectedId = useExplorer((s) => s.selectedId);
  const [expanded, setExpanded] = useState(false);
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
  // collapsed: the first `limit` entries across the groups, most important groups first
  const hidden = limit !== undefined && !expanded ? Math.max(0, edges.length - limit) : 0;
  const cap = hidden ? limit! : Infinity;
  const shown = groups
    .map((g, i) => {
      const before = groups.slice(0, i).reduce((n, x) => n + x.edges.length, 0);
      return { ...g, shownEdges: g.edges.slice(0, Math.max(0, cap - before)) };
    })
    .filter((g) => g.shownEdges.length);
  return (
    <Stack gap="3">
      {shown.map((g) => (
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
            {g.shownEdges.map((e, i) => (
              <RelationRow key={`${e[side]}-${e.kind}-${i}`} e={e} side={side} selectedId={selectedId} />
            ))}
          </Stack>
        </Box>
      ))}
      {limit !== undefined && edges.length > limit && (
        <Button size="xs" variant="ghost" alignSelf="flex-start" mx="-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `Show ${hidden} more`}
        </Button>
      )}
    </Stack>
  );
}

function RelationRow({ e, side, selectedId }: { e: Edge; side: "from" | "to"; selectedId?: string }) {
  const other = useExplorer((s) => s.snapshot?.nodes[e[side]]);
  // "Used by": the names it imports from this node, minus this node's own name (a hook's users import the hook)
  const selfName = useExplorer((s) => (side === "from" ? s.snapshot?.nodes[e.to]?.name : undefined));
  if (!other) return null;
  const specifiers = e.specifiers?.filter((n) => n !== selfName);
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
        {specifiers?.length ? (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
            {specifiers.join(", ")}
          </Text>
        ) : null}
        {/* where it lives, dimmed: the file (the package for libraries) */}
        <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" truncate title={other.kind === "external" ? other.name : other.filePath}>
          {other.kind === "external" ? "library" : other.filePath}
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

/** What a diff did to the element: new, gone, or before → after (props, types, boundary, rendering…), and its file's lines. */
function DiffView({ node, change }: { node: GraphNode; change: "added" | "removed" | "changed" }) {
  const diff = useExplorer((s) => s.snapshot?.diff);
  if (!diff) return null;
  const file = diff.files.find((f) => f.path === node.filePath);
  const before = diff.before[node.id];
  const items = change === "changed" && before ? describeChange(before, node) : [];
  return (
    <Stack gap="2" fontSize="12.5px">
      <Text color="fg.muted">
        {change === "added"
          ? `New in ${diff.head.ref}.`
          : change === "removed"
            ? `Removed: only ${diff.base.ref} (${diff.compared.slice(0, 7)}) has it.`
            : items.length
              ? "Changed:"
              : "Its code changed (the body: nothing in its signature)."}
      </Text>
      {items.map((it, i) => (
        <Flex key={i} gap="2" align="baseline" minW="0">
          <Text color="fg.subtle" flexShrink={0} minW="90px">
            {it.what}
          </Text>
          <Box fontFamily="mono" fontSize="11.5px" minW="0" overflowWrap="anywhere">
            {it.from !== undefined && (
              <Text as="span" color="diff.removed.fg" textDecoration={it.to !== undefined ? "line-through" : undefined}>
                {it.from}
              </Text>
            )}
            {it.from !== undefined && it.to !== undefined && (
              <Text as="span" color="fg.subtle">
                {" → "}
              </Text>
            )}
            {it.to !== undefined && (
              <Text as="span" color="diff.added.fg">
                {it.to}
              </Text>
            )}
          </Box>
        </Flex>
      ))}
      {file && (
        <Text fontFamily="mono" fontSize="11px" color="fg.subtle">
          {file.from ? `${file.from} → ` : ""}
          {file.path}{" "}
          <Text as="span" color="diff.added.fg">
            +{file.additions}
          </Text>{" "}
          <Text as="span" color="diff.removed.fg">
            −{file.deletions}
          </Text>
        </Text>
      )}
    </Stack>
  );
}
