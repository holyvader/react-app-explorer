import { Box, Button, EmptyState, Flex, Spinner, Text } from "@rae/design-system";
import { IconHistory, IconPlus, IconScan } from "@rae/design-system/icons";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Canvas } from "./components/Canvas.tsx";
import { ConfirmExpansion } from "./components/ConfirmExpansion.tsx";
import { DetailsPanel } from "./components/DetailsPanel.tsx";
import { LibrariesModal } from "./components/LibrariesModal.tsx";
import { ScanModal } from "./components/ScanModal.tsx";
import { SearchModal } from "./components/SearchModal.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { fetchSnapshot, fetchSnapshotList, readSnapshotFile, type SnapshotList } from "./lib/api.ts";
import { useExplorer } from "./store.ts";

const LAST_SNAPSHOT_KEY = "rae.lastSnapshot";

export function App() {
  const snapshot = useExplorer((s) => s.snapshot);
  const snapshotName = useExplorer((s) => s.snapshotName);
  const visible = useExplorer((s) => s.visible);
  const { setSnapshot, setSearchOpen } = useExplorer.getState();
  const [list, setList] = useState<SnapshotList>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [scanOpen, setScanOpen] = useState(false);
  const [librariesOpen, setLibrariesOpen] = useState(false);

  const load = useCallback(
    async (file: string) => {
      setLoading(true);
      setError(undefined);
      try {
        setSnapshot(await fetchSnapshot(file), file);
        localStorage.setItem(LAST_SNAPSHOT_KEY, file);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [setSnapshot],
  );

  const refreshList = useCallback(
    (loadFile?: string) =>
      fetchSnapshotList()
        .then((l) => {
          setList(l);
          // The snapshot opened last time (and its stored diagram) comes back, else the newest.
          const last = localStorage.getItem(LAST_SNAPSHOT_KEY);
          const file = loadFile ?? (l.snapshots.some((x) => x.file === last) ? last! : l.snapshots[0]?.file);
          if (file) void load(file);
        })
        .catch((e: Error) => setError(e.message)),
    [load],
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Keyboard: ⌘K search · ⌘Z / ⇧⌘Z / Ctrl+Y undo-redo · Delete/Backspace removes the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useExplorer.getState();
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]");
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k" && s.snapshot) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (typing) return;
      if (mod && !e.altKey && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "z" && !e.shiftKey) s.undo();
        else s.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selectedId && !mod) {
        e.preventDefault();
        s.hideNode(s.selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  const onLoadFile = async (file: File) => {
    try {
      setSnapshot(await readSnapshotFile(file), file.name);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <ReactFlowProvider>
      <Flex direction="column" h="100vh" bg="canvas.bg">
        <Toolbar list={list} current={snapshotName} onPickSnapshot={load} onLoadFile={onLoadFile} onScan={() => setScanOpen(true)} onLibraries={() => setLibrariesOpen(true)} />
        {error && (
          <Box px="4" py="2" bg="red.subtle" color="red.fg" fontSize="sm">
            {error}
          </Box>
        )}
        <Flex flex="1" minH="0">
          <Box flex="1" position="relative">
            {loading ? (
              <Flex h="full" align="center" justify="center">
                <Spinner />
              </Flex>
            ) : !snapshot ? (
              <Flex h="full" align="center" justify="center">
                <EmptyState
                  icon={<IconHistory />}
                  title="No snapshot loaded"
                  description="Scan a project from here, run `bun run scan <path>` in a terminal, or load a snapshot JSON file."
                >
                  <Button onClick={() => setScanOpen(true)}>
                    <IconScan size={16} /> Scan a project
                  </Button>
                </EmptyState>
              </Flex>
            ) : (
              <>
                <Canvas />
                {visible.length === 0 && (
                  <Flex position="absolute" inset="0" align="center" justify="center" pointerEvents="none">
                    <Box pointerEvents="all">
                      <EmptyState
                        icon={<IconPlus />}
                        title="Empty diagram"
                        description={`${Object.keys(snapshot.nodes).length} scanned nodes. Add one to start exploring.`}
                      >
                        <Button onClick={() => setSearchOpen(true)}>
                          <IconPlus size={16} /> Add node
                        </Button>
                        <Text fontSize="xs" color="fg.muted">
                          or press ⌘K
                        </Text>
                      </EmptyState>
                    </Box>
                  </Flex>
                )}
              </>
            )}
          </Box>
          <DetailsPanel />
        </Flex>
      </Flex>
      <SearchModal />
      <LibrariesModal open={librariesOpen} onOpenChange={setLibrariesOpen} />
      <ScanModal open={scanOpen} onOpenChange={setScanOpen} onScanned={(file) => void refreshList(file)} />
      <ConfirmExpansion />
    </ReactFlowProvider>
  );
}
