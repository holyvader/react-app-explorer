import { beforeEach, describe, expect, test } from "bun:test";
import { readSetting, writeSetting } from "../src/lib/settings.ts";

// a minimal localStorage (bun has none)
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe("settings", () => {
  beforeEach(() => store.clear());

  test("round-trips JSON values; unset reads the fallback", () => {
    expect(readSetting("rae.a", 5)).toBe(5);
    writeSetting("rae.a", 7);
    writeSetting("rae.b", ["x"]);
    writeSetting("rae.c", "split");
    expect(readSetting("rae.a", 5)).toBe(7);
    expect(readSetting("rae.b", [] as string[])).toEqual(["x"]);
    expect(readSetting("rae.c", "inline")).toBe("split");
    expect(store.get("rae.c")).toBe('"split"');
  });

  test("undefined removes the setting", () => {
    writeSetting("rae.a", 1);
    writeSetting("rae.a", undefined);
    expect(store.has("rae.a")).toBe(false);
  });

  test("values stored before (raw strings, other formats) still read", () => {
    store.set("rae.mode", "inline");
    store.set("rae.path", "/Users/me/app");
    store.set("rae.num", "123");
    store.set("rae.merge", "off");
    store.set("rae.flag", "true");
    expect(readSetting("rae.mode", "split")).toBe("inline");
    expect(readSetting("rae.path", "")).toBe("/Users/me/app");
    // a raw string that happens to parse as another type stays the string
    expect(readSetting("rae.num", "")).toBe("123");
    expect(readSetting("rae.merge", true, (raw) => raw !== "off")).toBe(false);
    expect(readSetting("rae.flag", false)).toBe(true);
  });

  test("a value of another type falls back", () => {
    store.set("rae.width", '"wide"');
    store.set("rae.bad", "{oops");
    expect(readSetting("rae.width", 300)).toBe(300);
    expect(readSetting("rae.bad", 1)).toBe(1);
    // null fallback: any stored JSON
    store.set("rae.diagram", '{"visible":[]}');
    expect(readSetting<{ visible: string[] } | null>("rae.diagram", null)).toEqual({ visible: [] });
  });
});
