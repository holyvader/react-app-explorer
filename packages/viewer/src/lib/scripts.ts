import type { RunEvent, RunSummary, ScriptsInfo } from "@rae/schema";
import { create } from "zustand";

/*
 * package.json scripts of the open folder (the server's /api/scripts, scanner/src/scripts.ts): the
 * list, running and stopping them by name, and each run's output as it comes. The Scripts console
 * (components/scripts/ScriptsConsole.tsx) and the status bar's chips read this; ⌘K's `>` runs one.
 * Runs live in the server, so a reload finds them again (`load`) and follows them from the start.
 */

/** A run as the page knows it: the server's summary and its output so far. */
export interface RunView {
  summary: RunSummary;
  /** The output, newest last (what the page keeps of it: `LOG_KEEP`). */
  log: string;
  /** The next output piece to ask for. */
  next: number;
}

interface ScriptsState {
  /** The folder whose package.json is listed (the open snapshot's root). */
  dir?: string;
  info?: ScriptsInfo;
  error?: string;
  /** Each script's latest run, by script name. */
  runs: Record<string, RunView>;
  /** The console is open, on this script. */
  open: boolean;
  selected?: string;
  load: (dir: string | undefined) => Promise<void>;
  run: (script: string) => Promise<void>;
  stop: (script: string) => Promise<void>;
  restart: (script: string) => Promise<void>;
  show: (script?: string) => void;
  close: () => void;
}

/** Output kept per run in the page: the last ~400 kB (a dev server's log grows for days). */
const LOG_KEEP = 400_000;
/** A local address a dev server prints (as the server's: no trailing `.` / `,`). */
export const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"<>)]*[^\s'"<>).,;:!?])?\/?/;
/** `:5173` from a local address, or "" (never throws on a bad one). */
export function portOf(url: string): string {
  try {
    const port = new URL(url).port;
    return port ? `:${port}` : "";
  } catch {
    return "";
  }
}
const following = new Map<string, AbortController>();

const post = async (path: string, body: unknown) => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as RunSummary | { error: string };
  if ("error" in data) throw new Error(data.error);
  return data;
};

export const useScripts = create<ScriptsState>((set, get) => {
  /** Puts a run in (or updates it), keeping its output. */
  const upsert = (summary: RunSummary) =>
    set((s) => {
      const was = s.runs[summary.script];
      const same = was?.summary.id === summary.id;
      return { runs: { ...s.runs, [summary.script]: { summary, log: same ? was.log : "", next: same ? was.next : 0 } } };
    });

  /** Follows a run's output (once per run): pieces as they come, then how it ended. */
  const follow = async (summary: RunSummary) => {
    if (following.has(summary.id)) return;
    const abort = new AbortController();
    following.set(summary.id, abort);
    const take = (e: RunEvent | { type: "missing" }) => {
      const view = get().runs[summary.script];
      if (!view || view.summary.id !== summary.id) return;
      if (e.type === "out") {
        if (e.seq < view.next) return;
        const log = (view.log + e.text).slice(-LOG_KEEP);
        // the address a dev server prints: the server finds it too, but the page sees it first
        const url = view.summary.url ?? LOCAL_URL.exec(e.text)?.[0] ?? null;
        set((s) => ({ runs: { ...s.runs, [summary.script]: { summary: { ...view.summary, url }, log, next: e.seq + 1 } } }));
      } else if (e.type === "exit") set((s) => ({ runs: { ...s.runs, [summary.script]: { ...s.runs[summary.script]!, summary: e.run } } }));
    };
    try {
      const view = get().runs[summary.script];
      const res = await fetch(`/api/scripts/log?id=${encodeURIComponent(summary.id)}&from=${view?.next ?? 0}`, { signal: abort.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value, { stream: true });
        const lines = rest.split("\n");
        rest = lines.pop()!;
        for (const line of lines) if (line) take(JSON.parse(line));
      }
    } catch {
      /* the page going away, or the server: the summary stays as last known */
    } finally {
      // only this follower's entry: a newer one for the same run (project switched away and back) stays
      if (following.get(summary.id) === abort) following.delete(summary.id);
    }
  };

  return {
    runs: {},
    open: false,

    load: async (dir) => {
      if (dir === get().dir && (get().info || get().error)) return;
      for (const a of following.values()) a.abort();
      following.clear();
      set({ dir, info: undefined, error: undefined, runs: {}, selected: undefined });
      if (!dir) return;
      try {
        const res = await fetch(`/api/scripts?path=${encodeURIComponent(dir)}`);
        const data = (await res.json()) as (ScriptsInfo & { runs: RunSummary[] }) | { error: string };
        if (get().dir !== dir) return;
        if ("error" in data) return set({ error: data.error });
        const { runs, ...info } = data;
        // the newest run of each script (the list comes newest first)
        const latest = new Map<string, RunSummary>();
        for (const r of runs) if (!latest.has(r.script)) latest.set(r.script, r);
        set({ info, runs: Object.fromEntries([...latest].map(([script, summary]) => [script, { summary, log: "", next: 0 }])) });
        for (const r of latest.values()) void follow(r);
      } catch (e) {
        if (get().dir === dir) set({ error: (e as Error).message });
      }
    },

    run: async (script) => {
      const { dir } = get();
      if (!dir) return;
      set({ open: true, selected: script });
      try {
        const summary = await post("/api/scripts/run", { path: dir, script });
        // another project opened meanwhile: its scripts aren't this one's (the run is the server's, found again on return)
        if (get().dir !== dir) return;
        upsert(summary);
        void follow(summary);
      } catch (e) {
        if (get().dir !== dir) return;
        const now = Date.now();
        // a run that couldn't start (no package manager, the script gone): shown as failed, with why
        set((s) => ({
          runs: {
            ...s.runs,
            [script]: { summary: { id: `failed-${now}`, dir, script, command: s.info?.scripts[script] ?? "", status: "failed", exitCode: null, startedAt: now, endedAt: now, url: null }, log: `${(e as Error).message}\n`, next: 0 },
          },
        }));
      }
    },

    stop: async (script) => {
      const run = get().runs[script];
      if (!run || run.summary.status !== "running") return;
      try {
        // its end comes with its output (often before this answers, which still says "running")
        await post("/api/scripts/stop", { id: run.summary.id });
      } catch {
        /* already gone */
      }
    },

    restart: async (script) => {
      const run = get().runs[script];
      if (run?.summary.status === "running") {
        await get().stop(script);
        // wait for it to end (its output stream says so), at most 4 s
        for (let i = 0; i < 40 && get().runs[script]?.summary.status === "running"; i++) await new Promise((r) => setTimeout(r, 100));
      }
      await get().run(script);
    },

    show: (script) => set((s) => ({ open: true, selected: script ?? s.selected ?? Object.keys(s.info?.scripts ?? {})[0] })),
    close: () => set({ open: false }),
  };
});

/** How a run is going, in a few words. */
export function runWords(s: RunSummary): string {
  const took = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`);
  if (s.status === "running") return `running ${took(Date.now() - s.startedAt)}`;
  const end = s.endedAt ?? Date.now();
  if (s.status === "stopped") return `stopped · ${took(end - s.startedAt)}`;
  return s.status === "exited" ? `done · ${took(end - s.startedAt)}` : `failed${s.exitCode !== null ? ` · exit ${s.exitCode}` : ""} · ${took(end - s.startedAt)}`;
}

/** The package.json scripts whose name (or command) holds `term`, names first. */
export function matchingScripts(term: string, scripts: Record<string, string>): string[] {
  const t = term.toLowerCase();
  const names = Object.keys(scripts);
  return [...names.filter((n) => n.toLowerCase().includes(t)), ...names.filter((n) => !n.toLowerCase().includes(t) && scripts[n]!.toLowerCase().includes(t))];
}

