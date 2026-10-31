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
      return { d: `M16,${I} H${w - 16} Q${w - 13},${I} ${w - 11},${I + 4} L${w - I - 1},${h / 2 - 3} Q${w - I},${h / 2} ${w - I - 1},${h / 2 + 3} L${w - 11},${h - I - 4} Q${w - 13},${h - I} ${w - 16},${h - I} H16 Q13,${h - I} 11,${h - I - 4} L${I + 1},${h / 2 + 3} Q${I},${h / 2} ${I + 1},${h / 2 - 3} L11,${I + 4} Q13,${I} 16,${I} Z` };
    case "serverAction": // arrow
      return { d: `M${I + 12},${I} H${w - 20} Q${w - 16},${I} ${w - 13},${I + 4} L${w - I - 1},${h / 2 - 3} Q${w - I},${h / 2} ${w - I - 1},${h / 2 + 3} L${w - 13},${h - I - 4} Q${w - 16},${h - I} ${w - 20},${h - I} H${I + 12} A12,12 0 0 1 ${I},${h - I - 12} V${I + 12} A12,12 0 0 1 ${I + 12},${I} Z` };
    case "module": // sheet with a folded corner
      return {
        d: `M${I + 10},${I} H${w - 18} L${w - I},18 V${h - I - 10} A10,10 0 0 1 ${w - I - 10},${h - I} H${I + 10} A10,10 0 0 1 ${I},${h - I - 10} V${I + 10} A10,10 0 0 1 ${I + 10},${I} Z`,
        fold: `M${w - 18},${I} V12 Q${w - 18},18 ${w - 12},18 H${w - I}`,
      };
    case "function": // solid pill
    case "external": // dashed pill
      return { d: r(h) };
    default: // component: rounded rectangle
      return { d: r(16) };
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
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="rae-card__grad-a" />
          <stop offset="0.55" className="rae-card__grad-b" />
          <stop offset="1" className="rae-card__grad-c" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="rae-card__shine" />
          <stop offset="0.35" className="rae-card__shine" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* tinted glass fill, a soft top sheen, then the outline */}
      <path d={d} fill={`url(#${id}g)`} />
      <path d={d} fill={`url(#${id}h)`} />
      <path d={d} className="rae-card__stroke" data-dashed={kind === "external" || undefined} />
      {fold && <path d={fold} className="rae-card__stroke rae-card__fold" />}
    </svg>
  );
}
