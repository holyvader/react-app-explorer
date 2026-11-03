import { IconChevronDown, IconChevronRight, IconClose, IconFolder, IconLibrary, IconPlus } from "@rae/design-system/icons";
import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { buildTree, type TreeNode, visibleRows } from "../../graph/tree.ts";
import { KIND_META, renderingLabel } from "../../lib/kinds.tsx";
import { relationFilterOf, useExplorer } from "../../store.ts";
import "./picker.css";

export type TickState = "off" | "on" | "file" | "all" | "partial";

export interface ElementTreeProps {
  /**
   * "toggle": rows tick elements in/out (picker). "pick": a click picks one, drawn ones left out
   * (quick add). "browse": the file tree panel — a click opens / goes to the element, + adds it.
   */
  mode: "toggle" | "pick" | "browse";
  onActivate: (node: TreeNode) => void;
  /** Tick state of a row (toggle mode). */
  tickOf?: (node: TreeNode) => TickState | null;
  /** Hidden rows (pick mode: what's drawn already). */
  keep?: (node: TreeNode) => boolean;
  /** Greyed rows that only open (pick mode: drawn files with undrawn contents). */
  inactive?: (node: TreeNode) => string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  /** Without the filter box (the file tree shows it on demand). */
  hideFilter?: boolean;
  /** Browse mode: whether a row's element is on the diagram (no + then; a click goes to it). */
  drawn?: (node: TreeNode) => boolean;
  /** Browse mode: the + next to a row's name. */
  onAdd?: (node: TreeNode) => void;
  /** Browse mode: the selected element's id; its row is marked, and opened up to when it changes. */
  selectedId?: string;
}

const TICK: Record<TickState, string> = { off: "", on: "✓", all: "✓", file: "–", partial: "–" };

/**
 * The scanned model as a tree under a filter box. ↓ from the box steps into the tree; ↑/↓ move,
 * →/← (or the chevron) open/close, Enter or Space activates the row — folders included.
 */
export function ElementTree({ mode, onActivate, tickOf, keep, inactive, inputRef, placeholder, hideFilter, drawn, onAdd, selectedId }: ElementTreeProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const excluded = useExplorer((s) => s.excluded);
  const hideAll = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const [query, setQuery] = useState("");
  // the filter box hidden: its text no longer filters
  if (hideFilter && query) setQuery("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);

  const roots = useMemo(() => {
    if (!snapshot) return [];
    const f = relationFilterOf({ enabled: { imports: true, declares: true, renders: true, hooks: true, invokes: true, types: true, navigation: true, cache: true }, excluded, hideAllLibraries: hideAll, showAssets });
    return buildTree(snapshot, f.libraries);
  }, [snapshot, excluded, hideAll, showAssets]);
  const { rows, truncated } = useMemo(() => visibleRows(roots, open, query, keep), [roots, open, query, keep]);

  // browse mode: a newly selected element's row comes into sight (its folders opened)
  const [revealed, setRevealed] = useState<string>();
  if (mode === "browse" && selectedId && selectedId !== revealed) {
    setRevealed(selectedId);
    const chain = pathTo(roots, selectedId);
    if (chain && chain.some((k) => !open.has(k))) setOpen(new Set([...open, ...chain]));
  }
  useEffect(() => {
    if (mode !== "browse" || !selectedId) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [mode, selectedId, rows]);

  const toggleOpen = (key: string, to?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (to ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });

  const focusRow = (i: number) => (list.current?.querySelectorAll<HTMLElement>("[role=treeitem]")[i])?.focus();

  const activate = (n: TreeNode) => {
    // browse: a row opens / closes, and the panel goes to it if it's on the diagram
    if (mode === "browse") {
      if (n.children.length) toggleOpen(n.key);
      return onActivate(n);
    }
    const note = inactive?.(n);
    // Folders are addable too (the chevron / → opens them); the Libraries group only opens.
    if (n.kind === "libraries" || n.kind === "routes" || note) return toggleOpen(n.key);
    onActivate(n);
  };

  const onRowKey = (e: KeyboardEvent, i: number) => {
    const row = rows[i]!;
    const actions: Record<string, () => void> = {
      ArrowDown: () => focusRow(Math.min(i + 1, rows.length - 1)),
      ArrowUp: () => (i === 0 ? inputRef.current?.focus() : focusRow(i - 1)),
      ArrowRight: () => {
        if (!row.node.children.length) return;
        if (row.open) focusRow(i + 1);
        else toggleOpen(row.node.key, true);
      },
      ArrowLeft: () => {
        if (row.open) return toggleOpen(row.node.key, false);
        for (let j = i - 1; j >= 0; j--) if (rows[j]!.depth < row.depth) return focusRow(j);
      },
      Enter: () => activate(row.node),
      " ": () => activate(row.node),
      Home: () => focusRow(0),
      End: () => focusRow(rows.length - 1),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  return (
    <>
      <div className="rae-tree-search" hidden={hideFilter}>
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder ?? "Filter by name or path…"}
          aria-label={mode === "browse" ? "Filter files" : "Filter elements"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusRow(0);
            } else if (e.key === "Enter") {
              // The first match that can be added (not a folder, not already drawn).
              const q = query.trim().toLowerCase();
              const addable = (r: (typeof rows)[number]) => (!!r.node.id || r.node.kind === "folder") && !inactive?.(r.node);
              const first = rows.find((r) => addable(r) && r.node.name.toLowerCase().includes(q)) ?? rows.find(addable);
              if (!first) return;
              e.preventDefault();
              activate(first.node);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="rae-tree-search__clear"
            aria-label="Clear the filter"
            title="Clear the filter"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <IconClose size={13} />
          </button>
        )}
      </div>
      <div className="rae-tree" role="tree" aria-label={mode === "browse" ? "Files" : "Scanned elements"} ref={list}>
        {rows.length === 0 && <div className="rae-tree__empty">Nothing matches.</div>}
        {rows.map((r, i) => {
          const n = r.node;
          const node = n.id ? snapshot?.nodes[n.id] : undefined;
          const Icon = n.kind === "folder" ? IconFolder : n.kind === "libraries" ? IconLibrary : n.kind === "routes" ? KIND_META.route.icon : KIND_META[node?.kind ?? "module"].icon;
          const tick = mode === "toggle" ? tickOf?.(n) : null;
          const note = inactive?.(n);
          return (
            <button
              key={n.key}
              type="button"
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={n.children.length ? r.open : undefined}
              aria-checked={tick ? tick !== "off" : undefined}
              className="rae-tree__row"
              data-inactive={note ? "" : undefined}
              data-id={n.id ?? n.key}
              data-drawn={mode === "browse" && drawn?.(n) ? "" : undefined}
              data-selected={mode === "browse" && !!selectedId && (n.id ?? n.key) === selectedId ? "" : undefined}
              tabIndex={i === 0 ? 0 : -1}
              style={{ paddingLeft: mode === "browse" ? 10 + r.depth * 12 : 8 + r.depth * 16 }}
              onClick={() => activate(n)}
              onKeyDown={(e) => onRowKey(e, i)}
              title={n.path || n.name}
            >
              <span
                aria-hidden
                className="rae-tree__chev"
                onClick={(e) => {
                  if (!n.children.length) return;
                  e.stopPropagation();
                  toggleOpen(n.key);
                }}
              >
                {n.children.length ? r.open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} /> : null}
              </span>
              {tick && (
                <span className="rae-tree__tick" data-state={tick} aria-hidden>
                  {TICK[tick]}
                </span>
              )}
              <span className="rae-tree__icon" data-kind={n.kind === "folder" || n.kind === "libraries" ? n.kind : n.kind === "routes" ? "route" : node?.kind}>
                <Icon size={14} />
              </span>
              <span className="rae-tree__name">{n.name}</span>
              {mode === "browse" && onAdd && (n.id || n.kind === "folder") && !drawn?.(n) && (
                <span
                  role="button"
                  tabIndex={-1}
                  className="rae-tree__add"
                  aria-label={`Add ${n.name} to the diagram`}
                  title="Add to the diagram"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(n);
                  }}
                >
                  <IconPlus size={13} />
                </span>
              )}
              {note && <span className="rae-tree__note">{note}</span>}
              {!note && n.kind === "file" && n.children.length > 0 && <span className="rae-tree__note">{n.children.length}</span>}
              {!note && node?.route?.rendering && (
                <span className="rae-tree__note" title={node.route.rendering.reasons.join("\n")}>
                  {renderingLabel(node.route.rendering)}
                </span>
              )}
            </button>
          );
        })}
        {truncated && <div className="rae-tree__more">More elements: refine the filter.</div>}
      </div>
    </>
  );
}

/** The keys of the rows down to the one for `id` (its folders, file…), without that row itself. */
function pathTo(roots: TreeNode[], id: string): string[] | undefined {
  const walk = (nodes: TreeNode[], chain: string[]): string[] | undefined => {
    for (const n of nodes) {
      if ((n.id ?? n.key) === id) return chain;
      const found = n.children.length ? walk(n.children, [...chain, n.key]) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  return walk(roots, []);
}
