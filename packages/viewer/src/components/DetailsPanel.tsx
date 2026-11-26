import type { GraphNode } from "@rae/schema";
import { ActionIconButton, BoundaryChip, Box, Button, Code, CodeChip, CodeToken, Eyebrow, Flex, HStack, KindChip, KindTile, Panel, PanelBar, PanelHeader, Stack, TagChip, Text, textPx, Wrap } from "@rae/design-system";
import { IconArrowDown, IconArrowUp, IconChevronsDown, IconChevronsUp, IconClose, IconCopy, IconDetailsClose, IconFocus, IconInvokes, IconOpen, IconPlus, IconRenders, IconRenderTree, IconRouteChain } from "@rae/design-system/icons";
import { type ReactNode, useMemo } from "react";
import { childEdges, downKinds, INVOKES, parentEdges } from "../graph/relations.ts";
import { CHANGE_WORD } from "../lib/diff.ts";
import { canOpenEditor, EDITORS, editorUrl, openInEditor } from "../lib/editor.ts";
import { KIND_META, fileNote, routeCaption } from "../lib/kinds.tsx";
import { SIDEBAR_WIDTH, useExplorer, useRelationFilter } from "../store.ts";
import { isFolder } from "../graph/drawn.ts";
import { DetailsStrip } from "./DetailsStrip.tsx";
import { FolderDetails } from "./FolderDetails.tsx";
import { routeOf } from "../graph/drawn.ts";
import { RenderTree } from "./RenderTree.tsx";
import { countElements } from "../lib/renderTree.ts";
import { SourceCode } from "./Code.tsx";
import { TypeText } from "./TypeText.tsx";
import { Section } from "./Section.tsx";
import { shownType } from "../lib/typeText.ts";
import { CodeRow, Params } from "./details/CodeRows.tsx";
import { ComponentProps, Generics, Signature } from "./details/Signature.tsx";
import { CacheView, MiddlewareView, RouteInfoView } from "./details/Route.tsx";
import { NodeChip, RelationList } from "./details/Relations.tsx";
import { DiffLines, DiffView } from "./details/Diff.tsx";
import { boundaryOf } from "../lib/boundary.ts";
import { displayName, indexFolderOf } from "../lib/displayName.ts";
import { contextsProvided, contextsRead, contextUses } from "../lib/contexts.ts";

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
  const filter = useRelationFilter();
  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const editor = useExplorer((s) => s.editor);
  const hasEditor = useExplorer((s) => canOpenEditor(s.editors));
  const { select, expand, addNodes, inspect } = useExplorer.getState();
  // closing a file-tree inspection goes back to the diagram's selection (if any)
  const closeDetails = () => (useExplorer.getState().inspectedId ? inspect(undefined) : select(undefined));
  const node = selectedId ? snapshot?.nodes[selectedId] : undefined;

  const relations = useMemo(() => {
    if (!snapshot || !index || !node) return { parents: [], children: [] };
    return {
      parents: parentEdges(snapshot, index, node.id, filter),
      children: childEdges(snapshot, index, node.id, filter),
    };
  }, [snapshot, index, node, filter]);

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
  // React's and libraries' hooks: their names once, as a quiet line under the project's own
  const otherHooks = [
    ...new Set(
      (node.hooksUsed ?? [])
        .filter((h) => !(h.targetId && snapshot?.nodes[h.targetId]?.kind === "hook"))
        .map((h) => h.hook.replace(/^React\./, "")),
    ),
  ];
  // React contexts: read (directly or through its hooks), and provided (a component's <X.Provider>)
  const reads = contextsRead(snapshot, node);
  const provides = node.kind === "component" ? contextsProvided(node) : [];
  const contexts = reads.length + provides.length ? contextUses(snapshot) : undefined;
  const open = node.absPath && hasEditor ? editorUrl(editor, node.absPath, node.loc?.line, node.loc?.col) : undefined;
  const change = diffOverlay ? snapshot?.diff?.nodes[node.id] : undefined;
  const kindWord = node.route ? routeCaption(node.route) : (node.kind === "type" && node.typeKind && node.typeKind !== "type" ? node.typeKind : meta.label).toLowerCase();
  const tags = [fileNote(node), node.isAsync ? "async" : undefined].filter((t): t is string => !!t);
  const renders = [...new Set((index.out.get(node.id) ?? []).filter((e) => e.kind === "renders").map((e) => e.to))];
  // Uses / Used by leave out what another section already lists: declarations (Declares, and the
  // "in <file>" chip), renders (Renders), the project's hooks (Custom hooks), a route's files and its
  // middleware (Route)
  const customHookIds = new Set(customHooks.map((h) => h.id));
  const uses = relations.children.filter(
    (e) => e.kind !== "declares" && e.kind !== "renders" && e.kind !== "routeFile" && !(e.kind === "usesHook" && customHookIds.has(e.to)),
  );
  const usedBy = relations.parents.filter((e) => e.kind !== "declares" && !(e.kind === "runsBefore" && node.route?.middleware?.id === e.from));
  // An exported declaration nothing imports, renders or calls: probably dead code. Unfiltered (the
  // relation filter hides edges, not uses); framework entry points (pages, layouts, routes) aside.
  const unusedExport =
    !!node.exported && !node.nextRole && !node.route && node.kind !== "module" && node.kind !== "external" && !(index.in.get(node.id) ?? []).some((e) => e.kind !== "declares");
  const fnLike = node.kind === "hook" || node.kind === "function" || node.kind === "serverAction";
  const hasProps = !!(node.props?.length || node.signature?.params.length || node.typeParams?.length);
  // what it doesn't have, said once at the end rather than as sections saying "None"
  const nothing = [
    node.kind === "component" && !hasProps && "no props",
    fnLike && node.signature && !node.signature.params.length && "no inputs",
    (node.kind === "component" || fnLike) && !reads.length && !provides.length && "no context",
    (node.kind === "component" || node.kind === "hook") && !customHooks.length && !otherHooks.length && "no hooks",
    // Uses leaves out what Renders and Hooks list: with those, it's only "nothing else"
    !uses.length && (renders.length || customHooks.length ? "uses nothing else" : "uses nothing"),
    !usedBy.length && !unusedExport && "used by nothing shown",
    snapshot.diff && !change && "not changed in this diff",
  ].filter((t): t is string => !!t);
  const declared = node.kind === "module" ? (index.out.get(node.id) ?? []).filter((e) => e.kind === "declares").map((e) => snapshot.nodes[e.to]).filter((d): d is GraphNode => !!d) : [];

  return (
    <Panel
      resize={{ width: sidebarWidth, onWidthChange: setSidebarWidth, defaultWidth: SIDEBAR_WIDTH }}
      collapse={{
        collapsed: !detailsOpen,
        strip: (
          <DetailsStrip
            name={displayName(node)}
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
          <Text textStyle="panelTitle" truncate title={node.filePath}>
            {displayName(node)}
          </Text>
        </Flex>

        {/* what it is: kind, boundary, Next.js role, then plain tags */}
        <Wrap gap="5px" mt="2.5" align="center">
          <KindChip kind={node.kind}>{kindWord}</KindChip>
          {indexFolderOf(node) && <TagChip color="fg.muted" mono>index</TagChip>}
          {boundaryOf(node) && <BoundaryChip boundary={boundaryOf(node)!} />}
          {node.nextRole && <KindChip kind="route">{node.nextRole}</KindChip>}
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
          <Text fontFamily="mono" fontSize={textPx(11.5)} color="fg.muted" truncate flex="1" title={node.filePath}>
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
              fontSize={textPx(11.5)}
              fontWeight="normal"
              flexShrink={0}
              onClick={() => void openInEditor(open).catch((e: Error) => useExplorer.getState().notify(e.message))}
            >
              <IconOpen size={12} /> Open in {EDITORS.find((e) => e.value === editor)?.label ?? "editor"}
            </Button>
          )}
        </Flex>

        {change && snapshot.diff && <DiffBanner node={node} change={change} />}

        {node.missing && (
          <Text fontSize="xs" color="fg.muted" bg="bg.subtle" rounded="l2" px="2.5" py="2">
            Not found on disk. Imported as <Code fontSize="2xs">{node.specifier ?? node.filePath}</Code>, but no such file exists: a generated file
            that isn't built yet, or a broken path or alias.
          </Text>
        )}
        {node.moduleId && (
          <Wrap gap="1.5" mt="2.5" align="center">
            <Text fontSize={textPx(11.5)} color="fg.subtle">
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
            <ActionIconButton label={node.kind === "component" ? "Rendered by" : "Show parents"} icon={<IconArrowUp />} size="2xs" onClick={() => expand(node.id, "parents", false)} />
            <ActionIconButton label={node.kind === "component" ? "Rendered by, up to the root" : "Parents up to root"} icon={<IconChevronsUp />} size="2xs" onClick={() => expand(node.id, "parents", true)} />
            {node.kind === "component" ? (
              <>
                <ActionIconButton label="Renders" icon={<IconRenders />} size="2xs" onClick={() => expand(node.id, "children", false, downKinds(node.kind))} />
                <ActionIconButton label="Show render tree" icon={<IconRenderTree />} size="2xs" onClick={() => expand(node.id, "children", true, downKinds(node.kind))} />
                {relations.children.some((e) => INVOKES.includes(e.kind)) && (
                  <ActionIconButton label="Invokes" icon={<IconInvokes />} size="2xs" onClick={() => expand(node.id, "children", false, INVOKES)} />
                )}
              </>
            ) : (
              <>
                <ActionIconButton label="Show children" icon={<IconArrowDown />} size="2xs" onClick={() => expand(node.id, "children", false)} />
                <ActionIconButton label="Children down to leaves" icon={<IconChevronsDown />} size="2xs" onClick={() => expand(node.id, "children", true)} />
              </>
            )}
          </HStack>
        </Flex>
      </PanelHeader>

      {node.cache && (
        <Section title="Cache">
          <CacheView node={node} />
        </Section>
      )}

      {node.middleware && (
        <Section title="Middleware">
          <MiddlewareView node={node} />
        </Section>
      )}

      {node.route && (
        <Section title="Route">
          <RouteInfoView node={node} />
        </Section>
      )}

      {node.kind === "type" && (node.typeParams?.length || node.extends?.length) ? (
        <Section id="Generics" title={node.extends?.length ? (node.typeParams?.length ? "Generics & extends" : "Extends") : "Generics"}>
          <Generics node={node} />
        </Section>
      ) : null}

      {node.kind === "type" && node.typeText && (
        <Section title="Definition">
          <Box bg="syntax.bg" rounded="l2" px="3" py="2.5" fontFamily="mono" fontSize="xs" lineHeight="1.7" borderWidth="1px" borderColor="border.muted" overflowX="auto">
            <TypeText text={node.typeText} owner={node} block />
          </Box>
        </Section>
      )}

      {/* components: their props (no output: a component always returns an element) */}
      {node.kind === "component" && hasProps ? (
        <Section title="Props" count={node.props?.length || undefined}>
          <ComponentProps node={node} />
        </Section>
      ) : null}
      {node.kind !== "component" && node.props && node.props.length > 0 && (
        <Section title="Props" count={node.props.length}>
          <Stack gap="0.5">
            {node.props.map((p) => (
              <CodeRow key={p.name}>
                <CodeToken kind="name">{p.name}</CodeToken>
                <CodeToken kind="punct">{p.optional ? "?: " : ": "}</CodeToken>
                <TypeText text={shownType(p) ?? "unknown"} owner={node} optional={p.optional} />
                {p.default && (
                  <>
                    <CodeToken kind="punct"> = </CodeToken>
                    <SourceCode text={p.default} />
                  </>
                )}
              </CodeRow>
            ))}
          </Stack>
        </Section>
      )}

      {node.signature && node.kind !== "module" && node.kind !== "external" && node.kind !== "component" && (
        <Section title="Signature">
          <Signature node={node} />
        </Section>
      )}

      {customHooks.length + otherHooks.length > 0 && (
        <Section title="Hooks" count={customHooks.length + otherHooks.length}>
          {/* just names: the details (arguments, types) are on the hook itself — click to go there */}
          <Stack gap="1.5">
            {customHooks.length > 0 && (
              <Wrap gap="1.5">
                {customHooks.map(({ id, count }) => (
                  <NodeChip key={id} id={id} anchor={node.id} suffix={count > 1 ? `×${count}` : undefined} />
                ))}
              </Wrap>
            )}
            {otherHooks.length > 0 && (
              <Text fontFamily="mono" fontSize={textPx(11.5)} color="fg.muted">
                {otherHooks.join(" · ")}
              </Text>
            )}
          </Stack>
        </Section>
      )}

      {contexts && (
        <Section title="Context" count={reads.length + provides.length}>
          <Stack gap="1.5">
            {provides.map((name) => (
              <ContextRow key={`p:${name}`} label="Provides" name={name}>
                <ReadBy ids={contexts.get(name)?.readers ?? []} anchor={node.id} />
              </ContextRow>
            ))}
            {reads.map(({ name, via }) => (
              <ContextRow
                key={`r:${name}`}
                label="Reads"
                name={name}
                below={(contexts.get(name)?.providers ?? [])
                  .filter((p) => p !== node.id)
                  .map((p, i) => (
                    <HStack key={p} gap="1.5">
                      {i === 0 && (
                        <Text as="span" fontSize="xs" color="fg.subtle">
                          from
                        </Text>
                      )}
                      <NodeChip id={p} anchor={node.id} />
                    </HStack>
                  ))}
              >
                {via && (
                  <>
                    <Text as="span" fontSize="xs" color="fg.subtle">
                      via
                    </Text>
                    <NodeChip id={via} anchor={node.id} />
                  </>
                )}
              </ContextRow>
            ))}
          </Stack>
        </Section>
      )}

      {renders.length > 0 && (
        <Section title="Renders" count={renders.length}>
          <Wrap gap="1.5">
            {renders.map((id) => (
              <NodeChip key={id} id={id} anchor={node.id} />
            ))}
          </Wrap>
        </Section>
      )}

      {declared.length > 0 && (
        <Section title="Declares" count={declared.length}>
          <Wrap gap="1.5">
            {declared.map((d) => (
              <NodeChip key={d.id} id={d.id} anchor={node.id} suffix={d.exported ? undefined : "local"} />
            ))}
          </Wrap>
        </Section>
      )}

      {node.functions && node.functions.length > 0 && (
        <Section title="Functions" count={node.functions.length}>
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
        </Section>
      )}

      {node.renderTree && node.renderTree.length > 0 && (
        <Section title="Render tree" count={countElements(node.renderTree)}>
          <RenderTree nodes={node.renderTree} />
        </Section>
      )}

      {uses.length > 0 && (
        <Section title="Uses" count={uses.length} defaultOpen={uses.length <= 30}>
          <RelationList edges={uses} side="to" />
        </Section>
      )}
      {usedBy.length > 0 && (
        <Section title="Used by" count={usedBy.length}>
          <RelationList key={node.id} edges={usedBy} side="from" limit={USED_BY_LIMIT} />
        </Section>
      )}

      {(unusedExport || nothing.length > 0) && (
        <Stack gap="2" px="4" py="3" borderTopWidth="1px" borderColor="border.muted">
          {unusedExport && (
            <Text fontSize="xs" color="diff.changed.fg" bg="diff.changed.subtle" rounded="l2" px="2.5" py="2">
              Not used anywhere: exported, but nothing imports, renders or calls it.
            </Text>
          )}
          {nothing.length > 0 && (
            <Text fontSize="xs" color="fg.muted">
              {nothing.join(" · ").replace(/^./, (c) => c.toUpperCase())}
            </Text>
          )}
        </Stack>
      )}

      <Section title="Details" defaultOpen={false}>
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
      </Section>
    </Panel>
  );
}

/** "Used by" shows this many entries until expanded. */
const USED_BY_LIMIT = 5;

/** The diff, said where the element is named: what happened to it and how many lines, the details under it. */
function DiffBanner({ node, change }: { node: GraphNode; change: "added" | "removed" | "changed" }) {
  return (
    <Stack gap="2" mt="2.5" px="2.5" py="2" rounded="l2" bg={`diff.${change}.subtle`}>
      <Flex align="center" gap="2">
        <Text fontSize="xs" fontWeight="semibold" color={`diff.${change}.fg`}>
          {CHANGE_WORD[change]}
        </Text>
        <Box flex="1" />
        <DiffLines key={node.id} node={node} />
      </Flex>
      <DiffView key={node.id} node={node} change={change} />
    </Stack>
  );
}

/** One context it provides or reads: "Provides" / "Reads", its name, then where it comes from or goes. */
function ContextRow({ label, name, children, below }: { label: string; name: string; children?: ReactNode; below?: ReactNode[] }) {
  return (
    <Flex gap="1.5" align="flex-start">
      <Text as="span" fontSize="xs" color="fg.muted" w="56px" flexShrink={0} lineHeight="20px">
        {label}
      </Text>
      <Stack gap="1" minW="0">
        <Flex gap="1.5" align="center" wrap="wrap">
          <CodeChip>{name}</CodeChip>
          {children}
        </Flex>
        {below?.length ? (
          <Flex gap="1.5" align="center" wrap="wrap">
            {below}
          </Flex>
        ) : null}
      </Stack>
    </Flex>
  );
}

/** "read by N": how many declarations read a context it provides; a click draws them. */
function ReadBy({ ids, anchor }: { ids: string[]; anchor: string }) {
  const snapshot = useExplorer((s) => s.snapshot);
  if (!ids.length) return null;
  const names = ids.map((id) => (snapshot?.nodes[id] ? displayName(snapshot.nodes[id]) : id));
  return (
    <Text
      as="button"
      fontSize="xs"
      color="fg.subtle"
      _hover={{ color: "fg" }}
      title={`Add to the diagram: ${names.join(", ")}`}
      onClick={() => useExplorer.getState().addNodes(ids, { anchor, fit: true })}
    >
      · read by {ids.length}
    </Text>
  );
}
