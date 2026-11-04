import { Box, Collapsible, Flex, Text, type BoxProps } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

export interface PanelResize {
  width: number;
  onWidthChange: (width: number) => void;
  min?: number;
  max?: number;
  /** Double-clicking the handle goes back to this width. */
  defaultWidth?: number;
  /**
   * The panel's side of the window: "right" (default) has the handle on its left edge, "left"
   * (e.g. a file tree) on its right edge.
   */
  side?: "left" | "right";
}

export interface PanelCollapse {
  /** Collapsed to a thin strip (`strip`), the width animating there and back. */
  collapsed: boolean;
  /** What the strip shows: e.g. a button to open the panel again. */
  strip: ReactNode;
}

/** A collapsed panel's width. */
export const PANEL_STRIP = 40;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SIDE_BORDER = (side: "left" | "right") => (side === "left" ? { borderRightWidth: "1px" } : { borderLeftWidth: "1px" });

/**
 * Side panel (file tree, details), docked flush against the canvas: the panel background with a
 * hairline on its inner edge. With `resize`, that edge is a drag handle (plain pointer events: no
 * re-render storm, the width is reported as it changes). With `collapse`, it folds to a thin strip
 * and back: the width animates (200ms) while the content, kept at its full width so nothing
 * reflows, fades out.
 */
export function Panel({ children, resize, collapse, ...rest }: BoxProps & { resize?: PanelResize; collapse?: PanelCollapse }) {
  const [dragging, setDragging] = useState(false);
  if (!resize) {
    return (
      <Box bg="panel.bg" borderColor="border" {...SIDE_BORDER("right")} h="full" overflowY="auto" {...rest}>
        {children}
      </Box>
    );
  }
  const { width, onWidthChange, min = 320, max = 900, defaultWidth, side = "right" } = resize;
  const collapsed = !!collapse?.collapsed;
  // dragging towards the window's middle widens the panel
  const dir = side === "right" ? -1 : 1;
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, min), Math.min(max, window.innerWidth - 360)));
  return (
    <Box
      position="relative"
      h="full"
      flexShrink={0}
      style={{ width: collapsed ? PANEL_STRIP : width, transition: dragging ? "none" : `width 200ms ${EASE}` }}
      data-collapsed={collapsed || undefined}
    >
      {!collapsed && (
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize the ${side === "right" ? "sidebar" : "left panel"} (double-click to reset)`}
          aria-valuenow={width}
          tabIndex={0}
          position="absolute"
          {...(side === "right" ? { left: "-3px" } : { right: "-3px" })}
          top="0"
          bottom="0"
          w="6px"
          zIndex="2"
          cursor="col-resize"
          css={{
            "&::after": { content: '""', position: "absolute", top: 0, bottom: 0, left: "2px", width: "2px", background: "transparent", transition: "background 140ms ease" },
            "&:hover::after, &[data-dragging]::after, &:focus-visible::after": { background: "var(--chakra-colors-selection-solid)" },
            outline: "none",
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            el.dataset.dragging = "";
            setDragging(true);
            const startX = e.clientX;
            const startW = width;
            const move = (ev: PointerEvent) => onWidthChange(clamp(startW + dir * (ev.clientX - startX)));
            const up = () => {
              delete el.dataset.dragging;
              setDragging(false);
              el.removeEventListener("pointermove", move);
              el.removeEventListener("pointerup", up);
              el.removeEventListener("pointercancel", up);
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", up);
            el.addEventListener("pointercancel", up);
          }}
          onDoubleClick={() => defaultWidth && onWidthChange(clamp(defaultWidth))}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onWidthChange(clamp(width - dir * 24));
            else if (e.key === "ArrowRight") onWidthChange(clamp(width + dir * 24));
          }}
        />
      )}
      <Box bg="panel.bg" borderColor="border" {...SIDE_BORDER(side)} h="full" overflow="hidden" position="relative">
        {/* the content keeps its full width while the panel folds, so nothing reflows mid-animation */}
        <Box
          h="full"
          overflowY="auto"
          {...rest}
          style={{ width, opacity: collapsed ? 0 : 1, transition: `opacity ${collapsed ? 120 : 200}ms ease ${collapsed ? "0ms" : "80ms"}` }}
          pointerEvents={collapsed ? "none" : undefined}
          aria-hidden={collapsed || undefined}
          inert={collapsed || undefined}
        >
          {children}
        </Box>
        {collapse && (
          <Box
            position="absolute"
            inset="0"
            style={{ opacity: collapsed ? 1 : 0, transition: `opacity ${collapsed ? 200 : 100}ms ease ${collapsed ? "100ms" : "0ms"}` }}
            pointerEvents={collapsed ? undefined : "none"}
            aria-hidden={!collapsed || undefined}
            inert={!collapsed || undefined}
          >
            {collapse.strip}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** A panel's 34px top bar: its uppercase label (FILES, DETAILS) and actions on the right. */
export function PanelBar({ label, children, sticky }: { label: ReactNode; children?: ReactNode; sticky?: boolean }) {
  return (
    <Flex
      align="center"
      gap="1"
      h="34px"
      pl="3.5"
      pr="1.5"
      flexShrink={0}
      borderBottomWidth="1px"
      borderColor="border.muted"
      bg="panel.bg"
      {...(sticky ? { position: "sticky", top: "0", zIndex: "2" } : {})}
    >
      <Text textStyle="panelLabel" color="fg.subtle" flex="1" truncate>
        {label}
      </Text>
      {children}
    </Flex>
  );
}

/** The panel's title block (icon, name, chips, path…): free-form content under the bar. */
export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <Box px="4" pt="4" pb="3.5" bg="panel.bg" borderBottomWidth="1px" borderColor="border.muted">
      {children}
    </Box>
  );
}

export interface PanelSectionProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  /** Right-aligned extra in the section header. */
  aside?: ReactNode;
  /**
   * Remember open / closed under this localStorage key: every section with the same key follows the
   * user's last choice (`defaultOpen` until there is one).
   */
  storageKey?: string;
  children: ReactNode;
}

const readOpen = (key: string | undefined, fallback: boolean) => {
  if (!key) return fallback;
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "open";
  } catch {
    return fallback;
  }
};

/** Collapsible section inside a Panel: chevron, title, then an aside or a count on the right. */
export function PanelSection({ title, count, defaultOpen = true, aside, storageKey, children }: PanelSectionProps) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  // another key (the same slot showing another section): its own remembered state ("adjust state during render")
  const [keyed, setKeyed] = useState(storageKey);
  if (keyed !== storageKey) {
    setKeyed(storageKey);
    setOpen(readOpen(storageKey, defaultOpen));
  }
  const toggle = (next: boolean) => {
    setOpen(next);
    if (storageKey)
      try {
        localStorage.setItem(storageKey, next ? "open" : "closed");
      } catch {
        /* storage full or off: this session only */
      }
  };
  return (
    // Collapsed content isn't mounted: long sections (relation lists, render trees) cost nothing until opened.
    <Collapsible.Root open={open} onOpenChange={(e) => toggle(e.open)} lazyMount unmountOnExit>
      <Box borderBottomWidth="1px" borderColor="border.muted">
        <Collapsible.Trigger asChild>
          <Flex as="button" w="full" h="32px" px="3.5" align="center" gap="1.5" cursor="pointer" _hover={{ bg: "bg.subtle" }}>
            <Box color="fg.subtle" display="inline-flex" transform={open ? "rotate(0deg)" : "rotate(-90deg)"} transition="transform 140ms ease">
              <ChevronDown size={12} />
            </Box>
            <Text textStyle="sectionLabel" color="kind.module.fg">
              {title}
            </Text>
            <Box flex="1" />
            {aside}
            {count !== undefined && (
              <Text as="span" fontFamily="mono" fontSize="10.5px" color="fg.subtle">
                {count}
              </Text>
            )}
          </Flex>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box px="3.5" pb="3">
            {children}
          </Box>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
}
