import { ActionIconButton, Box, Flex, Popover, SegmentedToggles, type Shortcut, ShortcutList, Text, textPx, tokenVar, type ToggleItem } from "@rae/design-system";
import { IconBack, IconChevronDown, IconFilter, IconFit, IconForward, IconKeyboard, IconMinimap, IconMinus, IconPlus, IconSelect } from "@rae/design-system/icons";
import { type FitViewOptions, useReactFlow, useStore } from "@xyflow/react";
import { useState } from "react";
import { EDGE_GROUPS, type EdgeGroup } from "../../graph/relations.ts";
import { goBack, goForward, useSelectionHistory } from "../../lib/selectionHistory.ts";
import { useExplorer } from "../../store.ts";
import { ScriptsChips } from "../scripts/ScriptsChips.tsx";

/* The canvas's own controls, in the status bar docked under it: relation filters, package.json scripts, Back / Forward, zoom, minimap, shortcuts. */

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

/** Zoom steps and fitting glide like a re-layout. */
const GLIDE = 220;

export interface StatusBarProps {
  shortcuts: Shortcut[];
  minimap: boolean;
  onMinimap: (on: boolean) => void;
  /** Padding the canvas fits with (FIT_PADDING). */
  fitPadding: FitViewOptions["padding"];
}

/**
 * The zoom in %, a button back to 100%. Its own component, subscribed to the rounded %: zooming
 * re-renders this alone, not the whole bar, and only when the number changes.
 */
function ZoomPercent() {
  const flow = useReactFlow();
  const zoom = useStore((s) => Math.round(s.transform[2] * 100));
  return (
    <Flex
      as="button"
      align="center"
      justify="center"
      minW="46px"
      h="26px"
      rounded="l2"
      fontFamily="mono"
      fontSize={textPx(11.5)}
      color="fg.muted"
      cursor="pointer"
      _hover={{ color: "fg", bg: "bg.muted" }}
      title="Zoom to 100%"
      aria-label={`Zoom ${zoom}%: zoom to 100%`}
      onClick={() => void flow.zoomTo(1, { duration: GLIDE })}
    >
      {zoom}%
    </Flex>
  );
}

/**
 * The canvas's status bar, docked flush under it as the toolbar is above: the relation filters (a
 * dropdown) on the left; Back / Forward, zoom (− 62% +, fit), the minimap switch and the keyboard
 * shortcuts on the right. Only the minimap floats over the diagram.
 */
export function CanvasStatusBar({ shortcuts, minimap, onMinimap, fitPadding }: StatusBarProps) {
  const { canBack, canForward } = useSelectionHistory();
  const flow = useReactFlow();
  const [keysOpen, setKeysOpen] = useState(false);
  return (
    <Flex role="toolbar" aria-label="Canvas" align="center" gap="1" h="36px" px="2" flexShrink={0} bg="panel.bg" borderTopWidth="1px" borderColor="border">
      <RelationFilters />
      <Divider />
      <ScriptsChips />
      {/* how to add, always at hand (the empty diagram says it too); no button over the canvas */}
      <Flex flex="1" minW="0" justify="center" align="center" gap="1.5" px="3" color="fg.subtle" fontSize={textPx(11.5)}>
        <IconSelect size={13} style={{ flexShrink: 0 }} />
        <Text as="span" truncate>
          Right-click empty space to add · Space to search
        </Text>
      </Flex>
      <BarIcon label="Back: the previously selected element (⌘ [)" icon={<IconBack />} onClick={goBack} disabled={!canBack} />
      <BarIcon label="Forward: the next selected element (⌘ ])" icon={<IconForward />} onClick={goForward} disabled={!canForward} />
      <Divider />
      <BarIcon label="Zoom out" icon={<IconMinus />} onClick={() => void flow.zoomOut({ duration: GLIDE })} />
      <ZoomPercent />
      <BarIcon label="Zoom in" icon={<IconPlus />} onClick={() => void flow.zoomIn({ duration: GLIDE })} />
      <BarIcon label="Fit everything" icon={<IconFit />} onClick={() => void flow.fitView({ padding: fitPadding, maxZoom: 1, duration: GLIDE })} />
      <BarIcon label={minimap ? "Hide the minimap" : "Show the minimap"} icon={<IconMinimap />} onClick={() => onMinimap(!minimap)} pressed={minimap} />
      <Divider />
      <Popover
        open={keysOpen}
        onOpenChange={setKeysOpen}
        label="Keyboard shortcuts"
        placement="top"
        width="440px"
        trigger={
          <Box display="inline-flex">
            <BarIcon label="Keyboard shortcuts" icon={<IconKeyboard />} pressed={keysOpen} />
          </Box>
        }
      >
        <Box p="3.5" overflowY="auto" maxH="70vh">
          <Text textStyle="panelLabel" color="fg.subtle" mb="2.5">
            Keyboard shortcuts
          </Text>
          <ShortcutList shortcuts={shortcuts} />
        </Box>
      </Popover>
    </Flex>
  );
}

/**
 * Which relations the diagram draws, at the status bar's left: one compact button (the swatches of
 * the shown ones, "5 of 8") that opens the list of toggles above it.
 */
export function RelationFilters() {
  const enabled = useExplorer((s) => s.enabled);
  const [open, setOpen] = useState(false);
  const shown = EDGE_GROUPS.filter(({ group }) => enabled[group]);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Relations"
      placement="top-start"
      width="190px"
      trigger={
        <Flex
          as="button"
          align="center"
          gap="2"
          h="26px"
          px="2"
          rounded="l2"
          flexShrink={0}
          color="fg.muted"
          fontSize={textPx(12)}
          cursor="pointer"
          bg={open ? "bg.muted" : undefined}
          _hover={{ color: "fg", bg: "bg.muted" }}
          aria-haspopup="dialog"
          aria-label={`Relations: ${shown.length} of ${EDGE_GROUPS.length} shown`}
        >
          <IconFilter size={14} />
          <Text as="span" color="fg">
            Relations
          </Text>
          <Flex as="span" gap="3px" align="center">
            {shown.map(({ group }) => (
              <Dot key={group} {...GROUP_LOOK[group]} />
            ))}
          </Flex>
          <Text as="span" fontFamily="mono" fontSize={textPx(11)} color="fg.subtle">
            {shown.length === EDGE_GROUPS.length ? "all" : `${shown.length} of ${EDGE_GROUPS.length}`}
          </Text>
          <IconChevronDown size={13} style={{ transform: "rotate(180deg)" }} />
        </Flex>
      }
    >
      <SegmentedToggles
        vertical
        label="Relations"
        items={EDGE_GROUPS.map(({ group, label }) => ({ value: group, label: label.toLowerCase(), ...GROUP_LOOK[group], on: enabled[group] }))}
        onToggle={(g) => useExplorer.getState().toggleGroup(g as EdgeGroup)}
      />
    </Popover>
  );
}

/** A shown relation's swatch on the closed button. */
function Dot({ color, shape }: Pick<ToggleItem, "color" | "shape">) {
  return (
    <Box
      as="span"
      w="7px"
      h="7px"
      flexShrink={0}
      rounded={shape === "circle" ? "full" : "2px"}
      transform={shape === "diamond" ? "rotate(45deg) scale(0.85)" : undefined}
      style={{ background: tokenVar(color!) }}
    />
  );
}

const Divider = () => <Box w="1px" h="16px" bg="card.border" mx="1" flexShrink={0} />;

function BarIcon({ pressed, ...props }: { label: string; icon: React.ReactNode; onClick?: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <ActionIconButton
      size="xs"
      w="26px"
      h="26px"
      minW="26px"
      color="kind.module.fg"
      bg={pressed ? "bg.muted" : undefined}
      aria-pressed={pressed}
      css={{ "& svg": { width: "15px", height: "15px" } }}
      {...props}
    />
  );
}
