import type { MenuEntry } from "@rae/design-system";
import { IconFocus, IconModule, IconPlus, IconRoute } from "@rae/design-system/icons";
import { impactOf } from "../graph/impact.ts";
import type { TreeNode } from "../graph/tree.ts";
import { useExplorer } from "../store.ts";
import { nodeMenuEntries } from "./nodeMenu.tsx";

const I = 14;
/** Node-menu entries that only make sense for an element on the diagram. */
const ON_DIAGRAM_ONLY = new Set(["select", "center", "tidy", "hide", "hide-only", "hide-selected"]);

/**
 * A file-tree row's right-click menu: add it (with its file), or go to it; then what the canvas's
 * menu offers for it (parents, children, relations…); last, the routes, depending on the view —
 * every route in the Files view, the ones the diff affects in the Changes view.
 */
export function treeMenuEntries(n: TreeNode, changesView: boolean): MenuEntry[] {
  const st = useExplorer.getState();
  const s = st.snapshot;
  if (!s) return [];
  const id = n.id ?? (n.kind === "folder" ? n.key : undefined);
  const drawn = new Set(st.graph.elements.map((e) => e.id));
  const entries: MenuEntry[] = [];
  if (id) {
    const node = s.nodes[id];
    const onDiagram = drawn.has(id);
    if (onDiagram) {
      entries.push({ type: "item", value: "reveal", label: "Show on the diagram", icon: <IconFocus size={I} />, onSelect: () => st.addNodes([id], { select: id, focus: id }) });
    } else {
      entries.push({ type: "item", value: "add", label: "Add to the diagram", icon: <IconPlus size={I} />, onSelect: () => st.addNodes([id], { select: id, focus: id }) });
      // a declaration: with the file it's in, as a row of that file (already so with Settings → "Add with their file")
      const file = node && node.kind !== "module" && !node.file && !st.addWithFile ? node.moduleId : undefined;
      if (file && s.nodes[file])
        entries.push({ type: "item", value: "add-file", label: "Add with its file", icon: <IconModule size={I} />, hint: s.nodes[file]!.name, onSelect: () => st.addNodes([file, id], { select: id, focus: id }) });
    }
    const more = nodeMenuEntries(id).filter((e) => onDiagram || !("value" in e) || !ON_DIAGRAM_ONLY.has(e.value));
    // the node menu leads with Select / Center (on the diagram) or its editor actions: keep from its first separator on
    const tail = more.slice(Math.max(0, more.findIndex((e) => e.type === "separator")));
    const head = more.slice(0, more.length - tail.length).filter((e) => !("value" in e) || !ON_DIAGRAM_ONLY.has(e.value));
    entries.push(...head, ...tail);
  }
  const routes = routesEntry(changesView);
  if (routes) entries.push(...(entries.length ? [{ type: "separator" } as const] : []), routes);
  // no doubled or trailing separators
  return entries.filter((e, i, all) => e.type !== "separator" || (i > 0 && i < all.length - 1 && all[i - 1]!.type !== "separator"));
}

/** "Show all routes" (Files view), or "Show the routes this diff affects" (Changes view); asks first when many. */
export function routesEntry(changesView: boolean): MenuEntry | null {
  const st = useExplorer.getState();
  const { snapshot: s, index } = st;
  if (!s || !index) return null;
  const all = Object.values(s.nodes).filter((n) => n.kind === "route").map((n) => n.id);
  if (!all.length) return null;
  const drawn = new Set(st.graph.elements.map((e) => e.id));
  if (changesView && s.diff) {
    const affected = impactOf(s, index).routes.map((r) => r.id);
    const fresh = affected.filter((x) => !drawn.has(x));
    return {
      type: "item",
      value: "routes-affected",
      label: affected.length ? "Show the routes this diff affects" : "No route is affected",
      icon: <IconRoute size={I} />,
      hint: affected.length ? `${fresh.length} of ${affected.length}` : undefined,
      disabled: !fresh.length,
      onSelect: () => st.requestAdd(fresh, "The routes this diff affects"),
    };
  }
  const fresh = all.filter((x) => !drawn.has(x));
  return {
    type: "item",
    value: "routes-all",
    label: "Show all routes",
    icon: <IconRoute size={I} />,
    hint: `${fresh.length} of ${all.length}`,
    disabled: !fresh.length,
    onSelect: () => st.requestAdd(fresh, "All routes"),
  };
}
