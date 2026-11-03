import type { Edge, EdgeKind, Snapshot } from "@rae/schema";
import type { MenuEntry } from "@rae/design-system";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconCopy,
  IconFocus,
  IconFolder,
  IconRouteChain,
  IconRemove,
  IconLayout,
  IconOpen,
  IconRelations,
  IconSelect,
  IconUnwrap,
} from "@rae/design-system/icons";
import { FOLDER_PREFIX, isFolder, routeChain, routeOf } from "../graph/drawn.ts";
import { folderContents, folderExpansion, folderPath, parentFolders } from "../graph/folder.ts";
import { isFiltered } from "../graph/packages.ts";
import { hasUndrawn } from "../graph/relations.ts";
import { editorUrl, openInEditor } from "../lib/editor.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { relationFilterOf, useExplorer } from "../store.ts";

/** Each relation, read both ways: what the node points at, and what points at it. */
const RELATIONS: { kinds: EdgeKind[]; out: string; in: string }[] = [
  { kinds: ["imports"], out: "Imports", in: "Imported by" },
  { kinds: ["declares"], out: "Declares", in: "Declared in" },
  { kinds: ["renders"], out: "Renders", in: "Rendered by" },
  { kinds: ["usesHook"], out: "Uses hooks", in: "Hook used by" },
  { kinds: ["invokes", "invokesAction"], out: "Invokes", in: "Invoked by" },
  { kinds: ["usesType"], out: "Uses types", in: "Type used by" },
  { kinds: ["navigates"], out: "Navigates to", in: "Navigated to from" },
  { kinds: ["fetches"], out: "Calls APIs", in: "API called by" },
  { kinds: ["revalidates"], out: "Revalidates", in: "Revalidated by" },
  { kinds: ["runsBefore"], out: "Runs before routes", in: "Middleware" },
  { kinds: ["invalidates"], out: "Invalidates caches", in: "Invalidated by" },
  { kinds: ["routeFile"], out: "Route files", in: "Route" },
  { kinds: ["routeChild"], out: "Nested routes", in: "Parent route" },
];

/** Items listed per submenu before "Show all" is the way to get the rest. */
const MAX_ITEMS = 60;
const I = 14;

function relationMenu(label: string, edges: Edge[], side: "from" | "to", anchor: string, s: Snapshot, onCanvas: Set<string>): MenuEntry | null {
  const ids = [...new Set(edges.map((e) => e[side]))].filter((id) => s.nodes[id]);
  if (!ids.length) return null;
  const { addNodes } = useExplorer.getState();
  const missing = ids.filter((id) => !onCanvas.has(id));
  ids.sort((a, b) => Number(onCanvas.has(a)) - Number(onCanvas.has(b)) || s.nodes[a]!.name.localeCompare(s.nodes[b]!.name));
  const items: MenuEntry[] = ids.slice(0, MAX_ITEMS).map((id) => {
    const n = s.nodes[id]!;
    const Icon = KIND_META[n.kind].icon;
    return {
      type: "item",
      value: `${label}:${id}`,
      label: n.name,
      icon: <Icon size={I} />,
      hint: onCanvas.has(id) ? "✓ shown" : n.kind === "external" ? "library" : n.filePath.split("/").slice(-2, -1)[0] ?? "",
      onSelect: () => addNodes([id], { anchor, select: id }),
    };
  });
  return {
    type: "submenu",
    value: label,
    label,
    icon: <IconRelations size={I} />,
    hint: `${ids.length}`,
    entries: [
      {
        type: "item",
        value: `${label}:all`,
        label: missing.length ? `Show all (${missing.length} not shown)` : "All shown",
        disabled: !missing.length,
        onSelect: () => addNodes(missing, { anchor, fit: true }),
      },
      { type: "separator" },
      ...items,
      ...(ids.length > MAX_ITEMS ? [{ type: "label" as const, label: `…and ${ids.length - MAX_ITEMS} more (use Show all)` }] : []),
    ],
  };
}

/** Everything that can be done to a node, for its right-click menu. */
export function nodeMenuEntries(id: string): MenuEntry[] {
  const st = useExplorer.getState();
  const { snapshot: s, index, editor } = st;
  if (!s || !index) return [];
  const { expand, hideNode, hideNodes, arrange, addNodes } = st;
  const node = s.nodes[id];
  const holds = st.graph.elements.some((e) => e.parent === id);
  const entries: MenuEntry[] = [];

  if (isFolder(id)) {
    const path = folderPath(id);
    const drawnNow = new Set(st.graph.elements.map((e) => e.id));
    const canFiles = folderExpansion(s, path, false).some((x) => !drawnNow.has(x));
    const canAll = folderExpansion(s, path, true).some((x) => !drawnNow.has(x));
    return [
      { type: "item", value: "select", label: "Select", icon: <IconSelect size={I} />, onSelect: () => st.selectMany([id]) },
      { type: "item", value: "center", label: "Center on canvas", icon: <IconFocus size={I} />, onSelect: () => addNodes([], { focus: id }) },
      { type: "separator" },
      {
        type: "item",
        value: "parent",
        label: "Show the parent folder",
        icon: <IconArrowUp size={I} />,
        disabled: !parentFolders(id, false).some((x) => !drawnNow.has(x)),
        onSelect: () => st.showParentFolders(id, false),
      },
      {
        type: "item",
        value: "parents",
        label: "Show all parent folders up to the root",
        icon: <IconChevronsUp size={I} />,
        disabled: parentFolders(id, true).filter((x) => !drawnNow.has(x)).length < 2,
        onSelect: () => st.showParentFolders(id, true),
      },
      { type: "item", value: "files", label: "Show the files inside", icon: <IconArrowDown size={I} />, disabled: !canFiles, onSelect: () => st.expandFolder(id, false) },
      { type: "item", value: "all", label: "Show everything inside", icon: <IconChevronsDown size={I} />, disabled: !canAll, onSelect: () => st.expandFolder(id, true) },
      ...subfolderMenu(id, path, drawnNow),
      { type: "separator" },
      { type: "item", value: "tidy", label: "Tidy up inside", icon: <IconLayout size={I} />, onSelect: () => void arrange(id) },
      { type: "item", value: "hide", label: "Remove with everything inside", icon: <IconRemove size={I} />, hint: "⌫", onSelect: () => hideNode(id) },
    ];
  }
  if (!node) return [];

  const multi = st.selection.length > 1 && st.selection.includes(id);
  entries.push({ type: "item", value: "select", label: "Select", icon: <IconSelect size={I} />, onSelect: () => st.selectMany([id]) });
  if (node.absPath) {
    entries.push({
      type: "item",
      value: "open",
      label: "Open in editor",
      icon: <IconOpen size={I} />,
      onSelect: () => void openInEditor(editorUrl(editor, node.absPath!, node.loc?.line, node.loc?.col)).catch((e: Error) => useExplorer.getState().notify(e.message)),
    });
    entries.push({
      type: "item",
      value: "copy",
      label: "Copy path",
      icon: <IconCopy size={I} />,
      onSelect: () => void navigator.clipboard.writeText(`${node.absPath}:${node.loc?.line ?? 1}`),
    });
  }
  entries.push({ type: "item", value: "center", label: "Center on canvas", icon: <IconFocus size={I} />, onSelect: () => addNodes([id], { focus: id }) });

  // Expand actions that would add nothing (no parents/children, or all drawn) are disabled.
  const drawnNow = new Set(st.graph.elements.map((e) => e.id));
  const rf = relationFilterOf(st);
  const can = (dir: "parents" | "children", deep: boolean) => hasUndrawn(s, index, id, dir, deep, rf, drawnNow);
  entries.push({ type: "separator" });
  {
    const route = routeOf(s, id);
    if (route) {
      const drawnIds = new Set(st.graph.elements.map((e) => e.id));
      entries.push({
        type: "item",
        value: "routeChain",
        label: "Show route chain",
        icon: <IconRouteChain size={I} />,
        hint: s.nodes[route]!.route!.url,
        disabled: !routeChain(s, route).some((x) => !drawnIds.has(x)),
        onSelect: () => st.showRouteChain(id),
      });
    }
  }
  entries.push({ type: "item", value: "parents", label: "Show parents", icon: <IconArrowUp size={I} />, disabled: !can("parents", false), onSelect: () => expand(id, "parents", false) });
  entries.push({ type: "item", value: "parents-all", label: "Show all parents up to the root", icon: <IconChevronsUp size={I} />, disabled: !can("parents", true), onSelect: () => expand(id, "parents", true) });
  entries.push({ type: "item", value: "children", label: "Show children", icon: <IconArrowDown size={I} />, disabled: !can("children", false), onSelect: () => expand(id, "children", false) });
  entries.push({ type: "item", value: "children-all", label: "Show all children down to the leaves", icon: <IconChevronsDown size={I} />, disabled: !can("children", true), onSelect: () => expand(id, "children", true) });

  // Relations, both ways, with "show all" or one by one. Libraries hidden by the filter stay hidden.
  const { libraries } = relationFilterOf(st);
  const onCanvas = new Set(st.graph.elements.map((e) => e.id));
  const keep = (other: string) => !isFiltered(s.nodes[other], libraries);
  const relations: MenuEntry[] = [];
  for (const r of RELATIONS) {
    const out = (index.out.get(id) ?? []).filter((e) => r.kinds.includes(e.kind) && keep(e.to));
    const inc = (index.in.get(id) ?? []).filter((e) => r.kinds.includes(e.kind) && keep(e.from));
    const a = relationMenu(r.out, out, "to", id, s, onCanvas);
    const b = relationMenu(r.in, inc, "from", id, s, onCanvas);
    if (a) relations.push(a);
    if (b) relations.push(b);
  }
  // Declarations don't import themselves: their file does. Show the file's imports, and who imports
  // this declaration specifically (importers naming its export, or the whole module via `* as`).
  if (node.kind !== "module" && node.kind !== "external" && node.moduleId) {
    const names = node.exportNames ?? [];
    const namesIt = (e: { specifiers?: string[] }) =>
      (e.specifiers ?? []).some((sp) => sp.startsWith("* as ") || names.some((n) => sp === n || sp.startsWith(`${n} as `)));
    const fileImports = (index.out.get(node.moduleId) ?? []).filter((e) => e.kind === "imports" && keep(e.to));
    const importedBy = names.length ? (index.in.get(node.moduleId) ?? []).filter((e) => e.kind === "imports" && keep(e.from) && namesIt(e)) : [];
    const a = relationMenu("Imports (its file)", fileImports, "to", id, s, onCanvas);
    const b = relationMenu("Imported by", importedBy, "from", id, s, onCanvas);
    relations.unshift(...[a, b].filter((x): x is MenuEntry => !!x));
  }
  if (relations.length) {
    entries.push({ type: "separator" });
    entries.push({ type: "label", label: "Relations" });
    entries.push(...relations);
  }

  entries.push({ type: "separator" });
  if (holds) {
    entries.push({ type: "item", value: "tidy", label: "Tidy up inside", icon: <IconLayout size={I} />, onSelect: () => void arrange(id) });
    if (node.kind === "module") {
      entries.push({ type: "item", value: "hide-only", label: "Remove only this file, keep what it holds", icon: <IconUnwrap size={I} />, onSelect: () => hideNode(id, { keepContents: true }) });
    }
  }
  if (multi) {
    entries.push({ type: "item", value: "hide-selected", label: `Remove ${st.selection.length} selected`, icon: <IconRemove size={I} />, hint: "⌫", onSelect: () => hideNodes(st.selection) });
  }
  entries.push({ type: "item", value: "hide", label: holds ? "Remove with everything inside" : "Remove from the diagram", icon: <IconRemove size={I} />, hint: multi ? undefined : "⌫", onSelect: () => hideNode(id) });
  return entries;
}


/** The file's "+" menu: what it declares that isn't drawn — all at once, then each. */
export function containsEntries(id: string): MenuEntry[] {
  const st = useExplorer.getState();
  const { snapshot: s, index } = st;
  if (!s || !index) return [];
  const drawn = new Set(st.graph.elements.map((e) => e.id));
  const missing = (index.out.get(id) ?? []).filter((e) => e.kind === "declares" && !drawn.has(e.to)).map((e) => e.to);
  if (!missing.length) return [{ type: "label", label: "Everything inside is drawn" }];
  return [
    { type: "item", value: "all", label: `Show all ${missing.length}`, onSelect: () => st.addNodes(missing, { anchor: id, fit: true }) },
    { type: "separator" },
    ...missing.map((m): MenuEntry => {
      const n = s.nodes[m]!;
      const Icon = KIND_META[n.kind].icon;
      return { type: "item", value: m, label: n.name, icon: <Icon size={I} />, hint: KIND_META[n.kind].label, onSelect: () => st.addNodes([m], { anchor: id }) };
    }),
  ];
}

/** A folder's "Subfolders" submenu: add all of them, or any one (as folders on the diagram). */
function subfolderMenu(id: string, path: string, drawn: ReadonlySet<string>): MenuEntry[] {
  const st = useExplorer.getState();
  if (!st.snapshot) return [];
  const subs = folderContents(st.snapshot, path).subfolders;
  if (!subs.length) return [];
  const missing = subs.filter((f) => !drawn.has(`${FOLDER_PREFIX}${f.path}`));
  return [
    {
      type: "submenu",
      value: "subfolders",
      label: "Subfolders",
      icon: <IconFolder size={I} />,
      hint: `${subs.length}`,
      entries: [
        {
          type: "item",
          value: "subfolders:all",
          label: missing.length ? `Add all (${missing.length} not shown)` : "All shown",
          disabled: !missing.length,
          onSelect: () => st.addNodes(missing.map((f) => `${FOLDER_PREFIX}${f.path}`), { anchor: id, fit: true }),
        },
        { type: "separator" },
        ...subs.map(
          (f): MenuEntry => ({
            type: "item",
            value: `subfolders:${f.path}`,
            label: f.name,
            icon: <IconFolder size={I} />,
            hint: drawn.has(`${FOLDER_PREFIX}${f.path}`) ? "✓ shown" : `${f.count}`,
            onSelect: () => st.addNodes([`${FOLDER_PREFIX}${f.path}`], { anchor: id }),
          }),
        ),
      ],
    },
  ];
}
