import { type RefObject, useLayoutEffect, useRef, useState } from "react";

const charWidths = new Map<string, number>();
/** The width of one character in an element's (monospace) font, measured once per font. */
function charWidth(el: Element): number {
  // from its parts: Chrome leaves the `font` shorthand empty when variation settings are in play
  const cs = getComputedStyle(el);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  let w = charWidths.get(font);
  if (w === undefined) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = font;
    w = ctx ? ctx.measureText("0000000000").width / 10 : 7.2;
    charWidths.set(font, w || 7.2);
  }
  return w || 7.2;
}

/**
 * How many characters fit from where `ref` starts to its container's right edge (its row in the
 * details panel), kept up to date as the panel is resized. `fallback` until it's measured.
 */
export function useColumns(ref: RefObject<HTMLElement | null>, fallback = 60): number {
  const [cols, setCols] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const measure = () => {
      const style = getComputedStyle(box);
      const right = box.getBoundingClientRect().right - parseFloat(style.paddingRight || "0");
      const room = right - el.getBoundingClientRect().left;
      const next = Math.max(20, Math.floor(room / charWidth(el)) - 1);
      setCols((c) => (c === next ? c : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // web fonts may arrive after the first measure: measure again with them
    let live = true;
    void document.fonts?.ready.then(() => {
      if (!live) return;
      charWidths.clear();
      measure();
    });
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [ref]);
  return cols;
}

/** A ref and the columns available from it (for code that lays itself out to the room it has). */
export function useCodeColumns<T extends HTMLElement>(fallback?: number) {
  const ref = useRef<T>(null);
  return [ref, useColumns(ref, fallback)] as const;
}
