import type { Snapshot } from "@rae/schema";
import { create } from "zustand";
import { type DrawnGraph, drawnGraph, isFolder, nodesUnderFolder } from "./graph/drawn.ts";
import { layoutWithin, type PlacedElement } from "./graph/layout.ts";
import { DEFAULT_EXCLUDED } from "./graph/packages.ts";
import { absoluteRect, arrangeWithin, type CanvasPoint, movedTo, placeLocally } from "./graph/placement.ts";
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

interface ExplorerState {
  snapshot?: Snapshot;
  snapshotName?: string;
  index?: GraphIndex;
  /** Node ids the user put on the canvas (containers are derived from them). */
  visible: string[];
  selectedId?: string;
  enabled: EnabledGroups;
  /** Library filter: packages hidden everywhere (canvas, search, relations). */
  excluded: string[];
  hideAllLibraries: boolean;
  /** Draw folders as frames around file modules. */
  folders: boolean;
  editor: EditorKind;
  searchOpen: boolean;
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
  addNodes: (ids: string[], opts?: { select?: string; focus?: string; fit?: boolean; anchor?: Anchor }) => void;
  hideNode: (id: string, opts?: { keepContents?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  select: (id: string | undefined) => void;
  expand: (id: string, dir: "parents" | "children", deep: boolean) => void;
  confirmPending: () => void;
  cancelPending: () => void;
  toggleGroup: (g: EdgeGroup) => void;
  setLibraryFilter: (patch: { excluded?: string[]; hideAllLibraries?: boolean }) => void;
  setFolders: (on: boolean) => void;
  relayout: () => void;
  applyLayout: (graph: DrawnGraph, placed: PlacedElement[]) => void;
  dropAt: (id: string, to: CanvasPoint) => void;
  arrange: (id: string) => Promise<void>;
  setEditor: (e: EditorKind) => void;
  setSearchOpen: (open: boolean) => void;
  consumeFocus: () => void;
}

const KEYS = { editor: "rae.editor", excluded: "rae.excludedLibraries", hideAll: "rae.hideAllLibraries", folders: "rae.folders" };
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};

export const relationFilterOf = (s: Pick<ExplorerState, "enabled" | "excluded" | "hideAllLibraries">): RelationFilter => ({
  enabled: s.enabled,
  libraries: { excluded: new Set(s.excluded), hideAll: s.hideAllLibraries },
});

const EMPTY: DrawnGraph = { elements: [], relations: [] };

export const useExplorer = create<ExplorerState>((set, get) => {
  /**
   * Applies a state change that may alter what is drawn: derives the new drawn graph
   * and places it locally beside `anchor`; falls back to a full layout when it can't.
   */
  const redraw = (patch: Partial<ExplorerState>, anchor: Anchor, full = false) => {
    const next = { ...get(), ...patch };
    if (!next.snapshot) return set(patch);
    const f = relationFilterOf(next);
    const graph = drawnGraph(next.snapshot, next.visible, { enabled: next.enabled, filter: f.libraries, folders: next.folders }, next.index);
    if (!graph.elements.length) return set({ ...patch, graph, placed: [] });
    // Small changes are placed beside their anchor; big ones (e.g. "children down to the leaves") get a full layout.
    const placedIds = new Set(next.placed.map((p) => p.element.id));
    const added = graph.elements.filter((e) => !placedIds.has(e.id)).length;
    const local = !full && next.placed.length && added <= LOCAL_LIMIT ? placeLocally(next.placed, graph, anchor) : null;
    if (local) set({ ...patch, graph, placed: local });
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
    const visible = entry.visible.filter((id) => s.snapshot!.nodes[id]);
    const f = relationFilterOf(s);
    const graph = drawnGraph(s.snapshot, visible, { enabled: s.enabled, filter: f.libraries, folders: s.folders }, s.index);
    const selectedId = entry.selectedId && s.snapshot.nodes[entry.selectedId] ? entry.selectedId : undefined;
    if (!graph.elements.length) return set({ ...extra, visible, selectedId, graph, placed: [] });
    const placed = entry.placed.length ? placeLocally(entry.placed, graph, null) : null;
    if (placed) set({ ...extra, visible, selectedId, graph, placed });
    else set({ ...extra, visible, selectedId, graph, placed: [], layoutToken: s.layoutToken + 1 });
  };

  return {
    visible: [],
    past: [],
    future: [],
    enabled: { imports: true, declares: true, renders: true, hooks: true, invokes: true },
    excluded: readJson(KEYS.excluded, DEFAULT_EXCLUDED),
    hideAllLibraries: readJson(KEYS.hideAll, false),
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

    addNodes: (ids, opts) => {
      const s = get();
      const known = ids.filter((id) => s.snapshot?.nodes[id]);
      const present = new Set(s.visible);
      const added = known.filter((id) => !present.has(id));
      const patch: Partial<ExplorerState> = {
        selectedId: opts?.select ?? s.selectedId,
        focusId: opts?.focus ?? s.focusId,
        fitIds: opts?.fit ? known : s.fitIds,
      };
      if (!added.length) return set(patch);
      record();
      redraw({ ...patch, visible: [...s.visible, ...added] }, opts?.anchor ?? opts?.focus ?? null);
    },

    hideNode: (id, opts) => {
      const s = get();
      if (!s.snapshot) return;
      record();
      let gone: Set<string>;
      if (isFolder(id)) gone = new Set(nodesUnderFolder(s.snapshot, s.visible, id));
      else if (s.snapshot.nodes[id]?.kind === "module" && !opts?.keepContents) {
        // A file block goes with everything drawn in it.
        gone = new Set([id, ...s.visible.filter((v) => s.snapshot!.nodes[v]?.moduleId === id)]);
      } else gone = new Set([id]);
      redraw(
        {
          visible: s.visible.filter((v) => !gone.has(v)),
          selectedId: s.selectedId && gone.has(s.selectedId) ? undefined : s.selectedId,
        },
        null,
      );
    },

    clear: () => {
      record();
      set({ visible: [], selectedId: undefined, graph: EMPTY, placed: [] });
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

    select: (id) => set({ selectedId: id }),

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

    confirmPending: () => {
      const p = get().pending;
      set({ pending: undefined });
      if (p) get().addNodes(p.ids, { fit: true, anchor: p.anchor });
    },
    cancelPending: () => set({ pending: undefined }),

    toggleGroup: (g) => redraw({ enabled: { ...get().enabled, [g]: !get().enabled[g] } }, null),

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
      if (get().graph === graph) set({ placed });
    },

    dropAt: (id, to) => {
      const { placed, graph } = get();
      record();
      const moved = movedTo(placed, graph, id, to);
      if (moved) return set({ placed: moved });
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
      if (res) set({ placed: res });
      else redraw({}, null, true);
    },

    setEditor: (editor) => {
      localStorage.setItem(KEYS.editor, editor);
      set({ editor });
    },

    setSearchOpen: (searchOpen) => set({ searchOpen }),
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
