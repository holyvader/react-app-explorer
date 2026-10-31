import { builtinModules } from "node:module";
import { ResolverFactory } from "oxc-resolver";
import type { Resolved } from "./extract/types.ts";

export const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
const BUILTINS = new Set(builtinModules);

/** Package name of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`, `next/link` → `next/link` is kept whole. */
function isBare(spec: string) {
  return !spec.startsWith(".") && !spec.startsWith("/");
}

export function createResolver(tsconfig?: string) {
  const factory = new ResolverFactory({
    tsconfig: tsconfig ? { configFile: tsconfig, references: "auto" } : "auto",
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"],
    extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"], ".mjs": [".mts", ".mjs"] },
    conditionNames: ["import", "module", "browser", "default", "require"],
    mainFields: ["module", "main"],
    builtinModules: true,
  });
  const cache = new Map<string, Resolved>();

  return function resolve(fromFile: string, specifier: string): Resolved {
    const dir = fromFile.slice(0, fromFile.lastIndexOf("/"));
    // Bare specifiers resolve identically from any file in the same package scope; cache relative ones per dir.
    const key = isBare(specifier) ? specifier + "\0" + dir : dir + "\0" + specifier;
    const hit = cache.get(key);
    if (hit) return hit;
    let res: Resolved;
    if (specifier.startsWith("node:") || BUILTINS.has(specifier)) {
      res = { kind: "external", specifier };
    } else {
      const r = factory.resolveFileSync(fromFile, specifier);
      if (r.path && !r.path.includes("/node_modules/")) {
        res = SOURCE_EXT.test(r.path) && !r.path.endsWith(".d.ts") ? { kind: "local", path: r.path } : { kind: "asset", path: r.path };
      } else {
        res = { kind: "external", specifier };
      }
    }
    cache.set(key, res);
    return res;
  };
}
