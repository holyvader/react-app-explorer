import type { GraphNode, ReviewThread, ReviewThreadList, Snapshot } from "@rae/schema";
import { create } from "zustand";
import { useExplorer } from "../store.ts";

/*
 * A pull / merge request's review comments (read-only), for a diff opened from one: read once per
 * request through the server (/api/git/review: gh / glab, logged in), each thread placed on the
 * element whose lines hold it — the innermost declaration of its file, else the file. Shown as
 * badges on the canvas (a popover per element) and under their line in the code diff.
 */

interface ReviewState {
  /** Which request the threads are of: `<rootDir>|<provider>|<number>`. */
  key?: string;
  threads: ReviewThread[];
  /** Thread ids by the element they're on. */
  byNode: Map<string, ReviewThread[]>;
  loading: boolean;
  error?: string;
  /** A badge's popover: its element, at the badge. */
  open?: { id: string; x: number; y: number };
  setOpen: (open: ReviewState["open"]) => void;
}

export const useReview = create<ReviewState>((set) => ({
  threads: [],
  byNode: new Map(),
  loading: false,
  setOpen: (open) => set({ open }),
}));

/** The element a thread is on: the innermost declaration whose lines hold it (head side), else its file. */
export function placeThreads(s: Snapshot, threads: ReviewThread[]): Map<string, ReviewThread[]> {
  const inFile = new Map<string, GraphNode[]>();
  for (const n of Object.values(s.nodes)) {
    if (n.kind === "external" || n.kind === "route") continue;
    const list = inFile.get(n.filePath) ?? [];
    list.push(n);
    inFile.set(n.filePath, list);
  }
  const out = new Map<string, ReviewThread[]>();
  const put = (id: string, t: ReviewThread) => out.set(id, [...(out.get(id) ?? []), t]);
  for (const t of threads) {
    const nodes = inFile.get(t.path);
    if (!nodes) continue;
    const file = nodes.find((n) => n.kind === "module" || n.file);
    // lines on the base side (removed code) or outdated ones don't name today's declarations
    const line = t.side === "new" && !t.outdated ? t.line : undefined;
    let best: GraphNode | undefined;
    if (line !== undefined)
      for (const n of nodes) {
        if (n.kind === "module" || n.file || !n.loc) continue;
        const end = n.endLine ?? n.loc.line;
        if (n.loc.line <= line && line <= end && (!best || end - n.loc.line < (best.endLine ?? best.loc!.line) - best.loc!.line)) best = n;
      }
    const target = best ?? file;
    if (target) put(target.id, t);
  }
  return out;
}

/** Reads the open diff's request threads when it changes (nothing without a request). */
async function load(s: Snapshot | undefined) {
  const req = s?.diff?.head.request;
  const key = s && req ? `${s.rootDir}|${req.provider}|${req.number}` : undefined;
  const st = useReview.getState();
  if (key === st.key) {
    // the same request in a newer snapshot: place the threads again (lines may have moved)
    if (s && st.threads.length) useReview.setState({ byNode: placeThreads(s, st.threads) });
    return;
  }
  useReview.setState({ key, threads: [], byNode: new Map(), error: undefined, open: undefined, loading: !!key });
  if (!s || !req || !key) return;
  const q = new URLSearchParams({ path: s.rootDir, provider: req.provider, number: String(req.number), ...(req.url ? { url: req.url } : {}) });
  try {
    const res = (await (await fetch(`/api/git/review?${q}`)).json()) as ReviewThreadList;
    if (useReview.getState().key !== key) return; // another request since
    const now = useExplorer.getState().snapshot ?? s;
    useReview.setState({ threads: res.threads, byNode: placeThreads(now, res.threads), error: res.error, loading: false });
  } catch (e) {
    if (useReview.getState().key === key) useReview.setState({ error: (e as Error).message, loading: false });
  }
}

useExplorer.subscribe((s, prev) => {
  if (s.snapshot !== prev.snapshot) void load(s.snapshot);
});
void load(useExplorer.getState().snapshot);

/** "3 min ago", "2 h ago", "5 d ago", or the date. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}
