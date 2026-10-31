import { IconArrowDown, IconArrowUp, IconChevronsDown, IconChevronsUp, IconHide, IconLayout, IconUngroup } from "@rae/design-system/icons";
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

const I = 13;

/** Expand / hide (frames: tidy up, remove only the file) buttons shared by cards and frames. */
export function NodeActions({ data, frame }: { data: ElementNodeData; frame?: boolean }) {
  const { expand, hideNode, arrange } = useExplorer.getState();
  const { element, node, parents, children, hiddenParents, hiddenChildren } = data;
  const id = element.id;
  return (
    <span className="rae-actions nodrag nopan">
      {node && (
        <>
          <IconBtn label={`Show parents (${hiddenParents} of ${parents} not drawn)`} icon={<IconArrowUp size={I} />} disabled={!parents} onClick={() => expand(id, "parents", false)} />
          <IconBtn label="Show all parents up to the root" icon={<IconChevronsUp size={I} />} disabled={!parents} onClick={() => expand(id, "parents", true)} />
          <IconBtn label={`Show children (${hiddenChildren} of ${children} not drawn)`} icon={<IconArrowDown size={I} />} disabled={!children} onClick={() => expand(id, "children", false)} />
          <IconBtn label="Show all children down to the leaves" icon={<IconChevronsDown size={I} />} disabled={!children} onClick={() => expand(id, "children", true)} />
        </>
      )}
      {frame && <IconBtn label="Tidy up inside" icon={<IconLayout size={I} />} onClick={() => void arrange(id)} />}
      {frame && node?.kind === "module" && (
        <IconBtn label="Remove only this file, keep what it holds" icon={<IconUngroup size={I} />} onClick={() => hideNode(id, { keepContents: true })} />
      )}
      <IconBtn label={frame ? "Remove with everything inside" : "Remove from the diagram"} icon={<IconHide size={I} />} onClick={() => hideNode(id)} />
    </span>
  );
}
