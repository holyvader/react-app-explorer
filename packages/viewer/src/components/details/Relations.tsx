import type { Edge } from "@rae/schema";
import { Box, Button, Eyebrow, Flex, KindTile, Stack, TagChip, Text } from "@rae/design-system";
import { useState } from "react";
import { formatCondition } from "../../lib/conditions.ts";
import { KIND_META, fileNote } from "../../lib/kinds.tsx";
import { relationToken, relationWord } from "../../lib/relationWords.ts";
import { useExplorer } from "../../store.ts";

/* The details panel's relations: Uses / Used by, grouped by kind, and the chips that add or focus an element. */

/** A related element as a tinted chip in its kind's colour; click adds/focuses it. */
export function NodeChip({ id, anchor, suffix }: { id: string; anchor: string; suffix?: string }) {
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

/** `limit`: only the first entries (in group order) until "Show more". */
export function RelationList({ edges, side, limit }: { edges: Edge[]; side: "from" | "to"; limit?: number }) {
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
