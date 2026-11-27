import { Box, BrandMark, Button, EmptyState, Flex, Spinner, Text } from "@rae/design-system";
import { IconFolderOpen, IconPlus, IconSelect } from "@rae/design-system/icons";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "./components/Canvas.tsx";
import { ConfirmExpansion } from "./components/ConfirmExpansion.tsx";
import { DetailsPanel } from "./components/DetailsPanel.tsx";
import { SettingsSheet } from "./components/settings/SettingsSheet.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { LibrariesModal } from "./components/LibrariesModal.tsx";
import { ScanModal } from "./components/ScanModal.tsx";
import { read, registerProjectHost } from "./lib/projects.ts";
import { Notice } from "./components/Notice.tsx";
import { ScanProgress } from "./components/ScanProgress.tsx";
import { ProjectsModal } from "./components/ProjectsModal.tsx";
import { DiffBar } from "./components/DiffBar.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { fetchSnapshot, fetchSnapshotList, type SnapshotList } from "./lib/api.ts";
import { fetchEditors } from "./lib/editor.ts";
import { useExplorer } from "./store.ts";
import { ImpactModal } from "./components/ImpactModal.tsx";
import { readSetting, writeSetting } from "./lib/settings.ts";

const LAST_SNAPSHOT_KEY = "rae.lastSnapshot";
/** The open project was read again once since the page loaded. */
let startupRefreshDone = false;

export function App() {
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const { setSnapshot, setSearchOpen } = useExplorer.getState();
  const [list, setList] = useState<SnapshotList>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [scanOpen, setScanOpen] = useState(false);
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

  // `quiet`: a background refresh swapping in the fresh snapshot (no loading screen over the diagram)
  // the newest load wins: one that finishes after a later one started is dropped
  const loadSeq = useRef(0);
  const load = useCallback(
    async (file: string, quiet = false) => {
      const seq = ++loadSeq.current;
      if (!quiet) setLoading(true);
      setError(undefined);
      try {
        const snap = await fetchSnapshot(file);
        if (seq !== loadSeq.current) return;
        setSnapshot(snap, file);
        writeSetting(LAST_SNAPSHOT_KEY, file);
      } catch (e) {
        if (seq === loadSeq.current) setError((e as Error).message);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [setSnapshot],
  );

  const refreshList = useCallback(
    (loadFile?: string, quiet = false) =>
      fetchSnapshotList()
        .then((l) => {
          setList(l);
          // The project opened last time (what was last read of it, and its diagram), else the newest.
          const last = readSetting(LAST_SNAPSHOT_KEY, "") || null;
          const file = loadFile ?? (l.snapshots.some((x) => x.file === last) ? last! : l.snapshots[0]?.file);
          if (file) void load(file, quiet);
          return { l, file };
        })
        .catch((e: Error) => {
          setError(e.message);
          return undefined;
        }),
    [load],
  );

  // how lib/projects.ts lists and loads snapshots (opening a project: its cache, then a quiet refresh)
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  useEffect(() => {
    registerProjectHost({
      list: () => listRef.current,
      load: (file, quiet) => load(file, quiet),
      relist: async (file, quiet) => {
        if (file) await refreshList(file, quiet);
        else setList(await fetchSnapshotList());
      },
    });
  }, [load, refreshList]);

  // On start, as an IDE does: the last project from its cache, then its view read again quietly —
  // once per page (effects run twice in development: a second read would cancel the first).
  useEffect(() => {
    void refreshList().then((r) => {
      const entry = r?.l.snapshots.find((s) => s.file === r.file);
      if (startupRefreshDone || !entry?.rootDir || entry.diff) return;
      startupRefreshDone = true;
      void read(entry.rootDir, { latest: entry.commit?.ref }, true);
    });
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
          if (readSetting(LAST_SNAPSHOT_KEY, "") === name) writeSetting(LAST_SNAPSHOT_KEY, undefined);
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
      // ⌘, opens and closes the settings, as in editors
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        const st = useExplorer.getState();
        st.setSettingsOpen(!st.settingsOpen);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && useExplorer.getState().snapshot) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  return (
    <ReactFlowProvider>
      <Flex direction="column" h="100vh" bg="shell.bg">
        <Toolbar list={list} onScan={() => setScanOpen(true)} onScanPath={(path) => void read(path, {})} onManageSnapshots={() => setSnapshotsOpen(true)} />
        {snapshot?.diff && <DiffBar diff={snapshot.diff} />}
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
                  description="Open a project folder to map its components, hooks, routes and how they connect."
                >
                  <Button colorPalette="accent" size="sm" onClick={() => setScanOpen(true)}>
                    <IconFolderOpen size={15} /> Open project
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
                        description={`${Object.keys(snapshot.nodes).length} elements. Add one to start exploring.`}
                      >
                        <Button colorPalette="accent" size="sm" onClick={() => setSearchOpen(true)}>
                          <IconPlus size={15} /> Start exploration
                        </Button>
                        <Text fontSize="xs" color="fg.muted">
                          or press Space
                        </Text>
                        <Flex align="center" gap="1.5" mt="2" fontSize="sm" color="fg.muted">
                          <IconSelect size={15} />
                          Right-click anywhere on the diagram to add an element there
                        </Flex>
                      </EmptyState>
                    </Box>
                  </Flex>
                )}
              </>
            )}
          </Box>
          <SettingsSheet onLibraries={() => setLibrariesOpen(true)} />
          <DetailsPanel />
        </Flex>
      </Flex>
      <LibrariesModal open={librariesOpen} onOpenChange={setLibrariesOpen} />
      <ImpactModal />
      <ScanModal open={scanOpen} onOpenChange={setScanOpen} onScanned={(file) => void refreshList(file)} />
      <ProjectsModal open={snapshotsOpen} onOpenChange={setSnapshotsOpen} list={list} current={snapshot?.rootDir} onDeleted={(removed) => void afterDelete(removed)} />
      <ConfirmExpansion />
    </ReactFlowProvider>
  );
}
