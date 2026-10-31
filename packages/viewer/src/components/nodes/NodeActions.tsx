import { ActionIconButton, HStack } from "@rae/design-system";
import { IconArrowDown, IconArrowUp, IconChevronsDown, IconChevronsUp, IconHide, IconLayout, IconUngroup } from "@rae/design-system/icons";
import type { MouseEvent } from "react";
import { useExplorer } from "../../store.ts";
import type { ElementNodeData } from "./types.ts";

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** Expand / hide (and for frames: tidy up) buttons shared by cards and frames. */
export function NodeActions({ data, frame }: { data: ElementNodeData; frame?: boolean }) {
  const { expand, hideNode, arrange } = useExplorer.getState();
  const { element, node, parents, children, hiddenParents, hiddenChildren } = data;
  const id = element.id;
  return (
    <HStack gap="0" className="nodrag nopan" flexShrink={0}>
      {node && (
        <>
          <ActionIconButton label={`Show parents (${hiddenParents} of ${parents} not drawn)`} icon={<IconArrowUp />} size="2xs" tooltip="native" disabled={!parents} onClick={stop(() => expand(id, "parents", false))} />
          <ActionIconButton label="Show all parents up to the root" icon={<IconChevronsUp />} size="2xs" tooltip="native" disabled={!parents} onClick={stop(() => expand(id, "parents", true))} />
          <ActionIconButton label={`Show children (${hiddenChildren} of ${children} not drawn)`} icon={<IconArrowDown />} size="2xs" tooltip="native" disabled={!children} onClick={stop(() => expand(id, "children", false))} />
          <ActionIconButton label="Show all children down to the leaves" icon={<IconChevronsDown />} size="2xs" tooltip="native" disabled={!children} onClick={stop(() => expand(id, "children", true))} />
        </>
      )}
      {frame && <ActionIconButton label="Tidy up inside" icon={<IconLayout />} size="2xs" tooltip="native" onClick={stop(() => void arrange(id))} />}
      {frame && node?.kind === "module" && (
        <ActionIconButton label="Remove only this file, keep what it holds" icon={<IconUngroup />} size="2xs" tooltip="native" onClick={stop(() => hideNode(id, { keepContents: true }))} />
      )}
      <ActionIconButton
        label={frame ? "Hide with everything inside" : "Hide from the diagram"}
        icon={<IconHide />}
        size="2xs" tooltip="native"
        onClick={stop(() => hideNode(id))}
      />
    </HStack>
  );
}
