import { describe, expect, test } from "bun:test";
import { displayName, indexFolderOf } from "../src/lib/displayName.ts";

describe("index files go by their folder", () => {
  test("an index file is named after its folder", () => {
    const n = { kind: "module" as const, name: "index.tsx", filePath: "src/components/TestComponent/index.tsx" };
    expect(indexFolderOf(n)).toBe("TestComponent");
    expect(displayName(n)).toBe("TestComponent");
  });
  test("ts, js, mjs index files count; other files and a root index don't", () => {
    for (const f of ["index.ts", "index.js", "index.jsx", "index.mjs"]) expect(indexFolderOf({ kind: "module", filePath: `lib/utils/${f}` })).toBe("utils");
    expect(indexFolderOf({ kind: "module", filePath: "lib/utils/index.css" })).toBeUndefined();
    expect(indexFolderOf({ kind: "module", filePath: "lib/utils/indexer.ts" })).toBeUndefined();
    expect(displayName({ kind: "module", name: "index.ts", filePath: "index.ts" })).toBe("index.ts");
  });
  test("a declaration keeps its name; an old snapshot's `index (default)` takes the folder's", () => {
    expect(indexFolderOf({ kind: "component", filePath: "src/Button/index.tsx" })).toBeUndefined();
    expect(displayName({ kind: "component", name: "Button", filePath: "src/Button/index.tsx" })).toBe("Button");
    expect(displayName({ kind: "component", name: "index (default)", filePath: "src/Button/index.tsx" })).toBe("Button (default)");
  });
});
