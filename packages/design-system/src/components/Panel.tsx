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

/**
 * Side panel container (e.g. details sidebar). With `resize`, its left edge is a drag handle
 * (plain pointer events: no re-render storm, the width is reported as it changes).
 */
export function Panel({ children, resize, ...rest }: BoxProps & { resize?: PanelResize }) {
  if (!resize) {
    return (
      <Box bg="bg.panel" borderLeftWidth="1px" borderColor="border.muted" h="full" overflowY="auto" {...rest}>
        {children}
      </Box>
    );
  }
  const { width, onWidthChange, min = 320, max = 900, defaultWidth, side = "right" } = resize;
  // dragging towards the window's middle widens the panel
  const dir = side === "right" ? -1 : 1;
  const border = side === "right" ? { borderLeftWidth: "1px" } : { borderRightWidth: "1px" };
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, min), Math.min(max, window.innerWidth - 360)));
  return (
    <Box position="relative" h="full" flexShrink={0} style={{ width }}>
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
        css={{ "&:hover, &[data-dragging]": { background: "color-mix(in srgb, var(--chakra-colors-component-500) 45%, transparent)" }, transition: "background 0.15s" }}
        onPointerDown={(e) => {
          e.preventDefault();
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          el.dataset.dragging = "";
          const startX = e.clientX;
          const startW = width;
          const move = (ev: PointerEvent) => onWidthChange(clamp(startW + dir * (ev.clientX - startX)));
          const up = () => {
            delete el.dataset.dragging;
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
      <Box bg="bg.panel" {...border} borderColor="border.muted" h="full" overflowY="auto" {...rest}>
        {children}
      </Box>
    </Box>
  );
}

/** Sticky panel header: free-form content (tile, title, actions…). */
export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <Box
      px="5"
      pt="5"
      pb="4"
      position="sticky"
      top="0"
      zIndex="1"
      bg="bg.panel"
      borderBottomWidth="1px"
      borderColor="border.muted"
      style={{ backdropFilter: "saturate(1.4) blur(8px)", background: "color-mix(in srgb, var(--chakra-colors-bg-panel) 88%, transparent)" }}
    >
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
  children: ReactNode;
}

/** Collapsible section inside a Panel: title, count pill, chevron. */
export function PanelSection({ title, count, defaultOpen = true, aside, children }: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // Collapsed content isn't mounted: long sections (relation lists, render trees) cost nothing until opened.
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)} lazyMount unmountOnExit>
      <Box borderBottomWidth="1px" borderColor="border.muted">
        <Collapsible.Trigger asChild>
          <Flex
            as="button"
            w="full"
            px="5"
            py="3"
            align="center"
            gap="2"
            cursor="pointer"
            transition="background 150ms ease"
            _hover={{ bg: "bg.subtle" }}
          >
            <Text fontSize="sm" fontWeight="semibold" color="fg">
              {title}
            </Text>
            {count !== undefined && (
              <Text as="span" fontSize="2xs" fontWeight="semibold" color="fg.muted" bg="bg.muted" px="1.5" rounded="full" lineHeight="18px">
                {count}
              </Text>
            )}
            <Box flex="1" />
            {aside}
            <Box color="fg.subtle" transition="transform 200ms ease" transform={open ? "rotate(0deg)" : "rotate(-90deg)"}>
              <ChevronDown size={16} />
            </Box>
          </Flex>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box px="5" pb="4">
            {children}
          </Box>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
}
