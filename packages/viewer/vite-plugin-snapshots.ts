import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * These endpoints expose the local filesystem and run the scanner, so they only answer the
 * viewer itself: the Host must be a loopback name (blocks DNS rebinding) and a present Origin
 * must be the same host (blocks cross-site requests from other pages open in the browser).
 */
function isTrusted(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  if (!LOCAL_HOSTS.has(hostname)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
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
  /** The running scan's snapshot file, once written (it can't be deleted until the scan ends). */
  let runningFile: string | undefined;

  const deleteSnapshots = (files: string[]) => {
    const removed: string[] = [];
    for (const f of files) {
      const file = basename(f);
      const full = join(dir, file);
      if (!file.endsWith(".json") || file === "index.json" || !existsSync(full)) continue;
      rmSync(full);
      removed.push(file);
    }
    const indexPath = join(dir, "index.json");
    if (removed.length && existsSync(indexPath)) {
      try {
        const index = JSON.parse(readFileSync(indexPath, "utf8")) as { file: string }[];
        writeFileSync(indexPath, JSON.stringify(index.filter((e) => !removed.includes(e.file)), null, 2));
      } catch {
        /* a broken index falls back to the folder listing */
      }
    }
    return removed;
  };

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

  return {
    name: "rae-snapshots",
    configureServer(server) {
      server.config.logger.info(`  ➜  Snapshots: ${dir}`);

      server.middlewares.use("/api", (req, res, next) => {
        if (!isTrusted(req)) return json(res, 403, { error: "Forbidden: the snapshot API only serves the local viewer" });
        next();
      });

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
        // JSON only: a cross-site form/text POST can't send this without a CORS preflight.
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "Content-Type must be application/json" });
        if (running) return json(res, 409, { error: "A scan is already running: cancel it first" });
        let body: { path?: string; types?: boolean };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: "Invalid JSON body" });
        }
        const target = body.path ? resolve(body.path) : "";
        if (!target || !existsSync(target)) return json(res, 400, { error: `Path not found: ${target || "(empty)"}` });
        running = true;
        // The CLI's --events mode: NDJSON ScanEvents (progress, structure result, then types),
        // streamed to the viewer line by line. The scan finishes even if the page goes away.
        const args = [cli, target, "--out", dir, "--events", ...(body.types !== false ? [] : ["--no-types"])];
        const child = spawn(bun, args, { cwd: repoRoot });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader("Cache-Control", "no-store");
        let stderr = "";
        let finished = false;
        const send = (line: string) => {
          if (!res.writableEnded) res.write(line.endsWith("\n") ? line : line + "\n");
        };
        let buf = "";
        child.stdout.on("data", (d: Buffer) => {
          buf += d.toString();
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            if (line.includes('"type":"done"') || line.includes('"type":"error"') || line.includes('"type":"cancelled"')) finished = true;
            if (line.includes('"type":"result"')) runningFile = (JSON.parse(line) as { file: string }).file;
            send(line);
          }
        });
        child.stderr.on("data", (d) => (stderr += d));
        // The page cancelled (or went away): stop the scanner — it cleans up its type checker.
        res.on("close", () => {
          if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
        });
        const end = (error?: string) => {
          running = false;
          runningFile = undefined;
          if (!finished) send(JSON.stringify({ type: "error", message: error ?? (stderr.trim() || "scanner exited without finishing") }));
          if (!res.writableEnded) res.end();
        };
        child.on("error", (e) => end(`${e.message} (is bun on PATH? set RAE_BUN)`));
        child.on("close", () => end());
      });

      server.middlewares.use("/api/snapshots", async (req, res) => {
        const url = (req.url ?? "/").split("?")[0]!;
        if (req.method === "DELETE" && (url === "/" || url === "")) {
          if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "Content-Type must be application/json" });
          let body: { files?: string[] };
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            return json(res, 400, { error: "Invalid JSON body" });
          }
          const files = (body.files ?? []).filter((f) => typeof f === "string");
          if (runningFile && files.map((f) => basename(f)).includes(runningFile)) return json(res, 409, { error: "That snapshot is still being scanned: cancel the scan first" });
          return json(res, 200, { removed: deleteSnapshots(files) });
        }
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
