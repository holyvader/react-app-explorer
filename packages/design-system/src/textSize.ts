import { useSyncExternalStore } from "react";

/**
 * The interface text size (toolbar, panels, dialogs, menus; not the diagram): a scale on every font
 * size, through the `--rae-text-scale` variable on <html>. The theme's font-size tokens and text
 * styles are `calc(… * var(--rae-text-scale))`; a fixed size written in px goes through `textPx`.
 */
export type TextSize = "small" | "medium" | "large" | "xlarge";
export const TEXT_SIZES: { value: TextSize; label: string; scale: number }[] = [
  { value: "small", label: "Small", scale: 1 },
  { value: "medium", label: "Medium", scale: 1.1 },
  { value: "large", label: "Large", scale: 1.2 },
  { value: "xlarge", label: "Extra large", scale: 1.32 },
];
const DEFAULT: TextSize = "medium";
const KEY = "rae.textSize";
const listeners = new Set<() => void>();
let current: TextSize = DEFAULT;

/** A font size that follows the text size: `textPx(12.5)` → `calc(12.5px * var(--rae-text-scale, 1))`. */
export const textPx = (px: number) => `calc(${px}px * var(--rae-text-scale, 1))`;

export const getTextSize = () => current;

/** Sets the interface text size, remembered across sessions. */
export function setTextSize(size: TextSize) {
  const entry = TEXT_SIZES.find((s) => s.value === size) ?? TEXT_SIZES.find((s) => s.value === DEFAULT)!;
  current = entry.value;
  document.documentElement.style.setProperty("--rae-text-scale", String(entry.scale));
  localStorage.setItem(KEY, entry.value);
  for (const l of listeners) l();
}

/** The text size, re-rendering when it changes. */
export const useTextSize = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTextSize,
  );

/** Applies the stored text size (call once at startup, after the stored settings are loaded). */
export function applyStoredTextSize() {
  setTextSize((localStorage.getItem(KEY) as TextSize | null) ?? DEFAULT);
}
