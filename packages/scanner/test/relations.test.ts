import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Snapshot } from "@rae/schema";
import { scan } from "../src/scan.ts";

/*
 * Relations the scanner used to miss (found by re-reading real projects and comparing): each file
 * here is one way code uses another element, and each test the relation it must make.
 */
const FILES: Record<string, string> = {
  "package.json": `{ "name": "relations" }`,
  // an export named like an Object.prototype member
  "lib/field.ts": `export function valueOf(x: number) { return x; }\n`,
  "lib/format.ts": `export function format(x: unknown) { return String(x); }\nexport const dayUtc = Math.round;\n`,
  "lib/errors.ts": `export class ApiError extends Error {}\n`,
  // an object constant whose methods are its code
  "lib/api.ts": `import { ApiError } from './errors';\nexport const api = {\n  get: async () => {\n    throw new ApiError();\n  },\n};\n`,
  // React's cache() wraps a function like memo does
  "lib/session.ts": `import { cache } from 'react';\nimport { format } from './format';\nexport const verify = cache(async () => format(1));\n`,
  // a barrel of export *: the second file exports the name
  "ui/index.ts": `export * from './a';\nexport * from './Loader';\n`,
  "ui/a.ts": `export function aThing() { return 1; }\n`,
  "ui/Loader.tsx": `export function Loader() { return <div />; }\n`,
  "ui/Base.tsx": `export function Base() { return <div />; }\n`,
  // components a factory makes
  "ui/Stack.tsx": `import { Base } from './Base';\nconst wrapComponent = (c: unknown) => c;\nexport const Stack = wrapComponent(Base);\n`,
  "ui/Button.tsx": `function ButtonRoot() { return <button />; }\nexport const Button = Object.assign(ButtonRoot, { Group: ButtonRoot });\n`,
  "app/Row.tsx": `export function Row() { return <li />; }\n`,
  // PascalCase constants made by calls that aren't components
  "ui/consts.ts": `import { createContext } from 'react';\nconst DRAWN = { a: 1 };\nexport const Kinds = Object.keys(DRAWN);\nexport const ThemeContext = createContext(null);\n`,
  "app/Page.tsx": [
    `import { valueOf } from '../lib/field';`,
    `import { Loader } from '../ui';`,
    `import { Stack } from '../ui/Stack';`,
    `import { Button } from '../ui/Button';`,
    `import { Row } from './Row';`,
    `import { format, dayUtc } from '../lib/format';`,
    `function icon() { return <span />; }`,
    `export function Page({ items }: { items: string[] }) {`,
    `  const v = valueOf(1) + dayUtc(2);`,
    `  const row = (x: string) => <Row key={x} />;`, // JSX in the component's own helper
    `  const labels = items.map(format);`, // a function passed as a value
    `  return <Stack><Loader /><Button />{items.map(row)}{icon()}{labels}{v}</Stack>;`, // a call to a JSX helper
    `}`,
  ].join("\n"),
  // a script: code in a top-level IIFE, and a registry of functions
  "scripts/run.ts": `import { format } from '../lib/format';\n(async () => {\n  format(1);\n})();\nexport const registry = [format];\n`,
};

let dir: string;
let s: Snapshot;
const has = (kind: string, from: string, to: string) => s.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rae-relations-"));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  s = await scan(dir, { cache: false, types: false, mergeSingleExport: false });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("relations the scanner finds", () => {
  test("an export named like an Object.prototype member (valueOf)", () => {
    expect(has("invokes", "app/Page.tsx#Page", "lib/field.ts#valueOf")).toBe(true);
  });
  test("a name through an export * barrel: the file that exports it, not the first one", () => {
    expect(has("renders", "app/Page.tsx#Page", "ui/Loader.tsx#Loader")).toBe(true);
    expect(s.edges.some((e) => e.from === "app/Page.tsx#Page" && e.to.startsWith("ui/a.ts"))).toBe(false);
  });
  test("components a factory makes: wrapComponent(Base), Object.assign(Root, …)", () => {
    expect(s.nodes["ui/Stack.tsx#Stack"]?.kind).toBe("component");
    expect(has("renders", "app/Page.tsx#Page", "ui/Stack.tsx#Stack")).toBe(true);
    expect(has("renders", "ui/Stack.tsx#Stack", "ui/Base.tsx#Base")).toBe(true);
    expect(has("renders", "app/Page.tsx#Page", "ui/Button.tsx#Button")).toBe(true);
  });
  test("JSX in a component's own helper; a helper returning JSX called", () => {
    expect(has("renders", "app/Page.tsx#Page", "app/Row.tsx#Row")).toBe(true);
    expect(has("renders", "app/Page.tsx#Page", "app/Page.tsx#icon")).toBe(true);
  });
  test("a function passed as a value", () => {
    expect(has("invokes", "app/Page.tsx#Page", "lib/format.ts#format")).toBe(true);
  });
  test("a call to an export that isn't a declaration counts for its file", () => {
    expect(has("invokes", "app/Page.tsx#Page", "lib/format.ts")).toBe(true);
  });
  test("an object constant's methods: its code", () => {
    expect(has("invokes", "lib/api.ts#api", "lib/errors.ts#ApiError")).toBe(true);
  });
  test("a function wrapped in React's cache()", () => {
    expect(s.nodes["lib/session.ts#verify"]).toBeDefined();
    expect(has("invokes", "lib/session.ts#verify", "lib/format.ts#format")).toBe(true);
  });
  test("a script's top-level IIFE and a registry of functions: the module's", () => {
    expect(has("invokes", "scripts/run.ts", "lib/format.ts#format")).toBe(true);
  });
  test("non-components made by calls stay out (Object.keys, createContext)", () => {
    expect(Object.values(s.nodes).filter((n) => n.kind === "component").map((n) => n.id).sort()).toEqual(
      ["app/Page.tsx#Page", "app/Page.tsx#icon", "app/Row.tsx#Row", "ui/Base.tsx#Base", "ui/Button.tsx#Button", "ui/Button.tsx#ButtonRoot", "ui/Loader.tsx#Loader", "ui/Stack.tsx#Stack"].sort(),
    );
  });
});
