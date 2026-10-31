import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Framework, NextRole } from "@rae/schema";

export interface ProjectInfo {
  rootDir: string;
  entry: string;
  /** Files to start the scan from. */
  initialFiles: string[];
  framework: Framework;
  tsconfig?: string;
  appDir?: string;
  pagesDir?: string;
}

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.explorer/**",
  "**/.turbo/**",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/*.stories.*",
  "**/*.config.*",
];

function findUp(start: string, name: string, stopAt?: string): string | undefined {
  let dir = start;
  while (true) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir || dir === stopAt) return undefined;
    dir = parent;
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export async function discoverProject(
  input: string,
  opts: { tsconfig?: string; include?: string[]; exclude?: string[] } = {},
): Promise<ProjectInfo> {
  const abs = resolve(input);
  const isFile = statSync(abs).isFile();
  const startDir = isFile ? dirname(abs) : abs;

  const pkgPath = findUp(startDir, "package.json");
  const rootDir = isFile ? (pkgPath ? dirname(pkgPath) : startDir) : abs;
  const pkg = pkgPath ? readJson(pkgPath) : undefined;
  const deps = { ...(pkg?.dependencies as object), ...(pkg?.devDependencies as object) } as Record<string, string>;

  const tsconfig = opts.tsconfig
    ? resolve(opts.tsconfig)
    : (findUp(startDir, "tsconfig.json") ?? findUp(startDir, "jsconfig.json"));

  const appDir = [join(rootDir, "app"), join(rootDir, "src/app")].find((d) => existsSync(d));
  const pagesDir = [join(rootDir, "pages"), join(rootDir, "src/pages")].find((d) => existsSync(d));
  const isNext = !!deps.next || existsSync(join(rootDir, "next.config.js")) || existsSync(join(rootDir, "next.config.ts")) || existsSync(join(rootDir, "next.config.mjs"));
  const framework: Framework = isNext && appDir ? "next-app" : isNext && pagesDir ? "next-pages" : "react";

  let initialFiles: string[];
  if (isFile) {
    initialFiles = [abs];
  } else {
    const include = opts.include?.length ? opts.include : ["**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"];
    const exclude = [...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])].map((g) => new Bun.Glob(g));
    initialFiles = [];
    for (const pattern of include) {
      for await (const f of new Bun.Glob(pattern).scan({ cwd: abs, onlyFiles: true, dot: false })) {
        if (exclude.some((g) => g.match(f))) continue;
        initialFiles.push(join(abs, f));
      }
    }
    initialFiles.sort();
  }

  return {
    rootDir,
    entry: isFile ? relative(rootDir, abs) : ".",
    initialFiles,
    framework: isNext && appDir ? "next-app" : framework,
    tsconfig,
    appDir: isNext ? appDir : undefined,
    pagesDir: isNext ? pagesDir : undefined,
  };
}

const APP_ROLES: Record<string, NextRole> = {
  page: "page",
  layout: "layout",
  template: "template",
  loading: "loading",
  error: "error",
  "global-error": "error",
  "not-found": "not-found",
  route: "route",
  default: "default",
};

export function nextRoleOf(absPath: string, info: ProjectInfo): NextRole | undefined {
  const base = absPath.slice(absPath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  if (info.appDir && absPath.startsWith(info.appDir + "/")) return APP_ROLES[base];
  if (info.pagesDir && absPath.startsWith(info.pagesDir + "/")) {
    const rel = absPath.slice(info.pagesDir.length + 1);
    if (rel.startsWith("api/")) return "api";
    if (base === "_app" || base === "_document") return "layout";
    if (base === "_error" || base === "404" || base === "500") return "error";
    return "page";
  }
  if (info.appDir || info.pagesDir) {
    const rel = relative(info.rootDir, absPath);
    if (/^(src\/)?(middleware|proxy)\.[jt]s$/.test(rel)) return "middleware";
  }
  return undefined;
}
