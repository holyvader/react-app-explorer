import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Plugin } from "vite";

const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".turbo", ".explorer"]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => ok(data));
    req.on("error", fail);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Serves scanner snapshots during dev:
 *   GET /api/snapshots        → index (newest first)
 *   GET /api/snapshots/:file  → snapshot JSON
 *   GET /api/fs?path=…        → directory listing for the scan folder picker
 *   POST /api/scan {path, types} → runs the scanner CLI (under Bun), snapshot lands in the snapshots dir
 * Directory comes from RAE_SNAPSHOTS (absolute, or relative to the repo root).
 * Dev-only and local: it exposes the filesystem to the page, so never deploy this server.
 */
export function snapshotsPlugin(repoRoot: string): Plugin {
  const raw = process.env.RAE_SNAPSHOTS ?? ".explorer/snapshots";
  const dir = isAbsolute(raw) ? raw : resolve(repoRoot, raw);

  const listIndex = () => {
    if (!existsSync(dir)) return [];
    const indexPath = join(dir, "index.json");
    if (existsSync(indexPath)) {
      try {
        return JSON.parse(readFileSync(indexPath, "utf8"));
      } catch {
        /* fall through to directory listing */
      }
    }
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .map((file) => ({ file, createdAt: statSync(join(dir, file)).mtime.toISOString() }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  const cli = join(repoRoot, "packages/scanner/src/cli.ts");
  const bun = process.env.RAE_BUN ?? "bun";
  let running = false;

  const listDir = (path: string) => {
    const entries = readdirSync(path, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
      .filter((e) => e.isDirectory() || (e.isFile() && SOURCE_FILE.test(e.name)))
      .map((e) => ({ name: e.name, path: join(path, e.name), kind: e.isDirectory() ? "dir" : "file" }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    const markers = ["package.json", "tsconfig.json", "next.config.js", "next.config.ts", "next.config.mjs"].filter((m) =>
      existsSync(join(path, m)),
    );
    return { path, parent: dirname(path) === path ? null : dirname(path), entries, markers };
  };

  const runScan = (target: string, types: boolean) =>
    new Promise<{ code: number; stdout: string; stderr: string; ms: number }>((ok) => {
      const t0 = Date.now();
      const args = [cli, target, "--out", dir, "--stats", ...(types ? [] : ["--no-types"])];
      const child = spawn(bun, args, { cwd: repoRoot });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => ok({ code: -1, stdout, stderr: `${stderr}\n${e.message} (is bun on PATH? set RAE_BUN)`, ms: Date.now() - t0 }));
      child.on("close", (code) => ok({ code: code ?? -1, stdout, stderr, ms: Date.now() - t0 }));
    });

  return {
    name: "rae-snapshots",
    configureServer(server) {
      server.config.logger.info(`  ➜  Snapshots: ${dir}`);

      server.middlewares.use("/api/fs", (req, res) => {
        const q = new URL(req.url ?? "/", "http://x").searchParams.get("path");
        const path = q ? resolve(q) : (process.env.RAE_BROWSE_ROOT ?? dirname(repoRoot));
        try {
          if (!statSync(path).isDirectory()) return json(res, 400, { error: `Not a directory: ${path}` });
          json(res, 200, listDir(path));
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      });

      server.middlewares.use("/api/scan", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        if (running) return json(res, 409, { error: "A scan is already running" });
        let body: { path?: string; types?: boolean };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: "Invalid JSON body" });
        }
        const target = body.path ? resolve(body.path) : "";
        if (!target || !existsSync(target)) return json(res, 400, { error: `Path not found: ${target || "(empty)"}` });
        running = true;
        try {
          const r = await runScan(target, body.types !== false);
          if (r.code !== 0) return json(res, 500, { error: r.stderr.trim() || `scanner exited with ${r.code}`, stdout: r.stdout });
          const newest = listIndex()[0];
          json(res, 200, { file: newest?.file, stdout: r.stdout.trim(), stderr: r.stderr.trim(), ms: r.ms });
        } finally {
          running = false;
        }
      });

      server.middlewares.use("/api/snapshots", (req, res) => {
        const url = (req.url ?? "/").split("?")[0]!;
        res.setHeader("Content-Type", "application/json");
        if (url === "/" || url === "") {
          res.end(JSON.stringify({ dir, snapshots: listIndex() }));
          return;
        }
        const file = basename(decodeURIComponent(url));
        const path = join(dir, file);
        if (!file.endsWith(".json") || !existsSync(path)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        res.end(readFileSync(path));
      });
    },
  };
}
