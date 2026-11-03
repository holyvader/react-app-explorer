import { IconArrowDown, IconArrowUp, IconChevronsDown, IconChevronsUp, IconLayout, IconRemove, IconRouteChain, IconUnwrap } from "@rae/design-system/icons";
import type { MouseEvent, ReactNode } from "react";
import { useExplorer } from "../../store.ts";
import type { ElementNodeData } from "./types.ts";

/** Plain button: rendered by the hundred, on every drag frame — no component library here. */
function IconBtn({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="rae-icon-btn nodrag nopan"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );
}

const I = 12;

/** Expand / hide (frames: tidy up, remove only the file) buttons shared by cards and frames. */
export function NodeActions({ data, frame }: { data: ElementNodeData; frame?: boolean }) {
  const { expand, expandFolder, showParentFolders, showRouteChain, hideNode, arrange } = useExplorer.getState();
  const { element, node, parents, children, hiddenParents, hiddenChildren, can } = data;
  const id = element.id;
  return (
    <span className="rae-actions nodrag nopan">
      {/* Only what would add something: no parents/children, or all of them drawn → no button. */}
      {node && can.parents && (
        <IconBtn label={`Show parents (${hiddenParents} of ${parents} not drawn)`} icon={<IconArrowUp size={I} />} onClick={() => expand(id, "parents", false)} />
      )}
      {node && can.allParents && <IconBtn label="Show all parents up to the root" icon={<IconChevronsUp size={I} />} onClick={() => expand(id, "parents", true)} />}
      {node && can.children && (
        <IconBtn label={`Show children (${hiddenChildren} of ${children} not drawn)`} icon={<IconArrowDown size={I} />} onClick={() => expand(id, "children", false)} />
      )}
      {node && can.allChildren && (
        <IconBtn label="Show all children down to the leaves" icon={<IconChevronsDown size={I} />} onClick={() => expand(id, "children", true)} />
      )}
      {node && can.routeChain && (
        <IconBtn label="Show the route chain (layouts down to the page)" icon={<IconRouteChain size={I} />} onClick={() => showRouteChain(id)} />
      )}
      {element.kind === "folder" && can.parents && (
        <IconBtn label="Show the parent folder" icon={<IconArrowUp size={I} />} onClick={() => showParentFolders(id, false)} />
      )}
      {element.kind === "folder" && can.allParents && (
        <IconBtn label="Show all parent folders up to the root" icon={<IconChevronsUp size={I} />} onClick={() => showParentFolders(id, true)} />
      )}
      {element.kind === "folder" && can.children && (
        <IconBtn label="Show the files inside" icon={<IconArrowDown size={I} />} onClick={() => expandFolder(id, false)} />
      )}
      {element.kind === "folder" && can.allChildren && (
        <IconBtn label="Show everything inside (files and their declarations)" icon={<IconChevronsDown size={I} />} onClick={() => expandFolder(id, true)} />
      )}
      {frame && <IconBtn label="Tidy up inside" icon={<IconLayout size={I} />} onClick={() => void arrange(id)} />}
      {frame && node?.kind === "module" && (
        <IconBtn label="Remove only this file, keep what it holds" icon={<IconUnwrap size={I} />} onClick={() => hideNode(id, { keepContents: true })} />
      )}
      <IconBtn label={frame ? "Remove with everything inside" : "Remove from the diagram"} icon={<IconRemove size={I} />} onClick={() => hideNode(id)} />
    </span>
  );
}

/**
 * A round "+" on the middle of a file's bottom border: what it declares that isn't drawn yet.
 * Opens a menu: all at once first, then each one (after noesis' "contains" button).
 */
export function ContainsButton({ data }: { data: ElementNodeData }) {
  const n = data.undrawnContents;
  if (!n) return null;
  const label = `Show ${n === 1 ? "the declaration" : `the ${n} declarations`} ${data.element.name} contains`;
  return (
    <button
      type="button"
      className="rae-contains nodrag nopan"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        useExplorer.getState().openMenu({ id: data.element.id, x: r.left, y: r.bottom + 4, mode: "contains" });
      }}
    >
      +{n}
    </button>
  );
}
