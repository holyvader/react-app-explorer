import { SegmentedToggles, type ToggleItem } from "@rae/design-system";
import { IconBack, IconForward } from "@rae/design-system/icons";
import { ControlButton } from "@xyflow/react";
import { EDGE_GROUPS, type EdgeGroup } from "../../graph/relations.ts";
import { goBack, goForward, useSelectionHistory } from "../../lib/selectionHistory.ts";
import { useExplorer } from "../../store.ts";

/* The canvas's own controls, in React Flow panels: the relation filters (top left) and Back / Forward. */

/** Each relation filter's swatch: the same colour as its edges, a shape as the second cue. */
const GROUP_LOOK: Record<EdgeGroup, Pick<ToggleItem, "color" | "shape">> = {
  imports: { color: "relation.imports" },
  declares: { color: "relation.declares" },
  renders: { color: "relation.renders" },
  hooks: { color: "relation.usesHook", shape: "circle" },
  invokes: { color: "relation.invokes" },
  types: { color: "relation.usesType" },
  navigation: { color: "relation.navigates" },
  cache: { color: "relation.invalidates", shape: "diamond" },
};

/** Which relations the diagram draws, on the canvas's top-left corner. */
export function RelationFilters() {
  const enabled = useExplorer((s) => s.enabled);
  return (
    <SegmentedToggles
      label="Relations"
      title="Relations"
      items={EDGE_GROUPS.map(({ group, label }) => ({ value: group, label: label.toLowerCase(), ...GROUP_LOOK[group], on: enabled[group] }))}
      onToggle={(g) => useExplorer.getState().toggleGroup(g as EdgeGroup)}
    />
  );
}

/** Back / Forward through the selected elements (the desktop app has no browser buttons). */
export function HistoryButtons() {
  const { canBack, canForward } = useSelectionHistory();
  return (
    <div className="react-flow__controls rae-history__group">
      <ControlButton onClick={goBack} disabled={!canBack} title="Back: the previously selected element (⌘ [)" aria-label="Back to the previously selected element">
        <IconBack size={14} />
      </ControlButton>
      <ControlButton onClick={goForward} disabled={!canForward} title="Forward (⌘ ])" aria-label="Forward to the next selected element">
        <IconForward size={14} />
      </ControlButton>
    </div>
  );
}
