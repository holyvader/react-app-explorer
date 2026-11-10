import { useState } from "react";

/*
 * Settings kept in localStorage, under `rae.*` keys (the desktop app mirrors exactly those to its
 * server: lib/storage.ts). One format for all: JSON. Values written before this file existed in
 * other forms (a raw string, "on" / "off") still read: a raw string stays a string when the
 * fallback is one, and `legacy` maps anything else.
 */

/** A setting's value, or `fallback` when it's unset, unreadable or of another type. */
export function readSetting<T>(key: string, fallback: T, legacy?: (raw: string) => T | undefined): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  if (value !== undefined && (fallback === null || fallback === undefined || typeof value === typeof fallback)) return value as T;
  return legacy?.(raw) ?? (typeof fallback === "string" ? (raw as T) : fallback);
}

/** Stores a setting (as JSON); `undefined` removes it. A full storage just doesn't keep it. */
export function writeSetting(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the setting just isn't kept.
  }
}

/** `useState` kept in a setting: read once on mount, written on every change. */
export function usePersistentState<T>(key: string, fallback: T, legacy?: (raw: string) => T | undefined): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readSetting(key, fallback, legacy));
  const update = (next: T) => {
    writeSetting(key, next);
    setValue(next);
  };
  return [value, update];
}
