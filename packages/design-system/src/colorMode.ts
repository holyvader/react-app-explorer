import { useSyncExternalStore } from "react";

export type ColorMode = "dark" | "light";
const KEY = "rae.colorMode";
const listeners = new Set<() => void>();

/** The colour mode in use: dark (Graphite) unless light (Paper) was picked. */
export const getColorMode = (): ColorMode => (document.documentElement.classList.contains("light") ? "light" : "dark");

/** Switches between Graphite (dark) and Paper (light), remembered across sessions. */
export function setColorMode(mode: ColorMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
  localStorage.setItem(KEY, mode);
  for (const l of listeners) l();
}

/** The colour mode, re-rendering when it changes. */
export const useColorMode = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getColorMode,
  );

/** Applies the stored colour mode (call once at startup, after the stored settings are loaded). */
export function applyStoredColorMode() {
  setColorMode(localStorage.getItem(KEY) === "light" ? "light" : "dark");
}
