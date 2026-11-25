import { Box, Button, Eyebrow, Flex, KindChip, Modal, Stack, TagChip, Text } from "@rae/design-system";
import type { NodeId, Snapshot } from "@rae/schema";
import { Fragment, useMemo } from "react";
import { type Chain, impactOf } from "../graph/impact.ts";
import { CHANGE_WORD } from "../lib/diff.ts";
import { displayName } from "../lib/displayName.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { plural } from "../lib/text.ts";
import { useExplorer } from "../store.ts";

/** Rows shown per list before "and N more". */
const SHOWN = 40;

/**
 * A diff's summary: which routes its changes reach, and the top-level elements (nothing affected
 * uses them) that do (graph/impact.ts). Opens when a compare scan finishes; the toolbar reopens it.
 * A row puts its route or element on the diagram with the way down to the change.
 */
export function ImpactModal() {
  const open = useExplorer((s) => s.impactOpen);
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  const { setImpactOpen, addNodes, showChanges } = useExplorer.getState();
  const impact = useMemo(() => (open && snapshot?.diff && index ? impactOf(snapshot, index) : undefined), [open, snapshot, index]);
  if (!snapshot?.diff) return null;

  const close = () => setImpactOpen(false);
  const show = (ids: NodeId[]) => {
    close();
    addNodes(ids, { fit: true, fitTo: ids, select: ids.at(-1) });
  };

  return (
    <Modal
      open={open}
      onOpenChange={setImpactOpen}
      title="What this change affects"
      size="lg"
      footer={
        <Flex gap="2" justify="end" w="full">
          <Button size="sm" variant="ghost" rounded="l2" onClick={close}>
            Close
          </Button>
          <Button
            size="sm"
            colorPalette="accent"
            rounded="l2"
            onClick={() => {
              close();
              showChanges();
            }}
          >
            Show the changes on the diagram
          </Button>
        </Flex>
      }
    >
      {impact && (
        <Stack gap="5">
          <Text color="fg.muted">
            {plural(impact.changed.length, "changed element")} in {plural(impact.files, "file")}
            {impact.hasRoutes ? ` · ${impact.routes.length ? plural(impact.routes.length, "route") : "no route"} affected` : ""}. Pick a row to see it on the diagram with the way down to the change.
          </Text>

          {impact.hasRoutes && (
            <Stack gap="2">
              <Eyebrow>Routes</Eyebrow>
              {impact.routes.length ? (
                <Rows>
                  {impact.routes.slice(0, SHOWN).map((r) => (
                    <Row key={r.id} onClick={() => show([r.id, ...r.chain])} label={`Show ${r.url} on the diagram`}>
                      <Flex gap="2" align="center" wrap="wrap">
                        <Text fontFamily="mono" fontWeight="semibold" wordBreak="break-all">
                          {r.url}
                        </Text>
                        <KindChip kind="route">{r.kind === "api" ? "API" : "page"}</KindChip>
                      </Flex>
                      <Text fontSize="xs" color="fg.subtle">
                        via {r.via.join(", ")}
                      </Text>
                      <ChainLine snapshot={snapshot} chain={r.chain} changes={r.changes} />
                    </Row>
                  ))}
                  <More total={impact.routes.length} />
                </Rows>
              ) : (
                <Text color="fg.subtle">No page or API route reaches these changes.</Text>
              )}
            </Stack>
          )}

          <Stack gap="2">
            <Eyebrow>{impact.hasRoutes ? "Outside the routes" : "Top-level components and modules"}</Eyebrow>
            <Text fontSize="xs" color="fg.subtle">
              {impact.hasRoutes ? "Affected, and not run by any route above: used by nothing else that's affected." : "Affected, and used by nothing else that's affected: where the change surfaces."}
            </Text>
            {impact.topLevel.length ? (
              <Rows>
                {impact.topLevel.slice(0, SHOWN).map((t) => {
                  const n = snapshot.nodes[t.id];
                  const kind = n?.kind ?? "module";
                  return (
                    <Row key={t.id} onClick={() => show(t.chain)} label={`Show ${n ? displayName(n) : t.id} on the diagram`}>
                      <Flex gap="2" align="center" wrap="wrap">
                        <Text fontWeight="semibold" wordBreak="break-word">
                          {n ? displayName(n) : t.id}
                        </Text>
                        {kind !== "external" && kind !== "route" && <KindChip kind={kind}>{KIND_META[kind].label.toLowerCase()}</KindChip>}
                      </Flex>
                      <Text fontSize="xs" color="fg.subtle" fontFamily="mono" wordBreak="break-all">
                        {n?.filePath}
                      </Text>
                      <ChainLine snapshot={snapshot} chain={t.chain} changes={t.changes} />
                    </Row>
                  );
                })}
                <More total={impact.topLevel.length} />
              </Rows>
            ) : (
              <Text color="fg.subtle">{impact.hasRoutes ? "Every affected element is run by a route above." : "Nothing affected."}</Text>
            )}
          </Stack>
        </Stack>
      )}
    </Modal>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <Stack gap="0" borderWidth="1px" borderColor="border" rounded="l3" overflow="hidden" maxH="46vh" overflowY="auto">
      {children}
    </Stack>
  );
}

function Row({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <Box
      asChild
      textAlign="left"
      display="grid"
      gap="1"
      px="3"
      py="2"
      borderBottomWidth="1px"
      borderColor="border.muted"
      _last={{ borderBottomWidth: 0 }}
      _hover={{ bg: "bg.subtle" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "selection.solid", outlineOffset: "-2px" }}
      cursor="pointer"
      minW="0"
    >
      <button type="button" onClick={onClick} title={label}>
        {children}
      </button>
    </Box>
  );
}

/** The way down to the change: `HomePage → TodoList → useTodos (changed)`, and how many changes it reaches. */
function ChainLine({ snapshot, chain, changes }: { snapshot: Snapshot; chain: Chain; changes: number }) {
  const last = chain.at(-1)!;
  const change = snapshot.diff?.nodes[last];
  return (
    <Flex gap="1.5" align="center" fontSize="xs" color="fg.muted" minW="0" wrap="wrap">
      {chain.map((id, i) => {
        const n = snapshot.nodes[id];
        const name = n ? displayName(n) : id;
        return (
          <Fragment key={id}>
            {i > 0 && <Text as="span" color="fg.subtle">→</Text>}
            {id === last && change ? (
              <TagChip color={`diff.${change}.solid`}>
                {name} · {CHANGE_WORD[change]}
              </TagChip>
            ) : (
              <Text as="span" fontFamily={n?.kind === "module" ? "mono" : undefined}>
                {name}
              </Text>
            )}
          </Fragment>
        );
      })}
      {changes > 1 && (
        <Text as="span" color="fg.subtle" ml="auto">
          {plural(changes, "change")} reached
        </Text>
      )}
    </Flex>
  );
}

function More({ total }: { total: number }) {
  if (total <= SHOWN) return null;
  return (
    <Text px="3" py="2" fontSize="xs" color="fg.subtle">
      and {total - SHOWN} more
    </Text>
  );
}
