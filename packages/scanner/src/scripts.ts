import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { PackageManager, RunEvent, RunSummary, ScriptsInfo } from "@rae/schema";

export type { PackageManager, RunEvent, RunSummary, ScriptsInfo };

/*
 * package.json scripts: listing them and running them, for the viewer's Scripts console. Shared by
 * the Vite plugin and the desktop app's server (both expose the same /api/scripts routes).
 *
 * Only a script the package.json names can be run, by name, through the folder's package manager
 * (found from its lockfile) — never a command line from the page, never through a shell of ours.
 * The child gets the user's login-shell PATH: an app started from the Finder has a bare one, and
 * scripts call `bun`, `node`, `vite`… Runs live in this process, so their output survives a page
 * reload; when the process exits, they are stopped.
 */

const LOCKFILES: [string, PackageManager][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];
/** Output kept per run: past it, the oldest pieces go (a dev server can run for days). */
const LOG_LIMIT = 1_000_000;

/** The package manager a folder uses: its lockfile, or a parent's (a workspace), else `packageManager`, else npm. */
function managerOf(dir: string, pkg: { packageManager?: string }): PackageManager {
  for (let at = dir; ; at = dirname(at)) {
    for (const [file, pm] of LOCKFILES) if (existsSync(join(at, file))) return pm;
    if (dirname(at) === at) break;
  }
  const declared = pkg.packageManager?.split("@")[0];
  return declared === "bun" || declared === "pnpm" || declared === "yarn" ? declared : "npm";
}

/** The scripts of the package.json in `dir`; an error when there is none. */
export function listScripts(dir: string): ScriptsInfo | { error: string } {
  const at = resolve(dir);
  const file = join(at, "package.json");
  try {
    if (!statSync(at).isDirectory() || !existsSync(file)) return { error: `No package.json in ${at}` };
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; scripts?: Record<string, unknown>; packageManager?: string };
    const scripts = Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
    return { dir: at, name: pkg.name, manager: managerOf(at, pkg), scripts };
  } catch (e) {
    return { error: `Couldn't read ${file}: ${(e as Error).message}` };
  }
}

// ---- the user's PATH -----------------------------------------------------------------------------

let shellPath: Promise<string> | undefined;

/** The login shell's PATH (macOS / Linux; once, 5 s at most), with the usual tool folders after it. */
function userPath(): Promise<string> {
  shellPath ??= new Promise((done) => {
    const home = homedir();
    const usual = [join(home, ".bun/bin"), join(home, ".volta/bin"), join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    const withUsual = (path: string) => [...new Set([...path.split(delimiter).filter(Boolean), ...(process.platform === "win32" ? [] : usual)])].join(delimiter);
    if (process.platform === "win32") return done(withUsual(process.env.PATH ?? ""));
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
    const mark = "__RAE_PATH__";
    execFile(shell, ["-ilc", `printf '${mark}%s${mark}' "$PATH"`], { timeout: 5000, env: process.env }, (err, stdout) => {
      const found = !err ? String(stdout).split(mark)[1] : undefined;
      done(withUsual(found || process.env.PATH || ""));
    });
  });
  return shellPath;
}

/** Where `exe` is on `path`, or null. */
function which(exe: string, path: string): string | null {
  const names = process.platform === "win32" ? [`${exe}.cmd`, `${exe}.exe`, exe] : [exe];
  for (const dir of path.split(delimiter)) for (const name of names) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return null;
}

// ---- runs --------------------------------------------------------------------------------------

interface Run {
  summary: RunSummary;
  child: ChildProcess;
  /** Stop asked for it: its end is "stopped", not "failed". */
  stopping?: boolean;
  /** Output pieces, the first one being number `first`. */
  pieces: { text: string; stream: "stdout" | "stderr" }[];
  first: number;
  size: number;
  listeners: Set<(e: RunEvent) => void>;
}

const runs = new Map<string, Run>();
let nextId = 0;
/** Runs being started, by folder + script: a second request at the same time gets the same run. */
const starting = new Map<string, Promise<RunSummary | { error: string }>>();

// eslint-disable-next-line no-control-regex -- terminal colour codes
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
/** A local address in output: `http://localhost:5173/…`, without trailing punctuation (`…:3000.`, `…:3000,`). */
export const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"<>)]*[^\s'"<>).,;:!?])?\/?/;

/** All runs, newest first (those of `dir` only, when given). */
export function listRuns(dir?: string): RunSummary[] {
  const at = dir === undefined ? undefined : resolve(dir);
  return [...runs.values()]
    .map((r) => r.summary)
    .filter((s) => at === undefined || s.dir === at)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Runs `script` of the package.json in `dir` with its package manager. Already running: that run.
 * A finished run of the same script is replaced.
 */
export function runScript(dir: string, script: string): Promise<RunSummary | { error: string }> {
  const key = `${resolve(dir)}\n${script}`;
  const pending = starting.get(key);
  if (pending) return pending;
  const started = startRun(dir, script).finally(() => starting.delete(key));
  starting.set(key, started);
  return started;
}

async function startRun(dir: string, script: string): Promise<RunSummary | { error: string }> {
  const info = listScripts(dir);
  if ("error" in info) return info;
  if (!Object.hasOwn(info.scripts, script)) return { error: `No script "${script}" in ${join(info.dir, "package.json")}` };
  const same = [...runs.values()].find((r) => r.summary.dir === info.dir && r.summary.script === script);
  if (same?.summary.status === "running") return same.summary;
  if (same) runs.delete(same.summary.id);

  stopAllOnExit();
  const path = await userPath();
  const bin = which(info.manager, path);
  if (!bin) return { error: `${info.manager} isn't installed (or not on your PATH): it runs this folder's scripts` };
  // Windows: npm / pnpm / yarn are .cmd files, which only start through cmd.exe (Node refuses them
  // otherwise); the script's name then mustn't carry anything cmd.exe would read as syntax
  const viaCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  if (viaCmd && /["%^&|<>!\r\n]/.test(script)) return { error: `"${script}" can't be run on Windows from here (its name has characters cmd.exe treats as commands)` };
  const [cmd, args] = viaCmd ? ["cmd.exe", ["/d", "/s", "/c", `""${bin}" run "${script}""`]] : [bin, ["run", script]];
  const child = spawn(cmd, args, {
    windowsVerbatimArguments: viaCmd,
    cwd: info.dir,
    // its own process group (not on Windows): stopping it stops what it started (vite, tsc…)
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: path, NO_COLOR: "1", FORCE_COLOR: "0", CI: process.env.CI ?? "" },
  });
  const summary: RunSummary = { id: `run-${++nextId}`, dir: info.dir, script, command: info.scripts[script]!, status: "running", exitCode: null, startedAt: Date.now(), endedAt: null, url: null };
  const run: Run = { summary, child, pieces: [], first: 0, size: 0, listeners: new Set() };
  runs.set(summary.id, run);

  const emit = (e: RunEvent) => {
    for (const l of run.listeners) l(e);
  };
  const add = (stream: "stdout" | "stderr") => (data: Buffer) => {
    const text = data.toString("utf8").replace(ANSI, "");
    if (!text) return;
    if (!summary.url) summary.url = LOCAL_URL.exec(text)?.[0].replace("0.0.0.0", "localhost") ?? null;
    run.pieces.push({ text, stream });
    run.size += text.length;
    while (run.size > LOG_LIMIT && run.pieces.length > 1) {
      run.size -= run.pieces.shift()!.text.length;
      run.first++;
    }
    emit({ type: "out", seq: run.first + run.pieces.length - 1, text, stream });
  };
  child.stdout?.on("data", add("stdout"));
  child.stderr?.on("data", add("stderr"));
  const end = (code: number | null, error?: string) => {
    if (summary.status !== "running") return;
    if (error) add("stderr")(Buffer.from(`${error}\n`));
    summary.status = run.stopping ? "stopped" : code === 0 ? "exited" : "failed";
    summary.exitCode = code;
    summary.endedAt = Date.now();
    emit({ type: "exit", run: summary });
  };
  child.on("error", (e) => end(null, e.message));
  child.on("close", (code, signal) => end(code ?? (signal ? 128 : null)));
  return summary;
}

/** Stops a run: its whole process group, gently, then for good after 3 s. */
export function stopRun(id: string): RunSummary | { error: string } {
  const run = runs.get(id);
  if (!run) return { error: "No such run" };
  if (run.summary.status === "running") {
    run.stopping = true;
    kill(run.child);
  }
  return run.summary;
}

function kill(child: ChildProcess, graceMs = 3000) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      try {
        child.kill(s);
      } catch {
        /* gone already */
      }
    }
  };
  signal("SIGTERM");
  // the whole group, for good, after the grace: a wrapper (bun / npm) gone first can leave a child behind
  const hard = () => signal("SIGKILL");
  if (graceMs <= 0) hard();
  else setTimeout(hard, graceMs).unref?.();
}

/**
 * A run's output from piece `from` on (what's still kept), then each new piece and its end, to
 * `listener`; returns how to stop listening. A finished run: its output and end, at once.
 */
export function followRun(id: string, from: number, listener: (e: RunEvent) => void): (() => void) | null {
  const run = runs.get(id);
  if (!run) return null;
  run.pieces.forEach((p, i) => {
    const seq = run.first + i;
    if (seq >= from) listener({ type: "out", seq, ...p });
  });
  if (run.summary.status !== "running") {
    listener({ type: "exit", run: run.summary });
    return () => {};
  }
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

/**
 * Stops every run (the app quitting): asks each to stop, waits up to `graceMs` for them to end, then
 * kills what's left. Resolves once done (the caller exits right after).
 */
export async function stopAllRuns(graceMs = 150): Promise<void> {
  const live = [...runs.values()].filter((r) => r.summary.status === "running");
  for (const r of live) {
    r.stopping = true;
    kill(r.child, graceMs);
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && live.some((r) => r.summary.status === "running")) await new Promise((ok) => setTimeout(ok, 20));
  for (const r of live) if (r.child.pid) kill(r.child, 0);
}

// What runs here stops with this process (the dev server stopping, the app quitting): set up with
// the first run, so a host that never runs a script keeps its own signal handling untouched.
let cleanup = false;
function stopAllOnExit() {
  if (cleanup) return;
  cleanup = true;
  // exiting: no time to wait, everything goes now
  process.on("exit", () => {
    for (const r of runs.values()) if (r.summary.status === "running") kill(r.child, 0);
  });
  for (const [s, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const)
    process.once(s, () => void stopAllRuns().then(() => process.exit(code)));
}
