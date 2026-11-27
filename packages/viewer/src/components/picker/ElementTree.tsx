import { IconChevronDown, IconChevronRight, IconClose, IconFolder, IconLibrary, IconPlus } from "@rae/design-system/icons";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { buildTree, changesTree, openKeys, type TreeNode, visibleRows } from "../../graph/tree.ts";
import { bigFileOf, fileSize } from "../../lib/bigFile.ts";
import { CHANGE_LETTER, CHANGE_WORD, changeOf } from "../../lib/diff.ts";
import type { NodeKind } from "@rae/schema";
import { KIND_META, renderingLabel } from "../../lib/kinds.tsx";
import { useExplorer, useRelationFilter } from "../../store.ts";
import { setDragGhost, TREE_DRAG_TYPE } from "../../lib/treeDrag.ts";
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
  /** Diff snapshots: only what the diff touched (and the folders / files down to it), all opened at first. */
  changesOnly?: boolean;
  /**
   * Browse mode: rows picked for adding together (⌘-click toggles one, ⇧-click a run from the last
   * one), marked; `toggle` flips the keys, `range` adds them. Picked rows drag onto the canvas together.
   */
  picked?: ReadonlySet<string>;
  onPick?: (keys: string[], how: "toggle" | "range" | "clear") => void;
  /** Browse mode: a row right-clicked (the file tree's menu), at that point. */
  onRowMenu?: (node: TreeNode, at: { x: number; y: number }) => void;
  /** Shown when there are no rows at all (without a filter). */
  emptyText?: string;
  /**
   * Commands instead of elements when the filter starts with `prefix` (⌘K's `>`: package.json
   * scripts): `render` draws them for the text after it, Enter in the box does `run`.
   */
  commands?: { prefix: string; render: (term: string) => ReactNode; run: (term: string) => boolean };
}

const TICK: Record<TickState, string> = { off: "", on: "✓", all: "✓", file: "–", partial: "–" };

/** The filter's kind chips, in this order (only kinds the project has are offered). */
const KIND_FILTERS: { kind: NodeKind; label: string }[] = [
  { kind: "component", label: "Components" },
  { kind: "hook", label: "Hooks" },
  { kind: "function", label: "Functions" },
  { kind: "serverAction", label: "Server actions" },
  { kind: "type", label: "Types" },
  { kind: "route", label: "Routes" },
  { kind: "module", label: "Files" },
  { kind: "external", label: "Libraries" },
];

/** A row's element kind, for the kind filter: files are modules, libraries externals; folders and groups none. */
function kindOfRow(n: TreeNode, nodes: Record<string, { kind: NodeKind }> | undefined): NodeKind | undefined {
  if (n.kind === "route") return "route";
  if (n.kind === "file") return "module";
  if (n.kind === "library") return "external";
  if (n.kind === "decl" && n.id) return nodes?.[n.id]?.kind;
  return undefined;
}

/**
 * The scanned model as a tree under a filter box. ↓ from the box steps into the tree; ↑/↓ move,
 * →/← (or the chevron) open/close, Enter or Space activates the row — folders included.
 */
export function ElementTree({ mode, onActivate, tickOf, keep, inactive, inputRef, placeholder, hideFilter, drawn, onAdd, selectedId, changesOnly, emptyText, commands, onRowMenu, picked, onPick }: ElementTreeProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const filter = useRelationFilter({ allGroups: true });
  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const index = useExplorer((s) => s.index);
  const bigLimits = useExplorer((s) => s.bigFile);
  // diff snapshots: folders holding changed files get a dot
  const diffShown = !!snapshot?.diff && diffOverlay;
  const changedDirs = useMemo(() => {
    const dirs = new Set<string>();
    if (!diffShown) return dirs;
    for (const f of snapshot!.diff!.files) for (const p of [f.path, f.from]) for (let i = p?.lastIndexOf("/") ?? -1; i > 0; i = p!.lastIndexOf("/", i - 1)) dirs.add(p!.slice(0, i));
    return dirs;
  }, [snapshot, diffShown]);
  const [query, setQuery] = useState("");
  // the text after the commands' prefix, when the filter starts with it
  const command = commands && query.startsWith(commands.prefix) ? query.slice(commands.prefix.length).trim() : null;
  // the filter's kinds: none chosen = every kind
  const [kinds, setKinds] = useState<ReadonlySet<NodeKind>>(new Set());
  // the filter box hidden: its text and kinds no longer filter
  if (hideFilter && query) setQuery("");
  if (hideFilter && kinds.size) setKinds(new Set());
  const presentKinds = useMemo(() => new Set(Object.values(snapshot?.nodes ?? {}).map((n) => n.kind)), [snapshot]);
  const accept = useMemo(() => (kinds.size ? (n: TreeNode) => kinds.has(kindOfRow(n, snapshot?.nodes) as NodeKind) : undefined), [kinds, snapshot]);
  const list = useRef<HTMLDivElement>(null);
  // the last row picked: ⇧-click picks the run from it
  const pickAnchor = useRef<string | null>(null);

  // changes view: what git says about each file (status, line counts)
  const fileChanges = useMemo(() => new Map((changesOnly && snapshot?.diff?.files.map((f) => [f.path, f])) || []), [changesOnly, snapshot]);
  const roots = useMemo(() => {
    if (!snapshot) return [];
    const all = buildTree(snapshot, filter.libraries);
    if (!changesOnly || !snapshot.diff) return all;
    const d = snapshot.diff;
    return changesTree(all, (n) => !!n.id && (!!d.nodes[n.id] || ((n.kind === "file" || !!n.file) && fileChanges.has(n.path))));
  }, [snapshot, filter, changesOnly, fileChanges]);
  // the changes view starts with everything open (it's short); the full tree closed
  const [open, setOpen] = useState<Set<string>>(() => (changesOnly ? openKeys(roots) : new Set()));
  const { rows, truncated } = useMemo(() => visibleRows(roots, open, query, keep, accept), [roots, open, query, keep, accept]);

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
    if (n.kind === "libraries" || n.kind === "package" || n.kind === "routes" || note) return toggleOpen(n.key);
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
            if (command !== null) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                list.current?.querySelector<HTMLElement>("button")?.focus();
              } else if (e.key === "Enter" && commands!.run(command)) e.preventDefault();
              return;
            }
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
      {command === null && (
        <div className="rae-tree-kinds" hidden={hideFilter} role="group" aria-label="Filter by kind">
          {KIND_FILTERS.filter((k) => presentKinds.has(k.kind)).map((k) => {
            const Icon = KIND_META[k.kind].icon;
            const on = kinds.has(k.kind);
            return (
              <button
                key={k.kind}
                type="button"
                className="rae-tree-kind"
                data-kind={k.kind}
                aria-pressed={on}
                title={on ? `Showing ${k.label.toLowerCase()} · click to stop` : `Only ${k.label.toLowerCase()} (⇧-click to add to the others chosen)`}
                onClick={(e) => {
                  // a click picks only this kind (again: all kinds); ⇧-click adds or removes it
                  const next = new Set(e.shiftKey ? kinds : []);
                  if (e.shiftKey) {
                    if (on) next.delete(k.kind);
                    else next.add(k.kind);
                  } else if (!(on && kinds.size === 1)) next.add(k.kind);
                  setKinds(next);
                }}
              >
                <Icon size={12} />
                {k.label}
              </button>
            );
          })}
        </div>
      )}
      {command !== null ? (
        <div className="rae-tree" ref={list}>
          {commands!.render(command)}
        </div>
      ) : (
      <div className="rae-tree" role="tree" aria-label={mode === "browse" ? "Files" : "Project elements"} ref={list}>
        {rows.length === 0 && <div className="rae-tree__empty">{!query && !kinds.size && emptyText ? emptyText : "Nothing matches."}</div>}
        {rows.map((r, i) => {
          const n = r.node;
          const node = n.id ? snapshot?.nodes[n.id] : undefined;
          const Icon = n.kind === "folder" ? IconFolder : n.kind === "libraries" || n.kind === "package" ? IconLibrary : n.kind === "routes" ? KIND_META.route.icon : KIND_META[node?.kind ?? "module"].icon;
          const tick = mode === "toggle" ? tickOf?.(n) : null;
          const note = inactive?.(n);
          const change = diffShown && n.id ? changeOf(snapshot, n.id) : undefined;
          // a folder holding changes, or (changes view) a file git didn't change whose elements did
          const dirChanged = diffShown && ((n.kind === "folder" && changedDirs.has(n.path)) || (!!changesOnly && n.kind === "file" && !change && !fileChanges.has(n.path)));
          const big = node && index && (n.kind === "file" || n.file) ? bigFileOf(fileSize(snapshot!, index, node), bigLimits) : undefined;
          // what adding this row adds: its element, or the folder
          const addKey = n.id ?? (n.kind === "folder" ? n.key : undefined);
          const gitFile = changesOnly && (n.kind === "file" || n.file) ? fileChanges.get(n.path) : undefined;
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
              data-picked={addKey && picked?.has(addKey) ? "" : undefined}
              draggable={mode === "browse" && !!addKey}
              onDragStart={(e) => {
                if (!addKey) return;
                const ids = picked?.has(addKey) ? [...picked] : [addKey];
                e.dataTransfer.setData(TREE_DRAG_TYPE, JSON.stringify(ids));
                e.dataTransfer.effectAllowed = "copy";
                setDragGhost(e.nativeEvent, ids.length > 1 ? `+${ids.length}` : `+ ${n.name}`);
              }}
              onClick={(e) => {
                if (mode === "browse" && onPick && addKey && (e.metaKey || e.ctrlKey || e.shiftKey)) {
                  // ⌘-click: this row in or out; ⇧-click: the run from the last one picked
                  const from = e.shiftKey && pickAnchor.current ? rows.findIndex((r) => (r.node.id ?? r.node.key) === pickAnchor.current) : -1;
                  if (from >= 0) {
                    const [a, b] = from < i ? [from, i] : [i, from];
                    const run = rows.slice(a, b + 1).map((r) => r.node.id ?? (r.node.kind === "folder" ? r.node.key : undefined)).filter((k): k is string => !!k);
                    onPick(run, "range");
                  } else onPick([addKey], "toggle");
                  pickAnchor.current = addKey;
                  return;
                }
                if (picked?.size) onPick?.([], "clear");
                pickAnchor.current = addKey ?? null;
                activate(n);
              }}
              onContextMenu={
                onRowMenu &&
                ((e) => {
                  e.preventDefault();
                  onRowMenu(n, { x: e.clientX, y: e.clientY });
                })
              }
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
              <span className="rae-tree__icon" data-kind={n.kind === "folder" || n.kind === "libraries" ? n.kind : n.kind === "package" ? "external" : n.kind === "routes" ? "route" : node?.kind}>
                <Icon size={14} />
              </span>
              <span className="rae-tree__name" data-change={change}>
                {n.name}
              </span>
              {change && (
                <span className="rae-tree__change" data-change={change} title={`${CHANGE_WORD[change]} in this diff`}>
                  {CHANGE_LETTER[change]}
                </span>
              )}
              {big && (
                <span className="rae-tree__big" title={big.title} aria-label={big.title}>
                  {big.label}
                </span>
              )}
              {dirChanged && <span className="rae-tree__change" data-change="dir" title={n.kind === "file" ? "Unchanged file: elements in it changed" : "Changes inside"} />}
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
              {gitFile && (
                <span className="rae-tree__note" title={gitFile.from ? `renamed from ${gitFile.from}` : undefined}>
                  +{gitFile.additions} −{gitFile.deletions}
                </span>
              )}
              {!note && !changesOnly && n.kind === "file" && n.children.length > 0 && <span className="rae-tree__note">{n.children.length}</span>}
              {!note && n.file && node?.fileName && !node.route?.rendering && <span className="rae-tree__note">{node.fileName}</span>}
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
      )}
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
