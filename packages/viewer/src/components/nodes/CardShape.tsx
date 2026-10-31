import { useId } from "react";

/** Inset so the stroke stays inside the node's box. */
const I = 1.5;

/** The outline of each kind, for a card of w × h. */
function outline(kind: string, w: number, h: number): { d: string; fold?: string } {
  const r = (rx: number) => {
    const x0 = I;
    const y0 = I;
    const x1 = w - I;
    const y1 = h - I;
    const k = Math.min(rx, (y1 - y0) / 2, (x1 - x0) / 2);
    return `M${x0 + k},${y0} H${x1 - k} A${k},${k} 0 0 1 ${x1},${y0 + k} V${y1 - k} A${k},${k} 0 0 1 ${x1 - k},${y1} H${x0 + k} A${k},${k} 0 0 1 ${x0},${y1 - k} V${y0 + k} A${k},${k} 0 0 1 ${x0 + k},${y0} Z`;
  };
  switch (kind) {
    case "hook": // hexagon
      return { d: `M14,${I} H${w - 14} L${w - I},${h / 2} L${w - 14},${h - I} H14 L${I},${h / 2} Z` };
    case "serverAction": // arrow
      return { d: `M${I},${I} H${w - 18} L${w - I},${h / 2} L${w - 18},${h - I} H${I} Z` };
    case "module": // sheet with a folded corner
      return { d: `M${I},${I} H${w - 16} L${w - I},16 V${h - I} H${I} Z`, fold: `M${w - 16},${I} V16 H${w - I}` };
    case "function": // solid pill
    case "external": // dashed pill
      return { d: r(h) };
    default: // component: rounded rectangle
      return { d: r(12) };
  }
}

/**
 * A card's shape as SVG: stroked outline (the border) and a translucent fill, so frames and edges
 * behind show through without the border colour bleeding into the fill.
 */
export function CardShape({ kind, width, height }: { kind: string; width: number; height: number }) {
  const id = useId();
  const { d, fold } = outline(kind, width, height);
  return (
    <svg className="rae-card__svg" width={width} height={height} aria-hidden>
      <defs>
        <clipPath id={`${id}c`}>
          <path d={d} />
        </clipPath>
        <linearGradient id={`${id}g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" className="rae-card__tint" />
          <stop offset="1" className="rae-card__tint" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={d} className="rae-card__fill" />
      <g clipPath={`url(#${id}c)`}>
        <rect x="0" y="0" width={width * 0.45} height={height} fill={`url(#${id}g)`} />
        {kind !== "external" && <rect x="0" y="0" width="5" height={height} className="rae-card__strip" />}
      </g>
      <path d={d} className="rae-card__stroke" data-dashed={kind === "external" || undefined} />
      {fold && <path d={fold} className="rae-card__stroke rae-card__fold" />}
    </svg>
  );
}
