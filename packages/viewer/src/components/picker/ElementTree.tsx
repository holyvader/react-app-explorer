import { IconChevronDown, IconChevronRight, IconFolder, IconLibrary } from "@rae/design-system/icons";
import { type KeyboardEvent, type RefObject, useMemo, useRef, useState } from "react";
import { buildTree, type TreeNode, visibleRows } from "../../graph/tree.ts";
import { KIND_META } from "../../lib/kinds.tsx";
import { relationFilterOf, useExplorer } from "../../store.ts";
import "./picker.css";

export type TickState = "off" | "on" | "file" | "all" | "partial";

export interface ElementTreeProps {
  /** "toggle": rows tick elements in/out (picker). "pick": a click picks one, drawn ones left out (quick add). */
  mode: "toggle" | "pick";
  onActivate: (node: TreeNode) => void;
  /** Tick state of a row (toggle mode). */
  tickOf?: (node: TreeNode) => TickState | null;
  /** Hidden rows (pick mode: what's drawn already). */
  keep?: (node: TreeNode) => boolean;
  /** Greyed rows that only open (pick mode: drawn files with undrawn contents). */
  inactive?: (node: TreeNode) => string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  placeholder?: string;
}

const TICK: Record<TickState, string> = { off: "", on: "✓", all: "✓", file: "–", partial: "–" };

/**
 * The scanned model as a tree under a filter box. ↓ from the box steps into the tree; ↑/↓ move,
 * →/← (or the chevron) open/close, Enter or Space activates the row — folders included.
 */
export function ElementTree({ mode, onActivate, tickOf, keep, inactive, inputRef, placeholder }: ElementTreeProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const excluded = useExplorer((s) => s.excluded);
  const hideAll = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);

  const roots = useMemo(() => {
    if (!snapshot) return [];
    const f = relationFilterOf({ enabled: { imports: true, declares: true, renders: true, hooks: true, invokes: true, types: true, navigation: true }, excluded, hideAllLibraries: hideAll, showAssets });
    return buildTree(snapshot, f.libraries);
  }, [snapshot, excluded, hideAll, showAssets]);
  const { rows, truncated } = useMemo(() => visibleRows(roots, open, query, keep), [roots, open, query, keep]);

  const toggleOpen = (key: string, to?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (to ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });

  const focusRow = (i: number) => (list.current?.querySelectorAll<HTMLElement>("[role=treeitem]")[i])?.focus();

  const activate = (n: TreeNode) => {
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
      <div className="rae-tree-search">
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder ?? "Filter by name or path…"}
          aria-label="Filter elements"
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
      </div>
      <div className="rae-tree" role="tree" aria-label="Scanned elements" ref={list}>
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
              tabIndex={i === 0 ? 0 : -1}
              style={{ paddingLeft: 8 + r.depth * 16 }}
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
                {n.children.length ? r.open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} /> : null}
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
              {note && <span className="rae-tree__note">{note}</span>}
              {!note && n.kind === "file" && n.children.length > 0 && <span className="rae-tree__note">{n.children.length}</span>}
            </button>
          );
        })}
        {truncated && <div className="rae-tree__more">More elements: refine the filter.</div>}
      </div>
    </>
  );
}
