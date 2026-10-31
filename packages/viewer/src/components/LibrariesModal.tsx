import { Box, Button, Checkbox, Flex, HStack, Modal, SearchInput, Stack, Switch, Text } from "@rae/design-system";
import { useMemo, useState } from "react";
import { DEFAULT_EXCLUDED, packageOf } from "../graph/packages.ts";
import { useExplorer } from "../store.ts";

/** Choose which 3rd-party libraries are shown on the canvas, in search and in relation lists. */
export function LibrariesModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  const excluded = useExplorer((s) => s.excluded);
  const hideAll = useExplorer((s) => s.hideAllLibraries);
  const { setLibraryFilter } = useExplorer.getState();
  const [query, setQuery] = useState("");

  // Packages in the snapshot, with how many specifiers and usages each has.
  const packages = useMemo(() => {
    const byPkg = new Map<string, { specifiers: number; usages: number }>();
    for (const n of Object.values(snapshot?.nodes ?? {})) {
      if (n.kind !== "external" || n.id.startsWith("asset:")) continue;
      const pkg = packageOf(n.filePath);
      const entry = byPkg.get(pkg) ?? { specifiers: 0, usages: 0 };
      entry.specifiers++;
      entry.usages += index?.in.get(n.id)?.length ?? 0;
      byPkg.set(pkg, entry);
    }
    return [...byPkg].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.usages - a.usages || a.name.localeCompare(b.name));
  }, [snapshot, index]);

  const set = new Set(excluded);
  const shownList = packages.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (name: string, shown: boolean) => {
    const next = new Set(excluded);
    if (shown) next.delete(name);
    else next.add(name);
    setLibraryFilter({ excluded: [...next].sort() });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="3rd-party libraries" size="md">
      <Stack gap="3">
        <Switch checked={hideAll} onCheckedChange={(v) => setLibraryFilter({ hideAllLibraries: v })}>
          Hide all 3rd-party libraries
        </Switch>
        <Text fontSize="xs" color="fg.muted">
          Hidden libraries are left out of the diagram, expansions, search and relation lists. Local assets (CSS, SVG)
          are never hidden.
        </Text>
        <SearchInput value={query} onValueChange={setQuery} placeholder="Filter packages…" size="sm" />
        <HStack gap="2">
          <Button size="2xs" variant="outline" onClick={() => setLibraryFilter({ excluded: [] })} disabled={hideAll}>
            Show all
          </Button>
          <Button size="2xs" variant="outline" onClick={() => setLibraryFilter({ excluded: packages.map((p) => p.name) })} disabled={hideAll}>
            Hide all
          </Button>
          <Button size="2xs" variant="outline" onClick={() => setLibraryFilter({ excluded: DEFAULT_EXCLUDED, hideAllLibraries: false })}>
            Reset (hide React)
          </Button>
        </HStack>
        <Box maxH="50vh" overflowY="auto" borderWidth="1px" borderColor="border" rounded="md" py="1">
          {shownList.length === 0 && (
            <Text px="3" py="2" fontSize="sm" color="fg.muted">
              No libraries in this snapshot.
            </Text>
          )}
          {shownList.map((p) => (
            <Flex key={p.name} align="center" px="3" py="1" gap="2" _hover={{ bg: "bg.muted" }}>
              <Checkbox checked={!hideAll && !set.has(p.name)} onCheckedChange={(v) => toggle(p.name, v)} disabled={hideAll}>
                <Text fontFamily="mono" fontSize="sm">
                  {p.name}
                </Text>
              </Checkbox>
              <Box flex="1" />
              <Text fontSize="xs" color="fg.muted">
                {p.usages} uses · {p.specifiers} import path{p.specifiers > 1 ? "s" : ""}
              </Text>
            </Flex>
          ))}
        </Box>
      </Stack>
    </Modal>
  );
}
