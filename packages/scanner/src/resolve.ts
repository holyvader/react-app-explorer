import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import type { Resolved } from "./extract/types.ts";

export const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
const BUILTINS = new Set(builtinModules);

/** Package name of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`, `next/link` → `next/link` is kept whole. */
function isBare(spec: string) {
  return !spec.startsWith(".") && !spec.startsWith("/");
}

/** Parses tsconfig-style JSON: comments and trailing commas allowed (strings are left intact). */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      // copy the whole string, escapes included — "./*" or "//" inside strings must survive
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface Aliases {
  /** `paths` patterns, each with its target templates (absolute, `*` kept). */
  paths: { prefix: string; suffix: string; wildcard: boolean; targets: string[] }[];
  /** `baseUrl` (absolute), if set. */
  baseUrl?: string;
}

const tsconfigCache = new Map<string, Aliases>();
const nearestCache = new Map<string, string | undefined>();

/** The aliases a tsconfig declares — following relative `extends` and project `references`. */
function aliasesOf(configPath: string, seen = new Set<string>()): Aliases {
  const cached = tsconfigCache.get(configPath);
  if (cached) return cached;
  const result: Aliases = { paths: [] };
  if (seen.has(configPath)) return result;
  seen.add(configPath);
  let json: { extends?: string | string[]; references?: { path: string }[]; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    json = parseJsonc(readFileSync(configPath, "utf8")) as typeof json;
  } catch {
    tsconfigCache.set(configPath, result);
    return result;
  }
  const dir = dirname(configPath);
  const fileOf = (p: string) => {
    const abs = resolvePath(dir, p);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
    if (existsSync(abs + ".json")) return abs + ".json";
    if (existsSync(join(abs, "tsconfig.json"))) return join(abs, "tsconfig.json");
    return undefined;
  };
  // inherited first, so this config's own settings win
  for (const ext of [json.extends ?? []].flat()) {
    if (!ext.startsWith(".") && !ext.startsWith("/")) continue; // package presets don't declare project aliases
    const f = fileOf(ext);
    if (!f) continue;
    const base = aliasesOf(f, seen);
    result.baseUrl = base.baseUrl;
    result.paths = [...base.paths];
  }
  const co = json.compilerOptions ?? {};
  if (co.baseUrl) result.baseUrl = resolvePath(dir, co.baseUrl);
  if (co.paths) {
    const root = result.baseUrl ?? dir;
    const own = Object.entries(co.paths).map(([pattern, targets]) => {
      const star = pattern.indexOf("*");
      return {
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? "" : pattern.slice(star + 1),
        wildcard: star >= 0,
        targets: targets.map((t) => resolvePath(root, t)),
      };
    });
    result.paths = [...own, ...result.paths.filter((p) => !own.some((o) => o.prefix === p.prefix && o.suffix === p.suffix))];
  }
  // Vite-style roots: tsconfig.json only references tsconfig.app.json etc., which declare the aliases
  for (const ref of json.references ?? []) {
    const f = fileOf(ref.path);
    if (!f) continue;
    const r = aliasesOf(f, seen);
    result.paths.push(...r.paths);
    result.baseUrl ??= r.baseUrl;
  }
  tsconfigCache.set(configPath, result);
  return result;
}

function nearestTsconfig(dir: string): string | undefined {
  if (nearestCache.has(dir)) return nearestCache.get(dir);
  let found: string | undefined;
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    if (existsSync(join(dir, name))) {
      found = join(dir, name);
      break;
    }
  }
  if (!found) {
    const parent = dirname(dir);
    found = parent !== dir && !dir.endsWith("/node_modules") ? nearestTsconfig(parent) : undefined;
  }
  nearestCache.set(dir, found);
  return found;
}

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
const packageName = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

/** Whether `spec`'s package is installed in a node_modules above `dir`. */
function packageInstalled(dir: string, spec: string): boolean {
  const name = packageName(spec);
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", name))) return true;
    if (dirname(d) === d) return false;
  }
}

/**
 * Where an import that didn't resolve would live, if it's the project's own (a tsconfig alias whose
 * target doesn't exist — generated files, a typo). Undefined → it's a package.
 */
function aliasTarget(dir: string, config: string | undefined, spec: string): string | undefined {
  if (!config) return undefined;
  const { paths, baseUrl } = aliasesOf(config);
  const firstSegmentExists = (root: string) => existsSync(join(root, spec.split("/")[0]!));
  for (const p of paths) {
    if (!spec.startsWith(p.prefix) || !spec.endsWith(p.suffix) || (!p.wildcard && spec !== p.prefix)) continue;
    const middle = p.wildcard ? spec.slice(p.prefix.length, spec.length - p.suffix.length) : "";
    // a catch-all pattern ("*") matches any package too: only claim it if the folder is the project's
    if (p.prefix === "" && p.suffix === "" && !p.targets.some((t) => firstSegmentExists(dirname(t)))) continue;
    const target = p.targets[0];
    if (target) return target.replace("*", middle);
  }
  if (baseUrl && firstSegmentExists(baseUrl)) return join(baseUrl, spec);
  return undefined;
}

/**
 * Module resolution for the scanner (oxc-resolver). External means a package: resolved into
 * node_modules, a Node built-in, or a bare name that's no alias. Project files that don't exist
 * (relative imports, or tsconfig aliases pointing at nothing — e.g. generated files) are `missing`,
 * never external.
 *
 * `tsconfig`: an explicit config for every file; otherwise each file uses its nearest tsconfig
 * (monorepo packages and Vite-style `references` keep their own aliases).
 */
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
      if (r.path) {
        if (r.path.includes("/node_modules/")) res = { kind: "external", specifier };
        else res = SOURCE_EXT.test(r.path) && !r.path.endsWith(".d.ts") ? { kind: "local", path: r.path } : { kind: "asset", path: r.path };
      } else if (!isBare(specifier)) {
        res = { kind: "missing", path: resolvePath(dir, specifier), specifier };
      } else {
        const target = packageInstalled(dir, specifier) ? undefined : aliasTarget(dir, tsconfig ?? nearestTsconfig(dir), specifier);
        res = target ? { kind: "missing", path: target, specifier } : { kind: "external", specifier };
      }
    }
    cache.set(key, res);
    return res;
  };
}
