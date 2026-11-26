import type { Node } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

/*
 * Nodes glide to a new placement (a re-layout, undo, a drop pushing others aside) instead of
 * jumping: their positions and sizes are stepped every frame, so the edges follow them. A CSS
 * transition can't do it: edges are drawn from React Flow's positions (they would jump), and a
 * render after a big layout can keep the main thread longer than the transition lasts, so it was
 * already over when the first frame was painted.
 */

/** How long a glide lasts. */
export const GLIDE_MS = 320;
/**
 * Above this many nodes moving, they jump: React Flow re-renders every node it is given each frame,
 * and with ~200 moving a frame took 60–100 ms (a few jerky steps, worse than a clean jump).
 */
const GLIDE_LIMIT = 150;

interface Box {
  x: number;
  y: number;
  width?: number;
  height?: number;
}
export interface Glide {
  from: Map<string, Box>;
  to: Map<string, Box>;
}

const boxOf = (n: Node): Box => ({ x: n.position.x, y: n.position.y, width: n.width, height: n.height });
const differs = (a: Box, b: Box) => Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs((a.width ?? 0) - (b.width ?? 0)) > 0.5 || Math.abs((a.height ?? 0) - (b.height ?? 0)) > 0.5;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Fast at first, settling softly (as cubic-bezier(0.22, 1, 0.36, 1)). */
const ease = (k: number) => 1 - (1 - k) ** 4;

/**
 * Where the nodes that move between `shown` (as drawn now) and `next` (where they go) start from;
 * null when nothing moves. A node that changes container jumps: its position is relative to it.
 */
export function glideOf<N extends Node>(shown: readonly N[], next: readonly N[]): Glide | null {
  if (reducedMotion()) return null;
  const now = new Map(shown.map((n) => [n.id, n]));
  const from = new Map<string, Box>();
  const to = new Map<string, Box>();
  for (const n of next) {
    const was = now.get(n.id);
    if (!was || was.parentId !== n.parentId) continue;
    const a = boxOf(was);
    const b = boxOf(n);
    if (!differs(a, b)) continue;
    from.set(n.id, a);
    to.set(n.id, b);
  }
  return from.size && from.size <= GLIDE_LIMIT ? { from, to } : null;
}

/** `next` with the gliding nodes put back where they start. */
export function atStart<N extends Node>(next: readonly N[], glide: Glide): N[] {
  return next.map((n) => {
    const f = glide.from.get(n.id);
    return f ? ({ ...n, position: { x: f.x, y: f.y }, width: f.width, height: f.height } as N) : n;
  });
}

/**
 * Runs a glide: each frame, the gliding nodes a step closer to where they go (other changes to the
 * nodes, like measurements, are kept). `stop` (a drag starting) ends it where they are.
 */
export function useGlide<N extends Node>(setNodes: Dispatch<SetStateAction<N[]>>, stop: boolean) {
  const [glide, setGlide] = useState<Glide | null>(null);
  const stopped = useRef(stop);
  useEffect(() => {
    stopped.current = stop;
  }, [stop]);
  useEffect(() => {
    if (!glide) return;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      // a drag started: the nodes stay where they are, the drag takes over
      if (stopped.current) return setGlide(null);
      const k = Math.min(1, (now - t0) / GLIDE_MS);
      const e = ease(k);
      setNodes((ns) =>
        ns.map((n) => {
          const f = glide.from.get(n.id);
          const t = glide.to.get(n.id);
          if (!f || !t) return n;
          const at = (a: number, b: number) => a + (b - a) * e;
          const size = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? b : at(a, b));
          return { ...n, position: { x: at(f.x, t.x), y: at(f.y, t.y) }, width: size(f.width, t.width), height: size(f.height, t.height) };
        }),
      );
      if (k < 1) frame = requestAnimationFrame(step);
      else setGlide(null);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [glide, setNodes]);
  return setGlide;
}
