import type { Snapshot } from "@rae/schema";
import { type CSSProperties, useMemo } from "react";
import type { Collapse } from "../../graph/collapse.ts";
import { type DrawnGraph, FOLDER_PREFIX, routeChain, routeOf } from "../../graph/drawn.ts";
import { folderExpansion, folderPath, parentFolders } from "../../graph/folder.ts";
import type { PlacedElement } from "../../graph/layout.ts";
import { childEdges, type GraphIndex, hasUndrawn, parentEdges, type RelationFilter } from "../../graph/relations.ts";
import { changeOf } from "../../lib/diff.ts";
import { type ElementFlowNode, FRAME_HANDLE } from "../nodes/types.ts";

/*
 * The canvas's nodes, in memoized steps so each change re-creates only the nodes involved: one per
 * placed element (kind, size, what its actions can add, diff mark) → hidden inside a collapsed
 * frame, or the frame's count → selected / related. Selection never goes into the first step: a
 * click would re-create every node (performance rules, react-flow skill).
 */

/** What the selection relates to: the other ends of its edges, and its containers / contents. */
export interface Related {
  nodes: Set<string>;
  edges: Set<string>;
}

export function useRelated(selection: string[], graph: DrawnGraph): Related {
  return useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    if (!selection.length) return { nodes, edges };
    const sel = new Set(selection);
    for (const r of graph.relations) {
      if (sel.has(r.source) || sel.has(r.target)) {
        edges.add(r.id);
        nodes.add(r.source);
        nodes.add(r.target);
      }
    }
    const parentOf = new Map(graph.elements.map((e) => [e.id, e.parent]));
    const kids = new Map<string, string[]>();
    for (const e of graph.elements) if (e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e.id]);
    const addInside = (id: string) => {
      for (const k of kids.get(id) ?? []) {
        nodes.add(k);
        addInside(k);
      }
    };
    for (const id of selection) {
      for (let p = parentOf.get(id) ?? null; p; p = parentOf.get(p) ?? null) nodes.add(p);
      // a selected frame (file or folder) highlights everything inside it
      addInside(id);
    }
    for (const id of selection) nodes.delete(id);
    return { nodes, edges };
  }, [selection, graph]);
}

export interface CanvasNodesInput {
  snapshot?: Snapshot;
  index?: GraphIndex;
  placed: PlacedElement[];
  filter: RelationFilter;
  showDiff: boolean;
  collapse: Collapse;
  selection: string[];
  related: Related;
}

export function useCanvasNodes({ snapshot, index, placed, filter, showDiff, collapse, selection, related }: CanvasNodesInput): ElementFlowNode[] {
  // Scanned elements (files + declarations) under each folder, for folder headers.
  const scannedUnder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of Object.values(snapshot?.nodes ?? {})) {
      if (n.kind === "external") continue;
      for (let i = n.filePath.lastIndexOf("/"); i > 0; i = n.filePath.lastIndexOf("/", i - 1)) {
        const dir = n.filePath.slice(0, i);
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
      }
    }
    return counts;
  }, [snapshot]);

  const derived = useMemo<ElementFlowNode[]>(() => {
    if (!snapshot || !index) return [];
    const drawn = new Set(placed.map((p) => p.element.id));
    const distinct = (ids: string[]) => new Set(ids).size;
    // A file module's only element is placed automatically (autoPlaceSoleChildren) and can't be
    // dragged; inside folders everything moves freely.
    const held = new Map<string, number>();
    for (const p of placed) if (p.element.parent) held.set(p.element.parent, (held.get(p.element.parent) ?? 0) + 1);
    const kindOf = new Map(placed.map((p) => [p.element.id, p.element.kind]));
    // Nesting depth: deeper elements float higher (bigger shadows), so the diagram reads in layers.
    const parentOf = new Map(placed.map((p) => [p.element.id, p.element.parent]));
    const depthOf = (id: string) => {
      let d = 0;
      for (let p = parentOf.get(id) ?? null; p; p = parentOf.get(p) ?? null) d++;
      return d;
    };
    return placed.map((p) => {
      const id = p.element.id;
      const node = snapshot.nodes[id];
      const parents = node ? parentEdges(snapshot, index, id, filter) : [];
      const children = node ? childEdges(snapshot, index, id, filter) : [];
      return {
        id,
        type: p.holds ? "frame" : "card",
        position: { x: p.x, y: p.y },
        width: p.width,
        height: p.height,
        parentId: p.element.parent ?? undefined,
        dragHandle: p.holds ? `.${FRAME_HANDLE}` : undefined,
        draggable: !(p.element.parent && kindOf.get(p.element.parent) === "module" && held.get(p.element.parent) === 1),
        style: { "--depth": depthOf(id) } as CSSProperties,
        selected: false,
        // React Flow's own selection stays off (it flips its internal node state on click, out of
        // the store's reach); selection is the store's, passed in via `selected`.
        selectable: false,
        data: {
          element: p.element,
          node,
          path: id.startsWith(FOLDER_PREFIX) ? id.slice(FOLDER_PREFIX.length) : undefined,
          scannedCount: id.startsWith(FOLDER_PREFIX) ? scannedUnder.get(id.slice(FOLDER_PREFIX.length)) : undefined,
          parents: distinct(parents.map((e) => e.from)),
          children: distinct(children.map((e) => e.to)),
          hiddenParents: distinct(parents.filter((e) => !drawn.has(e.from)).map((e) => e.from)),
          hiddenChildren: distinct(children.filter((e) => !drawn.has(e.to)).map((e) => e.to)),
          can: node
            ? {
                parents: parents.some((e) => !drawn.has(e.from)),
                allParents: hasUndrawn(snapshot, index, id, "parents", true, filter, drawn),
                children: children.some((e) => !drawn.has(e.to)),
                allChildren: hasUndrawn(snapshot, index, id, "children", true, filter, drawn),
                routeChain: (() => {
                  const route = routeOf(snapshot, id);
                  return !!route && routeChain(snapshot, route).some((x) => !drawn.has(x));
                })(),
              }
            : id.startsWith(FOLDER_PREFIX)
              ? // folders: "children" = the files inside, "all children" = files and their declarations
                {
                  // parents = the folders above it, up to the project root
                  parents: parentFolders(id, false).some((x) => !drawn.has(x)),
                  allParents: parentFolders(id, true).filter((x) => !drawn.has(x)).length > 1,
                  children: folderExpansion(snapshot, folderPath(id), false).some((x) => !drawn.has(x)),
                  allChildren: folderExpansion(snapshot, folderPath(id), true).some((x) => !drawn.has(x)),
                }
              : { parents: false, allParents: false, children: false, allChildren: false },
          change: showDiff ? changeOf(snapshot, id) : undefined,
          undrawnContents:
            node?.kind === "module" ? (index.out.get(id) ?? []).filter((e) => e.kind === "declares" && !drawn.has(e.to)).length : undefined,
        },
      } as ElementFlowNode;
    });
  }, [snapshot, index, placed, filter, scannedUnder, showDiff]);

  const shownNodes = useMemo(() => {
    if (!collapse.frames.size) return derived;
    return derived.map((n) => {
      if (collapse.shownAs.has(n.id)) return { ...n, hidden: true } as ElementFlowNode;
      const count = collapse.frames.get(n.id);
      return count ? ({ ...n, data: { ...n.data, collapsed: count } } as ElementFlowNode) : n;
    });
  }, [derived, collapse]);

  // Selection and relatedness are applied on top, so only the nodes involved are re-created. What's
  // hidden in a collapsed frame shows as the frame: it's marked related.
  const selectedNodes = useMemo(() => {
    if (!selection.length) return shownNodes;
    const sel = new Set(selection);
    const block = (id: string) => collapse.shownAs.get(id);
    const marked = new Set([...selection, ...related.nodes].map(block).filter((id): id is string => !!id));
    return shownNodes.map((n) =>
      sel.has(n.id)
        ? ({ ...n, selected: true } as ElementFlowNode)
        : related.nodes.has(n.id) || marked.has(n.id)
          ? ({ ...n, className: "rae-related" } as ElementFlowNode)
          : n,
    );
  }, [shownNodes, selection, related, collapse]);
  return selectedNodes;
}
