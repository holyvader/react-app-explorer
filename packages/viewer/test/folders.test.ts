import { describe, expect, test } from "bun:test";
import { expandHome, looksLikePath, scannedFolders } from "../src/lib/folders.ts";

describe("folder switcher", () => {
  test("snapshots grouped by folder, newest folder first, with counts and the newest file", () => {
    const folders = scannedFolders({
      dir: "/x",
      snapshots: [
        { file: "a1.json", createdAt: "2026-11-20T10:00:00Z", rootDir: "/Users/me/a", framework: "react" },
        { file: "b1.json", createdAt: "2026-11-22T10:00:00Z", rootDir: "/Users/me/b", framework: "next-app" },
        { file: "a2.json", createdAt: "2026-11-23T10:00:00Z", rootDir: "/Users/me/a", framework: "react" },
        { file: "loaded.json", createdAt: "2026-11-24T10:00:00Z" },
      ],
    });
    expect(folders.map((f) => [f.dir, f.latest.file, f.count, f.framework])).toEqual([
      ["/Users/me/a", "a2.json", 2, "react"],
      ["/Users/me/b", "b1.json", 1, "next-app"],
    ]);
  });

  test("a pasted path is told from a filter, and ~ expands with a known home", () => {
    expect(looksLikePath("/Users/me/app")).toBe(true);
    expect(looksLikePath("~/app")).toBe(true);
    expect(looksLikePath("C:\\code\\app")).toBe(true);
    expect(looksLikePath("shop")).toBe(false);
    expect(looksLikePath("~shop")).toBe(false);
    expect(expandHome("~/app", ["/Users/me/a"])).toBe("/Users/me/app");
    expect(expandHome("~/app", [])).toBe("~/app");
    expect(expandHome(" /abs ", [])).toBe("/abs");
  });
});
