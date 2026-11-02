import type { Snapshot } from "@rae/schema";
import { create } from "zustand";
import { type DrawnGraph, drawnGraph, FOLDER_PREFIX, isFolder, nodesUnderFolder, nodesUnderRoute, routeChain, routeOf } from "./graph/drawn.ts";
import { layoutWithin, type PlacedElement } from "./graph/layout.ts";
import { folderExpansion, folderPath, parentFolders } from "./graph/folder.ts";
import { DEFAULT_EXCLUDED } from "./graph/packages.ts";
import { absoluteRect, arrangeWithin, autoPlaceSoleChildren, type CanvasPoint, movedTo, placeLocally } from "./graph/placement.ts";
import { buildIndex, type EdgeGroup, type EnabledGroups, type GraphIndex, reachable, type RelationFilter } from "./graph/relations.ts";
import type { EditorKind } from "./lib/editor.ts";

/** Expansions above this size ask for confirmation first. */
export const LARGE_EXPANSION = 300;
/** Most new elements (incl. derived frames) placed locally; above this, everything is laid out anew. */
const LOCAL_LIMIT = 12;

export interface PendingExpansion {
  ids: string[];
  label: string;
  anchor: string;
}

type Anchor = string | CanvasPoint | null;

/** One step of the diagram, for undo/redo and for storing it between visits. */
export interface DiagramState {
  visible: string[];
  placed: PlacedElement[];
  selectedId?: string;
}

const HISTORY_LIMIT = 100;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** The details sidebar's default width (px). */
export const SIDEBAR_WIDTH = 440;

/** A scan started from the UI: structure first (the dialog), then types in the background. */
export interface ScanState {
  path: string;
  phase: "structure" | "types" | "typed" | "failed" | "cancelled";
  stage?: "discover" | "parse" | "graph" | "types";
  /** Files parsed / found so far (more can be found while imports are followed). */
  parse?: { done: number; total: number };
  /** Files typed / needing types; `loading` while TypeScript loads the project (since `since`). */
  types?: { done: number; total: number; loading: boolean; since: number };
  /** Whether a type pass was asked for. */
  withTypes: boolean;
  startedAt: number;
  /** The snapshot the scan writes (known once the structure is done). */
  file?: string;
  /** Errors (phase "failed") or the reason types are missing (phase "typed" with typed: false). */
  message?: string;
  typed?: boolean;
}

interface ExplorerState {
  snapshot?: Snapshot;
  snapshotName?: string;
  scan?: ScanState;
  index?: GraphIndex;
  /** Node ids the user put on the canvas (containers are derived from them). */
  visible: string[];
  /** Primary selection (the one the sidebar shows): the last of `selection`. */
  selectedId?: string;
  /** Everything selected (⌘/Ctrl+click adds), in the order taken. */
  selection: string[];
  enabled: EnabledGroups;
  /** Library filter: packages hidden everywhere (canvas, search, relations). */
  excluded: string[];
  hideAllLibraries: boolean;
  /** Next.js: routes as frames around their files (a toggle next to Folders). */
  routes: boolean;
  /** Asset files (CSS, images, JSON) on the canvas and in lists; off by default. */
  showAssets: boolean;
  /** A short message over the canvas (e.g. the editor couldn't be opened); clears itself. */
  notice?: string;
  /** The details sidebar's width (px), kept between visits. */
  sidebarWidth: number;
  /** Draw folders as frames around file modules. */
  folders: boolean;
  editor: EditorKind;
  searchOpen: boolean;
  /** Where nodes picked in search go (right-click on the canvas); viewport centre otherwise. */
  searchAnchor?: CanvasPoint;
  /** Quick add: right-click on the empty canvas opens a small picker there (client coords + canvas point). */
  quickAdd: { at: { x: number; y: number }; anchor: CanvasPoint } | null;
  /** Open context menu: a node's actions, or what a file contains (its "+" button). */
  menu: { id: string; x: number; y: number; mode: "node" | "contains" } | null;
  pending?: PendingExpansion;
  focusId?: string;
  fitIds?: string[];

  /** What is drawn, and where (container-relative positions, containers first). */
  graph: DrawnGraph;
  placed: PlacedElement[];
  /** Bumped when the drawn graph needs a full ELK layout (the Canvas runs it). */
  layoutToken: number;
  /** Undo / redo stacks of diagram steps. */
  past: DiagramState[];
  future: DiagramState[];

  setSnapshot: (snapshot: Snapshot, name: string) => void;
  /** Same snapshot, new data (types arrived): keeps the diagram, selection and history. */
  updateSnapshot: (snapshot: Snapshot, name: string) => void;
  setScan: (scan: ScanState | undefined) => void;
  /** No snapshot loaded (e.g. the last one was deleted). */
  unloadSnapshot: () => void;
  addNodes: (ids: string[], opts?: { select?: string; focus?: string; fit?: boolean; anchor?: Anchor }) => void;
  hideNode: (id: string, opts?: { keepContents?: boolean }) => void;
  /** Removes several elements in one undoable step. */
  hideNodes: (ids: string[], opts?: { keepContents?: boolean }) => void;
  selectMany: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  select: (id: string | undefined, adding?: boolean) => void;
  expand: (id: string, dir: "parents" | "children", deep: boolean) => void;
  /** Folders: show the files inside (deep = false) or everything inside — files and declarations. */
  expandFolder: (id: string, deep: boolean) => void;
  /** Routes (and route files): add every route and file that renders its URL, root first. */
  showRouteChain: (id: string) => void;
  /** Folders: add the parent folder, or every folder above it up to the project root. */
  showParentFolders: (id: string, all: boolean) => void;
  confirmPending: () => void;
  cancelPending: () => void;
  toggleGroup: (g: EdgeGroup) => void;
  setLibraryFilter: (patch: { excluded?: string[]; hideAllLibraries?: boolean }) => void;
  setShowAssets: (on: boolean) => void;
  setRoutes: (on: boolean) => void;
  setSidebarWidth: (width: number) => void;
  notify: (message: string | undefined) => void;
  setFolders: (on: boolean) => void;
  relayout: () => void;
  applyLayout: (graph: DrawnGraph, placed: PlacedElement[]) => void;
  dropAt: (id: string, to: CanvasPoint) => void;
  arrange: (id: string) => Promise<void>;
  setEditor: (e: EditorKind) => void;
  setSearchOpen: (open: boolean, anchor?: CanvasPoint) => void;
  setQuickAdd: (q: ExplorerState["quickAdd"]) => void;
  openMenu: (menu: ExplorerState["menu"]) => void;
  /** Adds many elements; above LARGE_EXPANSION it asks first. */
  requestAdd: (ids: string[], label: string, anchor?: Anchor) => void;
  consumeFocus: () => void;
}

const KEYS = { editor: "rae.editor", excluded: "rae.excludedLibraries", hideAll: "rae.hideAllLibraries", folders: "rae.folders", routes: "rae.routes", assets: "rae.showAssets", sidebar: "rae.sidebarWidth" };
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};

export const relationFilterOf = (s: Pick<ExplorerState, "enabled" | "excluded" | "hideAllLibraries" | "showAssets">): RelationFilter => ({
  enabled: s.enabled,
  libraries: { excluded: new Set(s.excluded), hideAll: s.hideAllLibraries, showAssets: s.showAssets },
});

const EMPTY: DrawnGraph = { elements: [], relations: [] };

/** A scanned node, or a folder (`dir:<path>`) that holds scanned files. */
const isKnown = (s: Snapshot | undefined, id: string) => {
  if (!s) return false;
  if (!isFolder(id)) return !!s.nodes[id];
  const prefix = id.slice(FOLDER_PREFIX.length) + "/";
  return Object.values(s.nodes).some((n) => n.kind === "module" && n.filePath.startsWith(prefix));
};

export const useExplorer = create<ExplorerState>((set, get) => {
  /**
   * Applies a state change that may alter what is drawn: derives the new drawn graph
   * and places it locally beside `anchor`; falls back to a full layout when it can't.
   */
  const redraw = (patch: Partial<ExplorerState>, anchor: Anchor, full = false) => {
    const next = { ...get(), ...patch };
    if (!next.snapshot) return set(patch);
    const f = relationFilterOf(next);
    const graph = drawnGraph(next.snapshot, next.visible, { enabled: next.enabled, filter: f.libraries, folders: next.folders, routes: next.routes }, next.index);
    if (!graph.elements.length) return set({ ...patch, graph, placed: [] });
    // Small changes are placed beside their anchor; big ones (e.g. "children down to the leaves") get a full layout.
    const placedIds = new Set(next.placed.map((p) => p.element.id));
    const added = graph.elements.filter((e) => !placedIds.has(e.id)).length;
    const local = !full && next.placed.length && added <= LOCAL_LIMIT ? placeLocally(next.placed, graph, anchor) : null;
    if (local) set({ ...patch, graph, placed: autoPlaceSoleChildren(local) });
    else set({ ...patch, graph, layoutToken: next.layoutToken + 1 });
  };

  /** Pushes the current diagram onto the undo stack (call before a diagram change). */
  const record = () => {
    const s = get();
    const entry: DiagramState = { visible: s.visible, placed: s.placed, selectedId: s.selectedId };
    set({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), entry], future: [] });
  };

  /** Restores a stored step: its positions where they still fit, a full layout otherwise. */
  const restore = (entry: DiagramState, extra: Partial<ExplorerState> = {}) => {
    const s = get();
    if (!s.snapshot) return;
    const visible = entry.visible.filter((id) => isKnown(s.snapshot, id));
    const f = relationFilterOf(s);
    const graph = drawnGraph(s.snapshot, visible, { enabled: s.enabled, filter: f.libraries, folders: s.folders, routes: s.routes }, s.index);
    const selectedId = entry.selectedId && isKnown(s.snapshot, entry.selectedId) ? entry.selectedId : undefined;
    const selection = selectedId ? [selectedId] : [];
    if (!graph.elements.length) return set({ ...extra, visible, selectedId, selection, graph, placed: [] });
    const local = entry.placed.length ? placeLocally(entry.placed, graph, null) : null;
    const placed = local && autoPlaceSoleChildren(local);
    if (placed) set({ ...extra, visible, selectedId, selection, graph, placed });
    else set({ ...extra, visible, selectedId, selection, graph, placed: [], layoutToken: s.layoutToken + 1 });
  };

  return {
    visible: [],
    selection: [],
    quickAdd: null,
    menu: null,
    past: [],
    future: [],
    enabled: { imports: true, declares: true, renders: true, hooks: true, invokes: true, types: true, navigation: true },
    excluded: readJson(KEYS.excluded, DEFAULT_EXCLUDED),
    hideAllLibraries: readJson(KEYS.hideAll, false),
    showAssets: readJson(KEYS.assets, false),
    routes: readJson(KEYS.routes, true),
    sidebarWidth: readJson(KEYS.sidebar, SIDEBAR_WIDTH),
    folders: readJson(KEYS.folders, true),
    editor: (localStorage.getItem(KEYS.editor) as EditorKind | null) ?? "idea",
    searchOpen: false,
    graph: EMPTY,
    placed: [],
    layoutToken: 0,

    setSnapshot: (snapshot, name) => {
      set({
        snapshot,
        snapshotName: name,
        index: buildIndex(snapshot),
        visible: [],
        selectedId: undefined,
        selection: [],
        pending: undefined,
        graph: EMPTY,
        placed: [],
        past: [],
        future: [],
      });
      // The diagram last drawn for this project comes back.
      const saved = loadDiagram(snapshot.rootDir);
      if (saved) restore(saved);
    },

    updateSnapshot: (snapshot, name) => {
      if (get().snapshotName !== name) return; // the user moved on to another snapshot
      set({ snapshot, index: buildIndex(snapshot) });
    },

    setScan: (scan) => set({ scan }),

    unloadSnapshot: () =>
      set({
        snapshot: undefined,
        snapshotName: undefined,
        index: undefined,
        visible: [],
        selectedId: undefined,
        selection: [],
        pending: undefined,
        graph: EMPTY,
        placed: [],
        past: [],
        future: [],
      }),

    addNodes: (ids, opts) => {
      const s = get();
      const known = ids.filter((id) => isKnown(s.snapshot, id));
      const present = new Set(s.visible);
      const added = known.filter((id) => !present.has(id));
      const patch: Partial<ExplorerState> = {
        selectedId: opts?.select ?? s.selectedId,
        selection: opts?.select ? [opts.select] : s.selection,
        focusId: opts?.focus ?? s.focusId,
        fitIds: opts?.fit ? known : s.fitIds,
      };
      if (!added.length) return set(patch);
      record();
      redraw({ ...patch, visible: [...s.visible, ...added] }, opts?.anchor ?? opts?.focus ?? null);
    },

    hideNode: (id, opts) => get().hideNodes([id], opts),

    hideNodes: (ids, opts) => {
      const s = get();
      if (!s.snapshot || !ids.length) return;
      record();
      const gone = new Set<string>();
      for (const id of ids) {
        if (isFolder(id)) {
          // the folder (if added explicitly), its subfolders, and everything drawn inside
          const dir = id.slice(FOLDER_PREFIX.length);
          gone.add(id);
          for (const v of s.visible) if (isFolder(v) && v.slice(FOLDER_PREFIX.length).startsWith(dir + "/")) gone.add(v);
          for (const v of nodesUnderFolder(s.snapshot, s.visible, id)) gone.add(v);
        }
        else if (s.snapshot.nodes[id]?.kind === "route" && !opts?.keepContents) {
          // a route frame goes with its files, their declarations and its nested routes
          gone.add(id);
          for (const v of nodesUnderRoute(s.snapshot, s.visible, id)) gone.add(v);
        }
        else if (s.snapshot.nodes[id]?.kind === "module" && !opts?.keepContents) {
          // A file block goes with everything drawn in it.
          gone.add(id);
          for (const v of s.visible) if (s.snapshot.nodes[v]?.moduleId === id) gone.add(v);
        } else gone.add(id);
      }
      // Folders around what's removed stay on the diagram (as explicit folders) — removing a leaf
      // never takes its folder with it. Only removing the folder itself does.
      // (A removed folder's own subfolders are not "around" anything: they go with it — keeping them
      // would bring the folder itself back as their frame.)
      const removedDirs = ids.filter(isFolder).map(folderPath);
      const insideRemoved = (folderId: string) => {
        const path = folderPath(folderId);
        return removedDirs.some((d) => path === d || path.startsWith(d + "/"));
      };
      const parentOf = new Map(s.graph.elements.map((e) => [e.id, e.parent]));
      const keep = new Set<string>();
      for (const id of gone) {
        for (let p = parentOf.get(id) ?? null; p; p = parentOf.get(p) ?? null) if (isFolder(p) && !gone.has(p) && !insideRemoved(p)) keep.add(p);
      }
      const remaining = s.visible.filter((v) => !gone.has(v));
      const present = new Set(remaining);
      const visible = [...remaining, ...[...keep].filter((f) => !present.has(f))];
      const selection = s.selection.filter((x) => !gone.has(x));
      redraw({ visible, selection, selectedId: selection.at(-1) }, null);
    },

    selectMany: (ids) => set({ selection: ids, selectedId: ids.at(-1) }),

    clear: () => {
      record();
      set({ visible: [], selectedId: undefined, selection: [], graph: EMPTY, placed: [] });
    },

    undo: () => {
      const s = get();
      const entry = s.past.at(-1);
      if (!entry) return;
      const current: DiagramState = { visible: s.visible, placed: s.placed, selectedId: s.selectedId };
      restore(entry, { past: s.past.slice(0, -1), future: [current, ...s.future] });
    },

    redo: () => {
      const s = get();
      const entry = s.future[0];
      if (!entry) return;
      const current: DiagramState = { visible: s.visible, placed: s.placed, selectedId: s.selectedId };
      restore(entry, { past: [...s.past, current], future: s.future.slice(1) });
    },

    select: (id, adding) => {
      if (id === undefined) return set({ selection: [], selectedId: undefined });
      const s = get();
      // Clicked again while it's the only one selected: let go of it (noesis).
      if (!adding) return s.selection.length === 1 && s.selection[0] === id ? set({ selection: [], selectedId: undefined }) : set({ selection: [id], selectedId: id });
      // ⌘/Ctrl+click: joins the selection, or leaves it.
      const selection = s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id];
      set({ selection, selectedId: selection.at(-1) });
    },

    expand: (id, dir, deep) => {
      const s = get();
      if (!s.snapshot || !s.index) return;
      const ids = reachable(s.snapshot, s.index, id, dir, deep, relationFilterOf(s));
      const present = new Set(s.visible);
      const fresh = ids.filter((x) => !present.has(x));
      if (fresh.length > LARGE_EXPANSION) {
        const name = s.snapshot.nodes[id]?.name ?? id;
        set({ pending: { ids: [id, ...ids], label: `${deep ? "All" : "Direct"} ${dir} of ${name}`, anchor: id } });
        return;
      }
      get().addNodes([id, ...ids], { fit: ids.length > 0, anchor: id });
    },

    showRouteChain: (id) => {
      const s = get();
      if (!s.snapshot) return;
      const route = routeOf(s.snapshot, id);
      if (!route) return;
      s.requestAdd(routeChain(s.snapshot, route), `The route chain of ${s.snapshot.nodes[route]!.name}`, id);
    },

    showParentFolders: (id, all) => {
      const drawnNow = new Set(get().graph.elements.map((e) => e.id));
      const ids = parentFolders(id, all).filter((x) => !drawnNow.has(x));
      if (ids.length) get().addNodes(ids, { anchor: id });
    },

    expandFolder: (id, deep) => {
      const s = get();
      if (!s.snapshot) return;
      const path = folderPath(id);
      s.requestAdd(folderExpansion(s.snapshot, path, deep), `${deep ? "Everything" : "Files"} inside ${path}`, id);
    },

    confirmPending: () => {
      const p = get().pending;
      set({ pending: undefined });
      if (p) get().addNodes(p.ids, { fit: true, anchor: p.anchor });
    },
    cancelPending: () => set({ pending: undefined }),

    toggleGroup: (g) => redraw({ enabled: { ...get().enabled, [g]: !get().enabled[g] } }, null),

    notify: (message) => {
      clearTimeout(noticeTimer);
      set({ notice: message });
      if (message) noticeTimer = setTimeout(() => set({ notice: undefined }), 7000);
    },

    setSidebarWidth: (width) => {
      localStorage.setItem(KEYS.sidebar, JSON.stringify(width));
      set({ sidebarWidth: width });
    },

    setRoutes: (on) => {
      localStorage.setItem(KEYS.routes, JSON.stringify(on));
      redraw({ routes: on }, null);
    },

    setShowAssets: (on) => {
      localStorage.setItem(KEYS.assets, JSON.stringify(on));
      redraw({ showAssets: on }, null);
    },

    setLibraryFilter: ({ excluded, hideAllLibraries }) => {
      if (excluded) localStorage.setItem(KEYS.excluded, JSON.stringify(excluded));
      if (hideAllLibraries !== undefined) localStorage.setItem(KEYS.hideAll, JSON.stringify(hideAllLibraries));
      redraw({ ...(excluded ? { excluded } : {}), ...(hideAllLibraries !== undefined ? { hideAllLibraries } : {}) }, null);
    },

    setFolders: (folders) => {
      localStorage.setItem(KEYS.folders, JSON.stringify(folders));
      redraw({ folders }, null, true);
    },

    relayout: () => {
      record();
      redraw({}, null, true);
    },

    applyLayout: (graph, placed) => {
      if (get().graph === graph) set({ placed: autoPlaceSoleChildren(placed) });
    },

    dropAt: (id, to) => {
      const { placed, graph } = get();
      record();
      const moved = movedTo(placed, graph, id, to);
      if (moved) return set({ placed: autoPlaceSoleChildren(moved) });
      // Couldn't settle what it pushes: it stays alone where it was let go.
      const parent = placed.find((p) => p.element.id === id)?.element.parent ?? null;
      const origin = parent ? absoluteRect(placed, parent) : undefined;
      set({
        placed: placed.map((p) => (p.element.id === id ? { ...p, x: to.x - (origin?.x ?? 0), y: to.y - (origin?.y ?? 0) } : p)),
      });
    },

    arrange: async (id) => {
      const graph = get().graph;
      if (!graph.elements.some((e) => e.parent === id)) return;
      const inside = await layoutWithin(graph, id);
      if (get().graph !== graph) return;
      const res = arrangeWithin(get().placed, graph, id, inside);
      record();
      if (res) set({ placed: autoPlaceSoleChildren(res) });
      else redraw({}, null, true);
    },

    setEditor: (editor) => {
      localStorage.setItem(KEYS.editor, editor);
      set({ editor });
    },

    setSearchOpen: (searchOpen, searchAnchor) => set({ searchOpen, ...(searchOpen ? { searchAnchor } : {}) }),
    setQuickAdd: (quickAdd) => set({ quickAdd }),
    openMenu: (menu) => set({ menu }),

    requestAdd: (ids, label, anchor = null) => {
      const s = get();
      const present = new Set(s.visible);
      const fresh = ids.filter((id) => !present.has(id) && s.snapshot?.nodes[id]);
      if (!fresh.length) return;
      if (fresh.length > LARGE_EXPANSION) {
        set({ pending: { ids: fresh, label, anchor: typeof anchor === "string" ? anchor : "" } });
        return;
      }
      get().addNodes(fresh, { anchor, fit: fresh.length > 1 });
    },
    consumeFocus: () => set({ focusId: undefined, fitIds: undefined }),
  };
});

// ---- storing the current diagram (per project) -------------------------------------------

const diagramKey = (rootDir: string) => `rae.diagram:${rootDir}`;

function loadDiagram(rootDir: string): DiagramState | undefined {
  const saved = readJson<DiagramState | null>(diagramKey(rootDir), null);
  return saved && Array.isArray(saved.visible) && Array.isArray(saved.placed) ? saved : undefined;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useExplorer.subscribe((s, prev) => {
  if (!s.snapshot || (s.visible === prev.visible && s.placed === prev.placed && s.selectedId === prev.selectedId)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const key = diagramKey(s.snapshot!.rootDir);
    try {
      if (!s.visible.length) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ visible: s.visible, placed: s.placed, selectedId: s.selectedId } satisfies DiagramState));
    } catch {
      // Storage full: the diagram just isn't kept.
    }
  }, 300);
});
