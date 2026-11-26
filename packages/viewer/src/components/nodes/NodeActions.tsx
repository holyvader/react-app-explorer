import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconCode,
  IconCodeDiff,
  IconFolderTree,
  IconFolderUp,
  IconInvokes,
  IconLayout,
  IconRemove,
  IconRenders,
  IconRenderTree,
  IconRouteChain,
  IconUnwrap,
} from "@rae/design-system/icons";
import { downKinds, INVOKES } from "../../graph/relations.ts";
import { CHANGE_WORD } from "../../lib/diff.ts";
import { hasCode } from "../../lib/nodeDiff.ts";
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
  const { expand, expandFolder, showParentFolders, showRouteChain, hideNode, arrange, showCodeDiff, showCode } = useExplorer.getState();
  const { element, node, change, parents, children, hiddenParents, hiddenChildren, invokes, hiddenInvokes, can } = data;
  const id = element.id;
  const isComponent = node?.kind === "component";
  const down = downKinds(node?.kind);
  return (
    <span className="rae-actions nodrag nopan">
      {/* diff view on: what changed in its code (added: all new, removed: all gone) */}
      {node && hasCode(node) && <IconBtn label="Show the code" icon={<IconCode size={I} />} onClick={() => showCode(id)} />}
      {node && change && hasCode(node) && <IconBtn label={`Show the code diff (${CHANGE_WORD[change].toLowerCase()} in this diff)`} icon={<IconCodeDiff size={I} />} onClick={() => showCodeDiff(id)} />}
      {/* Only what would add something: no parents/children, or all of them drawn → no button. */}
      {node && can.parents && (
        <IconBtn label={`${node.kind === "component" ? "Rendered by" : "Show parents"} (${hiddenParents} of ${parents} not drawn)`} icon={<IconArrowUp size={I} />} onClick={() => expand(id, "parents", false)} />
      )}
      {node && can.allParents && <IconBtn label={node.kind === "component" ? "Rendered by, up to the root" : "Show all parents up to the root"} icon={<IconChevronsUp size={I} />} onClick={() => expand(id, "parents", true)} />}
      {node && can.children && (
        <IconBtn
          label={`${isComponent ? "Renders" : "Show children"} (${hiddenChildren} of ${children} not drawn)`}
          icon={isComponent ? <IconRenders size={I} /> : <IconArrowDown size={I} />}
          onClick={() => expand(id, "children", false, down)}
        />
      )}
      {node && can.allChildren && (
        <IconBtn
          label={isComponent ? "Show render tree" : "Show all children down to the leaves"}
          icon={isComponent ? <IconRenderTree size={I} /> : <IconChevronsDown size={I} />}
          onClick={() => expand(id, "children", true, down)}
        />
      )}
      {node && can.invokes && (
        <IconBtn label={`Invokes (${hiddenInvokes} of ${invokes} not drawn)`} icon={<IconInvokes size={I} />} onClick={() => expand(id, "children", false, INVOKES)} />
      )}
      {node && can.routeChain && (
        <IconBtn label="Show the route chain (layouts down to the page)" icon={<IconRouteChain size={I} />} onClick={() => showRouteChain(id)} />
      )}
      {node?.kind === "module" && can.folder && (
        <IconBtn label={`Show its folder (${node.filePath.slice(0, node.filePath.lastIndexOf("/"))})`} icon={<IconFolderUp size={I} />} onClick={() => showParentFolders(id, false)} />
      )}
      {element.kind === "folder" && can.parents && (
        <IconBtn label="Show the parent folder" icon={<IconFolderUp size={I} />} onClick={() => showParentFolders(id, false)} />
      )}
      {element.kind === "folder" && can.allParents && (
        <IconBtn label="Show all parent folders up to the root" icon={<IconFolderTree size={I} />} onClick={() => showParentFolders(id, true)} />
      )}
      {element.kind === "folder" && can.children && (
        <IconBtn label="Show the files inside" icon={<IconArrowDown size={I} />} onClick={() => expandFolder(id, false)} />
      )}
      {element.kind === "folder" && can.allChildren && (
        <IconBtn label="Show everything inside (files and their declarations)" icon={<IconChevronsDown size={I} />} onClick={() => expandFolder(id, true)} />
      )}
      {/* a file's rows have their fixed order: nothing to tidy */}
      {frame && element.kind !== "module" && <IconBtn label="Tidy up inside" icon={<IconLayout size={I} />} onClick={() => void arrange(id)} />}
      {frame && (node?.kind === "module" || element.kind === "folder") && (
        <IconBtn label={`Remove only this ${node ? "file" : "folder"}, keep what it holds`} icon={<IconUnwrap size={I} />} onClick={() => hideNode(id, { keepContents: true })} />
      )}
      <IconBtn label={frame ? "Remove with everything inside" : "Remove from the diagram"} icon={<IconRemove size={I} />} onClick={() => hideNode(id)} />
    </span>
  );
}

/**
 * A round "+" on the middle of a file's bottom border: what it declares that isn't drawn yet.
 * Opens a menu: all at once first, then each one.
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
