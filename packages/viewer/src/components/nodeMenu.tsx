import type { Edge, EdgeKind, Snapshot } from "@rae/schema";
import type { MenuEntry } from "@rae/design-system";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconCopy,
  IconFocus,
  IconHide,
  IconLayout,
  IconOpen,
  IconRelations,
  IconSelect,
  IconUngroup,
} from "@rae/design-system/icons";
import { isFolder } from "../graph/drawn.ts";
import { isFiltered } from "../graph/packages.ts";
import { editorUrl } from "../lib/editor.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { relationFilterOf, useExplorer } from "../store.ts";

/** Each relation, read both ways: what the node points at, and what points at it. */
const RELATIONS: { kinds: EdgeKind[]; out: string; in: string }[] = [
  { kinds: ["imports"], out: "Imports", in: "Imported by" },
  { kinds: ["declares"], out: "Declares", in: "Declared in" },
  { kinds: ["renders"], out: "Renders", in: "Rendered by" },
  { kinds: ["usesHook"], out: "Uses hooks", in: "Hook used by" },
  { kinds: ["invokes", "invokesAction"], out: "Invokes", in: "Invoked by" },
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
    return [
      { type: "item", value: "tidy", label: "Tidy up inside", icon: <IconLayout size={I} />, onSelect: () => void arrange(id) },
      { type: "item", value: "hide", label: "Remove with everything inside", icon: <IconHide size={I} />, hint: "⌫", onSelect: () => hideNode(id) },
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
      onSelect: () => window.open(editorUrl(editor, node.absPath!, node.loc?.line, node.loc?.col), "_self"),
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

  entries.push({ type: "separator" });
  entries.push({ type: "item", value: "parents", label: "Show parents", icon: <IconArrowUp size={I} />, onSelect: () => expand(id, "parents", false) });
  entries.push({ type: "item", value: "parents-all", label: "Show all parents up to the root", icon: <IconChevronsUp size={I} />, onSelect: () => expand(id, "parents", true) });
  entries.push({ type: "item", value: "children", label: "Show children", icon: <IconArrowDown size={I} />, onSelect: () => expand(id, "children", false) });
  entries.push({ type: "item", value: "children-all", label: "Show all children down to the leaves", icon: <IconChevronsDown size={I} />, onSelect: () => expand(id, "children", true) });

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
      entries.push({ type: "item", value: "hide-only", label: "Remove only this file, keep what it holds", icon: <IconUngroup size={I} />, onSelect: () => hideNode(id, { keepContents: true }) });
    }
  }
  if (multi) {
    entries.push({ type: "item", value: "hide-selected", label: `Remove ${st.selection.length} selected`, icon: <IconHide size={I} />, hint: "⌫", onSelect: () => hideNodes(st.selection) });
  }
  entries.push({ type: "item", value: "hide", label: holds ? "Remove with everything inside" : "Remove from the diagram", icon: <IconHide size={I} />, hint: multi ? undefined : "⌫", onSelect: () => hideNode(id) });
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
