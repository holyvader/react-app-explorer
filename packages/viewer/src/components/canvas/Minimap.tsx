import { tokenVar, useColorMode, useDiagramPalette } from "@rae/design-system";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import type { PlacedElement } from "../../graph/layout.ts";

/** The minimap's size on screen (px). */
const W = 200;
const H = 150;
/** Room around the diagram inside the minimap (px). */
const PAD = 6;
/** Largest scale (minimap px per diagram px). */
const MAX_SCALE = 0.08;
/** Wheel over the minimap zooms by this much per step. */
const WHEEL_ZOOM = 1.2;

type Rect = { x: number; y: number; w: number; h: number; kind: string; frame: boolean };

/**
 * The diagram in small, bottom right: every placed element drawn on one `<canvas>`, the view as a
 * box over it (drag to move the view, wheel to zoom). Replaces React Flow's MiniMap, which renders
 * an SVG element per node and subscribes each one to the store: on a 4,000-element diagram that was
 * 4,000 selectors run on every zoom step and 3,400 elements mounted when the files open up
 * (e2e/zoomProfile.ts). This draws once per placement or theme change; the view box moves on the
 * store's transform without React.
 */
export function Minimap({ placed }: { placed: readonly PlacedElement[] }) {
  const store = useStoreApi();
  const flow = useReactFlow();
  const colorMode = useColorMode();
  const palette = useDiagramPalette();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // absolute rectangles (placement is relative to the parent), and how they map onto the minimap
  const { rects, map } = useMemo(() => {
    const byId = new Map(placed.map((p) => [p.element.id, p]));
    const abs = new Map<string, { x: number; y: number }>();
    const at = (p: PlacedElement): { x: number; y: number } => {
      const known = abs.get(p.element.id);
      if (known) return known;
      const parent = p.element.parent ? byId.get(p.element.parent) : undefined;
      const o = parent ? at(parent) : { x: 0, y: 0 };
      const r = { x: o.x + p.x, y: o.y + p.y };
      abs.set(p.element.id, r);
      return r;
    };
    const rects: Rect[] = placed.map((p) => ({ ...at(p), w: p.width, h: p.height, kind: p.element.kind, frame: p.holds }));
    if (!rects.length) return { rects, map: null };
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const bw = Math.max(...rects.map((r) => r.x + r.w)) - x0;
    const bh = Math.max(...rects.map((r) => r.y + r.h)) - y0;
    // a small diagram stays small (one card filled the whole box)
    const s = Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh, MAX_SCALE);
    // centred: flow (x, y) → minimap (ox + (x - x0) * s, oy + (y - y0) * s)
    return { rects, map: { s, x0, y0, ox: (W - bw * s) / 2, oy: (H - bh * s) / 2 } };
  }, [placed]);

  // the diagram, drawn again when it or the colours change
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!map) return;
    // tokens resolved to plain colours (a canvas can't read CSS variables)
    const probe = document.createElement("span");
    canvas.parentElement!.append(probe);
    const cache = new Map<string, string>();
    const color = (token: string) => {
      let c = cache.get(token);
      if (c === undefined) {
        probe.style.color = tokenVar(token);
        c = getComputedStyle(probe).color;
        cache.set(token, c);
      }
      return c;
    };
    const box = (r: Rect) => [map.ox + (r.x - map.x0) * map.s, map.oy + (r.y - map.y0) * map.s, Math.max(1, r.w * map.s), Math.max(1, r.h * map.s)] as const;
    // frames first (folders an outline, files a tint), then the cards over them
    for (const r of rects) {
      if (!r.frame && r.kind !== "folder") continue;
      const [x, y, w, h] = box(r);
      if (r.kind !== "folder") {
        ctx.fillStyle = color(`kind.${r.kind}.subtle`);
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = color("kind.module.muted");
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    for (const r of rects) {
      if (r.frame || r.kind === "folder") continue;
      const [x, y, w, h] = box(r);
      ctx.fillStyle = color(`kind.${r.kind}.solid`);
      ctx.fillRect(x, y, w, h);
    }
    probe.remove();
  }, [rects, map, colorMode, palette]);

  // the view's box, moved straight from the store's transform (no React render per zoom step)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const place = () => {
      const { transform, width, height } = store.getState();
      if (!map) {
        el.style.display = "none";
        return;
      }
      const [tx, ty, zoom] = transform;
      el.style.display = "";
      el.style.left = `${map.ox + (-tx / zoom - map.x0) * map.s}px`;
      el.style.top = `${map.oy + (-ty / zoom - map.y0) * map.s}px`;
      el.style.width = `${(width / zoom) * map.s}px`;
      el.style.height = `${(height / zoom) * map.s}px`;
    };
    place();
    let last = store.getState().transform;
    return store.subscribe((s) => {
      if (s.transform === last) return;
      last = s.transform;
      place();
    });
  }, [store, map]);

  // press or drag: the view centres there; wheel: zoom (a native listener, so it can stop the page)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !map) return;
    const toFlow = (e: PointerEvent | WheelEvent) => {
      const b = root.getBoundingClientRect();
      return { x: (e.clientX - b.left - map.ox) / map.s + map.x0, y: (e.clientY - b.top - map.oy) / map.s + map.y0 };
    };
    const centre = (e: PointerEvent) => {
      const p = toFlow(e);
      void flow.setCenter(p.x, p.y, { zoom: flow.getZoom() });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      centre(e);
      const move = (m: PointerEvent) => centre(m);
      const up = () => {
        root.removeEventListener("pointermove", move);
        root.removeEventListener("pointerup", up);
        root.removeEventListener("pointercancel", up);
      };
      root.addEventListener("pointermove", move);
      root.addEventListener("pointerup", up);
      root.addEventListener("pointercancel", up);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      void flow.zoomTo(flow.getZoom() * (e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM));
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("wheel", wheel, { passive: false });
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("wheel", wheel);
    };
  }, [flow, map]);

  return (
    <div ref={rootRef} className="rae-minimap nodrag nopan nowheel" style={{ width: W, height: H }} aria-label="Minimap: drag to move the view" role="img">
      <canvas ref={canvasRef} style={{ width: W, height: H }} />
      <div ref={boxRef} className="rae-minimap__view" />
    </div>
  );
}
