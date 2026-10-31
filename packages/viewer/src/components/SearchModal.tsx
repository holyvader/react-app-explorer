import type { GraphNode, NodeKind } from "@rae/schema";
import { Box, Button, EmptyState, Flex, HStack, KindChip, Kbd, Modal, SearchInput, Stack, Text, Wrap } from "@rae/design-system";
import { IconSearch } from "@rae/design-system/icons";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { isFiltered } from "../graph/packages.ts";
import { KIND_META, NODE_KINDS } from "../lib/kinds.tsx";
import { useExplorer } from "../store.ts";

const MAX_RESULTS = 60;

export function SearchModal() {
  const open = useExplorer((s) => s.searchOpen);
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const { setSearchOpen, addNodes } = useExplorer.getState();
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<NodeKind>>(new Set());
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const flow = useReactFlow();
  const { all, filteredOut } = useMemo(() => {
    const nodes = snapshot ? Object.values(snapshot.nodes) : [];
    const libs = { excluded: new Set(excluded), hideAll: hideAllLibraries };
    const kept = nodes.filter((n) => !isFiltered(n, libs));
    return { all: kept, filteredOut: nodes.length - kept.length };
  }, [snapshot, excluded, hideAllLibraries]);
  const fuse = useMemo(
    () =>
      new Fuse(all, {
        keys: [
          { name: "name", weight: 3 },
          { name: "filePath", weight: 1.5 },
          { name: "exportNames", weight: 1 },
          { name: "nextRole", weight: 0.5 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [all],
  );

  const counts = useMemo(() => {
    const c: Partial<Record<NodeKind, number>> = {};
    for (const n of all) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [all]);

  const results = useMemo(() => {
    const matchKind = (n: GraphNode) => kinds.size === 0 || kinds.has(n.kind);
    const base = query.trim()
      ? fuse.search(query.trim(), { limit: MAX_RESULTS * 4 }).map((r) => r.item)
      : // No query: entry points first (pages/layouts), then components.
        [...all].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return base.filter(matchKind).slice(0, MAX_RESULTS);
  }, [query, kinds, fuse, all]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (n: GraphNode) => {
    // New nodes go near the middle of what the user is looking at.
    const anchor =
      useExplorer.getState().searchAnchor ?? flow.screenToFlowPosition({ x: (window.innerWidth - 420) / 2, y: window.innerHeight / 2 });
    addNodes([n.id], { select: n.id, focus: n.id, anchor });
    setSearchOpen(false);
    setQuery("");
  };

  const onQuery = (q: string) => {
    setQuery(q);
    setActive(0);
  };

  const toggleKind = (k: NodeKind) => {
    setActive(0);
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      pick(results[active]);
    }
  };

  const onCanvas = new Set(visible);

  return (
    <Modal open={open} onOpenChange={setSearchOpen} title="Add to diagram" size="xl" initialFocusEl={inputRef}>
      <Stack gap="3" onKeyDown={onKeyDown}>
        <SearchInput
          ref={inputRef}
          value={query}
          onValueChange={onQuery}
          placeholder="Search components, hooks, modules, actions, files…"
        />
        <Wrap gap="1.5">
          {NODE_KINDS.filter((k) => counts[k]).map((k) => (
            <Button
              key={k}
              size="2xs"
              variant={kinds.has(k) ? "solid" : "outline"}
              onClick={() => toggleKind(k)}
              aria-pressed={kinds.has(k)}
            >
              {KIND_META[k].label} ({counts[k]})
            </Button>
          ))}
        </Wrap>
        <Box ref={listRef} maxH="60vh" overflowY="auto" mx="-2">
          {results.length === 0 ? (
            <EmptyState icon={<IconSearch />} title="No matches" description="Try another name or file path." />
          ) : (
            results.map((n, i) => {
              const Icon = KIND_META[n.kind].icon;
              return (
                <Flex
                  key={n.id}
                  data-index={i}
                  as="button"
                  w="full"
                  textAlign="left"
                  align="center"
                  gap="2.5"
                  px="2"
                  py="1.5"
                  rounded="md"
                  bg={i === active ? "bg.emphasized" : undefined}
                  _hover={{ bg: "bg.muted" }}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(n)}
                >
                  <Box color={`kind.${n.kind}.fg`}>
                    <Icon size={16} />
                  </Box>
                  <Box flex="1" minW="0">
                    <Text fontSize="sm" fontWeight="medium" truncate>
                      {n.name}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
                      {n.filePath}
                      {n.loc && n.kind !== "module" ? `:${n.loc.line}` : ""}
                    </Text>
                  </Box>
                  <HStack gap="1">
                    {onCanvas.has(n.id) && (
                      <Text fontSize="2xs" color="fg.subtle">
                        on canvas
                      </Text>
                    )}
                    {n.nextRole && <KindChip kind="module">{n.nextRole}</KindChip>}
                    <KindChip kind={n.kind}>{KIND_META[n.kind].label}</KindChip>
                  </HStack>
                </Flex>
              );
            })
          )}
        </Box>
        <HStack gap="3" fontSize="xs" color="fg.muted">
          <HStack gap="1">
            <Kbd size="sm">↑</Kbd>
            <Kbd size="sm">↓</Kbd> navigate
          </HStack>
          <HStack gap="1">
            <Kbd size="sm">Enter</Kbd> add
          </HStack>
          <HStack gap="1">
            <Kbd size="sm">Esc</Kbd> close
          </HStack>
          {filteredOut > 0 && <Text ml="auto">{filteredOut} library nodes hidden by the Libraries filter</Text>}
        </HStack>
      </Stack>
    </Modal>
  );
}

function rank(n: GraphNode): number {
  if (n.nextRole === "layout") return 0;
  if (n.nextRole === "page") return 1;
  if (n.nextRole) return 2;
  if (n.kind === "component") return 3;
  if (n.kind === "module") return 6;
  if (n.kind === "external") return 7;
  return 4;
}
