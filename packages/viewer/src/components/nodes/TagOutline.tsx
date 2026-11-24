import { memo } from "react";
import { TAG_DEPTH } from "../../graph/layout.ts";

const CORNER = 4;
const TIP = 3;
const INSET = 0.75;

/** A polygon with a radius per corner (clamped to half of each adjacent edge), as an SVG path. */
function roundedPolygon(points: [x: number, y: number, r: number][]): string {
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x, y, r] = points[i]!;
    const [px, py] = points[(i + n - 1) % n]!;
    const [nx, ny] = points[(i + 1) % n]!;
    const l1 = Math.hypot(px - x, py - y);
    const l2 = Math.hypot(nx - x, ny - y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x + ((px - x) / l1) * rr;
    const ay = y + ((py - y) / l1) * rr;
    const bx = x + ((nx - x) / l2) * rr;
    const by = y + ((ny - y) / l2) * rr;
    d += `${i ? "L" : "M"}${ax.toFixed(2)} ${ay.toFixed(2)}Q${x} ${y} ${bx.toFixed(2)} ${by.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** The outline of a component card: both ends pointed, like `< >`. */
export function tagPath(width: number, height: number): string {
  const d = TAG_DEPTH;
  return roundedPolygon([
    [d, INSET, CORNER],
    [width - d, INSET, CORNER],
    [width - INSET, height / 2, TIP],
    [width - d, height - INSET, CORNER],
    [d, height - INSET, CORNER],
    [INSET, height / 2, TIP],
  ]);
}

/**
 * A component card's shape, drawn under its content in place of the box's border and background
 * (CSS borders can't come to a point). Its colours are CSS variables the card's states set
 * (`--tag-*` in canvas.css): the selection ring, then the outline.
 */
export const TagOutline = memo(function TagOutline({ width, height }: { width: number; height: number }) {
  const d = tagPath(width, height);
  return (
    <svg className="rae-card__tag" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path className="rae-card__tag-ring" d={d} />
      <path className="rae-card__tag-line" d={d} />
    </svg>
  );
});
