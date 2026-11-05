import { Box, BrandMark, Button, EmptyState, Flex, Spinner, Text } from "@rae/design-system";
import { IconPlus, IconScan } from "@rae/design-system/icons";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Canvas } from "./components/Canvas.tsx";
import { ConfirmExpansion } from "./components/ConfirmExpansion.tsx";
import { DetailsPanel } from "./components/DetailsPanel.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { LibrariesModal } from "./components/LibrariesModal.tsx";
import { ScanModal } from "./components/ScanModal.tsx";
import { Notice } from "./components/Notice.tsx";
import { ScanProgress } from "./components/ScanProgress.tsx";
import { SnapshotsModal } from "./components/SnapshotsModal.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { fetchSnapshot, fetchSnapshotList, readSnapshotFile, type SnapshotList } from "./lib/api.ts";
import { fetchEditors } from "./lib/editor.ts";
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
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

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
  // which editors "Open in editor" can use (asked once)
  useEffect(() => {
    void fetchEditors().then((e) => useExplorer.getState().setEditors(e));
  }, []);

  // After deleting snapshots: if the loaded one went, load the newest left (or show nothing loaded).
  const afterDelete = useCallback(
    async (removed: string[]) => {
      try {
        const l = await fetchSnapshotList();
        setList(l);
        const name = useExplorer.getState().snapshotName;
        if (name && removed.includes(name)) {
          if (localStorage.getItem(LAST_SNAPSHOT_KEY) === name) localStorage.removeItem(LAST_SNAPSHOT_KEY);
          const next = l.snapshots[0]?.file;
          if (next) void load(next);
          else useExplorer.getState().unloadSnapshot();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load],
  );

  // ⌘K opens search anywhere (diagram shortcuts live in the Canvas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && useExplorer.getState().snapshot) {
        e.preventDefault();
        setSearchOpen(true);
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
      <Flex direction="column" h="100vh" bg="shell.bg">
        <Toolbar list={list} current={snapshotName} onPickSnapshot={load} onLoadFile={onLoadFile} onScan={() => setScanOpen(true)} onManageSnapshots={() => setSnapshotsOpen(true)} onLibraries={() => setLibrariesOpen(true)} />
        {error && (
          <Box px="4" py="2" bg="red.subtle" color="red.fg" fontSize="sm">
            {error}
          </Box>
        )}
        {/* docked side by side, flush: file tree, canvas, details */}
        <Flex flex="1" minH="0">
          <FileTree />
          <Box flex="1" position="relative" minW="0" bg="canvas.bg" overflow="hidden">
            <ScanProgress />
            <Notice />
            {loading ? (
              <Flex h="full" align="center" justify="center">
                <Spinner />
              </Flex>
            ) : !snapshot ? (
              <Flex h="full" align="center" justify="center">
                <EmptyState
                  icon={<BrandMark size={72} tile />}
                  title="Explore a React or Next.js app"
                  description="Scan a project folder to map its components, hooks, routes and how they connect. You can also run `bun run scan <path>` in a terminal, or load a snapshot file."
                >
                  <Button colorPalette="accent" size="sm" onClick={() => setScanOpen(true)}>
                    <IconScan size={15} /> Scan a project
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
                        <Button colorPalette="accent" size="sm" onClick={() => setSearchOpen(true)}>
                          <IconPlus size={15} /> Start exploration
                        </Button>
                        <Text fontSize="xs" color="fg.muted">
                          or press Space · right-click the canvas to add an element there
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
      <LibrariesModal open={librariesOpen} onOpenChange={setLibrariesOpen} />
      <ScanModal open={scanOpen} onOpenChange={setScanOpen} onScanned={(file) => void refreshList(file)} />
      <SnapshotsModal open={snapshotsOpen} onOpenChange={setSnapshotsOpen} list={list} current={snapshotName} onDeleted={(removed) => void afterDelete(removed)} />
      <ConfirmExpansion />
    </ReactFlowProvider>
  );
}
